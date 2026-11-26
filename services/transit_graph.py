"""양평 버스 시간표 기반 자체 경로 탐색 엔진 (1단계)

- 데이터: 양평군 버스 시간표(odcloud) + 경유지 좌표(transit_stop_geo), 7일 캐시
- 방식: 노선 그래프 + 시간표 역방향 스케줄링 (도착 희망 시각에 맞춰 '가장 늦은 출발' 탐색)
- 범위: 양평군 내부 이동 (직행 / 1회 환승 / 2회 환승)
- 외부 API 호출 없음 (한도 소모 없음)

주의: 노선 거리·좌표로 구간 소요시간을 보간하므로 분 단위 정밀도는 추정치다.
"""
import math
import re
import threading
import time
from datetime import datetime

from models import db, BusStopMap, TransitStopGeo
from services import yangpyeong_bus as yb

WALK_KMH = 4.5          # 도보 속도
BUS_KMH = 24.0          # 시내버스 평균 속도 (정차 포함 보정)
DWELL_MIN = 0.35        # 정류장 정차 시간
ROAD_FACTOR = 1.3       # 직선거리 → 도로거리
MAX_WALK_KM = 1.5       # 출발/도착 정류장 탐색 반경
TRANSFER_WALK_KM = 0.4  # 환승 도보 허용 거리
BOARD_BUFFER_MIN = 10  # 정류장 도착 후 권장 여유(분)
MIN_TRANSFER_MIN = 2    # 최소 환승 여유
CACHE_SEC = 3600

# 양평군 대략 경계
YP_BOUNDS = (37.35, 37.70, 127.27, 127.85)

_lock = threading.Lock()
_cache = {'at': 0.0, 'graph': None}
_plan_mem = {}
_PLAN_TTL = 300
_PLAN_MAX = 150


def stop_key(s):
    """정류장 이름 정규화 — 역/터미널 등은 유지 (서로 다른 장소 보존)"""
    s = (s or '').strip()
    s = re.sub(r'\([^)]*\)', '', s)
    s = re.sub(r'\[[^\]]*\]', '', s)
    s = re.sub(r'\s+', '', s)
    s = s.replace('정류장', '').replace('정류소', '')
    s = re.sub(r'(행|방면)$', '', s)
    return s


def match_key(s):
    """느슨한 매칭용 키 (같은 장소의 다른 표기 흡수)"""
    s = stop_key(s)
    s = re.sub(r'(입구|앞|건너|정문|후문|사거리|삼거리|교차로|터미널|역)$', '', s)
    return s or stop_key(s)


def haversine_km(lat1, lng1, lat2, lng2):
    try:
        r = 6371.0
        p1, p2 = math.radians(float(lat1)), math.radians(float(lat2))
        dp = p2 - p1
        dl = math.radians(float(lng2) - float(lng1))
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * r * math.asin(math.sqrt(a))
    except Exception:
        return 0.0


def in_yangpyeong(lat, lng):
    try:
        la, lo = float(lat), float(lng)
    except Exception:
        return False
    return YP_BOUNDS[0] <= la <= YP_BOUNDS[1] and YP_BOUNDS[2] <= lo <= YP_BOUNDS[3]


def _times(s):
    out = []
    for x in (s or '').split(','):
        m = re.match(r'^(\d{1,2}):(\d{2})$', x.strip())
        if m:
            h, mi = int(m.group(1)), int(m.group(2))
            if 0 <= h < 24 and 0 <= mi < 60:
                out.append(h * 60 + mi)
    return sorted(out)


# ------------------------------------------------------------------ 그래프 구축
CELL = 0.012  # 환승 도보 탐색 격자 (~1.2km)


def _odcloud_departures():
    """시간표(odcloud) 출발시각을 노선번호+기점/종점 기준으로 인덱싱"""
    idx = {}
    for row in yb.fetch_routes():
        deps = _times(row.get('기점 출발시간'))
        if not deps:
            continue
        no = (row.get('노선번호') or '').strip('[] ')
        idx.setdefault(no, []).append({
            'origin': stop_key(row.get('기점')),
            'dest': stop_key(row.get('종점')),
            'deps': deps,
        })
    return idx


def _find_deps(od_idx, no, origin_key, dest_key):
    for x in od_idx.get(no, []):
        if x['origin'] == origin_key and x['dest'] == dest_key:
            return x['deps']
    for x in od_idx.get(no, []):
        if x['origin'] == origin_key:
            return x['deps']
    return []


def _headway(route_type, peak):
    try:
        if peak and int(peak) > 0:
            return max(5, min(120, int(peak)))
    except Exception:
        pass
    t = route_type or ''
    if '광역' in t or '직행' in t:
        return 20
    if '마을' in t:
        return 60
    if '좌석' in t:
        return 25
    return 30


def _synthetic_deps(first, last, headway):
    f = _times(first or '')
    l = _times(last or '')
    start = max(0, min(1439, f[0] if f else 6 * 60))
    end = max(0, min(1439, l[0] if l else 22 * 60))
    if end <= start:
        end = min(1439, start + 12 * 60)
    out = []
    t = start
    while t <= end:
        out.append(t)
        t += headway
    return out


def _split_directions(stops, end_key):
    """GBIS 노선 순번을 상·하행으로 분리 (회차점 기준)"""
    if len(stops) < 2:
        return []
    # 종점이 처음 나타나는 위치 = 회차점
    split = None
    for i in range(1, len(stops)):
        if stop_key(stops[i]['name']) == end_key:
            split = i
            break
    if split is None:
        # 종점명이 없으면 시작점에서 가장 먼 지점을 회차점으로
        la, oa = stops[0]['lat'], stops[0]['lng']
        far, fi = -1, len(stops) - 1
        for i in range(1, len(stops)):
            d = haversine_km(la, oa, stops[i]['lat'], stops[i]['lng'])
            if d > far:
                far, fi = d, i
        split = fi
    out = [stops[:split + 1]]
    if split < len(stops) - 1:
        out.append(stops[split:])
    return [x for x in out if len(x) >= 2]


def _build_from_gbis():
    from models import GbisRoute, GbisRouteStop
    route_rows = GbisRoute.query.all()
    if not route_rows:
        return None
    stop_rows = GbisRouteStop.query.all()
    by_route = {}
    for s in stop_rows:
        by_route.setdefault(s.route_id, []).append(s)

    od_idx = _odcloud_departures()
    stops = {}
    routes = []
    by_stop = {}

    for rt in route_rows:
        rows = by_route.get(rt.route_id) or []
        if len(rows) < 2:
            continue
        rows.sort(key=lambda x: x.seq)
        # 좌표 없는 정류장 제외
        seq_stops = [{
            'name': r.name, 'lat': r.lat, 'lng': r.lng,
            'key': stop_key(r.name),
        } for r in rows if r.lat and r.lng and stop_key(r.name)]
        if len(seq_stops) < 2:
            continue

        end_key = stop_key(rt.end_name) or stop_key(seq_stops[-1]['name'])
        dirs = _split_directions(seq_stops, end_key)
        headway = _headway(rt.route_type, rt.peak_alloc)

        for di, seq in enumerate(dirs):
            keys = []
            for x in seq:
                k = x['key']
                if keys and keys[-1] == k:
                    continue
                keys.append(k)
                if k not in stops:
                    stops[k] = {'name': x['name'], 'lat': x['lat'], 'lng': x['lng']}
            if len(keys) < 2:
                continue

            origin_name = seq[0]['name']
            dest_name = seq[-1]['name']
            deps = _find_deps(od_idx, rt.route_name, stop_key(origin_name), stop_key(dest_name))
            if not deps:
                payload = None
                try:
                    from services import gbis_route as _gr
                    payload = _gr.route_info(rt.route_id) or {}
                except Exception:
                    payload = {}
                if di == 0:
                    deps = _synthetic_deps(rt.first_time or payload.get('up_first'),
                                           rt.last_time or payload.get('up_last'), headway)
                else:
                    deps = _synthetic_deps(payload.get('down_first') or rt.first_time,
                                           payload.get('down_last') or rt.last_time, headway)
            if not deps:
                continue

            seg_km = []
            for i in range(len(keys) - 1):
                a, b = stops[keys[i]], stops[keys[i + 1]]
                seg_km.append(haversine_km(a['lat'], a['lng'], b['lat'], b['lng']) * 1.05)
            cum = [0]
            for km in seg_km:
                speed = 44.0 if km >= 3.0 else BUS_KMH
                cum.append(cum[-1] + max(1, int(round(km / speed * 60 + DWELL_MIN))))

            pos = {}
            for i, k in enumerate(keys):
                pos.setdefault(k, []).append(i)

            ri = len(routes)
            routes.append({
                'no': rt.route_name or '-',
                'keys': keys,
                'pos': pos,
                'cum': cum,
                'deps': deps,
                'km': round(sum(seg_km), 1),
                'origin': origin_name,
                'dest': dest_name,
                'source': 'gbis',
            })
            for k in set(keys):
                by_stop.setdefault(k, []).append(ri)

    if not routes:
        return None
    # 정류장명 → GBIS 정류소 ID (실시간 도착 조회용)
    ids = {}
    try:
        from collections import Counter
        cnt = {}
        for s in stop_rows:
            k = stop_key(s.name)
            if not k or not s.station_id:
                continue
            cnt.setdefault(k, Counter())[s.station_id] += 1
        ids = {k: [sid for sid, _n in c.most_common(3)] for k, c in cnt.items()}
    except Exception:
        ids = {}
    return {'stops': stops, 'routes': routes, 'by_stop': by_stop, 'station_ids': ids,
            'source': 'gbis'}


def _build_from_odcloud():
    coords = {}
    for r in TransitStopGeo.query.all():
        if r.lat and r.lng:
            coords[r.name_key] = (r.lat, r.lng, r.name)
    for s in BusStopMap.query.all():
        if not (s.lat and s.lng):
            continue
        k = stop_key(s.name)
        if k and k not in coords:
            coords[k] = (s.lat, s.lng, s.name)

    stops = {}
    routes = []
    by_stop = {}

    for row in yb.fetch_routes():
        names = [row.get('기점')]
        names += [x.strip() for x in (row.get('경유지') or '').split(',') if x.strip()]
        names.append(row.get('종점'))
        names = [n.strip() for n in names if (n or '').strip()]
        keys = []
        for n in names:
            k = stop_key(n)
            if not k:
                continue
            if keys and keys[-1] == k:
                continue
            keys.append(k)
            if k not in stops:
                c = coords.get(k)
                stops[k] = {'name': n, 'lat': c[0] if c else None,
                            'lng': c[1] if c else None}
        if len(keys) < 2:
            continue
        deps = _times(row.get('기점 출발시간'))
        if not deps:
            continue
        try:
            total_km = float(row.get('거리(킬로미터)') or 0)
        except Exception:
            total_km = 0.0
        seg_km = []
        for i in range(len(keys) - 1):
            a, b = stops[keys[i]], stops[keys[i + 1]]
            if a['lat'] is not None and b['lat'] is not None:
                seg_km.append(haversine_km(a['lat'], a['lng'], b['lat'], b['lng']) * ROAD_FACTOR)
            else:
                seg_km.append(None)
        known = [x for x in seg_km if x is not None and x > 0]
        fallback = (total_km / (len(keys) - 1)) if total_km else (
            sum(known) / len(known) if known else 1.0)
        seg_km = [x if (x is not None and x > 0) else fallback for x in seg_km]
        cum = [0]
        for km in seg_km:
            speed = 44.0 if km >= 3.0 else BUS_KMH
            cum.append(cum[-1] + max(1, int(round(km / speed * 60 + DWELL_MIN))))
        pos = {}
        for i, k in enumerate(keys):
            pos.setdefault(k, []).append(i)

        ri = len(routes)
        routes.append({
            'no': (row.get('노선번호') or '').strip('[] ') or '-',
            'keys': keys,
            'pos': pos,
            'cum': cum,
            'deps': deps,
            'km': round(sum(seg_km), 1),
            'origin': row.get('기점') or '',
            'dest': row.get('종점') or '',
            'source': 'odcloud',
        })
        for k in set(keys):
            by_stop.setdefault(k, []).append(ri)

    if not routes:
        return None
    return {'stops': stops, 'routes': routes, 'by_stop': by_stop, 'source': 'odcloud'}


def _merge_odcloud(graph):
    """GBIS 데이터가 일부만 있어도 양평 시간표(odcloud) 노선을 함께 사용해 커버리지 보장"""
    if not graph:
        return graph
    try:
        extra = _build_from_odcloud()
    except Exception:
        return graph
    if not extra:
        return graph
    seen = {(r['no'], r['keys'][0], r['keys'][-1]) for r in graph.get('routes', [])}
    for r in extra['routes']:
        sig = (r['no'], r['keys'][0], r['keys'][-1])
        if sig in seen:
            continue
        seen.add(sig)
        for k in r['keys']:
            if k not in graph['stops']:
                graph['stops'][k] = extra['stops'].get(k, {'name': k, 'lat': None, 'lng': None})
        ri = len(graph['routes'])
        graph['routes'].append(r)
        for k in set(r['keys']):
            graph['by_stop'].setdefault(k, []).append(ri)
    return graph


def _build_transfer_map(stops):
    """0.45km 이내 정류장 도보 환승 링크 (격자 기반)"""
    grid = {}
    for k, v in stops.items():
        if v['lat'] is None:
            continue
        cell = (int(v['lat'] / CELL), int(v['lng'] / CELL))
        grid.setdefault(cell, []).append(k)
    tmap = {}
    for (cx, cy), keys in grid.items():
        cand = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                cand.extend(grid.get((cx + dx, cy + dy), []))
        for ka in keys:
            a = stops[ka]
            near = []
            for kb in cand:
                if kb == ka:
                    continue
                b = stops[kb]
                d = haversine_km(a['lat'], a['lng'], b['lat'], b['lng'])
                if d <= TRANSFER_WALK_KM:
                    near.append((kb, min(8, _walk_min(d))))
            if near:
                near.sort(key=lambda x: x[1])
                tmap[ka] = near[:4]
    return tmap


def build_graph(force=False):
    now = time.time()
    if not force and _cache['graph'] and (now - _cache['at']) < CACHE_SEC:
        return _cache['graph']
    with _lock:
        if not force and _cache['graph'] and (time.time() - _cache['at']) < CACHE_SEC:
            return _cache['graph']

        graph = None
        try:
            graph = _build_from_gbis()
        except Exception:
            graph = None
        if not graph:
            graph = _build_from_odcloud() or {'stops': {}, 'routes': [], 'by_stop': {}, 'source': 'none'}
        else:
            graph = _merge_odcloud(graph)
        graph['tmap'] = _build_transfer_map(graph['stops'])

        _cache['graph'] = graph
        _cache['at'] = time.time()
        return graph


def stats():
    g = build_graph()
    from models import TransitStopGeo
    no_geo = TransitStopGeo.query.filter(TransitStopGeo.lat.is_(None)).count()
    return {'source': g.get('source', ''),
            'stops': len(g['stops']),
            'stops_with_coord': sum(1 for s in g['stops'].values() if s['lat'] is not None),
            'routes': len(g['routes']),
            'geo_total': TransitStopGeo.query.count(),
            'geo_missing': no_geo,
            'transfer_links': len(g.get('tmap', {}))}


# ------------------------------------------------------------------ 탐색 보조
def _near(graph, lat, lng, radius_km):
    out = []
    for k, s in graph['stops'].items():
        if s['lat'] is None:
            continue
        d = haversine_km(lat, lng, s['lat'], s['lng'])
        if d <= radius_km:
            out.append((d, k))
    out.sort(key=lambda x: x[0])
    return out[:25]


def _indices(route, key):
    pos = route.get('pos')
    if pos is not None:
        return pos.get(key, [])
    return [i for i, k in enumerate(route['keys']) if k == key]


def _walk_min(km):
    return max(1, int(round(km / WALK_KMH * 60)) + 1)


def _ride(cum, i, j):
    return max(1, cum[j] - cum[i])


# ------------------------------------------------------------------ 경로 스케줄링
def _schedule(graph, path, deadline, o_walk, d_walk, o_name, d_name):
    """구조 경로(path: [{ri, i, j, walk_before}])를 도착 희망시각에 맞춰 역산한다."""
    t = deadline - d_walk
    legs = []
    for leg in reversed(path):
        r = graph['routes'][leg['ri']]
        ride = _ride(r['cum'], leg['i'], leg['j'])
        board = [d + r['cum'][leg['i']] for d in r['deps']]
        cands = [b for b in board if b + ride <= t]
        if not cands:
            return None
        dep = max(cands)
        legs.append({**leg, 'route': r, 'dep': dep, 'ride': ride, 'arr': dep + ride,
                     'from_key': r['keys'][leg['i']], 'to_key': r['keys'][leg['j']]})
        t = dep - int(leg.get('walk_before') or 0) - MIN_TRANSFER_MIN
    legs.reverse()
    # 출발지에서 정류장까지 도보 + 권장 여유(10분)를 확보한 시각에 집을 나선다
    departure = legs[0]['dep'] - o_walk - BOARD_BUFFER_MIN
    if departure < 0:
        departure = legs[0]['dep'] - o_walk
    if departure < 0:
        return None
    arrival = legs[-1]['arr'] + d_walk
    total = arrival - departure
    if total <= 0 or total > 12 * 60:
        return None

    steps = []
    if o_walk >= 1 and legs[0]['from_key'] != stop_key(o_name):
        steps.append({'mode': '🚶 도보', 'from': o_name,
                      'to': graph['stops'][legs[0]['from_key']]['name'],
                      'detail': f"정류장까지 도보 {o_walk}분", 'time_min': o_walk})
    prev_arr = None
    prev_to = None
    for leg in legs:
        r = leg['route']
        stop_from = graph['stops'][leg['from_key']]['name']
        stop_to = graph['stops'][leg['to_key']]['name']
        if prev_arr is not None:
            if leg.get('walk_before') and prev_to != leg['from_key']:
                steps.append({'mode': '🚶 도보', 'from': graph['stops'][prev_to]['name'] if prev_to else stop_from,
                              'to': stop_from,
                              'detail': f"환승 도보 {int(leg['walk_before'])}분",
                              'time_min': int(leg['walk_before'])})
            wait = leg['dep'] - prev_arr - int(leg.get('walk_before') or 0)
            if wait >= 1:
                steps.append({'mode': '🚏 대기', 'from': stop_from, 'to': stop_from,
                              'detail': f'환승 대기 약 {wait}분', 'time_min': wait,
                              'departure': _hm(prev_arr), 'arrival': _hm(leg['dep'])})
        cnt = max(0, leg['j'] - leg['i'])
        steps.append({'mode': '🚌 버스', 'from': stop_from, 'to': stop_to,
                      'detail': f"{r['no']}번 ({cnt}정거장, 약 {leg['ride']}분)",
                      'time_min': leg['ride'], 'bus_no': f"{r['no']}번",
                      'departure': _hm(leg['dep']), 'arrival': _hm(leg['arr'])})
        prev_arr = leg['arr']
        prev_to = leg['to_key']
    if d_walk >= 1 and legs[-1]['to_key'] != stop_key(d_name):
        steps.append({'mode': '🚶 도보', 'from': graph['stops'][legs[-1]['to_key']]['name'],
                      'to': d_name, 'detail': f"도착지까지 도보 {d_walk}분",
                      'time_min': d_walk})

    transfers = len(legs) - 1
    walk_total = o_walk + d_walk + sum(int(l.get('walk_before') or 0) for l in legs[1:])
    dist_km = 0.0
    for leg in legs:
        r = leg['route']
        for i in range(leg['i'], leg['j']):
            a, b = graph['stops'][r['keys'][i]], graph['stops'][r['keys'][i + 1]]
            if a['lat'] is not None and b['lat'] is not None:
                dist_km += haversine_km(a['lat'], a['lng'], b['lat'], b['lng']) * ROAD_FACTOR
            else:
                dist_km += r['km'] / max(1, len(r['keys']) - 1)
    dist_km += (o_walk + d_walk) / 60.0 * WALK_KMH

    return {
        'steps': steps,
        'total_min': total,
        'departure': _hm(departure),
        'arrival': _hm(arrival),
        'distance_km': round(dist_km, 1),
        'source': 'yp_graph',
        # 실제 정류장·노선으로 계산한 경로 → '추정' 아님 (출발시각만 배차 보간)
        'estimated': False,
        'time_source': 'timetable',
        'transfers': transfers,
        'walk_min': walk_total,
        'note': '양평 버스 시간표 기반 자체 계산',
        'signature': '>'.join(f"{l['route']['no']}:{l['from_key']}>{l['to_key']}" for l in legs),
    }


def _hm(m):
    m = int(m) % (24 * 60)
    return f'{m // 60:02d}:{m % 60:02d}'


# ------------------------------------------------------------------ 공개 API
def plan_options(from_lat, from_lng, to_lat, to_lng, arrival_min, limit=4,
                 from_name='출발지', to_name='도착지', _retry=False):
    """양평 버스 시간표 기반 후보 경로 목록 (늦은 출발 순)."""
    ck = (round(float(from_lat), 3), round(float(from_lng), 3),
          round(float(to_lat), 3), round(float(to_lng), 3),
          int(arrival_min) // 5, int(limit), bool(_retry), from_name, to_name)
    hit = _plan_mem.get(ck)
    if hit and hit[0] + _PLAN_TTL > time.time():
        return [dict(x) for x in hit[1]]

    graph = build_graph()
    if not graph['routes']:
        return []

    o_near = _near(graph, from_lat, from_lng, MAX_WALK_KM)
    d_near = _near(graph, to_lat, to_lng, MAX_WALK_KM)
    if not o_near or not d_near:
        return []
    d_map = {k: km for km, k in d_near}

    deadline = int(arrival_min)
    results = []
    seen_sig = set()

    attempts = [0]

    def add(path, o_walk, d_walk):
        if attempts[0] >= _PLAN_MAX:
            return
        attempts[0] += 1
        plan = _schedule(graph, path, deadline, _walk_min(o_walk), _walk_min(d_walk),
                         from_name, to_name)
        if not plan:
            return
        sig = tuple((s.get('mode'), s.get('from'), s.get('to'), s.get('time_min'))
                    for s in plan['steps'])
        if sig in seen_sig:
            return
        seen_sig.add(sig)
        results.append(plan)

    # 0회 환승
    for o_km, ok in o_near:
        for ri in graph['by_stop'].get(ok, []):
            r = graph['routes'][ri]
            for i in _indices(r, ok):
                for j in range(i + 1, len(r['keys'])):
                    dk = r['keys'][j]
                    if dk in d_map:
                        add([{'ri': ri, 'i': i, 'j': j}], o_km, d_map[dk])

    # 1회 환승
    if len(results) < limit:
        for o_km, ok in o_near:
            for ri in graph['by_stop'].get(ok, []):
                r1 = graph['routes'][ri]
                for i in _indices(r1, ok):
                    for j in range(i + 1, len(r1['keys']) - 1):
                        x = r1['keys'][j]
                        if x in d_map:
                            continue
                        boards = [(x, 0)] + graph.get('tmap', {}).get(x, [])
                        for xb, xwalk in boards:
                            for rj in graph['by_stop'].get(xb, []):
                                if rj == ri:
                                    continue
                                r2 = graph['routes'][rj]
                                for k in _indices(r2, xb):
                                    for l in range(k + 1, len(r2['keys'])):
                                        dk = r2['keys'][l]
                                        if dk in d_map:
                                            add([{'ri': ri, 'i': i, 'j': j},
                                                 {'ri': rj, 'i': k, 'j': l, 'walk_before': xwalk}],
                                                o_km, d_map[dk])

    # 2회 환승 (후보가 부족할 때만, 환승 거점 정류장으로 제한)
    if len(results) < limit:
        expansions = 0
        for o_km, ok in o_near:
            for ri in graph['by_stop'].get(ok, []):
                r1 = graph['routes'][ri]
                for i in _indices(r1, ok):
                    for j in range(i + 1, len(r1['keys']) - 1):
                        x = r1['keys'][j]
                        if x in d_map or len(graph['by_stop'].get(x, [])) < 2:
                            continue
                        for rj in graph['by_stop'].get(x, []):
                            if rj == ri:
                                continue
                            r2 = graph['routes'][rj]
                            for k in _indices(r2, x):
                                for m in range(k + 1, len(r2['keys']) - 1):
                                    y = r2['keys'][m]
                                    if y in d_map or len(graph['by_stop'].get(y, [])) < 2:
                                        continue
                                    for rk in graph['by_stop'].get(y, []):
                                        if rk in (ri, rj):
                                            continue
                                        r3 = graph['routes'][rk]
                                        for n in _indices(r3, y):
                                            for p in range(n + 1, len(r3['keys'])):
                                                dk = r3['keys'][p]
                                                if dk in d_map:
                                                    add([{'ri': ri, 'i': i, 'j': j},
                                                         {'ri': rj, 'i': k, 'j': m, 'walk_before': 0},
                                                         {'ri': rk, 'i': n, 'j': p, 'walk_before': 0}],
                                                        o_km, d_map[dk])
                                                expansions += 1
                                    if expansions > 40000:
                                        break
                            if expansions > 40000:
                                break
                        if expansions > 40000:
                            break
                    if expansions > 40000:
                        break

    # 같은 노선 구성이 반복되면 하나만 (2000-1 ×3 같은 중복 제거)
    seen_sig = set()
    uniq = []
    for p in sorted(results, key=lambda x: (x['total_min'], x['transfers'], x['walk_min'])):
        rides = [st for st in p['steps']
                 if any(k in (st.get('mode') or '') for k in ('버스', '지하철', '전철', '기차', '열차'))]
        sig = tuple(str(st.get('bus_no') or st.get('subway_name') or '').replace('번', '').strip()
                    for st in rides)
        if sig in seen_sig:
            continue
        seen_sig.add(sig)
        uniq.append(p)
    results = uniq

    # 실시간 도착(ETA): 탑승 정류소의 노선별 남은 시간
    try:
        from services import gbis_arrival as ga
        sid_map = graph.get('station_ids', {})
        for p in results:
            for st in p['steps']:
                if '버스' not in (st.get('mode') or ''):
                    continue
                sids = sid_map.get(stop_key(st.get('from') or '')) or []
                if isinstance(sids, str):
                    sids = [sids]
                if not sids:
                    continue
                no = str(st.get('bus_no') or '').replace('번', '').strip()
                merged = []
                found_sid = None
                for sid in sids:
                    rows = ga.arrivals(sid)
                    if not rows:
                        continue
                    if no:
                        for a in rows:
                            if str(a['route']).replace('번', '').strip() == no:
                                st['eta_min'] = a['min1']
                                found_sid = sid
                                break
                    for a in rows:
                        if any(x['route'] == a['route'] for x in merged):
                            continue
                        merged.append({'route': a['route'], 'min': a.get('min1'),
                                       'dest': a.get('dest') or ''})
                    if st.get('eta_min') is not None and merged:
                        break
                if st.get('eta_min') is not None:
                    st['station_id'] = found_sid or sids[0]
                if merged:
                    merged.sort(key=lambda x: (x['min'] if x['min'] is not None else 9999))
                    st['board_alts'] = merged[:8]
    except Exception:
        pass

    results.sort(key=lambda p: (p['total_min'], p['transfers'], p['walk_min']))
    out = results[:limit]
    try:
        _plan_mem[ck] = (time.time(), out)
        if len(_plan_mem) > 500:
            for k in list(_plan_mem)[:200]:
                _plan_mem.pop(k, None)
    except Exception:
        pass
    if not out and not _retry:
        # 희망 시각 내 도착편이 없으면 3시간 뒤 기준으로 가장 이른 편을 안내
        late = plan_options(from_lat, from_lng, to_lat, to_lng, int(arrival_min) + 180,
                            limit=limit, from_name=from_name, to_name=to_name, _retry=True)
        for p in late:
            try:
                hh, mm = p['arrival'].split(':')
                p['late_min'] = max(0, int(hh) * 60 + int(mm) - int(arrival_min))
            except Exception:
                p['late_min'] = 0
        return late
    return out


def plan(from_lat, from_lng, to_lat, to_lng, arrival_min, from_name='출발지', to_name='도착지'):
    """가장 좋은 후보 1건"""
    opts = plan_options(from_lat, from_lng, to_lat, to_lng, arrival_min,
                        limit=1, from_name=from_name, to_name=to_name)
    return opts[0] if opts else None
