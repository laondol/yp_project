import sys
import os
from dotenv import load_dotenv

# 프로젝트 루트를 경로에 추가 (어디서 실행하든 동작)
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)
load_dotenv(os.path.join(_ROOT, '.env'))

from flask import Flask
from config import Config
from models import db, ShareReport
from services.geocode import gps_to_town_village, gps_to_address, YANGPYEONG_BOUNDS, YANGPYEONG_VILLAGES

VALID_TOWNS = set(YANGPYEONG_BOUNDS)


def is_bad(row):
    """저장된 지명이 명백히 잘못된 경우(비양평 읍면이 town이거나, 뒤섞인 리) True."""
    if not row.town and not row.address:
        return False
    # town 이 양평 읍면이 아니면 잘못된 역지오코딩 결과
    if row.town and row.town not in VALID_TOWNS:
        return True
    # town 은 양평이지만 village 가 해당 읍면의 리 목록에 없으면 뒤섞인 값
    if row.town in YANGPYEONG_VILLAGES and row.village:
        if row.village not in YANGPYEONG_VILLAGES[row.town]:
            return True
    return False


def main():
    dry = '--dry' in sys.argv
    app = Flask(__name__)
    app.config.from_object(Config)
    db.init_app(app)
    with app.app_context():
        rows = ShareReport.query.filter(
            ShareReport.latitude.isnot(None),
            ShareReport.longitude.isnot(None),
        ).all()
        changed = 0
        skipped = 0
        for r in rows:
            if not is_bad(r):
                skipped += 1
                continue
            new_town, new_village = gps_to_town_village(r.latitude, r.longitude)
            new_address = gps_to_address(r.latitude, r.longitude)
            if not new_town:
                print(f"  [#{r.id}] 지오코딩 실패, 유지: {r.address!r}")
                continue
            print(f"  [#{r.id}] {r.address!r}")
            print(f"        -> {new_address!r} (town={new_town}, village={new_village})")
            if dry:
                continue
            r.town = new_town
            r.village = new_village
            r.address = new_address or r.address
            changed += 1
        if not dry:
            db.session.commit()
        print(f"\n[완료] 수정 {changed}건 / 그대로 둠 {skipped}건{' (dry-run, 반영 안 함)' if dry else ''}")


if __name__ == '__main__':
    main()
