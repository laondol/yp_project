"""경로 API 호출 가드: 일일 한도, 영구 캐시, 제공자 상태

- 제공자별 일일 호출 한도 관리 (ODsay 기본 30회)
- 좌표 반올림(약 11m) + 도착시간 30분 버킷으로 캐시
- 한도 초과/장애 시 다른 제공자로 자동 전환할 수 있도록 상태 기록
"""
import os
import json
from datetime import datetime, timezone, timedelta

from models import db, RouteCache, ApiUsage, ProviderHealth

KST = timezone(timedelta(hours=9))


def today_str():
    return datetime.now(KST).strftime('%Y-%m-%d')


def _limit(provider):
    key = f'{provider.upper()}_DAILY_LIMIT'
    defaults = {'ODSAY': 30, 'NAVER': 100000, 'KAKAO': 100000, 'GOOGLE': 1000, 'SEOUL_SUBWAY': 1000, 'TAGO_TRAIN': 10000, 'TAGO_ARRIVAL': 10000}
    try:
        return int(os.getenv(key, defaults.get(provider.upper(), 1000)))
    except Exception:
        return defaults.get(provider.upper(), 1000)


def usage_today(provider):
    row = ApiUsage.query.filter_by(day=today_str(), provider=provider).first()
    return row.count if row else 0


def can_call(provider, reserve=0):
    return usage_today(provider) < max(0, _limit(provider) - reserve)


def is_available(provider):
    """최근 24시간 내 404/인증 오류가 있으면 사용 불가로 판단"""
    row = ProviderHealth.query.filter_by(provider=provider).first()
    if not row or not row.last_fail_at:
        return True
    if (datetime.now() - row.last_fail_at) > timedelta(hours=24):
        return True
    err = (row.last_error or '')
    if '429' in err:
        # 당일 한도 초과 → 다음 날까지 사용 중지
        return row.last_fail_at.date() < datetime.now().date()
    return not (err.startswith('http 404') or err.startswith('http 401') or err.startswith('http 403'))


def incr_usage(provider, n=1):
    day = today_str()
    row = ApiUsage.query.filter_by(day=day, provider=provider).first()
    if not row:
        row = ApiUsage(day=day, provider=provider, count=0)
        db.session.add(row)
    row.count = (row.count or 0) + n
    db.session.commit()
    return row.count


def mark_health(provider, ok, error=''):
    row = ProviderHealth.query.filter_by(provider=provider).first()
    if not row:
        row = ProviderHealth(provider=provider, ok_count=0, fail_count=0)
        db.session.add(row)
    now = datetime.now()
    if ok:
        row.ok_count = (row.ok_count or 0) + 1
        row.last_ok_at = now
    else:
        row.fail_count = (row.fail_count or 0) + 1
        row.last_fail_at = now
        row.last_error = (error or '')[:200]
    db.session.commit()


def cache_key(mode, flat, flng, tlat, tlng, arrival_min=None):
    """좌표 4자리(약 11m) + 도착시간 30분 버킷"""
    bucket = int((arrival_min or 0) // 30)
    return f'{mode}:{flat:.4f},{flng:.4f}:{tlat:.4f},{tlng:.4f}:{bucket}'


def cache_get(key, ttl_days=14):
    row = RouteCache.query.filter_by(key=key).first()
    if not row:
        return None
    try:
        if row.created_at and (datetime.now() - row.created_at).days > ttl_days:
            return None
    except Exception:
        return None
    try:
        return json.loads(row.steps_json or '[]'), row.total_min, row.distance_km
    except Exception:
        return None


def cache_set(key, steps, total_min, distance_km, provider=''):
    row = RouteCache.query.filter_by(key=key).first()
    payload = json.dumps(steps or [], ensure_ascii=False)
    if row:
        row.steps_json = payload
        row.total_min = total_min
        row.distance_km = distance_km
        row.provider = provider
        row.created_at = datetime.now()
    else:
        db.session.add(RouteCache(key=key, steps_json=payload, total_min=total_min,
                                  distance_km=distance_km, provider=provider))
    db.session.commit()


def usage_summary():
    out = []
    for name, limit in [('ODSAY', _limit('ODSAY')), ('NAVER', _limit('NAVER')),
                        ('KAKAO', _limit('KAKAO')), ('GOOGLE', _limit('GOOGLE')),
                        ('SEOUL_SUBWAY', _limit('SEOUL_SUBWAY')),
                        ('TAGO_TRAIN', _limit('TAGO_TRAIN')),
                        ('TAGO_ARRIVAL', _limit('TAGO_ARRIVAL'))]:
        out.append({'provider': name, 'used': usage_today(name), 'limit': limit})
    return out
