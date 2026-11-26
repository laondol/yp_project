"""양평 버스 시간표 경유지 좌표 수집 (자체 경로엔진 1단계)

- bus_stop_map(1,143개) 우선 매칭
- 미매칭 경유지는 카카오 키워드/주소 검색 → 네이버 주소 검색 순으로 좌표 확보
- 결과는 transit_stop_geo 테이블에 저장 (name_key 기준 upsert)

실행: docker exec -i yp_flask python3 /app/scripts/geocode_transit_stops.py
"""
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests

from run import app
from models import db, BusStopMap, TransitStopGeo
from services import yangpyeong_bus as yb

# 양평군 대략 경계 (여주/홍천/가평 오매칭 방지)
LAT_MIN, LAT_MAX = 37.35, 37.70
LNG_MIN, LNG_MAX = 127.27, 127.85


from services.transit_graph import stop_key as name_key, match_key  # noqa: E402


def route_stop_names():
    """시간표 데이터의 전체 경유지 이름 (표시용 원본 + key)"""
    out = {}
    for row in yb.fetch_routes():
        seq = [row.get('기점')]
        seq += [x.strip() for x in (row.get('경유지') or '').split(',') if x.strip()]
        seq.append(row.get('종점'))
        for n in seq:
            if not (n or '').strip():
                continue
            k = name_key(n)
            if k and k not in out:
                out[k] = n.strip()
    return out


def in_yangpyeong(lat, lng):
    return LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX


def kakao_search(name, key):
    """키워드 검색 → 양평 경계 내 결과만 채택"""
    for q in (f'양평 {name}', f'경기 양평군 {name}'):
        try:
            r = requests.get('https://dapi.kakao.com/v2/local/search/keyword.json',
                             headers={'Authorization': f'KakaoAK {key}'},
                             params={'query': q, 'size': 5}, timeout=8)
            if r.status_code != 200:
                continue
            for doc in (r.json().get('documents') or []):
                try:
                    lat, lng = float(doc['y']), float(doc['x'])
                except Exception:
                    continue
                if in_yangpyeong(lat, lng):
                    return lat, lng, 'kakao_keyword'
        except Exception:
            continue
    return None


def naver_address(name, naver_id, naver_secret):
    for q in (f'경기도 양평군 {name}', f'경기 양평군 {name}'):
        try:
            r = requests.get('https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode',
                             headers={'X-NCP-APIGW-API-KEY-ID': naver_id,
                                      'X-NCP-APIGW-API-KEY': naver_secret},
                             params={'query': q}, timeout=8)
            if r.status_code != 200:
                continue
            for a in (r.json().get('addresses') or []):
                lat, lng = float(a['y']), float(a['x'])
                if in_yangpyeong(lat, lng):
                    return lat, lng, 'naver_address'
        except Exception:
            continue
    return None


def main():
    kakao_key = os.getenv('KAKAO_REST_API_KEY', '')
    naver_id = os.getenv('NAVER_SEARCH_CLIENT_ID', '') or os.getenv('NAVER_CLIENT_ID', '')
    naver_secret = os.getenv('NAVER_SEARCH_CLIENT_SECRET', '') or os.getenv('NAVER_CLIENT_SECRET', '')

    with app.app_context():
        names = route_stop_names()

        # 1) bus_stop_map 좌표 (이름 평균)
        stop_pts = {}
        loose = {}
        for s in BusStopMap.query.all():
            if not (s.lat and s.lng):
                continue
            k = name_key(s.name)
            if not k:
                continue
            stop_pts.setdefault(k, []).append((s.lat, s.lng))
            loose.setdefault(match_key(s.name), []).append((s.lat, s.lng))

        existing = {r.name_key: r for r in TransitStopGeo.query.all()}
        inserted = updated = skipped = 0
        missing = []

        for k, display in names.items():
            pts = stop_pts.get(k)
            if not pts:
                cand = loose.get(match_key(display)) or []
                if len(cand) == 1:
                    pts = cand
            if pts:
                lat = sum(p[0] for p in pts) / len(pts)
                lng = sum(p[1] for p in pts) / len(pts)
                src = 'bus_stop_map'
            else:
                row = existing.get(k)
                if row and row.source != 'missing' and row.lat:
                    skipped += 1
                    continue
                geo = None
                if kakao_key:
                    geo = kakao_search(display, kakao_key)
                if not geo and naver_id and naver_secret:
                    geo = naver_address(display, naver_id, naver_secret)
                if geo:
                    lat, lng, src = geo
                else:
                    lat = lng = None
                    src = 'missing'
                    missing.append(display)

            row = existing.get(k)
            if row:
                row.name = display[:100]
                row.lat, row.lng, row.source = lat, lng, src
                updated += 1
            else:
                db.session.add(TransitStopGeo(name_key=k, name=display[:100],
                                              lat=lat, lng=lng, source=src))
                inserted += 1
            db.session.flush()
            if src in ('kakao_keyword', 'naver_address'):
                time.sleep(0.08)
        db.session.commit()

        total = TransitStopGeo.query.count()
        ok = TransitStopGeo.query.filter(TransitStopGeo.lat.isnot(None)).count()
        print(f'[geocode] 전체 {len(names)} · 신규 {inserted} · 갱신 {updated} · 스킵 {skipped}')
        print(f'[geocode] 저장 {total}건 (좌표 {ok}건, 미확보 {total - ok}건)')
        if missing:
            print('[geocode] 좌표 미확보:', ', '.join(missing[:20]))


if __name__ == '__main__':
    main()
