#!/usr/bin/env python
"""영문 뉴스 한글 번역 (일회성) - 세계와양평 전체 카테고리 대상
재실행 시 이미 번역된 기사는 자동 건너뜀 (영문 비율 0.3 미만)"""
import sys, os, time, json, logging, signal
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger(__name__)

from run import create_app

WORLD_CATS = ['세계뉴스', '환경뉴스', '건강정보', '복지정보', '농업정보', '관광소식']
ENG_THRESHOLD = 0.3

interrupted = False

def handle_signal(sig, frame):
    global interrupted
    interrupted = True
    log.warning('중단 요청됨 (Ctrl+C). 현재 기사 처리 완료 후 종료합니다...')

signal.signal(signal.SIGINT, handle_signal)
signal.signal(signal.SIGTERM, handle_signal)

def is_english_title(title):
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

        need_translate = []
        already_done = 0
        for a in articles:
            if is_english_title(a.title or ''):
                need_translate.append(a)
            else:
                already_done += 1

        log.info(f'전체: {total}건 | 이미 번역됨: {already_done}건 | 번역 필요: {len(need_translate)}건')

        if not need_translate:
            log.info('번역할 기사가 없습니다. 모두 완료!')
            return

        count = 0
        errors = []
        for i, a in enumerate(need_translate):
            if interrupted:
                log.warning(f'중단됨. {i}/{len(need_translate)} 완료 (이번 실행 번역: {count}건)')
                break
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
                    log.info(f'[{i+1}/{len(need_translate)}] #{a.id} [{a.category}] OK: {a.title[:50]}')
                time.sleep(1)
            except Exception as e:
                err_msg = str(e)[:80]
                errors.append(f'#{a.id}: {err_msg}')
                log.warning(f'[{i+1}/{len(need_translate)}] #{a.id} [{a.category}] ERR: {err_msg}')
                time.sleep(2)

        log.info(f'이번 실행: 번역 {count}건, 실패 {len(errors)}건')
        if errors:
            log.warning('실패 목록:')
            for e in errors:
                log.warning(f'  {e}')
        log.info('다시 실행하면 미번역 기사만 이어서 번역됩니다.')

if __name__ == '__main__':
    main()
