from sqlalchemy import Column, Integer, String, DateTime, JSON, Boolean
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class FileMetadata(Base):
    __tablename__ = "files"
    id = Column(String, primary_key=True)
    name = Column(String)
    mime_type = Column(String)
    size_bytes = Column(Integer)
    owner_email = Column(String)
    sharing_level = Column(String) 
    public_role = Column(String) # 'reader', 'commenter', 'writer'
    folder_path = Column(String)
    modified_at = Column(DateTime)
    external_shares = Column(JSON)
    is_acknowledged = Column(Boolean, default=False)

class User(Base):
    __tablename__ = "user"
    email = Column(String, primary_key=True)
    is_primary = Column(Integer, default=1) # Simple flag for local use
