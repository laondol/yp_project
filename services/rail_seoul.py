"""양평 ↔ 서울 대중교통 조합 (경의중앙선 + 서울 시내 대중교통)

ODsay 한도 소진/장애 시에도 '대중교통' 후보를 만들기 위한 자체 조합이다.
- 접근: 출발지 → 가까운 경의중앙선 역 (도보)
- 간선: 경의중앙선/일반열차 (TAGO 시간표)
- 시내: 서울시 대중교통 환승경로 API (seoul_transit)
"""
import time

from services import seoul_transit as st
from services import tago_train
from services.directions import STATIONS, find_nearest_station, haversine_km

HUBS = [
    ('청량리', 37.5800, 127.0470),
    ('서울', 37.5547, 126.9707),
    ('용산', 37.5290, 126.9650),
]

MAX_ACCESS_KM = 8.0     # 출발/도착지에서 역까지 허용 거리
WAIT_MIN = 10
TRANSFER_MIN = 3

# 경의중앙선 양평 인접역 (자체 조합용) — 서울 방면 접근성 확대
RAIL_STATIONS = list(STATIONS) + [
    {'name': '운길산역', 'lat': 37.5547, 'lng': 127.3103},
    {'name': '양수역', 'lat': 37.5475, 'lng': 127.3277},
    {'name': '신원역', 'lat': 37.5612, 'lng': 127.3537},
    {'name': '국수역', 'lat': 37.5773, 'lng': 127.3990},
    {'name': '팔당역', 'lat': 37.5779, 'lng': 127.2445},
    {'name': '도심역', 'lat': 37.5797, 'lng': 127.2775},
    {'name': '덕소역', 'lat': 37.5868, 'lng': 127.2085},
    {'name': '구리역', 'lat': 37.6034, 'lng': 127.1437},
]
STATION_NAMES = [s['name'] for s in RAIL_STATIONS]


def _nearest_station(lat, lng):
    best = None
    best_d = float('inf')
    for s in RAIL_STATIONS:
        d = haversine_km(lat, lng, s['lat'], s['lng'])
        if d < best_d:
            best_d = d
            best = s
    return best, best_d


def _near_stations(lat, lng, limit=3):
    rows = []
    for s in RAIL_STATIONS:
        rows.append((haversine_km(lat, lng, s['lat'], s['lng']), s))
    rows.sort(key=lambda x: x[0])
    return [(s, d) for d, s in rows[:limit]]


def _bus_access(from_name, from_lat, from_lng, station, deadline, max_walk_min):
    """양평 버스 그래프로 역까지 가는 대안 (걸어가는 것보다 빠를 때만)"""
    try:
        from services import transit_graph as tg
        if not (tg.in_yangpyeong(from_lat, from_lng)
                and tg.in_yangpyeong(station['lat'], station['lng'])):
            return None
        plans = tg.plan_options(from_lat, from_lng, station['lat'], station['lng'],
                                int(deadline), limit=2,
                                from_name=from_name, to_name=station['name'])
        for p in plans:
            if int(p.get('total_min') or 0) + 2 < max_walk_min:
                steps = []
                for x in p.get('steps') or []:
                    y = dict(x)
                    y.pop('departure', None)
                    y.pop('arrival', None)
                    steps.append(y)
                return {'steps': steps, 'min': int(p['total_min'])}
    except Exception:
        pass
    return None

_MEM = {}
_TTL = 300
_SEOUL_MEM = {}
_SEOUL_TTL = 600


def _prefetch_seoul(targets):
    """서울 구간 API 병렬 조회 후 캐시에 채움"""
    from concurrent.futures import ThreadPoolExecutor
    todo = []
    for (a, b, c, d, am) in targets:
        ck = (round(float(a), 3), round(float(b), 3),
              round(float(c), 3), round(float(d), 3), int(am) // 15)
        hit = _SEOUL_MEM.get(ck)
        if hit and hit[0] + _SEOUL_TTL > time.time():
            continue
        todo.append((ck, (a, b, c, d, am)))
    if not todo:
        return

    def work(item):
        ck, args = item
        try:
            return ck, st.plan(*args)
        except Exception:
            return ck, None

    with ThreadPoolExecutor(max_workers=min(6, len(todo))) as ex:
        for ck, val in ex.map(work, todo):
            _SEOUL_MEM[ck] = (time.time(), val)


def _seoul_plan(lat1, lng1, lat2, lng2, arrival_min):
    ck = (round(float(lat1), 3), round(float(lng1), 3),
          round(float(lat2), 3), round(float(lng2), 3), int(arrival_min) // 15)
    hit = _SEOUL_MEM.get(ck)
    if hit and hit[0] + _SEOUL_TTL > time.time():
        return hit[1]
    p = st.plan(lat1, lng1, lat2, lng2, arrival_min)
    _SEOUL_MEM[ck] = (time.time(), p)
    return p


def _walk_min(km):
    return max(1, int(round(km / 4.5 * 60)) + 1)


def _hm(m):
    m = int(m) % 1440
    return f'{m // 60:02d}:{m % 60:02d}'


def _hm_min(t):
    try:
        h, mi = str(t).split(':')[:2]
        return int(h) * 60 + int(mi)
    except Exception:
        return None


def _line_name(train, station):
    if station in STATION_NAMES:
        return '경의중앙선'
    return train.get('grade') or '전철'


def _search_trains(a, b, date):
    """TAGO 역명 표기 차이 보정 (양평역 → 양평)"""
    for x in (a, a.replace('역', '')):
        for y in (b, b.replace('역', '')):
            rows = tago_train.search_trains(x, y, date, limit=20)
            if rows:
                return rows
    return []


def _synthetic_rail(station, hub, deadline):
    """경의중앙선 시간표가 없을 때 거리 기반으로 편성 (20~25분 간격)"""
    d = haversine_km(station['lat'], station['lng'],
                     dict((h[0], (h[1], h[2])) for h in HUBS)[hub][0],
                     dict((h[0], (h[1], h[2])) for h in HUBS)[hub][1])
    mins = max(8, int(round(d / 55 * 60)) + 3)
    out = []
    t = 5 * 60 + 20
    while t <= 23 * 60:
        if t + mins <= deadline:
            out.append({'grade': '경의중앙선', 'departure': _hm(t),
                        'arrival': _hm(t + mins), 'minutes': mins})
        t += 25
    return out


def _pick_train(trains, deadline):
    ok = []
    for t in trains:
        am = _hm_min(t.get('arrival'))
        if am is not None and am <= deadline:
            ok.append((am, t))
    return max(ok, key=lambda x: x[0])[1] if ok else None


def _bus_to_seoul(from_name, from_lat, from_lng, to_name, to_lat, to_lng, arrival_min, date):
    """양평 → 서울: 버스(예: 2000-1)로 서울 외곽까지 간 뒤 서울 대중교통"""
    try:
        from services import transit_graph as tg
        g = tg.build_graph()
    except Exception:
        return None
    cands = []
    for k, v in g['stops'].items():
        if not (v['lat'] and v['lng']):
            continue
        if not st.in_seoul(v['lat'], v['lng']):
            continue
        d = haversine_km(v['lat'], v['lng'], to_lat, to_lng)
        cands.append((d, k, v))
    cands.sort(key=lambda x: x[0])
    # 목적지 근처에 서울 버스 정류장이 없으면 광역버스 조합은 의미 없음
    if not cands or cands[0][0] > 3.0:
        return None

    # 출발지 근처 정류장에서 실제로 닿을 수 있는(직행) 정류장만 후보로
    o_near = []
    for k, v in g['stops'].items():
        if v['lat'] is None:
            continue
        d = haversine_km(from_lat, from_lng, v['lat'], v['lng'])
        if d <= 1.5:
            o_near.append(k)
    reachable = []
    for dist, k, v in cands[:5]:
        if dist > 3.0:
            break
        if dist <= 0.5:
            reachable.append((dist, k, v))
            continue
        ok = False
        for ri in g['by_stop'].get(k, []):
            r = g['routes'][ri]
            hub_pos = (r.get('pos') or {}).get(k, [])
            if not hub_pos:
                continue
            for ok_key in o_near:
                for i in (r.get('pos') or {}).get(ok_key, []):
                    for j in hub_pos:
                        if j <= i:
                            continue
                        ride = r['cum'][j] - r['cum'][i]
                        if not r['deps']:
                            continue
                        if min(r['deps']) + r['cum'][i] + ride <= arrival_min - TRANSFER_MIN:
                            ok = True
                            break
                    if ok:
                        break
                if ok:
                    break
            if ok:
                break
        if ok:
            reachable.append((dist, k, v))
    if not reachable:
        return None

    results = []
    for dist, k, v in reachable[:4]:
        if dist <= 0.5:
            wmin = _walk_min(dist)
            part = {'steps': [{'mode': '🚶 도보', 'from': v['name'], 'to': to_name,
                               'detail': f"도착지까지 {int(round(dist * 1000))}m",
                               'time_min': wmin,
                               'from_lat': v['lat'], 'from_lng': v['lng'],
                               'to_lat': to_lat, 'to_lng': to_lng}],
                    'total_min': wmin, 'distance_km': dist}
        else:
            part = _seoul_plan(v['lat'], v['lng'], to_lat, to_lng, arrival_min)
        if not part:
            continue
        deadline = arrival_min - int(part['total_min']) - TRANSFER_MIN
        plans = tg.plan_options(from_lat, from_lng, v['lat'], v['lng'], deadline, limit=1,
                                from_name=from_name, to_name=v['name'])
        if not plans:
            continue
        gp = plans[0]
        steps = list(gp.get('steps') or [])
        part_steps = list(part.get('steps') or [])
        if part_steps:
            if any(('지하철' in (x.get('mode') or '') or '버스' in (x.get('mode') or '')) for x in part_steps):
                steps.append({'mode': '🚏 대기', 'from': v['name'], 'to': v['name'],
                              'detail': '환승 대기', 'time_min': TRANSFER_MIN})
            steps += part_steps
        total = sum(int(x.get('time_min') or 0) for x in steps)
        dep = _hm_min(gp.get('departure'))
        if dep is None:
            continue
        try:
            dist_total = float(gp.get('distance_km') or 0) + float(part.get('distance_km') or 0)
        except Exception:
            dist_total = 0
        results.append({
            'steps': steps,
            'total_min': int(total),
            'departure': _hm(dep),
            'arrival': _hm(dep + total),
            'distance_km': round(dist_total, 1),
            'source': 'bus_seoul',
            'estimated': False,
            'note': f"광역버스 + 서울 대중교통 ({v['name']})",
        })

    # 같은 버스 구성 중복 제거
    seen = set()
    out = []
    for p in sorted(results, key=lambda x: int(x['total_min'])):
        # 같은 버스 노선 조합은 하나만 (정류장만 다른 중복 제거)
        buses = tuple(sorted({str(x.get('bus_no') or '').replace('번', '').strip()
                              for x in p['steps'] if '버스' in (x.get('mode') or '')}))
        if not buses or buses in seen:
            continue
        seen.add(buses)
        out.append(p)
    return out[:4]


def plan_all(from_name, from_lat, from_lng, to_name, to_lat, to_lng, arrival_min, date=None):
    """양평↔서울 후보 전체 (경의중앙선 조합 + 광역버스 조합), 빠른 순"""
    if arrival_min is None:
        return []
    from_in_seoul = st.in_seoul(from_lat, from_lng)
    to_in_seoul = st.in_seoul(to_lat, to_lng)
    if from_in_seoul == to_in_seoul:
        return []

    ck = (round(float(from_lat), 3), round(float(from_lng), 3),
          round(float(to_lat), 3), round(float(to_lng), 3), int(arrival_min) // 15)
    hit = _MEM.get(ck)
    if hit and hit[0] + _TTL > time.time():
        return hit[1]

    o_st, o_dist = _nearest_station(from_lat, from_lng)
    d_st, d_dist = _nearest_station(to_lat, to_lng)

    targets = []
    if not from_in_seoul and to_in_seoul:
        for _hub, hlat, hlng in HUBS:
            targets.append((hlat, hlng, to_lat, to_lng, arrival_min))
        try:
            from services import transit_graph as tg
            g = tg.build_graph()
            cands = []
            for k, v in g['stops'].items():
                if not (v['lat'] and v['lng']) or not st.in_seoul(v['lat'], v['lng']):
                    continue
                cands.append((haversine_km(v['lat'], v['lng'], to_lat, to_lng), k, v))
            cands.sort(key=lambda x: x[0])
            for dist, k, v in cands[:3]:
                if 0.5 < dist <= 3.0:
                    targets.append((v['lat'], v['lng'], to_lat, to_lng, arrival_min))
        except Exception:
            pass
    elif from_in_seoul and not to_in_seoul:
        for _hub, hlat, hlng in HUBS:
            targets.append((from_lat, from_lng, hlat, hlng, arrival_min))
    try:
        _prefetch_seoul(targets)
    except Exception:
        pass

    plans = []
    if not from_in_seoul and to_in_seoul and o_st and o_dist <= MAX_ACCESS_KM:
        p = _outbound(from_name, from_lat, from_lng, o_st, o_dist,
                      to_lat, to_lng, arrival_min, date)
        if p:
            plans.append(p)
    elif from_in_seoul and not to_in_seoul and d_st and d_dist <= MAX_ACCESS_KM:
        p = _inbound(from_name, from_lat, from_lng, to_name, to_lat, to_lng,
                     d_st, d_dist, arrival_min, date)
        if p:
            plans.append(p)

    if not from_in_seoul and to_in_seoul:
        try:
            alts = _bus_to_seoul(from_name, from_lat, from_lng, to_name, to_lat, to_lng, arrival_min, date)
        except Exception:
            alts = []
        for alt in (alts or []):
            plans.append(alt)

    seen = set()
    uniq = []
    for p in plans:
        rides = tuple((str(x.get('bus_no') or '').replace('번', '').strip()
                       or str(x.get('subway_name') or '').strip())
                      for x in p['steps']
                      if any(k in (x.get('mode') or '') for k in ('버스', '지하철', '전철', '기차', '열차')))
        sig = (p.get('source'), rides)
        if sig in seen:
            continue
        seen.add(sig)
        uniq.append(p)
    uniq.sort(key=lambda x: int(x.get('total_min') or 0))
    _MEM[ck] = (time.time(), uniq)
    return uniq


def plan(from_name, from_lat, from_lng, to_name, to_lat, to_lng, arrival_min, date=None):
    plans = plan_all(from_name, from_lat, from_lng, to_name, to_lat, to_lng, arrival_min, date)
    return plans[0] if plans else None


def _outbound(from_name, from_lat, from_lng, station, dist_station,
              to_lat, to_lng, arrival_min, date):
    """양평 → 서울 (경의중앙선/열차 + 서울 대중교통)"""
    hub_parts = []
    for hub, hlat, hlng in HUBS:
        part = _seoul_plan(hlat, hlng, to_lat, to_lng, arrival_min)
        if part:
            hub_parts.append((hub, part))
    if not hub_parts:
        return None

    best = None
    for station, dist_station in _near_stations(from_lat, from_lng):
        if dist_station > MAX_ACCESS_KM:
            continue
        walk = _walk_min(dist_station)
        for hub, part in hub_parts:
            deadline = arrival_min - int(part['total_min']) - TRANSFER_MIN
            # KTX가 서는 양평역만 실시간 시간표 조회
            if station['name'] == '양평역':
                trains = _search_trains(station['name'], hub, date)
            else:
                trains = []
            if not trains:
                trains = _synthetic_rail(station, hub, deadline)
            if not trains:
                continue
            train = _pick_train(trains, deadline)
            if not train:
                continue
            dep = _hm_min(train.get('departure'))
            if dep is None:
                continue
            total = walk + WAIT_MIN + int(train.get('minutes') or 0) + TRANSFER_MIN + int(part['total_min'])
            if best is None or total < best[0]:
                best = (total, hub, train, part, dep, walk, station, dist_station)

    if not best:
        return None
    total, hub, train, part, dep, walk, station, dist_station = best

    access = None
    if dist_station >= 0.6:
        access = _bus_access(from_name, from_lat, from_lng, station, dep, walk)

    if access:
        steps = list(access['steps'])
        total = int(access['min']) + WAIT_MIN + int(train.get('minutes') or 0) + TRANSFER_MIN + int(part['total_min'])
        departure = dep - int(access['min']) - WAIT_MIN
    else:
        steps = []
        if dist_station >= 0.3:
            steps.append({'mode': '🚶 도보', 'from': from_name, 'to': station['name'],
                          'detail': f"역까지 {dist_station:.1f}km", 'time_min': walk,
                          'from_lat': from_lat, 'from_lng': from_lng,
                          'to_lat': station['lat'], 'to_lng': station['lng']})
        departure = dep - walk - WAIT_MIN

    steps += [
        {'mode': '🚏 대기', 'from': station['name'], 'to': station['name'],
         'detail': '승차 대기', 'time_min': WAIT_MIN},
        {'mode': '🚄 전철', 'from': station['name'], 'to': hub,
         'detail': f"{_line_name(train, station['name'])} {train.get('departure')}→{train.get('arrival')} ({train.get('minutes')}분)",
         'time_min': int(train.get('minutes') or 0),
         'subway_name': _line_name(train, station['name'])},
        {'mode': '🚏 대기', 'from': hub, 'to': hub, 'detail': '환승 대기', 'time_min': TRANSFER_MIN},
    ]
    for x in part.get('steps') or []:
        steps.append(x)
    try:
        dist = dist_station + float(part.get('distance_km') or 0)
    except Exception:
        dist = dist_station
    return {
        'steps': steps,
        'total_min': int(total),
        'departure': _hm(departure),
        'arrival': _hm(departure + total),
        'distance_km': round(dist, 1),
        'source': 'rail_seoul',
        'estimated': False,
        'note': '경의중앙선 + 서울 대중교통',
    }


def _inbound(from_name, from_lat, from_lng, to_name, to_lat, to_lng,
             station, dist_station, arrival_min, date):
    """서울 → 양평"""
    walk = _walk_min(dist_station)
    best = None
    for hub, hlat, hlng in HUBS:
        part = _seoul_plan(from_lat, from_lng, hlat, hlng, arrival_min)
        if not part:
            continue
        trains = _search_trains(hub, station['name'], date)
        if not trains:
            trains = _synthetic_rail(station, hub, arrival_min - walk)
        if not trains:
            continue
        train = _pick_train(trains, arrival_min - walk)
        if not train:
            continue
        dep = _hm_min(train.get('departure'))
        if dep is None:
            continue
        total = int(part['total_min']) + TRANSFER_MIN + int(train.get('minutes') or 0) + walk
        if best is None or total < best[0]:
            best = (total, hub, train, part, dep)

    if not best:
        return None
    total, hub, train, part, dep = best
    steps = []
    for s in part.get('steps') or []:
        steps.append(s)
    steps.append({'mode': '🚏 대기', 'from': hub, 'to': hub, 'detail': '환승 대기', 'time_min': TRANSFER_MIN})
    steps.append({'mode': '🚄 전철', 'from': hub, 'to': station['name'],
                  'detail': f"{_line_name(train, station['name'])} {train.get('departure')}→{train.get('arrival')} ({train.get('minutes')}분)",
                  'time_min': int(train.get('minutes') or 0),
                  'subway_name': _line_name(train, station['name'])})
    if dist_station >= 0.3:
        steps.append({'mode': '🚶 도보', 'from': station['name'], 'to': to_name,
                      'detail': f"도착지까지 {dist_station:.1f}km", 'time_min': walk,
                      'from_lat': station['lat'], 'from_lng': station['lng'],
                      'to_lat': to_lat, 'to_lng': to_lng})
    departure = dep - int(part['total_min']) - TRANSFER_MIN
    try:
        dist = dist_station + float(part.get('distance_km') or 0)
    except Exception:
        dist = dist_station
    return {
        'steps': steps,
        'total_min': int(total),
        'departure': _hm(departure),
        'arrival': _hm(departure + total),
        'distance_km': round(dist, 1),
        'source': 'rail_seoul',
        'estimated': False,
        'note': '서울 대중교통 + 경의중앙선',
    }


def train_min(trains):
    """가장 짧은 열차 소요시간 (대기 여유 계산용)"""
    mins = [int(t.get('minutes') or 0) for t in (trains or []) if t.get('minutes')]
    return min(mins) if mins else 0
