"""경기도 양평군 버스정보 (공공데이터포털 odcloud) 연동

- 데이터: 노선번호, 기점/종점, 경유지, 거리, 출발시간표
- 용도: ODsay 한도 초과/장애 시 양평 지역 버스 기반 경로 추정
- 주의: 실시간 도착정보가 아니라 '운행시간표' 기반 데이터
"""
import os
import re
import json
from datetime import datetime, timedelta

from models import db, PublicDataCache

DATASET_URL = ('https://api.odcloud.kr/api/3066397/v1/'
               'uddi:ee5cc6ff-782c-4b22-a53d-ff17fc667cc3')
CACHE_KEY = 'yp_bus_routes'
CACHE_DAYS = 7
AVG_KMH = 36.0  # 시내버스 평균 속도 가정


def _api_key():
    key = os.getenv('ODCLOUD_API_KEY', '')
    if key:
        return key
    try:
        from flask import current_app
        return current_app.config.get('ODCLOUD_API_KEY', '')
    except Exception:
        return ''


def _cache_get():
    row = PublicDataCache.query.filter_by(key=CACHE_KEY).first()
    if not row:
        return None
    try:
        if row.fetched_at and (datetime.now() - row.fetched_at).days > CACHE_DAYS:
            return None
        return json.loads(row.payload or '[]')
    except Exception:
        return None


def _cache_set(rows):
    row = PublicDataCache.query.filter_by(key=CACHE_KEY).first()
    payload = json.dumps(rows, ensure_ascii=False)
    if row:
        row.payload = payload
        row.fetched_at = datetime.now()
    else:
        db.session.add(PublicDataCache(key=CACHE_KEY, payload=payload))
    db.session.commit()


def fetch_routes(force=False):
    """노선 목록 조회 (7일 캐시)"""
    if not force:
        cached = _cache_get()
        if cached:
            return cached
    key = _api_key()
    if not key:
        return _cache_get() or []
    try:
        import requests
        r = requests.get(DATASET_URL, params={
            'page': 1, 'perPage': 1000, 'returnType': 'json', 'serviceKey': key,
        }, timeout=15)
        if r.status_code != 200:
            return _cache_get() or []
        data = r.json()
        rows = data.get('data') or []
        if rows:
            _cache_set(rows)
        return rows
    except Exception:
        return _cache_get() or []


def _norm(s):
    s = (s or '').strip()
    s = re.sub(r'\s+', '', s)
    s = s.replace('정류장', '').replace('정류소', '')
    return s


def _stops(row):
    names = []
    for f in ('기점', '종점'):
        v = row.get(f)
        if v:
            names.append(v)
    for v in (row.get('경유지') or '').split(','):
        v = v.strip()
        if v:
            names.append(v)
    return names


def find_routes(from_name, to_name, limit=5):
    """출발/도착 이름이 노선 경유지 순서상 존재하는 노선 찾기"""
    f = _norm(from_name)
    t = _norm(to_name)
    if not f or not t:
        return []
    out = []
    for row in fetch_routes():
        stops = [_norm(x) for x in _stops(row)]
        if not stops:
            continue
        fi = ti = -1
        for i, s in enumerate(stops):
            if fi < 0 and s and s == f:
                fi = i
            if t and s == t:
                ti = i
        if fi >= 0 and ti > fi:
            out.append(row)
            if len(out) >= limit:
                break
    return out


def _times(s):
    res = []
    for x in (s or '').split(','):
        x = x.strip()
        m = re.match(r'^(\d{1,2}):(\d{2})$', x)
        if m:
            h, mi = int(m.group(1)), int(m.group(2))
            if 0 <= h < 24 and 0 <= mi < 60:
                res.append(h * 60 + mi)
    return sorted(res)


def _hm(m):
    m = int(m) % (24 * 60)
    return f'{m // 60:02d}:{m % 60:02d}'


def plan(from_name, to_name, arrival_min, direct_km=None):
    """양평군 버스 시간표 기반 경로 추정. 없으면 None."""
    if arrival_min is None:
        return None
    routes = find_routes(from_name, to_name, limit=10)
    if not routes:
        return None

    def _dist(r):
        try:
            return float(r.get('거리(킬로미터)') or 0)
        except Exception:
            return 0

    routes = [r for r in routes if _dist(r) > 0]
    if not routes:
        return None
    row = min(routes, key=_dist)
    dist = _dist(row)
    if direct_km and dist > max(direct_km * 2.5, direct_km + 8):
        return None
    ride_min = int(dist / AVG_KMH * 60) + 8

    bus_no_early = (row.get('노선번호') or '').strip('[]')
    wait_min = 10
    # 실시간 도착정보가 있으면 대기시간 보정 (ODsay 잔여 한도가 있을 때만)
    try:
        from services import route_guard as _rg2
        if _rg2.can_call('ODSAY', reserve=1):
            from services.directions import gyeonggi_bus_realtime
            rt = gyeonggi_bus_realtime(from_name)
            for x in (rt or []):
                if str(x.get('route', '')).strip('[]') == bus_no_early:
                    wait_min = max(1, min(wait_min, int(x.get('min') or wait_min)))
                    break
    except Exception:
        pass
    total_min = ride_min + wait_min

    deps = _times(row.get('기점 출발시간'))
    if deps:
        # 도착 목표에 맞는 가장 늦은 출발 (없으면 첫차)
        candidates = [d for d in deps if d + total_min <= arrival_min]
        dep = max(candidates) if candidates else deps[0]
    else:
        dep = arrival_min - total_min

    bus_no = (row.get('노선번호') or '').strip('[]')
    stops = (row.get('경유지') or '').replace(',', ' → ')
    steps = [
        {'mode': '🚏 대기', 'from': from_name, 'to': f"{row.get('기점','')} 정류장",
         'detail': f"{row.get('기점','')}에서 대기 약 {wait_min}분", 'time_min': wait_min},
        {'mode': '🚌 버스', 'from': row.get('기점', ''), 'to': row.get('종점', ''),
         'detail': f"{bus_no}번 ({dist:.1f}km, 경유: {stops})", 'time_min': ride_min,
         'bus_no': f'{bus_no}번'},
    ]
    return {
        'steps': steps,
        'total_min': total_min,
        'departure': _hm(dep),
        'arrival': _hm(arrival_min),
        'distance_km': round(dist, 1),
        'source': 'yp_bus',
        'estimated': True,
        'note': '양평군 버스 시간표 기반 추정',
    }
