import asyncio
from sqlalchemy import select
from src.database import AsyncSessionLocal
from src.models import FileMetadata

async def check():
    async with AsyncSessionLocal() as session:
        # Search for .sub or .stub in name
        res = await session.execute(
            select(FileMetadata)
            .where(FileMetadata.name.like('%sub%') | FileMetadata.name.like('%stub%'))
            .limit(10)
        )
        print('Sample .sub / .stub files and their status:')
        for f in res.scalars():
            print(f'- {f.name}')
            print(f'  Sharing: {f.sharing_level}')
            print(f'  Path: {f.folder_path}')
            print(f'  ID: {f.id}')
            print('---')

if __name__ == '__main__':
    asyncio.run(check())
