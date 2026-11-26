"""양평군 버스정류장 → BusStopMap 자동 등록
- 국토교통부 전국 버스정류장 위치정보(odcloud) 사용
- 도시명 '경기도 양평군' 필터
"""
import sys
sys.path.insert(0, '/yp_project')

from run import app
from models import db, BusStopMap
import os, requests

DATASET = 'https://api.odcloud.kr/api/15067528/v1/uddi:ed6af349-4869-4c9a-82e1-82ecc32c686e'


def main():
    key = os.getenv('ODCLOUD_API_KEY', '')
    if not key:
        print('ODCLOUD_API_KEY 없음'); return
    rows = []
    page = 1
    while page <= 20:
        r = requests.get(DATASET, params={
            'page': page, 'perPage': 1000, 'returnType': 'json', 'serviceKey': key,
            'cond[도시명::EQ]': '경기도 양평군',
        }, timeout=30)
        data = (r.json().get('data') or [])
        rows.extend(data)
        print(f'page {page}: {len(data)}')
        if len(data) < 1000:
            break
        page += 1

    saved = 0
    with app.app_context():
        for x in rows:
            nid = (x.get('정류장번호') or '').strip()
            if not nid:
                continue
            cc = str(x.get('도시코드') or '31380')
            row = BusStopMap.query.filter_by(city_code=cc, node_id=nid).first()
            if not row:
                row = BusStopMap(city_code=cc, node_id=nid)
                db.session.add(row)
            row.name = (x.get('정류장명') or '').strip()
            try:
                row.lat = float(x.get('위도') or 0) or None
                row.lng = float(x.get('경도') or 0) or None
            except Exception:
                pass
            saved += 1
        db.session.commit()
        print('SAVED', saved, 'TOTAL', BusStopMap.query.count())


if __name__ == '__main__':
    main()
