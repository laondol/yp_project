import os
import json
import threading
from datetime import datetime

import chromadb
from sentence_transformers import SentenceTransformer

COLLECTION_NAME = "yp_community"
CHROMA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'chroma_data')
MODEL_NAME = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'

_embedder = None
_chroma_client = None
_collection = None
_lock = threading.Lock()

def _get_embedder():
    global _embedder
    if _embedder is None:
        _embedder = SentenceTransformer(MODEL_NAME, device='cpu')
    return _embedder

def _get_collection():
    global _chroma_client, _collection
    if _collection is None:
        _chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
        _collection = _chroma_client.get_or_create_collection(name=COLLECTION_NAME)
    return _collection

def _chunk_text(text, max_len=512):
    words = text.split()
    chunks, chunk = [], []
    for w in words:
        chunk.append(w)
        if len(' '.join(chunk)) > max_len:
            chunks.append(' '.join(chunk[:-1]))
            chunk = [chunk[-1]]
    if chunk:
        chunks.append(' '.join(chunk))
    return chunks or [text]

def index_item(item_id, title, content, source_type, url='', author='', created_at=''):
    with _lock:
        try:
            col = _get_collection()
            texts = _chunk_text(f"{title}\n{content}")
            embedder = _get_embedder()
            for i, txt in enumerate(texts):
                doc_id = f"{source_type}_{item_id}_{i}"
                meta = {
                    'source_type': source_type,
                    'item_id': str(item_id),
                    'title': title[:200],
                    'url': url[:300],
                    'author': author[:50],
                    'created_at': str(created_at or ''),
                    'chunk_index': i
                }
                emb = embedder.encode(txt).tolist()
                col.upsert(ids=[doc_id], embeddings=[emb], metadatas=[meta], documents=[txt])
            return True
        except Exception as e:
            print(f"[RAG INDEX] error: {e}")
            return False

def remove_item(source_type, item_id):
    with _lock:
        try:
            col = _get_collection()
            col.delete(where={'source_type': source_type, 'item_id': str(item_id)})
            return True
        except Exception as e:
            print(f"[RAG REMOVE] error: {e}")
            return False

def remove_by_source(source_type):
    with _lock:
        try:
            col = _get_collection()
            col.delete(where={'source_type': source_type})
            return True
        except Exception as e:
            print(f"[RAG REMOVE_BY_SOURCE] error: {e}")
            return False

def search(query, top_k=5, source_type=None):
    try:
        col = _get_collection()
        embedder = _get_embedder()
        q_emb = embedder.encode(query).tolist()
        where = {'source_type': source_type} if source_type else None
        results = col.query(query_embeddings=[q_emb], n_results=top_k, where=where)
        hits = []
        if results['ids'] and results['ids'][0]:
            for i in range(len(results['ids'][0])):
                hits.append({
                    'id': results['ids'][0][i],
                    'score': results['distances'][0][i] if results['distances'] else 0,
                    'title': results['metadatas'][0][i].get('title', ''),
                    'source_type': results['metadatas'][0][i].get('source_type', ''),
                    'item_id': results['metadatas'][0][i].get('item_id', ''),
                    'text': results['documents'][0][i][:300],
                    'url': results['metadatas'][0][i].get('url', ''),
                    'author': results['metadatas'][0][i].get('author', ''),
                })
        return hits
    except Exception as e:
        print(f"[RAG SEARCH] error: {e}")
        return []

def rebuild_index(db_url=None):
    with _lock:
        try:
            col = _get_collection()
            col.delete(where={})
        except:
            pass

        if not db_url:
            print("[RAG REBUILD] no db_url provided, skipping")
            return

        from sqlalchemy import create_engine, text
        from sqlalchemy.orm import Session

        engine = create_engine(db_url)
        with Session(engine) as session:
            posts = session.execute(text("SELECT id, title, content, author_name, created_at FROM post")).fetchall()
            for p in posts:
                index_item(p[0], p[1] or '', p[2] or '', 'post',
                           url=f"/post/{p[0]}", author=p[3] or '', created_at=str(p[4]))

            articles = session.execute(text("SELECT id, title, summary, created_at FROM news_article")).fetchall()
            for a in articles:
                index_item(a[0], a[1] or '', a[2] or '', 'news',
                           url=f"/news/{a[0]}", created_at=str(a[3]))

            shares = session.execute(text("SELECT id, title, description, author_name, created_at FROM share_report WHERE status='approved'")).fetchall()
            for s in shares:
                index_item(s[0], s[1] or '', s[2] or '', 'share',
                           url=f"/share/detail/{s[0]}", author=s[3] or '', created_at=str(s[4]))

            legals = session.execute(text("SELECT id, title, content, author_name, created_at FROM legal_post WHERE is_public=true")).fetchall()
            for l in legals:
                index_item(l[0], l[1] or '', l[2] or '', 'legal',
                           url=f"/legal/detail/{l[0]}", author=l[3] or '', created_at=str(l[4]))

            psychos = session.execute(text("SELECT id, title, content, author_name, created_at FROM psycho_post WHERE is_public=true")).fetchall()
            for p in psychos:
                index_item(p[0], p[1] or '', p[2] or '', 'psycho',
                           url=f"/psycho/detail/{p[0]}", author=p[3] or '', created_at=str(p[4]))

            print(f"[RAG] 인덱스 재구축 완료: posts={len(posts)}, news={len(articles)}, shares={len(shares)}, legal={len(legals)}, psycho={len(psychos)}")

        _index_terms_and_charter()

def _index_terms_and_charter():
    try:
        import re
        base = os.path.dirname(os.path.abspath(__file__))
        terms_path = os.path.join(base, '..', 'templates', 'terms.html')
        charter_path = os.path.join(base, '..', 'charter.md')
        if os.path.exists(terms_path):
            with open(terms_path, 'r', encoding='utf-8') as f:
                html = f.read()
            text = re.sub(r'<[^>]+>', '', html)
            text = re.sub(r'\s+', ' ', text).strip()
            if text:
                index_item('main', '회원약관', text, 'terms', url='/terms')
        if os.path.exists(charter_path):
            with open(charter_path, 'r', encoding='utf-8') as f:
                md = f.read()
            if md.strip():
                index_item('main', '사회적협동조합 정관', md, 'charter', url='/charter')
        print(f"[RAG] 약관/정관 인덱싱 완료")
    except Exception as e:
        print(f"[RAG] 약관/정관 인덱싱 실패: {e}")
