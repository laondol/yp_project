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


def _fetch_blog_content(url):
    """블로그/카페/관공서 원본 본문 텍스트를 가져옴 (최대 2000자)"""
    if not url:
        return ''
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ko-KR,ko;q=0.9',
            'Referer': 'https://m.naver.com/',
        }
        # 관공서(yp21.go.kr) 처리
        if 'yp21.go.kr' in url:
            headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            headers['Referer'] = 'https://www.yp21.go.kr/'
            res = requests.get(url, headers=headers, timeout=10, allow_redirects=True)
            if res.status_code != 200:
                return ''
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(res.text, 'html.parser')
            content_td = soup.find('td', class_='p-table__content')
            if content_td:
                for tag in content_td.find_all(['script', 'style', 'iframe']):
                    tag.decompose()
                html_str = str(content_td)
                html_str = html_str.replace('\u3000', ' ')  # fullwidth space → space
                from bs4 import BeautifulSoup as _BS
                text = _BS(html_str, 'html.parser').get_text(separator='\n', strip=True)
            else:
                content_div = soup.find('div', id='contents')
                if content_div:
                    for tag in content_div.find_all(['script', 'style', 'iframe']):
                        tag.decompose()
                    text = content_div.get_text(separator='\n', strip=True)
                else:
                    text = soup.get_text(separator='\n', strip=True)
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            return '\n'.join(lines)[:2000]

        # 모바일 URL로 변환 시도
        mobile_url = url
        if 'blog.naver.com/PostView.naver' in url:
            import urllib.parse
            parsed = urllib.parse.urlparse(url)
            params = urllib.parse.parse_qs(parsed.query)
            blog_id = params.get('blogId', [''])[0]
            log_no = params.get('logNo', [''])[0]
            if blog_id and log_no:
                mobile_url = f'https://m.blog.naver.com/{blog_id}/{log_no}'
        elif 'blog.naver.com' in url:
            mobile_url = url.replace('blog.naver.com', 'm.blog.naver.com')

        res = requests.get(mobile_url, headers=headers, timeout=10, allow_redirects=True)
        if res.status_code != 200:
            return ''
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(res.text, 'html.parser')
        # 모바일 블로그 본문 영역 선택
        content_div = (
            soup.find('div', class_='se-main-container') or
            soup.find('div', class_='post-view-area') or
            soup.find('div', id='content') or
            soup.find('div', class_='content_area') or
            soup.find('div', class_='story_post') or
            soup.find('article') or
            soup.find('div', class_='entry-content')
        )
        if content_div:
            for tag in content_div.find_all(['script', 'style', 'iframe', 'ins', 'aside']):
                tag.decompose()
            text = content_div.get_text(separator='\n', strip=True)
        else:
            text = soup.get_text(separator='\n', strip=True)
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        return '\n'.join(lines)[:2000]
    except Exception as e:
        print(f'[YARD] 본문 가져오기 실패 ({url[:60]}): {e}')
        return ''


def _extract_best_date(text):
    """본문/제목에서 날짜 직접 추출 (AI 실패 폴백).
    우선순위: 연도 포함 날짜 → 연도+월 → 연도 없는 날짜(요일 표기 있을 때만).
    미래 후보 중 가장 가까운 날짜, 전부 과거면 가장 최근 과거 날짜 반환."""
    if not text:
        return None
    today = datetime.now().date()

    def _pick(cands):
        if not cands:
            return None
        future = sorted(c for c in cands if c >= today)
        return future[0] if future else max(cands)

    # 연도 포함: 2025.9.8 / 2025-09-08 / 2025년 9월 8일
    full = []
    for m in re.finditer(r'(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})', text):
        try:
            full.append(datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))).date())
        except ValueError:
            pass
    for m in re.finditer(r'(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일', text):
        try:
            full.append(datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))).date())
        except ValueError:
            pass
    d = _pick(full)
    if d:
        return datetime.combine(d, datetime.min.time())

    # 연도+월만 있는 경우 (예: "2026년 8월 ... 보고" → 해당 월 1일)
    month_only = []
    for m in re.finditer(r'(20\d{2})년\s*(\d{1,2})월(?!\s*\d)', text):
        try:
            month_only.append(datetime(int(m.group(1)), int(m.group(2)), 1).date())
        except ValueError:
            pass
    d = _pick(month_only)
    if d:
        return datetime.combine(d, datetime.min.time())

    # 연도 없는 날짜는 요일 표기(10/13(화), 9.8.(월))가 있을 때만 신뢰
    m_y = re.search(r'(20\d{2})년', text)
    base_year = int(m_y.group(1)) if m_y else today.year
    ymd = []
    for m in re.finditer(r'(\d{1,2})\s*[./]\s*(\d{1,2})[.]?\s*\(?[월화수목금토일]\)', text):
        try:
            ymd.append(datetime(base_year, int(m.group(1)), int(m.group(2))).date())
        except ValueError:
            pass
    for m in re.finditer(r'(\d{1,2})월\s*(\d{1,2})일\s*\(?[월화수목금토일]\)?', text):
        try:
            ymd.append(datetime(base_year, int(m.group(1)), int(m.group(2))).date())
        except ValueError:
            pass
    d = _pick(ymd)
    if d:
        return datetime.combine(d, datetime.min.time())
    return None


def _ai_event_filter(title, desc, full_content=''):
    """AI로 참여형 행사/공지 여부 판정 + 일시·장소 추출.
    단순 홍보·일반 정보·후기·지식 공유는 제외.
    과거 일시의 행사도 제외. AI 실패 시 휴리스틱.
    full_content: 원본 블로그 본문 (있으면 AI 판정에 활용)"""
    # 텍스트 본문 우선, 없으면 desc 사용
    analysis_text = full_content[:1500] if full_content else desc[:500]
    try:
        from services.news_service import _motif_text
        result = _motif_text(
            "당신은 양평 지역 소식 편집자입니다. 블로그 글이 주민이 참여할 수 있는 행사/모임/모집/프로그램 공지인지 판정합니다. JSON으로만 답합니다.",
            f"""오늘 날짜: {datetime.now().strftime('%Y-%m-%d (%A)')}

다음 블로그 글이 주민이 참여/방문할 수 있는 행사·모임·모집·프로그램 공지인지 판정하세요.
행사로 판정하려면 **장소와 일정이 모두** 있어야 합니다. 하나라도 텍스트에 없으면 false입니다.
단순 홍보, 일반 정보(지식/상식), 후기, 소개 글, 이미 지나간 행사는 false입니다.
event_date_iso는 원문에 적힌 날짜를 그대로 넣으세요. 과거 날짜여도 절대 오늘/올해 날짜로 바꾸지 마세요.
event_date_iso의 연도는 반드시 오늘 날짜를 기준으로 판단하세요.
이미지에만 정보가 있고 텍스트에 정보가 없으면 false로 판정하세요 (텍스트 정보 우선).
JSON으로만 출력:
{{"is_event": true 또는 false, "event_date": "표시용 일시 (예: 9/20, 없으면 빈 문자열)", "event_date_iso": "YYYY-MM-DD 형식 행사 날짜 (알 수 없으면 빈 문자열)", "start_time": "시작시간 HH:MM (없으면 빈 문자열)", "end_time": "종료시간 HH:MM (없으면 빈 문자열)", "event_place": "장소 (없으면 빈 문자열)", "contact": "연락처(전화번호) 또는 신청방법 (없으면 빈 문자열)", "reserve_url": "예약/신청 페이지 링크(http로 시작하는 주소, 없으면 빈 문자열)", "apply_start": "신청기간 시작 YYYY-MM-DD (없으면 빈 문자열)", "apply_end": "신청기간 종료 YYYY-MM-DD (없으면 빈 문자열)"}}

제목: {title[:200]}
내용:
{analysis_text}""",
            format_json=True,
        )
        if isinstance(result, dict) and 'is_event' in result:
            event_date_iso = str(result.get('event_date_iso') or '').strip()
            d = None
            try:
                d = datetime.strptime(event_date_iso, '%Y-%m-%d')
            except ValueError:
                d = None
            # AI가 날짜를 못 준 경우 제목/본문에서 직접 추출 (날짜 인식 폴백)
            if d is None:
                d = _extract_best_date(f"{title}\n{analysis_text}")
            # 과거 일정 — 날짜를 남겨 수집기의 '지난 일정 스킵'/삭제가 동작하게 함
            if d and d.date() < datetime.now().date():
                return {'is_event': False, 'event_date': d.strftime('%m/%d'), 'event_place': '',
                        'event_date_obj': d, 'event_end_obj': None, 'start_time': '', 'end_time': '',
                        'event_start': '', 'event_end': '', 'is_allday': False,
                        'apply_start': '', 'apply_end': ''}

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
            else:
                # 행사인데 날짜 정보가 아예 없으면 수집 제외 (일정 없는 단순 홍보)
                return {'is_event': False, 'event_date': '', 'event_place': '', 'event_date_obj': None,
                        'event_end_obj': None, 'start_time': '', 'end_time': '',
                        'event_start': '', 'event_end': '', 'is_allday': False,
                        'contact': str(result.get('contact') or '')[:100],
                        'reserve_url': str(result.get('reserve_url') or '')[:500]}
            # 행사 기준(사용자 확정): 장소와 일정이 모두 있어야 행사
            place = str(result.get('event_place') or '').strip()
            is_event = bool(result.get('is_event')) and bool(d) and bool(place)
            return {
                'is_event': is_event,
                'event_date': str(result.get('event_date') or '')[:60],
                'event_place': place[:100],
                'event_date_obj': start_dt or d,
                'event_end_obj': end_dt,
                'start_time': st,
                'end_time': et,
                'contact': str(result.get('contact') or '')[:100],
                'reserve_url': str(result.get('reserve_url') or '')[:500],
                'event_start': event_start_iso,
                'event_end': event_end_iso,
                'is_allday': is_allday,
                'apply_start': str(result.get('apply_start') or '')[:10],
                'apply_end': str(result.get('apply_end') or '')[:10],
            }
    except Exception as e:
        print(f'[YARD-AI] 판정 오류: {e}')
    # 휴리스틱 fallback (AI 실패 시): 키워드 + 본문 날짜 추출이 있을 때만 행사 (장소는 확인 불가)
    heur = any(k in title + desc for k in EVENT_KEYWORDS)
    hd = _extract_best_date(f'{title}\n{desc}')
    m_phone = re.search(r'(\d{2,3}-\d{3,4}-\d{4})', desc)
    return {'is_event': bool(heur and hd), 'event_date': hd.strftime('%m/%d') if hd else '',
            'event_place': '', 'event_date_obj': hd, 'event_end_obj': None,
            'start_time': '', 'end_time': '',
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


def _ai_polish_content(title, desc, judge):
    """AI로 스크랩 원본을 주민에게 보기 좋게 정리된 본문으로 변환"""
    try:
        from services.news_service import _motif_text
        parts = []
        d = judge.get('event_date_obj')
        if d:
            line = f"일시: {d.strftime('%Y년 %m월 %d일(%A)')}"
            st, et = judge.get('start_time'), judge.get('end_time')
            if st and et:
                line += f" {st}~{et}"
            elif st:
                line += f" {st}"
            parts.append(line)
        if judge.get('event_place'):
            parts.append(f"장소: {judge['event_place']}")
        if judge.get('contact'):
            parts.append(f"연락처: {judge['contact']}")
        if judge.get('reserve_url'):
            parts.append(f"신청/자세히보기: {judge['reserve_url']}")
        meta = '\n'.join(parts)

        result = _motif_text(
            "당신은 양평 지역 주민을 위한 마당 소식 편집자입니다. 원본 내용을 읽고 주민이 한눈에 이해하도록 깔끔하게 정리하세요.",
            f"""다음은 네이버 블로그/카페에서 수집한 양평 지역 행사/모임 소식입니다.
원본 내용을 참고하여 주민이 쉽게 읽을 수 있도록 정리하세요.

규칙:
- 불필요한 HTML 태그, 광고 문구, 블로그 소개글, 구독 유도 등은 제거
- 핵심 정보(일시, 장소, 참가대상, 참가방법, 비용, 준비물)만 추출하여 정리
- 반말~ 존댓말 혼용 금지, ~합니다체로 통일
- 500자 이내로 간결하게
- 모임/행사명은 제목으로, 나머지는 본문으로 구분
- 이미지만 붙여넣은 글, 의미 없는 글이면 원본 그대로 반환

제목: {title[:200]}
{meta}

원본 내용:
{desc[:1000]}

위 내용을 정리하여 본문만 출력하세요.""",
            format_json=False,
            timeout=60,
            max_tokens=1500,
        )
        if result and len(result.strip()) > 20:
            return result.strip()
    except Exception as e:
        print(f'[YARD-AI] 본문 정리 오류: {e}')
    # 실패 시 기본 포맷
    return _build_event_content_fallback(judge, desc)


def _build_event_content_fallback(judge, desc):
    """년월일 + 시작~종료시간 + 장소를 정리한 본문 생성 (AI 실패 시)"""
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
                if YardPost.query.filter_by(source_url=link).first() or _yard_url_blocked(link):
                    continue
                norm_title = re.sub(r'\s+', ' ', title).strip()
                if YardPost.query.filter_by(title=norm_title).first():
                    continue
                if _title_similarity_blocked(norm_title):
                    print(f'[YARD] 스킵(유사 제목): {norm_title[:40]}')
                    continue

                # 원본 블로그 본문 가져오기 (AI 판정 + 본문 정리에 활용)
                full_content = _fetch_blog_content(link)

                # 행사/공지성 판정 (단순 홍보·일반 정보 제외)
                judge = _ai_event_filter(title, desc, full_content)
                if not judge['is_event']:
                    print(f'[YARD-ORG] 스킵(홍보/일반): {title[:40]}')
                    continue

                p = YardPost(
                    title=title[:300],
                    content=_ai_polish_content(title, full_content or desc, judge),
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
    from models import YardPost, YardSchedule, db

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

                # 제목 기준 분류 (입찰/공지/행사) — 마을공지 등 공지성은 공지탭
                title, post_cat = _classify_notice_title(title, '[공지]')

                # URL 중복 차단
                existing = YardPost.query.filter_by(source_url=url).first() or _yard_url_blocked(url)
                if existing:
                    continue

                # 제목 중복 차단 (다른 URL이라도 같은 제목이면 스킵)
                norm_title = re.sub(r'\s+', ' ', title).strip()
                if YardPost.query.filter_by(title=norm_title).first():
                    continue
                if _title_similarity_blocked(norm_title):
                    print(f'[YARD] 스킵(유사 제목): {norm_title[:40]}')
                    continue

                # 원본 본문 가져오기 (AI 판정 + 본문 정리에 활용)
                full_content = _fetch_blog_content(url)

                # 행사/공지성 판정 (단순 홍보·일반 정보 제외)
                judge = _ai_event_filter(title, desc, full_content)
                if not judge['is_event']:
                    print(f'[YARD] 스킵(홍보/일반): {title[:40]}')
                    continue

                # 이미 지난 일정의 글은 수집 안 함 (승인 전 방치 후 삭제 대상 방지)
                _end_dt = judge.get('event_end_obj') or judge.get('event_date_obj') or _parse_dt(judge.get('apply_end'))
                if _end_dt and _end_dt.date() < datetime.now().date():
                    print(f'[YARD] 스킵(지난 일정): {title[:40]}')
                    continue

                platform = 'navercafe' if api == 'cafearticle' else 'naverblog'
                author = (it.get('bloggername') or it.get('cafename') or '').strip()[:100]

                p = YardPost(
                    title=title[:300],
                    content=_ai_polish_content(title, full_content or desc[:200], judge),
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
                    category=post_cat,
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

    # 오래된 자동수집건 정리 (30일 초과) — 연관 추가일정(yard_schedule) 먼저 삭제
    from datetime import timedelta
    cutoff = datetime.now() - timedelta(days=30)
    old_ids = [r[0] for r in YardPost.query.with_entities(YardPost.id).filter(
        YardPost.source_type == 'sns_auto',
        YardPost.created_at < cutoff,
    ).all()]
    if old_ids:
        YardSchedule.query.filter(YardSchedule.post_id.in_(old_ids)).delete(synchronize_session=False)
        YardPost.query.filter(YardPost.id.in_(old_ids)).delete(synchronize_session=False)
        db.session.commit()
        print(f'[YARD] 30일 경과 자동수집건 {len(old_ids)}건 삭제')

    # 3) 관리자 등록 단체의 블로그 RSS 수집 (등록 블로그 최신 글)
    org_new = _collect_org_rss()
    total_new += org_new

    # 4) 양평군청 공지사항 + 입찰공고 수집
    gov_new = _collect_yp_gov()
    total_new += gov_new

    # 5) 양평매력캠퍼스(평생학습센터) 강좌 + 공지사항 수집
    edu_new = _collect_yp_edu()
    total_new += edu_new

    # 6) 양평관광(tour.yp21.go.kr) 공지사항 수집
    tour_new = _collect_yp_tour()
    total_new += tour_new

    # 과거 건 중 미승인 삭제 (승인 건은 후기로 유지) — 전 소스 수집 후 최종 정리
    # ① 일정이 있고 지난 건 ② 일정 없는 건은 어제 이전 수집분(방치건) — 일정이 미래인 건은 유지
    from sqlalchemy import func as _sa_func, and_ as _sa_and, or_ as _sa_or
    _end_col = _sa_func.coalesce(YardPost.event_end, YardPost.event_date)
    _midnight = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    past_ids = [r[0] for r in YardPost.query.with_entities(YardPost.id).filter(
        YardPost.is_approved == False,
        _sa_or_(
            _sa_and_(_end_col.isnot(None), _end_col < _midnight),
            _sa_and_(_end_col.is_(None), YardPost.created_at < _midnight),
        ),
    ).all()]
    if past_ids:
        # 자동삭제된 글 URL은 블랙리스트에 기록 (게시판에 남아 있어도 재수집 차단)
        from sqlalchemy import text as _T
        _urls = [r[0] for r in YardPost.query.with_entities(YardPost.source_url).filter(
            YardPost.id.in_(past_ids),
            YardPost.source_url.isnot(None),
            YardPost.source_url != '',
        ).all()]
        for _u in _urls:
            db.session.execute(_T(
                "INSERT INTO yard_deleted_url (url, deleted_at) VALUES (:u, now()) "
                "ON CONFLICT (url) DO NOTHING"), {'u': _u[:500]})
        YardSchedule.query.filter(YardSchedule.post_id.in_(past_ids)).delete(synchronize_session=False)
        YardPost.query.filter(YardPost.id.in_(past_ids)).delete(synchronize_session=False)
        db.session.commit()
        print(f'[YARD] 과거(지난 일정/방치) 미승인 {len(past_ids)}건 삭제 (블랙리스트 {len(_urls)}건)')

    print(f'[YARD] 마당 소식 자동 수집 완료: 신규 {total_new}건 (단체블로그 {org_new}건, 군청 {gov_new}건, 평생학습 {edu_new}건, 관광 {tour_new}건)')
    return total_new

def _title_similarity_blocked(title):
    """정규화 제목이 기존 소식과 유사(80% 이상)하면 True - Google News 재수집 방지"""
    import difflib
    from models import YardPost
    norm = re.sub(r'\s+', ' ', title).strip()
    if not norm:
        return False
    recent = YardPost.query.order_by(YardPost.created_at.desc()).limit(200).all()
    for p in recent:
        t = re.sub(r'\s+', ' ', p.title or '').strip()
        if not t:
            continue
        if difflib.SequenceMatcher(None, norm, t).ratio() >= 0.8:
            return True
    return False


def _classify_notice_title(title, prefix, default_cat='event'):
    """제목 기준 분류: 입찰성(입찰/개찰)→[입찰]/bid, 공지·공고·알림→prefix/notice,
    그 외→default_cat (공식 게시판은 default_cat='notice': 행사 조건 미충족 시 무조건 공지)"""
    if '입찰' in title or '개찰' in title:
        return f'[입찰] {title}', 'bid'
    if any(k in title for k in ('공지', '공고', '알림')):
        return f'{prefix} {title}', 'notice'
    if default_cat == 'notice':
        return f'{prefix} {title}', 'notice'
    return title, 'event'


def _yard_url_blocked(url):
    """미승인으로 자동삭제된 글의 재수집 영구 차단 (yard_deleted_url 블랙리스트)"""
    from sqlalchemy import text as _T
    from models import db
    if not url:
        return False
    try:
        return db.session.execute(
            _T("SELECT 1 FROM yard_deleted_url WHERE url = :u"),
            {'u': url[:500]}).first() is not None
    except Exception:
        return False


def _collect_yp_gov():
    """양평군청 공지사항 + 입찰공고 수집"""
    from models import YardPost, db

    total = 0
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
    }

    # 1) 공지사항 수집
    try:
        res = requests.get(
            'https://www.yp21.go.kr/www/selectBbsNttList.do',
            params={'bbsNo': 1, 'key': 1111, 'pageIndex': 1},
            headers=headers, timeout=15
        )
        if res.status_code == 200:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(res.text, 'html.parser')
            rows = soup.select('table.board_list tbody tr') or soup.select('table tbody tr')
            saved = 0
            for row in rows[:10]:
                cols = row.find_all('td')
                if len(cols) < 3:
                    continue
                a_tag = row.find('a')
                if not a_tag:
                    continue
                title = a_tag.get_text(strip=True).removesuffix('새글').strip()
                if len(title) < 5:
                    continue
                link = a_tag.get('href', '')
                if link and not link.startswith('http'):
                    if link.startswith('./'):
                        link = link[2:]  # ./ → /selectBbsNttView...
                    link = f'https://www.yp21.go.kr/www/{link}'
                # 제목 기준 분류 (입찰/공지/행사)
                disp_title, post_cat = _classify_notice_title(title, '[군청공지]')
                # 중복 체크
                if YardPost.query.filter_by(source_url=link).first() or _yard_url_blocked(link):
                    continue
                if _title_similarity_blocked(disp_title):
                    continue
                # 본문 가져오기
                full_content = _fetch_blog_content(link)
                desc = full_content[:1500] if full_content else title

                # AI 판정 + 정리
                judge = _ai_event_filter(title, desc, full_content)
                polished = _ai_polish_content(title, desc, judge)

                # 이미 지난 일정의 글은 수집 안 함 (미승인으로 남아 삭제 대상이 되는 것 방지)
                _end_dt = judge.get('event_end_obj') or judge.get('event_date_obj') or _parse_dt(judge.get('apply_end'))
                if _end_dt and _end_dt.date() < datetime.now().date():
                    print(f'[YARD-GOV] 스킵(지난 일정): {title[:40]}')
                    continue
                # 장소+일정 미충족 → 공지 (행사 기준: 장소와 일정 모두 필요)
                if post_cat == 'event' and not judge['is_event']:
                    disp_title, post_cat = _classify_notice_title(title, '[군청공지]', default_cat='notice')

                p = YardPost(
                    title=disp_title,
                    content=polished,
                    source_type='gov_auto',
                    platform='yp21',
                    source_url=link[:500],
                    author_name='양평군청',
                    event_date=judge.get('event_date_obj'),
                    event_place=judge.get('event_place') or None,
                    contact=(judge.get('contact') or None),
                    reserve_url=(judge.get('reserve_url') or None),
                    is_approved=False,  # 관리자 승인 후 공개
                    category=post_cat,
                    created_at=datetime.now(),
                )
                db.session.add(p)
                total += 1
                saved += 1
            db.session.commit()
            print(f'[YARD-GOV] 공지사항: 확인 {len(rows[:10])}건, 신규 {saved}건')
    except Exception as e:
        print(f'[YARD-GOV] 공지사항 수집 오류: {e}')

    # 2) 고시/공고 수집 (구 입찰시스템 URL 폐쇄 → 공고판 대체, 입찰성은 [입찰] 분류)
    try:
        res = requests.get(
            'https://www.yp21.go.kr/www/selectBbsNttList.do',
            params={'bbsNo': 5, 'key': 1119, 'pageIndex': 1},
            headers=headers, timeout=15
        )
        if res.status_code == 200:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(res.text, 'html.parser')
            rows = soup.select('table.board_list tbody tr') or soup.select('table tbody tr')
            saved = 0
            for row in rows[:10]:
                cols = row.find_all('td')
                if len(cols) < 3:
                    continue
                a_tag = row.find('a')
                if not a_tag:
                    continue
                title = a_tag.get_text(strip=True).removesuffix('새글').strip()
                if len(title) < 5:
                    continue
                link = a_tag.get('href', '')
                if link and not link.startswith('http'):
                    if link.startswith('./'):
                        link = link[2:]
                    link = f'https://www.yp21.go.kr/www/{link}'
                disp_title, post_cat = _classify_notice_title(title, '[군청공고]', default_cat='notice')
                # 중복 체크
                if YardPost.query.filter_by(source_url=link).first() or _yard_url_blocked(link):
                    continue
                if _title_similarity_blocked(disp_title):
                    continue

                p = YardPost(
                    title=disp_title,
                    content=title,
                    source_type='gov_auto',
                    platform='yp21_gonggo',
                    source_url=link[:500],
                    author_name='양평군청',
                    is_approved=False,  # 관리자 승인 후 공개
                    category=post_cat,
                    created_at=datetime.now(),
                )
                db.session.add(p)
                total += 1
                saved += 1
            db.session.commit()
            print(f'[YARD-GOV] 고시·공고: 확인 {len(rows[:10])}건, 신규 {saved}건')
    except Exception as e:
        print(f'[YARD-GOV] 고시·공고 수집 오류: {e}')

    return total


def _collect_yp_edu():
    """양평매력캠퍼스(평생학습센터) 강좌 + 공지사항 수집 — AI 정리 포함"""
    from models import YardPost, db

    total = 0
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
    }

    # 1) 오프라인 강좌 수집
    try:
        res = requests.get(
            'https://ypedu.gseek.kr/user/course/offline/list',
            headers=headers, timeout=15
        )
        if res.status_code == 200:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(res.text, 'html.parser')
            cards = soup.select('.course-item, .card, .list-item, article, .item')
            if not cards:
                cards = soup.select('a[href*="/user/course/offline/"]')
            saved = 0
            for card in cards[:15]:
                a_tag = card if card.name == 'a' else card.find('a')
                if not a_tag:
                    continue
                title = a_tag.get_text(strip=True).removesuffix('새글').strip()
                if len(title) < 5 or '전체' in title or '목록' in title:
                    continue
                link = a_tag.get('href', '')
                if link and not link.startswith('http'):
                    link = f'https://ypedu.gseek.kr{link}'
                if not link or len(link) < 10:
                    continue
                if YardPost.query.filter_by(source_url=link).first() or _yard_url_blocked(link):
                    continue
                if _title_similarity_blocked(f'[평생학습] {title}'):
                    continue
                # 원본 본문 가져오기
                full_content = _fetch_blog_content(link)
                if not full_content:
                    parent = card.parent or card
                    full_content = parent.get_text(separator=' ', strip=True)[:500] if parent else title

                # AI 판정 + 정리
                judge = _ai_event_filter(title, full_content, full_content)
                polished = _ai_polish_content(title, full_content, judge)

                # 이미 지난 일정의 강좌는 수집 안 함
                _end_dt = judge.get('event_end_obj') or judge.get('event_date_obj') or _parse_dt(judge.get('apply_end'))
                if _end_dt and _end_dt.date() < datetime.now().date():
                    print(f'[YARD-EDU] 스킵(지난 일정 강좌): {title[:40]}')
                    continue

                # 행사 기준: 장소+일정 둘 다 충족 시에만 event, 아니면 공지
                _ev = bool(judge['is_event'])
                p = YardPost(
                    title=(f'[평생학습] {title}' if _ev else f'[평생학습공지] {title}'),
                    content=polished,
                    source_type='edu_auto',
                    platform='ypedu',
                    source_url=link[:500],
                    author_name='양평매력캠퍼스',
                    event_date=judge.get('event_date_obj'),
                    event_end=judge.get('event_end_obj'),
                    event_place=judge.get('event_place') or None,
                    contact=(judge.get('contact') or None),
                    reserve_url=(judge.get('reserve_url') or None),
                    apply_start=_parse_dt(judge.get('apply_start')),
                    apply_end=_parse_dt(judge.get('apply_end')),
                    is_approved=False,
                    category=('event' if _ev else 'notice'),
                    created_at=datetime.now(),
                )
                db.session.add(p)
                total += 1
                saved += 1
            db.session.commit()
            print(f'[YARD-EDU] 오프라인 강좌: 확인 {len(cards[:15])}건, 신규 {saved}건')
    except Exception as e:
        print(f'[YARD-EDU] 오프라인 강좌 수집 오류: {e}')

    # 2) 공지사항 수집
    try:
        res = requests.get(
            'https://ypedu.gseek.kr/user/board/notice/list',
            headers=headers, timeout=15
        )
        if res.status_code == 200:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(res.text, 'html.parser')
            rows = soup.select('table tbody tr')
            saved = 0
            for row in rows[:10]:
                a_tag = row.find('a')
                if not a_tag:
                    continue
                title = a_tag.get_text(strip=True).removesuffix('새글').strip()
                if len(title) < 5:
                    continue
                link = a_tag.get('href', '')
                if link and not link.startswith('http'):
                    link = f'https://ypedu.gseek.kr{link}'
                # 제목 기준 분류 (입찰/공지/행사)
                disp_title, post_cat = _classify_notice_title(title, '[평생학습공지]')
                if YardPost.query.filter_by(source_url=link).first() or _yard_url_blocked(link):
                    continue
                if _title_similarity_blocked(disp_title):
                    continue
                cols = row.find_all('td')

                # 원본 본문 가져오기
                full_content = _fetch_blog_content(link)
                if not full_content:
                    full_content = title

                # AI 판정 + 정리
                judge = _ai_event_filter(title, full_content, full_content)
                polished = _ai_polish_content(title, full_content, judge)

                # 이미 지난 일정의 글은 수집 안 함
                _end_dt = judge.get('event_end_obj') or judge.get('event_date_obj') or _parse_dt(judge.get('apply_end'))
                if _end_dt and _end_dt.date() < datetime.now().date():
                    print(f'[YARD-EDU] 스킵(지난 일정): {title[:40]}')
                    continue
                # 장소+일정 미충족 → 공지 (행사 기준: 장소와 일정 모두 필요)
                if post_cat == 'event' and not judge['is_event']:
                    disp_title, post_cat = _classify_notice_title(title, '[평생학습공지]', default_cat='notice')

                p = YardPost(
                    title=disp_title,
                    content=polished,
                    source_type='edu_auto',
                    platform='ypedu_notice',
                    source_url=link[:500],
                    author_name='양평매력캠퍼스',
                    event_date=judge.get('event_date_obj'),
                    event_place=judge.get('event_place') or None,
                    contact=(judge.get('contact') or None),
                    reserve_url=(judge.get('reserve_url') or None),
                    is_approved=False,
                    category=post_cat,
                    created_at=datetime.now(),
                )
                db.session.add(p)
                total += 1
                saved += 1
            db.session.commit()
            print(f'[YARD-EDU] 공지사항: 확인 {len(rows[:10])}건, 신규 {saved}건')
    except Exception as e:
        print(f'[YARD-EDU] 공지사항 수집 오류: {e}')

    return total


def _collect_yp_tour():
    """양평관광(tour.yp21.go.kr) 공지사항 수집 — AI 정리 포함"""
    from models import YardPost, db

    total = 0
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
    }

    try:
        res = requests.get(
            'https://tour.yp21.go.kr/www/selectBbsNttList.do',
            params={'bbsNo': 1, 'key': 66, 'pageIndex': 1},
            headers=headers, timeout=15
        )
        if res.status_code != 200:
            print(f'[YARD-TOUR] 접근 실패: {res.status_code}')
            return 0

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(res.text, 'html.parser')
        rows = soup.select('table tbody tr')
        saved = 0

        for row in rows[:10]:
            cols = row.find_all('td')
            if len(cols) < 3:
                continue
            a_tag = row.find('a')
            if not a_tag:
                continue
            title = a_tag.get_text(strip=True).removesuffix('새글').strip()
            if len(title) < 5:
                continue

            link = a_tag.get('href', '')
            if link and not link.startswith('http'):
                if link.startswith('./'):
                    link = link[2:]
                link = f'https://tour.yp21.go.kr/www/{link}'

            if YardPost.query.filter_by(source_url=link).first() or _yard_url_blocked(link):
                continue
            if _title_similarity_blocked(f'[관광] {title}'):
                continue

            full_content = _fetch_blog_content(link)
            desc = full_content[:1500] if full_content else title

            judge = _ai_event_filter(title, desc, full_content)
            polished = _ai_polish_content(title, desc, judge)

            # 이미 지난 일정의 글은 수집 안 함
            _end_dt = judge.get('event_end_obj') or judge.get('event_date_obj') or _parse_dt(judge.get('apply_end'))
            if _end_dt and _end_dt.date() < datetime.now().date():
                print(f'[YARD-TOUR] 스킵(지난 일정): {title[:40]}')
                continue

            # 행사 기준: 장소+일정 둘 다 충족 시에만 event, 아니면 공지
            _ev = bool(judge['is_event'])
            p = YardPost(
                title=f'[관광] {title}',
                content=polished,
                source_type='tour_auto',
                platform='tour_yp21',
                source_url=link[:500],
                author_name='양평관광',
                event_date=judge.get('event_date_obj'),
                event_place=judge.get('event_place') or None,
                contact=(judge.get('contact') or None),
                reserve_url=(judge.get('reserve_url') or None),
                is_approved=False,
                category=('event' if _ev else 'notice'),
                created_at=datetime.now(),
            )
            db.session.add(p)
            total += 1
            saved += 1

        db.session.commit()
        print(f'[YARD-TOUR] 관광공지: 확인 {len(rows[:10])}건, 신규 {saved}건')
    except Exception as e:
        print(f'[YARD-TOUR] 관광공지 수집 오류: {e}')

    return total
