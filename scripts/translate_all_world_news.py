#!/usr/bin/env python
"""영문 세계뉴스 한글 번역 (일회성)"""
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
            NewsArticle.category == '세계뉴스'
        ).order_by(NewsArticle.id.asc()).all()
        total = len(articles)
        count = 0
        skip = 0
        errors = 0
        for i, a in enumerate(articles):
            title_text = a.title or ''
            eng_chars = sum(1 for c in title_text if c.isascii() and c.isalpha())
            total_chars = sum(1 for c in title_text if c.isalpha())
            if total_chars == 0 or eng_chars / total_chars < 0.5:
                skip += 1
                continue
            try:
                result = ai_translate_and_format(a.title, a.content or a.summary or '')
                if result and isinstance(result, dict):
                    if result.get('title'): a.title = result['title']
                    if result.get('summary'): a.summary = result['summary'][:200]
                    if result.get('content'): a.content = result['content'][:1000]
                    a.updated_at = datetime.now()
                    count += 1
                    log.info(f'[{i+1}/{total}] #{a.id} OK: {a.title[:50]}')
                time.sleep(2)
            except Exception as e:
                errors += 1
                log.warning(f'[{i+1}/{total}] #{a.id} ERR: {str(e)[:50]}')
                time.sleep(3)
        db.session.commit()
        log.info(f'완료: 번역 {count}건, 건너뜀 {skip}건, 실패 {errors}건')
        with open('/tmp/translate_all_done.json', 'w') as f:
            json.dump({'count': count, 'skip': skip, 'errors': errors}, f)

if __name__ == '__main__':
    main()
