"""마당 — 양평 단체 SNS 공지 + 관리자 직접 등록 + 마을행사 연동 + 댓글"""
import os
import re
from flask import Blueprint, request, jsonify, session, current_app
from models import db, YardPost, YardComment, YardOrg, YardSchedule, VillageEvent, User
from datetime import datetime

yard_bp = Blueprint('yard_bp', __name__)

_WEEKDAYS_KR = ['월', '화', '수', '목', '금', '토', '일']


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


def _event_display(p):
    """행사 일시 표시: 09/20(일) 10:00~16:00, 09/20(일)~09/22(화) 종일 등"""
    if not p.event_date:
        return ''
    kr = _WEEKDAYS_KR[p.event_date.weekday()]
    disp = p.event_date.strftime(f'%m/%d({kr})')
    if p.is_allday:
        # 종일: 종료일이 시작일과 다르면 기간 표시
        if p.event_end and p.event_end.date() != p.event_date.date():
            ke = _WEEKDAYS_KR[p.event_end.weekday()]
            disp += '~' + p.event_end.strftime(f'%m/%d({ke})')
        disp += ' 종일'
    elif p.event_date.hour or p.event_date.minute:
        disp += ' ' + p.event_date.strftime('%H:%M')
        if p.event_end:
            disp += '~' + p.event_end.strftime('%H:%M')
    return disp


def _apply_display(p):
    """신청기간 표시: 09/05 ~ 09/15 (종일이면 시간 제외)"""
    if not p.apply_start:
        return ''
    kr = _WEEKDAYS_KR[p.apply_start.weekday()]
    s = p.apply_start.strftime(f'%m/%d({kr})')
    if p.apply_allday:
        e = p.apply_end.strftime('%m/%d') if p.apply_end and p.apply_end.date() != p.apply_start.date() else ''
        return f"{s} ~ {e} 종일" if e else f"{s} 종일"
    if p.apply_start.hour or p.apply_start.minute:
        s += ' ' + p.apply_start.strftime('%H:%M')
    e = ''
    if p.apply_end:
        ke = _WEEKDAYS_KR[p.apply_end.weekday()]
        e = p.apply_end.strftime(f'%m/%d({ke})')
        if p.apply_end.hour or p.apply_end.minute:
            e += ' ' + p.apply_end.strftime('%H:%M')
    return f"{s} ~ {e}" if e else s


def _sched_display(s):
    """추가 일정 표시"""
    if not s.event_start:
        return ''
    kr = _WEEKDAYS_KR[s.event_start.weekday()]
    disp = s.event_start.strftime(f'%m/%d({kr})')
    if s.is_allday:
        disp += ' 종일'
    elif s.event_start.hour or s.event_start.minute:
        disp += ' ' + s.event_start.strftime('%H:%M')
        if s.event_end:
            disp += '~' + s.event_end.strftime('%H:%M')
    return disp


def _post_schedules(post_id):
    """소식의 추가 일정 목록 (날짜순)"""
    out = []
    for s in YardSchedule.query.filter_by(post_id=post_id).order_by(YardSchedule.event_start.asc()).all():
        out.append({
            'id': s.id,
            'display': _sched_display(s),
            'event_start_iso': s.event_start.isoformat() if s.event_start else '',
            'event_end_iso': s.event_end.isoformat() if s.event_end else '',
            'is_allday': bool(s.is_allday),
        })
    return out


def _detect_platform(url):
    """SNS URL에서 플랫폼 판별"""
    u = (url or '').lower()
    if 'instagram.com' in u:
        return 'instagram'
    if 'facebook.com' in u or 'fb.watch' in u:
        return 'facebook'
    if 'pf.kakao.com' in u or 'kakao.com' in u or 'band.us' in u:
        return 'kakao'
    return 'web'


def _embed_url(platform, url):
    """SNS 공개 게시물 임베드 URL 생성 (임베드 불가 플랫폼은 원문 URL 유지)"""
    if platform == 'instagram':
        import re
        m = re.search(r'instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]+)', url or '')
        if m:
            return f"https://www.instagram.com/p/{m.group(1)}/embed"
        return ''
    if platform == 'facebook':
        from urllib.parse import quote
        return f"https://www.facebook.com/plugins/post.php?href={quote(url)}&show_text=true&width=500"
    return ''


@yard_bp.route('/api/yard', methods=['GET'])
def api_yard_list():
    """마당 목록(일반 회원): 승인된 소식 + 마을행사.
    - 행사 일시가 지난 글은 숨기고, 임박한 행사부터 먼저 정렬
    - GPS(lat/lng) 제공 시: 좌표 있는 행사는 가까운 순 우선 정렬"""
    from datetime import datetime as _dt
    from services.geocode import haversine
    now = _dt.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    gps_lat = request.args.get('lat', type=float)
    gps_lng = request.args.get('lng', type=float)
    has_gps = bool(gps_lat and gps_lng)

    items = []
    for p in YardPost.query.filter_by(is_active=True, is_approved=True).order_by(YardPost.created_at.desc()).limit(100).all():
        # 지난 행사는 목록에서 자동 숨김
        if p.event_date and p.event_date < today:
            continue
        dist_km = None
        if has_gps and p.latitude and p.longitude:
            try:
                dist_km = round(haversine(gps_lat, gps_lng, p.latitude, p.longitude), 1)
            except Exception:
                dist_km = None
        items.append({
            'id': f'p{p.id}', 'db_id': p.id,
            'kind': 'post',
            'title': p.title, 'content': p.content or '',
            'source_type': p.source_type, 'platform': p.platform,
            'source_url': p.source_url or '',
            'reserve_url': p.reserve_url or '',
            'author_name': p.author_name or '',
            'like_count': p.like_count or 0, 'dislike_count': p.dislike_count or 0,
            'event_date_display': _event_display(p),
            'event_place': p.event_place or '',
            'apply_display': _apply_display(p),
            'apply_allday': bool(p.apply_allday),
            'contact': p.contact or '',
            'is_allday': bool(p.is_allday),
            'event_date_iso': p.event_date.isoformat() if p.event_date else '',
            'event_end_iso': p.event_end.isoformat() if p.event_end else '',
            'extra_schedules': _post_schedules(p.id),
            'distance_km': dist_km,
            'created_at': p.created_at.isoformat() if p.created_at else '',
        })
    # 마을지기 마을행사 (진행 예정/진행중)
    for ev in VillageEvent.query.filter(VillageEvent.status.in_(['upcoming', 'ongoing'])).order_by(VillageEvent.created_at.desc()).limit(30).all():
        author = ''
        if ev.created_by:
            u = User.query.get(ev.created_by)
            author = (u.name or u.username) if u else ''
        ev_dt = ''
        ev_iso = ''
        dist_km = None
        if ev.event_date:
            ev_dt = ev.event_date.strftime('%m/%d %H:%M')
            ev_iso = ev.event_date.isoformat()
        # 마을행사 위치: 마을 면/리 이름으로 지오코딩 캐시가 없어 좌표 없음 → 거리 미계산
        items.append({
            'id': f'e{ev.id}', 'db_id': ev.id,
            'kind': 'event',
            'title': ev.title,
            'content': (ev.description or '')[:300],
            'platform': 'event',
            'source_url': f'/village/event/{ev.id}',
            'author_name': f'{ev.myeon or ""} {ev.ri or ""} 마을지기'.strip() or '마을지기',
            'event_date': ev_dt,
            'event_date_iso': ev_iso,
            'distance_km': dist_km,
            'created_at': str(ev.created_at),
        })

    # 정렬
    def _upcoming(x):
        iso = x.get('event_date_iso') or ''
        try:
            d = _dt.fromisoformat(iso)
            return d >= today
        except Exception:
            return False

    if has_gps:
        # GPS 있음: 좌표 있는 소식은 가까운 순 → 좌표 없는 임박 행사는 빠른 날짜순 → 나머지 최신순
        geo = [x for x in items if x.get('distance_km') is not None]
        dated_nogeo = [x for x in items if x.get('distance_km') is None and _upcoming(x)]
        undated = [x for x in items if x.get('distance_km') is None and not _upcoming(x)]
        geo.sort(key=lambda x: x['distance_km'])
        dated_nogeo.sort(key=lambda x: x.get('event_date_iso') or '')
        undated.sort(key=lambda x: x.get('created_at') or '', reverse=True)
        items = geo + dated_nogeo + undated
    else:
        # GPS 없음: 임박한 행사순 → 날짜 없는 소식 최신순
        dated = [x for x in items if _upcoming(x)]
        undated = [x for x in items if not _upcoming(x)]
        dated.sort(key=lambda x: x.get('event_date_iso') or '')
        undated.sort(key=lambda x: x.get('created_at') or '', reverse=True)
        items = dated + undated

    return jsonify({'items': items})


def _require_admin():
    return session.get('role') in ['admin', 'leader']


@yard_bp.route('/api/yard', methods=['POST'])
def api_yard_create():
    """관리자/마을지기: 직접 등록 (통일 형식: 제목·년월일시·장소·메모·링크·연락처)"""
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    f = request.get_json(silent=True) or {}
    saved = _save_yard(f, None)
    return jsonify({"status": "success", "id": saved.id, "msg": "✅ 마당에 등록되었습니다."})


@yard_bp.route('/api/yard/<int:post_id>', methods=['PUT'])
def api_yard_update(post_id):
    """관리자: 자동수집/등록 건 편집 (같은 통일 형식)"""
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    p = YardPost.query.get(post_id)
    if not p:
        return jsonify({"status": "error", "msg": "없는 글입니다."}), 404
    f = request.get_json(silent=True) or {}
    _save_yard(f, p)
    return jsonify({"status": "success", "id": p.id, "msg": "✅ 편집 내용이 저장되었습니다."})


def _save_yard(f, p):
    """생성(p=None)/편집(p=기존객체) 공통 저장. 통일 형식 필드 처리."""
    title = (str(f.get('title') or '')).strip()
    if p is None and not title:
        raise ValueError("제목을 입력하세요.")
    source_url = (str(f.get('source_url') or '')).strip()[:500]
    reserve_url = (str(f.get('reserve_url') or '')).strip()[:500]
    event_place = (str(f.get('event_place') or '')).strip()[:200]
    memo = (str(f.get('content') or '')).strip()
    author_name = (str(f.get('author_name') or '')).strip()[:100]
    contact = (str(f.get('contact') or '')).strip()[:100]
    apply_start = _parse_dt(str(f.get('apply_start') or ''))
    apply_end = _parse_dt(str(f.get('apply_end') or ''))
    # 신청기간도 시간 미입력 시 종일로 자동 인식
    apply_allday = False
    as_raw = (str(f.get('apply_start') or '')).strip()
    if apply_start and ('T' not in as_raw or as_raw.endswith('T00:00')):
        apply_allday = True
    if apply_allday:
        apply_start = apply_start.replace(hour=0, minute=0)
        apply_end = (apply_end or apply_start).replace(hour=23, minute=59)

    # 일정과 동일 형식: 시작일시(YYYY-MM-DDTHH:MM) / 종료일시 / 종일
    event_dt = event_end = None
    is_allday = bool(f.get('is_allday'))
    es = (str(f.get('event_start') or '')).strip()
    ee = (str(f.get('event_end') or '')).strip()
    # 시간 미입력(YYYY-MM-DD만) 또는 00:00이면 종일로 자동 인식
    if es and ('T' not in es or es.endswith('T00:00')):
        is_allday = True
    if es:
        try:
            event_dt = datetime.fromisoformat(es)
        except ValueError:
            event_dt = None
    if ee:
        try:
            event_end = datetime.fromisoformat(ee)
        except ValueError:
            event_end = None
    # 구형식 fallback (수집기 호환: event_date + start_time/end_time)
    date_str = (str(f.get('event_date') or '')).strip()
    if not event_dt and date_str:
        st = (str(f.get('start_time') or '')).strip()
        et = (str(f.get('end_time') or '')).strip()
        try:
            d = datetime.strptime(date_str, '%Y-%m-%d')
            event_dt = d
            m1 = re.match(r'^(\d{1,2}):(\d{2})$', st)
            if m1:
                event_dt = datetime.combine(d.date(), datetime.strptime(f"{int(m1.group(1)):02d}:{m1.group(2)}", '%H:%M').time())
            m2 = re.match(r'^(\d{1,2}):(\d{2})$', et)
            if m2:
                event_end = datetime.combine(d.date(), datetime.strptime(f"{int(m2.group(1)):02d}:{m2.group(2)}", '%H:%M').time())
        except ValueError:
            raise ValueError("날짜 형식이 올바르지 않습니다.")
    if is_allday:
        if event_dt:
            event_dt = event_dt.replace(hour=0, minute=0)
        if event_end:
            event_end = event_end.replace(hour=23, minute=59)
        elif event_dt:
            event_end = event_dt.replace(hour=23, minute=59)

    if p is None:
        created_by = session.get('user_id')
        if created_by and not User.query.get(created_by):
            created_by = None
        p = YardPost(
            source_type='manual',
            platform=_detect_platform(source_url) if source_url else 'web',
            is_approved=True,  # 관리자 직접 등록은 즉시 공개
            created_by=created_by,
        )
    p.title = title[:300] if title else p.title
    p.content = memo
    p.source_url = source_url
    p.reserve_url = reserve_url or None
    p.author_name = author_name
    p.contact = contact
    p.event_date = event_dt
    p.event_end = event_end
    p.is_allday = is_allday
    p.event_place = event_place or None
    p.apply_start = apply_start
    p.apply_end = apply_end
    p.apply_allday = apply_allday
    # 장소 지오코딩 (거리 정렬용)
    if event_place:
        try:
            from services.geocode import geocode_text
            lat, lng = geocode_text(event_place)
            p.latitude, p.longitude = lat, lng
        except Exception:
            pass
    db.session.add(p)
    db.session.commit()
    return p


@yard_bp.route('/api/yard/<string:fid>', methods=['DELETE'])
def api_yard_delete(fid):
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    if not fid.startswith('p'):
        return jsonify({"status": "error", "msg": "마을행사는 마당에서 삭제할 수 없습니다."}), 400
    p = YardPost.query.get(int(fid[1:]))
    if not p:
        return jsonify({"status": "error", "msg": "없는 글입니다."}), 404
    db.session.delete(p)
    db.session.commit()
    return jsonify({"status": "success", "msg": "삭제되었습니다."})


@yard_bp.route('/api/yard/<string:fid>/toggle', methods=['POST'])
def api_yard_toggle(fid):
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    if not fid.startswith('p'):
        return jsonify({"status": "error", "msg": "마을행사는 수정할 수 없습니다."}), 400
    p = YardPost.query.get(int(fid[1:]))
    if not p:
        return jsonify({"status": "error", "msg": "없는 글입니다."}), 404
    p.is_active = not p.is_active
    db.session.commit()
    return jsonify({"status": "success", "is_active": p.is_active, "msg": f"{'표시' if p.is_active else '숨김'}으로 변경"})


@yard_bp.route('/api/yard/admin', methods=['GET'])
def api_yard_admin_list():
    """관리자: 승인 대기 + 승인됨 전체 목록"""
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    out = []
    for p in YardPost.query.order_by(YardPost.created_at.desc()).limit(300).all():
        out.append({
            'id': f'p{p.id}', 'db_id': p.id,
            'title': p.title, 'content': p.content or '',
            'source_type': p.source_type, 'platform': p.platform,
            'source_url': p.source_url or '', 'reserve_url': p.reserve_url or '', 'author_name': p.author_name or '',
            'contact': p.contact or '', 'is_allday': bool(p.is_allday),
            'apply_display': _apply_display(p), 'apply_allday': bool(p.apply_allday),
            'event_date_display': _event_display(p),
            'event_date_iso': p.event_date.isoformat() if p.event_date else '',
            'event_end_iso': p.event_end.isoformat() if p.event_end else '',
            'extra_schedules': _post_schedules(p.id),
            'event_place': p.event_place or '',
            'is_approved': bool(p.is_approved), 'is_active': bool(p.is_active),
            'created_at': p.created_at.isoformat() if p.created_at else '',
        })
    return jsonify({'items': out})


@yard_bp.route('/api/yard/<string:fid>/approve', methods=['POST'])
def api_yard_approve(fid):
    """관리자 승인/승인해제"""
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    if not fid.startswith('p'):
        return jsonify({"status": "error", "msg": "마을행사는 승인 대상이 아닙니다."}), 400
    p = YardPost.query.get(int(fid[1:]))
    if not p:
        return jsonify({"status": "error", "msg": "없는 글입니다."}), 404
    p.is_approved = not bool(p.is_approved)
    db.session.commit()
    return jsonify({"status": "success", "is_approved": p.is_approved,
                    "msg": "✅ 승인 — 마당에 공개되었습니다." if p.is_approved else "승인 해제 — 비공개로 전환했습니다."})


@yard_bp.route('/api/yard/orgs', methods=['GET'])
def api_yard_orgs():
    """관리자: 자동수집 대상 단체 목록"""
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    orgs = []
    for o in YardOrg.query.order_by(YardOrg.created_at.desc()).all():
        orgs.append({
            'id': o.id, 'name': o.name, 'url': o.url or '',
            'platform': o.platform or '', 'is_active': bool(o.is_active),
            'created_at': o.created_at.isoformat() if o.created_at else '',
        })
    return jsonify({'orgs': orgs})


@yard_bp.route('/api/yard/orgs', methods=['POST'])
def api_yard_org_create():
    """관리자: 단체 등록 (단체명 + 블로그/카페 주소). 블로그/카페만 자동수집 가능"""
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()[:100]
    if not name:
        return jsonify({"status": "error", "msg": "단체명을 입력하세요."}), 400
    url = (data.get('url') or '').strip()[:500]
    if not url:
        return jsonify({"status": "error", "msg": "블로그 또는 카페 주소를 입력하세요."}), 400
    # 네이버 블로그/카페 우선 판별 (자동수집 가능 플랫폼)
    u = url.lower()
    if 'blog.naver.com' in u:
        platform = 'naverblog'
    elif 'cafe.naver.com' in u or 'm.cafe.naver.com' in u:
        platform = 'navercafe'
    else:
        platform = _detect_platform(url)
    if YardOrg.query.filter_by(name=name).first():
        return jsonify({"status": "error", "msg": "이미 등록된 단체명입니다."}), 400
    o = YardOrg(name=name, url=url[:500], platform=platform, created_by=session.get('user_id'))
    db.session.add(o)
    db.session.commit()
    auto_note = ' → 자동수집 대상에 포함됩니다.' if platform in ('naverblog', 'navercafe') else ' → 이 플랫폼은 자동수집이 불가하여 관리자 직접 등록용으로 참고 저장됩니다.'
    return jsonify({"status": "success", "id": o.id, "platform": platform, "msg": f"✅ 단체 등록 완료{auto_note}"})


@yard_bp.route('/api/yard/orgs/<int:org_id>', methods=['DELETE'])
def api_yard_org_delete(org_id):
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    o = YardOrg.query.get(org_id)
    if not o:
        return jsonify({"status": "error", "msg": "없는 단체입니다."}), 404
    db.session.delete(o)
    db.session.commit()
    return jsonify({"status": "success", "msg": "단체 등록이 삭제되었습니다."})


@yard_bp.route('/api/yard/import-link', methods=['POST'])
def api_yard_import_link():
    """관리자: 링크로 추가하기 — 원문 페이지를 읽어 AI로 항목을 채운 초안 생성"""
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    f = request.get_json(silent=True) or {}
    url = (str(f.get('url') or '')).strip()
    if not url.startswith('http'):
        return jsonify({"status": "error", "msg": "URL을 입력하세요."}), 400

    # 1) 페이지 가져오기 (뉴스 import-url과 동일한 정제 방식)
    import requests as _requests
    fetch_url = url
    # 네이버 블로그: iframe 구조라 본문이 안 잡힘 → PostView 본문 주소로 변환
    m_blog = re.search(r'blog\.naver\.com/([A-Za-z0-9_-]+)/(\d+)', url)
    if m_blog:
        fetch_url = f"https://blog.naver.com/PostView.naver?blogId={m_blog.group(1)}&logNo={m_blog.group(2)}"
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        resp = _requests.get(fetch_url, headers=headers, timeout=15)
        resp.encoding = 'utf-8'
        html = resp.text
    except Exception as e:
        return jsonify({"status": "error", "msg": f"페이지를 가져올 수 없습니다: {str(e)[:80]}"}), 400
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, 'html.parser')
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe', 'noscript', 'form', 'button']):
            tag.decompose()
        raw_text = soup.get_text(separator='\n', strip=True)
        lines = [l for l in raw_text.split('\n') if len(l.strip()) >= 3]
        body_text = '\n'.join(lines)[:3000]
    except Exception:
        body_text = html[:2000]

    # 2) AI 항목 추출
    from services.news_service import _motif_text
    result = _motif_text(
        "당신은 양평 지역 소식 편집자입니다. 웹페이지 내용에서 행사/모임/모집 정보를 추출해 구조화합니다. JSON으로만 답하며, 없는 정보는 빈 문자열로 둡니다. 추측하지 마세요.",
        f"""오늘 날짜: {datetime.now().strftime('%Y-%m-%d (%A)')}

다음 웹페이지 내용에서 마당 소식 항목을 추출하세요. 연도는 오늘 날짜 기준으로 판단하세요.
JSON으로만 출력:
{{"title": "제목 (필수, 웹페이지의 실제 제목)", "event_date_iso": "행사 시작날짜 YYYY-MM-DD (행사가 아니면 빈 문자열)", "start_time": "시작시간 HH:MM (없으면 빈 문자열)", "end_time": "종료시간 HH:MM (없으면 빈 문자열)", "event_place": "장소", "apply_start": "신청기간 시작 YYYY-MM-DD", "apply_end": "신청기간 종료 YYYY-MM-DD", "contact": "연락처(전화번호)", "reserve_url": "본문 속 예약/신청 페이지 링크(http)", "memo": "행사 내용 요약 3~5문장"}}

웹페이지 제목: {soup.title.string[:100] if soup.title and soup.title.string else url}
웹페이지 내용:
{body_text[:2500]}""",
        format_json=True,
    )
    if not isinstance(result, dict) or not result.get('title'):
        return jsonify({"status": "error", "msg": "페이지에서 항목을 추출하지 못했습니다. ✏️ 새 소식 등록으로 직접 입력해 주세요."}), 400

    # 3) 초안 생성 (관리자 등록이므로 즉시 공개, 이후 편집창에서 보완)
    def _dt(date_s, time_s):
        try:
            d = datetime.strptime(str(date_s)[:10], '%Y-%m-%d')
            m = re.match(r'^(\d{1,2}):(\d{2})$', str(time_s or '').strip())
            if m:
                return datetime.combine(d.date(), datetime.strptime(f"{int(m.group(1)):02d}:{m.group(2)}", '%H:%M').time())
            return d
        except ValueError:
            return None

    created_by = session.get('user_id')
    if created_by and not User.query.get(created_by):
        created_by = None
    p = YardPost(
        title=str(result.get('title') or '')[:300],
        content=str(result.get('memo') or '')[:2000],
        source_type='manual',
        platform=_detect_platform(url),
        source_url=url[:500],
        reserve_url=(str(result.get('reserve_url') or ''))[:500] or None,
        contact=(str(result.get('contact') or ''))[:100] or None,
        author_name=soup.title.string[:100].strip() if soup.title and soup.title.string else '',
        event_date=_dt(result.get('event_date_iso'), result.get('start_time')),
        event_end=_dt(result.get('event_date_iso'), result.get('end_time')) if result.get('end_time') else None,
        event_place=(str(result.get('event_place') or ''))[:200] or None,
        apply_start=_parse_dt(str(result.get('apply_start') or '')),
        apply_end=_parse_dt(str(result.get('apply_end') or '')),
        is_allday=not str(result.get('start_time') or '').strip(),
        is_approved=True,
        created_by=created_by,
    )
    if p.event_place:
        try:
            from services.geocode import geocode_text
            lat, lng = geocode_text(p.event_place)
            p.latitude, p.longitude = lat, lng
        except Exception:
            pass
    db.session.add(p)
    db.session.commit()
    return jsonify({"status": "success", "id": p.id, "msg": "✅ 초안이 생성되었습니다. 편집창에서 내용을 확인·보완 후 저장하세요."})


@yard_bp.route('/api/yard/<int:post_id>/schedules', methods=['POST'])
def api_yard_schedule_add(post_id):
    """관리자: 추가 일정 등록 (한 소식에 여러 일정)"""
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    p = YardPost.query.get(post_id)
    if not p:
        return jsonify({"status": "error", "msg": "없는 글입니다."}), 404
    f = request.get_json(silent=True) or {}
    try:
        start = datetime.fromisoformat((str(f.get('event_start') or ''))[:16])
    except ValueError:
        return jsonify({"status": "error", "msg": "시작일시 형식이 올바르지 않습니다."}), 400
    end = None
    try:
        ee = (str(f.get('event_end') or ''))[:16]
        if ee:
            end = datetime.fromisoformat(ee)
    except ValueError:
        end = None
    is_allday = bool(f.get('is_allday'))
    if is_allday:
        start = start.replace(hour=0, minute=0)
        end = (end or start).replace(hour=23, minute=59)
    s = YardSchedule(post_id=post_id, event_start=start, event_end=end, is_allday=is_allday)
    db.session.add(s)
    db.session.commit()
    return jsonify({"status": "success", "id": s.id, "display": _sched_display(s), "msg": "✅ 추가 일정이 등록되었습니다."})


@yard_bp.route('/api/yard/schedules/<int:sid>', methods=['DELETE'])
def api_yard_schedule_delete(sid):
    if not _require_admin():
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    s = YardSchedule.query.get(sid)
    if not s:
        return jsonify({"status": "error", "msg": "없는 일정입니다."}), 404
    db.session.delete(s)
    db.session.commit()
    return jsonify({"status": "success", "msg": "추가 일정이 삭제되었습니다."})


@yard_bp.route('/api/yard/<int:post_id>', methods=['GET'])
def api_yard_get(post_id):
    p = YardPost.query.get(post_id)
    if not p or not p.is_active:
        return jsonify({"status": "error", "msg": "없거나 숨긴 글입니다."}), 404
    comments = []
    for c in YardComment.query.filter_by(post_id=p.id).order_by(YardComment.created_at.asc()).all():
        user = User.query.get(c.user_id) if c.user_id else None
        uname = (user.name or user.username) if user else (c.author_name or '익명')
        comments.append({
            'id': c.id, 'user_id': c.user_id, 'author_name': uname or '익명',
            'content': c.content or '', 'image_path': c.image_path or '',
            'link_url': c.link_url or '',
            'like_count': c.like_count or 0, 'dislike_count': c.dislike_count or 0,
            'created_at': c.created_at.isoformat() if c.created_at else '',
        })
    return jsonify({
        'id': p.id, 'title': p.title, 'content': p.content or '',
        'source_type': p.source_type, 'platform': p.platform,
        'source_url': p.source_url or '', 'reserve_url': p.reserve_url or '', 'author_name': p.author_name or '',
        'contact': p.contact or '', 'is_allday': bool(p.is_allday),
        'apply_display': _apply_display(p), 'apply_allday': bool(p.apply_allday),
        'event_date_display': _event_display(p),
        'extra_schedules': _post_schedules(p.id),
        'event_place': p.event_place or '',
        'event_date_iso': p.event_date.isoformat() if p.event_date else '',
        'event_end_iso': p.event_end.isoformat() if p.event_end else '',
        'like_count': p.like_count or 0, 'dislike_count': p.dislike_count or 0,
        'embed_url': _embed_url(p.platform, p.source_url) if p.platform in ('instagram', 'facebook') else '',
        'comments': comments,
        'created_at': str(p.created_at),
    })


@yard_bp.route('/api/yard/<int:post_id>/vote', methods=['POST'])
def api_yard_vote(post_id):
    """마당 글 좋아요/싫어요 (로그인 필요)"""
    if not session.get('user_id'):
        return jsonify({"status": "error", "msg": "로그인 후 이용하세요."}), 401
    p = YardPost.query.get(post_id)
    if not p:
        return jsonify({"status": "error", "msg": "없는 글입니다."}), 404
    if request.is_json:
        vote = (request.get_json(silent=True) or {}).get('vote', '')
    else:
        vote = request.form.get('vote', '')
    if vote == 'like':
        p.like_count = (p.like_count or 0) + 1
    elif vote == 'dislike':
        p.dislike_count = (p.dislike_count or 0) + 1
    else:
        return jsonify({"status": "error", "msg": "잘못된 요청"}), 400
    db.session.commit()
    return jsonify({"status": "success", "like_count": p.like_count, "dislike_count": p.dislike_count})


@yard_bp.route('/api/yard/<int:post_id>/comment', methods=['POST'])
def api_yard_comment(post_id):
    """댓글 등록 (사진·링크 첨부 가능, 로그인 필요)"""
    if not session.get('user_id'):
        return jsonify({"status": "error", "msg": "로그인 후 이용하세요."}), 401
    p = YardPost.query.get(post_id)
    if not p:
        return jsonify({"status": "error", "msg": "없는 글입니다."}), 404

    content = (request.form.get('content') or '').strip()
    link_url = (request.form.get('link_url') or '').strip()[:500]
    image_path = ''
    file = request.files.get('image')
    if file and file.filename:
        from services.security import secure_save
        upload_dir = os.path.join(current_app.root_path, 'static', 'uploads', 'yard_comments')
        try:
            image_path = secure_save(file, upload_dir, max_mb=10)
        except ValueError as e:
            return jsonify({"status": "error", "msg": str(e)[:80]}), 400

    if not content and not image_path and not link_url:
        return jsonify({"status": "error", "msg": "내용/사진/링크 중 하나는 입력하세요."}), 400

    user = User.query.get(session.get('user_id'))
    uid = session.get('user_id')
    if uid and not user:
        uid = None
    c = YardComment(
        post_id=p.id,
        user_id=uid,
        author_name=(user.name or user.username) if user else '회원',
        content=content[:2000],
        image_path=image_path,
        link_url=link_url,
    )
    db.session.add(c)
    db.session.commit()
    return jsonify({
        "status": "success", "id": c.id,
        "comment": {'id': c.id, 'user_id': c.user_id, 'author_name': c.author_name,
                    'content': c.content, 'image_path': c.image_path, 'link_url': c.link_url,
                    'like_count': 0, 'dislike_count': 0,
                    'created_at': c.created_at.isoformat() if c.created_at else ''},
        "msg": "댓글이 등록되었습니다.",
    })


@yard_bp.route('/api/yard/comment/<int:comment_id>', methods=['DELETE'])
def api_yard_comment_delete(comment_id):
    c = YardComment.query.get(comment_id)
    if not c:
        return jsonify({"status": "error", "msg": "없는 댓글입니다."}), 404
    if session.get('user_id') != c.user_id and session.get('role') not in ['admin', 'leader']:
        return jsonify({"status": "error", "msg": "권한 없음"}), 403
    db.session.delete(c)
    db.session.commit()
    return jsonify({"status": "success", "msg": "댓글이 삭제되었습니다."})
