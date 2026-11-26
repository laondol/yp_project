"""버스 노선 선형(폴리라인) 기반 연결 판정

정류소 목록 API의 일일 한도가 소진됐을 때도,
노선 선형 정보로 "이 정류장과 저 정류장을 실제로 지나가는가"를 확인할 수 있다.

- getBusRouteLineListv2: 노선 형상 좌표(2,000점 내외)
- 결과는 PublicDataCache 에 7일 캐시
"""
import json
import math
import os
from datetime import datetime, timedelta

from models import db, PublicDataCache

BASE = 'https://apis.data.go.kr/6410000/busrouteservice/v2'
CACHE_D = 7
R = 6371000.0


def _key():
    k = os.getenv('GG_BUS_API_KEY', '')
    if k:
        return k
    try:
        from flask import current_app
        return current_app.config.get('GG_BUS_API_KEY', '')
    except Exception:
        return ''


def _cache_get(key, days=CACHE_D):
    row = PublicDataCache.query.filter_by(key=key).first()
    if not row or not row.fetched_at:
        return None
    if datetime.now() - row.fetched_at > timedelta(days=days):
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


def _dist_m(a_lat, a_lng, b_lat, b_lng):
    try:
        p1, p2 = math.radians(a_lat), math.radians(b_lat)
        dp = p2 - p1
        dl = math.radians(b_lng - a_lng)
        h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * R * math.asin(math.sqrt(h))
    except Exception:
        return 1e9


def line(route_id):
    """노선 형상 [(lat, lng)] (7일 캐시)"""
    rid = str(route_id or '')
    if not rid:
        return []
    ck = f'gbis_route_line:{rid}'
    hit = _cache_get(ck)
    if hit is not None:
        return [(p[0], p[1]) for p in hit]
    key = _key()
    if not key:
        return []
    try:
        import requests
        r = requests.get(f'{BASE}/getBusRouteLineListv2',
                         params={'serviceKey': key, 'routeId': rid, 'format': 'json'}, timeout=12)
        if r.status_code != 200:
            return []
        rows = (((r.json().get('response') or {}).get('msgBody') or {})
                .get('busRouteLineList')) or []
        pts = []
        for x in rows:
            try:
                pts.append([float(x['y']), float(x['x'])])
            except Exception:
                continue
        if pts:
            _cache_set(ck, pts)
        return [(p[0], p[1]) for p in pts]
    except Exception:
        return []


def nearest_index(pts, lat, lng):
    best, bi = 1e18, -1
    for i, (plat, plng) in enumerate(pts):
        d = _dist_m(lat, lng, plat, plng)
        if d < best:
            best, bi = d, i
    return bi, best


def link(route_id, a_lat, a_lng, b_lat, b_lng, tol_m=350):
    """노선이 두 지점을 지나면 (구간거리 km, 선형상 위치) 반환"""
    pts = line(route_id)
    if len(pts) < 2:
        return None
    ia, da = nearest_index(pts, a_lat, a_lng)
    ib, db = nearest_index(pts, b_lat, b_lng)
    if ia < 0 or ib < 0 or da > tol_m or db > tol_m:
        return None
    lo, hi = (ia, ib) if ia <= ib else (ib, ia)
    dist = 0.0
    for i in range(lo, hi):
        dist += _dist_m(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
    if dist <= 0:
        return None
    return {'km': round(dist / 1000, 1), 'from_idx': ia, 'to_idx': ib, 'a_dist_m': int(da), 'b_dist_m': int(db)}


def options_near(from_lat, from_lng, to_lat, to_lng, limit=4, radius_km=1.2, max_km=30):
    """출발지 주변 정류장의 실시간 노선 중, 선형이 목적지를 지나는 버스 후보

    반환: [{route, eta_min, stop, stop_distance_m, km, ride_min, walk_min, total_min}]
    """
    try:
        from services import transit_graph as tg, gbis_arrival as ga, gbis_route as gr
        g = tg.build_graph()
    except Exception:
        return []

    stops = []
    for k, v in g['stops'].items():
        if v.get('lat') is None:
            continue
        d = _dist_m(from_lat, from_lng, v['lat'], v['lng']) / 1000.0
        if d <= radius_km:
            stops.append((d, k, v))
    stops.sort(key=lambda x: x[0])
    if not stops:
        return []

    sid_map = g.get('station_ids', {})
    out = []
    seen = set()
    calls = 0
    for d, k, v in stops[:3]:
        sids = sid_map.get(k) or []
        if isinstance(sids, str):
            sids = [sids]
        for sid in sids[:2]:
            for a in ga.arrivals(sid):
                if a.get('min1') is None or a['route'] in seen:
                    continue
                if calls >= 12:
                    break
                calls += 1
                for r in gr.route_list(a['route'])[:2]:
                    lk = link(r['route_id'], v['lat'], v['lng'], to_lat, to_lng)
                    if not lk or lk['km'] > max_km:
                        continue
                    ride = max(2, int(round(lk['km'] / 25 * 60)) + 2)
                    walk = max(1, int(round(d / 4.5 * 60)) + 1)
                    out.append({
                        'route': a['route'], 'eta_min': a['min1'],
                        'stop': v['name'], 'stop_distance_m': int(round(d * 1000)),
                        'km': lk['km'], 'ride_min': ride, 'walk_min': walk,
                        'total_min': walk + a['min1'] + ride,
                    })
                    seen.add(a['route'])
                    break
    out.sort(key=lambda x: x['total_min'])
    return out[:limit]
