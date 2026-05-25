import httpx
import random
from fastapi import FastAPI, Depends, HTTPException, status, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

try:
    from .database import get_db, init_db, QuoteHistory
except ImportError:
    from database import get_db, init_db, QuoteHistory

# Initialise DB on startup
init_db()

app = FastAPI(title="Quote Generator API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── External API config ─────────────────────────────────────────────────────
# Primary: ZenQuotes  →  https://zenquotes.io/api/random
# Fallback: hand-crafted list (so the app always works offline)
ZENQUOTES_URL = "https://zenquotes.io/api/random"

FALLBACK_QUOTES = [
    {"text": "The only way to do great work is to love what you do.", "author": "Steve Jobs", "tags": "inspiration,work"},
    {"text": "In the middle of difficulty lies opportunity.", "author": "Albert Einstein", "tags": "wisdom,opportunity"},
    {"text": "It does not matter how slowly you go as long as you do not stop.", "author": "Confucius", "tags": "perseverance,wisdom"},
    {"text": "Life is what happens when you're busy making other plans.", "author": "John Lennon", "tags": "life,wisdom"},
    {"text": "The future belongs to those who believe in the beauty of their dreams.", "author": "Eleanor Roosevelt", "tags": "inspiration,dreams"},
    {"text": "Strive not to be a success, but rather to be of value.", "author": "Albert Einstein", "tags": "success,wisdom"},
    {"text": "Two roads diverged in a wood, and I took the one less traveled by.", "author": "Robert Frost", "tags": "life,choices"},
    {"text": "I have not failed. I've just found 10,000 ways that won't work.", "author": "Thomas Edison", "tags": "perseverance,innovation"},
    {"text": "In three words I can sum up everything I've learned about life: it goes on.", "author": "Robert Frost", "tags": "life,wisdom"},
    {"text": "If you tell the truth, you don't have to remember anything.", "author": "Mark Twain", "tags": "truth,wisdom"},
    {"text": "Always forgive your enemies; nothing annoys them so much.", "author": "Oscar Wilde", "tags": "humor,wisdom"},
    {"text": "A friend is someone who gives you total freedom to be yourself.", "author": "Jim Morrison", "tags": "friendship,freedom"},
    {"text": "To live is the rarest thing in the world. Most people exist, that is all.", "author": "Oscar Wilde", "tags": "life,inspiration"},
    {"text": "Without music, life would be a mistake.", "author": "Friedrich Nietzsche", "tags": "music,life"},
    {"text": "We accept the love we think we deserve.", "author": "Stephen Chbosky", "tags": "love,self-worth"},
]

# ─── Pydantic Schemas ─────────────────────────────────────────────────────────

class QuoteOut(BaseModel):
    id: int
    text: str
    author: str
    tags: str
    source: str
    is_favorite: bool
    fetched_at: datetime

    class Config:
        from_attributes = True

class FavoriteUpdate(BaseModel):
    is_favorite: bool

# ─── Helper: fetch from ZenQuotes ────────────────────────────────────────────

async def fetch_from_zenquotes() -> dict:
    """
    Calls ZenQuotes external API and returns a normalised quote dict.
    Falls back to the local list if the API is unreachable.
    """
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(ZENQUOTES_URL)
            resp.raise_for_status()
            data = resp.json()          # [{"q": "...", "a": "...", "h": "..."}]
            item = data[0]
            return {
                "text":   item["q"].strip(),
                "author": item["a"].strip() or "Unknown",
                "tags":   "inspiration",
                "source": "ZenQuotes",
            }
    except Exception:
        # Fallback to local list
        chosen = random.choice(FALLBACK_QUOTES)
        return {**chosen, "source": "Local"}

# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"message": "Quote Generator API. Docs at /docs"}


@app.get("/api/quote", response_model=QuoteOut)
async def get_random_quote(db: Session = Depends(get_db)):
    """
    Fetches a fresh random quote from the ZenQuotes external API,
    persists it in the SQLite history database, and returns it.
    """
    quote_data = await fetch_from_zenquotes()

    db_quote = QuoteHistory(
        text       = quote_data["text"],
        author     = quote_data["author"],
        tags       = quote_data["tags"],
        source     = quote_data["source"],
        fetched_at = datetime.utcnow(),
    )
    db.add(db_quote)
    db.commit()
    db.refresh(db_quote)
    return db_quote


@app.get("/api/history", response_model=List[QuoteOut])
def get_history(
    favorites_only: bool = Query(False, description="Filter to favorites only"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Returns saved quote history, newest first."""
    query = db.query(QuoteHistory)
    if favorites_only:
        query = query.filter(QuoteHistory.is_favorite == True)
    return query.order_by(QuoteHistory.fetched_at.desc()).limit(limit).all()


@app.patch("/api/history/{quote_id}/favorite", response_model=QuoteOut)
def toggle_favorite(quote_id: int, body: FavoriteUpdate, db: Session = Depends(get_db)):
    """Toggle the favourite flag on a saved quote."""
    q = db.query(QuoteHistory).filter(QuoteHistory.id == quote_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Quote not found")
    q.is_favorite = body.is_favorite
    db.commit()
    db.refresh(q)
    return q


@app.delete("/api/history/{quote_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_quote(quote_id: int, db: Session = Depends(get_db)):
    """Delete a single quote from history."""
    q = db.query(QuoteHistory).filter(QuoteHistory.id == quote_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Quote not found")
    db.delete(q)
    db.commit()
    return None


@app.delete("/api/history", status_code=status.HTTP_204_NO_CONTENT)
def clear_history(db: Session = Depends(get_db)):
    """Wipe the entire quote history."""
    db.query(QuoteHistory).delete()
    db.commit()
    return None


@app.get("/api/stats")
def get_stats(db: Session = Depends(get_db)):
    """Returns quick stats for the dashboard."""
    total     = db.query(QuoteHistory).count()
    favorites = db.query(QuoteHistory).filter(QuoteHistory.is_favorite == True).count()
    zenquotes = db.query(QuoteHistory).filter(QuoteHistory.source == "ZenQuotes").count()
    local     = db.query(QuoteHistory).filter(QuoteHistory.source == "Local").count()
    return {
        "total_quotes":    total,
        "favorites":       favorites,
        "from_zenquotes":  zenquotes,
        "from_local":      local,
    }
