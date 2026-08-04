import requests, math, json, time, os
from math import radians, sin, cos, sqrt, atan2

# In-process TTL cache for ODSay routing results (saves the 1,000 calls/day quota).
_ODSAY_CACHE = {}
_ODSAY_CACHE_TTL = 24 * 3600

def _odsay_cache_key(fy, fx, ty, tx):
    return (round(fy, 5), round(fx, 5), round(ty, 5), round(tx, 5))

def _odsay_cache_get(fy, fx, ty, tx):
    hit = _ODSAY_CACHE.get(_odsay_cache_key(fy, fx, ty, tx))
    if hit and (hit[0] + _ODSAY_CACHE_TTL) > time.time():
        return hit[1], hit[2], hit[3]
    return None

def _odsay_cache_set(fy, fx, ty, tx, steps, total_min, dist):
    _ODSAY_CACHE[_odsay_cache_key(fy, fx, ty, tx)] = (time.time(), steps, total_min, dist)

def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng/2)**2
    return R * 2 * atan2(sqrt(a), sqrt(1-a))

STATIONS = [
    {"name":"양평역","lat":37.4918,"lng":127.4913,"line":"경의중앙선","toward_seoul":["05:30","23:10"],"toward_jipyeong":["05:50","00:10"]},
    {"name":"용문역","lat":37.4815,"lng":127.5946,"line":"경의중앙선","toward_seoul":["05:10","22:50"],"toward_jipyeong":["06:10","00:20"]},
    {"name":"옥천역","lat":37.5180,"lng":127.5083,"line":"경의중앙선","toward_seoul":["05:40","23:30"],"toward_jipyeong":["05:40","00:00"]},
    {"name":"지평역","lat":37.4460,"lng":127.6210,"line":"경의중앙선","toward_seoul":["05:00","22:40"],"toward_jipyeong":["06:20","00:25"]},
    {"name":"원덕역","lat":37.4900,"lng":127.5050,"line":"경의중앙선","toward_seoul":["05:35","23:15"],"toward_jipyeong":["05:55","00:14"]},
    {"name":"아신역","lat":37.5134,"lng":127.5105,"line":"경의중앙선","toward_seoul":["05:38","23:25"],"toward_jipyeong":["05:45","00:05"]},
]

YANGPYEONG_BUS_ROUTES = [
    {"name":"1번","stops":[{"name":"문호리","lat":37.583,"lng":127.405},{"name":"양수리","lat":37.545,"lng":127.325},{"name":"양평터미널","lat":37.488,"lng":127.492}]},
    {"name":"1-1번","stops":[{"name":"문호리","lat":37.583,"lng":127.405},{"name":"양수역","lat":37.555,"lng":127.342},{"name":"양평터미널","lat":37.488,"lng":127.492}]},
    {"name":"2번","stops":[{"name":"양평터미널","lat":37.488,"lng":127.492},{"name":"양평역","lat":37.4918,"lng":127.4913},{"name":"용문","lat":37.481,"lng":127.594}]},
    {"name":"2-2번","stops":[{"name":"양평터미널","lat":37.488,"lng":127.492},{"name":"옥천","lat":37.518,"lng":127.508},{"name":"용문","lat":37.481,"lng":127.594}]},
    {"name":"3번","stops":[{"name":"양평터미널","lat":37.488,"lng":127.492},{"name":"아신","lat":37.513,"lng":127.510},{"name":"서종","lat":37.583,"lng":127.415}]},
    {"name":"3-1번","stops":[{"name":"양평터미널","lat":37.488,"lng":127.492},{"name":"양서","lat":37.540,"lng":127.360},{"name":"서종","lat":37.583,"lng":127.415}]},
    {"name":"3-2번","stops":[{"name":"양평터미널","lat":37.488,"lng":127.492},{"name":"양수리","lat":37.545,"lng":127.325}]},
    {"name":"4번","stops":[{"name":"양평터미널","lat":37.488,"lng":127.492},{"name":"강상","lat":37.470,"lng":127.500},{"name":"강하","lat":37.495,"lng":127.430}]},
    {"name":"5번","stops":[{"name":"양평터미널","lat":37.488,"lng":127.492},{"name":"개군","lat":37.395,"lng":127.550}]},
    {"name":"6번","stops":[{"name":"양평터미널","lat":37.488,"lng":127.492},{"name":"지평","lat":37.440,"lng":127.615},{"name":"용문","lat":37.481,"lng":127.594}]},
    {"name":"6-1번","stops":[{"name":"양평터미널","lat":37.488,"lng":127.492},{"name":"양동","lat":37.420,"lng":127.660}]},
    {"name":"7번","stops":[{"name":"양평터미널","lat":37.488,"lng":127.492},{"name":"단월","lat":37.560,"lng":127.660}]},
    {"name":"7-1번","stops":[{"name":"양평터미널","lat":37.488,"lng":127.492},{"name":"청운","lat":37.540,"lng":127.715}]},
    {"name":"8번","stops":[{"name":"용문","lat":37.481,"lng":127.594},{"name":"지평","lat":37.440,"lng":127.615},{"name":"양동","lat":37.420,"lng":127.660}]},
    {"name":"8-1번","stops":[{"name":"용문","lat":37.481,"lng":127.594},{"name":"단월","lat":37.560,"lng":127.660}]},
    {"name":"9번","stops":[{"name":"양평터미널","lat":37.488,"lng":127.492},{"name":"양수리","lat":37.545,"lng":127.325},{"name":"서종","lat":37.583,"lng":127.415}]},
]

WALK_SPEED = 5  # km/h
BUS_SPEED = 20  # km/h

# 경의중앙선 역명 → ODSay stationID (시간표 조회용, 실제 검증된 ID)
ODSAY_STATION_IDS = {
    "양수": 1306, "신원": 1305, "국수": 1304, "아신": 1303,
    "양평": 1302, "원덕": 1301, "용문": 1300, "지평": 1299,
    "오빈": 1394, "도심": 1309, "팔당": 1308, "운길산": 1307,
    "용산": 1318, "왕십리": 192, "청량리": 191,
}

_ODSAY_TT_CACHE = {}
_ODSAY_TT_TTL = 24 * 3600

def _odsay_tt_key(station_id, way, week):
    return (station_id, way, week)

def odsay_station_timetable(station_id, way_code=1, week_tag=1, api_key=None):
    """ODSay 지하철역 전체 시간표 조회. weekTag: 1 평일 / 2 토요일 / 3 일요일.
    wayCode: 1 상행(서울 방면), 2 하행. 역명-기차시각-종착역 목록을 반환."""
    if not api_key:
        return None
    ck = _odsay_tt_key(station_id, way_code, week_tag)
    hit = _ODSAY_TT_CACHE.get(ck)
    if hit and (hit[0] + _ODSAY_TT_TTL) > time.time():
        return hit[1]
    try:
        resp = requests.get("https://api.odsay.com/v1/api/subwayTimeTable",
            params={"apiKey": api_key, "stationID": station_id, "wayCode": way_code,
                    "showExpressTime": "1", "lang": "0"}, timeout=8)
        data = resp.json()
    except Exception:
        return None
    result = (data or {}).get("result") or {}
    key = {1: "OrdList", 2: "SatList", 3: "SunList"}.get(week_tag, "OrdList")
    lst = (result.get(key) or {}).get("up" if way_code == 1 else "down") or {}
    out = []
    try:
        for tm in lst.get("time") or []:
            hour = int(tm.get("Idx") or 0)
            if hour >= 25: hour -= 24
            # 완행(list) + 급행(expList) 모두 파싱, 급행은 express 표시
            for token, is_exp in [(t, False) for t in (tm.get("list") or "").split(" ")] + \
                                 [(t, True) for t in (tm.get("expList") or "").split(" ")]:
                token = token.strip()
                if not token: continue
                if "(" in token:
                    minute, end = token.split("(")[0], token.split("(")[1].rstrip(")")
                else:
                    minute, end = token, ""
                try:
                    out.append({"time": f"{hour:02d}:{minute}", "end": end,
                                "express": bool(is_exp)})
                except Exception:
                    continue
    except Exception:
        return None
    out.sort(key=lambda x: x["time"])
    _ODSAY_TT_CACHE[ck] = (time.time(), out)
    return out


def _hm(t):
    try:
        h, m = t.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return 0


def _clean_station_name(s):
    """AI/사용자가 표기한 역명에서 노선명·접미사를 제거해 역명만 추출.
    예) '경의중앙선 운길산역' -> '운길산', '수인분당선(수원행) 양수역' -> '양수'"""
    s = (s or "").strip()
    # 괄호 내용 제거 (방향/행선지)
    import re as _re
    s = _re.sub(r"[\(（\[].*?[\)）\]]", "", s)
    s = s.rstrip("역").strip()
    # 노선명 접두어 제거 (경의중앙선/수인분당선/수도권 등)
    for pre in ("경의중앙선", "수인분당선", "분당선", "경의선", "중앙선", "수인선", "수도권",
                "4호선", "3호선", "2호선", "1호선", "5호선", "6호선", "7호선", "8호선",
                "9호선", "공항철도", "GTX", "신분당선", "우이신설선", "서해선", "경춘선", "경강선"):
        if s.startswith(pre):
            s = s[len(pre):].strip()
            break
    return s

def next_trains_for_station(station_name, after_min=None, direction="up", api_key=None):
    """역명(경의중앙선) 기준으로 도착 시각(after_min, 기본 현재+0분) 전후로 탈 수 있는 기차 반환.
    전거 1개 + 후거 2개 = 총 3개. 급행/완행 구분 포함."""
    sid = ODSAY_STATION_IDS.get((station_name or "").rstrip("역"))
    if not sid:
        sid = ODSAY_STATION_IDS.get(_clean_station_name(station_name))
    if not sid:
        return None
    import datetime as _dt
    now = _dt.datetime.now()
    if after_min is None:
        after_min = now.hour * 60 + now.minute
    weekday = now.weekday()
    week_tag = 1 if weekday < 5 else (2 if weekday == 5 else 3)
    tt = odsay_station_timetable(sid, 1 if direction == "up" else 2, week_tag, api_key)
    if not tt:
        return None
    # 마지막 운행이면 다음날 새벽(0시~1시대) 운행도 후거에 포함 가능하도록 1440 더한 목록 고려
    extended = [t for t in tt] + [{"time": _min_to_hm(_hm(t["time"]) + 1440), "end": t["end"], "express": t.get("express", False)} for t in tt]
    target = after_min
    before, after = None, None
    best_before, best_after = -10**9, 10**9
    for t in extended:
        v = _hm(t["time"])
        if v <= target and v > best_before:
            best_before, before = v, t
        if v >= target and v < best_after:
            best_after, after = v, t
    result = []
    # 전거는 도착 시각 20분 이내인 경우에만 (너무 과거면 무의미)
    if before and (target - _hm(before["time"])) <= 20:
        result.append(before)
    # 후거 최대 2개 (전거가 있는 경우 1개만, 없는 경우 2개)
    for t in extended:
        if _hm(t["time"]) >= target and t not in result:
            result.append(t)
            if len(result) >= 3:
                break
    result = sorted(result, key=lambda x: _hm(x["time"]))
    return result[:3]

def _hm_to_min(t):
    parts = t.split(":")
    return int(parts[0]) * 60 + int(parts[1])

def _min_to_hm(m):
    h = m // 60
    if h >= 24: h -= 24
    return f"{h:02d}:{m % 60:02d}"

def find_nearest_station(lat, lng):
    best = None
    best_dist = float('inf')
    for s in STATIONS:
        d = haversine_km(lat, lng, s["lat"], s["lng"])
        if d < best_dist:
            best_dist = d
            best = s
    return best, best_dist

def find_nearest_bus_stop(lat, lng, route_name=None):
    best = None
    best_dist = float('inf')
    for route in YANGPYEONG_BUS_ROUTES:
        if route_name and route["name"] != route_name: continue
        for stop in route["stops"]:
            d = haversine_km(lat, lng, stop["lat"], stop["lng"])
            if d < best_dist:
                best_dist = d
                best = {"route": route["name"], "stop": stop["name"], "lat": stop["lat"], "lng": stop["lng"]}
    return best, best_dist

def find_bus_between(from_lat, from_lng, to_lat, to_lng):
    candidates = []
    for route in YANGPYEONG_BUS_ROUTES:
        stops = route["stops"]
        for i in range(len(stops)):
            d_from = haversine_km(from_lat, from_lng, stops[i]["lat"], stops[i]["lng"])
            for j in range(i+1, len(stops)):
                d_to = haversine_km(to_lat, to_lng, stops[j]["lat"], stops[j]["lng"])
                if d_from < 2.0 and d_to < 2.0:
                    dist_km = sum(haversine_km(stops[k]["lat"], stops[k]["lng"], stops[k+1]["lat"], stops[k+1]["lng"]) for k in range(i, j))
                    candidates.append({"route": route["name"], "from_stop": stops[i]["name"], "to_stop": stops[j]["name"], "dist_km": round(dist_km, 1), "time_min": round(dist_km / BUS_SPEED * 60 + 5)})
    candidates.sort(key=lambda c: c["time_min"])
    return candidates[:3]

def get_train_between(from_station, to_station, arrival_before_min):
    station_names = [s["name"] for s in STATIONS]
    if from_station not in station_names or to_station not in station_names:
        return None
    fi = station_names.index(from_station)
    ti = station_names.index(to_station)
    if ti > fi:
        direction = "toward_jipyeong"
    else:
        direction = "toward_seoul"
    s = STATIONS[fi]
    times = s[direction]
    first = _hm_to_min(times[0])
    last = _hm_to_min(times[1])
    dist_stops = abs(ti - fi)
    travel_min = dist_stops * 4
    dep_min = arrival_before_min - travel_min - 5
    if dep_min < first:
        dep_min = first
    if dep_min > last:
        dep_min = last
    arr_min = dep_min + travel_min
    return {
        "from": from_station, "to": to_station, "line": s["line"],
        "direction": "용문/지평 방면" if direction == "toward_jipyeong" else "서울/덕소 방면",
        "departure": _min_to_hm(dep_min),
        "arrival": _min_to_hm(arr_min),
        "travel_min": travel_min, "stops": dist_stops
    }

def naver_transit(from_lat, from_lng, to_lat, to_lng, client_id=None, client_secret=None, arrival_min=None):
    """Naver Cloud Platform 대중교통 방향 API 호출"""
    if not client_id or not client_secret:
        return None
    url = "https://maps.apigw.ntruss.com/map-direction/v1/pubtransit"
    params = {"start":f"{from_lng},{from_lat}","goal":f"{to_lng},{to_lat}","lang":"ko"}
    if arrival_min is not None:
        params["arrivalTime"] = f"20260711{arrival_min//60:02d}{arrival_min%60:02d}"
    headers = {"x-ncp-apigw-api-key-id":client_id,"x-ncp-apigw-api-key":client_secret}
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=5)
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("code") != 0 or not data.get("route"):
            return None
        route = data["route"]["traoptimal"][0]
        summary = route.get("summary", {})
        guides = summary.get("guide", [])
        if not guides:
            return None
        total_sec = summary.get("duration", 0)
        total_min = round(total_sec / 60)
        dep_time = summary.get("departureTime","")
        arr_time = summary.get("arrivalTime","")
        steps = []
        for g in guides:
            mode_map = {"WALK":"🚶 도보","BUS":"🚌 버스","SUBWAY":"🚄 지하철","EXPRESS_BUS":"🚌 고속버스","AIRPORT_BUS":"🚌 공항버스"}
            mode = mode_map.get(g.get("mode",""), g.get("mode",""))
            detail = f"{g.get('startName','')} → {g.get('endName','')} "
            if g.get("stationCount"):
                detail += f"({g['stationCount']}정거장) "
            dist_m = g.get("distance",0)
            dur_sec = g.get("duration",0)
            if dist_m > 0: detail += f"{round(dist_m/1000,1)}km "
            if dur_sec > 0: detail += f"{round(dur_sec/60)}분"
            if g.get("busNo"): detail = f"{g['busNo']}번 " + detail
            if g.get("subwayName"): detail = g['subwayName'] + " " + detail
            step = {"mode":mode,"from":g.get("startName",""),"to":g.get("endName",""),"detail":detail.strip(),"time_min":round(dur_sec/60) if dur_sec else 0}
            if g.get("busNo"): step["bus_no"] = f"{g['busNo']}번"
            if g.get("subwayName"): step["subway_name"] = g["subwayName"]
            steps.append(step)
        return {"steps":steps,"total_min":total_min,"departure":dep_time[-5:] if dep_time else "","arrival":arr_time[-5:] if arr_time else "","distance_km":round(summary.get("distance",0)/1000,1)}
    except:
        return None

def _estimate_plan(from_name, to_name, direct_km, arrival_min):
    """Distance-based transit estimate used when Naver is unavailable and the
    leg lies outside the Yangpyeong transit network."""
    total_min = int(direct_km * 3 + 15)
    steps = [{"mode": "🚌 대중교통(추정)", "from": from_name, "to": to_name,
              "detail": f"대중교통 약 {total_min}분 ({round(direct_km, 1)}km, 정확 경로 미제공)",
              "time_min": total_min}]
    dep_min = arrival_min - total_min
    return {"steps": steps, "total_min": total_min, "departure": _min_to_hm(dep_min),
            "arrival": _min_to_hm(arrival_min), "distance_km": round(direct_km, 1), "estimate": True}

def is_korea(lat, lng):
    """Rough bounding box for South Korea (incl. Jeju)."""
    try:
        return 33.0 <= float(lat) <= 38.7 and 124.5 <= float(lng) <= 129.7
    except (TypeError, ValueError):
        return False

def odsay_transit(from_lat, from_lng, to_lat, to_lng, api_key, arrival_min=None):
    """ODSay public transit routing (Korea). Returns plan_segment-compatible dict."""
    if not api_key:
        return None
    _cached = _odsay_cache_get(from_lat, from_lng, to_lat, to_lng)
    if _cached:
        _steps, _total, _dist = _cached
        _dep = (arrival_min - _total) if arrival_min is not None else 0
        return {"steps": _steps, "total_min": _total,
                "departure": _min_to_hm(_dep) if arrival_min is not None else "",
                "arrival": _min_to_hm(arrival_min) if arrival_min is not None else "",
                "distance_km": _dist}
    url = "https://api.odsay.com/v1/api/searchPubTransPathT"
    params = {"apiKey": api_key, "SX": from_lng, "SY": from_lat,
              "EX": to_lng, "EY": to_lat, "OPT": 0, "lang": 0}
    try:
        resp = requests.get(url, params=params, timeout=6)
        data = resp.json()
    except:
        return None
    if data.get("error"):
        return None
    paths = (data.get("result") or {}).get("path") or []
    if not paths:
        return None
    path = paths[0]
    info = path.get("info", {})
    total_min = info.get("totalTime")
    if not total_min or total_min <= 0:
        return None
    total_min = int(total_min)
    steps = []
    for sp in path.get("subPath", []):
        t = sp.get("trafficType")
        sec = sp.get("sectionTime") or 0
        dist = sp.get("distance") or 0
        s_lat, s_lng, e_lat, e_lng = None, None, None, None
        try:
            s_lng, s_lat = float(sp.get("startX")), float(sp.get("startY"))
        except (TypeError, ValueError):
            pass
        try:
            e_lng, e_lat = float(sp.get("endX")), float(sp.get("endY"))
        except (TypeError, ValueError):
            pass
        _coords = {}
        if s_lat is not None and s_lng is not None:
            _coords["from_lat"], _coords["from_lng"] = s_lat, s_lng
        if e_lat is not None and e_lng is not None:
            _coords["to_lat"], _coords["to_lng"] = e_lat, e_lng
        if t == 3:
            steps.append({"mode": "🚶 도보", "from": "", "to": "",
                          "detail": f"도보 {sec}분 ({round(dist/1000,1)}km)", "time_min": sec, **_coords})
        elif t == 1:
            lane = (sp.get("lane") or [{}])[0]
            name = lane.get("name") or ""
            start = sp.get("startName") or ""
            end = sp.get("endName") or ""
            steps.append({"mode": "🚄 지하철", "from": start, "to": end,
                          "detail": f"{name} {start}→{end} ({sec}분, {sp.get('stationCount',0)}정거장)",
                          "time_min": sec, "subway_name": name, **_coords})
        elif t == 2:
            lane = (sp.get("lane") or [{}])[0]
            name = lane.get("name") or lane.get("busNo") or ""
            start = sp.get("startName") or ""
            end = sp.get("endName") or ""
            steps.append({"mode": "🚌 버스", "from": start, "to": end,
                          "detail": f"{name} {start}→{end} ({sec}분)", "time_min": sec, "bus_no": name, **_coords})
        else:
            steps.append({"mode": "🚉 기타", "from": "", "to": "", "detail": f"{sec}분", "time_min": sec, **_coords})
    # ODSay는 도보 구간에 좌표를 주지 않으므로 인접 단계/전체 출발·도착 좌표에서 파생
    for i, st in enumerate(steps):
        if "도보" not in st.get("mode", ""):
            continue
        if "from_lat" not in st:
            prev_to = steps[i - 1].get("to_lat") if i > 0 else None
            if prev_to is not None:
                st["from_lat"], st["from_lng"] = steps[i - 1]["to_lat"], steps[i - 1]["to_lng"]
            else:
                st["from_lat"], st["from_lng"] = float(from_lat), float(from_lng)
        if "to_lat" not in st:
            nxt_from = steps[i + 1].get("from_lat") if i < len(steps) - 1 else None
            if nxt_from is not None:
                st["to_lat"], st["to_lng"] = steps[i + 1]["from_lat"], steps[i + 1]["from_lng"]
            else:
                st["to_lat"], st["to_lng"] = float(to_lat), float(to_lng)
    _odsay_cache_set(from_lat, from_lng, to_lat, to_lng, steps, total_min, round(info.get("pointDistance", 0)/1000, 1))
    dep_min = (arrival_min - total_min) if arrival_min is not None else 0
    return {"steps": steps, "total_min": total_min,
            "departure": _min_to_hm(dep_min) if arrival_min is not None else "",
            "arrival": _min_to_hm(arrival_min) if arrival_min is not None else "",
            "distance_km": round(info.get("pointDistance", 0)/1000, 1)}

def google_transit(from_lat, from_lng, to_lat, to_lng, api_key, arrival_min=None):
    """Google Maps Directions (transit mode) - used for overseas legs."""
    if not api_key:
        return None
    url = "https://maps.googleapis.com/maps/api/directions/json"
    params = {"origin": f"{from_lat},{from_lng}", "destination": f"{to_lat},{to_lng}",
              "mode": "transit", "language": "ko", "region": "kr",
              "key": api_key, "departure_time": "now"}
    try:
        resp = requests.get(url, params=params, timeout=6)
        data = resp.json()
    except:
        return None
    if data.get("status") != "OK":
        return None
    routes = data.get("routes") or []
    if not routes:
        return None
    leg = routes[0]["legs"][0]
    total_sec = leg.get("duration", {}).get("value", 0)
    total_min = round(total_sec / 60)
    if total_min <= 0:
        return None
    steps = []
    for s in leg.get("steps", []):
        mode = s.get("travel_mode")
        dur = round(s.get("duration", {}).get("value", 0) / 60)
        if mode == "WALKING":
            dist_m = s.get("distance", {}).get("value", 0)
            steps.append({"mode": "🚶 도보", "from": "", "to": "",
                          "detail": f"도보 {dur}분 ({round(dist_m/1000,1)}km)", "time_min": dur})
        elif mode == "TRANSIT":
            td = s.get("transit_details", {})
            line = td.get("line", {})
            veh = line.get("vehicle", {}).get("type", "")
            name = line.get("short_name") or line.get("name") or veh
            dep = td.get("departure_stop", {}).get("name", "")
            arr = td.get("arrival_stop", {}).get("name", "")
            icon = "🚄" if any(k in veh for k in ("SUBWAY", "RAIL", "METRO", "TRAIN")) else "🚌"
            steps.append({"mode": f"{icon} {veh}", "from": dep, "to": arr,
                          "detail": f"{name} {dep}→{arr} ({dur}분)", "time_min": dur,
                          "bus_no": name if icon == "🚌" else "", "subway_name": name if icon == "🚄" else ""})
        else:
            steps.append({"mode": "🚗 기타", "from": "", "to": "", "detail": f"{mode} {dur}분", "time_min": dur})
    dep_min = (arrival_min - total_min) if arrival_min is not None else 0
    return {"steps": steps, "total_min": total_min,
            "departure": _min_to_hm(dep_min) if arrival_min is not None else "",
            "arrival": _min_to_hm(arrival_min) if arrival_min is not None else "",
            "distance_km": round(leg.get("distance", {}).get("value", 0)/1000, 1)}

def plan_segment(from_name, from_lat, from_lng, to_name, to_lat, to_lng, arrival_time_str, home_town=None, home_village=None, naver_id=None, naver_secret=None, odsay_key=None, google_key=None):
    parts = arrival_time_str.split(":")
    arr_h = int(parts[0]) if parts else 9
    arr_m = int(parts[1]) if len(parts) > 1 else 0
    arrival_min = arr_h * 60 + arr_m

    # Regional routing: Korea -> ODSay, Overseas -> Google
    domestic = is_korea(from_lat, from_lng) and is_korea(to_lat, to_lng)
    if domestic:
        primary, secondary, pk, sk = odsay_transit, google_transit, odsay_key, google_key
    else:
        primary, secondary, pk, sk = google_transit, odsay_transit, google_key, odsay_key
    res = primary(from_lat, from_lng, to_lat, to_lng, pk, arrival_min)
    if not res and sk:
        res = secondary(from_lat, from_lng, to_lat, to_lng, sk, arrival_min)
    if res:
        dep_min = arrival_min - res["total_min"]
        res["departure"] = _min_to_hm(dep_min)
        res["arrival"] = arrival_time_str
        return res

    # Legacy Naver (if configured)
    naver_result = naver_transit(from_lat, from_lng, to_lat, to_lng, naver_id, naver_secret, arrival_min)
    if naver_result:
        dep_min = arrival_min - naver_result["total_min"]
        naver_result["departure"] = _min_to_hm(dep_min)
        naver_result["arrival"] = arrival_time_str
        return naver_result

    direct_km = haversine_km(from_lat, from_lng, to_lat, to_lng)
    steps = []
    total_travel_min = 0

    if direct_km < 1.0:
        walk_min = round(direct_km / WALK_SPEED * 60) + 2
        steps.append({"mode":"도보","from":from_name,"to":to_name,"detail":f"도보 {walk_min}분 ({round(direct_km,1)}km)","time_min":walk_min})
        total_travel_min = walk_min
        dep_min = arrival_min - walk_min
        return {"steps":steps,"total_min":total_travel_min,"departure":_min_to_hm(dep_min),"arrival":arrival_time_str,"distance_km":round(direct_km,1)}

    # 1. Walk to nearest bus stop or station
    near_station, dist_station = find_nearest_station(from_lat, from_lng)
    near_bus, dist_bus = find_nearest_bus_stop(from_lat, from_lng)

    # When Naver is unavailable, legs outside the Yangpyeong transit network
    # (both endpoints far from any Yangpyeong station/bus stop) would otherwise
    # produce absurd "walk to a distant Yangpyeong station" estimates. Fall back
    # to a distance-based estimate instead.
    _ns_to, _ds_to = find_nearest_station(to_lat, to_lng)
    _nb_to, _db_to = find_nearest_bus_stop(to_lat, to_lng)
    _from_far = dist_station > 5.0 or dist_bus > 5.0
    _to_far = _ds_to > 5.0 or _db_to > 5.0
    if _from_far and _to_far:
        return _estimate_plan(from_name, to_name, direct_km, arrival_min)

    use_station_first = dist_station <= dist_bus or dist_station < 3.0

    if use_station_first and near_station:
        walk_to_station = round(dist_station / WALK_SPEED * 60) + 3
        if walk_to_station > 2:
            steps.append({"mode":"도보","from":f"{from_name}","to":f"{near_station['name']}","detail":f"도보 {walk_to_station}분 ({round(dist_station,1)}km)","time_min":walk_to_station})
            total_travel_min += walk_to_station

        dest_station, _ = find_nearest_station(to_lat, to_lng)
        if dest_station and near_station["name"] != dest_station["name"]:
            train = get_train_between(near_station["name"], dest_station["name"], arrival_min - total_travel_min)
            if train:
                steps.append({"mode":"🚄 전철","from":near_station["name"],"to":dest_station["name"],"detail":f"{train['line']} {train['direction']} {train['departure']}→{train['arrival']} ({train['travel_min']}분, {train['stops']}정거장)","time_min":train["travel_min"],"subway_name":train["line"]})
                total_travel_min += train["travel_min"]

        walk_to_dest = haversine_km(dest_station["lat"], dest_station["lng"], to_lat, to_lng) if dest_station else 0
        walk_dest_min = round(walk_to_dest / WALK_SPEED * 60) + 3
        if walk_dest_min > 2:
            steps.append({"mode":"도보","from":f"{dest_station['name'] if dest_station else ''}","to":f"{to_name}","detail":f"도보 {walk_dest_min}분 ({round(walk_to_dest,1)}km)","time_min":walk_dest_min})
            total_travel_min += walk_dest_min
    else:
        if near_bus:
            walk_to_bus = round(dist_bus / WALK_SPEED * 60) + 3
            if walk_to_bus > 2:
                steps.append({"mode":"도보","from":f"{from_name}","to":f"{near_bus['stop']}({near_bus['route']})","detail":f"도보 {walk_to_bus}분 ({round(dist_bus,1)}km)","time_min":walk_to_bus})
                total_travel_min += walk_to_bus

            buses = find_bus_between(from_lat, from_lng, to_lat, to_lng)
            if buses:
                b = buses[0]
                steps.append({"mode":"🚌 버스","from":f"{b['from_stop']}({b['route']})","to":f"{b['to_stop']}({b['route']})","detail":f"{b['route']} {b['from_stop']}→{b['to_stop']} ({b['time_min']}분, {b['dist_km']}km)","time_min":b['time_min'],"bus_no":b['route']})
                total_travel_min += b['time_min']
            else:
                road_km = direct_km * 1.3
                walk_min = round(direct_km / WALK_SPEED * 60 * 1.3) + 5
                if walk_min > 20:
                    taxi_min = round(road_km / 40 * 60) + 5
                    taxi_fare = round(road_km * 1500 + 3800, -2)
                    steps.append({"mode":"🚕 택시","from":from_name,"to":to_name,"detail":f"택시 {taxi_min}분 예상 ({round(road_km,1)}km, 약 {taxi_fare:,}원)","time_min":taxi_min})
                    total_travel_min += taxi_min
                else:
                    steps.append({"mode":"🚶 도보","from":from_name,"to":to_name,"detail":f"도보 {walk_min}분 (직선 {round(direct_km,1)}km, 도로 약 {round(road_km,1)}km)","time_min":walk_min})
                    total_travel_min += walk_min

    if not steps:
        taxi_min = round(direct_km / 40 * 60) + 5
        taxi_fare = round(direct_km * 1500 + 3800, -2)
        steps.append({"mode":"🚕 택시","from":from_name,"to":to_name,"detail":f"택시 {taxi_min}분 예상 ({round(direct_km,1)}km, 약 {taxi_fare:,}원)","time_min":taxi_min})
        total_travel_min = taxi_min

    dep_min = arrival_min - total_travel_min
    return {"steps":steps,"total_min":total_travel_min,"departure":_min_to_hm(dep_min),"arrival":arrival_time_str,"distance_km":round(direct_km,1)}

def format_itinerary(plan):
    lines = [f"🚶 {plan['departure']} 출발 → {plan['arrival']} 도착 (총 {plan['total_min']}분, {plan['distance_km']}km)"]
    for i, s in enumerate(plan["steps"], 1):
        mode = s['mode']
        detail = s['detail']
        from_name = s.get('from', '')
        to_name = s.get('to', '')
        bus_no = s.get('bus_no', '')
        subway = s.get('subway_name', '')
        time_min = s.get('time_min', 0)

        if '도보' in mode:
            if from_name and to_name:
                lines.append(f"  {i}. 🚶 도보: {from_name} → {to_name} ({time_min}분)")
            else:
                lines.append(f"  {i}. 🚶 도보 {time_min}분")
        elif '버스' in mode:
            bus_info = f"{bus_no} " if bus_no else ""
            if from_name and to_name:
                lines.append(f"  {i}. 🚌 {bus_info}{from_name} → {to_name} ({time_min}분)")
            else:
                lines.append(f"  {i}. 🚌 {bus_info}{detail}")
        elif '전철' in mode or '지하철' in mode:
            line_info = f"{subway} " if subway else ""
            if from_name and to_name:
                lines.append(f"  {i}. 🚄 {line_info}{from_name} → {to_name} ({time_min}분)")
            else:
                lines.append(f"  {i}. 🚄 {line_info}{detail}")
        elif '택시' in mode:
            lines.append(f"  {i}. 🚕 택시 {time_min}분")
        else:
            lines.append(f"  {i}. {mode} {detail}")
    return "\n".join(lines)

def format_memo_compact(plan):
    parts = []
    cumulative_min = 0
    dep_min = _hm_to_min(plan.get("departure", "00:00"))
    for s in plan["steps"]:
        step_start_min = dep_min + cumulative_min
        step_time = s.get("time_min", 1)
        step_hm = f"{step_start_min//60:02d}:{step_start_min%60:02d}"
        mode = s["mode"]
        if "도보" in mode:
            parts.append(f"도{step_time}")
        elif "버스" in mode or "고속" in mode:
            bus_no = s.get("bus_no", "")
            stop = s.get("from", "").split("(")[0]
            parts.append(f"{bus_no}(버, {stop}, {step_hm})" if bus_no else f"버스{step_time}분")
        elif "전철" in mode or "지하철" in mode:
            line = s.get("subway_name", "")
            station = s.get("from", "")
            parts.append(f"{line}(지, {station}, {step_hm})" if line else f"전철{step_time}분")
        elif "택시" in mode:
            parts.append(f"택시{step_time}분")
        else:
            parts.append(f"{mode}{step_time}분")
        cumulative_min += step_time
    return " -> ".join(parts)

def _fmt_dur_ko(time_min):
    try:
        tm = float(time_min or 0)
    except (TypeError, ValueError):
        tm = 0
    if tm <= 0:
        return "1분"
    total_sec = int(round(tm * 60))
    m, s = divmod(total_sec, 60)
    if m >= 120:
        h, m2 = divmod(m, 60)
        return f"{h}시간{m2}분" if m2 else f"{h}시간"
    if s and m < 60:
        return f"{m}분{s}초" if m else f"{s}초"
    return f"{m}분"

def _place_ko(name):
    if not name:
        return ""
    n = str(name).strip()
    if "(" in n:
        n = n.split("(")[0].strip()
    return n

def _bus_label(bus_no, from_name=""):
    bn = (bus_no or "").strip()
    if not bn and from_name and "(" in str(from_name):
        bn = str(from_name).split("(")[-1].rstrip(")").strip()
    if not bn:
        return ""
    if bn.endswith("번"):
        return bn
    if any(c.isalpha() for c in bn):
        return bn
    return f"{bn}번"

def _stop_label(name, kind="정류장"):
    n = _place_ko(name)
    if not n:
        return kind
    if any(k in n for k in ("정류장", "역", "입구", "터미널")):
        return n
    return f"{n} {kind}"

def _station_label(name):
    n = _place_ko(name)
    if not n:
        return "역"
    if any(k in n for k in ("역", "입구", "터미널")):
        return n
    return f"{n}역"

def format_memo_narrative(plan, origin_name=None, dest_name=None):
    """자연어 경로 안내 문장 (통벗 이동 메모용).
    예) 집에서 3분 걸어서 양수리지석묘 정류장에서 58번 버스를 타고 7분30초 가서
        운길산 정류장에서 내려서 3분 걸어서 경의중앙선으로 지하철을 타고 90분 가서
        용산역에서 내려서 15분 걸어가면 용산시제품제작소입니다.
    """
    steps = list(plan.get("steps") or [])
    if not steps:
        return ""
    dest = _place_ko(dest_name) or _place_ko(steps[-1].get("to")) or "목적지"
    origin = _place_ko(origin_name) or _place_ko(steps[0].get("from")) or "출발지"
    chunks = []
    n = len(steps)
    just_alighted = False
    for i, s in enumerate(steps):
        mode = s.get("mode") or ""
        fr = _place_ko(s.get("from"))
        to = _place_ko(s.get("to"))
        dur = _fmt_dur_ko(s.get("time_min", 0))
        is_last = i == n - 1
        is_first = i == 0

        if "도보" in mode:
            start = ""
            if is_first:
                start = fr or origin
            elif not just_alighted:
                start = fr
            if is_last:
                if start:
                    chunks.append(f"{start}에서 {dur} 걸어가면 {dest}입니다")
                else:
                    chunks.append(f"{dur} 걸어가면 {dest}입니다")
            else:
                if start:
                    chunks.append(f"{start}에서 {dur} 걸어서")
                else:
                    chunks.append(f"{dur} 걸어서")
            just_alighted = False
        elif "버스" in mode or "고속" in mode:
            stop_from = _stop_label(fr or (origin if is_first else ""), "정류장")
            bl = _bus_label(s.get("bus_no") or "", s.get("from") or "")
            ride = f"{bl} 버스를 타고" if bl else "버스를 타고"
            if is_last and not to:
                chunks.append(f"{stop_from}에서 {ride} {dur} 가면 {dest}입니다")
                just_alighted = False
            else:
                stop_to = _stop_label(to, "정류장") if to else ""
                if stop_to:
                    chunks.append(f"{stop_from}에서 {ride} {dur} 가서 {stop_to}에서 내려서")
                    just_alighted = True
                else:
                    chunks.append(f"{stop_from}에서 {ride} {dur} 가서")
                    just_alighted = False
                if is_last:
                    chunks.append(f"{dest}입니다")
                    just_alighted = False
        elif "전철" in mode or "지하철" in mode or "SUBWAY" in mode or "RAIL" in mode or "METRO" in mode or "TRAIN" in mode:
            line = (s.get("subway_name") or "").strip()
            if line.endswith("선") or line.endswith("호선"):
                board = f"{line}으로 지하철을 타고"
            elif line:
                board = f"{line} 지하철을 타고"
            elif fr:
                board = f"{_station_label(fr)}에서 지하철을 타고"
            else:
                board = "지하철을 타고"
            if is_last and not to:
                chunks.append(f"{board} {dur} 가면 {dest}입니다")
                just_alighted = False
            else:
                end_st = _station_label(to) if to else ""
                if end_st:
                    chunks.append(f"{board} {dur} 가서 {end_st}에서 내려서")
                    just_alighted = True
                else:
                    chunks.append(f"{board} {dur} 가서")
                    just_alighted = False
                if is_last:
                    chunks.append(f"{dest}입니다")
                    just_alighted = False
        elif "택시" in mode:
            start = fr if (is_first or not just_alighted) else ""
            if not start and is_first:
                start = origin
            if is_last:
                if start:
                    chunks.append(f"{start}에서 택시로 {dur} 가면 {dest}입니다")
                else:
                    chunks.append(f"택시로 {dur} 가면 {dest}입니다")
            else:
                if start:
                    chunks.append(f"{start}에서 택시로 {dur} 가서")
                else:
                    chunks.append(f"택시로 {dur} 가서")
            just_alighted = False
        else:
            detail = (s.get("detail") or mode or "이동").strip()
            if is_last:
                chunks.append(f"{detail} 후 {dest}입니다")
            else:
                chunks.append(f"{detail} 후")
            just_alighted = False

    text = " ".join(c.strip() for c in chunks if c and c.strip()).strip()
    if not text:
        return f"{origin}에서 {dest}까지 이동합니다."
    if "입니다" not in text:
        text = text.rstrip("서").rstrip() + f" {dest}입니다"
    if not text.endswith("."):
        text += "."
    return text


# ---------- 버스 정류장 정보 (ODSay) ----------

_BUS_STOP_CACHE = {}
_BUS_STOP_TTL = 6 * 3600
_BUS_REALTIME_TTL = 60
_BUS_REALTIME_CACHE = {}
_BUS_ROUTE_CACHE = {}
_BUS_ROUTE_TTL = 6 * 3600

def _odsay_bus_api():
    try:
        from flask import current_app
        return current_app.config.get('ODSAY_API_KEY', '')
    except Exception:
        return os.getenv('ODSAY_API_KEY', '')

def _in_yangpyeong_area(rec):
    """정류장 좌표가 양평군(위경도 대략 경계) 안이면 True"""
    try:
        x = float(rec.get("x") or 0); y = float(rec.get("y") or 0)
    except Exception:
        return False
    return 127.25 <= x <= 127.75 and 37.35 <= y <= 37.65

def _search_bus_stop_api(query, stop_name):
    """ODSay searchStation 호출 + 결과에서 버스정류장 매칭. (사용자 표기와 실제 정류장명 차이 보정 포함)"""
    try:
        r = requests.get("https://api.odsay.com/v1/api/searchStation",
            params={"apiKey": _odsay_bus_api(), "stationName": query, "lang": "0", "output": "json"}, timeout=8)
        d = r.json()
    except Exception:
        return None
    sts = (d.get("result") or {}).get("station") or []
    if isinstance(sts, dict): sts = [sts]
    out = None
    yang_priority = None
    # 검색어에서 지점 접미사 제거한 핵심어 (부분매칭 보조)
    def _core(s):
        for suf in ("버스정류장", "버스 정류장", "정류장", "지점", "정류소"):
            if s.endswith(suf):
                s = s[: -len(suf)]
                break
        return s.strip()
    core = _core(stop_name)
    for s in sts:
        if s.get("stationClass") != 1:
            continue  # 버스정류장만
        nm = s.get("stationName") or ""
        rec = {"stationID": s.get("stationID"), "CID": s.get("CID"),
               "arsID": s.get("arsID"), "localStationID": s.get("localStationID"),
               "name": nm, "x": s.get("x"), "y": s.get("y")}
        # 양평군 좌표 정류장 우선 (양평역 등 중복역명: 서울 것이 먼저 오는 문제 해결)
        try:
            px = float(rec.get("x") or 0); py = float(rec.get("y") or 0)
            if 127.25 <= px <= 127.75 and 37.35 <= py <= 37.65:
                if yang_priority is None:
                    yang_priority = rec
        except Exception:
            pass
        if nm == stop_name:
            out = rec  # 정확 매칭 우선
            break
        # 부분매칭: 사용자 표기에 포함되거나, 핵심어(정류장 등 제거)가 정류장명에 포함
        matched = (stop_name in nm) or (nm in stop_name) or (core and (core in nm or nm in core))
        if out is None and matched:
            out = rec
    if yang_priority and (out is None or (out.get("CID") == 1000 and not _in_yangpyeong_area(out))):
        out = yang_priority
    return out

def search_bus_stop(stop_name):
    """정류장명으로 ODSay 정류장 검색. 이름 정확 매칭 우선, 없으면 부분매칭. (stationID, CID, arsID, localStationID, name) 반환"""
    if not stop_name:
        return None
    ck = ("sb", stop_name)
    hit = _BUS_STOP_CACHE.get(ck)
    if hit and (hit[0] + _BUS_STOP_TTL) > time.time():
        return hit[1]
    out = _search_bus_stop_api(stop_name, stop_name)
    # "버스정류장" 접미사 때문에 실패한 경우, 접미사를 제거해 재시도
    if out is None:
        for suf in ("버스정류장", "버스 정류장", "정류장", "정류소"):
            if stop_name.endswith(suf):
                alt = stop_name[: -len(suf)].strip()
                if alt:
                    out = _search_bus_stop_api(alt, stop_name)
                    break
    if out:
        _BUS_STOP_CACHE[ck] = (time.time(), out)
    return out

def seoul_bus_realtime(stop_name):
    """서울(CID 1000) 정류장 실시간 도착정보: 노선별 다음 버스 2대 (분 단위 도착). realtimeStation API"""
    rec = search_bus_stop(stop_name)
    if not rec or rec.get("CID") != 1000 or not rec.get("stationID"):
        return None
    ck = ("rt", rec["stationID"])
    hit = _BUS_REALTIME_CACHE.get(ck)
    if hit and (hit[0] + _BUS_REALTIME_TTL) > time.time():
        return hit[1]
    try:
        r = requests.get("https://api.odsay.com/v1/api/realtimeStation",
            params={"apiKey": _odsay_bus_api(), "stationID": rec["stationID"], "lang": "0", "output": "json"}, timeout=8)
        d = r.json()
    except Exception:
        return None
    real = ((d.get("result") or {}).get("real")) or []
    out = []
    for item in real:
        route = item.get("routeNm") or item.get("routeId") or ""
        for kf in ("arrival1", "arrival2"):
            a = item.get(kf) or {}
            sec = a.get("arrivalSec")
            if sec is None:
                continue
            try:
                mins = int(round(int(sec) / 60))
            except Exception:
                continue
            if mins < 0:
                mins = 0
            out.append({"route": route, "min": mins,
                        "bus_no": a.get("busPlateNo") or "",
                        "left_station": a.get("leftStation") or 0,
                        "end": a.get("endBusYn") == "Y"})
        if len(out) >= 2 and route == (out[0].get("route")):
            break
    out = out[:6]
    _BUS_REALTIME_CACHE[ck] = (time.time(), out)
    return out

def _gg_bus_api():
    try:
        from flask import current_app
        return current_app.config.get('GG_BUS_API_KEY', '')
    except Exception:
        return os.getenv('GG_BUS_API_KEY', '')

def gyeonggi_bus_realtime(stop_name):
    """경기 정류장 실시간 도착 (getBusArrivalListv2, localStationID 사용).
    반환: [{route, min, dest, end}] — 노선별 다음 버스 (분 단위)"""
    rec = search_bus_stop(stop_name)
    if not rec or rec.get("CID") != 1190 or not rec.get("localStationID"):
        return None
    key = _gg_bus_api()
    if not key:
        return None
    ck = ("grt", rec["localStationID"])
    hit = _BUS_REALTIME_CACHE.get(ck)
    if hit and (hit[0] + _BUS_REALTIME_TTL) > time.time():
        return hit[1]
    try:
        r = requests.get("https://apis.data.go.kr/6410000/busarrivalservice/v2/getBusArrivalListv2",
            params={"serviceKey": key, "stationId": rec["localStationID"], "format": "json"}, timeout=8)
        d = r.json()
    except Exception:
        return None
    try:
        lst = d["response"]["msgBody"]["busArrivalList"]
    except Exception:
        lst = []
    out = []
    for item in lst or []:
        route = str(item.get("routeName") or "")
        for kf in ("predictTime1", "predictTime2"):
            pt = item.get(kf)
            if pt in (None, ""):
                continue
            try:
                mins = int(pt)
            except Exception:
                continue
            out.append({"route": route, "min": mins,
                        "dest": item.get("routeDestName") or "",
                        "end": item.get("flag") == "END"})
    # 노선 기준 정렬 (가까운 순), 상위 6개
    out = sorted(out, key=lambda x: (x["route"], x["min"]))[:6]
    _BUS_REALTIME_CACHE[ck] = (time.time(), out)
    return out

def recommend_bus_routes(from_stop, to_stop):
    """from 정류장에서 to 정류장(목적지)까지 가는 버스 노선 번호를 ODSay 대중교통 경로탐색으로 추천.
    반환: [{"busNo":..., "type":...}, ...] 목록 (실패 시 None)"""
    if not from_stop or not to_stop:
        return None
    ck = ("br", from_stop, to_stop)
    hit = _BUS_ROUTE_CACHE.get(ck)
    if hit and (hit[0] + _BUS_ROUTE_TTL) > time.time():
        return hit[1]
    fr = search_bus_stop(from_stop)
    to = search_bus_stop(to_stop)
    if not fr or not to:
        return None
    try:
        r = requests.get("https://api.odsay.com/v1/api/searchPubTransPath",
            params={"apiKey": _odsay_bus_api(), "lang": "0", "output": "json",
                    "SX": fr["x"], "SY": fr["y"], "EX": to["x"], "EY": to["y"], "OPT": "0"}, timeout=10)
        d = r.json()
    except Exception:
        return None
    if "error" in d or "result" not in d:
        return None
    buses = []
    seen = set()
    # 경로탐색 결과 중 버스 구간(subPath trafficType==2)의 노선 번호 수집
    for path in (d.get("result") or {}).get("path") or []:
        for sub in path.get("subPath") or []:
            if sub.get("trafficType") != 2:
                continue
            lane = sub.get("lane") or []
            if isinstance(lane, dict):
                lane = [lane]
            for ln in lane:
                no = ln.get("busNo") or ""
                if not no or no in seen:
                    continue
                seen.add(no)
                buses.append({"busNo": no, "type": ln.get("type") or ""})
    if not buses:
        return None
    _BUS_ROUTE_CACHE[ck] = (time.time(), buses)
    return buses

def bus_stop_timetable(stop_name, to_stop=None):
    """정류장 시간표 정보: 서울이면 실시간 도착(다음 버스 분단위), 경기면 실시간 도착 우선,
    없으면 첫차/막차/간격 폴백.
    to_stop이 주어지면 그 목적지로 가는 버스 노선을 추천해 realtime 각 항목에 recommended 포함.
    반환: {"region":"seoul"|"gyeonggi", "realtime":[...], "recommended":[...] | "lanes":[...]}"""
    rec = search_bus_stop(stop_name)
    if not rec:
        return None
    cid = rec.get("CID")
    # 추천 버스 (to_stop 지정 시)
    reco_routes = None
    if to_stop and stop_name != to_stop:
        reco_routes = recommend_bus_routes(stop_name, to_stop)
    def _mark(rt):
        if not reco_routes:
            return rt
        reco_nos = {b["busNo"] for b in reco_routes}
        for it in rt:
            if (it.get("route") or "") in reco_nos:
                it["recommended"] = True
        return rt
    # 양평군 좌표 정류장은 서울로 잡혀도 경기로 처리 (양평역 등 중복역명 방지)
    if cid == 1000 and not _in_yangpyeong_area(rec):
        rt = seoul_bus_realtime(stop_name)
        if rt:
            return {"region": "seoul", "realtime": _mark(rt), "recommended": reco_routes}
        return {"region": "seoul", "realtime": [], "recommended": reco_routes}
    # 경긱 등: 실시간 도착 우선
    if cid == 1190 or _in_yangpyeong_area(rec):
        rt = gyeonggi_bus_realtime(stop_name)
        if rt:
            return {"region": "gyeonggi", "realtime": _mark(rt), "recommended": reco_routes}
    # 폴백: busStationInfo 첫차/막차/간격
    ck = ("tt", rec["stationID"])
    hit = _BUS_STOP_CACHE.get(ck)
    if hit and (hit[0] + _BUS_STOP_TTL) > time.time():
        return hit[1]
    try:
        r = requests.get("https://api.odsay.com/v1/api/busStationInfo",
            params={"apiKey": _odsay_bus_api(), "stationID": rec["stationID"], "lang": "0", "output": "json"}, timeout=8)
        d = r.json()
    except Exception:
        return None
    if "error" in d:
        return None
    res = d.get("result") or {}
    lanes = []
    seen = set()
    for ln in res.get("lane") or []:
        no = ln.get("busNo") or ""
        key = (no, ln.get("busDirectionName") or "")
        if key in seen: continue
        seen.add(key)
        lanes.append({"busNo": no, "first": ln.get("busFirstTime") or "",
                      "last": ln.get("busLastTime") or "", "interval": ln.get("busInterval") or "",
                      "direction": ln.get("busDirectionName") or ""})
    out = {"region": "gyeonggi", "lanes": lanes}
    _BUS_STOP_CACHE[ck] = (time.time(), out)
    return out
