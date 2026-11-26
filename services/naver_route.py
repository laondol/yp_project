"""네이버 지도 길찾기(자동차) 연동

- 네이버는 대중교통 경로 API를 제공하지 않는다(2026년 기준).
- 제공되는 것은 자동차 길찾기(Directions)이므로 택시/차량 소요시간·거리 보정에 사용한다.
- 별도 키 필요: NAVER_MAPS_CLIENT_ID / NAVER_MAPS_CLIENT_SECRET
  (네이버 클라우드 플랫폼 > Maps > Directions 활성화 후 발급)
- 키가 없으면 조용히 None 을 돌려주고 기존 추정치를 사용한다.
"""
import os
import time

from services.directions import haversine_km

_MEM = {}
_TTL = 7 * 24 * 3600  # 자동차 경로는 자주 바뀌지 않음


def _keys():
    cid = os.getenv('NAVER_MAPS_CLIENT_ID', '') or os.getenv('NAVER_DIRECTIONS_CLIENT_ID', '')
    sec = os.getenv('NAVER_MAPS_CLIENT_SECRET', '') or os.getenv('NAVER_DIRECTIONS_CLIENT_SECRET', '')
    return cid, sec


def available():
    cid, sec = _keys()
    return bool(cid and sec)


def driving(from_lat, from_lng, to_lat, to_lng):
    """자동차 경로 요약 {distance_km, duration_min, tollfare} 또는 None"""
    cid, sec = _keys()
    if not cid or not sec:
        return None
    ck = (round(float(from_lat), 4), round(float(from_lng), 4),
          round(float(to_lat), 4), round(float(to_lng), 4))
    hit = _MEM.get(ck)
    if hit and hit[0] + _TTL > time.time():
        return hit[1]
    try:
        import requests
        r = requests.get(
            'https://maps.apigw.ntruss.com/map-direction/v1/driving',
            params={
                'start': f'{from_lng},{from_lat}',
                'goal': f'{to_lng},{to_lat}',
                'option': 'trafast',
            },
            headers={
                'x-ncp-apigw-api-key-id': cid,
                'x-ncp-apigw-api-key': sec,
            },
            timeout=6,
        )
        if r.status_code != 200:
            return None
        data = r.json()
        route = ((data.get('route') or {}).get('trafast') or [{}])[0]
        summary = route.get('summary') or {}
        dist = summary.get('distance')
        dur = summary.get('duration')
        if dist is None or dur is None:
            return None
        out = {
            'distance_km': round(float(dist) / 1000, 1),
            'duration_min': max(1, int(round(float(dur) / 1000 / 60))),
            'tollfare': int(summary.get('tollFare') or 0),
        }
        _MEM[ck] = (time.time(), out)
        return out
    except Exception:
        return None


def taxi_estimate(from_lat, from_lng, to_lat, to_lng):
    """택시 소요시간/요금 — 네이버 경로가 있으면 그 값을, 없으면 거리 추정"""
    d = driving(from_lat, from_lng, to_lat, to_lng)
    if d:
        km = d['distance_km']
        return {
            'distance_km': km,
            'duration_min': d['duration_min'] + 3,
            'fare': int(round(km * 1500 + 3800, -2)),
            'source': 'naver',
        }
    km = haversine_km(from_lat, from_lng, to_lat, to_lng)
    road = km * 1.3
    return {
        'distance_km': round(road, 1),
        'duration_min': max(3, int(round(road / 40 * 60)) + 5),
        'fare': int(round(road * 1500 + 3800, -2)),
        'source': 'estimate',
    }
