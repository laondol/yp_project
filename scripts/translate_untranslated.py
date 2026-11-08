"""미번역 뉴스 기사 제목·요약 일괄 번역 (삭제 없음)

사용:
    docker exec -i yp_flask python scripts/translate_untranslated.py

- 1차: ai_translate_and_format (Groq)
- 실패 시: Gemini 직접 호출
- 실패 사유를 출력하므로 원인 파악 가능
"""
import re
import sys

sys.path.insert(0, '/yp_project')

from run import app
from models import db, NewsArticle
from services.news_service import ai_translate_and_format, _motif_text


def needs_translation(text):
    t = text or ''
    if '[미번역]' in t:
        return True
    letters = [c for c in t if c.isalpha()]
    if not letters:
        return False
    hangul = sum(1 for c in letters if '\uac00' <= c <= '\ud7a3')
    return (hangul / len(letters)) < 0.3


def translate_with_fallback(title_body, content):
    tr = ai_translate_and_format(title_body, content or '')
    if isinstance(tr, dict) and tr.get('title'):
        return tr, 'groq'
    prompt = (
        '다음 기사 제목과 내용을 한국어 격식체로 번역해 JSON으로만 답하세요.\n'
        '출력: {"title": "번역된 제목", "summary": "한국어 2줄 요약"}\n'
        f'제목: {title_body}\n내용: {(content or "")[:1500]}'
    )
    r = _motif_text('당신은 전문 번역가입니다. 한국어로만 답합니다.',
                    prompt, format_json=True, provider='gemini')
    if isinstance(r, dict) and r.get('title'):
        return r, 'gemini'
    return None, 'fail'


def main():
    with app.app_context():
        rows = [a for a in NewsArticle.query.all()
                if needs_translation(a.title) or needs_translation(a.summary)]
        print(f'번역 대상: {len(rows)}건', flush=True)
        ok = 0
        failed = []
        for a in rows:
            m = re.match(r'^(\[[^\]]+\]\s*)', a.title or '')
            prefix = m.group(1) if m else ''
            body = (a.title or '')[len(prefix):]
            try:
                tr, via = translate_with_fallback(body, a.summary or '')
            except Exception as e:
                tr, via = None, f'error:{type(e).__name__}'
            if tr:
                a.title = prefix + str(tr['title']).replace('[미번역]', '').strip()
                if tr.get('summary'):
                    a.summary = str(tr['summary'])[:500]
                ok += 1
                print(f'OK [{via}] {a.id} {a.title[:50]}', flush=True)
            else:
                failed.append(a.id)
                print(f'FAIL [{via}] {a.id} {(a.title or "")[:60]}', flush=True)
            db.session.commit()
        print(f'완료: {ok}/{len(rows)}', flush=True)
        if failed:
            print('실패 ID:', failed, flush=True)


if __name__ == '__main__':
    main()
