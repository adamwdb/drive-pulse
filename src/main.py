from fastapi import FastAPI, Depends, Query, HTTPException
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from typing import List, Optional
from datetime import datetime, timedelta

from .database import AsyncSessionLocal, init_db
from .models import FileMetadata, User
from .sync import sync_drive

app = FastAPI(title="Drive Pulse Identity")

# Dependency to get DB session
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

async def get_my_email(db: AsyncSession):
    """
    Returns the email to be treated as 'Me'.
    Reads from the User table populated during sync.
    """
    result = await db.execute(select(User.email).where(User.is_primary == 1))
    return result.scalar()

from fastapi.responses import FileResponse

@app.get("/audit")
async def get_audit_page():
    return FileResponse("static/audit.html")

@app.get("/stats")
async def get_stats(
    owner: Optional[str] = Query("all", enum=["all", "me", "others"]),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns file count, total size, distribution, and storage by MIME type.
    """
    my_email = await get_my_email(db)

    # Base query for the current filter
    if owner == "me":
        base_query = select(FileMetadata).where(FileMetadata.owner_email == my_email)
    elif owner == "others":
        base_query = select(FileMetadata).where(FileMetadata.owner_email != my_email)
    else:
        base_query = select(FileMetadata)

    # Total count and size
    sq = base_query.subquery()
    count_query = select(func.count(sq.c.id), func.sum(sq.c.size_bytes))
    result = await db.execute(count_query)
    count, total_size = result.fetchone()
    
    # MIME type distribution (Count and Size)
    dist_query = select(sq.c.mime_type, func.count(sq.c.id), func.sum(sq.c.size_bytes)).group_by(sq.c.mime_type)
    result = await db.execute(dist_query)
    
    mime_counts = {}
    mime_sizes = {}
    folder_count = 0
    for mime, m_count, m_size in result.fetchall():
        mime_counts[mime] = m_count
        mime_sizes[mime] = m_size or 0
        if mime == 'application/vnd.google-apps.folder':
            folder_count = m_count

    # Owned vs Shared counts (within the current base_query filter)
    owned_count_query = select(func.count(sq.c.id)).where(sq.c.owner_email == my_email)
    result = await db.execute(owned_count_query)
    owned_count = result.scalar() or 0

    shared_count = (count or 0) - owned_count
    
    return {
        "file_count": count or 0,
        "total_size_bytes": total_size or 0,
        "mime_type_distribution": mime_counts,
        "mime_type_sizes": mime_sizes,
        "folder_count": folder_count,
        "asset_count": (count or 0) - folder_count,
        "owned_count": owned_count,
        "shared_count": shared_count,
        "my_email": my_email
    }

@app.get("/health")
async def get_health(
    owner: Optional[str] = Query("all", enum=["all", "me", "others"]),
    db: AsyncSession = Depends(get_db)
):
    """
    Calculates and returns the safety score and risk items.
    """
    my_email = await get_my_email(db)

    # Fetch all files to calculate health based on ownership
    query = select(FileMetadata)
    if owner == "me":
        query = query.where(FileMetadata.owner_email == my_email)
    elif owner == "others":
        query = query.where(FileMetadata.owner_email != my_email)
    
    result = await db.execute(query)
    files = result.scalars().all()
    
    if not files:
        return {
            "safety_score": 100,
            "risk_counts": {"public": 0, "external": 0, "idle": 0, "trash_bytes": 0},
            "risk_items": [],
            "message": "No files found for this filter."
        }
    
    # Calculate risk counts (Excluding Acknowledged items for 'Me')
    now = datetime.now()
    six_months_ago = now - timedelta(days=180)
    two_years_ago = now - timedelta(days=730)

    # 1. OWNED FILES ANALYSIS (Safe Ratio Model)
    owned_files = [f for f in files if f.owner_email == my_email]
    total_owned = len(owned_files) or 1
    
    # Safe = Private OR Acknowledged
    safe_owned_count = sum(1 for f in owned_files if f.sharing_level == "Private" or f.is_acknowledged)
    safety_score_owned = int((safe_owned_count / total_owned) * 100)

    # 2. SHARED FILES ANALYSIS (Safe Ratio Model)
    shared_files = [f for f in files if f.owner_email != my_email]
    total_shared = len(shared_files) or 1
    safe_shared_count = sum(1 for f in shared_files if f.sharing_level == "Private")
    safety_score_shared = int((safe_shared_count / total_shared) * 100)

    # Risk counts for the UI (unacknowledged only for 'Me')
    owned_unack = [f for f in owned_files if not f.is_acknowledged]
    o_critical = sum(1 for f in owned_unack if f.sharing_level == "Public" and f.public_role == "writer")
    o_public = sum(1 for f in owned_unack if f.sharing_level == "Public" and f.public_role != "writer")
    o_external = sum(1 for f in owned_unack if f.external_shares and len(f.external_shares) > 0)
    o_idle = sum(1 for f in owned_unack if f.sharing_level != "Private" and f.modified_at and f.modified_at < six_months_ago)

    risk_counts = {
        "owned": {
            "critical": o_critical,
            "public": o_public,
            "external": o_external,
            "idle": o_idle,
            "trash_bytes": sum(f.size_bytes for f in owned_unack if f.size_bytes > 100 * 1024 * 1024 and f.modified_at and f.modified_at < two_years_ago)
        },
        "shared": {
            "critical": sum(1 for f in shared_files if f.sharing_level == "Public" and f.public_role == "writer"),
            "public": sum(1 for f in shared_files if f.sharing_level == "Public" and f.public_role != "writer"),
            "total": len(shared_files)
        }
    }
    
    # Priority Risk Items (Mix of both, but flag ownership)
    risk_items = []
    # Mix unacknowledged owned files + all shared files for the log
    all_risks = []
    # 1. My Critical/High
    for f in [f for f in owned_unack if f.sharing_level == "Public"]:
        all_risks.append(f)
    # 2. Shared Public
    for f in [f for f in shared_files if f.sharing_level == "Public"]:
        all_risks.append(f)
    # 3. My External
    for f in [f for f in owned_unack if f.external_shares and len(f.external_shares) > 0]:
        all_risks.append(f)
            
    # Pick top 50
    for f in all_risks[:50]:
        is_mine = f.owner_email == my_email
        if f.sharing_level == "Public":
            role_desc = "Publicly Editable" if f.public_role == "writer" else "Publicly Shared (View Only)"
            risk_items.append({
                "id": f.id, "name": f.name, "reason": role_desc, 
                "severity": "Critical" if f.public_role == "writer" else "High", 
                "mime_type": f.mime_type, "is_mine": is_mine
            })
        elif f.external_shares and len(f.external_shares) > 0:
            risk_items.append({
                "id": f.id, "name": f.name, "reason": f"Shared externally ({len(f.external_shares)} users)", 
                "severity": "Medium", "mime_type": f.mime_type, "is_mine": is_mine
            })

    return {
        "safety_score": safety_score_owned,
        "shared_safety_score": safety_score_shared,
        "risk_counts": risk_counts,
        "risk_items": risk_items
    }

@app.get("/files")
async def list_files(
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    search: Optional[str] = None,
    severity: Optional[str] = Query(None, enum=["Critical", "High", "Medium", "Low", "Safe"]),
    owner: str = Query("me", enum=["all", "me", "others"]),
    db: AsyncSession = Depends(get_db)
):
    """
    Paginated list of files with filtering, search, and ownership toggle.
    """
    my_email = await get_my_email(db)
    query = select(FileMetadata)
    
    # Ownership Filter
    if owner == "me":
        query = query.where(FileMetadata.owner_email == my_email)
    elif owner == "others":
        query = query.where(FileMetadata.owner_email != my_email)
    
    if search:
        query = query.where(FileMetadata.name.ilike(f"%{search}%"))
        
    if severity:
        now = datetime.now()
        six_months_ago = now - timedelta(days=180)
        
        if severity == "Critical":
            # ONLY Public + Writer
            query = query.where(FileMetadata.sharing_level == "Public", FileMetadata.public_role == "writer")
        elif severity == "High":
            # ONLY Public + Reader (or None)
            query = query.where(FileMetadata.sharing_level == "Public", FileMetadata.public_role != "writer")
        elif severity == "Medium":
            # NOT Public, but has external shares
            query = query.where(FileMetadata.sharing_level != "Public", FileMetadata.external_shares != None, FileMetadata.external_shares != "[]")
        elif severity == "Low":
            # NOT Public, NOT External, but is Shared AND Old
            query = query.where(
                FileMetadata.sharing_level != "Public",
                FileMetadata.sharing_level != "Private",
                FileMetadata.modified_at < six_months_ago,
                or_(FileMetadata.external_shares == None, FileMetadata.external_shares == "[]")
            )
        elif severity == "Safe":
            query = query.where(FileMetadata.sharing_level == "Private")

    # Order by severity priority
    query = query.order_by(FileMetadata.sharing_level.desc(), FileMetadata.name.asc())
    
    # Total count for pagination
    count_res = await db.execute(select(func.count()).select_from(query.subquery()))
    total_count = count_res.scalar()
    
    # Pagination
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    # Fetch files
    result = await db.execute(query)
    db_files = result.scalars().all()
    
    # Calculate severity for each file to match dashboard logic
    now = datetime.now()
    six_months_ago = now - timedelta(days=180)
    
    enriched_files = []
    for f in db_files:
        severity = "Safe"
        reason = "Private"
        is_unorganized = f.folder_path == "UNORGANIZED"
        
        if f.sharing_level == "Public":
            if f.public_role == "writer":
                severity = "Critical"
                reason = "Publicly Editable"
            else:
                severity = "High"
                reason = "Publicly Shared (View Only)"
        elif f.external_shares and len(f.external_shares) > 0:
            severity = "Medium"
            reason = f"Shared externally ({len(f.external_shares)} users)"
        elif f.sharing_level != "Private" and f.modified_at and f.modified_at < six_months_ago:
            severity = "Low"
            reason = "Idle shared access (> 6 months)"
            
        # Add Unorganized context if applicable
        if is_unorganized:
            reason = f"{reason} | Unorganized (No Parent)"
            
        file_dict = {
            "id": f.id,
            "name": f.name,
            "owner_email": f.owner_email,
            "sharing_level": f.sharing_level,
            "public_role": f.public_role,
            "folder_path": f.folder_path,
            "modified_at": f.modified_at,
            "external_shares": f.external_shares,
            "severity": severity,
            "risk_reason": reason,
            "mime_type": f.mime_type,
            "is_unorganized": is_unorganized,
            "is_acknowledged": f.is_acknowledged
        }
        enriched_files.append(file_dict)
    
    return {
        "files": enriched_files,
        "total": total_count,
        "page": page,
        "pages": (total_count + page_size - 1) // page_size
    }


@app.post("/files/{file_id}/acknowledge")
async def acknowledge_file(file_id: str, db: AsyncSession = Depends(get_db)):
    """
    Toggles the is_acknowledged status for a file.
    """
    result = await db.execute(select(FileMetadata).where(FileMetadata.id == file_id))
    file_record = result.scalar_one_or_none()
    
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")
        
    file_record.is_acknowledged = not file_record.is_acknowledged
    await db.commit()
    return {"status": "success", "is_acknowledged": file_record.is_acknowledged}

@app.post("/sync")
async def trigger_sync(user_only: bool = Query(False)):
    """
    Triggers the Google Drive sync process.
    If user_only is True, it only updates the user info.
    """
    try:
        await sync_drive(user_only=user_only)
        return {"status": "success", "message": "Sync completed successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount static files at the end
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
