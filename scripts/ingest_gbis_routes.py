"""경기도 버스노선(GBIS) 적재

- 양평 시간표에 등장하는 노선번호를 GBIS에서 조회해 노선ID·경유정류소(좌표)를 DB에 저장
- 실행: docker exec -i yp_flask python3 /yp_project/scripts/ingest_gbis_routes.py
- 일일 트래픽(기능별 1,000회) 보호를 위해 결과는 캐시 후 재사용
"""
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from run import app
from models import db, GbisRoute, GbisRouteStop
from services import gbis_route as gb
from services import yangpyeong_bus as yb

YP = (37.35, 37.70, 127.27, 127.85)  # 양평 대략 경계


def in_yp(lat, lng):
    return YP[0] <= lat <= YP[1] and YP[2] <= lng <= YP[3]


def route_numbers():
    nums = set()
    for row in yb.fetch_routes():
        n = (row.get('노선번호') or '').strip('[] ')
        if n:
            nums.add(n)
    try:
        from services import transit_graph as tg
        g = tg.build_graph()
        for r in g['routes']:
            if r.get('no'):
                nums.add(str(r['no']))
    except Exception:
        pass
    return sorted(nums)


def upsert_route(r):
    row = GbisRoute.query.filter_by(route_id=r['route_id']).first()
    if not row:
        row = GbisRoute(route_id=r['route_id'])
        db.session.add(row)
    info = gb.route_info(r['route_id']) or {}
    row.route_name = r.get('route_name') or info.get('route_name') or ''
    row.route_type = r.get('route_type') or info.get('route_type') or ''
    row.start_name = r.get('start_name') or info.get('start_name') or ''
    row.end_name = r.get('end_name') or info.get('end_name') or ''
    row.region = r.get('region') or ''
    row.admin = r.get('admin') or ''
    row.first_time = info.get('up_first') or ''
    row.last_time = info.get('up_last') or ''
    try:
        row.peak_alloc = int(info.get('peak_alloc') or 0)
    except Exception:
        row.peak_alloc = 0
    row.company = info.get('company') or ''
    return row


def main():
    extra = [x.strip() for x in (sys.argv[1] if len(sys.argv) > 1 else '').split(',') if x.strip()]
    with app.app_context():
        numbers = sorted(set(route_numbers()) | set(extra))
        print(f'[gbis] 노선번호 후보 {len(numbers)}개')
        added = 0
        for i, num in enumerate(numbers, 1):
            if gb.quota_blocked():
                print('[gbis] 일일 한도 초과 → 오늘 적재 중단 (내일 자동 재개)')
                break
            try:
                routes = gb.route_list(num)
            except Exception as e:
                print('  list error', num, e)
                continue
            for r in routes:
                # 양평 지역 노선만 적재 (지역명 또는 시/종점 좌표 기준)
                stops = gb.route_stations(r['route_id'])
                if not stops:
                    continue
                hit = sum(1 for s in stops if in_yp(s['lat'], s['lng']))
                if r.get('region') != '양평' and hit < 1:
                    continue
                row = upsert_route(r)
                GbisRouteStop.query.filter_by(route_id=r['route_id']).delete()
                for s in stops:
                    db.session.add(GbisRouteStop(
                        route_id=r['route_id'], seq=s['seq'], station_id=s['station_id'],
                        name=s['name'][:100], lat=s['lat'], lng=s['lng']))
                added += 1
                print(f'  [{i}/{len(numbers)}] {r["route_name"]} ({r["route_id"]}) 정류소 {len(stops)}개 적재')
                db.session.commit()
                time.sleep(0.05)
        print(f'[gbis] 적재 노선 {added}개')
        print(f'[gbis] DB 노선 {GbisRoute.query.count()} · 정류소 {GbisRouteStop.query.count()}')


if __name__ == '__main__':
    main()
