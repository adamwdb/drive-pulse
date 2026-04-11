import anyio
import logging
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from .database import AsyncSessionLocal, init_db
from .models import FileMetadata, User
from .drive_client import get_drive_service

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def sync_drive(user_only: bool = False):
    """
    Syncs file metadata and user info from Google Drive.
    If user_only is True, skips file metadata to save API requests.
    """
    logger.info(f"Starting sync_drive (user_only={user_only})...")
    try:
        await init_db()
        service = get_drive_service()
        
        # 0. Fetch User Info (Quick - 1 request)
        about = await anyio.to_thread.run_sync(
            lambda: service.about().get(fields="user(emailAddress)").execute()
        )
        my_email = about.get('user', {}).get('emailAddress')
        logger.info(f"Authenticated as: {my_email}")
        
        async with AsyncSessionLocal() as session:
            if my_email:
                user_record = User(email=my_email, is_primary=1)
                await session.merge(user_record)
                await session.commit()
        
        if user_only:
            logger.info("User info updated. Skipping file metadata sync.")
            return
            
    except Exception as e:
        logger.error(f"Error initializing sync: {e}")
        raise

    # 1. Build a map of all folders for path resolution
    # We fetch folders first so we can build human-readable paths
    folders = {}
    page_token = None

    logger.info("Fetching folders...")
    try:
        while True:
            # Fetch folders using anyio to run the blocking google-api call in a thread
            response = await anyio.to_thread.run_sync(
                lambda: service.files().list(
                    q="mimeType = 'application/vnd.google-apps.folder' and trashed = false",
                    fields="nextPageToken, files(id, name, parents)",
                    pageSize=1000,
                    pageToken=page_token
                ).execute()
            )

            for f in response.get('files', []):
                folders[f['id']] = {
                    'name': f['name'],
                    'parent': f.get('parents', [None])[0]
                }

            page_token = response.get('nextPageToken')
            if not page_token:
                break
        logger.info(f"Fetched {len(folders)} folders.")
    except Exception as e:
        logger.error(f"Error fetching folders: {e}")
        raise

    def resolve_path(folder_id):
        """Recursively builds the path string for a folder ID."""
        if not folder_id or folder_id not in folders:
            return ""

        path = folders[folder_id]['name']
        parent_id = folders[folder_id]['parent']

        if parent_id and parent_id in folders:
            parent_path = resolve_path(parent_id)
            if parent_path:
                return f"{parent_path}/{path}"
        return path

    # 2. Iterate through all files and folders to sync to DB
    logger.info("Fetching all files metadata...")
    try:
        async with AsyncSessionLocal() as session:
            page_token = None
            files_count = 0
            while True:
                response = await anyio.to_thread.run_sync(
                    lambda: service.files().list(
                        q="trashed = false",
                        fields="nextPageToken, files(id, name, mimeType, size, owners, permissions, parents, modifiedTime)",
                        pageSize=1000,
                        pageToken=page_token
                    ).execute()
                )

                for f in response.get('files', []):
                    files_count += 1
                    # Extract owner email and domain
                    owners = f.get('owners', [])
                    owner_email = owners[0].get('emailAddress') if owners else None
                    primary_domain = owner_email.split('@')[-1] if owner_email else None

                    # Determine sharing level and external shares
                    sharing_level = "Private"
                    public_role = None
                    external_shares = []
                    permissions = f.get('permissions', [])

                    for p in permissions:
                        ptype = p.get('type')
                        email = p.get('emailAddress')
                        role = p.get('role')

                        if ptype == 'anyone':
                            sharing_level = "Public"
                            public_role = role
                        elif ptype == 'domain':
                            if sharing_level != "Public":
                                sharing_level = "Domain"
                        elif ptype in ('user', 'group'):
                            # Owners are always part of permissions but don't count as 'shares'
                            if role == 'owner':
                                continue

                            if sharing_level not in ("Public", "Domain"):
                                sharing_level = "Specific People"

                            # Check for external shares (users outside the owner's domain)
                            if email and primary_domain and not email.endswith(f"@{primary_domain}"):
                                external_shares.append(email)

                    # Resolve path
                    parents = f.get('parents', [])
                    if not parents:
                        folder_path = "UNORGANIZED"
                    else:
                        parent_id = parents[0]
                        folder_path = resolve_path(parent_id)

                    # Parse modification time
                    modified_at = None
                    if f.get('modifiedTime'):
                        # Convert '2024-01-01T00:00:00.000Z' to datetime
                        modified_at = datetime.fromisoformat(f['modifiedTime'].replace('Z', '+00:00'))

                    # Create or Update record
                    file_record = FileMetadata(
                        id=f['id'],
                        name=f['name'],
                        mime_type=f['mimeType'],
                        size_bytes=int(f.get('size', 0)),
                        owner_email=owner_email,
                        sharing_level=sharing_level,
                        public_role=public_role,
                        folder_path=folder_path,
                        modified_at=modified_at,
                        external_shares=external_shares
                    )

                    # merge() handles UPSERT-like behavior (update if exists, else insert)
                    await session.merge(file_record)

                page_token = response.get('nextPageToken')
                if not page_token:
                    break
            
            logger.info(f"Syncing {files_count} files to local database...")
            await session.commit()
            logger.info("Sync completed successfully.")
    except Exception as e:
        logger.error(f"Error during file sync: {e}")
        raise

if __name__ == "__main__":
    import asyncio
    asyncio.run(sync_drive())
