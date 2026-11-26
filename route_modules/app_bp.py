# route_modules/app_bp.py - 모바일 앱 전용 API (/api/app/*)
# 기존 웹(TongBotSchedule, 경로 재계산)을 그대로 재사용하고, 웹 세션과 분리된 Bearer JWT를 쓴다.
import hashlib
import hmac
import json
import math
import os
import statistics
from datetime import datetime, time as dtime, timedelta
from functools import wraps

from flask import Blueprint, current_app, g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from models import (
    AppConsent,
    AppDevice,
    AppLoginAttempt,
    AppRecommendation,
    AppRouteActual,
    AppRouteStat,
    AppTripSummary,
    TongBotSchedule,
    User,
    db,
)
from services.app_auth import bearer_token, decode_token, issue_token
from services.directions import plan_segment
from services.geo import _geocode_location

app_bp = Blueprint('app_api', __name__, url_prefix='/api/app')


@app_bp.errorhandler(RuntimeError)
def _app_feature_unavailable(e):
    # 선택 의존성(예: PyJWT) 미설치 시 500 대신 503
    from flask import jsonify as _jsonify
    return _jsonify({'error': '앱 기능을 사용할 수 없습니다.', 'detail': str(e)}), 503

PASSWORD_SALT = 'ypsite_2026_client_hash'
MOVE_TITLE_KEYS = ('이동', '귀가')


# ---------------------------------------------------------------------------
# 공통 유틸
# ---------------------------------------------------------------------------
def _now():
    return datetime.now()


def _iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%S') if dt else None


def _naive_local(dt):
    """DB(timestamptz)에서 온 aware datetime을 서버 로컬 naive로 정규화."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone().replace(tzinfo=None)
    return dt


def _parse_dt(value):
    """ISO/일반 문자열을 서버 로컬(Asia/Seoul) naive datetime으로 변환."""
    if value is None or value == '':
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        raw = str(value).strip()
        try:
            dt = datetime.fromisoformat(raw.replace('Z', '+00:00'))
        except Exception:
            dt = None
            for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d'):
                try:
                    dt = datetime.strptime(raw, fmt)
                    break
                except Exception:
                    continue
            if dt is None:
                return None
    if dt.tzinfo is not None:
        dt = dt.astimezone().replace(tzinfo=None)
    return dt


def _parse_bound(value, is_end=False):
    dt = _parse_dt(value)
    if dt is None:
        return None
    if is_end and len(str(value).strip()) <= 10:
        dt = dt.replace(hour=23, minute=59, second=59)
    return dt


def _as_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in ('1', 'true', 'yes', 'y', 'on')


def _as_int(value, default=None):
    try:
        if value is None or value == '':
            return default
        return int(float(value))
    except Exception:
        return default


def _as_float(value, default=None):
    try:
        if value is None or value == '':
            return default
        return float(value)
    except Exception:
        return default


def _sha256(value):
    return hashlib.sha256((value or '').encode('utf-8')).hexdigest()


def _is_move(s):
    title = s.title or ''
    return any(k in title for k in MOVE_TITLE_KEYS)


def _route_kind(s):
    title = s.title or ''
    if any(k in title for k in ('귀가', '집으로 이동', '임시숙소로 이동')):
        return 'return'
    return 'move'


def _plan_of(s):
    if not s or not s.content:
        return None
    try:
        plan = json.loads(s.content)
    except Exception:
        return None
    return plan if isinstance(plan, dict) else None


def _plan_summary(plan):
    if not isinstance(plan, dict):
        return None
    steps = plan.get('steps') or []
    if not isinstance(steps, list):
        steps = []
    total = _as_int(plan.get('total_min'))
    if total is None:
        total = sum(_as_int(st.get('time_min'), 0) or 0 for st in steps if isinstance(st, dict))
    walk_min = sum(_as_int(st.get('time_min'), 0) or 0 for st in steps
                   if isinstance(st, dict) and '도보' in (st.get('mode') or ''))
    transit_count = sum(1 for st in steps if isinstance(st, dict) and '도보' not in (st.get('mode') or ''))
    return {
        'total_min': total,
        'transfers': max(0, transit_count - 1),
        'walk_min': walk_min,
        'wait_min': max(0, total - sum(_as_int(st.get('time_min'), 0) or 0 for st in steps if isinstance(st, dict))),
        'departure': plan.get('departure') or '',
        'arrival': plan.get('arrival') or '',
        'distance_km': plan.get('distance_km'),
        'steps': len(steps),
    }


def _end_for_occurrence(s, occ):
    if not s.end_date:
        if s.is_allday:
            return datetime.combine(occ.date(), dtime(23, 59))
        return None
    end = datetime.combine(occ.date(), s.end_date.time())
    if end <= occ:
        end = occ + timedelta(hours=1)
    return end


def _event_end_of(s):
    """반복 일정에서 end_date가 '반복 종료일'을 겸하는 기존 규칙을 반영한 1회 종료시각."""
    if not s.end_date:
        return None
    if s.is_recurring and s.event_date:
        return datetime.combine(_naive_local(s.event_date).date(), s.end_date.time())
    return _naive_local(s.end_date)


def _repeat_end_of(s):
    if s.repeat_end_date:
        return _naive_local(s.repeat_end_date)
    if s.is_recurring and not s.repeat_infinite:
        return _naive_local(s.end_date)
    return None


def _apply_end_dates(s, event_end, repeat_end, recurring, infinite):
    """기존 웹 규칙 유지: 유한 반복은 end_date=반복 종료일, 무한 반복은 end_date=1회 종료시각."""
    if recurring and not infinite and repeat_end:
        if event_end:
            repeat_end = datetime.combine(repeat_end.date(), event_end.time())
        s.end_date = repeat_end
        s.repeat_end_date = repeat_end
    else:
        s.end_date = event_end
        s.repeat_end_date = None


def _schedule_dict(s, occ=None, end=None, occurrence=False):
    start = _naive_local(occ or s.event_date)
    if start is None:
        return None
    end = _naive_local(end) if end is not None else _end_for_occurrence(s, start)
    summary = _plan_summary(_plan_of(s)) if (_is_move(s) or (s.kind or '') == 'route') else None
    alarm_minutes = _as_int(s.reminder_minutes, 0) or 0
    alarm_at = start - timedelta(minutes=alarm_minutes) if alarm_minutes > 0 else None
    return {
        'id': s.id,
        'occurrence_id': ('%s_%s' % (s.id, start.strftime('%Y%m%d'))) if occurrence else None,
        'occurrence_date': start.strftime('%Y-%m-%d') if occurrence else None,
        'kind': s.kind or 'base',
        'title': s.title or '',
        'location': s.location or '',
        'description': s.description or '',
        'start_at': _iso(start),
        'end_at': _iso(end),
        'all_day': bool(s.is_allday),
        'busy': True if s.busy is None else bool(s.busy),
        'status': s.status or 'active',
        'source': s.source or '',
        'departure_location': s.departure_location or '',
        'return_location': s.return_location or '',
        'is_move': _is_move(s),
        'route_kind': _route_kind(s) if _is_move(s) else None,
        'repeat': {
            'enabled': bool(s.is_recurring),
            'type': s.repeat_type or '',
            'interval': _as_int(s.repeat_interval, 1) or 1,
            'weekdays': _as_int(s.repeat_weekdays, 0) or 0,
            'week_of_month': _as_int(s.repeat_week_of_month, 0) or 0,
            'month_of_year': _as_int(s.repeat_month_of_year, 0) or 0,
            'last_day': bool(getattr(s, 'repeat_lastday', False)),
            'infinite': bool(s.repeat_infinite),
            'end_at': _iso(s.repeat_end_date),
            'exceptions': s.repeat_exceptions or '',
        },
        'alarm_minutes': alarm_minutes,
        'alarm_at': _iso(alarm_at),
        'route': summary,
    }


def _occurrences(uid, start_dt, end_dt):
    """[start_dt, end_dt] 범위의 일정+반복 발생 건을 펼쳐 반환."""
    from tongbot_routes import _unocum_event_end, _unocum_occurrences

    rows = TongBotSchedule.query.filter_by(user_id=uid).all()
    out = []
    for s in rows:
        if not s.event_date:
            continue
        try:
            occs = _unocum_occurrences(s, start_dt.date(), end_dt.date())
        except Exception:
            occs = [s.event_date]
        for occ in occs:
            if not occ:
                continue
            occ_start = _naive_local(occ)
            occ_end = None
            if s.end_date:
                try:
                    occ_end = _naive_local(_unocum_event_end(occ_start, s))
                except Exception:
                    occ_end = _end_for_occurrence(s, occ_start)
            if occ_start < start_dt or occ_start > end_dt:
                continue
            is_occ = bool(s.event_date) and occ_start.date() != _naive_local(s.event_date).date()
            item = _schedule_dict(s, occ_start, occ_end, occurrence=is_occ)
            if item:
                out.append(item)
    out.sort(key=lambda x: (x.get('start_at') or '', x.get('id') or 0))
    return out


# ---------------------------------------------------------------------------
# 인증
# ---------------------------------------------------------------------------
def _auth_user():
    token = bearer_token(request)
    payload = decode_token(token) if token else None
    if not payload:
        return None
    try:
        uid = int(payload.get('sub'))
    except Exception:
        return None
    user = db.session.get(User, uid)
    # 소프트 삭제(익명화)된 계정은 email이 없으므로 기존 토큰도 즉시 무효화된다.
    if not user or not user.email:
        return None
    return user


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = _auth_user()
        if not user:
            return jsonify({'error': 'unauthorized'}), 401
        g.app_user = user
        return fn(*args, **kwargs)
    return wrapper


def _client_ip_hash():
    raw = (request.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
    if not raw:
        raw = request.remote_addr or ''
    return _sha256(raw)[:32]


def _login_window():
    minutes = _as_int(current_app.config.get('APP_LOGIN_WINDOW_MIN'), 15) or 15
    return timedelta(minutes=minutes)


def _recent_failures(email_hash):
    since = _now() - _login_window()
    return AppLoginAttempt.query.filter(
        AppLoginAttempt.email_hash == email_hash,
        AppLoginAttempt.created_at >= since,
    ).count()


@app_bp.route('/login', methods=['POST'])
def app_login():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    if not email or not password:
        return jsonify({'error': 'email_and_password_required'}), 400

    email_hash = _sha256(email)[:64]
    max_fails = _as_int(current_app.config.get('APP_LOGIN_MAX_FAILS'), 5) or 5
    if _recent_failures(email_hash) >= max_fails:
        return jsonify({
            'error': 'too_many_attempts',
            'retry_after_sec': int(_login_window().total_seconds()),
        }), 429

    user = User.query.filter_by(email=email).first()
    if user is None:
        # 대소문자 혼용 저장 계정 호환
        user = User.query.filter(db.func.lower(User.email) == email).first()

    ok = False
    if user and user.email:
        if getattr(user, 'password_v2', False):
            # 웹 클라이언트와 동일한 방식(솔트+SHA-256)으로 검증
            client_hash = _sha256(PASSWORD_SALT + password)
            ok = bool(user.password) and check_password_hash(user.password, client_hash)
        else:
            ok = bool(user.password) and check_password_hash(user.password, password)

    if not ok:
        db.session.add(AppLoginAttempt(
            email_hash=email_hash,
            ip_hash=_client_ip_hash(),
            created_at=_now(),
        ))
        db.session.commit()
        return jsonify({'error': 'invalid_credentials'}), 401

    AppLoginAttempt.query.filter_by(email_hash=email_hash).delete(synchronize_session=False)
    user.last_login = _now()
    db.session.commit()

    token, expires_at = issue_token(user)
    return jsonify({
        'token': token,
        'token_type': 'Bearer',
        'expires_at': expires_at.isoformat(),
        'user': {
            'id': user.id,
            'username': user.username or '',
            'email': user.email,
            'real_name': user.real_name or '',
            'town': user.town or '',
            'village': user.village or '',
        },
    })


# ---------------------------------------------------------------------------
# 오늘 / 일정
# ---------------------------------------------------------------------------
@app_bp.route('/today', methods=['GET'])
@login_required
def app_today():
    uid = g.app_user.id
    now = _now()
    day_start = datetime.combine(now.date(), dtime(0, 0))
    day_end = datetime.combine(now.date(), dtime(23, 59, 59))
    items = _occurrences(uid, day_start, day_end)

    next_move = None
    for item in items:
        if not item.get('is_move'):
            continue
        start = _parse_dt(item.get('start_at'))
        if start and start >= now:
            next_move = item
            break

    next_info = None
    if next_move:
        start = _parse_dt(next_move['start_at'])
        next_info = {
            'schedule_id': next_move['id'],
            'occurrence_id': next_move.get('occurrence_id'),
            'title': next_move['title'],
            'depart_at': next_move['start_at'],
            'arrive_at': next_move['end_at'],
            'minutes_until_departure': int(round((start - now).total_seconds() / 60.0)),
            'departure_location': next_move.get('departure_location') or '',
            'arrival_location': next_move.get('return_location') or next_move.get('location') or '',
        }

    alarms = []
    for item in items:
        if item.get('alarm_at'):
            alarm_dt = _parse_dt(item['alarm_at'])
            if alarm_dt and alarm_dt >= now:
                alarms.append({
                    'schedule_id': item['id'],
                    'occurrence_id': item.get('occurrence_id'),
                    'title': item['title'],
                    'alarm_at': item['alarm_at'],
                    'minutes_before': item.get('alarm_minutes') or 0,
                    'status': 'scheduled',
                })

    return jsonify({
        'date': now.strftime('%Y-%m-%d'),
        'now': _iso(now),
        'schedules': items,
        'next_transport': next_info,
        'departure_alarms': alarms,
    })


@app_bp.route('/schedules', methods=['GET'])
@login_required
def app_schedules_get():
    uid = g.app_user.id
    now = _now()
    start_dt = _parse_dt(request.args.get('from')) if request.args.get('from') else datetime.combine(now.date(), dtime(0, 0))
    end_dt = _parse_bound(request.args.get('to'), is_end=True) if request.args.get('to') else start_dt + timedelta(days=7)
    if not start_dt or not end_dt:
        return jsonify({'error': 'invalid_range'}), 400
    if end_dt < start_dt:
        return jsonify({'error': 'invalid_range'}), 400
    if (end_dt - start_dt).days > 366:
        return jsonify({'error': 'range_too_large', 'max_days': 366}), 400

    items = _occurrences(uid, start_dt, end_dt)
    return jsonify({
        'from': _iso(start_dt),
        'to': _iso(end_dt),
        'schedules': items,
    })


def _repeat_payload(data, start, end):
    is_recurring = _as_bool(data.get('is_recurring') or data.get('repeat_enabled'), False)
    repeat_type = (data.get('repeat_type') or '').strip()
    interval = _as_int(data.get('repeat_interval'), 1) or 1
    infinite = _as_bool(data.get('repeat_infinite'), False)
    repeat_end = _parse_dt(data.get('repeat_end_at') or data.get('repeat_end_date'))
    if not is_recurring:
        return {
            'is_recurring': False,
            'repeat_type': '',
            'repeat_interval': 1,
            'repeat_infinite': False,
            'repeat_end_date': None,
        }
    if infinite or repeat_end is None or (start and repeat_end <= start):
        infinite = True
        repeat_end = None
    return {
        'is_recurring': True,
        'repeat_type': repeat_type,
        'repeat_interval': max(1, interval),
        'repeat_weekdays': _as_int(data.get('repeat_weekdays'), 0) or 0,
        'repeat_week_of_month': _as_int(data.get('repeat_week_of_month'), 0) or 0,
        'repeat_month_of_year': _as_int(data.get('repeat_month_of_year'), 0) or 0,
        'repeat_lastday': _as_bool(data.get('repeat_lastday'), False),
        'repeat_infinite': infinite,
        'repeat_end_date': repeat_end,
    }


def _check_conflict(uid, start, end, all_day, exclude_id=None):
    from tongbot_routes import _find_schedule_conflict, _schedule_time_range

    st, en = _schedule_time_range(start, end, all_day)
    return _find_schedule_conflict(uid, st, en, exclude_id=exclude_id)


def _schedule_warning(location):
    if not location:
        return None
    lat, lng = _geocode_location(location)
    return None if (lat and lng) else '장소가 분명하지 않습니다'


@app_bp.route('/schedules', methods=['POST'])
@login_required
def app_schedules_create():
    uid = g.app_user.id
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    start = _parse_dt(data.get('start_at') or data.get('event_date'))
    end = _parse_dt(data.get('end_at') or data.get('end_date'))
    if not title:
        return jsonify({'error': 'title_required'}), 400
    if not start:
        return jsonify({'error': 'start_at_required'}), 400
    if end and end <= start:
        end = None

    all_day = _as_bool(data.get('all_day') if data.get('all_day') is not None else data.get('is_allday'), False)
    if all_day and end is None:
        end = datetime.combine(start.date(), dtime(23, 59))
    busy = _as_bool(data.get('busy'), True)
    location = (data.get('location') or '').strip()
    is_move = any(k in title for k in MOVE_TITLE_KEYS)

    if busy and not is_move:
        conflict = _check_conflict(uid, start, end, all_day)
        if conflict:
            return jsonify({
                'error': 'schedule_conflict',
                'conflict_title': (conflict.title or '').strip() or '일정',
            }), 409

    repeat = _repeat_payload(data, start, end)
    reminder = _as_int(data.get('alarm_minutes') if data.get('alarm_minutes') is not None else data.get('reminder_minutes'), 0) or 0

    event_end = end
    repeat_end = repeat.get('repeat_end_date')
    end_for_model = event_end
    repeat_end_for_model = None
    if repeat['is_recurring'] and not repeat['repeat_infinite'] and repeat_end:
        end_for_model = datetime.combine(repeat_end.date(), event_end.time()) if event_end else repeat_end
        repeat_end_for_model = end_for_model

    s = TongBotSchedule(
        user_id=uid,
        title=title,
        description=data.get('description') or '',
        event_date=start,
        end_date=end_for_model,
        location=location,
        memo=data.get('memo') or '',
        departure_location=(data.get('departure_location') or '').strip(),
        return_location=(data.get('return_location') or '').strip(),
        is_allday=all_day,
        busy=busy,
        kind='base',
        is_recurring=repeat['is_recurring'],
        repeat_type=repeat['repeat_type'],
        repeat_interval=repeat['repeat_interval'],
        repeat_weekdays=repeat.get('repeat_weekdays', 0),
        repeat_week_of_month=repeat.get('repeat_week_of_month', 0),
        repeat_month_of_year=repeat.get('repeat_month_of_year', 0),
        repeat_lastday=repeat.get('repeat_lastday', False),
        repeat_infinite=repeat['repeat_infinite'],
        repeat_end_date=repeat_end_for_model,
        reminder_minutes=reminder,
    )
    db.session.add(s)
    db.session.flush()
    s.route_dirty = True
    db.session.commit()

    from services.route_worker import enqueue_recalc
    enqueue_recalc(uid)

    return jsonify({
        'success': True,
        'id': s.id,
        'warning': _schedule_warning(location),
    }), 201


@app_bp.route('/schedules/<int:schedule_id>', methods=['PUT'])
@login_required
def app_schedules_update(schedule_id):
    uid = g.app_user.id
    s = db.session.get(TongBotSchedule, schedule_id)
    if not s or s.user_id != uid:
        return jsonify({'error': 'not_found'}), 404
    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({'error': 'empty_body'}), 400

    is_move = _is_move(s)
    old_memo = s.memo
    event_end = _event_end_of(s)
    repeat_end = _repeat_end_of(s)
    recurring = bool(s.is_recurring)
    infinite = bool(s.repeat_infinite)

    if data.get('title') is not None:
        s.title = (data.get('title') or '').strip()
    if data.get('location') is not None:
        s.location = (data.get('location') or '').strip()
    if data.get('description') is not None:
        s.description = data.get('description') or ''
    if data.get('memo') is not None:
        s.memo = data.get('memo') or ''
    if data.get('departure_location') is not None:
        s.departure_location = (data.get('departure_location') or '').strip()
    if data.get('return_location') is not None:
        s.return_location = (data.get('return_location') or '').strip()
    if data.get('start_at') is not None or data.get('event_date') is not None:
        new_start = _parse_dt(data.get('start_at') or data.get('event_date'))
        if new_start:
            s.event_date = new_start
    if data.get('end_at') is not None or data.get('end_date') is not None:
        event_end = _parse_dt(data.get('end_at') or data.get('end_date'))
    if data.get('all_day') is not None or data.get('is_allday') is not None:
        s.is_allday = _as_bool(data.get('all_day') if data.get('all_day') is not None else data.get('is_allday'), False)
    if data.get('busy') is not None:
        s.busy = _as_bool(data.get('busy'), True)
    if data.get('alarm_minutes') is not None or data.get('reminder_minutes') is not None:
        s.reminder_minutes = _as_int(
            data.get('alarm_minutes') if data.get('alarm_minutes') is not None else data.get('reminder_minutes'),
            0,
        ) or 0

    if ('is_recurring' in data) or ('repeat_enabled' in data) or ('repeat_type' in data):
        repeat = _repeat_payload(data, s.event_date, event_end)
        recurring = repeat['is_recurring']
        infinite = repeat['repeat_infinite']
        if ('repeat_end_at' in data) or ('repeat_end_date' in data):
            repeat_end = repeat.get('repeat_end_date')
        if not recurring:
            repeat_end = None
        s.is_recurring = recurring
        s.repeat_type = repeat['repeat_type']
        s.repeat_interval = repeat['repeat_interval']
        s.repeat_weekdays = repeat.get('repeat_weekdays', 0)
        s.repeat_week_of_month = repeat.get('repeat_week_of_month', 0)
        s.repeat_month_of_year = repeat.get('repeat_month_of_year', 0)
        s.repeat_lastday = repeat.get('repeat_lastday', False)
        s.repeat_infinite = infinite
    elif ('repeat_end_at' in data) or ('repeat_end_date' in data):
        repeat_end = _parse_dt(data.get('repeat_end_at') or data.get('repeat_end_date'))

    if s.is_allday and event_end is None:
        event_end = datetime.combine(_naive_local(s.event_date).date(), dtime(23, 59))
    _apply_end_dates(s, event_end, repeat_end, recurring, infinite)

    # 이동/귀가 일정의 메모(경로)를 직접 수정하면 자동 재생성 대상에서 제외 (기존 웹과 동일)
    if is_move and data.get('memo') is not None and s.memo != old_memo and s.kind == 'route':
        s.kind = 'custom_route'

    is_move_now = _is_move(s)
    busy_now = True if s.busy is None else bool(s.busy)
    if busy_now and not is_move_now:
        conflict = _check_conflict(uid, s.event_date, _event_end_of(s), bool(s.is_allday), exclude_id=s.id)
        if conflict:
            db.session.rollback()
            return jsonify({
                'error': 'schedule_conflict',
                'conflict_title': (conflict.title or '').strip() or '일정',
            }), 409

    s.route_dirty = True
    db.session.commit()

    from services.route_worker import enqueue_recalc
    enqueue_recalc(uid)
    return jsonify({'success': True, 'warning': _schedule_warning(s.location)})


@app_bp.route('/schedules/<int:schedule_id>', methods=['DELETE'])
@login_required
def app_schedules_delete(schedule_id):
    uid = g.app_user.id
    s = db.session.get(TongBotSchedule, schedule_id)
    if not s or s.user_id != uid:
        return jsonify({'error': 'not_found'}), 404

    data = request.get_json(silent=True) or {}
    mode = (request.args.get('mode') or data.get('mode') or 'all').strip()
    occ_raw = request.args.get('date') or data.get('date')
    occ = _parse_dt(occ_raw)
    is_move = _is_move(s)
    affected_days = set()

    if s.is_recurring and occ and mode in ('this_only', 'this_after'):
        if mode == 'this_only':
            try:
                exc = set(json.loads(s.repeat_exceptions or '[]'))
            except Exception:
                exc = set()
            exc.add(occ.strftime('%Y-%m-%d'))
            s.repeat_exceptions = json.dumps(sorted(exc), ensure_ascii=False)
            db.session.commit()
            if not is_move:
                from services.route_recalc import _ensure_day_routes
                _ensure_day_routes(uid, occ)
                db.session.commit()
            return jsonify({'success': True, 'mode': 'this_only'})

        start = _naive_local(s.event_date)
        if not start or occ <= start:
            pass  # 시작일 포함 이후 = 전체 삭제로 진행
        else:
            s.end_date = occ - timedelta(days=1)
            s.repeat_end_date = s.end_date
            s.repeat_infinite = False
            db.session.commit()
            if not is_move:
                from services.route_recalc import _ensure_day_routes
                tail_end = s.repeat_end_date.date() if s.repeat_end_date else (occ + timedelta(days=730)).date()
                cur = occ.date()
                guard = 0
                while cur <= tail_end and guard < 2000:
                    guard += 1
                    _ensure_day_routes(uid, datetime(cur.year, cur.month, cur.day))
                    cur += timedelta(days=1)
                db.session.commit()
            return jsonify({'success': True, 'mode': 'this_after'})

    if s.event_date:
        affected_days.add(s.event_date.date())
    if s.is_recurring and s.event_date:
        try:
            from tongbot_routes import _unocum_occurrences
            for o in _unocum_occurrences(s, s.event_date.date(), (s.repeat_end_date or (s.event_date + timedelta(days=730))).date()):
                affected_days.add(o.date())
        except Exception:
            pass

    db.session.delete(s)
    db.session.commit()

    if not is_move and affected_days:
        from services.route_worker import enqueue_recalc
        enqueue_recalc(uid, days=sorted(affected_days))

    return jsonify({'success': True, 'mode': 'all'})


# ---------------------------------------------------------------------------
# 경로 / 체크인
# ---------------------------------------------------------------------------
def _resolve_route_schedule(uid, s):
    if s.kind == 'route' or _is_move(s):
        return s
    base = _naive_local(s.event_date)
    day_start = datetime.combine(base.date(), dtime(0, 0))
    day_end = day_start + timedelta(days=1)
    rows = TongBotSchedule.query.filter(
        TongBotSchedule.user_id == uid,
        TongBotSchedule.kind == 'route',
        TongBotSchedule.event_date >= day_start,
        TongBotSchedule.event_date < day_end,
    ).all()
    if not rows:
        return None
    title_key = '%s 이동' % (s.title or '')
    for r in rows:
        if (r.title or '') == title_key and (not s.location or r.location == s.location):
            return r
    for r in rows:
        if s.location and r.location == s.location and '%s' % (s.title or '') in (r.title or ''):
            return r
    return None


def _routing_keys():
    cfg = current_app.config
    return {
        'naver_id': cfg.get('NAVER_CLIENT_ID') or os.getenv('NAVER_CLIENT_ID', ''),
        'naver_secret': cfg.get('NAVER_CLIENT_SECRET') or os.getenv('NAVER_CLIENT_SECRET', ''),
        'odsay_key': cfg.get('ODSAY_API_KEY') or os.getenv('ODSAY_API_KEY', ''),
        'google_key': cfg.get('GOOGLE_MAPS_API_KEY') or os.getenv('GOOGLE_MAPS_API_KEY', ''),
    }


def _home_anchor(user):
    addr = (user.curr_address or '').strip()
    if not addr:
        addr = ('%s %s' % (user.town or '', user.village or '')).strip()
    lat = user.curr_latitude or user.reg_latitude
    lng = user.curr_longitude or user.reg_longitude
    return addr, lat, lng


def _origin_dest_for(uid, s):
    """(origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, target_dt)"""
    user = db.session.get(User, uid)
    home_addr, home_lat, home_lng = _home_anchor(user) if user else ('', None, None)

    if _is_move(s):
        dest_name = (s.return_location or s.location or '').strip()
        origin_name = (s.departure_location or home_addr).strip()
        target_dt = s.end_date or s.event_date
    else:
        dest_name = (s.location or '').strip()
        prev = TongBotSchedule.query.filter(
            TongBotSchedule.user_id == uid,
            TongBotSchedule.id != s.id,
            TongBotSchedule.event_date < s.event_date,
            TongBotSchedule.event_date >= s.event_date - timedelta(hours=24),
            TongBotSchedule.location.isnot(None),
            TongBotSchedule.location != '',
            ~TongBotSchedule.title.like('%이동%'),
            ~TongBotSchedule.title.like('%귀가%'),
        ).order_by(TongBotSchedule.event_date.desc()).first()
        origin_name = (prev.location or '').strip() if prev else home_addr
        target_dt = s.event_date

    dest_lat, dest_lng = _geocode_location(dest_name) if dest_name else (None, None)
    origin_lat, origin_lng = _geocode_location(origin_name) if origin_name else (None, None)
    if not (origin_lat and origin_lng):
        origin_lat, origin_lng = home_lat, home_lng
    return origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng, _naive_local(target_dt)


def _generate_plan(uid, s):
    origin_name, olat, olng, dest_name, dlat, dlng, target_dt = _origin_dest_for(uid, s)
    if not (olat and olng and dlat and dlng and target_dt):
        return None
    # 일반 일정은 시작 10분 전 도착을 목표로 하고, 이동/귀가 일정은 계획 도착시각을 그대로 쓴다.
    arrival = target_dt if _is_move(s) else target_dt - timedelta(minutes=10)
    keys = _routing_keys()
    plan = plan_segment(
        origin_name, olat, olng, dest_name, dlat, dlng,
        arrival.strftime('%H:%M'),
        home_town=(g.app_user.town or '') if getattr(g, 'app_user', None) else '',
        home_village=(g.app_user.village or '') if getattr(g, 'app_user', None) else '',
        naver_id=keys['naver_id'], naver_secret=keys['naver_secret'],
        odsay_key=keys['odsay_key'], google_key=keys['google_key'],
    )
    if not plan:
        return None
    plan.update({'from_lat': olat, 'from_lng': olng, 'to_lat': dlat, 'to_lng': dlng, 'generated': True})
    if not plan.get('narrative'):
        plan['narrative'] = plan.get('compact') or ''
    return plan


def _actual_dict(a):
    if not a:
        return None
    return {
        'id': a.id,
        'plan_id': a.plan_id,
        'route_kind': a.route_kind,
        'depart_at': _iso(a.depart_at),
        'arrive_at': _iso(a.arrive_at),
        'duration_min': a.duration_min,
        'depart_lat': a.depart_lat,
        'depart_lng': a.depart_lng,
        'arrive_lat': a.arrive_lat,
        'arrive_lng': a.arrive_lng,
        'transfers': a.transfers,
        'walk_min': a.walk_min,
        'wait_min': a.wait_min,
        'source': a.source,
    }


@app_bp.route('/route/<int:schedule_id>', methods=['GET'])
@login_required
def app_route_detail(schedule_id):
    uid = g.app_user.id
    s = db.session.get(TongBotSchedule, schedule_id)
    if not s or s.user_id != uid:
        return jsonify({'error': 'not_found'}), 404

    route_s = _resolve_route_schedule(uid, s)
    plan = _plan_of(route_s) if route_s else None
    generated = False
    if not plan:
        plan = _generate_plan(uid, s)
        generated = bool(plan)
    if not plan:
        return jsonify({
            'error': 'route_not_ready',
            'message': '경로를 아직 계산할 수 없습니다. 장소/좌표를 확인해 주세요.',
        }), 422

    actual = AppRouteActual.query.filter_by(user_id=uid, plan_id=(route_s.id if route_s else s.id)).first()
    planned_min = _as_int(plan.get('total_min'))
    deviation = None
    if actual and actual.duration_min is not None and planned_min is not None:
        deviation = actual.duration_min - planned_min

    return jsonify({
        'schedule': _schedule_dict(route_s or s),
        'plan': plan,
        'plan_summary': _plan_summary(plan),
        'actual': _actual_dict(actual),
        'planned_min': planned_min,
        'deviation_min': deviation,
        'generated': generated,
    })


@app_bp.route('/route/<int:schedule_id>/checkin', methods=['POST'])
@login_required
def app_route_checkin(schedule_id):
    uid = g.app_user.id
    s = db.session.get(TongBotSchedule, schedule_id)
    if not s or s.user_id != uid:
        return jsonify({'error': 'not_found'}), 404

    data = request.get_json(silent=True) or {}
    ctype = (data.get('type') or '').strip()
    if ctype not in ('depart', 'arrive'):
        return jsonify({'error': 'invalid_type'}), 400

    route_s = _resolve_route_schedule(uid, s)
    plan = _plan_of(route_s or s)
    if not route_s and not plan:
        return jsonify({'error': 'route_not_ready'}), 409

    plan_id = (route_s.id if route_s else s.id)
    at = _parse_dt(data.get('at')) or _now()
    lat = _as_float(data.get('lat'))
    lng = _as_float(data.get('lng'))
    if lat is not None and not (-90 <= lat <= 90):
        return jsonify({'error': 'invalid_lat'}), 400
    if lng is not None and not (-180 <= lng <= 180):
        return jsonify({'error': 'invalid_lng'}), 400

    actual = AppRouteActual.query.filter_by(user_id=uid, plan_id=plan_id).first()
    if actual is None:
        actual = AppRouteActual(
            user_id=uid,
            plan_id=plan_id,
            route_kind=_route_kind(route_s or s),
            source='checkin',
            created_at=_now(),
        )
        db.session.add(actual)

    summary = _plan_summary(plan) if plan else None
    if summary:
        if actual.transfers is None:
            actual.transfers = summary.get('transfers')
        if actual.walk_min is None:
            actual.walk_min = summary.get('walk_min')
        if actual.wait_min is None:
            actual.wait_min = summary.get('wait_min')

    if ctype == 'depart':
        actual.depart_at = at
        actual.depart_lat = lat
        actual.depart_lng = lng
    else:
        actual.arrive_at = at
        actual.arrive_lat = lat
        actual.arrive_lng = lng
        depart_at = _naive_local(actual.depart_at)
        arrive_at = _naive_local(actual.arrive_at)
        if depart_at and arrive_at:
            actual.duration_min = int(round((arrive_at - depart_at).total_seconds() / 60.0))

    db.session.commit()

    planned_min = _as_int(plan.get('total_min')) if plan else None
    deviation = None
    if actual.duration_min is not None and planned_min is not None:
        deviation = actual.duration_min - planned_min

    return jsonify({
        'success': True,
        'checkin': {'type': ctype, 'at': _iso(at)},
        'actual': _actual_dict(actual),
        'planned_min': planned_min,
        'deviation_min': deviation,
    })


# ---------------------------------------------------------------------------
# 이동 요약 업로드 / 통계
# ---------------------------------------------------------------------------
def _trip_user_ref(user_id):
    secret = (current_app.config.get('SECRET_KEY') or 'fallback_dev_key').encode('utf-8')
    return hmac.new(secret, ('app-trip-user:%s' % user_id).encode('utf-8'), hashlib.sha256).hexdigest()[:32]


def _segment_key(depart_lat, depart_lng, arrive_lat, arrive_lng):
    if None in (depart_lat, depart_lng, arrive_lat, arrive_lng):
        return None
    try:
        return '%.3f,%.3f>%.3f,%.3f' % (
            float(depart_lat), float(depart_lng), float(arrive_lat), float(arrive_lng),
        )
    except Exception:
        return None


def _percentile(values, p):
    if not values:
        return None
    vals = sorted(values)
    if len(vals) == 1:
        return int(round(vals[0]))
    k = (len(vals) - 1) * p
    lo = int(math.floor(k))
    hi = min(lo + 1, len(vals) - 1)
    frac = k - lo
    return int(round(vals[lo] + (vals[hi] - vals[lo]) * frac))


def _recompute_route_stat(segment_key, dow, hour_bucket):
    if not segment_key:
        return
    rows = AppTripSummary.query.filter(AppTripSummary.segment_key == segment_key).all()
    vals = []
    for row in rows:
        if not row.start_at or row.duration_min is None:
            continue
        if (row.quality or 0) < 80:
            continue  # 익명 통계에는 품질 기준(80점) 이상만 반영
        if row.start_at.weekday() == dow and row.start_at.hour == hour_bucket:
            vals.append(row.duration_min)
    stat = AppRouteStat.query.filter_by(
        segment_key=segment_key, dow=dow, hour_bucket=hour_bucket,
    ).first()
    if not vals:
        if stat:
            db.session.delete(stat)
        return
    if stat is None:
        stat = AppRouteStat(segment_key=segment_key, dow=dow, hour_bucket=hour_bucket)
        db.session.add(stat)
    stat.median_min = _percentile(vals, 0.5)
    stat.p25 = _percentile(vals, 0.25)
    stat.p75 = _percentile(vals, 0.75)
    stat.samples = len(vals)


@app_bp.route('/trips', methods=['POST'])
@login_required
def app_trips_upload():
    uid = g.app_user.id
    data = request.get_json(silent=True) or {}

    start_at = _parse_dt(data.get('start_at') or data.get('started_at'))
    end_at = _parse_dt(data.get('end_at') or data.get('ended_at'))
    if not start_at:
        return jsonify({'error': 'start_at_required'}), 400
    duration = _as_int(data.get('duration_min'))
    if duration is None and end_at:
        duration = int(round((end_at - start_at).total_seconds() / 60.0))
    if duration is None or duration < 0:
        return jsonify({'error': 'duration_required'}), 400

    quality = _as_int(data.get('quality'), 0)
    quality = max(0, min(100, quality or 0))

    plan_id = _as_int(data.get('plan_id'))
    if plan_id is not None:
        plan_sched = db.session.get(TongBotSchedule, plan_id)
        if plan_sched and plan_sched.user_id != uid:
            return jsonify({'error': 'forbidden_plan'}), 403

    depart_lat = _as_float(data.get('depart_lat'))
    depart_lng = _as_float(data.get('depart_lng'))
    arrive_lat = _as_float(data.get('arrive_lat'))
    arrive_lng = _as_float(data.get('arrive_lng'))
    if depart_lat is not None and not (-90 <= depart_lat <= 90):
        return jsonify({'error': 'invalid_depart_lat'}), 400
    if arrive_lat is not None and not (-90 <= arrive_lat <= 90):
        return jsonify({'error': 'invalid_arrive_lat'}), 400
    if depart_lng is not None and not (-180 <= depart_lng <= 180):
        return jsonify({'error': 'invalid_depart_lng'}), 400
    if arrive_lng is not None and not (-180 <= arrive_lng <= 180):
        return jsonify({'error': 'invalid_arrive_lng'}), 400

    polyline = data.get('polyline_simplified')
    if isinstance(polyline, (list, dict)):
        polyline = json.dumps(polyline, separators=(',', ':'), ensure_ascii=False)
    if polyline is not None:
        polyline = str(polyline)
        if len(polyline) > 200000:
            return jsonify({'error': 'polyline_too_large', 'max_chars': 200000}), 413

    user_ref = _trip_user_ref(uid)
    segment_key = _segment_key(depart_lat, depart_lng, arrive_lat, arrive_lng)
    payload = {
        'route_kind': (data.get('route_kind') or 'move')[:20],
        'end_at': end_at,
        'duration_min': duration,
        'depart_lat': depart_lat,
        'depart_lng': depart_lng,
        'arrive_lat': arrive_lat,
        'arrive_lng': arrive_lng,
        'transfers': _as_int(data.get('transfers')),
        'walk_min': _as_int(data.get('walk_min')),
        'wait_min': _as_int(data.get('wait_min')),
        'quality': quality,
        'segment_key': segment_key,
        'polyline_simplified': polyline,
    }

    row = None
    if plan_id is not None:
        row = AppTripSummary.query.filter_by(
            user_ref=user_ref, plan_id=plan_id, start_at=start_at,
        ).first()
    if row is None:
        row = AppTripSummary(
            user_ref=user_ref,
            plan_id=plan_id,
            start_at=start_at,
            created_at=_now(),
        )
        db.session.add(row)
    for key, value in payload.items():
        setattr(row, key, value)
    db.session.commit()

    dow = start_at.weekday()
    hour_bucket = start_at.hour
    _recompute_route_stat(segment_key, dow, hour_bucket)
    db.session.commit()

    return jsonify({
        'success': True,
        'id': row.id,
        'quality': quality,
        'aggregated': quality >= 80,
        'segment_key': segment_key,
        'retention_days': _as_int(current_app.config.get('APP_TRIP_RETENTION_DAYS'), 180) or 180,
    }), 201


def _delay_tag(deviation):
    if deviation is None:
        return None
    if deviation <= -3:
        return 'early'
    if deviation <= 5:
        return 'on_time'
    if deviation <= 15:
        return 'delayed'
    return 'very_delayed'


@app_bp.route('/route-stats', methods=['GET'])
@login_required
def app_route_stats():
    uid = g.app_user.id
    days = _as_int(request.args.get('days'), 30) or 30
    days = max(1, min(days, 365))
    since = _now() - timedelta(days=days)
    user_ref = _trip_user_ref(uid)

    actuals = AppRouteActual.query.filter(
        AppRouteActual.user_id == uid,
        AppRouteActual.depart_at.isnot(None),
    ).order_by(AppRouteActual.depart_at.desc()).limit(50).all()

    recent = []
    durations = []
    for a in actuals:
        planned = None
        sched = db.session.get(TongBotSchedule, a.plan_id) if a.plan_id else None
        if sched:
            summary = _plan_summary(_plan_of(sched))
            if summary:
                planned = summary.get('total_min')
        deviation = (a.duration_min - planned) if (a.duration_min is not None and planned is not None) else None
        row = _actual_dict(a)
        row.update({
            'title': (sched.title if sched else ''),
            'planned_min': planned,
            'deviation_min': deviation,
            'delay_tag': _delay_tag(deviation),
        })
        recent.append(row)
        if a.duration_min is not None:
            durations.append(a.duration_min)

    summary = {
        'count': len(durations),
        'avg_min': int(round(statistics.mean(durations))) if durations else None,
        'median_min': _percentile(durations, 0.5),
        'p25': _percentile(durations, 0.25),
        'p75': _percentile(durations, 0.75),
        'stddev_min': int(round(statistics.pstdev(durations))) if len(durations) > 1 else 0,
    }

    uploaded = AppTripSummary.query.filter(
        AppTripSummary.user_ref == user_ref,
        AppTripSummary.start_at >= since,
    ).count()
    summary['uploaded_trips'] = uploaded

    segment_keys = [
        key for (key,) in db.session.query(AppTripSummary.segment_key).filter(
            AppTripSummary.user_ref == user_ref,
            AppTripSummary.start_at >= since,
            AppTripSummary.segment_key.isnot(None),
        ).distinct()
    ]
    segments = []
    if segment_keys:
        stat_rows = AppRouteStat.query.filter(
            AppRouteStat.segment_key.in_(segment_keys),
        ).order_by(AppRouteStat.samples.desc()).limit(20).all()
        for st in stat_rows:
            segments.append({
                'segment_key': st.segment_key,
                'dow': st.dow,
                'hour_bucket': st.hour_bucket,
                'median_min': st.median_min,
                'p25': st.p25,
                'p75': st.p75,
                'samples': st.samples or 0,
            })

    return jsonify({
        'days': days,
        'summary': summary,
        'recent': recent,
        'segments': segments,
    })


# ---------------------------------------------------------------------------
# 추천
# ---------------------------------------------------------------------------
def _confidence(samples):
    if samples >= 10:
        return 'high', 0.9
    if samples >= 5:
        return 'medium', 0.7
    if samples >= 1:
        return 'low', 0.5
    return 'none', 0.3


def _plan_signature(plan):
    steps = plan.get('steps') or []
    return tuple((st.get('mode'), st.get('from'), st.get('to'), st.get('time_min')) for st in steps)


@app_bp.route('/recommend/<int:schedule_id>', methods=['GET'])
@login_required
def app_recommend(schedule_id):
    uid = g.app_user.id
    s = db.session.get(TongBotSchedule, schedule_id)
    if not s or s.user_id != uid:
        return jsonify({'error': 'not_found'}), 404

    origin_name, olat, olng, dest_name, dlat, dlng, target_dt = _origin_dest_for(uid, s)
    if not (olat and olng and dlat and dlng and target_dt):
        return jsonify({
            'error': 'location_not_found',
            'message': '출발지 또는 도착지 좌표를 확인할 수 없습니다.',
        }), 422

    keys = _routing_keys()
    arrival_min_dt = target_dt if _is_move(s) else target_dt - timedelta(minutes=10)
    arrival_min = arrival_min_dt.hour * 60 + arrival_min_dt.minute
    from services.directions import odsay_transit_options
    options = odsay_transit_options(
        olat, olng, dlat, dlng, keys['odsay_key'],
        arrival_min=arrival_min, limit=3,
    )
    fallback = False
    if not options:
        fallback = True
        plan = _generate_plan(uid, s)
        if plan:
            summary = _plan_summary(plan)
            plan.update({
                'transfers': summary.get('transfers') if summary else 0,
                'walk_min': summary.get('walk_min') if summary else 0,
                'wait_min': summary.get('wait_min') if summary else 0,
            })
            options = [plan]
    if not options:
        return jsonify({
            'error': 'no_candidates',
            'message': '추천 경로를 계산할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        }), 503

    # 후보 선정: 최소시간 / 최소환승 / 최소도보
    remaining = list(options)
    picks = []
    selectors = (
        ('min_time', '최소 시간', lambda p: (p.get('total_min') or 9999, p.get('transfers') or 0)),
        ('min_transfers', '최소 환승', lambda p: (p.get('transfers') or 0, p.get('total_min') or 9999)),
        ('min_walk', '최소 도보', lambda p: (p.get('walk_min') or 9999, p.get('total_min') or 9999)),
    )
    seen = set()
    for kind, label, keyfn in selectors:
        pool = [p for p in remaining if _plan_signature(p) not in seen]
        if not pool:
            continue
        chosen = min(pool, key=keyfn)
        seen.add(_plan_signature(chosen))
        picks.append((kind, label, chosen))
    for p in remaining:
        if len(picks) >= 3:
            break
        if _plan_signature(p) in seen:
            continue
        seen.add(_plan_signature(p))
        picks.append(('alternative', '대안 경로', p))

    segment_key = _segment_key(olat, olng, dlat, dlng)
    since = _now() - timedelta(days=30)
    samples = 0
    median_recorded = None
    if segment_key:
        rows = AppTripSummary.query.filter(
            AppTripSummary.segment_key == segment_key,
            AppTripSummary.start_at >= since,
            AppTripSummary.quality >= 80,
        ).all()
        vals = [r.duration_min for r in rows if r.duration_min is not None]
        samples = len(vals)
        median_recorded = _percentile(vals, 0.5)
    level, score = _confidence(samples)
    basis = '최근 30일 이 구간 표본 %d건' % samples
    if median_recorded is not None:
        basis += ' (중앙값 %d분)' % median_recorded

    out_options = []
    for kind, label, plan in picks:
        summary = _plan_summary(plan)
        item = {
            'kind': kind,
            'label': label,
            'total_min': plan.get('total_min'),
            'transfers': plan.get('transfers', summary.get('transfers') if summary else None),
            'walk_min': plan.get('walk_min', summary.get('walk_min') if summary else None),
            'wait_min': plan.get('wait_min', summary.get('wait_min') if summary else None),
            'distance_km': plan.get('distance_km'),
            'departure': plan.get('departure') or '',
            'arrival': plan.get('arrival') or '',
            'steps': plan.get('steps') or [],
            'narrative': plan.get('narrative') or '',
            'confidence': {
                'level': level,
                'score': score,
                'samples': samples,
                'basis': basis,
            },
        }
        out_options.append(item)

    result = {
        'schedule_id': s.id,
        'origin': {'name': origin_name, 'lat': olat, 'lng': olng},
        'destination': {'name': dest_name, 'lat': dlat, 'lng': dlng},
        'target_arrival': _iso(target_dt),
        'based_on': {
            'samples': samples,
            'median_min': median_recorded,
            'window_days': 30,
            'level': level,
        },
        'fallback': fallback,
        'options': out_options,
    }

    AppRecommendation.query.filter_by(plan_id=s.id).delete(synchronize_session=False)
    db.session.add(AppRecommendation(
        plan_id=s.id,
        options_json=json.dumps(result, ensure_ascii=False),
        created_at=_now(),
    ))
    db.session.commit()

    return jsonify(result)


# ---------------------------------------------------------------------------
# 기기 / 동의 / 전체 삭제
# ---------------------------------------------------------------------------
@app_bp.route('/device', methods=['POST'])
@login_required
def app_device_register():
    uid = g.app_user.id
    data = request.get_json(silent=True) or {}
    platform = (data.get('platform') or '').strip().lower()
    token = (data.get('push_token') or '').strip()
    enabled = _as_bool(data.get('enabled'), True)

    if platform not in ('ios', 'android'):
        return jsonify({'error': 'invalid_platform'}), 400
    if not token:
        return jsonify({'error': 'push_token_required'}), 400

    existing = AppDevice.query.filter_by(push_token=token).first()
    if not enabled:
        if existing:
            db.session.delete(existing)
            db.session.commit()
        return jsonify({'success': True, 'enabled': False})

    if existing:
        existing.user_id = uid
        existing.platform = platform
        existing.updated_at = _now()
    else:
        db.session.add(AppDevice(
            user_id=uid,
            platform=platform,
            push_token=token,
            updated_at=_now(),
        ))
    db.session.commit()
    return jsonify({'success': True, 'enabled': True})


@app_bp.route('/consent', methods=['POST'])
@login_required
def app_consent():
    uid = g.app_user.id
    data = request.get_json(silent=True) or {}
    row = AppConsent(
        user_id=uid,
        location=_as_bool(data.get('location'), False),
        background=_as_bool(data.get('background'), False),
        aggregate_use=_as_bool(data.get('aggregate_use'), False),
        version=(data.get('version') or '1.0')[:20],
        created_at=_now(),
    )
    db.session.add(row)
    db.session.commit()
    return jsonify({
        'success': True,
        'id': row.id,
        'version': row.version,
        'created_at': _iso(row.created_at),
    }), 201


@app_bp.route('/my-data', methods=['DELETE'])
@login_required
def app_my_data_delete():
    uid = g.app_user.id
    user = g.app_user
    user_ref = _trip_user_ref(uid)

    plan_rows = TongBotSchedule.query.filter_by(user_id=uid).all()
    plan_ids = [p.id for p in plan_rows]
    deleted = {
        'schedules': 0,
        'route_actual': 0,
        'trips': 0,
        'recommendations': 0,
        'devices': 0,
        'consents': 0,
    }

    deleted['route_actual'] = AppRouteActual.query.filter_by(user_id=uid).delete(synchronize_session=False)
    deleted['trips'] = AppTripSummary.query.filter_by(user_ref=user_ref).delete(synchronize_session=False)
    if plan_ids:
        deleted['recommendations'] = AppRecommendation.query.filter(
            AppRecommendation.plan_id.in_(plan_ids),
        ).delete(synchronize_session=False)
    deleted['devices'] = AppDevice.query.filter_by(user_id=uid).delete(synchronize_session=False)
    deleted['consents'] = AppConsent.query.filter_by(user_id=uid).delete(synchronize_session=False)

    if user.email:
        AppLoginAttempt.query.filter_by(email_hash=_sha256(user.email.strip().lower())[:64]).delete(
            synchronize_session=False,
        )

    deleted['schedules'] = TongBotSchedule.query.filter_by(user_id=uid).delete(synchronize_session=False)

    # 계정 익명화(소프트 삭제) — 웹 콘텐츠 참조는 깨지지 않게 유지
    user.username = '탈퇴회원'
    user.real_name = None
    user.email = None
    user.email_verified = False
    user.phone = None
    user.password = generate_password_hash(os.urandom(24).hex())
    user.password_v2 = False
    user.social_id = None
    user.social_email = None
    user.social_provider = None
    user.reset_token = None
    user.reset_token_expiry = None
    user.email_verification_token = None
    user.email_verification_sent_at = None
    user.photo_path = None
    user.bill_image_path = None
    user.managed_pages = ''
    user.town = None
    user.village = None
    user.reg_town = None
    user.reg_village = None
    user.reg_latitude = None
    user.reg_longitude = None
    user.curr_latitude = None
    user.curr_longitude = None
    user.curr_town = None
    user.curr_village = None
    user.curr_address = None
    user.office_address = None
    user.office_latitude = None
    user.office_longitude = None
    user.temp_address = None
    user.temp_latitude = None
    user.temp_longitude = None
    user.temp_start_date = None
    user.temp_end_date = None
    user.login_latitude = None
    user.login_longitude = None
    user.login_town = None
    user.login_village = None
    user.location_share = False
    user.login_location_share = False
    user.block_order_profile = None
    user.block_order_intro = None
    user.points = 0
    user.is_paid = False
    user.last_login = None

    db.session.commit()
    return jsonify({'success': True, 'deleted': deleted})
