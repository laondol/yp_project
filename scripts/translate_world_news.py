#!/usr/bin/env python
"""194번 이후 세계뉴스 영문 기사를 한글로 번역하는 일회성 스크립트"""
import sys, os, time, json, logging
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger(__name__)

from run import create_app
from models import NewsArticle, db
from datetime import datetime

def main():
    app = create_app()
    with app.app_context():
        from services.news_service import ai_translate_and_format

        articles = NewsArticle.query.filter(
            NewsArticle.id >= 194,
            NewsArticle.category == '세계뉴스'
        ).order_by(NewsArticle.id.asc()).all()
        total = len(articles)
        log.info(f'번역 대상: {total}건')

        count = 0
        errors = []
        for i, a in enumerate(articles):
            try:
                title_text = a.title or ''
                eng_chars = sum(1 for c in title_text if c.isascii() and c.isalpha())
                total_chars = sum(1 for c in title_text if c.isalpha())
                if total_chars > 0 and eng_chars / total_chars < 0.5:
                    log.info(f'  [{i+1}/{total}] #{a.id} 이미 한글 - 건너뜀')
                    continue

                result = ai_translate_and_format(a.title, a.content or a.summary or '')
                if result and isinstance(result, dict):
                    new_title = result.get('title', '')
                    new_summary = result.get('summary', '')
                    new_content = result.get('content', '')
                    if new_title:
                        a.title = new_title
                    if new_summary:
                        a.summary = new_summary
                    if new_content:
                        a.content = new_content
                    a.updated_at = datetime.now()
                    count += 1
                    log.info(f'  [{i+1}/{total}] #{a.id} OK: {new_title[:50]}')

                time.sleep(1)
            except Exception as e:
                errors.append(f'#{a.id}: {str(e)[:80]}')
                log.warning(f'  [{i+1}/{total}] #{a.id} ERR: {str(e)[:80]}')
                time.sleep(2)

        db.session.commit()
        log.info(f'완료: {count}/{total}건 번역, 실패: {len(errors)}건')
        if errors:
            for e in errors:
                log.warning(f'  실패: {e}')

        with open('/tmp/translate_result.json', 'w') as f:
            json.dump({'count': count, 'total': total, 'errors': errors}, f, ensure_ascii=False)

if __name__ == '__main__':
    main()
