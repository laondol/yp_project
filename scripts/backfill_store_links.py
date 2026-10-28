"""기존 approved 공유글의 GPS로 150m 내 장소 자동 연결 (store_suggestion_id 매칭)
사용: docker exec yp_flask python3 scripts/backfill_store_links.py
"""
import sys, os
sys.path.insert(0, '/yp_project')

from run import app
from models import db, ShareReport, StoreInfo, StoreSuggestion
from services.geocode import haversine

RADIUS_KM = 0.15


def main():
    with app.app_context():
        reports = ShareReport.query.filter(
            ShareReport.status == 'approved',
            ShareReport.latitude.isnot(None),
            ShareReport.store_suggestion_id.is_(None)
        ).all()
        store_infos = StoreInfo.query.all()
        suggestions = StoreSuggestion.query.all()

        linked = 0
        skipped = 0
        for r in reports:
            best = None
            best_d = RADIUS_KM + 1

            for ss in suggestions:
                if ss.lat is None or ss.lon is None:
                    continue
                d = haversine(r.latitude, r.longitude, ss.lat, ss.lon)
                if d <= RADIUS_KM and d < best_d:
                    best_d = d
                    best = ('ss', ss.id)

            if best is None:
                for si in store_infos:
                    if si.latitude is None or si.longitude is None:
                        continue
                    d = haversine(r.latitude, r.longitude, si.latitude, si.longitude)
                    if d <= RADIUS_KM and d < best_d:
                        best_d = d
                        best = ('si', None)  # StoreInfo는 ssid 없음, 위치 매칭만 확인

            if best and best[0] == 'ss':
                r.store_suggestion_id = best[1]
                linked += 1
            else:
                skipped += 1

        db.session.commit()
        print(f'[완료] 연결: {linked}건, 미연결: {skipped}건 (총 {len(reports)}건 검토)')


if __name__ == '__main__':
    main()
