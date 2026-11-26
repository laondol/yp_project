"""서울시 대중교통 환승경로 조회 (ws.bus.go.kr, 무료)

- 용도: 서울 구간 경로를 무료로 조회해 ODsay 일일 한도(30회)를 절약
- 반환: plan_segment 호환 dict
- 데이터: 버스/지하철 환승 경로(구간명, 노선명, 총 소요시간·거리)
"""
import os
import re
import xml.etree.ElementTree as ET

BASE = 'http://ws.bus.go.kr/api/rest/pathinfo/getPathInfoByBusNSub'
SEOUL_BBOX = (37.40, 37.72, 126.70, 127.20)  # lat_min, lat_max, lng_min, lng_max


def _key():
    key = os.getenv('SEOUL_BUS_API_KEY', '') or os.getenv('GG_BUS_API_KEY', '')
    if key:
        return key
    try:
        from flask import current_app
        return current_app.config.get('SEOUL_BUS_API_KEY', '') or current_app.config.get('GG_BUS_API_KEY', '')
    except Exception:
        return ''


def in_seoul(lat, lng):
    try:
        return (SEOUL_BBOX[0] <= float(lat) <= SEOUL_BBOX[1]
                and SEOUL_BBOX[2] <= float(lng) <= SEOUL_BBOX[3])
    except Exception:
        return False


def plan(from_lat, from_lng, to_lat, to_lng, arrival_min=None):
    if not in_seoul(from_lat, from_lng) or not in_seoul(to_lat, to_lng):
        return None
    key = _key()
    if not key:
        return None
    try:
        import requests
        r = requests.get(BASE, params={
            'ServiceKey': key,
            'startX': from_lng, 'startY': from_lat,
            'endX': to_lng, 'endY': to_lat,
        }, timeout=8)
        if r.status_code != 200:
            return None
        root = ET.fromstring(r.content)
    except Exception:
        return None

    item = root.find('.//itemList')
    if item is None:
        return None
    try:
        total_min = int(float(item.findtext('time') or 0))
        dist_km = round(float(item.findtext('distance') or 0) / 1000, 1)
    except Exception:
        return None
    if total_min <= 0:
        return None

    steps = []
    for p in item.findall('./pathList'):
        fname = (p.findtext('fname') or '').strip()
        tname = (p.findtext('tname') or '').strip()
        route = (p.findtext('routeNm') or '').strip()
        if not fname and not tname:
            continue
        rail = bool(route) and bool(re.search(r'(호선|선|KTX|ITX|무궁화|새마을)$', route))
        if not route:
            mode = '🚄 지하철'
        elif rail:
            mode = '🚄 지하철'
        else:
            mode = '🚌 버스'
        detail = f'{route} {fname} → {tname}' if route else f'{fname} → {tname}'
        steps.append({
            'mode': mode, 'from': fname, 'to': tname, 'detail': detail,
            'time_min': 0,
            'bus_no': '' if rail else (route or ''),
            'subway_name': route if rail else '',
        })
    if not steps:
        return None

    # 구간별 시간이 없으므로 총 소요시간을 균등 배분 (마지막 구간에 나머지)
    n = len(steps)
    base = max(0, total_min // n)
    for i, s in enumerate(steps):
        s['time_min'] = base if i < n - 1 else max(0, total_min - base * (n - 1))

    dep_min = (arrival_min - total_min) if arrival_min is not None else None
    return {
        'steps': steps,
        'total_min': total_min,
        'departure': f'{dep_min // 60:02d}:{dep_min % 60:02d}' if dep_min is not None and dep_min >= 0 else '',
        'arrival': f'{arrival_min // 60:02d}:{arrival_min % 60:02d}' if arrival_min is not None else '',
        'distance_km': dist_km,
        'source': 'seoul',
        'estimated': False,
    }
