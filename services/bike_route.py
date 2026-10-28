import math
import os
import time
from math import atan2, cos, degrees, radians, sin, sqrt

import requests
from flask import current_app

DEFAULT_BROUTER_URL = 'https://brouter.de/brouter'
DEFAULT_PROFILE = 'trekking'
CACHE_TTL = 6 * 3600
CACHE = {}
WINDOW_M = 50.0
MIN_SEGMENT_M = 30.0


def _config(name, default=''):
    try:
        value = current_app.config.get(name)
    except RuntimeError:
        value = None
    return value or os.getenv(name, default)


def _distance_m(lat1, lng1, lat2, lng2):
    r = 6371000
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return r * 2 * atan2(sqrt(a), sqrt(1 - a))


def _tag_value(tags, key):
    for part in str(tags or '').split():
        if part.startswith(key + '='):
            return part.split('=', 1)[1]
    return ''


def _road_class(tags):
    highway = _tag_value(tags, 'highway')
    cycleway = _tag_value(tags, 'cycleway')
    cycleway_both = _tag_value(tags, 'cycleway:both')
    cycleway_left = _tag_value(tags, 'cycleway:left')
    cycleway_right = _tag_value(tags, 'cycleway:right')
    bicycle = _tag_value(tags, 'bicycle')
    lane_values = {cycleway, cycleway_both, cycleway_left, cycleway_right}
    lane_values = {x for x in lane_values if x}

    if highway == 'cycleway':
        return 'dedicated'
    if any(x in {'lane', 'track', 'opposite_lane', 'opposite_track', 'shared_lane'} for x in lane_values):
        return 'lane'
    if highway in {'path', 'footway', 'pedestrian'} and bicycle in {'yes', 'designated', 'permissive'}:
        return 'shared'
    if bicycle == 'designated':
        return 'shared'
    return 'general'


def _is_busy(tags):
    return _tag_value(tags, 'highway') in {'primary', 'secondary', 'tertiary'}


def _is_unpaved(tags):
    surface = _tag_value(tags, 'surface')
    return surface in {'unpaved', 'gravel', 'ground', 'dirt', 'grass', 'sand', 'mud', 'cobblestone'}


def _points_from_messages(messages):
    if not isinstance(messages, list) or len(messages) < 2:
        return []
    header = messages[0]
    try:
        i_dist = header.index('Distance')
        i_ele = header.index('Elevation')
        i_tags = header.index('WayTags')
    except ValueError:
        return []
    points = []
    cumulative = 0.0
    for row in messages[1:]:
        try:
            dist = float(row[i_dist] or 0)
            ele = float(row[i_ele] or 0)
        except (TypeError, ValueError, IndexError):
            continue
        if dist <= 0:
            continue
        cumulative += dist
        points.append({'dist_m': dist, 'ele_m': ele, 'cum_m': cumulative, 'tags': str(row[i_tags] or '')})
    return points


def _points_from_geometry(geometry):
    coords = (geometry or {}).get('coordinates') or []
    points = []
    cumulative = 0.0
    prev = None
    for coord in coords:
        if not isinstance(coord, (list, tuple)) or len(coord) < 2:
            continue
        lng, lat = float(coord[0]), float(coord[1])
        ele = float(coord[2]) if len(coord) > 2 and coord[2] is not None else 0.0
        if prev:
            dist = _distance_m(prev[0], prev[1], lat, lng)
            if dist > 0:
                cumulative += dist
                points.append({'dist_m': dist, 'ele_m': ele, 'cum_m': cumulative, 'tags': ''})
        prev = (lat, lng)
    return points


def _max_grade(points):
    best = {'grade': 0.0, 'length': 0.0, 'at': 0.0, 'gain': 0.0}
    if not points or len(points) < 2:
        return best

    for idx, p in enumerate(points):
        if p['dist_m'] < MIN_SEGMENT_M:
            continue
        start = p['cum_m'] - p['dist_m']
        prev_ele = points[idx - 1]['ele_m'] if idx > 0 else p['ele_m']
        gain = p['ele_m'] - prev_ele
        if gain <= 0:
            continue
        grade = gain / p['dist_m'] * 100
        if grade > best['grade']:
            best = {'grade': grade, 'length': p['dist_m'], 'at': start, 'gain': gain}

    for i in range(len(points)):
        start_cum = points[i]['cum_m']
        target = start_cum + WINDOW_M
        for j in range(i + 1, len(points)):
            if points[j]['cum_m'] < target:
                continue
            prev = points[j - 1]
            span = points[j]['cum_m'] - prev['cum_m']
            ratio = (target - prev['cum_m']) / span if span else 0
            target_ele = prev['ele_m'] + (points[j]['ele_m'] - prev['ele_m']) * ratio
            gain = target_ele - points[i]['ele_m']
            if gain <= 0:
                break
            grade = gain / WINDOW_M * 100
            if grade > best['grade'] + 0.3:
                best = {'grade': grade, 'length': WINDOW_M, 'at': start_cum, 'gain': gain}
            break
    return best


def _bike_friendly(bike_pct, busy_pct, max_deg, total_m, ascent_m):
    if bike_pct >= 50 and max_deg <= 5 and busy_pct <= 25:
        return 'good', '좋음'
    if bike_pct >= 20 and max_deg <= 7 and busy_pct <= 50:
        return 'ok', '보통'
    if total_m <= 1500 and max_deg <= 3 and ascent_m <= 30:
        return 'ok', '보통'
    return 'caution', '주의'


def _reason(level, bike_pct, busy_pct, max_deg, max_len, total_m):
    if level == 'good':
        return f'자전거 전용·공용로가 {bike_pct:.0f}%이고 최대 경사는 {max_deg:.1f}°로 무난해요.'
    if level == 'ok':
        if max_deg >= 4:
            return f'자전거도로가 {bike_pct:.0f}%지만 최대 {max_deg:.1f}°({max_len:.0f}m) 오르막이 있어요.'
        if bike_pct < 20:
            return f'전용·공용 자전거도로는 {bike_pct:.0f}%로 적지만 거리가 {total_m/1000:.1f}km로 짧고 경사가 완만해요.'
        return f'자전거도로 {bike_pct:.0f}%, 최대 경사 {max_deg:.1f}°로 무난한 편이에요.'
    if max_deg >= 7:
        return f'자전거도로 {bike_pct:.0f}%지만 최대 {max_deg:.1f}°({max_len:.0f}m) 급경사가 있어 주의가 필요해요.'
    if bike_pct < 20:
        return f'자전거 전용·공용로가 {bike_pct:.0f}%뿐이고 일반 차도 비중이 {busy_pct:.0f}%라 주의가 필요해요.'
    return f'자전거도로 {bike_pct:.0f}%이나 차도·경사 조건을 확인하고 가세요.'


def _build_result(props, points):
    total_m = float(props.get('track-length') or 0) or sum(p['dist_m'] for p in points)
    if not total_m:
        return None
    total_time = float(props.get('total-time') or 0)
    if total_time <= 0:
        total_time = total_m / 1000 / 15 * 3600

    buckets = {'dedicated': 0.0, 'lane': 0.0, 'shared': 0.0, 'general': 0.0}
    busy_m = 0.0
    unpaved_m = 0.0
    for p in points:
        buckets[_road_class(p['tags'])] += p['dist_m']
        if _is_busy(p['tags']):
            busy_m += p['dist_m']
        if _is_unpaved(p['tags']):
            unpaved_m += p['dist_m']

    def pct(value):
        return round(value / total_m * 100, 1) if total_m else 0.0

    bike_pct = pct(buckets['dedicated'] + buckets['lane'] + buckets['shared'])
    busy_pct = pct(busy_m)
    max_grade = _max_grade(points)
    max_deg = round(degrees(math.atan(max_grade['grade'] / 100)), 1) if max_grade['grade'] > 0 else 0.0
    ascent = float(props.get('filtered ascend') or 0)
    descent = 0.0
    prev_ele = None
    for p in points:
        if prev_ele is not None and p['ele_m'] < prev_ele:
            descent += prev_ele - p['ele_m']
        prev_ele = p['ele_m']
    level, label = _bike_friendly(bike_pct, busy_pct, max_deg, total_m, ascent)
    return {
        'distance_m': round(total_m),
        'duration_min': max(1, round(total_time / 60)),
        'duration_sec': round(total_time),
        'avg_speed_kmh': round(total_m / 1000 / (total_time / 3600), 1) if total_time else 0,
        'bike_road_pct': bike_pct,
        'dedicated_pct': pct(buckets['dedicated']),
        'lane_pct': pct(buckets['lane']),
        'shared_pct': pct(buckets['shared']),
        'general_pct': pct(buckets['general']),
        'busy_road_pct': busy_pct,
        'unpaved_pct': pct(unpaved_m),
        'max_grade_pct': round(max_grade['grade'], 1),
        'max_grade_deg': max_deg,
        'max_grade_length_m': round(max_grade['length']),
        'max_grade_at_m': round(max_grade['at']),
        'ascent_m': round(ascent),
        'descent_m': round(descent),
        'bike_friendly': level,
        'bike_friendly_label': label,
        'bike_reason': _reason(level, bike_pct, busy_pct, max_deg, max_grade['length'], total_m),
        'profile': _config('BROUTER_PROFILE', DEFAULT_PROFILE),
        'source': 'BRouter/OpenStreetMap',
    }


def analyze_bike_route(from_lat, from_lng, to_lat, to_lng):
    try:
        from_lat, from_lng = float(from_lat), float(from_lng)
        to_lat, to_lng = float(to_lat), float(to_lng)
    except (TypeError, ValueError):
        return None
    if not all((from_lat, from_lng, to_lat, to_lng)):
        return None
    if _distance_m(from_lat, from_lng, to_lat, to_lng) < 20:
        return None

    profile = _config('BROUTER_PROFILE', DEFAULT_PROFILE)
    cache_key = (round(from_lat, 4), round(from_lng, 4), round(to_lat, 4), round(to_lng, 4), profile)
    now = time.time()
    cached = CACHE.get(cache_key)
    if cached and now - cached[0] < CACHE_TTL:
        return cached[1]

    url = _config('BROUTER_URL', DEFAULT_BROUTER_URL)
    params = {
        'lonlats': f'{from_lng},{from_lat}|{to_lng},{to_lat}',
        'profile': profile,
        'alternativeidx': 0,
        'format': 'geojson',
    }
    try:
        res = requests.get(url, params=params, timeout=25, headers={'User-Agent': 'yangpyeong-bike/1.0'})
        res.raise_for_status()
        feature = (res.json().get('features') or [{}])[0]
        props = feature.get('properties') or {}
        points = _points_from_messages(props.get('messages'))
        if not points:
            points = _points_from_geometry(feature.get('geometry'))
        result = _build_result(props, points)
        if result:
            CACHE[cache_key] = (now, result)
        return result
    except Exception:
        return None
