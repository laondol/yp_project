"""뉴스 게재 정책 적용: AI 60점 이상만 자동 게재, 미만은 관리자 확인 후 게재

사용 (서버):
    docker exec -i yp_flask python3 scripts/apply_publish_policy.py
"""
import sys

sys.path.insert(0, '/yp_project')

from run import app
from models import db, NewsArticle
from sqlalchemy import or_

WORLD = {'미국','중국','러시아','영국','프랑스','동남아시아','중앙아시아','일본','북유럽','서유럽',
         '남아프리카','북아프리카','동유럽','남유럽','호주','UN','유네스코','중동','캐나다','중남미',
         '세계뉴스','환경뉴스','건강정보','복지정보','농업정보','관광소식'}


def main():
    with app.app_context():
        low = NewsArticle.query.filter(
            NewsArticle.is_ai_generated == True,
            or_(NewsArticle.ai_score < 60, NewsArticle.ai_score.is_(None))
        )
        n_low = 0
        for a in low.all():
            a.is_selected = False
            a.world_admin_approved = False
            a.kr_yp_admin_approved = False
            n_low += 1

        # 발행일 없는 기사: 50점 상한 + 미게재
        n_nodate = 0
        for a in NewsArticle.query.filter(NewsArticle.published_at.is_(None)).all():
            a.ai_score = min((a.ai_score or 0), 50)
            a.is_selected = False
            a.world_admin_approved = False
            a.kr_yp_admin_approved = False
            n_nodate += 1

        high = NewsArticle.query.filter(NewsArticle.ai_score >= 60, NewsArticle.published_at.isnot(None)).all()
        n_high = 0
        for a in high:
            a.is_selected = True
            if a.category in WORLD:
                a.world_admin_approved = True
            else:
                a.kr_yp_admin_approved = True
            n_high += 1

        db.session.commit()
        print(f'미게재(60점 미만): {n_low}건 / 발행일없음(50점·미게재): {n_nodate}건 / 자동게재: {n_high}건')
        print('현재 게재중:', NewsArticle.query.filter(NewsArticle.is_selected == True).count())


if __name__ == '__main__':
    main()
