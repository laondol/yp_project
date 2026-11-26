"""장거리 열차(KTX 등) 연결 경로

- 출발/도착지에서 가까운 철도 거점역을 찾아 열차 편성 조회
- 접근/이탈 구간은 거리 기반 추정
"""
from datetime import datetime

from services.tago_train import search_trains

# 주요 거점역 좌표 (필요 시 추가)
HUBS = [
    ('서울', 37.5547, 126.9707),
    ('용산', 37.5290, 126.9650),
    ('청량리', 37.5800, 127.0470),
    ('영등포', 37.5150, 126.9070),
    ('수원', 37.2650, 127.0000),
    ('천안아산', 36.7940, 127.1040),
    ('대전', 36.3320, 127.4340),
    ('동대구', 35.8800, 128.6280),
    ('부산', 35.1150, 129.0410),
    ('강릉', 37.7640, 128.8990),
    ('광주송정', 35.1370, 126.7900),
    ('목포', 34.7920, 126.3870),
    ('여수엑스포', 34.7500, 127.7470),
    ('전주', 35.8500, 127.1600),
    ('포항', 36.0720, 129.3420),
]

MIN_KM = 60.0        # 이보다 가까우면 열차 미사용
ACCESS_KMH = 28.0    # 거점역 접근 평균 속도


def _haversine(a_lat, a_lng, b_lat, b_lng):
    from math import radians, sin, cos, sqrt, atan2
    R = 6371
    dlat = radians(b_lat - a_lat)
    dlng = radians(b_lng - a_lng)
    h = sin(dlat / 2) ** 2 + cos(radians(a_lat)) * cos(radians(b_lat)) * sin(dlng / 2) ** 2
    return R * 2 * atan2(sqrt(h), sqrt(1 - h))


def nearest_hub(lat, lng, max_km=70.0):
    best = None
    for name, hlat, hlng in HUBS:
        d = _haversine(lat, lng, hlat, hlng)
        if best is None or d < best[1]:
            best = (name, d, hlat, hlng)
    if best and best[1] <= max_km:
        return best
    return None


def _hm_to_min(t):
    try:
        h, m = t.split(':')[:2]
        return int(h) * 60 + int(m)
    except Exception:
        return None


def plan(from_name, from_lat, from_lng, to_name, to_lat, to_lng, arrival_min=None, date=None):
    direct = _haversine(from_lat, from_lng, to_lat, to_lng)
    if direct < MIN_KM:
        return None

    hf = nearest_hub(from_lat, from_lng)
    ht = nearest_hub(to_lat, to_lng, max_km=40.0)
    if not hf:
        return None
    if not ht:
        # 도착지 이름이 역명과 일치하면 사용
        for name, hlat, hlng in HUBS:
            if name in (to_name or ''):
                ht = (name, 0.0, hlat, hlng)
                break
    if not ht or hf[0] == ht[0]:
        return None

    d = (date or datetime.now().strftime('%Y%m%d')).replace('-', '')
    trains = search_trains(hf[0], ht[0], d, limit=10)
    if not trains:
        return None

    # 도착 목표에 맞는 가장 늦은 열차 선택
    chosen = trains[0]
    if arrival_min is not None:
        ok = []
        for t in trains:
            am = _hm_to_min(t.get('arrival'))
            if am is not None and am <= arrival_min:
                ok.append((am, t))
        if ok:
            chosen = max(ok, key=lambda x: x[0])[1]

    access_km = hf[1]
    egress_km = ht[1]
    access_min = int(access_km / ACCESS_KMH * 60) + 5
    egress_min = int(egress_km / ACCESS_KMH * 60) + 5
    ride = int(chosen.get('minutes') or 0)
    wait = 10
    total = access_min + wait + ride + egress_min

    steps = []
    if access_min > 1:
        steps.append({'mode': '🚕 접근', 'from': from_name, 'to': hf[0],
                      'detail': f"{hf[0]}까지 약 {access_min}분 ({access_km:.1f}km)",
                      'time_min': access_min})
    steps.append({'mode': f"🚄 {chosen.get('grade') or '열차'}", 'from': hf[0], 'to': ht[0],
                  'detail': f"{chosen.get('grade')} {chosen.get('departure')}→{chosen.get('arrival')} "
                            f"({ride}분, {chosen.get('fare')}원)",
                  'time_min': ride})
    if egress_min > 1:
        steps.append({'mode': '🚕 이탈', 'from': ht[0], 'to': to_name,
                      'detail': f"{to_name}까지 약 {egress_min}분 ({egress_km:.1f}km)",
                      'time_min': egress_min})

    dep_min = arrival_min - total if arrival_min is not None else None
    return {
        'steps': steps,
        'total_min': total,
        'departure': f'{dep_min // 60:02d}:{dep_min % 60:02d}' if dep_min is not None and dep_min >= 0 else '',
        'arrival': f'{arrival_min // 60:02d}:{arrival_min % 60:02d}' if arrival_min is not None else '',
        'distance_km': round(direct, 1),
        'source': 'train',
        'estimated': True,
        'note': '열차 시간표 + 접근 추정',
    }
