"""
기존 편지(content)에 들어있는 파일첨부 링크를
  <a href="/files/UUID" target="_blank" rel="noopener noreferrer" download style="...">📎 이름</a>
에서
  <a href="/files/UUID" rel="noopener noreferrer" download="이름" style="...">📎 이름</a>
로 한 번에 치환합니다.

효과: 기존에 받은 편지의 첨부도 '원래 파일명'으로 다운로드됨.
(frontend ContentEditor가 새로 보내는 편지는 이미 download="이름" 형태로 저장됨)

실행:
  docker compose exec yp_flask python scripts/fix_message_attachment_download.py
"""
import re
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from run import create_app
from models import db, Message

# 기존 링크 형태: download 뒤에 값이 없고, 그 다음 style="..." 이 올 수 있음
PAT = re.compile(
    r'<a\s+href="(/files/[^"]+)"[^>]*?\sdownload(?:\s+style="([^"]*)")?[^>]*>(📎.*?)</a>'
)

DEFAULT_STYLE = (
    'display:inline-block;padding:6px 10px;border:1px solid #dee2e6;'
    'border-radius:8px;background:#f8f9fa;color:#198754;text-decoration:none;font-size:0.9rem;'
)


def _safe_attr(s: str) -> str:
    return s.replace('"', '&quot;').replace("'", '&apos;').strip()


def fix(html: str) -> str:
    if not html:
        return html

    def repl(m):
        url = m.group(1)
        style = m.group(2) or DEFAULT_STYLE
        text = m.group(3) or ''
        raw = text.split('📎', 1)[1] if '📎' in text else text
        name = re.sub(r'<[^>]+>', '', raw).strip()
        name_attr = _safe_attr(name)
        return (
            f'<a href="{url}" rel="noopener noreferrer" download="{name_attr}" '
            f'style="{style}">📎 {name}</a>'
        )

    return PAT.sub(repl, html)


def main():
    app = create_app()
    with app.app_context():
        rows = Message.query.filter(Message.content.like('%download%')).all()
        updated = 0
        for msg in rows:
            new_html = fix(msg.content)
            if new_html != msg.content:
                msg.content = new_html
                updated += 1
        db.session.commit()
        print(f'[done] checked={len(rows)} updated={updated}')


if __name__ == '__main__':
    main()
