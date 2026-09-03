#!/usr/bin/env python
"""영문 뉴스 한글 번역 (일회성) - 세계와양평 전체 카테고리 대상"""
import sys, os, time, json, logging
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger(__name__)

from run import create_app

WORLD_CATS = ['세계뉴스', '환경뉴스', '건강정보', '복지정보', '농업정보', '관광소식']
ENG_THRESHOLD = 0.0  # 세계뉴스는 전체 번역, 기타 카테고리는 영문 비율 0.3 이상

def is_english_title(title):
    """제목이 번역이 필요한 영문인지 판단"""
    if not title:
        return False
    eng_chars = sum(1 for c in title if c.isascii() and c.isalpha())
    total_chars = sum(1 for c in title if c.isalpha())
    if total_chars == 0:
        return False
    ratio = eng_chars / total_chars
    return ratio >= ENG_THRESHOLD

def main():
    app = create_app()
    with app.app_context():
        from services.news_service import ai_translate_and_format
        from models import NewsArticle, db
        from datetime import datetime

        articles = NewsArticle.query.filter(
            NewsArticle.category.in_(WORLD_CATS)
        ).order_by(NewsArticle.id.asc()).all()
        total = len(articles)
        count = 0
        skip = 0
        errors = []
        report = {'total': total, 'translated': 0, 'skipped': 0, 'errors': [], 'details': []}

        log.info(f'전체 대상: {total}건 (카테고리: {", ".join(WORLD_CATS)})')

        for i, a in enumerate(articles):
            title_text = a.title or ''
            if not is_english_title(title_text):
                skip += 1
                report['skipped'] += 1
                continue

            try:
                result = ai_translate_and_format(a.title, a.content or a.summary or '')
                if result and isinstance(result, dict):
                    new_title = result.get('title', '')
                    new_summary = result.get('summary', '')
                    new_content = result.get('content', '')
                    if new_title:
                        a.title = new_title
                    if new_summary:
                        a.summary = new_summary[:200]
                    if new_content:
                        a.content = new_content[:1000]
                    a.updated_at = datetime.now()
                    db.session.commit()
                    count += 1
                    report['translated'] += 1
                    report['details'].append({'id': a.id, 'category': a.category, 'title': a.title[:60], 'status': 'ok'})
                    log.info(f'[{i+1}/{total}] #{a.id} [{a.category}] OK: {a.title[:50]}')
                time.sleep(1)
            except Exception as e:
                err_msg = str(e)[:80]
                errors.append(f'#{a.id}: {err_msg}')
                report['errors'].append({'id': a.id, 'category': a.category, 'error': err_msg})
                report['details'].append({'id': a.id, 'category': a.category, 'title': title_text[:60], 'status': 'error', 'error': err_msg})
                log.warning(f'[{i+1}/{total}] #{a.id} [{a.category}] ERR: {err_msg}')
                time.sleep(2)

        report_path = '/tmp/translate_report.json'
        with open(report_path, 'w') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

        log.info(f'완료: 번역 {count}건, 건너뜀 {skip}건, 실패 {len(errors)}건')
        log.info(f'리포트: {report_path}')

        if errors:
            log.warning('실패 목록:')
            for e in errors:
                log.warning(f'  {e}')

if __name__ == '__main__':
    main()
