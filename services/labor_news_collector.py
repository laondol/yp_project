import requests
import re
import xml.etree.ElementTree as ET
from datetime import datetime

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

WORLD_SOURCES = [
    {"name": "AP", "domain": "apnews.com", "query": "site:apnews.com"},
    {"name": "로이터", "domain": "reuters.com", "query": "site:reuters.com"},
    {"name": "AFP", "domain": "afp.com", "query": "site:afp.com"},
    {"name": "뉴욕타임스", "domain": "nytimes.com", "query": "site:nytimes.com"},
    {"name": "월스트리트저널", "domain": "wsj.com", "query": "site:wsj.com"},
    {"name": "워싱턴포스트", "domain": "washingtonpost.com", "query": "site:washingtonpost.com"},
    {"name": "BBC", "domain": "bbc.com", "query": "site:bbc.com"},
    {"name": "파이넨션타임스", "domain": "ft.com", "query": "site:ft.com"},
    {"name": "더가디언", "domain": "theguardian.com", "query": "site:theguardian.com"},
    {"name": "니혼게이자이", "domain": "nikkei.com", "query": "site:nikkei.com"},
]

KR_YP_KEYWORDS = [
    "양평", "경기도", "한강", "용문산", "남한강",
    "양평군", "강상면", "강하면", "양동면", "서종면",
    "지평면", "양서면", "/umd", "개군면",
    "농산물", "전원주택", "귀농", "귀촌", "관광",
]


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
        print("[LABOR_NEWS] Naver API 키 없음")
        return 0

    headers = {
        "X-Naver-Client-Id": client_id,
        "X-Naver-Client-Secret": client_secret,
    }

    total_new = 0
    seen_urls = set()
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
                print(f"[LABOR_NEWS] {source['name']}: Naver API 오류 {res.status_code}")
                continue

            items = res.json().get('items', [])
            for item in items:
                url = item.get('link', '')
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)

                title = re.sub(r'<[^>]+>', '', item.get('title', ''))
                desc = re.sub(r'<[^>]+>', '', item.get('description', ''))
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
                    is_selected=False,
                    is_ai_generated=True,
                    ai_reason=f"자동 수집: {source['name']} ({now.strftime('%m/%d')})",
                    created_by=None,
                )
                db.session.add(article)
                total_new += 1

            db.session.commit()

        except Exception as e:
            print(f"[LABOR_NEWS] {source['name']} 수집 오류: {e}")
            continue

    print(f"[LABOR_NEWS] 자동 수집 완료: {total_new}건 신규 등록")
    return total_new


def collect_kr_yp_news_rss():
    """Naver API 실패 시 Google News RSS로 대한민국·양평 뉴스 수집 (API 키 불필요)"""
    from models import db, NewsArticle

    total_new = 0
    seen_urls = set()
    now = datetime.now()

    search_queries = ["양평", "경기도 양평"]

    for source in KR_YP_SOURCES:
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
                print(f"[KR_YP_RSS] {source['name']} + '{sq}': {len(items)}건 수신")

                for item in items[:5]:
                    title = (item.findtext('title', '') or '').strip()
                    link = (item.findtext('link', '') or '').strip()
                    desc = (item.findtext('description', '') or '').strip()

                    if not title or not link or link in seen_urls:
                        continue
                    seen_urls.add(link)

                    title = re.sub(r'<[^>]+>', '', title)
                    desc = re.sub(r'<[^>]+>', '', desc)
                    if len(title) < 5:
                        continue

                    existing = NewsArticle.query.filter_by(source_url=link).first()
                    if existing:
                        continue

                    is_yp = any(kw in title + desc for kw in ["양평", "경기도"])
                    article = NewsArticle(
                        title=f"[{source['name']}] {title}",
                        summary=desc[:200],
                        content=f"<p>{desc[:1000]}</p>",
                        source_url=link,
                        category="양평소식" if is_yp else "대한민국뉴스",
                        is_selected=False,
                        is_ai_generated=True,
                        kr_yp_ai_approved=True,
                        ai_reason=f"자동수집(RSS): {source['name']} ({now.strftime('%m/%d')})",
                    )
                    db.session.add(article)
                    total_new += 1

                db.session.commit()

            except Exception as e:
                print(f"[KR_YP_RSS] {source['name']} 수집 오류: {e}")
                continue

    print(f"[KR_YP_RSS] RSS 수집 완료: {total_new}건 신규 등록")
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
        return collect_kr_yp_news_rss()

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
        "양평군 뉴스",
        "경기도 양평",
        "양평 한강",
        "대한민국 정책 뉴스",
        "국내 경제 뉴스",
    ]

    for source in KR_YP_SOURCES:
        for sq in search_queries[:2]:
            try:
                query = f"{source['query']} {sq}"
                params = {"query": query, "display": 5, "sort": "date"}
                res = requests.get(
                    "https://openapi.naver.com/v1/search/news.json",
                    headers=headers, params=params, timeout=10
                )
                if res.status_code != 200:
                    api_calls_fail += 1
                    print(f"[KR_YP_NEWS] {source['name']}: Naver API 오류 {res.status_code} (query: {query[:30]})")
                    continue
                api_calls_ok += 1

                items = res.json().get('items', [])
                print(f"[KR_YP_NEWS] {source['name']} + '{sq}': {len(items)}건 수신")
                for item in items:
                    url = item.get('link', '')
                    if not url or url in seen_urls:
                        continue
                    seen_urls.add(url)

                    title = re.sub(r'<[^>]+>', '', item.get('title', ''))
                    desc = re.sub(r'<[^>]+>', '', item.get('description', ''))
                    if not title or len(title) < 5:
                        continue

                    existing = NewsArticle.query.filter_by(source_url=url).first()
                    if existing:
                        skipped_existing += 1
                        continue

                    is_yp = any(kw in title + desc for kw in ["양평", "경기도"])
                    category = "양평소식" if is_yp else "대한민국뉴스"

                    article = NewsArticle(
                        title=f"[{source['name']}] {title}",
                        summary=desc[:200],
                        content=f"<p>{desc[:1000]}</p>",
                        source_url=url,
                        category=category,
                        is_selected=False,
                        is_ai_generated=True,
                        kr_yp_ai_approved=True,
                        ai_reason=f"자동수집: {source['name']} ({now.strftime('%m/%d')})",
                    )
                    db.session.add(article)
                    total_new += 1

                db.session.commit()

            except Exception as e:
                api_calls_fail += 1
                print(f"[KR_YP_NEWS] {source['name']} 수집 오류: {e}")
                continue

    # Naver API 전체 실패 시 Google News RSS로 fallback (API 키 불필요)
    if api_calls_ok == 0 and api_calls_fail > 0:
        print("[KR_YP_NEWS] Naver API 전체 실패 - Google News RSS fallback 사용")
        return collect_kr_yp_news_rss()

    print(f"[KR_YP_NEWS] 자동 수집 완료: 신규 {total_new}건, 기존 스킵 {skipped_existing}건 (API 성공 {api_calls_ok}/실패 {api_calls_fail})")
    return total_new


def collect_world_news():
    """10개 세계 언론사에서 글로벌 뉴스를 자동 수집하여 DB에 저장 (Google News RSS + Naver)"""
    from flask import current_app
    from models import db, NewsArticle

    total_new = 0
    seen_urls = set()
    now = datetime.now()

    # 1) Google News RSS로 각 소스별 수집
    for source in WORLD_SOURCES:
        try:
            rss_url = f"https://news.google.com/rss/search?q=site:{source['domain']}&hl=en&gl=US&ceid=US:en"
            res = requests.get(rss_url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
            if res.status_code != 200:
                print(f"[WORLD_NEWS] {source['name']}: Google RSS 오류 {res.status_code}")
                continue

            root = ET.fromstring(res.content)
            items = root.findall('.//item')

            for item in items[:5]:
                title = (item.findtext('title', '') or '').strip()
                link = (item.findtext('link', '') or '').strip()
                desc = (item.findtext('description', '') or '').strip()

                if not title or not link or link in seen_urls:
                    continue
                seen_urls.add(link)

                title = re.sub(r'<[^>]+>', '', title)
                desc = re.sub(r'<[^>]+>', '', desc)
                if len(title) < 5:
                    continue

                existing = NewsArticle.query.filter_by(source_url=link).first()
                if existing:
                    continue

                art_title = f"[{source['name']}] {title}"
                art_summary = desc[:200]
                art_content = f"<p>{desc[:1000]}</p>"

                try:
                    from services.news_service import ai_translate_and_format
                    eng_ratio = sum(1 for c in title if c.isascii() and c.isalpha()) / max(sum(1 for c in title if c.isalpha()), 1)
                    if eng_ratio > 0.5:
                        tr = ai_translate_and_format(title, desc)
                        if tr and isinstance(tr, dict):
                            if tr.get('title'):
                                art_title = f"[{source['name']}] {tr['title']}"
                            if tr.get('summary'):
                                art_summary = tr['summary'][:200]
                            if tr.get('content'):
                                art_content = tr['content'][:1000]
                except Exception:
                    pass

                article = NewsArticle(
                    title=art_title,
                    summary=art_summary,
                    content=art_content,
                    source_url=link,
                    category="세계뉴스",
                    is_selected=False,
                    is_ai_generated=True,
                    world_ai_approved=True,
                    ai_reason=f"자동수집: {source['name']} ({now.strftime('%m/%d')})",
                )
                db.session.add(article)
                total_new += 1

            db.session.commit()

        except Exception as e:
            print(f"[WORLD_NEWS] {source['name']} 수집 오류: {e}")
            continue

    # 2) Naver 국내뉴스 (양평·경기 관련)
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
        naver_queries = ["양평군 소식", "경기도 양평 뉴스", "양평 한강", "국내 주요 뉴스"]
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
                    if not _is_korean_source(url):
                        continue
                    seen_urls.add(url)

                    title = re.sub(r'<[^>]+>', '', item.get('title', ''))
                    desc = re.sub(r'<[^>]+>', '', item.get('description', ''))
                    if not title or len(title) < 5:
                        continue

                    existing = NewsArticle.query.filter_by(source_url=url).first()
                    if existing:
                        continue

                    is_yp = any(kw in title + desc for kw in ["양평", "경기도"])
                    category = "양평소식" if is_yp else "대한민국뉴스"

                    article = NewsArticle(
                        title=f"[네이버] {title}",
                        summary=desc[:200],
                        content=f"<p>{desc[:1000]}</p>",
                        source_url=url,
                        category=category,
                        is_selected=False,
                        is_ai_generated=True,
                        kr_yp_ai_approved=True,
                        ai_reason=f"자동수집: 네이버 국내뉴스 ({now.strftime('%m/%d')})",
                    )
                    db.session.add(article)
                    total_new += 1

                db.session.commit()

            except Exception as e:
                print(f"[WORLD_NEWS] 네이버 수집 오류: {e}")
                continue

    print(f"[WORLD_NEWS] 자동 수집 완료: {total_new}건 신규 등록")
    return total_new
