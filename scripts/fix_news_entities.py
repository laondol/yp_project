#!/usr/bin/env python3
"""뉴스 제목·요약의 HTML 엔티티(&quot; 등) 일괄 복원

원인: 네이버 검색 API가 HTML 이스케이프된 제목/요약을 반환하는데
수집기(labor_news_collector)가 태그 제거 후 html.unescape를 하지 않아
'&quot;...'가 문자열 그대로 DB에 저장 → 화면에 &quot 로 노출.
수집기는 이미 _clean_text()로 수정됨. 본 스크립트는 기존 적재분 정리용.

대상: news_article.title/summary, labor_news_article.title/summary
(content은 HTML 렌더 필드이며 이중 이스케이프 0건 확인 — 제외)

사용법 (컨테이너 안에서):
  # 1) 진단만 (데이터 변경 없음)
  docker exec -i yp_flask python3 /yp_project/scripts/fix_news_entities.py
  # 2) 적용
  docker exec -i yp_flask python3 /yp_project/scripts/fix_news_entities.py --apply
"""
import sys
import html
import logging

if '__file__' in globals():
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
else:
    import os
    _base = '/yp_project' if os.path.isdir('/yp_project') else os.getcwd()
    os.chdir(_base)
    sys.path.insert(0, _base)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger(__name__)

ENTITY_PATTERNS = ['%&quot%', '%&amp%', '%&lt%', '%&gt%', '%&#39%', '%&#34%', '%&nbsp%']


def _fix_value(v):
    """2회 unescape (이중 이스케이프까지 정리) — 안전: 태그 없음(제목/요약)"""
    v = html.unescape(v or '')
    v = html.unescape(v)
    return v


def main():
    apply = '--apply' in sys.argv
    from run import create_app
    from models import db, NewsArticle, LaborNewsArticle

    app = create_app()
    total = 0
    with app.app_context():
        for model, name in ((NewsArticle, 'news_article'),
                            (LaborNewsArticle, 'labor_news_article')):
            from sqlalchemy import or_
            conds = []
            for col in ('title', 'summary'):
                for pat in ENTITY_PATTERNS:
                    conds.append(getattr(model, col).like(pat))
            rows = model.query.filter(or_(*conds)).all()
            fixed = 0
            for r in rows:
                changed = False
                for col in ('title', 'summary'):
                    old = getattr(r, col)
                    if not old:
                        continue
                    new = _fix_value(old)
                    if new != old:
                        setattr(r, col, new)
                        changed = True
                if changed:
                    fixed += 1
            log.info('%s: %d행 정리 대상', name, len(rows))
            if apply and fixed:
                db.session.commit()
                log.info('%s: %d행 적용 완료', name, fixed)
            elif apply:
                log.info('%s: 변경 없음', name)
            total += fixed
            if not apply:
                db.session.rollback()

    if not apply:
        log.info('진단만 수행 (--apply 시 적용). 대상 %d행', total)
    else:
        log.info('완료: 총 %d행 적용', total)


if __name__ == '__main__':
    main()
