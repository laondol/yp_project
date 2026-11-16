import requests
from urllib.parse import quote
import re
import time
import html
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime

def _clean_text(s):
    """HTML 엔티티(&quot; 등)·태그 제거 — Naver API/RSS 제목·요약 정규화"""
    s = s or ''
    s = html.unescape(s)
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s)  # 이중 이스케이프(&amp;quot; 등) 정리
    return s.strip()

def _parse_pub_any(pub):
    """RFC822(구글 RSS) + 'YYYY-MM-DD HH:MM:SS'(언론사 RSS) 모두 파싱"""
    s = (pub or '').strip()
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)
        if d is not None:
            return d
    except Exception:
        pass
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d',
                '%Y.%m.%d %H:%M:%S', '%Y.%m.%d', '%Y/%m/%d %H:%M:%S'):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue
    return None


def _within_days(pub_date, days=7):
    """RSS pubDate 확인 — 정확히 days*24시간 이내만 수집"""
    d = _parse_pub_any(pub_date)
    if d is None:
        return False
    if d.tzinfo is None:
        return (datetime.now() - d) <= timedelta(days=days)
    return (datetime.now(d.tzinfo) - d) <= timedelta(days=days)


def _pub_naive(pub):
    """RSS 발행시각 → KST naive datetime (DB 저장용)"""
    from datetime import timezone
    d = _parse_pub_any(pub)
    if d is None:
        return None
    if d.tzinfo is None:
        return d
    return d.astimezone(timezone(timedelta(hours=9))).replace(tzinfo=None)


def _item_pub(it):
    """RSS item 발행시각 (pubDate 또는 dc:date)"""
    return (it.findtext('pubDate', '')
            or it.findtext('{http://purl.org/dc/elements/1.1/}date', '')
            or '')


def _source_from_title(title, fallback='네이버'):
    """제목 끝 ' - 매체명' 형태에서 출처 추출"""
    m = re.search(r'\s-\s([^-]{2,25})$', title or '')
    return m.group(1).strip() if m else fallback


VIDEO_BLOCK_HOSTS = (
    'youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com', 'instagram.com',
    'facebook.com', 'fb.watch', 'dailymotion.com', 'twitch.tv', 'naver.com/video',
    'tv.kakao.com', 'afreecatv.com', 'porn', 'xvideos', 'xnxx',
)
VIDEO_BLOCK_EXTS = ('.mp4', '.m3u8', '.webm', '.avi', '.mov', '.mkv', '.flv')


def _is_video_url(url):
    """동영상/비텍스트 링크 차단"""
    u = (url or '').lower()
    if not u:
        return False
    if any(h in u for h in VIDEO_BLOCK_HOSTS):
        return True
    return any(u.split('?')[0].endswith(e) for e in VIDEO_BLOCK_EXTS)


FOREIGN_WORDS = ('미국', '트럼프', '바이든', '중국', '시진핑', '일본', '기시다', '러시아', '푸틴',
                 '우크라이나', '이스라엘', '가자', '이란', '유럽', 'EU', '나토', '영국', '프랑스',
                 '독일', '인도', '브라질', '캐나다', '호주', '멕시코', '사우디', '터키', '北', '북한')
DOMESTIC_WORDS = ('한국', '국내', '정부', '국회', '대통령', '경기', '양평', '서울', '부산', '대구',
                  '인천', '광주', '대전', '울산', '세종', '강원', '충북', '충남', '전북', '전남',
                  '경북', '경남', '제주', '지자체', '복지', '의료', '교육', '물가', '세금', '연말정산',
                  '근로', '고용', '농업', '농촌', '주택', '교통', '재난', '기후', '환경')


def _is_foreign_topic(title, desc=''):
    """해외 뉴스로 보이면 True (세계 탭으로 보내고 국내 탭에서 제외)"""
    t = f"{title or ''} {desc or ''}"
    has_foreign = any(w in t for w in FOREIGN_WORDS)
    has_domestic = any(w in t for w in DOMESTIC_WORDS)
    return has_foreign and not has_domestic


def _needs_translation(text):
    """한글 비율이 낮으면 번역 대상 (영어·중국어·일본어·러시아어 등)"""
    t = text or ''
    if '[미번역]' in t:
        return True
    letters = [c for c in t if c.isalpha()]
    if not letters:
        return False
    hangul = sum(1 for c in letters if '\uac00' <= c <= '\ud7a3')
    return (hangul / len(letters)) < 0.3


def _news_url_blocked(url):
    """삭제한 뉴스 URL 블랙리스트 확인 (재수집 영구 차단)"""
    if not url:
        return False
    try:
        from models import NewsDeletedUrl
        return NewsDeletedUrl.query.filter_by(url=url).first() is not None
    except Exception:
        return False

KOREAN_DOMAINS = [
    '.co.kr', '.or.kr', '.go.kr', '.kr',
    'naver.com', 'daum.net', 'kakao.com', 'nate.com',
    'youtube.com', 'facebook.com', 'twitter.com', 'instagram.com',
    'yna.co.kr', 'kbs.co.kr', 'mbc.co.kr', 'sbs.co.kr',
    'hani.co.kr', 'donga.com', 'chosun.com', 'joongang.co.kr',
    'hankyoreh.com', 'kyunghyang.com', 'metro.co.kr',
    'news1.kr', 'newsis.com', 'ytn.co.kr', 'channeln.com',
    'etnews.com', 'zdnet.co.kr', '전자신문',
]

def _is_korean_source(url):
    """URL이 한국 뉴스 소스인지 확인"""
    if not url:
        return False
    url_lower = url.lower()
    for domain in KOREAN_DOMAINS:
        if domain in url_lower:
            return True
    return False

def _is_junk_title(title):
    """자기 참조 정크 제목 제거 (예: '중부시사신문 - 중부시사신문')"""
    t = (title or '').strip()
    if ' - ' in t:
        left, _, right = t.rpartition(' - ')
        if left.strip() and left.strip() == right.strip():
            return True
    return False

LABOR_SOURCES = [
    {"name": "매일노동뉴스", "domain": "labortoday.co.kr", "query": "site:labortoday.co.kr"},
    {"name": "참세상", "domain": "pressian.com", "query": "site:pressian.com"},
    {"name": "월간노동법률", "domain": "laborlaw.co.kr", "query": "site:laborlaw.co.kr"},
    {"name": "고용노동부", "domain": "moel.go.kr", "query": "site:moel.go.kr"},
    {"name": "한겨레신문", "domain": "hani.co.kr", "query": "site:hani.co.kr 노동"},
    {"name": "동아일보", "domain": "donga.com", "query": "site:donga.com 노동"},
    {"name": "노무사신문", "domain": "lawjournal.co.kr", "query": "site:lawjournal.co.kr"},
    {"name": "다음뉴스", "domain": "daum.net", "query": "site:news.daum.net 노동"},
    {"name": "아웃소싱타임스", "domain": "outsourcingtimes.co.kr", "query": "site:outsourcingtimes.co.kr"},
    {"name": "한국노동연구원", "domain": "kli.re.kr", "query": "site:kli.re.kr"},
]

KR_YP_SOURCES = [
    {"name": "연합뉴스", "domain": "yna.co.kr", "query": "site:yna.co.kr"},
    {"name": "조선일보", "domain": "chosun.com", "query": "site:chosun.com"},
    {"name": "KBS", "domain": "kbs.co.kr", "query": "site:kbs.co.kr"},
    {"name": "MBC", "domain": "imbc.com", "query": "site:imbc.com"},
    {"name": "한국일보", "domain": "hankookilbo.com", "query": "site:hankookilbo.com"},
    {"name": "SBS", "domain": "sbs.co.kr", "query": "site:sbs.co.kr"},
    {"name": "경향신문", "domain": "kyunghyang.com", "query": "site:kyunghyang.com"},
    {"name": "한겨레", "domain": "hani.co.kr", "query": "site:hani.co.kr"},
    {"name": "JTBC", "domain": "jtbc.joins.com", "query": "site:jtbc.joins.com"},
    {"name": "동아일보", "domain": "donga.com", "query": "site:donga.com"},
]

# 양평 지역 전문 언론 (API 키 불필요, Google News RSS로 항상 수집)
LOCAL_MEDIA_SOURCES = [
    {"name": "양평백운신문", "domain": "ypnews.kr"},
    {"name": "경기문화신문", "domain": "kgmunwha.com"},
    {"name": "뉴스팍", "domain": "newspak.co.kr"},
    {"name": "누리일보", "domain": "nuriilbo.com"},
    {"name": "광흥타임즈", "domain": "ghtimes.kr"},
    {"name": "정도일보", "domain": "jungdoilbo.com"},
    {"name": "비전21뉴스", "domain": "vision21.kr"},
    {"name": "경기인뉴스", "domain": "gninews.co.kr"},
    {"name": "옥천신문", "domain": "okinews.com", "region_filter": False},
]

# 공식 기관/정부 사이트 (공식 성명·보도자료)
OFFICIAL_SOURCES = [
    {"name": "양평군청", "domain": "yp21.go.kr", "region_filter": False, "verify_date": True},
    {"name": "경기도뉴스포털", "domain": "gg.go.kr", "region_filter": False, "verify_date": True},
    {"name": "고용노동부", "domain": "moel.go.kr", "region_filter": False, "verify_date": True},
    {"name": "정책브리핑", "domain": "korea.kr", "region_filter": False, "verify_date": True},
]

WORLD_SOURCES = [
    {"name": "로이터", "domain": "reuters.com", "query": "site:reuters.com"},
    {"name": "AFP", "domain": "afp.com", "query": "site:afp.com"},
    {"name": "워싱턴포스트", "domain": "washingtonpost.com", "query": "site:washingtonpost.com"},
    {"name": "BBC", "domain": "bbc.com", "query": "site:bbc.com"},
    {"name": "더가디언", "domain": "theguardian.com", "query": "site:theguardian.com"},
    {"name": "알자지라", "domain": "aljazeera.com", "query": "site:aljazeera.com"},
    {"name": "중국CCTV", "domain": "cctv.com", "query": "site:cctv.com"},
    {"name": "신화통신", "domain": "news.cn", "query": "site:news.cn"},
    {"name": "대한뉴스(KTV)", "domain": "ktv.go.kr", "query": "site:ktv.go.kr", "lang": "ko"},
    {"name": "아리랑TV", "domain": "arirang.com", "query": "site:arirang.com", "lang": "ko"},
    {"name": "NHK", "domain": "nhk.or.jp", "query": "site:nhk.or.jp"},
    {"name": "DW", "domain": "dw.com", "query": "site:dw.com"},
    {"name": "프랑스24", "domain": "france24.com", "query": "site:france24.com"},
    {"name": "CNA", "domain": "channelnewsasia.com", "query": "site:channelnewsasia.com"},
    {"name": "유엔뉴스", "domain": "news.un.org", "query": "site:news.un.org", "max_items": 3},
    {"name": "유네스코", "domain": "unesco.org", "query": "site:unesco.org", "max_items": 3},
    # 인권
    {"name": "유엔인권", "domain": "news.un.org", "q": "human rights", "max_items": 3},
    {"name": "휴먼라이츠워치", "domain": "hrw.org", "max_items": 3},
    {"name": "국제앰네스티", "domain": "amnesty.org", "max_items": 3},
    {"name": "유엔인권사무소", "domain": "ohchr.org", "max_items": 3},
    # 교육
    {"name": "유엔교육", "domain": "news.un.org", "q": "education", "max_items": 3},
    {"name": "유니세프", "domain": "unicef.org", "max_items": 3},
    # 지역
    {"name": "유엔아프리카", "domain": "news.un.org", "q": "Africa", "max_items": 3},
    {"name": "올아프리카", "domain": "allafrica.com", "max_items": 3},
    {"name": "유엔중동", "domain": "news.un.org", "q": "Middle East", "max_items": 3},
    {"name": "유엔중앙아시아", "domain": "news.un.org", "q": "Central Asia", "max_items": 3},
    {"name": "유라시아넷", "domain": "eurasianet.org", "max_items": 3},
    {"name": "유엔동남아", "domain": "news.un.org", "q": "Southeast Asia", "max_items": 3},
    {"name": "라플러", "domain": "rappler.com", "max_items": 3},
    # 재외동포(교포) 소식
    {"name": "재외동포신문", "domain": "dongponews.net", "lang": "ko", "max_items": 3},
    {"name": "미주중앙일보", "domain": "koreadaily.com", "lang": "ko", "max_items": 3},
    {"name": "미주한국일보", "domain": "koreatimes.com", "lang": "ko", "max_items": 3},
    {"name": "월드코리안", "domain": "worldkorean.net", "lang": "ko", "max_items": 3},
    {"name": "고려일보(중앙아시아)", "domain": "koreilbo.com", "lang": "ko", "max_items": 3},
    {"name": "재일민단", "domain": "mindan.org", "lang": "ko", "max_items": 3},
    {"name": "흑룡강신문(중국동포)", "domain": "hljnews.cn", "lang": "ko", "max_items": 3},
    {"name": "밴쿠버조선(캐나다)", "domain": "vanchosun.com", "lang": "ko", "max_items": 3},
    # 키워드 기반 교포 소식 (전용 매체가 없는 지역)
    {"name": "ABC호주", "domain": "abc.net.au", "max_items": 3},
    {"name": "NRK(노르웨이)", "domain": "nrk.no", "max_items": 3},
    {"name": "TASS(러시아)", "domain": "tass.com", "max_items": 3},
    {"name": "아프리카 교포(에티오피아·탄자니아)", "q": "에티오피아 한인 OR 탄자니아 한인 OR 아프리카 교포", "lang": "ko", "max_items": 3},
    {"name": "중남미 교포", "q": "브라질 한인 OR 아르헨티나 한인 OR 멕시코 한인 OR 칠레 한인 OR 중남미 교포", "lang": "ko", "max_items": 3},
    {"name": "호주 교포", "q": "호주 한인 OR 시드니 교포 OR 멜버른 한인 OR 브리즈번 한인", "lang": "ko", "max_items": 3},
]

WORLD_CATEGORY_BY_SOURCE = {
    '워싱턴포스트': '미국',
    '로이터': '영국', 'BBC': '영국', '더가디언': '영국',
    'AFP': '프랑스', '프랑스24': '프랑스',
    '알자지라': '중동',
    '중국CCTV': '중국', '신화통신': '중국',
    'NHK': '일본',
    'DW': '서유럽',
    'CNA': '동남아시아', '라플러': '동남아시아',
    '유엔뉴스': 'UN', '유엔인권': 'UN', '유엔교육': 'UN', '유엔중동': 'UN',
    '유엔중앙아시아': 'UN', '유엔동남아': 'UN', '유엔아프리카': 'UN',
    '휴먼라이츠워치': 'UN', '국제앰네스티': 'UN', '유엔인권사무소': 'UN', '유니세프': 'UN',
    '유네스코': '유네스코',
    '올아프리카': '남아프리카', '아프리카 교포(에티오피아·탄자니아)': '남아프리카',
    '유라시아넷': '중앙아시아', '고려일보(중앙아시아)': '중앙아시아',
    '재외동포신문': '미국', '미주중앙일보': '미국', '미주한국일보': '미국', '월드코리안': '미국',
    '재일민단': '일본', '흑룡강신문(중국동포)': '중국', '밴쿠버조선(캐나다)': '캐나다',
    '중남미 교포': '중남미', '호주 교포': '호주',
    'ABC호주': '호주', 'NRK(노르웨이)': '북유럽', 'TASS(러시아)': '러시아',
    '대한뉴스(KTV)': '대한민국뉴스', '아리랑TV': '대한민국뉴스',
}

# 주제 표시 순서 (관리자·회원 화면 셀렉트 순서)
TOPIC_ORDER = ('환경', '건강', '돌봄', '교육', '주거', '노동', '디지털', '문화', '법', '정치', '기타')

KR_TOPIC_RULES = [
    ('환경', ('환경', '기후', '생태', '오염', '미세먼지', '탄소', '재활용', '폐기물',
              '수질', '대기', '산림', '가뭄', '홍수', '멸종', '소음')),
    ('건강', ('건강', '의료', '병원', '보건', '질병', '감염', '백신', '코로나',
              '치매', '응급', '약국', '진료', '수술', '암 ')),
    ('돌봄', ('돌봄', '복지', '장애', '지원금', '기초생활', '연금', '노인', '어르신',
              '아동', '보육', '요양', '한부모', '긴급복지', '급여')),
    ('교육', ('교육', '학교', '학생', '교사', '입시', '수능', '대학', '학원',
              '유치원', '초등', '중등', '고등', '장학', '학부모')),
    ('주거', ('주거', '주택', '전세', '월세', '부동산', '임대', '아파트', '재개발',
              '재건축', '청약', '집값', '전월세', '빌라')),
    ('노동', ('노동', '고용', '임금', '근로', '최저임금', '산재', '실업', '구직',
              '일자리', '노조', '퇴직', '채용')),
    ('법', ('법안', '법률', '법원', '법적', '입법', '사법', '위법', '불법', '합법',
            '조례', '판결', '소송', '처벌', '과태료', '헌재', '헌법', '고소', '고발')),
    ('디지털', ('디지털', 'AI', '인공지능', '사이버', '정보보호', '개인정보', '스마트',
                '온라인', '플랫폼', '데이터', '해킹', '인터넷', '통신', '앱 ')),
    ('문화', ('문화', '축제', '공연', '전시', '예술', '관광', '체육', '스포츠',
              '도서관', '공원', '여행', '영화', '음악')),
    ('정치', ('정치', '국회', '선거', '정부', '대통령', '여당', '야당', '장관',
              '정책', '예산', '공약', '행정', '청와대', '시장·군수', '군수')),
]

NEAR_WORDS = ('경기', '여주', '광주', '하남', '남양주', '가평', '홍천', '횡성', '원주', '이천', '서울')

# 지역언론 기사 노출 기준: 양평 + 인접 시·군 (그 외는 관리자 화면에만 표시)
LOCAL_REGION_KEYWORDS = ('양평', '여주', '광주시', '경기 광주', '하남', '남양주', '가평')


def _kr_scope(text):
    t = text or ''
    if '양평' in t:
        return '양평'
    if any(w in t for w in NEAR_WORDS):
        return '그외'
    return '전체'


def _kr_category(title, desc=''):
    """분류 = '{범위} {주제}'  예: 양평 돌봄 / 그외 교육 / 전체 정치

    제목 키워드를 우선하고, 제목에 없을 때만 요약에서 주제를 찾는다.
    """
    t = title or ''
    d = desc or ''
    scope = _kr_scope(f"{t} {d}")
    for name, kws in KR_TOPIC_RULES:
        if any(k in t for k in kws):
            return f"{scope} {name}"
    for name, kws in KR_TOPIC_RULES:
        if any(k in d for k in kws):
            return f"{scope} {name}"
    return f"{scope} 기타"


def sort_topics(items):
    """주제 목록을 지정된 표시 순서로 정렬"""
    order = {t: i for i, t in enumerate(TOPIC_ORDER)}
    return sorted(items, key=lambda x: (order.get(x, len(TOPIC_ORDER)), x))


KR_KR_OLD_CATS = ('양평', '경기', '정치', '경제', '사회', '교육', '환경', '노동', '복지', '의료', '문화', '대한민국뉴스', '양평소식', '정책정보', '지역소식')


def is_kr_category(cat):
    c = cat or ''
    return c in KR_KR_OLD_CATS or c.startswith(('양평 ', '그외 ', '전체 '))


KR_YP_KEYWORDS = [
    "양평", "경기도", "한강", "용문산", "남한강",
    "양평군", "강상면", "강하면", "양동면", "서종면",
    "지평면", "양서면", "/umd", "개군면",
    "농산물", "전원주택", "귀농", "귀촌", "관광",
]


def _seed_news_sources():
    """하드코딩 소스 목록을 DB로 1회 이관"""
    from models import db, NewsSource
    if NewsSource.query.count() > 0:
        return
    rows = []
    for x in WORLD_SOURCES:
        rows.append(NewsSource(kind='world', name=x['name'], domain=x.get('domain', ''), q=x.get('q', ''),
                               lang=x.get('lang', 'en'), max_items=x.get('max_items', 5),
                               category=WORLD_CATEGORY_BY_SOURCE.get(x['name'], '')))
    for x in LOCAL_MEDIA_SOURCES:
        rows.append(NewsSource(kind='local', name=x['name'], domain=x.get('domain', ''),
                               max_items=5, region_filter=x.get('region_filter', True)))
    for x in OFFICIAL_SOURCES:
        rows.append(NewsSource(kind='official', name=x['name'], domain=x.get('domain', ''),
                               max_items=5, region_filter=False, verify_date=True))
    for x in KR_YP_SOURCES:
        rows.append(NewsSource(kind='kr_yp', name=x['name'], domain=x.get('domain', ''), max_items=5))
    db.session.add_all(rows)
    db.session.commit()
    print(f'[NEWS_SOURCE] 기본 소스 {len(rows)}개 등록')


def get_sources(kind):
    """DB에서 사용중인 소스 로드 (없으면 시드)"""
    from models import db, NewsSource
    try:
        if NewsSource.query.count() == 0:
            _seed_news_sources()
        rows = NewsSource.query.filter_by(kind=kind, enabled=True).order_by(NewsSource.id.asc()).all()
        return [{
            'name': r.name, 'domain': r.domain or '', 'q': r.q or '', 'lang': r.lang or 'en',
            'max_items': r.max_items or 5, 'category': r.category or '',
            'region_filter': bool(r.region_filter), 'verify_date': bool(r.verify_date),
        } for r in rows]
    except Exception as e:
        print(f'[NEWS_SOURCE] 로드 실패({kind}): {e}')
        return []


def collect_labor_news():
    """10개 노동 뉴스 소스에서 자동으로 기사를 수집하여 DB에 저장"""
    from flask import current_app
    from models import db, LaborNewsArticle

    try:
        client_id = current_app.config.get('NAVER_SEARCH_CLIENT_ID', '')
        client_secret = current_app.config.get('NAVER_SEARCH_CLIENT_SECRET', '')
    except RuntimeError:
        print("[LABOR_NEWS] Flask app context 필요")
        return 0

    if not client_id or not client_secret:
        print("[LABOR_NEWS] Naver API 키 없음 - Google News RSS fallback 사용")
        return collect_labor_news_rss()

    headers = {
        "X-Naver-Client-Id": client_id,
        "X-Naver-Client-Secret": client_secret,
    }

    total_new = 0
    seen_urls = set()
    api_calls_ok = 0
    api_calls_fail = 0
    now = datetime.now()

    for source in LABOR_SOURCES:
        try:
            query = f"{source['query']} 노동"
            params = {"query": query, "display": 5, "sort": "date"}
            res = requests.get(
                "https://openapi.naver.com/v1/search/news.json",
                headers=headers, params=params, timeout=10
            )
            if res.status_code != 200:
                api_calls_fail += 1
                print(f"[LABOR_NEWS] {source['name']}: Naver API 오류 {res.status_code}")
                continue
            api_calls_ok += 1

            items = res.json().get('items', [])
            for item in items:
                url = item.get('link', '')
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)

                title = _clean_text(item.get('title', ''))
                desc = _clean_text(item.get('description', ''))
                if not title or len(title) < 5:
                    continue

                existing = LaborNewsArticle.query.filter_by(source_url=url).first()
                if existing:
                    continue

                article = LaborNewsArticle(
                    title=f"[{source['name']}] {title}",
                    summary=desc[:200],
                    content=f"<p>{desc[:1000]}</p>",
                    source_url=url,
                    source_name=source['name'],
                    category="정책정보",
                    is_selected=True,
                    is_ai_generated=True,
                    ai_reason=f"자동 수집: {source['name']} ({now.strftime('%m/%d')})",
                    created_by=None,
                )
                db.session.add(article)
                total_new += 1

            db.session.commit()
            time.sleep(0.3)  # Naver 429 방지 (요청 간격)

        except Exception as e:
            api_calls_fail += 1
            print(f"[LABOR_NEWS] {source['name']} 수집 오류: {e}")
            continue

    # Naver API 전체 실패 시 Google News RSS로 fallback (API 키 불필요)
    if api_calls_ok == 0 and api_calls_fail > 0:
        print("[LABOR_NEWS] Naver API 전체 실패 - Google News RSS fallback 사용")
        return collect_labor_news_rss()

    print(f"[LABOR_NEWS] 자동 수집 완료: {total_new}건 신규 등록 (API 성공 {api_calls_ok}/실패 {api_calls_fail})")
    return total_new, 'naver'


def collect_labor_news_rss():
    """Naver API 실패 시 Google News RSS로 노동뉴스 수집 (API 키 불필요)"""
    from models import db, LaborNewsArticle

    total_new = 0
    seen_urls = set()
    now = datetime.now()

    for source in LABOR_SOURCES:
        try:
            q = f"{source['query']} 노동"
            res = requests.get(
                "https://news.google.com/rss/search",
                params={'q': q, 'hl': 'ko', 'gl': 'KR', 'ceid': 'KR:ko'},
                headers={'User-Agent': 'Mozilla/5.0'}, timeout=15
            )
            if res.status_code != 200:
                print(f"[LABOR_RSS] {source['name']}: Google RSS 오류 {res.status_code}")
                continue

            root = ET.fromstring(res.content)
            items = root.findall('.//item')
            print(f"[LABOR_RSS] {source['name']}: {len(items)}건 수신")

            for item in items[:5]:
                title = (item.findtext('title', '') or '').strip()
                link = (item.findtext('link', '') or '').strip()
                desc = (item.findtext('description', '') or '').strip()

                if not title or not link or link in seen_urls:
                    continue
                seen_urls.add(link)

                title = _clean_text(title)
                desc = _clean_text(desc)
                if len(title) < 5:
                    continue

                existing = LaborNewsArticle.query.filter_by(source_url=link).first()
                if existing:
                    continue

                article = LaborNewsArticle(
                    title=f"[{source['name']}] {title}",
                    summary=desc[:200],
                    content=f"<p>{desc[:1000]}</p>",
                    source_url=link,
                    source_name=source['name'],
                    category="정책정보",
                    is_selected=True,
                    is_ai_generated=True,
                    ai_reason=f"자동 수집(RSS): {source['name']} ({now.strftime('%m/%d')})",
                    created_by=None,
                )
                db.session.add(article)
                total_new += 1

            db.session.commit()

        except Exception as e:
            print(f"[LABOR_RSS] {source['name']} 수집 오류: {e}")
            continue

    print(f"[LABOR_RSS] RSS 수집 완료: {total_new}건 신규 등록")
    return total_new, 'rss'


def collect_kr_yp_news_rss():
    """Naver API 실패 시 Google News RSS로 대한민국·양평 뉴스 수집 (API 키 불필요)"""
    from models import db, NewsArticle

    total_new = 0
    seen_urls = set()
    now = datetime.now()

    search_queries = ["양평", "경기도 양평"]

    for source in get_sources('kr_yp'):
        for sq in search_queries:
            try:
                q = f"site:{source['domain']} {sq}"
                res = requests.get(
                    "https://news.google.com/rss/search",
                    params={'q': q, 'hl': 'ko', 'gl': 'KR', 'ceid': 'KR:ko'},
                    headers={'User-Agent': 'Mozilla/5.0'}, timeout=15
                )
                if res.status_code != 200:
                    print(f"[KR_YP_RSS] {source['name']}: Google RSS 오류 {res.status_code}")
                    continue

                root = ET.fromstring(res.content)
                items = root.findall('.//item')
                # 7일 이내 신규 기사만, 최신순 상위 5건 (구 기사 재수집 차단)
                items = [it for it in items
                         if _within_days(it.findtext('pubDate', ''), 1)]
                items.sort(key=lambda it: parsedate_to_datetime(it.findtext('pubDate', '')),
                           reverse=True)
                items = items[:5]
                print(f"[KR_YP_RSS] {source['name']} + '{sq}': {len(items)}건 수신(7일 이내)")

                for item in items:
                    title = (item.findtext('title', '') or '').strip()
                    link = (item.findtext('link', '') or '').strip()
                    desc = (item.findtext('description', '') or '').strip()

                    if not title or not link or link in seen_urls:
                        continue
                    seen_urls.add(link)

                    title = _clean_text(title)
                    desc = _clean_text(desc)
                    if len(title) < 5:
                        continue

                    if _news_url_blocked(link) or _is_video_url(link):
                        continue
                    existing = NewsArticle.query.filter_by(source_url=link).first()
                    if existing:
                        continue

                    is_yp = any(kw in title + desc for kw in ["양평", "경기도"])
                    article = NewsArticle(
                        source_name=source['name'],
                        published_at=_pub_naive(_item_pub(item)),
                        title=f"[{source['name']}] {title}",
                        summary=desc[:200],
                        content=f"<p>{desc[:1000]}</p>",
                        source_url=link,
                        category=_kr_category(title, desc),
                        is_selected=True,
                        is_ai_generated=True,
                        kr_yp_ai_approved=True,
                        kr_yp_admin_approved=True,
                        ai_reason=f"자동수집(RSS): {source['name']} ({now.strftime('%m/%d')})",
                    )
                    db.session.add(article)
                    total_new += 1

                db.session.commit()

            except Exception as e:
                print(f"[KR_YP_RSS] {source['name']} 수집 오류: {e}")
                continue

    print(f"[KR_YP_RSS] RSS 수집 완료: {total_new}건 신규 등록")
    return total_new, 'rss'


def _naver_original_url(title, domain=None):
    """제목으로 네이버 뉴스를 조회해 언론사 원문(originallink) URL을 찾는다.
    구글 뉴스 링크는 클릭 시 구글 페이지를 거쳐 다른 매체가 노출되므로 원문 직링크로 치환한다.
    """
    try:
        from flask import current_app
        cid = current_app.config.get('NAVER_SEARCH_CLIENT_ID', '')
        sec = current_app.config.get('NAVER_SEARCH_CLIENT_SECRET', '')
        if not cid or not sec:
            return None
        q = re.sub(r'<[^>]+>', '', title or '')
        q = re.sub(r'\s+-\s+[^-]{1,30}$', '', q)
        q = re.sub(r'\s+', ' ', q).strip()[:100]
        if not q:
            return None
        r = requests.get(
            "https://openapi.naver.com/v1/search/news.json",
            headers={"X-Naver-Client-Id": cid, "X-Naver-Client-Secret": sec},
            params={"query": q, "display": 10, "sort": "sim"}, timeout=10,
        )
        if r.status_code != 200:
            return None
        key = re.sub(r'[^가-힣A-Za-z0-9]', '', q)[:20]
        if not key:
            return None
        items = r.json().get('items', [])

        def _norm(t):
            return re.sub(r'[^가-힣A-Za-z0-9]', '', re.sub(r'<[^>]+>', '', t or ''))

        # 1차: 같은 도메인 원문
        for it in items:
            if key not in _norm(it.get('title', '')):
                continue
            url = (it.get('originallink') or it.get('link') or '').strip()
            if url and 'n.news.naver.com' not in url and (not domain or domain in url):
                return url
        # 2차: 도메인 정보가 없을 때만 제목 일치로 허용 (다른 매체 오연결 방지)
        if not domain:
            for it in items:
                if _norm(it.get('title', ''))[:20] != key:
                    continue
                url = (it.get('originallink') or it.get('link') or '').strip()
                if url and 'n.news.naver.com' not in url:
                    return url
        return None
    except Exception:
        return None


def _naver_verify_pubdate(title):
    """제목으로 네이버 뉴스를 조회해 실제 발행일 확인 (공식 사이트 재색인 대응)"""
    try:
        from flask import current_app
        cid = current_app.config.get('NAVER_SEARCH_CLIENT_ID', '')
        sec = current_app.config.get('NAVER_SEARCH_CLIENT_SECRET', '')
        if not cid or not sec:
            return None
        q = re.sub(r'<[^>]+>', '', title or '')
        q = re.sub(r'\s+-\s+[^-]{1,30}$', '', q)   # " - 매체명" 제거
        q = re.sub(r'\s+', ' ', q).strip()[:100]
        if not q:
            return None
        r = requests.get(
            "https://openapi.naver.com/v1/search/news.json",
            headers={"X-Naver-Client-Id": cid, "X-Naver-Client-Secret": sec},
            params={"query": q, "display": 10, "sort": "sim"}, timeout=10,
        )
        if r.status_code != 200:
            return None
        def _match(items):
            key = re.sub(r'[^가-힣A-Za-z0-9]', '', q)[:20]
            if not key:
                return None
            for it in items:
                t = re.sub(r'<[^>]+>', '', it.get('title', ''))
                k = re.sub(r'[^가-힣A-Za-z0-9]', '', t)
                if key in k or (k and k[:20] == key):
                    return parsedate_to_datetime(it.get('pubDate', ''))
            return None

        d = _match(r.json().get('items', []))
        if d is not None:
            return d
        # 2차: 특수문자 제거 후 핵심 키워드로 재검색
        q2 = re.sub(r'[^가-힣A-Za-z0-9 ]', ' ', q)
        q2 = ' '.join([w for w in q2.split() if len(w) >= 2][:6])
        if not q2 or q2 == q:
            return None
        r2 = requests.get(
            "https://openapi.naver.com/v1/search/news.json",
            headers={"X-Naver-Client-Id": cid, "X-Naver-Client-Secret": sec},
            params={"query": q2, "display": 10, "sort": "sim"}, timeout=10,
        )
        if r2.status_code != 200:
            return None
        for it in r2.json().get('items', []):
            t = re.sub(r'<[^>]+>', '', it.get('title', ''))
            nk = re.sub(r'[^가-힣A-Za-z0-9]', '', q2)[:14]
            if nk and nk in re.sub(r'[^가-힣A-Za-z0-9]', '', t):
                return parsedate_to_datetime(it.get('pubDate', ''))
        return None
    except Exception:
        return None


DATE_HINT_WORDS = ('승인', '입력', '발행', '보도', '배포', '게시', '등록', '작성', '송고', '일자', '기준일', '보도시점')


def _fetch_page_pubdate(url):
    """원문 페이지(구글 링크 제외)에서 발행일 추출"""
    import re as _re
    from datetime import datetime as _dt
    u = (url or '').strip()
    if not u.startswith('http') or 'news.google.com' in u:
        return None
    try:
        r = requests.get(u, headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
        if r.status_code != 200:
            return None
        html = r.text[:600000]
        for pat in (
            r'article:published_time"\s+content="([^"]+)"',
            r'"datePublished"\s*:\s*"([^"]+)"',
            r'<time[^>]+datetime="([^"]+)"',
        ):
            m = _re.search(pat, html)
            if m:
                raw = m.group(1).replace('Z', '+00:00')
                try:
                    d = _dt.fromisoformat(raw)
                    return d.astimezone(_dt.now().astimezone().tzinfo).replace(tzinfo=None) if d.tzinfo else d
                except Exception:
                    pass
        return _extract_date_from_text(_re.sub(r'<script[\s\S]*?</script>', ' ', html))
    except Exception:
        return None


def _extract_date_from_text(text):
    """본문에서 '승인/입력/발행/보도…' 근처의 날짜를 발행일 후보로 추출"""
    import re as _re
    from datetime import datetime as _dt
    t = _re.sub(r'<[^>]+>', ' ', text or '')
    if not t:
        return None
    # 날짜 패턴: 2026-11-10 / 2026.11.10 / 2026년 11월 10일 (+ 시:분)
    pat = _re.compile(r'(20\d{2})\s*[-.년/]\s*(\d{1,2})\s*[-.월/]\s*(\d{1,2})\s*일?(?:\s*(\d{1,2})\s*[:시]\s*(\d{1,2})?\s*분?)?')
    for m in pat.finditer(t):
        start = max(0, m.start() - 40)
        ctx = t[start:m.start()]
        if not any(w in ctx for w in DATE_HINT_WORDS):
            continue
        try:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            hh = int(m.group(4) or 0)
            mm = int(m.group(5) or 0)
            if not (1 <= mo <= 12 and 1 <= d <= 31 and 0 <= hh <= 23 and 0 <= mm <= 59):
                continue
            return _dt(y, mo, d, hh, mm)
        except Exception:
            continue
    return None


def _google_verify_pubdate(title):
    """제목으로 구글 뉴스 RSS를 재조회해 실제 발행일 확인 (구글 링크 기사 대응)"""
    try:
        q = re.sub(r'<[^>]+>', '', title or '')
        q = re.sub(r'\s+-\s+[^-]{1,30}$', '', q).strip()
        q = re.sub(r'[^가-힣A-Za-z0-9 ]', ' ', q)
        q = ' '.join([w for w in q.split() if len(w) >= 2][:8])
        if not q:
            return None
        r = requests.get(
            "https://news.google.com/rss/search",
            params={'q': q, 'hl': 'ko', 'gl': 'KR', 'ceid': 'KR:ko'},
            headers={'User-Agent': 'Mozilla/5.0'}, timeout=15,
        )
        if r.status_code != 200:
            return None
        root = ET.fromstring(r.content)
        key = re.sub(r'[^가-힣A-Za-z0-9]', '', q)[:14]
        for it in root.findall('.//item'):
            t = re.sub(r'<[^>]+>', '', it.findtext('title', ''))
            k = re.sub(r'[^가-힣A-Za-z0-9]', '', t)
            if key and (key in k or k[:14] == key):
                return parsedate_to_datetime(it.findtext('pubDate', ''))
        return None
    except Exception:
        return None


# 구글 뉴스 색인이 부실한 지역 언론은 자체 RSS/목록 페이지를 우선 사용
BUILTIN_LOCAL_FEEDS = [
    {'name': '양평백운신문', 'domain': 'ypnews.kr',
     'rss': 'http://www.ypnews.kr/rss/allArticle.xml'},
    {'name': '양평시민의소리', 'domain': 'ypsori.com',
     'rss': 'https://www.ypsori.com/rss/allArticle.xml', 'skip_region_filter': False},
    {'name': 'YPN뉴스', 'domain': 'ypnews.co.kr',
     'list': 'https://www.ypnews.co.kr/bbs/board.php?bo_table=news'},
    # 각 신문사 자체 RSS (구글 뉴스 경유 없이 원문 직링크)
    {'name': '경기문화신문', 'domain': 'kgmunwha.com',
     'rss': 'https://www.kgmunwha.com/rss/allArticle.xml', 'skip_region_filter': False},
    {'name': '뉴스팍', 'domain': 'newspak.co.kr',
     'rss': 'https://www.newspak.co.kr/data/rss/news.xml', 'skip_region_filter': False},
    {'name': '누리일보', 'domain': 'nuriilbo.com',
     'rss': 'https://www.nuriilbo.com/data/rss/news.xml', 'skip_region_filter': False},
    {'name': '광흥타임즈', 'domain': 'ghtimes.kr',
     'rss': 'https://www.ghtimes.kr/data/rss/news.xml', 'skip_region_filter': False},
    {'name': '정도일보', 'domain': 'jungdoilbo.com',
     'rss': 'https://www.jungdoilbo.com/data/rss/news.xml', 'skip_region_filter': False},
    {'name': '비전21뉴스', 'domain': 'vision21.kr',
     'rss': 'https://www.vision21.kr/data/rss/news.xml', 'skip_region_filter': False},
    {'name': '경기인뉴스', 'domain': 'gninews.co.kr',
     'rss': 'https://www.gninews.co.kr/data/rss/news.xml', 'skip_region_filter': False},
    {'name': '옥천신문', 'domain': 'okinews.com',
     'rss': 'https://www.okinews.com/rss/allArticle.xml', 'skip_region_filter': False},
    # 자체 RSS 없음 → 구글 뉴스 + 원문 조회
    {'name': '경기일보', 'domain': 'kyeonggi.com'},
]
BUILTIN_BY_DOMAIN = {f['domain']: f for f in BUILTIN_LOCAL_FEEDS}


def _html_list_root(url):
    """게시판 목록 HTML(그누보드) → RSS와 같은 ElementTree 구조로 변환"""
    from bs4 import BeautifulSoup
    r = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
    r.encoding = 'utf-8'
    soup = BeautifulSoup(r.text, 'html.parser')
    root = ET.Element('rss')
    ch = ET.SubElement(root, 'channel')
    seen = set()
    for tr in soup.select('tr'):
        a = tr.select_one('a[href*="wr_id="]')
        if not a:
            continue
        title = re.sub(r'\s*댓글\s*\+?\s*\d*\s*개?\s*$', '', a.get_text(' ', strip=True)).strip()
        href = (a.get('href') or '').replace('&amp;', '&')
        if len(title) < 5 or not href or href in seen:
            continue
        seen.add(href)
        m = re.search(r'20\d\d[.-]\d\d[.-]\d\d(?:\s+\d\d:\d\d(?::\d\d)?)?',
                      tr.get_text(' ', strip=True))
        it = ET.SubElement(ch, 'item')
        ET.SubElement(it, 'title').text = title
        ET.SubElement(it, 'link').text = href
        ET.SubElement(it, 'description').text = ''
        if m:
            ET.SubElement(it, 'pubDate').text = m.group(0)
    return root


def collect_kr_yp_local_rss():
    """양평 지역 언론·옥천신문·공식 기관 사이트를 Google News RSS로 수집 (API 키 불필요, 항상 실행)"""
    from models import db, NewsArticle

    total_new = 0
    seen_urls = set()
    seen_titles = set()
    now = datetime.now()

    _sources = list(get_sources('local')) + list(get_sources('official'))
    _have = {(x.get('domain') or '').strip().lower() for x in _sources}
    for _f in BUILTIN_LOCAL_FEEDS:
        if _f['domain'] not in _have:
            _sources.append({'name': _f['name'], 'domain': _f['domain']})

    for source in _sources:
        try:
            _feed = BUILTIN_BY_DOMAIN.get((source.get('domain') or '').strip().lower())
            if _feed and _feed.get('rss'):
                res = requests.get(_feed['rss'], headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
                if res.status_code != 200:
                    print(f"[KR_YP_LOCAL] {source['name']}: RSS 오류 {res.status_code}")
                    continue
                root = ET.fromstring(res.content)
            elif _feed and _feed.get('list'):
                root = _html_list_root(_feed['list'])
            else:
                res = requests.get(
                    "https://news.google.com/rss/search",
                    params={'q': f"site:{source['domain']}", 'hl': 'ko', 'gl': 'KR', 'ceid': 'KR:ko'},
                    headers={'User-Agent': 'Mozilla/5.0'}, timeout=15
                )
                if res.status_code != 200:
                    print(f"[KR_YP_LOCAL] {source['name']}: Google RSS 오류 {res.status_code}")
                    continue
                root = ET.fromstring(res.content)
            _direct = bool(_feed and (_feed.get('rss') or _feed.get('list')))
            _skip_region = _direct and _feed.get('skip_region_filter', True)
            items = root.findall('.//item')
            # 7일 이내 신규 기사만, 최신순 상위 5건 (구 기사 재수집 차단)
            items = [it for it in items if _within_days(_item_pub(it), 1)]
            def _feed_key(it):
                _t = (it.findtext('title', '') or '') + ' ' + (it.findtext('description', '') or '')
                _local = any(k in _t for k in LOCAL_REGION_KEYWORDS)
                _d = _parse_pub_any(_item_pub(it)) or datetime.min
                return (0 if _local else 1, -_d.timestamp())
            items.sort(key=_feed_key)
            _limit = 10 if _direct else 5
            saved_cnt = 0
            hidden_cnt = 0

            for item in items:
                title = (item.findtext('title', '') or '').strip()
                link = (item.findtext('link', '') or '').strip()
                desc = (item.findtext('description', '') or '').strip()

                if not title or not link or link in seen_urls:
                    continue
                seen_urls.add(link)

                title = _clean_text(title)
                desc = re.sub(r'&?nbsp;', ' ', _clean_text(desc)).strip()
                art_summary = desc
                art_content = f"<p>{desc[:1000]}</p>" if desc else ''
                if len(title) < 5:
                    continue

                # 구글 뉴스 링크 → 언론사 원문 직링크로 치환 (실패 시 게시 제외)
                _resolve_failed = False
                if 'news.google.com' in link:
                    _orig = _naver_original_url(title, source.get('domain'))
                    if _orig:
                        link = _orig
                    else:
                        _resolve_failed = True

                # 지역 매체 기사: 양평·인접 시군 관련이면 공개, 그 외는 관리자 화면에만 표시
                # (자체 RSS로 받는 양평 전문 지역지는 필터 생략)
                _local_ok = any(kw in title + desc for kw in LOCAL_REGION_KEYWORDS)
                _hidden = _resolve_failed or ((not _skip_region) and source.get('region_filter', True) and not _local_ok)

                # 공식 사이트는 실제 발행일 교차검증 (24시간 이내만)
                if source.get('verify_date'):
                    _pd = _naver_verify_pubdate(title)
                    if _pd is None:
                        continue
                    _now = datetime.now(_pd.tzinfo) if _pd.tzinfo else datetime.now()
                    if (_now - _pd) > timedelta(hours=24):
                        continue

                if _is_junk_title(title):
                    continue

                if _news_url_blocked(link) or _is_video_url(link):
                    continue
                existing = NewsArticle.query.filter_by(source_url=link).first()
                if existing:
                    continue

                # 같은 기사가 여러 신문사에 중복 게재되는 경우 1건만 저장
                _title_key = re.sub(r'[^가-힣A-Za-z0-9]', '', title)[:40]
                if _title_key in seen_titles:
                    continue
                if NewsArticle.query.filter(NewsArticle.title == title).first():
                    continue
                seen_titles.add(_title_key)

                # 한글 전용 원칙: 요약/본문에 외국어가 남아 있으면 비움
                if _needs_translation(art_summary):
                    art_summary = ''
                if _needs_translation(re.sub(r'<[^>]+>', ' ', art_content or '')):
                    art_content = f"<p>{art_summary}</p>" if art_summary else ''

                article = NewsArticle(
                    source_name=source['name'],
                    published_at=_pub_naive(item.findtext('pubDate', '')),
                    title=title,
                    summary=desc[:200],
                    content=f"<p>{desc[:1000]}</p>",
                    source_url=link,
                    category=_kr_category(title, desc),
                    is_selected=not _hidden,
                    is_ai_generated=True,
                    kr_yp_ai_approved=not _hidden,
                    kr_yp_admin_approved=not _hidden,
                    ai_reason=(f"자동수집(RSS·지역언론): {source['name']} ({now.strftime('%m/%d')})"
                               + (" · 원문 확인 실패" if _resolve_failed else "")
                               + (" · 관리자 검토 대기" if (_hidden and not _resolve_failed) else "")),
                )
                db.session.add(article)
                total_new += 1
                saved_cnt += 1
                if _hidden:
                    hidden_cnt += 1
                if saved_cnt >= _limit:
                    break

            db.session.commit()
            print(f"[KR_YP_LOCAL] {source['name']}: {len(items)}건 수신, 신규 {saved_cnt}건 저장 (관리자 전용 {hidden_cnt}건)")

        except Exception as e:
            print(f"[KR_YP_LOCAL] {source['name']} 수집 오류: {e}")
            continue

    return total_new


def collect_kr_yp_news():
    """10개 주요 언론사에서 대한민국·양평 관련 뉴스를 자동 수집하여 DB에 저장"""
    from flask import current_app
    from models import db, NewsArticle

    try:
        client_id = current_app.config.get('NAVER_SEARCH_CLIENT_ID', '')
        client_secret = current_app.config.get('NAVER_SEARCH_CLIENT_SECRET', '')
    except RuntimeError:
        print("[KR_YP_NEWS] Flask app context 필요")
        return 0

    if not client_id or not client_secret:
        print("[KR_YP_NEWS] Naver API 키 없음 - Google News RSS fallback 사용")
        _n, _mode = collect_kr_yp_news_rss()
        return _n + collect_kr_yp_local_rss(), _mode

    headers = {
        "X-Naver-Client-Id": client_id,
        "X-Naver-Client-Secret": client_secret,
    }

    total_new = 0
    seen_urls = set()
    skipped_existing = 0
    api_calls_ok = 0
    api_calls_fail = 0
    now = datetime.now()

    search_queries = [
        # 1순위: 환경
        "환경 정책", "환경 오염",
        # 양평군민 생활 필수
        "물가 인상", "정부 지원금", "농산물 가격", "임업 임산물",
        "복지 지원", "장애인 지원", "의료 정책", "건강 보험",
        "고용 정책", "대중교통", "국내 경제",
        # 국토·도로·공사·계획 (오픈 정보, 민감)
        "도로 건설 계획", "국토 도로 공사",
        # 인구·사이버피해
        "인구 감소 대책", "사이버 범죄 피해",
        # 농촌·주거
        "귀농 귀촌", "전원주택",
        # 지역 행사 (다가오는 행사 위주 — 선별 단계에서 과거행사 하향)
        "양평 축제",
    ]

    for sq in search_queries:
        try:
            time.sleep(0.3)  # Naver 429 방지 (요청 간격)
            params = {"query": sq, "display": 5, "sort": "date"}
            res = requests.get(
                "https://openapi.naver.com/v1/search/news.json",
                headers=headers, params=params, timeout=10
            )
            if res.status_code != 200:
                api_calls_fail += 1
                print(f"[KR_YP_NEWS] '{sq}': Naver API 오류 {res.status_code}")
                continue
            api_calls_ok += 1

            items = res.json().get('items', [])
            saved_cnt = 0
            for item in items:
                url = item.get('link', '')
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                if not _within_days(item.get('pubDate', ''), 1):
                    continue
                if not _is_korean_source(url):
                    continue

                title = _clean_text(item.get('title', ''))
                desc = _clean_text(item.get('description', ''))
                if not title or len(title) < 5:
                    continue

                # 해외 뉴스는 세계 탭으로 보내고 국내 탭에서는 제외
                if _is_foreign_topic(title, desc):
                    continue

                if _news_url_blocked(url) or _is_video_url(url):
                    continue
                existing = NewsArticle.query.filter_by(source_url=url).first()
                if existing:
                    skipped_existing += 1
                    continue

                is_yp = any(kw in title + desc for kw in ["양평", "경기도"])
                category = _kr_category(title, desc)

                article = NewsArticle(
                    source_name=_source_from_title(title),
                    published_at=_pub_naive(item.get('pubDate', '')),
                    title=title,
                    summary=desc[:200],
                    content=f"<p>{desc[:1000]}</p>",
                    source_url=url,
                    category=category,
                    is_selected=False,
                    is_ai_generated=True,
                    kr_yp_ai_approved=False,
                    kr_yp_admin_approved=False,
                    ai_reason=f"자동수집(네이버·관리자 전용): {sq} ({now.strftime('%m/%d')})",
                )
                db.session.add(article)
                total_new += 1
                saved_cnt += 1

            db.session.commit()
            print(f"[KR_YP_NEWS] '{sq}': {len(items)}건 수신, 신규 {saved_cnt}건 저장")

        except Exception as e:
            api_calls_fail += 1
            print(f"[KR_YP_NEWS] '{sq}' 수집 오류: {e}")
            continue

    # 2) 지역 전문 언론(백운신문 등) — Naver API와 무관하게 항상 Google News RSS로 병행
    local_new = collect_kr_yp_local_rss()
    total_new += local_new

    # Naver API 전체 실패 시 Google News RSS로 fallback (API 키 불필요)
    if api_calls_ok == 0 and api_calls_fail > 0:
        print("[KR_YP_NEWS] Naver API 전체 실패 - Google News RSS fallback 사용")
        rss_new, mode = collect_kr_yp_news_rss()
        return rss_new + local_new, mode

    print(f"[KR_YP_NEWS] 자동 수집 완료: 신규 {total_new}건 (전국 주제 + 지역언론 {local_new}건), 기존 스킵 {skipped_existing}건 (API 성공 {api_calls_ok}/실패 {api_calls_fail})")
    return total_new, 'naver'


def collect_world_news(categories=None):
    """세계 언론사(국가/공영 방송 포함)에서 글로벌 뉴스를 자동 수집하여 DB에 저장 (Google News RSS + Naver)"""
    from flask import current_app
    from models import db, NewsArticle

    total_new = 0
    seen_urls = set()
    now = datetime.now()

    # 1) Google News RSS로 각 소스별 수집 (categories 지정 시 해당 지역만)
    _sources = get_sources('world')
    if categories:
        _cats = set(categories)
        _sources = [x for x in _sources
                    if (x.get('category') or WORLD_CATEGORY_BY_SOURCE.get(x['name'])) in _cats]
    for source in _sources:
        try:
            _hl, _gl, _ceid = ('ko', 'KR', 'KR:ko') if source.get('lang') == 'ko' else ('en', 'US', 'US:en')
            _q = f"site:{source['domain']}" if source.get('domain') else ''
            if source.get('q'):
                _q = (_q + ' ' + source['q']).strip() if _q else source['q']
            rss_url = f"https://news.google.com/rss/search?q={quote(_q)}&hl={_hl}&gl={_gl}&ceid={_ceid}"
            res = requests.get(rss_url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
            if res.status_code != 200:
                print(f"[WORLD_NEWS] {source['name']}: Google RSS 오류 {res.status_code}")
                continue

            root = ET.fromstring(res.content)
            items = root.findall('.//item')

            # 최근 24시간 이내 기사만 (구 기사 재수집 차단)
            items = [it for it in items if _within_days(it.findtext('pubDate', ''), 1)]
            items.sort(key=lambda it: parsedate_to_datetime(it.findtext('pubDate', '')), reverse=True)

            for item in items[:int(source.get('max_items', 5))]:
                title = (item.findtext('title', '') or '').strip()
                link = (item.findtext('link', '') or '').strip()
                desc = (item.findtext('description', '') or '').strip()

                if not title or not link or link in seen_urls:
                    continue
                seen_urls.add(link)

                title = _clean_text(title)
                desc = _clean_text(desc)
                if len(title) < 5:
                    continue

                if _news_url_blocked(link) or _is_video_url(link):
                    continue
                existing = NewsArticle.query.filter_by(source_url=link).first()
                if existing:
                    continue

                art_title = f"[{source['name']}] {title}"
                art_summary = desc[:200]
                art_content = f"<p>{desc[:1000]}</p>"

                # 세계뉴스는 한글이 아니면 반드시 번역 후 저장 (영어·중국어·일본어·러시아어 포함)
                if _needs_translation(title):
                    tr = None
                    for attempt in range(2):
                        try:
                            from services.news_service import ai_translate_and_format
                            tr = ai_translate_and_format(title, desc)
                            if tr and isinstance(tr, dict) and tr.get('title'):
                                break
                            tr = None
                        except Exception as e:
                            print(f"[WORLD_NEWS] 번역 시도 {attempt+1} 실패 ({source['name']}): {e}")
                            tr = None

                    if tr and isinstance(tr, dict):
                        if tr.get('title'):
                            art_title = f"[{source['name']}] {tr['title']}"
                        if tr.get('summary'):
                            art_summary = tr['summary'][:200]
                        if tr.get('content'):
                            art_content = tr['content'][:1000]
                    else:
                        # 번역 실패 시 저장하지 않음 (한글 전용 원칙)
                        print(f"[WORLD_NEWS] 번역 실패 - 저장 건너뜀: {title[:60]}")
                        continue

                article = NewsArticle(
                    source_name=source['name'],
                    published_at=_pub_naive(item.findtext('pubDate', '')),
                    title=art_title,
                    summary=art_summary,
                    content=art_content,
                    source_url=link,
                    category=source.get('category') or WORLD_CATEGORY_BY_SOURCE.get(source['name'], '세계뉴스'),
                    is_selected=True,
                    is_ai_generated=True,
                    world_ai_approved=True,
                    world_admin_approved=True,
                    ai_reason=f"자동수집: {source['name']} ({now.strftime('%m/%d')})",
                )
                db.session.add(article)
                total_new += 1

            db.session.commit()

        except Exception as e:
            print(f"[WORLD_NEWS] {source['name']} 수집 오류: {e}")
            continue

    # 2) Naver 국내뉴스 (양평·경기 관련) — 야간 지역별 수집 시 생략
    if categories:
        print(f"[WORLD_NEWS] 지역별 수집 완료: {total_new}건 신규 등록")
        return total_new
    try:
        client_id = current_app.config.get('NAVER_SEARCH_CLIENT_ID', '')
        client_secret = current_app.config.get('NAVER_SEARCH_CLIENT_SECRET', '')
    except RuntimeError:
        client_id = ''
        client_secret = ''

    if client_id and client_secret:
        naver_headers = {
            "X-Naver-Client-Id": client_id,
            "X-Naver-Client-Secret": client_secret,
        }
        naver_queries = ["양평군 소식", "경기도 양평 뉴스", "양평 한강"]
        for nq in naver_queries:
            try:
                params = {"query": nq, "display": 5, "sort": "date"}
                res = requests.get(
                    "https://openapi.naver.com/v1/search/news.json",
                    headers=naver_headers, params=params, timeout=10
                )
                if res.status_code != 200:
                    continue

                items = res.json().get('items', [])
                for item in items:
                    url = item.get('link', '')
                    if not url or url in seen_urls:
                        continue
                    if not _within_days(item.get('pubDate', ''), 1):
                        continue
                    if not _is_korean_source(url):
                        continue
                    seen_urls.add(url)

                    title = _clean_text(item.get('title', ''))
                    desc = _clean_text(item.get('description', ''))
                    if not title or len(title) < 5:
                        continue

                    if _is_foreign_topic(title, desc):
                        continue

                    if _news_url_blocked(url) or _is_video_url(url):
                        continue
                    existing = NewsArticle.query.filter_by(source_url=url).first()
                    if existing:
                        continue

                    is_yp = any(kw in title + desc for kw in ["양평", "경기도"])
                    category = _kr_category(title, desc)

                    article = NewsArticle(
                        source_name=_source_from_title(title),
                        published_at=_pub_naive(item.get('pubDate', '')),
                        title=f"[네이버] {title}",
                        summary=desc[:200],
                        content=f"<p>{desc[:1000]}</p>",
                        source_url=url,
                        category=category,
                        is_selected=False,
                        is_ai_generated=True,
                        kr_yp_ai_approved=False,
                        kr_yp_admin_approved=False,
                        ai_reason=f"자동수집(네이버·관리자 전용): 국내뉴스 ({now.strftime('%m/%d')})",
                    )
                    db.session.add(article)
                    total_new += 1

                db.session.commit()

            except Exception as e:
                print(f"[WORLD_NEWS] 네이버 수집 오류: {e}")
                continue

    print(f"[WORLD_NEWS] 자동 수집 완료: {total_new}건 신규 등록")
    return total_new
