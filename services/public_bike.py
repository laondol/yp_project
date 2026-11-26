"""공공자전거 정보 (브랜드 목록 + 대여소 위치)

- 국내 공공자전거는 지자체별로 브랜드/API가 다르다.
- 현재 실시간 대여소 조회가 가능한 곳: 서울 따릉이 (서울 열린데이터광장)
- 나머지 브랜드는 안내용으로만 노출하고, 대여소 조회는 지원하지 않는다.
"""
import os
import json
import math
from datetime import datetime, timedelta

from models import db, PublicDataCache

CACHE_KEY = 'seoul_bike_stations'
CACHE_MIN = 5
R = 6371.0

BRANDS = [
    {
        'id': 'ttaereung', 'name': '따릉이', 'region': '서울', 'available': True,
        'operator': '서울시설공단', 'homepage': 'https://www.bikeseoul.com',
        'app': '따릉이(Seoul Bike) 앱', 'fee': '일반권 1시간 1,000원 / 정기권 30일 5,000원',
        'note': '만 15세 이상, 1인 1대',
    },
    {
        'id': 'tajo', 'name': '타조', 'region': '고양', 'available': False,
        'operator': '고양시', 'homepage': 'https://www.goyang.go.kr', 'app': '타조 앱',
        'fee': '지자체 요금 안내 참고', 'note': '대여소 조회 미지원',
    },
    {
        'id': 'eoulling', 'name': '어울링', 'region': '세종', 'available': False,
        'operator': '세종시', 'homepage': 'https://www.sejong.go.kr', 'app': '어울링 앱',
        'fee': '지자체 요금 안내 참고', 'note': '대여소 조회 미지원',
    },
    {
        'id': 'tareung', 'name': '타랑께', 'region': '광주', 'available': False,
        'operator': '광주시', 'homepage': 'https://www.gwangju.go.kr', 'app': '타랑께 앱',
        'fee': '지자체 요금 안내 참고', 'note': '대여소 조회 미지원',
    },
]


def _key():
    for k in ('SEOUL_OPENAPI_KEY', 'SEOUL_SUBWAY_API_KEY'):
        v = os.getenv(k, '')
        if v:
            return v
    return ''


def brands():
    return BRANDS


def brand_map():
    return {b['id']: b for b in BRANDS}


def _haversine(lat1, lng1, lat2, lng2):
    try:
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = p2 - p1
        dl = math.radians(lng2 - lng1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * R * math.asin(math.sqrt(a))
    except Exception:
        return 0.0


def _cache_get():
    row = PublicDataCache.query.filter_by(key=CACHE_KEY).first()
    if not row or not row.fetched_at:
        return None
    if datetime.now() - row.fetched_at > timedelta(minutes=CACHE_MIN):
        return None
    try:
        return json.loads(row.payload or '[]')
    except Exception:
        return None


def _cache_set(items):
    row = PublicDataCache.query.filter_by(key=CACHE_KEY).first()
    payload = json.dumps(items, ensure_ascii=False)
    if row:
        row.payload = payload
        row.fetched_at = datetime.now()
    else:
        db.session.add(PublicDataCache(key=CACHE_KEY, payload=payload))
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()


def stations():
    """따릉이 대여소 전체 (5분 캐시). 조회 불가 시 빈 목록."""
    cached = _cache_get()
    if cached is not None:
        return cached
    key = _key()
    if not key:
        return []
    try:
        import requests
        url = f'http://openapi.seoul.go.kr:8088/{key}/json/bikeList/1/1000/'
        r = requests.get(url, timeout=8)
        if r.status_code != 200:
            return []
        data = r.json()
        rows = ((data.get('rentBikeStatus') or {}).get('row')) or []
        out = []
        for x in rows:
            try:
                out.append({
                    'name': x.get('stationName') or '',
                    'lat': float(x.get('stationLatitude')),
                    'lng': float(x.get('stationLongitude')),
                    'racks': int(x.get('rackTotCnt') or 0),
                    'bikes': int(x.get('parkingBikeTotCnt') or 0),
                })
            except Exception:
                continue
        if out:
            _cache_set(out)
        return out
    except Exception:
        return []


def near(lat, lng, radius_km=0.7, limit=8):
    """좌표 주변 대여소 (가까운 순)"""
    try:
        la, lo = float(lat), float(lng)
    except Exception:
        return []
    found = []
    for s in stations():
        d = _haversine(la, lo, s['lat'], s['lng'])
        if d <= radius_km:
            found.append({**s, 'distance_m': int(round(d * 1000))})
    found.sort(key=lambda x: x['distance_m'])
    return found[:limit]


def status():
    st = stations()
    return {
        'available': bool(st),
        'stations': len(st),
        'reason': '' if st else ('API 키 미설정 (SEOUL_OPENAPI_KEY)' if not _key() else '대여소 정보를 불러오지 못했습니다.'),
    }
