import asyncio
from sqlalchemy import select, func
from src.database import AsyncSessionLocal
from src.models import FileMetadata

async def check():
    async with AsyncSessionLocal() as session:
        # Total count
        res = await session.execute(select(func.count(FileMetadata.id)))
        total = res.scalar()
        print(f"Total files: {total}")
        
        # Sharing levels
        res = await session.execute(
            select(FileMetadata.sharing_level, func.count(FileMetadata.id))
            .group_by(FileMetadata.sharing_level)
        )
        print("Sharing levels:")
        for row in res.fetchall():
            print(f"  {row[0]}: {row[1]}")
            
        # Sample some risks
        res = await session.execute(
            select(FileMetadata.name, FileMetadata.sharing_level)
            .where(FileMetadata.sharing_level != 'Private')
            .limit(5)
        )
        print("\nSample Risk Items:")
        for row in res.fetchall():
            print(f"  {row[0]} ({row[1]})")

if __name__ == '__main__':
    asyncio.run(check())
