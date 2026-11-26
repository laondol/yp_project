"""서울 지하철 실시간 도착정보 (swopenapi.seoul.go.kr)

- 역명으로 다음 열차 도착(분) 조회
- 경의중앙선 양평역 등 수도권 전철 일부 포함
- 60초 캐시
"""
import os
import time
import urllib.parse

LINE_NAMES = {
    '1001': '1호선', '1002': '2호선', '1003': '3호선', '1004': '4호선',
    '1005': '5호선', '1006': '6호선', '1007': '7호선', '1008': '8호선',
    '1009': '9호선', '1063': '경의중앙선', '1065': '공항철도', '1067': '경춘선',
    '1075': '수인분당선', '1077': '신분당선', '1081': '경강선',
    '1092': '우이신설선', '1093': '신분당선',
}

_CACHE = {}
_TTL = 60
BASE = 'http://swopenapi.seoul.go.kr/api/subway/{key}/json/realtimeStationArrival/0/8/{station}'


def _key():
    key = os.getenv('SEOUL_SUBWAY_API_KEY', '')
    if key:
        return key
    try:
        from flask import current_app
        return current_app.config.get('SEOUL_SUBWAY_API_KEY', '')
    except Exception:
        return ''


def arrivals(station, limit=5, subway_ids=None):
    if not station:
        return []
    ck = (station, limit)
    hit = _CACHE.get(ck)
    if hit and hit[0] + _TTL > time.time():
        return hit[1]
    key = _key()
    if not key:
        return []
    try:
        from services import route_guard as rg
        if not rg.can_call('SEOUL_SUBWAY'):
            return []
    except Exception:
        rg = None
    try:
        import requests
        url = BASE.format(key=key, station=urllib.parse.quote(station))
        r = requests.get(url, timeout=8)
        d = r.json()
        if rg:
            rg.incr_usage('SEOUL_SUBWAY')
            rg.mark_health('SEOUL_SUBWAY', True)
    except Exception as e:
        if rg:
            rg.mark_health('SEOUL_SUBWAY', False, str(e)[:100])
        return []
    import re as _re
    rows = d.get('realtimeArrivalList') or []
    out = []
    for x in rows:
        if subway_ids and str(x.get('subwayId') or '') not in subway_ids:
            continue
        try:
            sec = int(x.get('barvlDt') or 0)
        except Exception:
            sec = 0
        msg = x.get('arvlMsg2') or ''
        mins = max(0, round(sec / 60)) if sec else None
        if mins is None and msg:
            m1 = _re.search(r'(\d+)\s*분', msg)
            m2 = _re.search(r'\[(\d+)\]\s*번째', msg)
            if m1:
                mins = int(m1.group(1))
            elif m2:
                mins = int(m2.group(1))
            elif '도착' in msg or '진입' in msg:
                mins = 0
        out.append({
            'line': x.get('subwayNm') or LINE_NAMES.get(str(x.get('subwayId') or ''), str(x.get('subwayId') or '')),
            'direction': x.get('updnLine') or '',
            'train': x.get('trainLineNm') or '',
            'dest': x.get('bstatnNm') or '',
            'min': mins,
            'msg': msg,
        })
        if len(out) >= limit:
            break
    _CACHE[ck] = (time.time(), out)
    return out
