"""뉴스 게시 정책 1회 적용 스크립트 (서버/로컬 공통)

- 경기도 -> 경기도뉴스포털 이름 변경
- 대한민국과양평 기사 분류를 '지역 주제'(예: 양평 돌봄)로 재태깅
- 네이버 수집분은 수집만 하고 게시 제외(관리자 전용)
- 양평·인접 시군(여주·광주시·하남·남양주·가평) 관련 기사만 게시 유지

사용:
    docker exec -i yp_flask python3 scripts/apply_news_scope_policy.py
"""
import sys

sys.path.insert(0, '/yp_project')

from run import app
from models import db, NewsArticle, NewsSource
from services.labor_news_collector import (
    _kr_category, is_kr_category, LOCAL_REGION_KEYWORDS,
)

YANGPYEONG_ONLY = ('양평백운신문', '양평시민의소리', 'YPN뉴스')


def main():
    with app.app_context():
        # 1) 출처 이름 변경
        renamed_src = 0
        for row in NewsSource.query.filter(NewsSource.name == '경기도').all():
            row.name = '경기도뉴스포털'
            renamed_src += 1
        renamed_art = 0
        for a in NewsArticle.query.filter(NewsArticle.source_name == '경기도').all():
            a.source_name = '경기도뉴스포털'
            renamed_art += 1

        # 2) 분류 재태깅 + 3) 네이버 게시 제외
        retagged = 0
        naver_hidden = 0
        for a in NewsArticle.query.all():
            if is_kr_category(a.category):
                cat = _kr_category(a.title or '', a.summary or '')
                if cat != a.category:
                    a.category = cat
                    retagged += 1
            if a.source_name == '네이버' or (a.ai_reason or '').startswith('자동수집(네이버'):
                if a.is_selected or a.kr_yp_admin_approved:
                    naver_hidden += 1
                a.is_selected = False
                a.kr_yp_admin_approved = False
                a.world_admin_approved = False

        # 4) 양평·인접 시군 외 기사 게시 제외
        unpublished = 0
        q = NewsArticle.query.filter(NewsArticle.is_selected == True)
        for a in q.all():
            if not is_kr_category(a.category):
                continue
            if a.source_name in YANGPYEONG_ONLY:
                continue
            text = f"{a.title or ''} {a.summary or ''}"
            if any(k in text for k in LOCAL_REGION_KEYWORDS):
                continue
            a.is_selected = False
            a.kr_yp_admin_approved = False
            unpublished += 1

        db.session.commit()

        print(f"출처 이름 변경: {renamed_src}건 (기사 {renamed_art}건)")
        print(f"분류 재태깅: {retagged}건")
        print(f"네이버 게시 제외: {naver_hidden}건")
        print(f"양평·인접 외 게시 제외: {unpublished}건")
        print(f"현재 게시중: {NewsArticle.query.filter(NewsArticle.is_selected == True).count()}건")


if __name__ == '__main__':
    main()
