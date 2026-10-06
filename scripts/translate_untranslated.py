#!/usr/bin/env python3
"""미번역 뉴스 일괄 재번역 (Groq 소식번역 전용)

대상 (아래 어느 하나라도 해당하면 번역):
  1) 제목에 [미번역] 태그가 있는 기사
  2) 태그는 없지만 제목이 한글 없이 영문·중국어만 있는 구시대 잔재
  3) 본문이 한글 없이 영문·중국어만 있는 기사
  4) 제목·본문은 한글인데 요약(summary)만 영문·중국어 → 요약만 번역

사용법 (WSL / 서버, 컨테이너 안에서):
  docker exec -i yp_flask python3 /yp_project/scripts/translate_untranslated.py
  docker exec -i yp_flask python3 /yp_project/scripts/translate_untranslated.py --limit 10
  docker exec -i yp_flask python3 /yp_project/scripts/translate_untranslated.py --sleep 5

옵션:
  --limit N   최대 N건만 처리 (기본: 전체)
  --sleep S   건당 대기초, 기본 5초 (Groq 429 대비)
"""
import os
import re
import sys
import time
import logging

if '__file__' in globals():
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
else:
    _base = '/yp_project' if os.path.isdir('/yp_project') else os.getcwd()
    os.chdir(_base)
    sys.path.insert(0, _base)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger(__name__)


def _foreign(text):
    """한글이 전혀 없고 영문/중국어가 많은 텍스트 → 미번역으로 판단"""
    if not text:
        return False
    hangul = len(re.findall(r'[가-힣]', text))
    latin = len(re.findall(r'[A-Za-z]', text))
    cjk = len(re.findall(r'[一-鿿]', text))
    return hangul == 0 and (latin >= 20 or cjk >= 5)


def _classify(a):
    """기사별 처리 유형 분류 → ('tag'|'full'|'summary'|None, 프리픽스, 정제된 제목)"""
    title = a.title or ''
    is_tag = '[미번역]' in title
    if is_tag:
        prefix = title.split('[미번역]')[0]
        clean = title.split('[미번역]', 1)[-1].strip()
        return 'tag', prefix, clean
    m = re.match(r'^(\[[^\]]+\]\s*)+', title)
    prefix = m.group(1) if m else ''
    clean = title[m.end():] if m else title
    if _foreign(clean):
        return 'full', prefix, clean
    if _foreign(a.content or ''):
        return 'full', prefix, ''
    if _foreign(a.summary or ''):
        return 'summary', prefix, ''
    return None, prefix, ''


def _translate(ai, clean_title, body, src, attempts=3):
    """3회 재시도하며 번역, 성공 시 dict / 실패 시 None"""
    result = None
    for attempt in range(attempts):
        result = ai(clean_title, body, source_lang=src)
        if result and isinstance(result, dict) and result.get('title'):
            return result
        result = None
        wait = 10 * (attempt + 1)
        log.info('    재시도 %d/%d (%d초 대기)', attempt + 1, attempts, wait)
        time.sleep(wait)
    return result


def parse_args():
    limit, sleep_s = None, 5.0
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == '--limit' and i + 1 < len(args):
            limit = int(args[i + 1]); i += 2
        elif args[i] == '--sleep' and i + 1 < len(args):
            sleep_s = float(args[i + 1]); i += 2
        else:
            log.info('무시된 인자: %s', args[i]); i += 1
    return limit, sleep_s


def main():
    limit, sleep_s = parse_args()
    from run import create_app
    from models import NewsArticle, db
    from datetime import datetime

    app = create_app()
    with app.app_context():
        from services.news_service import ai_translate_and_format

        all_arts = NewsArticle.query.order_by(NewsArticle.id.asc()).all()
        targets = []
        for a in all_arts:
            kind, _, _ = _classify(a)
            if kind:
                targets.append((a, kind))
        if limit:
            targets = targets[:limit]
        total = len(targets)
        log.info('미번역 대상: %d건 (sleep=%.1fs)', total, sleep_s)
        if total == 0:
            log.info('처리할 항목이 없습니다.')
            return

        ok, fail, errors = 0, 0, []
        for i, (a, kind) in enumerate(targets):
            raw_title = a.title or ''
            _, prefix, clean_title = _classify(a)
            src_body = (a.content or a.summary or '')[:300] + clean_title
            src = 'zh' if (len(re.findall(r'[一-鿿]', src_body)) >
                           len(re.findall(r'[A-Za-z]', src_body))) else 'en'
            try:
                if kind == 'summary':
                    # 제목·본문은 한글 → 요약만 재생성 (기존 한글 본문은 보존)
                    result = _translate(ai_translate_and_format, raw_title,
                                        a.summary or '', src)
                    if result:
                        new_sum = (result.get('summary') or result.get('content') or '')
                        new_sum = re.sub(r'<[^>]+>', '', new_sum).strip()
                        if new_sum:
                            a.summary = new_sum[:200]
                            a.updated_at = datetime.now()
                            ok += 1
                            log.info('  [%d/%d] #%d OK(요약만): %s',
                                     i + 1, total, a.id, a.title[:60])
                else:
                    result = _translate(ai_translate_and_format, clean_title,
                                        a.content or a.summary or '', src)
                    if result and result.get('title'):
                        a.title = f"{prefix}{result['title'].replace('[미번역] ', '')}"
                        if result.get('summary'):
                            a.summary = result['summary'][:200]
                        if result.get('content'):
                            a.content = result['content'][:1000]
                        a.updated_at = datetime.now()
                        ok += 1
                        log.info('  [%d/%d] #%d OK: %s',
                                 i + 1, total, a.id, a.title[:60])
                if ok:
                    # 건별 즉시 커밋 → 이후 예외 롤백이 완료건을 소실하지 않도록
                    db.session.commit()
                if not result:
                    fail += 1
                    errors.append(f'#{a.id}: {(clean_title or raw_title)[:50]}')
                    log.info('  [%d/%d] #%d 실패: %s',
                             i + 1, total, a.id, (clean_title or raw_title)[:50])
                time.sleep(sleep_s)
            except Exception as e:
                fail += 1
                errors.append(f'#{a.id}: {str(e)[:60]}')
                log.info('  [%d/%d] #%d 오류: %s', i + 1, total, a.id, str(e)[:80])
                try:
                    db.session.rollback()
                except Exception:
                    pass
                time.sleep(sleep_s)

        db.session.commit()

        def _remain(a):
            kind, _, _ = _classify(a)
            return kind is not None
        remain = sum(1 for a in NewsArticle.query.all() if _remain(a))
        log.info('완료: 성공 %d / 실패 %d / 전체 %d (남은 미번역 %d건)',
                 ok, fail, total, remain)
        if errors:
            log.info('실패 목록:')
            for e in errors:
                log.info('  - %s', e)
        if remain:
            log.info('남은 건은 동일 명령으로 재실행하면 이어서 처리됩니다.')


if __name__ == '__main__':
    main()
