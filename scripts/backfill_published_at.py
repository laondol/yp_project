"""발행일(published_at) 없는 기사 백필 + 재채점 대상 초기화

사용 (서버):
    docker exec -i yp_flask python3 scripts/backfill_published_at.py [--limit N]

- 제목으로 네이버 뉴스를 조회해 실제 발행일 저장
- 발행일을 찾은 기사는 ai_score=0 으로 초기화 → 다음 AI 채점에서 재평가
"""
import re
import sys

sys.path.insert(0, '/yp_project')

from run import app
from models import db, NewsArticle
from services.labor_news_collector import _naver_verify_pubdate, _pub_naive


def main():
    limit = None
    for i, a in enumerate(sys.argv):
        if a == '--limit' and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])

    with app.app_context():
        rows = NewsArticle.query.filter(NewsArticle.published_at.is_(None)).all()
        if limit:
            rows = rows[:limit]
        print(f'대상: {len(rows)}건', flush=True)
        filled = 0
        for i, a in enumerate(rows, 1):
            title = re.sub(r'^\[[^\]]+\]\s*', '', a.title or '')
            d = _naver_verify_pubdate(title)
            if d is None:
                continue
            a.published_at = _pub_naive(d.strftime('%a, %d %b %Y %H:%M:%S %z')) if d.tzinfo else d
            a.ai_score = 0          # 재채점 대상으로
            a.is_selected = False
            filled += 1
            if filled % 20 == 0:
                db.session.commit()
                print(f'  ...{filled}건 채움', flush=True)
        db.session.commit()
        print(f'완료: 발행일 채움 {filled}/{len(rows)}건', flush=True)
        print('남은 발행일 없음:', NewsArticle.query.filter(NewsArticle.published_at.is_(None)).count())


if __name__ == '__main__':
    main()
