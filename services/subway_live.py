"""지하철 실시간 도착을 경로 대기시간에 반영"""
from services.seoul_subway import arrivals

LINE_IDS = {
    '1호선': '1001', '2호선': '1002', '3호선': '1003', '4호선': '1004',
    '5호선': '1005', '6호선': '1006', '7호선': '1007', '8호선': '1008',
    '9호선': '1009', '경의중앙선': '1063', '공항철도': '1065', '경춘선': '1067',
    '수인분당선': '1075', '신분당선': '1077', '경강선': '1081',
    '우이신설선': '1092',
}
BASE_WAIT = 3  # 실시간 정보가 없을 때 가정하는 기본 대기(분)


def _line_id(name):
    name = (name or '').strip()
    if name in LINE_IDS:
        return LINE_IDS[name]
    for k, v in LINE_IDS.items():
        if k in name:
            return v
    return None


def adjust_plan(plan):
    """지하철 구간의 대기를 실시간 도착으로 보정 (총 소요·출발시각 갱신)"""
    if not plan or not plan.get('steps'):
        return plan
    delta_total = 0
    for st in plan['steps']:
        mode = st.get('mode') or ''
        if not ('지하철' in mode or '전철' in mode or '🚇' in mode):
            continue
        station = (st.get('from') or '').strip()
        if not station:
            continue
        sid = _line_id(st.get('subway_name') or '')
        try:
            rows = arrivals(station, limit=5, subway_ids={sid} if sid else None)
        except Exception:
            rows = []
        mins = [r.get('min') for r in rows if isinstance(r.get('min'), int)]
        if not mins:
            continue
        wait = max(0, min(min(mins), 15))
        st['live_wait_min'] = wait
        note = f" (실시간 {wait}분 후)"
        if note not in (st.get('detail') or ''):
            st['detail'] = (st.get('detail') or '') + note
        delta_total += wait - BASE_WAIT

    if delta_total:
        plan['total_min'] = max(1, int(plan.get('total_min') or 0) + delta_total)
        dep = plan.get('departure') or ''
        try:
            hh, mm = dep.split(':')[:2]
            total = int(hh) * 60 + int(mm) - delta_total
            if total < 0:
                total += 24 * 60
            plan['departure'] = f'{total // 60:02d}:{total % 60:02d}'
        except Exception:
            pass
        plan['realtime_adjusted'] = True
    return plan
