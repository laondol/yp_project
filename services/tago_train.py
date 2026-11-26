"""TAGO 열차정보 (KTX/ITX 등) — 국토교통부

- 도시코드/역 목록 캐시
- 출발·도착 역명으로 열차 편 조회 (날짜 기준)
- 결과 캐시 1시간, 일일 한도 10,000회
"""
import json
import os
import time
from datetime import datetime, timedelta

from models import db, PublicDataCache

BASE = 'https://apis.data.go.kr/1613000/TrainInfo'
CACHE_KEY = 'tago_stations'
CACHE_DAYS = 30
_MEM = {}
_MEM_TTL = 3600


def _key():
    k = os.getenv('TAGO_TRAIN_API_KEY', '') or os.getenv('GG_BUS_API_KEY', '')
    if k:
        return k
    try:
        from flask import current_app
        return current_app.config.get('TAGO_TRAIN_API_KEY', '') or current_app.config.get('GG_BUS_API_KEY', '')
    except Exception:
        return ''


def _get(path, params):
    import requests
    key = _key()
    if not key:
        return None
    try:
        from services import route_guard as rg
        if not rg.can_call('TAGO_TRAIN'):
            return None
    except Exception:
        rg = None
    try:
        p = dict(params)
        p['serviceKey'] = key
        p['_type'] = 'json'
        r = requests.get(f'{BASE}/{path}', params=p, timeout=10)
        if r.status_code != 200:
            return None
        if rg:
            rg.incr_usage('TAGO_TRAIN')
            rg.mark_health('TAGO_TRAIN', True)
        return r.json()
    except Exception as e:
        if rg:
            rg.mark_health('TAGO_TRAIN', False, str(e)[:100])
        return None


def _cities():
    row = PublicDataCache.query.filter_by(key='tago_cities').first()
    if row and row.fetched_at and (datetime.now() - row.fetched_at).days < CACHE_DAYS:
        try:
            return json.loads(row.payload)
        except Exception:
            pass
    d = _get('GetCtyCodeList', {})
    items = ((d or {}).get('response', {}).get('body', {}).get('items', {}) or {}).get('item') or []
    if items:
        _save('tago_cities', items)
    return items


def _stations():
    row = PublicDataCache.query.filter_by(key=CACHE_KEY).first()
    if row and row.fetched_at and (datetime.now() - row.fetched_at).days < CACHE_DAYS:
        try:
            return json.loads(row.payload)
        except Exception:
            pass
    out = []
    for c in _cities():
        code = c.get('citycode')
        d = _get('GetCtyAcctoTrainSttnList', {'cityCode': code})
        items = ((d or {}).get('response', {}).get('body', {}).get('items', {}) or {}).get('item') or []
        out.extend(items)
    if out:
        _save(CACHE_KEY, out)
    return out


def _save(key, items):
    row = PublicDataCache.query.filter_by(key=key).first()
    payload = json.dumps(items, ensure_ascii=False)
    if row:
        row.payload = payload
        row.fetched_at = datetime.now()
    else:
        db.session.add(PublicDataCache(key=key, payload=payload))
    db.session.commit()


def _find_station(name):
    nm = (name or '').strip()
    if not nm:
        return None
    stations = _stations()
    # 정확 일치 우선, 다음 부분 일치
    for s in stations:
        if s.get('nodename') == nm:
            return s
    for s in stations:
        if nm in (s.get('nodename') or ''):
            return s
    return None


def _fmt(t):
    try:
        dt = datetime.strptime(str(t), '%Y%m%d%H%M%S')
        return dt.strftime('%H:%M')
    except Exception:
        return ''


def search_trains(dep_name, arr_name, date=None, limit=5):
    dep = _find_station(dep_name)
    arr = _find_station(arr_name)
    if not dep or not arr:
        return []
    d = (date or datetime.now().strftime('%Y%m%d')).replace('-', '')
    ck = ('train', dep['nodeid'], arr['nodeid'], d)
    hit = _MEM.get(ck)
    if hit and hit[0] + _MEM_TTL > time.time():
        return hit[1][:limit]
    data = _get('GetStrtpntAlocFndTrainInfo', {
        'depPlaceId': dep['nodeid'], 'arrPlaceId': arr['nodeid'],
        'depPlandTime': d,
    })
    items = ((data or {}).get('response', {}).get('body', {}).get('items', {}) or {}).get('item') or []
    out = []
    for x in items:
        try:
            dep_t = datetime.strptime(str(x.get('depplandtime')), '%Y%m%d%H%M%S')
            arr_t = datetime.strptime(str(x.get('arrplandtime')), '%Y%m%d%H%M%S')
            mins = int((arr_t - dep_t).total_seconds() // 60)
        except Exception:
            mins = 0
        out.append({
            'train_no': x.get('trainno'), 'grade': x.get('traingradename'),
            'from': x.get('depplacename'), 'to': x.get('arrplacename'),
            'departure': _fmt(x.get('depplandtime')), 'arrival': _fmt(x.get('arrplandtime')),
            'minutes': mins, 'fare': x.get('adultcharge'),
        })
    _MEM[ck] = (time.time(), out)
    return out[:limit]
