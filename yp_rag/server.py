import os
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Header
from pydantic import BaseModel
from typing import Optional

from rag_engine import index_item, remove_item, remove_by_source, search, rebuild_index

RAG_API_KEY = os.getenv('RAG_API_KEY', 'yp_rag_secret_2026')
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://yp_dev:yp_dev_pass_2026@localhost:5432/yp_local')

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[RAG SERVICE] Starting up...")
    rebuild_index(db_url=DATABASE_URL)
    print("[RAG SERVICE] Ready.")
    yield
    print("[RAG SERVICE] Shutting down.")

app = FastAPI(title="YP RAG Service", lifespan=lifespan)

def verify_key(authorization: Optional[str] = Header(None)):
    if not RAG_API_KEY:
        return
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    token = authorization.replace("Bearer ", "")
    if token != RAG_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")

class IndexRequest(BaseModel):
    item_id: int
    title: str
    content: str
    source_type: str
    url: str = ''
    author: str = ''
    created_at: str = ''

class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    source_type: Optional[str] = None

class RebuildRequest(BaseModel):
    db_url: Optional[str] = None

@app.post("/index")
def api_index(req: IndexRequest, _=Depends(verify_key)):
    ok = index_item(req.item_id, req.title, req.content, req.source_type,
                    url=req.url, author=req.author, created_at=req.created_at)
    return {"ok": ok}

@app.delete("/item/{source_type}/{item_id}")
def api_remove(source_type: str, item_id: int, _=Depends(verify_key)):
    ok = remove_item(source_type, item_id)
    return {"ok": ok}

@app.delete("/source/{source_type}")
def api_remove_by_source(source_type: str, _=Depends(verify_key)):
    ok = remove_by_source(source_type)
    return {"ok": ok}

@app.post("/search")
def api_search(req: SearchRequest, _=Depends(verify_key)):
    hits = search(req.query, top_k=req.top_k, source_type=req.source_type)
    return {"hits": hits}

@app.post("/rebuild")
def api_rebuild(_=Depends(verify_key)):
    rebuild_index(db_url=DATABASE_URL)
    return {"ok": True, "message": "Index rebuilt"}

@app.get("/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
