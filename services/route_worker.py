# route_worker: 경로 재계산 백그라운드 실행 (스레드 우선 + 요청 외부 실행)
import threading
import traceback
from flask import current_app
import services.route_recalc as rc

def _run(uid, app, days=None):
    try:
        if app is not None:
            with app.app_context():
                if days:
                    rc.recalc_user_days(uid, days)
                else:
                    rc.recalc_user_routes(uid)
        else:
            if days:
                rc.recalc_user_days(uid, days)
            else:
                rc.recalc_user_routes(uid)
    except Exception:
        traceback.print_exc()

def enqueue_recalc(uid, days=None):
    """요청 스레드 밖에서 백그라운드로 사용자 경로 재계산 (스레드 우선).
    days 가 주어지면 해당 날짜만 (모일정 삭제 반영용)."""
    try:
        app = current_app._get_current_object()
    except Exception:
        app = None
    t = threading.Thread(target=_run, args=(uid, app, days), daemon=True)
    t.start()
    return t
