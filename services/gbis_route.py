"""경기도 버스노선 조회 (GBIS, data.go.kr 6410000/busrouteservice/v2)

- 노선번호 → 노선ID 목록
- 노선ID → 경유 정류소 목록(좌표 포함), 노선 기본정보(첫차/막차/배차)
- 일일 트래픽 1,000회(기능별) → PublicDataCache 캐시로 호출 최소화
"""
import json
import os
from datetime import datetime, timedelta

from models import db, PublicDataCache

BASE = 'https://apis.data.go.kr/6410000/busrouteservice/v2'
LIST_TTL_H = 24
STOPS_TTL_D = 7
INFO_TTL_D = 7


def _key():
    k = os.getenv('GG_BUS_API_KEY', '')
    if k:
        return k
    try:
        from flask import current_app
        return current_app.config.get('GG_BUS_API_KEY', '')
    except Exception:
        return ''


def _cache_get(key, ttl):
    row = PublicDataCache.query.filter_by(key=key).first()
    if not row or not row.fetched_at:
        return None
    if datetime.now() - row.fetched_at > ttl:
        return None
    try:
        return json.loads(row.payload or 'null')
    except Exception:
        return None


def _cache_set(key, value):
    row = PublicDataCache.query.filter_by(key=key).first()
    payload = json.dumps(value, ensure_ascii=False)
    if row:
        row.payload = payload
        row.fetched_at = datetime.now()
    else:
        db.session.add(PublicDataCache(key=key, payload=payload))
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()


def _items(data, name):
    if not isinstance(data, dict):
        return []
    body = ((data.get('response') or {}).get('msgBody') or {})
    rows = body.get(name)
    if rows is None:
        return []
    return rows if isinstance(rows, list) else [rows]


_QUOTA = {'blocked_at': 0.0}


def quota_blocked():
    """일일 한도 초과 상태인지 (1시간 유지)"""
    return _QUOTA['blocked_at'] + 3600 > __import__('time').time()


def _get(path, params):
    import requests, time as _t
    key = _key()
    if not key or quota_blocked():
        return []
    try:
        r = requests.get(f'{BASE}/{path}', params={**params, 'serviceKey': key, 'format': 'json'}, timeout=12)
        if r.status_code == 429 or 'LIMITED_NUMBER_OF_SERVICE' in r.text[:300]:
            _QUOTA['blocked_at'] = _t.time()
            return []
        if r.status_code != 200:
            return []
        return r.json()
    except Exception:
        return []


def route_list(keyword):
    """노선번호로 노선 목록 조회 [{routeId, routeName, startStationName, endStationName, ...}]"""
    kw = (keyword or '').strip()
    if not kw:
        return []
    ck = f'gbis_route_list:{kw}'
    hit = _cache_get(ck, timedelta(hours=LIST_TTL_H))
    if hit is not None:
        return hit
    data = _get('getBusRouteListv2', {'keyword': kw})
    rows = _items(data, 'busRouteList')
    out = [{
        'route_id': str(x.get('routeId') or ''),
        'route_name': str(x.get('routeName') or ''),
        'route_type': str(x.get('routeTypeName') or ''),
        'start_name': str(x.get('startStationName') or ''),
        'end_name': str(x.get('endStationName') or ''),
        'region': str(x.get('regionName') or ''),
        'admin': str(x.get('adminName') or ''),
    } for x in rows if x.get('routeId')]
    _cache_set(ck, out)
    return out


def route_stations(route_id):
    """노선 경유 정류소 [{seq, station_id, name, lat, lng}]"""
    rid = str(route_id or '')
    if not rid:
        return []
    ck = f'gbis_route_stops:{rid}'
    miss_ck = f'gbis_route_stops_miss:{rid}'
    if _cache_get(miss_ck, timedelta(hours=6)) is not None:
        return []
    hit = _cache_get(ck, timedelta(days=STOPS_TTL_D))
    if hit:
        return hit
    data = _get('getBusRouteStationListv2', {'routeId': rid})
    rows = _items(data, 'busRouteStationList')
    if not rows:
        # 한도 초과/미제공 → 6시간 부정 캐시 (재호출 방지)
        _cache_set(miss_ck, [])
        return []
    out = []
    for x in rows:
        try:
            out.append({
                'seq': int(x.get('stationSeq') or 0),
                'station_id': str(x.get('stationId') or ''),
                'name': str(x.get('stationName') or ''),
                'lat': float(x.get('y')),
                'lng': float(x.get('x')),
                'turn_yn': str(x.get('turnYn') or ''),
            })
        except Exception:
            continue
    out.sort(key=lambda r: r['seq'])
    _cache_set(ck, out)
    return out


def route_info(route_id):
    """노선 기본정보 (첫차/막차/배차)"""
    rid = str(route_id or '')
    if not rid:
        return None
    ck = f'gbis_route_info:{rid}'
    hit = _cache_get(ck, timedelta(days=INFO_TTL_D))
    if hit is not None:
        return hit
    data = _get('getBusRouteInfoItemv2', {'routeId': rid})
    rows = _items(data, 'busRouteInfoItem')
    if not rows:
        return None
    x = rows[0]
    out = {
        'route_id': str(x.get('routeId') or ''),
        'route_name': str(x.get('routeName') or ''),
        'route_type': str(x.get('routeTypeName') or ''),
        'start_name': str(x.get('startStationName') or ''),
        'end_name': str(x.get('endStationName') or ''),
        'up_first': str(x.get('upFirstTime') or ''),
        'up_last': str(x.get('upLastTime') or ''),
        'down_first': str(x.get('downFirstTime') or ''),
        'down_last': str(x.get('downLastTime') or ''),
        'peak_alloc': x.get('peekAlloc'),
        'company': str(x.get('companyName') or ''),
        'company_tel': str(x.get('companyTel') or ''),
    }
    _cache_set(ck, out)
    return out


def find_station(name_part):
    """노선 정류소 전체에서 이름 일부로 검색 (이미 캐시된 노선 대상)"""
    rows = PublicDataCache.query.filter(PublicDataCache.key.like('gbis_route_stops:%')).all()
    found = []
    for row in rows:
        try:
            stops = json.loads(row.payload or '[]')
        except Exception:
            continue
        rid = row.key.split(':', 1)[1]
        for s in stops:
            if name_part and name_part in s.get('name', ''):
                found.append({'route_id': rid, **s})
    return found
