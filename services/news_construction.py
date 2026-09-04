"""뉴스 기사에서 공사현안을 AI로 추출하여 위치기반안내(건축공사)에 자동 등록"""
import requests
from datetime import datetime, timedelta

# 공사 관련 키워드가 포함된 기사만 AI 추출 대상으로 선별 (API 비용 절감)
CONSTRUCTION_KEYWORDS = [
    '공사', '도로', '교량', '확장', '확포장', '진입로', '노선 변경',
    '건설', '국지도', '지방도', '교통망', '인프라', '상수관로', '배관',
]

KR_YP_CATS = ['대한민국뉴스', '양평소식', '정책정보', '지역소식']

_EXTRACT_SYSTEM = "당신은 양평군 지역 뉴스 분석가입니다. 뉴스에서 실제 공사·건설 사업만 정확히 추출합니다. 없는 내용을 만들어내지 않습니다."

_EXTRACT_PROMPT = """다음 뉴스 기사에서 실제 도로/교량/인프라 공사·건설 사업만 추출하세요.
JSON 형식으로만 출력하세요:
{{"zones": [{{"title": "공사명", "location": "가능한 한 구체적인 위치 (예: 경기 양평군 양서면 병산리)"}}]}}
공사·건설 관련 내용이 없으면 {{"zones": []}}만 출력하세요.
단순 계획/건의가 아닌 실제 공사·사업만 포함하세요.

기사 제목: {title}
기사 내용: {content}"""


def _ai_extract_zones(title, content):
    """AI로 기사에서 공사현안 추출 -> [{'title': ..., 'location': ...}]"""
    from services.news_service import _motif_text
    result = _motif_text(
        _EXTRACT_SYSTEM,
        _EXTRACT_PROMPT.format(title=(title or '')[:200], content=(content or '')[:3000]),
        format_json=True,
    )
    if not result or not isinstance(result, dict):
        return []
    zones = []
    for z in result.get('zones', []):
        if isinstance(z, dict) and z.get('title'):
            zones.append({'title': str(z['title'])[:290], 'location': str(z.get('location') or '양평군')[:200]})
    return zones[:10]


def _kakao_keyword(kakao_key, kw):
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
        print(f'[NEWS_CONSTRUCTION] kakao keyword fail: {e}')
    return None, None


def _article_already_processed(article_id):
    from models import ConstructionNotice
    return ConstructionNotice.query.filter(
        ConstructionNotice.source == 'news',
        ConstructionNotice.source_url.like(f'%/news/{article_id}'),
    ).first() is not None


def process_article(app, article):
    """단일 기사에서 공사현안 추출/등록. 처리된 기사 수(0/1) 반환. 호출자가 app context를 유지해야 함"""
    from models import db, ConstructionNotice
    from services.geocode import geocode_text
    from flask import current_app

    if _article_already_processed(article.id):
        return 0

    text = (article.title or '') + ' ' + (article.content or '') + ' ' + (article.summary or '')
    if not any(kw in text for kw in CONSTRUCTION_KEYWORDS):
        return 0

    zones = _ai_extract_zones(article.title, article.content or article.summary or '')
    if not zones:
        # 공사 키워드는 있지만 실제 공사가 없는 기사 - 재처리 방지용 마커 없이 통과
        return 0

    kakao_key = current_app.config.get('KAKAO_REST_API_KEY', '')
    site_url = current_app.config.get('SITE_URL', 'https://unocum.kr')
    now = datetime.now()
    created = 0
    for z in zones:
        exists = ConstructionNotice.query.filter_by(title=z['title'], source='news').first()
        if exists:
            continue
        lat, lng = geocode_text(z['location'], kakao_key=kakao_key)
        if not lat and kakao_key and z['location'] != '양평군':
            lat, lng = _kakao_keyword(kakao_key, z['location'])
        db.session.add(ConstructionNotice(
            title=z['title'],
            description=f'뉴스 기사에서 자동 추출된 공사 현안 (출처: {article.title[:80]})',
            location=z['location'],
            address='경기도 양평군',
            latitude=lat, longitude=lng,
            source='news',
            source_url=f'{site_url}/news/{article.id}',
            notice_type='road_construction',
            is_active=True,
        ))
        created += 1

    # 기사 본문에 현안 목록 추가 (본문은 텍스트 렌더링이므로 일반 텍스트)
    if (article.content or '') and '관련 공사 현안' not in article.content:
        lines = '\n'.join(f'· {z["title"]}' for z in zones)
        article.content = article.content + (
            '\n\n🚧 관련 공사 현안\n'
            f'{lines}\n'
            '📍 위치기반안내 > 건축공사 탭에서 지도로 확인할 수 있습니다.'
        )
        article.updated_at = now

    db.session.commit()
    print(f'[NEWS_CONSTRUCTION] 기사 #{article.id}: 공사현안 {created}건 등록')
    return 1


def process_recent_articles(app, days=3):
    """최근 N일간 대한민국/양평 기사를 스캔하여 공사현안 자동 추출 등록"""
    with app.app_context():
        from models import NewsArticle
        since = datetime.now() - timedelta(days=days)
        articles = NewsArticle.query.filter(
            NewsArticle.category.in_(KR_YP_CATS),
            NewsArticle.created_at >= since,
        ).order_by(NewsArticle.id.desc()).all()
        print(f'[NEWS_CONSTRUCTION] 최근 {days}일 대상 기사: {len(articles)}건 스캔 시작')
        processed = 0
        for a in articles:
            try:
                processed += process_article(app, a)
            except Exception as e:
                print(f'[NEWS_CONSTRUCTION] 기사 #{a.id} 처리 오류: {e}')
        print(f'[NEWS_CONSTRUCTION] 완료: {processed}건 기사에서 공사현안 추출')
        return processed
