"""마당 소식 자동 수집 — 네이버 블로그/카페의 양평 단체 공지·소식
인스타그램/페이스북은 봇 차단(로그인 장벽)으로 자동 크롤링 불가 → 관리자 URL 등록으로 보완"""
import re
import requests
from datetime import datetime


def _clean(text):
    return re.sub(r'<[^>]+>', '', text or '').strip()


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

                existing = YardPost.query.filter_by(source_url=url).first()
                if existing:
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

    print(f'[YARD] 마당 소식 자동 수집 완료: 신규 {total_new}건')
    return total_new
