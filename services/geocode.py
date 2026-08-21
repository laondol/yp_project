import re
import requests
import math
from flask import current_app

YANGPYEONG_BOUNDS = {
    '양평읍': {'lat_min': 37.45, 'lat_max': 37.52, 'lon_min': 127.48, 'lon_max': 127.60},
    '강상면': {'lat_min': 37.44, 'lat_max': 37.50, 'lon_min': 127.45, 'lon_max': 127.55},
    '강하면': {'lat_min': 37.46, 'lat_max': 37.53, 'lon_min': 127.38, 'lon_max': 127.48},
    '양서면': {'lat_min': 37.50, 'lat_max': 37.58, 'lon_min': 127.30, 'lon_max': 127.42},
    '옥천면': {'lat_min': 37.48, 'lat_max': 37.55, 'lon_min': 127.55, 'lon_max': 127.65},
    '서종면': {'lat_min': 37.55, 'lat_max': 37.65, 'lon_min': 127.35, 'lon_max': 127.48},
    '단월면': {'lat_min': 37.52, 'lat_max': 37.60, 'lon_min': 127.60, 'lon_max': 127.72},
    '청운면': {'lat_min': 37.50, 'lat_max': 37.58, 'lon_min': 127.68, 'lon_max': 127.75},
    '양동면': {'lat_min': 37.38, 'lat_max': 37.46, 'lon_min': 127.60, 'lon_max': 127.72},
    '지평면': {'lat_min': 37.40, 'lat_max': 37.48, 'lon_min': 127.55, 'lon_max': 127.68},
    '용문면': {'lat_min': 37.42, 'lat_max': 37.50, 'lon_min': 127.50, 'lon_max': 127.62},
    '개군면': {'lat_min': 37.35, 'lat_max': 37.44, 'lon_min': 127.48, 'lon_max': 127.62},
}

YANGPYEONG_VILLAGES = {
    '양평읍': ['양근리', '오빈리', '신애리', '덕평리', '봉성리', '원덕리', '도곡리', '백안리', '송학리', '대흥리', '회현리', '공흥리', '사송리'],
    '강상면': ['병산리', '교평리', '세월리', '운심리', '신화리', '송학리', '화양리', '대석리', '강하리'],
    '강하면': ['전수리', '왕창리', '운심리', '성덕리', '동오리', '공세리', '항금리'],
    '양서면': ['양수리', '용담리', '대심리', '신원리', '목왕리', '증동리', '가동리', '도곡리', '부평리', '삼회리'],
    '옥천면': ['옥천리', '용천리', '신복리', '아신리', '삼합리', '후곡리'],
    '서종면': ['서후리', '문호리', '정배리', '수능리', '도장리', '금사리', '내수리', '노문리'],
    '단월면': ['봉상리', '향양리', '보룡리', '부안리', '석산리', '명성리', '삼가리', '덕수리'],
    '청운면': ['용두리', '가현리', '여물리', '도원리', '갈운리', '비룡리', '신론리', '삼성리'],
    '양동면': ['쌍학리', '매월리', '석정리', '금왕리', '고송리', '계정리'],
    '지평면': ['지평리', '월산리', '송현리', '무왕리', '대평리', '수곡리', '일신리'],
    '용문면': ['용문리', '마룡리', '금곡리', '망미리', '삼성리', '화전리', '다문리', '조현리', '오촌리', '연수리', '덕촌리', '중원리'],
    '개군면': ['주읍리', '내리', '석장리', '하자포리', '부리', '공세리', '양동리', '구미리', '향리', '계전리'],
}

def generate_town_geojson():
    features = []
    for town, bounds in YANGPYEONG_BOUNDS.items():
        feature = {
            "type": "Feature",
            "properties": {"name": town, "type": "town"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [bounds['lon_min'], bounds['lat_min']],
                    [bounds['lon_max'], bounds['lat_min']],
                    [bounds['lon_max'], bounds['lat_max']],
                    [bounds['lon_min'], bounds['lat_max']],
                    [bounds['lon_min'], bounds['lat_min']]
                ]]
            }
        }
        features.append(feature)
    return {"type": "FeatureCollection", "features": features}

def generate_village_geojson():
    features = []
    for town, villages in YANGPYEONG_VILLAGES.items():
        bounds = YANGPYEONG_BOUNDS[town]
        lon_step = (bounds['lon_max'] - bounds['lon_min']) / max(len(villages), 1)
        lat_step = (bounds['lat_max'] - bounds['lat_min']) / max(len(villages), 1)
        for i, village in enumerate(villages):
            lat_min = bounds['lat_min'] + (i % max(len(villages)//2+1, 1)) * lat_step * 2
            lat_max = min(lat_min + lat_step * 2, bounds['lat_max'])
            lon_min = bounds['lon_min'] + ((i // max(len(villages)//2+1, 1)) % 2) * lon_step * (len(villages)//2)
            lon_max = min(lon_min + lon_step * (len(villages)//2), bounds['lon_max'])
            feature = {
                "type": "Feature",
                "properties": {"name": village, "town": town, "type": "village"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [lon_min, lat_min],
                        [lon_max, lat_min],
                        [lon_max, lat_max],
                        [lon_min, lat_max],
                        [lon_min, lat_min]
                    ]]
                }
            }
            features.append(feature)
    return {"type": "FeatureCollection", "features": features}

def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

_PLACE_CACHE = {}


def _cache_key(lat, lon):
    return (round(float(lat), 4), round(float(lon), 4))


def _nominatim_reverse(lat, lon):
    """전 세계 역지오코딩 (OpenStreetMap Nominatim, 한국어 우선). 실패 시 None."""
    try:
        ua = current_app.config.get('SITE_NAME', 'yp')
        res = requests.get(
            'https://nominatim.openstreetmap.org/reverse',
            params={'lat': lat, 'lon': lon, 'format': 'jsonv2',
                    'accept-language': 'ko', 'zoom': 14},
            headers={'User-Agent': f'{ua}-share/1.0'},
            timeout=10)
        if res.status_code != 200:
            return None
        j = res.json()
        a = j.get('address', {}) or {}
        # 우편번호 등 디지털 토큰 제거 후, 큰 지역→작은 지역 순서로 깔끔한 지명 문자열 생성
        toks = [t.strip() for t in (j.get('display_name') or '').split(',')]
        toks = [t for t in reversed(toks)
                if t and not re.fullmatch(r'\d{3,7}(-\d{2,5})?', t)]
        clean = []
        for t in toks:
            if t not in clean:
                clean.append(t)
        town = (a.get('city') or a.get('town') or a.get('municipality')
                or a.get('county') or a.get('state') or a.get('country') or '')
        village = (a.get('village') or a.get('suburb') or a.get('neighbourhood')
                   or a.get('district') or '')
        return {'town': town, 'village': village, 'address': ' '.join(clean) or j.get('display_name', ''), 'is_korea': False}
    except Exception:
        return None


def _resolve_place(lat, lon, kakao_key=None):
    """좌표 → {'town','village','address','is_korea'} (국내는 행정안전부/Kakao, 해외는 Nominatim).
    지명 전체를 정확히 표현하기 위해 address 에 시도~읍면/동까지 담는다."""
    key = _cache_key(lat, lon)
    if key in _PLACE_CACHE:
        return _PLACE_CACHE[key]

    # 1) 행정안전부 주소기반산업지원서비스 API (전국 법정동/리)
    try:
        juso_key = current_app.config.get('JUSO_API_KEY', '')
    except RuntimeError:
        juso_key = ''
    if juso_key:
        try:
            url = 'https://business.juso.go.kr/addrlink/coordAddrApi.do'
            params = {'confmKey': juso_key, 'entX': lon, 'entY': lat, 'resultType': 'json'}
            res = requests.get(url, params=params, timeout=5)
            if res.status_code == 200:
                data = res.json()
                juso = (data.get('results', {}) or {}).get('juso', [])
                if juso:
                    full = (juso[0].get('emdNm', '') or juso[0].get('lnmAdres', '') or '')
                    for t in YANGPYEONG_BOUNDS:
                        if t in full:
                            for v in YANGPYEONG_VILLAGES.get(t, []):
                                if v in full:
                                    d = {'town': t, 'village': v,
                                         'address': f'경기도 양평군 {t} {v}', 'is_korea': True}
                                    _PLACE_CACHE[key] = d
                                    return d
                            d = {'town': t, 'village': '', 'address': f'경기도 양평군 {t}', 'is_korea': True}
                            _PLACE_CACHE[key] = d
                            return d
        except Exception as e:
            print(f"[Geocode] JUSO API exception: {e}")

    # 2) Kakao API (전국) — 법정동(B) 기준으로 시도~법정리 전체 지명 구성
    if kakao_key is None:
        try:
            kakao_key = current_app.config.get('KAKAO_REST_API_KEY', '')
        except RuntimeError:
            kakao_key = ''
    if kakao_key:
        try:
            url = f'https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x={lon}&y={lat}'
            headers = {'Authorization': f'KakaoAK {kakao_key}'}
            res = requests.get(url, headers=headers, timeout=5)
            if res.status_code == 200:
                data = res.json()
                town, village, r1, r2 = '', '', '', ''
                for doc in data.get('documents', []):
                    rt = doc.get('region_type', '')
                    if rt == 'B':
                        r1 = doc.get('region_1depth_name', '')
                        r2 = doc.get('region_2depth_name', '')
                        r3 = doc.get('region_3depth_name', '')
                        r4 = doc.get('region_4depth_name', '')
                        town, village = r3, r4 or village
                    elif rt == 'H' and not town:
                        r3 = doc.get('region_3depth_name', '')
                        town = r3
                if town:
                    address = ' '.join(x for x in (r1, r2, town, village) if x)
                    d = {'town': town, 'village': village, 'address': address, 'is_korea': True}
                    _PLACE_CACHE[key] = d
                    return d
            if res.status_code != 400:
                print(f"[Geocode] Kakao API error: {res.status_code}")
        except Exception as e:
            print(f"[Geocode] Kakao API exception: {e}")

    # 3) 해외/실패 → 전 세계 역지오코딩 (Nominatim)
    d = _nominatim_reverse(lat, lon)
    if d:
        _PLACE_CACHE[key] = d
        return d

    # 4) 최종 폴백: 양평군 bounds lookup
    town, village = _fallback_lookup(lat, lon)
    d = {'town': town, 'village': village,
         'address': f'경기도 양평군 {town} {village}'.strip() if town else '', 'is_korea': False}
    _PLACE_CACHE[key] = d
    return d


def gps_to_town_village(lat, lon, kakao_key=None):
    """좌표 → (읍면, 리/동). 국내·해외 모두 가장 가까운 행정구역명 반환."""
    d = _resolve_place(lat, lon, kakao_key)
    return d['town'], d['village']


def gps_to_address(lat, lon, kakao_key=None):
    """좌표 → 정확한 전체 지명 문자열 (예: 경기도 양평군 용문면 다문리 / 일본 도쿄도 지요다구)."""
    d = _resolve_place(lat, lon, kakao_key)
    return d.get('address', '')

def gps_to_road_address(lat, lon, kakao_key=None):
    """좌표 → 도로명 주소 (Kakao coord2address). 실패 시 지번 주소."""
    if kakao_key is None:
        try:
            kakao_key = current_app.config.get('KAKAO_REST_API_KEY', '')
        except RuntimeError:
            kakao_key = ''
    if not kakao_key:
        return ''
    try:
        url = 'https://dapi.kakao.com/v2/local/geo/coord2address.json'
        headers = {'Authorization': f'KakaoAK {kakao_key}'}
        res = requests.get(url, headers=headers, params={'x': lon, 'y': lat}, timeout=5)
        if res.status_code == 200:
            docs = (res.json().get('documents') or [])
            if docs:
                road = docs[0].get('road_address') or {}
                if road.get('address_name'):
                    return road['address_name']
                jibun = docs[0].get('address') or {}
                if jibun.get('address_name'):
                    return jibun['address_name']
    except Exception as e:
        print(f'[GEO] Kakao coord2address fail: {e}')
    return ''

def _fallback_lookup(lat, lon):
    best_town = None
    best_village = ''
    for town, bounds in YANGPYEONG_BOUNDS.items():
        if bounds['lat_min'] <= lat <= bounds['lat_max'] and bounds['lon_min'] <= lon <= bounds['lon_max']:
            best_town = town
            break
    if not best_town:
        min_dist = float('inf')
        for town, bounds in YANGPYEONG_BOUNDS.items():
            center_lat = (bounds['lat_min'] + bounds['lat_max']) / 2
            center_lon = (bounds['lon_min'] + bounds['lon_max']) / 2
            dist = haversine(lat, lon, center_lat, center_lon)
            if dist < min_dist:
                min_dist = dist
                best_town = town
    return best_town, ''

def get_nearby_reports(reports, user_lat, user_lon, max_count=12, max_km=20):
    scored = []
    for r in reports:
        if r.latitude and r.longitude:
            dist = haversine(user_lat, user_lon, r.latitude, r.longitude)
            if dist <= max_km:
                scored.append((r, round(dist, 1)))
    scored.sort(key=lambda x: x[1])
    return scored[:max_count]

def is_in_yangpyeong(lat, lon):
    return 37.35 <= lat <= 37.65 and 127.30 <= lon <= 127.75



def calibrate_gps(lat, lon, town=None, village=None):
    """GPS 보정 적용:
    1. town/village가 주어지면 해당 지역의 DB 누적 보정값 사용
    2. 없으면 좌표로 읍면을 찾아서 적용
    """
    if not town or not village:
        town, village = _fallback_lookup(lat, lon)
    try:
        from models import db, GpsCalibration
        # village를 모르면 town 기준으로만 조회 (fallback_lookup은 village를 못 찾음)
        if village:
            cal = GpsCalibration.query.filter_by(town=town, village=village).order_by(GpsCalibration.sample_count.desc()).first()
        else:
            cal = GpsCalibration.query.filter_by(town=town).order_by(GpsCalibration.sample_count.desc()).first()
        if cal and cal.sample_count > 0:
            return lat + cal.offset_lat, lon + cal.offset_lon
    except:
        pass
    return lat, lon

def geocode_text(addr, kakao_key=None, juso_key=None):
    """주소/지역명 문자열 -> (lat, lng). 실패 시 (None, None)."""
    if not addr:
        return None, None
    addr = str(addr).strip()
    if kakao_key is None:
        kakao_key = current_app.config.get('KAKAO_REST_API_KEY', '')
    if kakao_key:
        try:
            url = 'https://dapi.kakao.com/v2/local/search/address.json'
            r = requests.get(url, headers={'Authorization': f'KakaoAK {kakao_key}'},
                             params={'query': addr}, timeout=10)
            if r.status_code == 200:
                docs = r.json().get('documents') or []
                if docs:
                    return float(docs[0]['y']), float(docs[0]['x'])
        except Exception as e:
            print(f'[GEO] Kakao fwd fail: {e}')
    if juso_key is None:
        juso_key = current_app.config.get('JUSO_API_KEY', '')
    if juso_key:
        try:
            url = 'https://business.juso.go.kr/addrlink/addrCoordApi.do'
            r = requests.get(url, params={'confmKey': juso_key, 'keyword': addr,
                             'resultType': 'json', 'countPerPage': 1}, timeout=10)
            if r.status_code == 200:
                data = r.json()
                juso = (data.get('results', {}) or {}).get('juso', [])
                if juso:
                    return float(juso[0]['entY']), float(juso[0]['entX'])
        except Exception as e:
            print(f'[GEO] JUSO fwd fail: {e}')
    return None, None
