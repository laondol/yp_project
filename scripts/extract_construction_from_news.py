#!/usr/bin/env python
"""기사 #290의 공사현안을 위치기반안내 > 건축공사에 등록 + 기사 본문에 현안 목록 추가 (일회성)"""
import sys, os, requests
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from run import create_app
from models import db, ConstructionNotice, NewsArticle
from datetime import datetime

# 웹검색으로 분석 완료된 기사 #290 원문의 공사현안 목록 (경기도의회 건설교통위원회 점검)
ZONES = [
    {'title': '용문산 관광지 진입로 확장', 'loc': '양평군 용문면 용문산', 'kw': '용문산관광지'},
    {'title': '동부권 관광·산업 연계도로 구축', 'loc': '양평군 동부권 (양평읍·서종면·조안면 일대)', 'kw': '양평군청'},
    {'title': '양평군 지방도(국지도) 도로건설공사', 'loc': '양평군 관내 국지도', 'kw': '양평군청'},
    {'title': '지방도 333호선 노선 변경', 'loc': '국지도 333호선 양평 구간', 'kw': '양평군청'},
    {'title': '국지도 88호선 병산~교평 간 도로 확포장공사', 'loc': '양평군 양서면 병산리~교평리', 'kw': '양평 병산리'},
    {'title': '향소교 확장공사', 'loc': '양평군 향소교', 'kw': '향소교'},
]

def kakao_keyword(kakao_key, kw):
    """카카오 키워드 검색으로 장소 좌표 조회 (지명/교량명 대응)"""
    try:
        r = requests.get('https://dapi.kakao.com/v2/local/search/keyword.json',
                         headers={'Authorization': f'KakaoAK {kakao_key}'},
                         params={'query': kw, 'size': 1}, timeout=10)
        if r.status_code == 200:
            docs = r.json().get('documents') or []
            if docs:
                return float(docs[0]['y']), float(docs[0]['x'])
    except Exception as e:
        print(f'[GEO] keyword fail: {e}')
    return None, None

def main():
    app = create_app()
    with app.app_context():
        from services.geocode import geocode_text
        from flask import current_app
        kakao_key = current_app.config.get('KAKAO_REST_API_KEY', '')

        created = 0
        for z in ZONES:
            exists = ConstructionNotice.query.filter_by(title=z['title'], source='news').first()
            if exists:
                print(f'스킵(기존): {z["title"]}')
                continue
            lat, lng = geocode_text(z['loc'], kakao_key=kakao_key)
            if not lat:
                lat, lng = kakao_keyword(kakao_key, z['kw'])
            notice = ConstructionNotice(
                title=z['title'],
                description='경기도의회 양평상담소 업무보고에서 점검된 도로 공사 현안 (출처: 대한민국과양평 뉴스 #290)',
                location=z['loc'],
                address='경기도 양평군',
                latitude=lat, longitude=lng,
                source='news',
                source_url='https://unocum.kr/news/290',
                notice_type='road_construction',
                is_active=True,
            )
            db.session.add(notice)
            created += 1
            print(f'등록: {z["title"]} | 좌표: {lat}, {lng}')
        db.session.commit()
        print(f'공사현안 등록 완료: {created}건')

        # 기사 #290 본문에 현안 목록 추가 (본문은 텍스트 렌더링이므로 일반 텍스트로)
        article = NewsArticle.query.get(290)
        if article and '관련 공사 현안' not in (article.content or ''):
            lines = '\n'.join(f'· {z["title"]}' for z in ZONES)
            box = (
                '\n\n🚧 관련 공사 현안 (경기도의회 건설교통위원회 점검)\n'
                f'{lines}\n'
                '📍 위치기반안내 > 건축공사 탭에서 지도로 확인할 수 있습니다.'
            )
            article.content = (article.content or '') + box
            article.updated_at = datetime.now()
            db.session.commit()
            print('기사 #290 본문 업데이트 완료')

if __name__ == '__main__':
    main()
