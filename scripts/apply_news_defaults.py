"""뉴스 기본 정책 적용: AP 수집 중지 + 전체 기사 기본 채택/게재

사용 (서버):
    docker exec -i yp_flask python3 scripts/apply_news_defaults.py
"""
import sys

sys.path.insert(0, '/yp_project')

from run import app
from models import db, NewsArticle, NewsSource

WORLD = {'미국','중국','러시아','영국','프랑스','동남아시아','중앙아시아','일본','북유럽','서유럽',
         '남아프리카','북아프리카','동유럽','남유럽','호주','UN','유네스코','중동','캐나다','중남미',
         '세계뉴스','환경뉴스','건강정보','복지정보','농업정보','관광소식'}


def main():
    with app.app_context():
        # AP 소스 사용 중지 (기사는 유지)
        disabled = 0
        for s in NewsSource.query.filter_by(name='AP').all():
            if s.enabled:
                s.enabled = False
                disabled += 1

        # 전체 기사 기본 채택/게재
        approved = 0
        for a in NewsArticle.query.all():
            a.is_selected = True
            if a.category in WORLD:
                a.world_admin_approved = True
            else:
                a.kr_yp_admin_approved = True
            approved += 1

        db.session.commit()
        print(f'AP 소스 중지: {disabled}건')
        print(f'전체 채택/게재: {approved}건')
        print('현재 게재중:', NewsArticle.query.filter(NewsArticle.is_selected == True).count())


if __name__ == '__main__':
    main()
