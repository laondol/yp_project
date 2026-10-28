import html
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from math import atan2, cos, radians, sin, sqrt

import requests
from flask import current_app

BASE_URL = 'https://apis.data.go.kr/B551011/KorService2'
CACHE_TTL = 1800
CACHE = {}
HOURS_CACHE_TTL = 86400
HOURS_CACHE = {}
DETAIL_CACHE_TTL = 86400
DETAIL_CACHE = {}

OFFICIAL_PLACES = [
    {
        'content_id': '407051',
        'content_type_id': '12',
        'name': '세미원',
        'type': '관광지',
        'category': '관광지',
        'description': '경기도 양평군 양서면 양수로 93',
        'address': '경기도 양평군 양서면 양수로 93',
        'lat': 37.5406869259,
        'lng': 127.3241718422,
        'tel': '031-775-1835',
        'image_url': '',
        'source': 'official',
    },
    {
        'content_id': '128918',
        'content_type_id': '12',
        'name': '두물머리',
        'type': '관광지',
        'category': '관광지',
        'description': '경기도 양평군 양서면 두물머리길 145',
        'address': '경기도 양평군 양서면 두물머리길 145',
        'lat': 37.5336226494,
        'lng': 127.3174715039,
        'tel': '031-775-8700',
        'image_url': '',
        'source': 'official',
    },
    {
        'content_id': '2758036',
        'content_type_id': '14',
        'name': '몽양여운형기념관',
        'type': '문화시설',
        'category': '문화시설',
        'description': '경기도 양평군 양서면 몽양길 66',
        'address': '경기도 양평군 양서면 몽양길 66',
        'lat': 37.5304668546,
        'lng': 127.3735284480,
        'tel': '031-775-5600',
        'image_url': '',
        'source': 'official',
    },
    {
        'content_id': '',
        'content_type_id': '',
        'name': '608갤러리',
        'type': '갤러리',
        'category': '갤러리',
        'description': '경기도 양평군 서종면 황순원로 14',
        'address': '경기도 양평군 서종면 황순원로 14',
        'lat': 37.6007223,
        'lng': 127.3721481,
        'tel': '',
        'image_url': '',
        'source': 'official',
    },
    {
        'content_id': '',
        'content_type_id': '',
        'name': '갤러리608',
        'type': '갤러리',
        'category': '갤러리',
        'description': '경기도 양평군 서종면 중미산로 70',
        'address': '경기도 양평군 서종면 중미산로 70',
        'lat': 37.6025644,
        'lng': 127.3597223,
        'tel': '',
        'image_url': '',
        'source': 'official',
    },
    {
        'content_id': '',
        'content_type_id': '',
        'name': '갤러리서종',
        'type': '갤러리',
        'category': '갤러리',
        'description': '경기도 양평군 서종면 북한강로 991 3층',
        'address': '경기도 양평군 서종면 북한강로 991 3층',
        'lat': 37.6251545,
        'lng': 127.3540733,
        'tel': '',
        'image_url': '',
        'source': 'official',
    },
    {
        'content_id': '',
        'content_type_id': '',
        'name': '두물미오',
        'type': '갤러리/카페',
        'category': '갤러리/카페',
        'description': '경기도 양평군 서종면 북한강로 811 1동 102호',
        'address': '경기도 양평군 서종면 북한강로 811 1동 102호',
        'lat': 37.6097218,
        'lng': 127.3492657,
        'tel': '',
        'image_url': '',
        'source': 'official',
    },
    {
        'content_id': '',
        'content_type_id': '',
        'name': '기흥성뮤지엄',
        'type': '미술관',
        'category': '미술관',
        'description': '경기도 양평군 강하면 강남로 267',
        'address': '경기도 양평군 강하면 강남로 267',
        'lat': 37.4990657,
        'lng': 127.4156647,
        'tel': '',
        'image_url': '',
        'source': 'official',
    },
    {
        'content_id': '',
        'content_type_id': '',
        'name': '아트라운드1375',
        'type': '갤러리',
        'category': '갤러리',
        'description': '경기도 양평군 서종면 화서로 1375',
        'address': '경기도 양평군 서종면 화서로 1375',
        'lat': 37.6114000,
        'lng': 127.4233944,
        'tel': '',
        'image_url': '',
        'source': 'official',
    },
    {
        'content_id': '',
        'content_type_id': '',
        'name': '호기호기',
        'type': '갤러리카페',
        'category': '갤러리카페',
        'description': '경기도 양평군 용문면 말치길 9-14',
        'address': '경기도 양평군 용문면 말치길 9-14',
        'lat': 37.5486959,
        'lng': 127.6282601,
        'tel': '',
        'image_url': '',
        'source': 'official',
    },
]

CONTENT_TYPES = {
    '12': '관광지',
    '14': '문화시설',
    '15': '축제/공연',
    '25': '여행코스',
    '28': '레포츠',
    '32': '숙박',
    '38': '쇼핑',
    '39': '음식점',
}
ALLOWED_TYPES = {'12', '14', '15', '25', '28', '38'}


def _api_key():
    try:
        key = current_app.config.get('TOUR_API_KEY', '')
    except RuntimeError:
        key = ''
    return key or os.getenv('TOUR_API_KEY', '')


def _distance_km(lat1, lng1, lat2, lng2):
    r = 6371
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return r * 2 * atan2(sqrt(a), sqrt(1 - a))


def _items_from(body):
    items = body.get('items') or {}
    if not isinstance(items, dict):
        return []
    item = items.get('item') or []
    return item if isinstance(item, list) else [item]


def _plain_text(value):
    if not value:
        return ''
    text = re.sub(r'<br\s*/?>', ' / ', str(value), flags=re.I)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html.unescape(text)
    text = re.sub(r'\s*/\s*※\s*', ' / ※ ', text)
    text = re.sub(r'(?<=[가-힣0-9)])\s*※\s*', ' / ※ ', text)
    text = re.sub(r'([)\]])(?=[\[(0-9])', r'\1 ', text)
    text = re.sub(r'(?<=[가-힣0-9)])\s*-\s+', ' / ', text)
    text = re.sub(r'\s+', ' ', text).strip(' /')
    return text


def _intro_hours(item, content_type):
    content_type = str(content_type or '')
    if content_type == '14':
        hours = item.get('usetimeculture')
        closed = item.get('restdateculture')
        tel = item.get('infocenterculture')
    elif content_type == '15':
        hours = item.get('usetimefestival')
        closed = item.get('restdate')
        tel = item.get('infocenter')
    elif content_type == '38':
        hours = item.get('opentime')
        closed = item.get('restdate')
        tel = item.get('infocenter')
    else:
        hours = item.get('usetime')
        closed = item.get('restdate')
        tel = item.get('infocenter')
    return {
        'opening_hours': _plain_text(hours),
        'closed_days': _plain_text(closed),
        'tel': _plain_text(tel),
    }


def get_place_hours(content_id, content_type_id):
    content_id = str(content_id or '')
    content_type_id = str(content_type_id or '')
    if not content_id or not content_type_id:
        return {'opening_hours': '', 'closed_days': '', 'tel': ''}
    key = _api_key()
    if not key:
        return {'opening_hours': '', 'closed_days': '', 'tel': ''}

    cache_key = (content_id, content_type_id)
    now = time.time()
    cached = HOURS_CACHE.get(cache_key)
    if cached and now - cached[0] < HOURS_CACHE_TTL:
        return cached[1]

    params = {
        'serviceKey': key,
        'MobileOS': 'ETC',
        'MobileApp': 'yangpyeong',
        'contentId': content_id,
        'contentTypeId': content_type_id,
        '_type': 'json',
    }
    try:
        res = requests.get(f'{BASE_URL}/detailIntro2', params=params, timeout=10)
        res.raise_for_status()
        body = ((res.json().get('response') or {}).get('body') or {})
        items = _items_from(body)
        info = _intro_hours(items[0], content_type_id) if items else {'opening_hours': '', 'closed_days': '', 'tel': ''}
        HOURS_CACHE[cache_key] = (now, info)
        return info
    except Exception:
        return {'opening_hours': '', 'closed_days': '', 'tel': ''}


def find_official_place(content_id='', name=''):
    content_id = str(content_id or '').strip()
    name = (name or '').strip()
    for place in OFFICIAL_PLACES:
        if content_id and str(place.get('content_id') or '') == content_id:
            return dict(place)
        if name and place.get('name') == name:
            return dict(place)
    return None


def _safe_image_url(value):
    url = str(value or '').strip()
    if url.startswith('//'):
        url = 'https:' + url
    elif url.startswith('http://'):
        url = 'https://' + url[7:]
    return url if url.startswith('http') else ''


def _homepage_url(value):
    if not value:
        return ''
    match = re.search(r'https?://[^\s"\'<>]+', html.unescape(str(value)), flags=re.I)
    return _safe_image_url(match.group(0)) if match else ''


def _fetch_common_detail(content_id, content_type_id):
    key = _api_key()
    if not key or not content_id:
        return {}
    params = {
        'serviceKey': key,
        'MobileOS': 'ETC',
        'MobileApp': 'yangpyeong',
        'contentId': content_id,
        'contentTypeId': content_type_id,
        'defaultYN': 'Y',
        'firstImageYN': 'Y',
        'areacodeYN': 'Y',
        'catcodeYN': 'Y',
        'addrinfoYN': 'Y',
        'mapinfoYN': 'Y',
        'overviewYN': 'Y',
        '_type': 'json',
    }
    try:
        res = requests.get(f'{BASE_URL}/detailCommon2', params=params, timeout=12)
        res.raise_for_status()
        body = ((res.json().get('response') or {}).get('body') or {})
        items = _items_from(body)
        return items[0] if items else {}
    except Exception:
        return {}


def _fetch_detail_images(content_id):
    key = _api_key()
    if not key or not content_id:
        return []
    params = {
        'serviceKey': key,
        'MobileOS': 'ETC',
        'MobileApp': 'yangpyeong',
        'contentId': content_id,
        'imageYN': 'Y',
        'subImageYN': 'Y',
        'numOfRows': 12,
        'pageNo': 1,
        '_type': 'json',
    }
    try:
        res = requests.get(f'{BASE_URL}/detailImage2', params=params, timeout=12)
        res.raise_for_status()
        body = ((res.json().get('response') or {}).get('body') or {})
        images = []
        for item in _items_from(body):
            url = _safe_image_url(item.get('originimgurl') or item.get('smallimageurl'))
            if url and url not in images:
                images.append(url)
        return images
    except Exception:
        return []


def get_place_detail(content_id='', content_type_id='', fallback=None):
    content_id = str(content_id or '').strip()
    content_type_id = str(content_type_id or '').strip()
    fallback = dict(fallback or {})
    cache_key = (
        content_id,
        content_type_id,
        fallback.get('name') or '',
        fallback.get('lat'),
        fallback.get('lng'),
    )
    now = time.time()
    cached = DETAIL_CACHE.get(cache_key)
    if cached and now - cached[0] < DETAIL_CACHE_TTL:
        return cached[1]

    info = {
        'content_id': content_id,
        'content_type_id': content_type_id,
        'name': fallback.get('name') or '',
        'type': fallback.get('type') or CONTENT_TYPES.get(content_type_id, '명소'),
        'category': fallback.get('category') or fallback.get('type') or '',
        'address': fallback.get('address') or fallback.get('description') or '',
        'overview': '',
        'homepage': '',
        'tel': fallback.get('tel') or '',
        'opening_hours': '',
        'closed_days': '',
        'image_url': _safe_image_url(fallback.get('image_url')),
        'images': [],
        'lat': fallback.get('lat'),
        'lng': fallback.get('lng'),
        'source': 'official' if fallback else 'tour_api',
    }

    if content_id:
        common = _fetch_common_detail(content_id, content_type_id)
        if common:
            info['name'] = (common.get('title') or info['name']).strip()
            info['type'] = CONTENT_TYPES.get(content_type_id, info['type'])
            info['category'] = info['type']
            address = ' '.join(
                str(x).strip() for x in (common.get('addr1'), common.get('addr2')) if x
            ).strip()
            info['address'] = address or info['address']
            info['overview'] = _plain_text(common.get('overview'))
            info['homepage'] = _homepage_url(common.get('homepage'))
            info['tel'] = _plain_text(common.get('tel')) or info['tel']
            image_url = _safe_image_url(common.get('firstimage') or common.get('firstimage2'))
            if image_url:
                info['image_url'] = image_url
            try:
                if common.get('mapy'):
                    info['lat'] = float(common.get('mapy'))
                if common.get('mapx'):
                    info['lng'] = float(common.get('mapx'))
            except (TypeError, ValueError):
                pass

        hours = get_place_hours(content_id, content_type_id)
        info.update(hours)
        images = [info['image_url']] if info['image_url'] else []
        for url in _fetch_detail_images(content_id):
            if url not in images:
                images.append(url)
        info['images'] = images
        info['source'] = 'tour_api'

    if not info['overview']:
        info['overview'] = _plain_text(fallback.get('description'))
    if not info['tel']:
        info['tel'] = _plain_text(fallback.get('tel'))
    if not info['image_url'] and info['images']:
        info['image_url'] = info['images'][0]

    DETAIL_CACHE[cache_key] = (now, info)
    return info


def _enrich_hours(results):
    targets = [x for x in results if x.get('content_id') and x.get('content_type_id')]
    if not targets:
        return
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {
            id(x): pool.submit(get_place_hours, x['content_id'], x['content_type_id'])
            for x in targets
        }
        for x in targets:
            info = futures[id(x)].result()
            x.update(info)


def _merge_official(results, lat, lng, max_km):
    for place in OFFICIAL_PLACES:
        dist = _distance_km(lat, lng, place['lat'], place['lng'])
        if dist > max_km + 0.05:
            continue
        duplicate = any(
            x.get('name') == place['name']
            or _distance_km(x.get('lat', 0), x.get('lng', 0), place['lat'], place['lng']) < 0.05
            for x in results
        )
        if duplicate:
            continue
        item = dict(place)
        item['dist'] = round(dist, 1)
        results.append(item)


def _fetch_page(params):
    res = requests.get(f'{BASE_URL}/locationBasedList2', params=params, timeout=15)
    res.raise_for_status()
    data = res.json()
    response = data.get('response') or {}
    header = response.get('header') or {}
    if header.get('resultCode') != '0000':
        return [], 0
    body = response.get('body') or {}
    try:
        total = int(body.get('totalCount') or 0)
    except (TypeError, ValueError):
        total = 0
    return _items_from(body), total


def get_nearby_attractions(lat, lng, radius=6000, limit=None):
    key = _api_key()
    if not lat or not lng:
        return []

    cache_key = (round(lat, 3), round(lng, 3), int(radius))
    now = time.time()
    cached = CACHE.get(cache_key)
    if cached and now - cached[0] < CACHE_TTL:
        return cached[1]

    base_params = {
        'serviceKey': key,
        'MobileOS': 'ETC',
        'MobileApp': 'yangpyeong',
        'numOfRows': 100,
        'mapX': lng,
        'mapY': lat,
        'radius': radius,
        'arrange': 'E',
        '_type': 'json',
    }

    raw_items = []
    if key:
        base_params['serviceKey'] = key
        try:
            items, total = _fetch_page({**base_params, 'pageNo': 1})
            raw_items.extend(items)
            per_page = int(base_params['numOfRows'])
            pages = min(3, math.ceil(total / per_page)) if total else 1
            for page in range(2, pages + 1):
                more, _ = _fetch_page({**base_params, 'pageNo': page})
                if not more:
                    break
                raw_items.extend(more)
        except Exception:
            raw_items = []

    results = []
    seen = set()
    for item in raw_items:
        content_type = str(item.get('contenttypeid') or '')
        if content_type not in ALLOWED_TYPES:
            continue
        name = (item.get('title') or '').strip()
        if not name:
            continue
        try:
            item_lat = float(item.get('mapy'))
            item_lng = float(item.get('mapx'))
        except (TypeError, ValueError):
            continue
        if not item_lat or not item_lng:
            continue

        content_id = str(item.get('contentid') or '')
        dedupe_key = content_id or (name, round(item_lat, 5), round(item_lng, 5))
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        dist = round(_distance_km(lat, lng, item_lat, item_lng), 1)
        address = ' '.join(x for x in (item.get('addr1'), item.get('addr2')) if x).strip()
        label = CONTENT_TYPES.get(content_type, '명소')
        results.append({
            'content_id': content_id,
            'content_type_id': content_type,
            'name': name,
            'type': label,
            'category': label,
            'description': address,
            'address': address,
            'lat': round(item_lat, 6),
            'lng': round(item_lng, 6),
            'dist': dist,
            'tel': item.get('tel') or '',
            'image_url': item.get('firstimage') or item.get('firstimage2') or '',
        })

    _merge_official(results, lat, lng, radius / 1000.0)
    _enrich_hours(results)
    results.sort(key=lambda x: x['dist'])
    if limit:
        results = results[:limit]
    CACHE[cache_key] = (now, results)
    return results
