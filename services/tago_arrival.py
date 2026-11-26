"""TAGO 정류소별 실시간 도착예정 (ArvlInfoInqireService)"""
import os
import time
from models import BusStopMap

_CACHE = {}
_TTL = 20
BASE = 'https://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList'


def _key():
    return os.getenv('TAGO_TRAIN_API_KEY', '') or os.getenv('GG_BUS_API_KEY', '')


def arrivals(city_code, node_id, limit=10):
    if not city_code or not node_id:
        return []
    ck = (city_code, node_id)
    hit = _CACHE.get(ck)
    if hit and hit[0] + _TTL > time.time():
        return hit[1][:limit]
    key = _key()
    if not key:
        return []
    try:
        from services import route_guard as rg
        if not rg.can_call('TAGO_ARRIVAL'):
            return []
    except Exception:
        rg = None
    try:
        import requests
        r = requests.get(BASE, params={
            'serviceKey': key, 'cityCode': city_code, 'nodeId': node_id,
            'pageNo': 1, 'numOfRows': 20, '_type': 'json',
        }, timeout=8)
        d = r.json()
        if rg:
            rg.incr_usage('TAGO_ARRIVAL')
            rg.mark_health('TAGO_ARRIVAL', True)
    except Exception as e:
        if rg:
            rg.mark_health('TAGO_ARRIVAL', False, str(e)[:100])
        return []
    items = ((d.get('response') or {}).get('body') or {}).get('items') or []
    if isinstance(items, str):
        items = []
    if isinstance(items, dict):
        items = items.get('item') or [] if 'routeno' not in items else [items]
    if isinstance(items, dict):
        items = [items]
    out = []
    for x in items:
        try:
            sec = int(x.get('arrtime') or 0)
        except Exception:
            sec = 0
        out.append({
            'route': str(x.get('routeno') or ''),
            'min': max(0, round(sec / 60)) if sec else 0,
            'stops_left': x.get('arrprevstationcnt'),
            'vehicle': x.get('vehicletp') or '',
            'node': x.get('nodeid'),
            'name': x.get('nodenm'),
        })
    out.sort(key=lambda z: z['min'])
    _CACHE[ck] = (time.time(), out)
    return out[:limit]


def find_map(name):
    if not name:
        return None
    nm = name.strip()
    row = BusStopMap.query.filter_by(name=nm).first()
    if row:
        return row
    for r in BusStopMap.query.all():
        if r.name and (nm in r.name or r.name in nm):
            return r
    return None
