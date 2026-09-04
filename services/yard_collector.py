"""마당 소식 자동 수집 — 네이버 블로그/카페의 양평 단체 공지·소식
1) 관리자 등록 단체(org)의 네이버 블로그 RSS 수집 (등록 블로그 최신 글)
2) 네이버 검색 API로 양평 단체 공지 키워드 수집
인스타그램/페이스북/카카오는 봇 차단(로그인 장벽)으로 자동 크롤링 불가 → 관리자 URL 등록으로 보완"""
import re
import requests
import xml.etree.ElementTree as ET
from datetime import datetime


def _clean(text):
    return re.sub(r'<[^>]+>', '', text or '').strip()


def _collect_org_rss():
    """관리자가 등록한 단체의 네이버 블로그 RSS에서 최신 글 수집"""
    from models import YardOrg, YardPost, db

    total = 0
    orgs = YardOrg.query.filter_by(is_active=True, platform='naverblog').all()
    for org in orgs:
        # URL에서 블로그 ID 추출 (blog.naver.com/{blogId})
        m = re.search(r'blog\.naver\.com/([A-Za-z0-9_-]+)', org.url or '')
        if not m:
            continue
        blog_id = m.group(1)
        try:
            res = requests.get(
                f'https://rss.blog.naver.com/{blog_id}.xml',
                headers={'User-Agent': 'Mozilla/5.0'}, timeout=15
            )
            if res.status_code != 200:
                print(f'[YARD-ORG] {org.name}: RSS 오류 {res.status_code}')
                continue
            root = ET.fromstring(res.content)
            items = root.findall('.//item')
            saved = 0
            for it in items[:5]:
                title = _clean(it.findtext('title', ''))
                link = (it.findtext('link', '') or '').split('?')[0].strip()
                desc = _clean(it.findtext('description', ''))[:200]
                if len(title) < 5 or not link:
                    continue
                # URL/제목 중복 차단
                if YardPost.query.filter_by(source_url=link).first():
                    continue
                norm_title = re.sub(r'\s+', ' ', title).strip()
                if YardPost.query.filter_by(title=norm_title).first():
                    continue

                p = YardPost(
                    title=title[:300],
                    content=desc,
                    source_type='sns_auto',
                    platform='naverblog',
                    source_url=link[:500],
                    author_name=org.name[:100],
                    is_approved=False,  # 관리자 승인 후 공개
                    created_at=datetime.now(),
                )
                db.session.add(p)
                total += 1
                saved += 1
            db.session.commit()
            print(f'[YARD-ORG] {org.name} ({blog_id}): 최신 {len(items[:5])}건 확인, 신규 {saved}건 저장')
        except Exception as e:
            print(f'[YARD-ORG] {org.name} 수집 오류: {e}')
            continue
    return total


def collect_yard_notices():
    """네이버 블로그/카페에서 양평 단체 공지·소식을 수집하여 마당에 자동 등록"""
    from flask import current_app
    from models import YardPost, db

    try:
        cid = current_app.config.get('NAVER_SEARCH_CLIENT_ID', '')
        csec = current_app.config.get('NAVER_SEARCH_CLIENT_SECRET', '')
    except RuntimeError:
        print('[YARD] Flask app context 필요')
        return 0
    if not cid or not csec:
        print('[YARD] Naver API 키 없음')
        return 0

    headers = {"X-Naver-Client-Id": cid, "X-Naver-Client-Secret": csec}
    now = datetime.now()
    total_new = 0

    # (API종류, 검색어) 조합
    searches = [
        ('blog', '양평 공지사항'),
        ('blog', '양평 모집'),
        ('blog', '양평 마을회'),
        ('blog', '양평 축제'),
        ('blog', '양평 단체'),
        ('cafearticle', '양평 공지'),
        ('cafearticle', '양평 모임'),
        ('cafearticle', '양평 행사'),
    ]

    seen_urls = set()
    for api, q in searches:
        try:
            res = requests.get(
                f'https://openapi.naver.com/v1/search/{api}.json',
                headers=headers, params={'query': q, 'display': 5, 'sort': 'date'}, timeout=10
            )
            if res.status_code != 200:
                print(f'[YARD] {q}: Naver API 오류 {res.status_code}')
                continue

            items = res.json().get('items', [])
            saved = 0
            for it in items:
                url = it.get('link', '')
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)

                title = _clean(it.get('title', ''))
                desc = _clean(it.get('description', ''))[:300]
                if len(title) < 5:
                    continue
                # 양평 관련만
                if '양평' not in title + desc:
                    continue

                # URL 중복 차단
                existing = YardPost.query.filter_by(source_url=url).first()
                if existing:
                    continue

                # 제목 중복 차단 (다른 URL이라도 같은 제목이면 스킵)
                norm_title = re.sub(r'\s+', ' ', title).strip()
                if YardPost.query.filter_by(title=norm_title).first():
                    continue

                platform = 'navercafe' if api == 'cafearticle' else 'naverblog'
                author = (it.get('bloggername') or it.get('cafename') or '').strip()[:100]

                p = YardPost(
                    title=title[:300],
                    content=desc,
                    source_type='sns_auto',
                    platform=platform,
                    source_url=url[:500],
                    author_name=author,
                    is_approved=False,  # 관리자 승인 후 공개
                    created_at=now,
                )
                db.session.add(p)
                total_new += 1
                saved += 1

            db.session.commit()
            print(f'[YARD] {q}: {len(items)}건 수신, 신규 {saved}건 저장')
        except Exception as e:
            print(f'[YARD] {q} 수집 오류: {e}')
            continue

    # 오래된 자동수집건 정리 (30일 초과)
    from datetime import timedelta
    cutoff = datetime.now() - timedelta(days=30)
    old = YardPost.query.filter(
        YardPost.source_type == 'sns_auto',
        YardPost.created_at < cutoff,
    )
    old_cnt = old.count()
    if old_cnt:
        old.delete(synchronize_session=False)
        db.session.commit()
        print(f'[YARD] 30일 경과 자동수집건 {old_cnt}건 삭제')

    # 3) 관리자 등록 단체의 블로그 RSS 수집 (등록 블로그 최신 글)
    org_new = _collect_org_rss()
    total_new += org_new

    print(f'[YARD] 마당 소식 자동 수집 완료: 신규 {total_new}건 (단체블로그 {org_new}건)')
    return total_new
