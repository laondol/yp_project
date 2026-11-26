"""경기도 버스 실시간 도착 (GBIS, stationId 기준)

- 정류소 ID(240000047 등)로 노선별 도착 예정(분)을 조회
- 30초 메모리 캐시 (같은 요청에서 반복 조회 방지)
"""
import os
import time

_MEM = {}
_TTL = 30


def _key():
    k = os.getenv('GG_BUS_API_KEY', '')
    if k:
        return k
    try:
        from flask import current_app
        return current_app.config.get('GG_BUS_API_KEY', '')
    except Exception:
        return ''


def _items(data):
    if not isinstance(data, dict):
        return []
    body = ((data.get('response') or {}).get('msgBody') or {})
    rows = body.get('busArrivalList')
    if rows is None:
        return []
    return rows if isinstance(rows, list) else [rows]


def arrivals(station_id):
    """[{route, min1, min2, dest, station_nm1}] — 도착 예정(분)"""
    sid = str(station_id or '').strip()
    if not sid:
        return []
    hit = _MEM.get(sid)
    if hit and hit[0] + _TTL > time.time():
        return hit[1]
    key = _key()
    if not key:
        return []
    try:
        import requests
        r = requests.get('https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2',
                         params={'serviceKey': key, 'stationId': sid, 'format': 'json'},
                         timeout=6)
        if r.status_code != 200:
            return []
        rows = _items(r.json())
    except Exception:
        return []

    out = []
    for x in rows:
        try:
            m1 = int(x.get('predictTime1') or -1)
        except Exception:
            m1 = -1
        try:
            m2 = int(x.get('predictTime2') or -1)
        except Exception:
            m2 = -1
        name = str(x.get('routeName') or '').strip()
        if not name:
            continue
        out.append({
            'route': name,
            'min1': m1 if m1 >= 0 else None,
            'min2': m2 if m2 >= 0 else None,
            'dest': str(x.get('routeDestName') or ''),
            'current_stop': str(x.get('stationNm1') or ''),
            'low': bool(x.get('lowPlate1')),
        })
    out.sort(key=lambda a: (a['min1'] if a['min1'] is not None else 9999))
    _MEM[sid] = (time.time(), out)
    return out


def eta_for(station_id, route_no):
    """특정 노선의 도착 예정(분)"""
    target = str(route_no or '').replace('번', '').strip()
    for a in arrivals(station_id):
        if str(a['route']).replace('번', '').strip() == target:
            return a['min1']
    return None
