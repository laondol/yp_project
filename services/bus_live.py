"""버스 실시간 도착을 경로 대기시간에 반영 (TAGO 정밀 도착)"""
from services import tago_arrival as ta

BASE_WAIT = 3


def adjust_plan(plan):
    if not plan or not plan.get('steps'):
        return plan
    delta = 0
    for st in plan['steps']:
        mode = st.get('mode') or ''
        if '버스' not in mode:
            continue
        stop_name = (st.get('from') or '').strip()
        # '정류장(노선)' 형태에서 정류장명만 추출
        if '(' in stop_name and stop_name.endswith(')'):
            stop_name = stop_name.split('(')[0].strip()
        m = ta.find_map(stop_name)
        if not m:
            continue
        rows = ta.arrivals(m.city_code, m.node_id)
        if not rows:
            continue
        bus_no = (st.get('bus_no') or '').replace('번', '').strip()
        route_rows = [r for r in rows if bus_no and r['route'] == bus_no] or rows
        wait = max(0, min(route_rows[0]['min'], 90))
        st['live_wait_min'] = wait
        note = f" (실시간 {wait}분 후)"
        if note not in (st.get('detail') or ''):
            st['detail'] = (st.get('detail') or '') + note
        delta += wait - BASE_WAIT
    if delta:
        plan['total_min'] = max(1, int(plan.get('total_min') or 0) + delta)
        dep = plan.get('departure') or ''
        try:
            hh, mm = dep.split(':')[:2]
            total = int(hh) * 60 + int(mm) - delta
            if total < 0:
                total += 24 * 60
            plan['departure'] = f'{total // 60:02d}:{total % 60:02d}'
        except Exception:
            pass
        plan['bus_realtime_adjusted'] = True
    return plan
