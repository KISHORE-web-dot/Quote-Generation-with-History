from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

DATABASE_URL = "sqlite:///./quotes.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class QuoteHistory(Base):
    __tablename__ = "quote_history"

    id          = Column(Integer, primary_key=True, index=True)
    text        = Column(String, nullable=False)
    author      = Column(String, default="Unknown")
    tags        = Column(String, default="")          # comma-separated
    source      = Column(String, default="ZenQuotes")
    is_favorite = Column(Boolean, default=False)
    fetched_at  = Column(DateTime, default=datetime.utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
