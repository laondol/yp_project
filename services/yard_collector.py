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


def _parse_dt(s):
    """YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM → datetime. 실패 시 None"""
    s = (s or '').strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        try:
            return datetime.strptime(s, '%Y-%m-%d')
        except ValueError:
            return None


# 행사/공지성 판정용 키워드 (AI 실패 시 휴리스틱)
EVENT_KEYWORDS = ['행사', '축제', '모집', '신청', '참가', '모임', '일시', '장소', '체험',
                  '교육', '공연', '마켓', '박람회', '세미나', '강좌', '상담', '설명회', '시장', '접수']


def _ai_event_filter(title, desc):
    """AI로 참여형 행사/공지 여부 판정 + 일시·장소 추출.
    단순 홍보·일반 정보·후기·지식 공유는 제외.
    과거 일시의 행사도 제외. AI 실패 시 휴리스틱."""
    try:
        from services.news_service import _motif_text
        result = _motif_text(
            "당신은 양평 지역 소식 편집자입니다. 블로그 글이 주민이 참여할 수 있는 행사/모임/모집/프로그램 공지인지 판정합니다. JSON으로만 답합니다.",
            f"""오늘 날짜: {datetime.now().strftime('%Y-%m-%d (%A)')}

다음 블로그 글이 주민이 참여/방문할 수 있는 행사·모임·모집·프로그램 공지인지 판정하세요.
일시·장소 정보가 있는 실제 참여형 소식만 true입니다.
단순 홍보, 일반 정보(지식/상식), 후기, 소개 글, 이미 지나간 행사는 false입니다.
event_date_iso의 연도는 반드시 오늘 날짜를 기준으로 판단하세요.
JSON으로만 출력:
{{"is_event": true 또는 false, "event_date": "표시용 일시 (예: 9/20, 없으면 빈 문자열)", "event_date_iso": "YYYY-MM-DD 형식 행사 날짜 (알 수 없으면 빈 문자열)", "start_time": "시작시간 HH:MM (없으면 빈 문자열)", "end_time": "종료시간 HH:MM (없으면 빈 문자열)", "event_place": "장소 (없으면 빈 문자열)", "contact": "연락처(전화번호) 또는 신청방법 (없으면 빈 문자열)", "reserve_url": "예약/신청 페이지 링크(http로 시작하는 주소, 없으면 빈 문자열)", "apply_start": "신청기간 시작 YYYY-MM-DD (없으면 빈 문자열)", "apply_end": "신청기간 종료 YYYY-MM-DD (없으면 빈 문자열)"}}

제목: {title[:150]}
내용: {desc[:500]}""",
            format_json=True,
        )
        if isinstance(result, dict) and 'is_event' in result:
            event_date_iso = str(result.get('event_date_iso') or '').strip()
            d = None
            try:
                d = datetime.strptime(event_date_iso, '%Y-%m-%d')
                # 연도 보정: AI가 엉뚱한 연도를 줬다면 올해로 교정
                if d.year != datetime.now().year:
                    d = d.replace(year=datetime.now().year)
                    event_date_iso = d.strftime('%Y-%m-%d')
                # 과거 행사 제외
                if d.date() < datetime.now().date():
                    return {'is_event': False, 'event_date': '', 'event_place': '', 'event_date_obj': None,
                            'event_end_obj': None, 'start_time': '', 'end_time': '',
                            'event_start': '', 'event_end': '', 'is_allday': False}
            except ValueError:
                event_date_iso = ''
                d = None

            # 시작/종료시간 파싱 → datetime 조합
            start_dt = end_dt = None
            st = str(result.get('start_time') or '').strip()
            et = str(result.get('end_time') or '').strip()
            if d:
                for tm_str, target in [(st, 'start'), (et, 'end')]:
                    m2 = re.match(r'^(\d{1,2}):(\d{2})$', tm_str)
                    if m2:
                        try:
                            dtv = datetime.combine(d.date(), datetime.strptime(f"{int(m2.group(1)):02d}:{m2.group(2)}", '%H:%M').time())
                            if target == 'start':
                                start_dt = dtv
                            else:
                                end_dt = dtv
                        except ValueError:
                            pass
            is_allday = not st
            event_start_iso = ''
            event_end_iso = ''
            if d:
                event_start_iso = (start_dt or datetime.combine(d.date(), datetime.min.time())).strftime('%Y-%m-%dT%H:%M')
                event_end_iso = end_dt.strftime('%Y-%m-%dT%H:%M') if end_dt else event_start_iso
            return {
                'is_event': bool(result.get('is_event')),
                'event_date': str(result.get('event_date') or '')[:60],
                'event_place': str(result.get('event_place') or '')[:100],
                'event_date_obj': start_dt or d,
                'event_end_obj': end_dt,
                'start_time': st,
                'end_time': et,
                'contact': str(result.get('contact') or '')[:100],
                'reserve_url': str(result.get('reserve_url') or '')[:500],
                'event_start': event_start_iso,
                'event_end': event_end_iso,
                'is_allday': is_allday,
            }
    except Exception as e:
        print(f'[YARD-AI] 판정 오류: {e}')
    # 휴리스틱 fallback (과거 판단 불가 → 수집 허용, 연락처는 전화번호 정규식 추출)
    heur = any(k in title + desc for k in EVENT_KEYWORDS)
    m_phone = re.search(r'(\d{2,3}-\d{3,4}-\d{4})', desc)
    return {'is_event': heur, 'event_date': '', 'event_place': '', 'event_date_obj': None,
            'event_end_obj': None, 'start_time': '', 'end_time': '',
            'contact': m_phone.group(1) if m_phone else '', 'reserve_url': '',
            'event_start': '', 'event_end': '', 'is_allday': False, 'apply_start': '', 'apply_end': ''}


def _geocode_place(place):
    """장소 문자열 → (lat, lng). 실패 시 (None, None)"""
    if not place:
        return None, None
    try:
        from services.geocode import geocode_text
        return geocode_text(place)
    except Exception:
        return None, None


def _build_event_content(judge, desc):
    """년월일 + 시작~종료시간 + 장소를 정리한 본문 생성"""
    parts = []
    d = judge.get('event_date_obj')
    if d:
        line = f"📅 {d.strftime('%Y-%m-%d(%a)')}"
        st, et = judge.get('start_time'), judge.get('end_time')
        if st and et:
            line += f" {st}~{et}"
        elif st:
            line += f" {st}"
        parts.append(line)
    if judge.get('event_place'):
        parts.append(f"📍 장소: {judge['event_place']}")
    if desc:
        parts.append(desc)
    return '\n'.join(parts)[:600]


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

                # 행사/공지성 판정 (단순 홍보·일반 정보 제외)
                judge = _ai_event_filter(title, desc)
                if not judge['is_event']:
                    print(f'[YARD-ORG] 스킵(홍보/일반): {title[:40]}')
                    continue

                p = YardPost(
                    title=title[:300],
                    content=_build_event_content(judge, desc),
                    source_type='sns_auto',
                    platform='naverblog',
                    source_url=link[:500],
                    author_name=org.name[:100],
                    event_date=judge.get('event_date_obj'),
                    event_end=judge.get('event_end_obj'),
                    event_place=judge.get('event_place') or None,
                    is_allday=(judge.get('is_allday') or False),
                    contact=(judge.get('contact') or None),
                    apply_start=_parse_dt(judge.get('apply_start')),
                    apply_end=_parse_dt(judge.get('apply_end')),
                    reserve_url=(judge.get('reserve_url') or None),
                    is_approved=False,  # 관리자 승인 후 공개
                    created_at=datetime.now(),
                )
                # 장소 지오코딩 (거리 정렬용)
                if judge.get('event_place'):
                    lat, lng = _geocode_place(judge['event_place'])
                    p.latitude, p.longitude = lat, lng
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

    # (API종류, 검색어) 조합 — 블로그 키워드 수집은 제거(관리자 등록 단체 블로그 RSS로 대체), 카페만 유지
    searches = [
        ('cafearticle', '양평 공지'),
        ('cafearticle', '양평 모임'),
        ('cafearticle', '양평 행사'),
        ('cafearticle', '양평 모집'),
        ('cafearticle', '양평 단체'),
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

                # 행사/공지성 판정 (단순 홍보·일반 정보 제외)
                judge = _ai_event_filter(title, desc)
                if not judge['is_event']:
                    print(f'[YARD] 스킵(홍보/일반): {title[:40]}')
                    continue

                platform = 'navercafe' if api == 'cafearticle' else 'naverblog'
                author = (it.get('bloggername') or it.get('cafename') or '').strip()[:100]

                p = YardPost(
                    title=title[:300],
                    content=_build_event_content(judge, desc[:200]),
                    source_type='sns_auto',
                    platform=platform,
                    source_url=url[:500],
                    author_name=author,
                    event_date=judge.get('event_date_obj'),
                    event_end=judge.get('event_end_obj'),
                    event_place=judge.get('event_place') or None,
                    is_allday=(judge.get('is_allday') or False),
                    contact=(judge.get('contact') or None),
                    apply_start=_parse_dt(judge.get('apply_start')),
                    apply_end=_parse_dt(judge.get('apply_end')),
                    reserve_url=(judge.get('reserve_url') or None),
                    is_approved=False,  # 관리자 승인 후 공개
                    created_at=now,
                )
                # 장소 지오코딩 (거리 정렬용)
                if judge.get('event_place'):
                    lat, lng = _geocode_place(judge['event_place'])
                    p.latitude, p.longitude = lat, lng
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
