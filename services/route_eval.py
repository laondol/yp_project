"""경로 제공자 비교 검증 하네스

- data/route_eval_cases.json 의 기준 구간을 여러 제공자로 조회해 route_eval 에 기록
- 요약: 제공자별 성공률, 평균 소요, ODsay 대비 차이
"""
import json
import os
from datetime import datetime, timedelta

from models import db, RouteEval
from services import route_guard as rg


def load_cases():
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'route_eval_cases.json')
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _transfers(steps):
    n = 0
    for st in steps or []:
        mode = st.get('mode') or ''
        if '버스' in mode or '지하철' in mode or '전철' in mode:
            n += 1
    return max(0, n - 1)


def _walk_min(steps):
    total = 0
    for st in steps or []:
        mode = st.get('mode') or ''
        if '도보' in mode:
            try:
                total += int(st.get('time_min') or 0)
            except Exception:
                pass
    return total


def _record(case, provider, plan=None, error=''):
    plan = plan or {}
    steps = plan.get('steps') or []
    row = RouteEval(
        case_id=case.get('id', ''),
        from_name=case.get('from_name', ''),
        to_name=case.get('to_name', ''),
        provider=provider,
        total_min=int(plan.get('total_min') or 0),
        transfers=_transfers(steps),
        walk_min=_walk_min(steps),
        distance_km=float(plan.get('distance_km') or 0),
        estimated=bool(plan.get('estimated')),
        ok=bool(plan),
        error=(error or '')[:200],
    )
    db.session.add(row)
    return row


def run_case(case, providers=None):
    """한 구간을 여러 제공자로 조회해 기록"""
    from services import directions as d
    from services import seoul_transit as st
    from services import yangpyeong_bus as yb

    arr = case.get('arrive', '10:00')
    h, m = (arr.split(':') + ['0'])[:2]
    arrival_min = int(h) * 60 + int(m)

    kw = dict(
        naver_id=os.getenv('NAVER_CLIENT_ID'),
        naver_secret=os.getenv('NAVER_CLIENT_SECRET'),
        odsay_key=os.getenv('ODSAY_API_KEY'),
        google_key=os.getenv('GOOGLE_MAPS_API_KEY'),
    )
    lat1, lng1 = case['from_lat'], case['from_lng']
    lat2, lng2 = case['to_lat'], case['to_lng']
    names = (case.get('from_name', ''), case.get('to_name', ''))

    todo = providers or ['odsay', 'seoul', 'train', 'yp_bus', 'estimate']
    rows = []
    for p in todo:
        try:
            if p == 'odsay':
                if not rg.can_call('ODSAY'):
                    rows.append(_record(case, 'odsay', error='quota'))
                    continue
                plan = d.odsay_transit(lat1, lng1, lat2, lng2, kw['odsay_key'], arrival_min)
                plan = plan or {}
                if plan.get('total_min'):
                    dep = arrival_min - plan['total_min']
                    plan['departure'] = f'{dep // 60:02d}:{dep % 60:02d}' if dep >= 0 else ''
                    plan['arrival'] = arr
                rows.append(_record(case, 'odsay', plan, '' if plan else 'no_result'))
            elif p == 'seoul':
                plan = st.plan(lat1, lng1, lat2, lng2, arrival_min) or {}
                rows.append(_record(case, 'seoul', plan, '' if plan else 'not_seoul_or_no_result'))
            elif p == 'naver':
                plan = d.naver_transit(lat1, lng1, lat2, lng2, kw['naver_id'], kw['naver_secret'], arrival_min) or {}
                rows.append(_record(case, 'naver', plan, '' if plan else 'no_result'))
            elif p == 'train':
                from services.tago_train import search_trains
                trains = search_trains(names[0], names[1], case.get('date'))
                if trains:
                    t0 = trains[0]
                    plan = {
                        'steps': [{'mode': f"🚄 {t0.get('grade') or '열차'}", 'from': t0.get('from'),
                                   'to': t0.get('to'),
                                   'detail': f"{t0.get('grade')} {t0.get('departure')}→{t0.get('arrival')} ({t0.get('minutes')}분, {t0.get('fare')}원)",
                                   'time_min': t0.get('minutes') or 0}],
                        'total_min': t0.get('minutes') or 0,
                        'distance_km': 0,
                        'departure': t0.get('departure'), 'arrival': t0.get('arrival'),
                        'source': 'train', 'estimated': False,
                    }
                else:
                    plan = {}
                rows.append(_record(case, 'train', plan, '' if plan else 'no_train'))
            elif p == 'yp_bus':
                from services.directions import haversine_km as _hk
                _km = _hk(lat1, lng1, lat2, lng2)
                plan = yb.plan(names[0], names[1], arrival_min, direct_km=_km) or {}
                rows.append(_record(case, 'yp_bus', plan, '' if plan else 'no_route'))
            elif p == 'estimate':
                from services.directions import _estimate_plan, haversine_km
                km = haversine_km(lat1, lng1, lat2, lng2)
                plan = _estimate_plan(names[0], names[1], km, arrival_min)
                plan['source'] = 'estimate'
                plan['estimated'] = True
                rows.append(_record(case, 'estimate', plan))
        except Exception as e:
            rows.append(_record(case, p, error=str(e)))
    db.session.commit()
    return len(rows)


def run_all(limit=None, providers=None, ids_prefix=None):
    cases = load_cases()
    if ids_prefix:
        cases = [c for c in cases if str(c.get('id', '')).startswith(ids_prefix)]
    if limit:
        cases = cases[:int(limit)]
    n = 0
    for c in cases:
        n += run_case(c, providers=providers)
    return {'cases': len(cases), 'rows': n}


def summary(days=30):
    since = datetime.now() - timedelta(days=int(days))
    rows = RouteEval.query.filter(RouteEval.created_at >= since).all()
    by_case = {}
    latest = {}
    for r in rows:
        key = (r.case_id, r.provider)
        if key not in latest or (r.created_at and latest[key].created_at and r.created_at > latest[key].created_at):
            latest[key] = r
    for (cid, prov), r in latest.items():
        by_case.setdefault(cid, {})[prov] = r

    latest_rows = list(latest.values())
    providers = sorted({r.provider for r in latest_rows})
    out = []
    for p in providers:
        rs = [r for r in latest_rows if r.provider == p]
        ok = [r for r in rs if r.ok]
        diffs = []
        for cid, pmap in by_case.items():
            base = pmap.get('odsay')
            cur = pmap.get(p)
            if base and cur and base.ok and cur.ok and cur.provider != 'odsay':
                diffs.append(cur.total_min - base.total_min)
        out.append({
            'provider': p,
            'runs': len(rs),
            'ok': len(ok),
            'success_rate': round(len(ok) / len(rs) * 100, 1) if rs else 0,
            'avg_total': round(sum(r.total_min for r in ok) / len(ok), 1) if ok else 0,
            'avg_diff_vs_odsay': round(sum(diffs) / len(diffs), 1) if diffs else None,
            'estimated_rate': round(sum(1 for r in ok if r.estimated) / len(ok) * 100, 1) if ok else 0,
        })
    return {'days': int(days), 'cases': len(by_case), 'providers': out}
