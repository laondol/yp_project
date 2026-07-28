import os
import requests

RAG_URL = os.getenv('RAG_URL', 'http://localhost:8001')
RAG_API_KEY = os.getenv('RAG_API_KEY', '')
TIMEOUT = 10

def _headers():
    h = {'Content-Type': 'application/json'}
    if RAG_API_KEY:
        h['Authorization'] = f'Bearer {RAG_API_KEY}'
    return h

def remove_by_source(source_type):
    try:
        resp = requests.delete(f'{RAG_URL}/source/{source_type}', headers=_headers(), timeout=TIMEOUT)
        resp.raise_for_status()
    except Exception as e:
        print(f"[RAG REMOVE] error: {e}")

def search(query, top_k=5, source_type=None):
    try:
        payload = {'query': query, 'top_k': top_k}
        if source_type:
            payload['source_type'] = source_type
        resp = requests.post(f'{RAG_URL}/search', json=payload, headers=_headers(), timeout=TIMEOUT)
        resp.raise_for_status()
        return resp.json().get('hits', [])
    except Exception as e:
        print(f"[RAG SEARCH] error: {e}")
        return []

def build_context(query, top_k=3):
    hits = search(query, top_k=top_k)
    if not hits:
        return ""
    lines = []
    for h in hits:
        lines.append(f"[{h.get('source_type', '')}] {h.get('title', '')} (작성자: {h.get('author', 'N/A')})")
        lines.append(h.get('text', ''))
        lines.append("---")
    return "\n".join(lines)

def rebuild_index(app=None):
    try:
        resp = requests.post(f'{RAG_URL}/rebuild', headers=_headers(), timeout=120)
        resp.raise_for_status()
        print(f"[RAG] 인덱스 재구축 요청 완료: {resp.json()}")
    except Exception as e:
        print(f"[RAG REBUILD] error: {e}")

def index_item(item_id, title, content, source_type, url='', author='', created_at=''):
    try:
        payload = {
            'item_id': item_id,
            'title': title,
            'content': content,
            'source_type': source_type,
            'url': url,
            'author': author,
            'created_at': created_at,
        }
        resp = requests.post(f'{RAG_URL}/index', json=payload, headers=_headers(), timeout=TIMEOUT)
        resp.raise_for_status()
    except Exception as e:
        print(f"[RAG INDEX] error: {e}")

def remove_item(source_type, item_id):
    try:
        resp = requests.delete(f'{RAG_URL}/item/{source_type}/{item_id}', headers=_headers(), timeout=TIMEOUT)
        resp.raise_for_status()
    except Exception as e:
        print(f"[RAG REMOVE] error: {e}")

def index_terms_and_charter(app=None):
    try:
        import re
        base = os.path.dirname(os.path.dirname(__file__))
        terms_path = os.path.join(base, 'templates', 'terms.html')
        charter_path = os.path.join(base, 'charter.md')
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
