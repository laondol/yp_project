from flask import Blueprint, render_template, request, redirect, url_for, jsonify, session, current_app, send_file
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
from sqlalchemy import or_
from models import db, ConstructionNotice, StoreInfo, VillageAlert, HeritageStamp, User, Message, ShareReport, VillageCache, PublicFacility, FacilityReport, StoreSuggestion, StoreMenu, StoreNameVote, StoreInfoVote, StoreInfoReview
from services.construction import sync_construction_notices, sync_traffic_incidents, sync_congestion_info, sync_building_permits
from services.transit import haversine_km
from config import Config

construction_bp = Blueprint('construction', __name__)

_ADDR_BACKFILL_RUNNING = False

def _serve_spa():
    import os
    path = os.path.join(current_app.root_path, 'frontend', 'dist', 'index.html')
    if os.path.exists(path):
        return send_file(path)
    return render_template('intro.html')

@construction_bp.route('/construction')
def construction():
    return _serve_spa()

@construction_bp.route('/compass')
def compass():
    return _serve_spa()

@construction_bp.route('/construction/heritage')
def construction_heritage():
    lat = request.args.get('lat', type=float)
    lng = request.args.get('lng', type=float)
    if not lat or not lng:
        return jsonify([])
    from services.local_sources import get_nearby_heritage
    from services.transit import haversine_km
    items = get_nearby_heritage(lat, lng, max_km=5)
    uid = session.get('user_id')
    home_lat = home_lng = None
    home_label = ''
    stamped_names = set()
    if uid:
        user = User.query.get(uid)
        if user and user.curr_town and user.curr_village:
            from services.transit import lookup_village_coords
            hc = lookup_village_coords(user.curr_town, user.curr_village)
            if hc:
                home_lat, home_lng = hc
        stamps = HeritageStamp.query.filter_by(user_id=uid).all()
        stamped_names = {s.heritage_name for s in stamps}
    for h in items:
        h['stamped'] = h['name'] in stamped_names
        if home_lat and home_lng:
            d_home = round(haversine_km(h['lat'], h['lng'], home_lat, home_lng), 1)
            h['dist_from_home'] = d_home
            h['near_home'] = d_home <= 5
        else:
            h['near_home'] = False
    return jsonify(items)

@construction_bp.route('/construction/heritage/stamp', methods=['POST'])
def heritage_stamp():
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    data = request.get_json()
    name = data.get('name', '').strip()
    lat = data.get('lat', type=float)
    lng = data.get('lng', type=float)
    gps_lat = data.get('gps_lat', type=float)
    gps_lng = data.get('gps_lng', type=float)
    if not name or not lat or not lng:
        return jsonify({"success": False, "error": "정보가 부족합니다."})
    from services.transit import haversine_km
    if gps_lat and gps_lng:
        dist = haversine_km(gps_lat, gps_lng, lat, lng)
        if dist > 0.2:
            return jsonify({"success": False, "error": f"현장에서만 찍을 수 있어요! 약 {round(dist*1000)}m 떨어져 있습니다. 가까이 가서 다시 시도해 주세요.", "distance_m": round(dist*1000)})
    existing = HeritageStamp.query.filter_by(user_id=uid, heritage_name=name).first()
    if existing:
        return jsonify({"success": False, "error": "이미 방문 완료한 국가유산입니다."})
    stamp = HeritageStamp(user_id=uid, heritage_name=name, heritage_lat=lat, heritage_lng=lng)
    db.session.add(stamp)
    db.session.commit()
    return jsonify({"success": True, "message": "⭐ 스탬프가 찍혔습니다!"})

@construction_bp.route('/construction/transit')
def construction_transit():
    from_lat = request.args.get('from_lat', type=float)
    from_lng = request.args.get('from_lng', type=float)
    if not from_lat or not from_lng:
        return jsonify({"error": "출발 위치가 필요합니다."}), 400
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    from models import User
    user = User.query.get(user_id)
    if not user or (not user.village and not user.curr_village):
        return jsonify({"error": "등록된 주소가 없습니다. 마이페이지에서 설정해 주세요."}), 400
    home_town = user.town or user.curr_town or ''
    home_village = user.village or user.curr_village or ''
    # 위치보정된 주소를 집 주소로 사용
    if user.curr_latitude and user.curr_longitude:
        to_address = user.address or f"경기 양평군 {home_town} {home_village}".strip()
        dest = {"lat": user.curr_latitude, "lng": user.curr_longitude, "address": to_address}
    else:
        to_address = f"경기 양평군 {home_town} {home_village}".strip()
        dest = None
    from config import Config
    kakao_key = Config.KAKAO_REST_API_KEY
    naver_id = Config.NAVER_SEARCH_CLIENT_ID or Config.NAVER_CLIENT_ID
    naver_secret = Config.NAVER_SEARCH_CLIENT_SECRET or Config.NAVER_CLIENT_SECRET
    from services.transit import reverse_geocode, geocode_address, estimate_transit_time_rough, haversine_km, lookup_village_coords
    dep = reverse_geocode(from_lat, from_lng, kakao_key, naver_id, naver_secret)
    if not dest:
        dest = geocode_address(to_address, kakao_key, naver_id, naver_secret)
    if not dest or not dest.get("lat"):
        lc = lookup_village_coords(user.curr_town, user.curr_village)
        if lc:
            dest = {"lat": lc[0], "lng": lc[1], "address": to_address}
    result = {
        "departure": dep or {"lat": from_lat, "lng": from_lng, "address": f"{from_lat:.5f}, {from_lng:.5f}"},
        "destination": dest or {"lat": 0, "lng": 0, "address": to_address},
        "distance_km": 0,
    }
    if dest and dest["lat"]:
        from services.transit import haversine_km
        result["distance_km"] = round(haversine_km(from_lat, from_lng, dest["lat"], dest["lng"]), 1)
    if not result.get("transit_routes"):
        from services.transit import estimate_transit_time_rough
        rough_min = estimate_transit_time_rough(from_lat, from_lng, (dest or {}).get("lat") or from_lat, (dest or {}).get("lng") or from_lng)
        result["rough_estimate_min"] = rough_min
    # 대중교통 막차 정보 (추정)
    if dest and dest.get("lat"):
        from services.transit import estimate_last_transit
        last_info = estimate_last_transit(from_lat, from_lng, dest["lat"], dest["lng"])
        if last_info:
            result["last_transit"] = [last_info]
    if dest and dest.get("lng"):
        dep_addr = quote(dep["address"] if dep else f"{from_lat},{from_lng}")
        dest_addr = quote(dest["address"])
        result["deep_links"] = {
            "kakao": f"https://map.kakao.com/?sX={from_lng}&sY={from_lat}&sName={dep_addr}&eX={dest['lng']}&eY={dest['lat']}&eName={dest_addr}",
            "naver": f"https://map.naver.com/index.nhn?slat={from_lat}&slng={from_lng}&stitle={dep_addr}&elat={dest['lat']}&elng={dest['lng']}&etitle={dest_addr}&pathType=1"
        }
    else:
        dep_addr = quote(dep["address"] if dep else f"{from_lat},{from_lng}")
        dest_addr = quote(to_address)
        result["deep_links"] = {
            "kakao": f"https://map.kakao.com/?sName={dep_addr}&eName={dest_addr}",
            "naver": f"https://map.naver.com/index.nhn?stitle={dep_addr}&etitle={dest_addr}&pathType=1"
        }
    return jsonify(result)

@construction_bp.route('/construction/transit/suggest')
def construction_transit_suggest():
    from_lat = request.args.get('from_lat', type=float)
    from_lng = request.args.get('from_lng', type=float)
    if not from_lat or not from_lng:
        return jsonify({"error": "출발 위치가 필요합니다."}), 400
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    from models import User
    user = User.query.get(uid)
    if not user or (not user.village and not user.curr_village):
        return jsonify({"error": "등록된 주소가 없습니다."}), 400
    home_town = user.town or user.curr_town or ''
    home_village = user.village or user.curr_village or ''
    corrected_lat = from_lat + (user.curr_offset_lat or 0)
    corrected_lng = from_lng + (user.curr_offset_lng or 0)
    from services.transit import suggest_optimal_departure, lookup_village_coords, haversine_km
    from services.geocode import gps_to_town_village
    gps_result = gps_to_town_village(corrected_lat, corrected_lng)
    gps_town = gps_result[0] if gps_result else ""
    gps_village = gps_result[1] if gps_result else ""
    user_home_lat = user.curr_latitude or user.reg_latitude or 0
    user_home_lng = user.curr_longitude or user.reg_longitude or 0
    is_home = False
    if user_home_lat and user_home_lng:
        d = haversine_km(corrected_lat, corrected_lng, user_home_lat, user_home_lng)
        is_home = d <= 0.2

    from config import Config
    kakao_key = Config.KAKAO_REST_API_KEY
    naver_id = Config.NAVER_SEARCH_CLIENT_ID or Config.NAVER_CLIENT_ID
    naver_secret = Config.NAVER_SEARCH_CLIENT_SECRET or Config.NAVER_CLIENT_SECRET

    current_addr = ""
    from services.transit import reverse_geocode
    rg = reverse_geocode(from_lat, from_lng, kakao_key, naver_id, naver_secret)
    if rg:
        current_addr = rg.get("address", "")

    home_address = user.curr_address or f"경기 양평군 {home_town} {home_village}".strip()

    if is_home:
        return jsonify({
            "already_home": True,
            "message": f"🏠 집입니다! 현재 위치가 {home_address} 근처입니다.",
            "home_address": home_address,
            "current_address": current_addr,
        })

    suggestion = suggest_optimal_departure(from_lat, from_lng, home_town, home_village)
    if not suggestion:
        return jsonify({"error": "경로를 찾을 수 없습니다."}), 404

    if user.curr_latitude and user.curr_longitude:
        home_coords = {"lat": user.curr_latitude, "lng": user.curr_longitude}
    else:
        hc = lookup_village_coords(home_town, home_village)
        home_coords = {"lat": hc[0], "lng": hc[1]} if hc else None
    if home_coords:
        suggestion["home_coords"] = home_coords
        suggestion["home_distance_km"] = round(haversine_km(
            suggestion["station_coords"]["lat"], suggestion["station_coords"]["lng"],
            home_coords["lat"], home_coords["lng"]
        ), 1)
    suggestion["home_town"] = user.curr_town or home_town
    suggestion["home_village"] = user.curr_village or home_village
    suggestion["home_address"] = home_address
    suggestion["current_address"] = current_addr
    suggestion["already_home"] = False
    suggestion["corrected"] = bool(user.curr_offset_lat or user.curr_offset_lng)
    suggestion["corrected_lat"] = corrected_lat
    suggestion["corrected_lng"] = corrected_lng
    from urllib.parse import quote
    sc = suggestion["station_coords"]
    sname = quote(suggestion["transfer_station"])
    suggestion["deep_links"] = {
        "kakao": f"https://map.kakao.com/?sX={from_lng}&sY={from_lat}&eX={sc['lng']}&eY={sc['lat']}&eName={sname}",
        "naver": f"https://map.naver.com/index.nhn?slat={from_lat}&slng={from_lng}&elat={sc['lat']}&elng={sc['lng']}&etitle={sname}&pathType=1"
    }
    if home_coords:
        suggestion["home_deep_links"] = {
            "kakao": f"https://map.kakao.com/?sX={sc['lng']}&sY={sc['lat']}&eX={home_coords['lng']}&eY={home_coords['lat']}",
            "naver": f"https://map.naver.com/index.nhn?slat={sc['lat']}&slng={sc['lng']}&elat={home_coords['lat']}&elng={home_coords['lng']}&pathType=1"
        }
    return jsonify(suggestion)

@construction_bp.route('/construction/traffic/gg')
def construction_traffic_gg():
    import json
    # 캐시 우선 조회
    cache = VillageCache.query.filter_by(data_type='traffic').order_by(VillageCache.updated_at.desc()).first()
    if cache and cache.updated_at and (datetime.now() - cache.updated_at).seconds < 600:
        data = json.loads(cache.data_json or '[]')
        return jsonify({"available":True,"yangpyeong":cache.data_count,"incidents":data,"cached":True})
    from services.utic_traffic import traffic_summary as utic_summary
    return jsonify(utic_summary())

def _resolve_canonical_store_name(report):
    """네이버 역지오코딩으로 건물명 조회 (Smartplace 대체), 실패시 카카오"""
    if not report.latitude or not report.longitude:
        return
    try:
        import requests
        best_name = None
        best_source = None
        smartplace = None

        # 1) 네이버 Reverse Geocoding: 좌표 → 건물명
        ncp_id = current_app.config.get('NAVER_SEARCH_CLIENT_ID','')
        ncp_secret = current_app.config.get('NAVER_SEARCH_CLIENT_SECRET','')
        if ncp_id and ncp_secret:
            resp = requests.get('https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc', params={
                'coords': f'{report.longitude},{report.latitude}',
                'orders': 'roadaddr',
                'output': 'json'
            }, headers={
                'x-ncp-apigw-api-key-id': ncp_id,
                'x-ncp-apigw-api-key': ncp_secret,
            }, timeout=3)
            if resp.status_code == 200:
                data = resp.json()
                for r in data.get('results', []):
                    if r.get('name') == 'roadaddr':
                        land = r.get('land', {})
                        bldg = next((a.get('value','') for a in [land.get('addition0',{}), land.get('addition1',{}), land.get('addition2',{}), land.get('addition3',{}), land.get('addition4',{})] if a.get('type') == 'building'), '')
                        if bldg:
                            best_name = bldg
                            best_source = 'naver'
                        # 네이버 지도 링크 생성
                        smartplace = f'https://map.naver.com/p?c={report.longitude},{report.latitude},16,0,0,0,dh'
                        break

        # 2) 카카오 키워드 검색 (fallback)
        if not best_name:
            kakao_key = current_app.config.get('KAKAO_REST_API_KEY','')
            if kakao_key:
                resp = requests.get('https://dapi.kakao.com/v2/local/search/keyword.json', params={
                    'query': (report.title or '').strip()[:30],
                    'x': str(report.longitude),
                    'y': str(report.latitude),
                    'radius': 1000,
                    'size': 1
                }, headers={'Authorization': f'KakaoAK {kakao_key}'}, timeout=3)
                if resp.status_code == 200:
                    docs = resp.json().get('documents', [])
                    if docs:
                        from services.transit import haversine_km
                        p = docs[0]
                        d = haversine_km(report.latitude, report.longitude, float(p.get('y',0)), float(p.get('x',0)))
                        if d <= 1.0:
                            best_name = p.get('place_name','')
                            best_source = 'kakao'
                            smartplace = p.get('place_url','') or f'https://map.naver.com/p?c={report.longitude},{report.latitude},16,0,0,0,dh'

        if best_name:
            report.canonical_name = best_name
            report.canonical_source = best_source
        if smartplace:
            report.smartplace_url = smartplace
    except:
        pass

def _normalize_store_name(title):
    """이름 정규화: 공백+특수문자 제거, 앞20자"""
    import re
    return re.sub(r'[\s\-_.,·]+', '', (title or '제목없음'))[:20]

@construction_bp.route('/construction/local-stores')
def construction_local_stores():
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    user = User.query.get(uid)
    if not user or (not user.town and not user.curr_town):
        return jsonify({"error": "등록된 주소가 없습니다."}), 400
    town = user.town or user.curr_town
    village = user.village or user.curr_village
    stores = ShareReport.query.filter_by(
        town=town, village=village, status='approved'
    ).order_by(ShareReport.created_at.desc()).limit(50).all()
    # 그룹화: 150m 이내 같은 위치 → 하나의 가게 (클러스터 중심 좌표 사용)
    from services.transit import haversine_km
    grouped = {}
    for s in stores:
        slat = s.latitude or 0
        slng = s.longitude or 0
        if not slat or not slng:
            continue
        matched_key = None
        for gk, gv in grouped.items():
            if gv["lat"] and gv["lng"]:
                d = haversine_km(float(gv["lat"]), float(gv["lng"]), slat, slng)
                if d <= 0.15:
                    matched_key = gk
                    break
        if matched_key:
            g = grouped[matched_key]
            g["posts"].append({
                "id": s.id, "title": s.title, "desc": (s.description or "")[:100],
                "user": s.author_name or "익명", "image": s.image_path,
                "date": s.created_at.strftime("%m/%d") if s.created_at else ""
            })
            if s.image_path and not g["image"]:
                g["image"] = s.image_path
            # 중심 좌표 업데이트 (평균)
            n = len(g["posts"])
            g["lat"] = float(g["lat"]) * (n - 1) / n + slat / n
            g["lng"] = float(g["lng"]) * (n - 1) / n + slng / n
        else:
            key = f"{round(slat,4)}|{round(slng,4)}"
            grouped[key] = {
                "name": s.title or "제목없음",
                "posts": [{
                    "id": s.id, "title": s.title, "desc": (s.description or "")[:100],
                    "user": s.author_name or "익명", "image": s.image_path,
                    "date": s.created_at.strftime("%m/%d") if s.created_at else ""
                }],
                "image": s.image_path,
                "lat": s.latitude, "lng": s.longitude,
            }
    # StoreInfo 매칭: 각 그룹 좌표와 가장 가까운 StoreInfo(150m 이내) 찾기
    # town만으로 먼저 검색 (village 불일치 허용)
    store_infos = StoreInfo.query.filter_by(town=town).all()
    if not store_infos:
        store_infos = StoreInfo.query.all()  # fallback: 전체 검색
    for gk, gv in grouped.items():
        if not gv.get("lat") or not gv.get("lng"):
            gv["name"] = "위치 확인 불가"
            gv["name_status"] = "unknown"
            continue
        matched = False
        for si in store_infos:
            if si.latitude and si.longitude:
                d = haversine_km(si.latitude, si.longitude, float(gv["lat"]), float(gv["lng"]))
                if d <= 0.005:
                    gv["name"] = si.name
                    gv["name_status"] = "confirmed"
                    gv["phone"] = si.phone or None
                    gv["store_link"] = si.our_link or si.store_homepage or si.smartplace or None
                    gv["link_label"] = "🏠 가게소개" if si.our_link else ("🌐 홈페이지" if si.store_homepage else ("📍 스마트플레이스" if si.smartplace else None))
                    matched = True
                    break
        if not matched:
            gv["name"] = "위치 확인 불가"
            gv["name_status"] = "unknown"

    # StoreSuggestion 매칭: StoreInfo에 없으면 회원 제안(카카오) 가게에서 찾기
    all_sugs = StoreSuggestion.query.filter(
        StoreSuggestion.lat.isnot(None), StoreSuggestion.lon.isnot(None)
    ).all()
    for gk, gv in grouped.items():
        if not gv.get("lat") or not gv.get("lng"):
            continue
        # 이미 StoreInfo로 완전 매칭됐으면 건너뜀 (phone 있으면 확정)
        if gv.get("phone") and gv.get("store_link"):
            continue
        for sg in all_sugs:
            if sg.lat and sg.lon:
                d = haversine_km(sg.lat, sg.lon, float(gv["lat"]), float(gv["lng"]))
                if d <= 0.005:
                    gv["name"] = sg.top_name or sg.name
                    if sg.phone:
                        gv["phone"] = sg.phone
                    if sg.address:
                        gv["address"] = sg.address
                    if sg.place_url:
                        gv["place_url"] = sg.place_url
                        if not gv.get("store_link"):
                            gv["store_link"] = sg.place_url
                            gv["link_label"] = "📍 카카오맵"
                    break

    # 투표 정보 추가 (StoreInfo 미매칭 그룹)
    from sqlalchemy import func
    for gk, gv in grouped.items():
        if gv.get("name_status") == "confirmed":
            continue
        if not gv.get("lat") or not gv.get("lng"):
            continue
        gkey = f"{round(float(gv['lat']), 3)}_{round(float(gv['lng']), 3)}"
        rows = (
            db.session.query(StoreNameVote.name, func.count(StoreNameVote.id).label('votes'))
            .filter_by(group_key=gkey)
            .group_by(StoreNameVote.name)
            .order_by(func.count(StoreNameVote.id).desc())
            .all()
        )
        total_users = db.session.query(func.count(db.distinct(StoreNameVote.user_id))).filter_by(group_key=gkey).scalar() or 0
        if rows:
            top_name = rows[0][0]
            top_votes = rows[0][1]
            gv["name"] = top_name
            gv["name_status"] = "voting"
            gv["name_votes"] = top_votes
            gv["name_total"] = total_users
            gv["name_options"] = [{"name": r[0], "votes": r[1]} for r in rows]

    # StoreMenu 매칭: 가게 메뉴 정보 추가
    for gk, gv in grouped.items():
        if not gv.get("lat") or not gv.get("lng"):
            continue
        for sg in all_sugs:
            if sg.lat and sg.lon:
                d = haversine_km(sg.lat, sg.lon, float(gv["lat"]), float(gv["lng"]))
                if d <= 0.15 and sg.place_id:
                    menus = StoreMenu.query.filter_by(place_id=sg.place_id).order_by(StoreMenu.sub_category).limit(10).all()
                    if menus:
                        gv["menus"] = [{"name": m.name, "category": m.sub_category, "price": m.price} for m in menus]
                    break

    # 사진 수 표시
    for gk, gv in grouped.items():
        gv["photo_count"] = len(gv.get("posts", []))

    result = {
        "town": town, "village": village,
        "stores": list(grouped.values())[:20],
    }
    return jsonify(result)

@construction_bp.route('/construction/store/<string:store_name>')
def construction_store_detail(store_name):
    uid = session.get('user_id')
    user = User.query.get(uid) if uid else None
    town = request.args.get('town','')
    village = request.args.get('village','')
    target_lat = request.args.get('lat','0')
    target_lng = request.args.get('lng','0')
    stores = ShareReport.query.filter_by(
        town=town, village=village, status='approved'
    ).order_by(ShareReport.created_at.desc()).all()
    from services.transit import haversine_km
    target_lat_f = float(target_lat)
    target_lng_f = float(target_lng)
    grouped = []
    for s in stores:
        if s.latitude and s.longitude and target_lat_f and target_lng_f:
            d = haversine_km(target_lat_f, target_lng_f, s.latitude, s.longitude)
            if d <= 0.15:
                grouped.append(s)
    if not grouped:
        from urllib.parse import unquote
        name = _normalize_store_name(unquote(store_name))
        grouped = [s for s in stores if _normalize_store_name(s.canonical_name or s.title) == name]
    if not grouped:
        return "가게를 찾을 수 없습니다.", 404

    # StoreInfo 매칭
    store_link = None
    link_label = None
    display_name = store_name
    store_phone = None
    store_address = ''
    if target_lat_f and target_lng_f:
        sis = StoreInfo.query.filter_by(town=town).all()
        if not sis:
            sis = StoreInfo.query.all()
        for si in sis:
            if si.latitude and si.longitude:
                if haversine_km(si.latitude, si.longitude, target_lat_f, target_lng_f) <= 0.005:
                    display_name = si.name
                    store_link = si.our_link or si.store_homepage or si.smartplace or None
                    link_label = "🏠 가게소개" if si.our_link else ("🌐 홈페이지" if si.store_homepage else ("📍 스마트플레이스" if si.smartplace else None))
                    store_phone = si.phone
                    break
        # StoreSuggestion 매칭 (StoreInfo에 없으면)
        if not store_link:
            sugs = StoreSuggestion.query.filter(
                StoreSuggestion.lat.isnot(None), StoreSuggestion.lon.isnot(None)
            ).all()
            for sg in sugs:
                if sg.lat and sg.lon and haversine_km(sg.lat, sg.lon, target_lat_f, target_lng_f) <= 0.005:
                    display_name = sg.top_name or sg.name
                    store_phone = sg.phone or store_phone
                    store_address = sg.address or ''
                    store_link = sg.place_url or store_link
                    link_label = link_label or ("📍 카카오맵" if sg.place_url else None)
                    break

    naver_map = f'https://map.naver.com/p?c={target_lng},{target_lat},16,0,0,0,dh' if target_lat_f and target_lng_f else None
    # 갤러리 이미지 수집
    gallery = []
    for p in grouped:
        if p.image_path and p.image_path not in gallery:
            gallery.append(p.image_path)
    # 주소: 공유글 address → location → GPS 역지오코딩
    store_address = ''
    if grouped:
        store_address = grouped[0].address or grouped[0].location or ''
    if not store_address and target_lat_f and target_lng_f:
        from services.transit import reverse_geocode
        from config import Config
        geo = reverse_geocode(target_lat_f, target_lng_f,
            kakao_key=Config.KAKAO_REST_API_KEY,
            naver_id=Config.NAVER_CLIENT_ID or Config.NAVER_SEARCH_CLIENT_ID,
            naver_secret=Config.NAVER_CLIENT_SECRET or Config.NAVER_SEARCH_CLIENT_SECRET)
        if geo and geo.get('address'):
            store_address = geo['address']
    if not store_address:
        store_address = f'{town} {village}'
    return _serve_spa()


# ─── 가게 상세 JSON API ────────────────────────────────────────────────
@construction_bp.route('/construction/store-info-json')
def store_info_json():
    """가게 상세 정보 JSON: 사진, StoreInfo, 투표 현황"""
    uid = session.get('user_id')
    lat = request.args.get('lat', type=float)
    lng = request.args.get('lng', type=float)
    town = request.args.get('town', '')
    village = request.args.get('village', '')

    if not lat or not lng:
        return jsonify({"error": "좌표가 필요합니다."}), 400

    # 30m 이내 사진 + 투표 현황
    photos = ShareReport.query.filter_by(town=town, village=village, status='approved').all()
    gallery = []
    for p in photos:
        if p.latitude and p.longitude and haversine_km(lat, lng, p.latitude, p.longitude) <= 0.005:
            if p.image_path and p.image_path not in [g["image"] for g in gallery]:
                up = StoreInfoVote.query.filter_by(photo_id=p.id, vote_type='up').count()
                down = StoreInfoVote.query.filter_by(photo_id=p.id, vote_type='down').count()
                my_vote = None
                my_comment = None
                if uid:
                    v = StoreInfoVote.query.filter_by(photo_id=p.id, user_id=uid).first()
                    my_vote = v.vote_type if v else None
                    my_comment = v.comment if v else None
                # 코멘트 목록 (틀린정보)
                comments = StoreInfoVote.query.filter_by(
                    photo_id=p.id, vote_type='down'
                ).filter(StoreInfoVote.comment.isnot(None), StoreInfoVote.comment != '').order_by(StoreInfoVote.created_at.desc()).limit(5).all()
                comment_list = [{"user": User.query.get(c.user_id).nickname if User.query.get(c.user_id) else "익명", "text": c.comment, "date": c.created_at.strftime('%m/%d') if c.created_at else ""} for c in comments]

                gallery.append({
                    "image": p.image_path, "title": p.title or "", "id": p.id,
                    "up_count": up, "down_count": down, "my_vote": my_vote,
                    "my_comment": my_comment, "comments": comment_list,
                })

    # StoreInfo 매칭
    store_info = None
    all_si = StoreInfo.query.all()
    for si in all_si:
        if si.latitude and si.longitude and haversine_km(lat, lng, si.latitude, si.longitude) <= 0.005:
            store_info = si
            break

    # StoreSuggestion 매칭 (StoreInfo 없으면)
    suggestion = None
    if not store_info:
        all_sugs = StoreSuggestion.query.filter(
            StoreSuggestion.lat.isnot(None), StoreSuggestion.lon.isnot(None)
        ).all()
        for sg in all_sugs:
            if sg.lat and sg.lon and haversine_km(lat, lng, sg.lat, sg.lon) <= 0.005:
                suggestion = sg
                break

    # 투표 현황 (전체 합산)
    photo_ids = [g["id"] for g in gallery]
    if photo_ids:
        correct_count = StoreInfoVote.query.filter(StoreInfoVote.photo_id.in_(photo_ids), StoreInfoVote.vote_type=='up').count()
        wrong_count = StoreInfoVote.query.filter(StoreInfoVote.photo_id.in_(photo_ids), StoreInfoVote.vote_type=='down').count()
    else:
        correct_count = 0
        wrong_count = 0

    user_points = 0
    if uid:
        u = User.query.get(uid)
        user_points = u.points if u else 0

    return jsonify({
        "store_name": store_info.name if store_info else (suggestion.top_name if suggestion else ""),
        "phone": store_info.phone if store_info else (suggestion.phone if suggestion else None),
        "address": (store_info.town or '') + ' ' + (store_info.village or '') if store_info else (suggestion.address if suggestion else ""),
        "store_link": (store_info.our_link or store_info.smartplace) if store_info else (suggestion.place_url if suggestion else None),
        "gallery": gallery,
        "correct_count": correct_count,
        "wrong_count": wrong_count,
        "user_points": user_points,
    })


@construction_bp.route('/construction/store-vote', methods=['POST'])
def store_info_vote():
    """사진 정보 맞/틀림 투표 (1니아 소모)"""
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401

    data = request.get_json(force=True)
    photo_id = data.get('photo_id')
    vote_type = data.get('vote_type', '')
    comment = (data.get('comment') or '').strip()

    if vote_type not in ('up', 'down'):
        return jsonify({"error": "잘못된 투표 유형입니다."}), 400
    if not photo_id:
        return jsonify({"error": "사진이 없습니다."}), 400

    user = User.query.get(uid)
    if not user or (user.points or 0) < 1:
        return jsonify({"error": "니아가 부족합니다."}), 400

    existing = StoreInfoVote.query.filter_by(photo_id=photo_id, user_id=uid).first()
    if existing:
        if existing.vote_type == vote_type and existing.comment == comment:
            return jsonify({"error": "이미 투표하셨습니다."}), 400
        existing.vote_type = vote_type
        if comment:
            existing.comment = comment
    else:
        v = StoreInfoVote(photo_id=photo_id, user_id=uid, vote_type=vote_type, comment=comment or None, cost=1)
        db.session.add(v)

    user.points = (user.points or 0) - 1
    db.session.commit()

    # 틀린정보 + 코멘트 → 관리자 검토 요청 생성
    review_msg = ""
    if vote_type == 'down' and comment:
        existing_review = StoreInfoReview.query.filter_by(photo_id=photo_id, reporter_id=uid, status='pending').first()
        if not existing_review:
            review = StoreInfoReview(photo_id=photo_id, reporter_id=uid, comment=comment)
            db.session.add(review)
            db.session.commit()
            review_msg = " → 관리자 검토 요청 전송"

    return jsonify({
        "success": True,
        "msg": f"투표 완료 (1니아 차감, 잔여 {user.points}니아){review_msg}",
        "user_points": user.points,
    })

@construction_bp.route('/construction/local-scenery')
def construction_local_scenery():
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    user = User.query.get(uid)
    if not user or not user.curr_town or not user.curr_village:
        return jsonify({"error": "등록된 주소(리)가 없습니다."}), 400
    now = datetime.now()
    cur_month = now.month
    season_months = {1,2,12} if cur_month in (1,2,12) else {3,4,5} if cur_month in (3,4,5) else {6,7,8} if cur_month in (6,7,8) else {9,10,11}
    season_name = '겨울' if cur_month in (1,2,12) else '봄' if cur_month in (3,4,5) else '여름' if cur_month in (6,7,8) else '가을'
    all_approved = ShareReport.query.filter_by(
        town=user.curr_town,
        village=user.curr_village,
        status='approved'
    ).order_by(ShareReport.created_at.desc()).all()
    scenery = []
    for s in all_approved:
        if not s.image_path:
            continue
        if s.created_at and s.created_at.month in season_months and s.id:
            # 같은 게시물이 scenery와 stores에 모두 나오는 것 방지: 
            # ai_category가 'store'/'가게'면 건너뛰기
            cat = (s.ai_category or '').lower()
            if cat in ('store','가게','상점','마트','음식점','식당','카페'):
                continue
            scenery.append(s)
    return jsonify({
        "town": user.curr_town,
        "village": user.curr_village,
        "season": season_name,
        "sceneries": [{
            "id": s.id,
            "title": s.title or "제목없음",
            "image_path": s.image_path,
            "description": (s.description or "")[:100],
            "created_at": s.created_at.strftime("%Y-%m-%d") if s.created_at else "",
        } for s in scenery[:30]],
    })

# ---- 동네가게 관리 (Admin) ----
@construction_bp.route('/admin/stores')
def admin_stores():
    if session.get('role') not in ('admin','leader'):
        return "권한 없음", 403
    return _serve_spa()

@construction_bp.route('/admin/stores/new', methods=['GET','POST'])
def admin_stores_new():
    if session.get('role') not in ('admin','leader'):
        return "권한 없음", 403
    if request.method == 'POST':
        s = StoreInfo(
            name=request.form.get('name','').strip(),
            latitude=float(request.form.get('latitude',0) or 0),
            longitude=float(request.form.get('longitude',0) or 0),
            town=request.form.get('town','').strip(),
            village=request.form.get('village','').strip(),
            our_link=request.form.get('our_link','').strip(),
            store_homepage=request.form.get('store_homepage','').strip(),
            smartplace=request.form.get('smartplace','').strip(),
        )
        db.session.add(s)
        db.session.commit()
        return redirect('/admin/stores')
    return _serve_spa()

@construction_bp.route('/admin/stores/edit/<int:store_id>', methods=['GET','POST'])
def admin_stores_edit(store_id):
    if session.get('role') not in ('admin','leader'):
        return "권한 없음", 403
    s = StoreInfo.query.get_or_404(store_id)
    if request.method == 'POST':
        s.name = request.form.get('name','').strip()
        s.latitude = float(request.form.get('latitude',0) or 0)
        s.longitude = float(request.form.get('longitude',0) or 0)
        s.town = request.form.get('town','').strip()
        s.village = request.form.get('village','').strip()
        s.our_link = request.form.get('our_link','').strip()
        s.store_homepage = request.form.get('store_homepage','').strip()
        s.smartplace = request.form.get('smartplace','').strip()
        db.session.commit()
        return redirect('/admin/stores')
    return _serve_spa()

@construction_bp.route('/admin/stores/delete/<int:store_id>', methods=['POST'])
def admin_stores_delete(store_id):
    if session.get('role') not in ('admin','leader'):
        return jsonify({"status":"error"}), 403
    s = StoreInfo.query.get_or_404(store_id)
    db.session.delete(s)
    db.session.commit()
    return jsonify({"status":"success"})

@construction_bp.route('/admin/alerts')
def admin_alerts():
    if session.get('role') not in ('admin', 'leader', 'village_leader'):
        return "권한 없음", 403
    return _serve_spa()

@construction_bp.route('/admin/alerts/new', methods=['GET', 'POST'])
def admin_alerts_new():
    if session.get('role') not in ('admin', 'leader', 'village_leader'):
        return "권한 없음", 403
    if request.method == 'POST':
        title = request.form.get('title', '').strip()
        content = request.form.get('content', '').strip()
        alert_type = request.form.get('alert_type', 'general')
        urgency = request.form.get('urgency', 'normal')
        town = request.form.get('town', '').strip()
        village = request.form.get('village', '').strip()
        if not title:
            return "<script>alert('제목을 입력하세요.'); history.back();</script>"
        alert = VillageAlert(
            title=title, content=content, alert_type=alert_type, urgency=urgency,
            town=town, village=village,
            author_id=session.get('user_id'),
            author_name=session.get('username', '')
        )
        db.session.add(alert)
        db.session.flush()
        # 마을주민 자동 쪽지
        if town:
            recipients = User.query.filter(User.village_notify != False, User.town == town)
            if village:
                recipients = recipients.filter(User.village == village)
            for r in recipients.all():
                db.session.add(Message(sender_id=session.get('user_id'), sender_name='함께사는양평',
                    receiver_id=r.id, subject=f'🚨 마을소식: {title}',
                    content=f'[{town} {village}] {title}\n\n{content}\n\n자세한 내용은 위치기반안내 > 알림에서 확인하세요.',
                    sender_role=session.get('role','admin')))
        db.session.commit()
        return redirect('/admin/alerts')
    user_town = session.get('town', '')
    user_village = session.get('village', '')
    towns = db.session.query(VillageAlert.town).distinct().all() if session.get('role') == 'admin' else [(user_town,)]
    return _serve_spa()

@construction_bp.route('/admin/alerts/edit/<int:alert_id>', methods=['GET', 'POST'])
def admin_alerts_edit(alert_id):
    if session.get('role') not in ('admin', 'leader', 'village_leader'):
        return "권한 없음", 403
    alert = VillageAlert.query.get_or_404(alert_id)
    if request.method == 'POST':
        alert.title = request.form.get('title', '').strip()
        alert.content = request.form.get('content', '').strip()
        alert.alert_type = request.form.get('alert_type', 'general')
        alert.urgency = request.form.get('urgency', 'normal')
        alert.is_active = request.form.get('is_active') == '1'
        if session.get('role') == 'admin':
            alert.town = request.form.get('town', '').strip()
            alert.village = request.form.get('village', '').strip()
        alert.updated_at = datetime.now()
        db.session.commit()
        return redirect('/admin/alerts')
    return _serve_spa()

@construction_bp.route('/admin/alerts/delete/<int:alert_id>', methods=['POST'])
def admin_alerts_delete(alert_id):
    if session.get('role') not in ('admin', 'leader', 'village_leader'):
        return "권한 없음", 403
    alert = VillageAlert.query.get_or_404(alert_id)
    db.session.delete(alert)
    db.session.commit()
    return redirect('/admin/alerts')

@construction_bp.route('/admin/construction-notices')
def admin_construction_notices():
    if session.get('role') not in ('admin', 'leader'):
        return "권한 없음", 403
    return _serve_spa()

@construction_bp.route('/api/admin/construction-notices')
def api_admin_construction_notices():
    if session.get('role') not in ('admin', 'leader'):
        return jsonify({"error": "forbidden"}), 403
    notices = ConstructionNotice.query.order_by(
        ConstructionNotice.start_date.is_(None),
        ConstructionNotice.start_date.desc()
    ).all()
    out = [{
        "id": n.id, "title": n.title, "location": n.location,
        "notice_type": n.notice_type, "source": n.source,
        "start_date": n.start_date.strftime('%Y-%m-%d') if n.start_date else None,
        "end_date": n.end_date.strftime('%Y-%m-%d') if n.end_date else None,
        "is_active": n.is_active,
        "latitude": n.latitude, "longitude": n.longitude,
    } for n in notices]
    return jsonify({"notices": out})

@construction_bp.route('/api/admin/construction-notices/<int:notice_id>/toggle', methods=['POST'])
def api_admin_construction_notices_toggle(notice_id):
    if session.get('role') not in ('admin', 'leader'):
        return jsonify({"error": "forbidden"}), 403
    n = ConstructionNotice.query.get_or_404(notice_id)
    n.is_active = not n.is_active
    db.session.commit()
    return jsonify({"id": n.id, "is_active": n.is_active})

@construction_bp.route('/api/user/unread')
def api_user_unread():
    uid = session.get('user_id')
    if not uid: return jsonify({"count": 0})
    count = Message.query.filter_by(receiver_id=uid, is_read=False).count()
    return jsonify({"count": count})

@construction_bp.route('/api/construction/unread')
def api_construction_unread():
    uid = session.get('user_id')
    user = User.query.get(uid) if uid else None
    alerts = 0
    if user and user.town:
        alerts = VillageAlert.query.filter_by(is_active=True, town=user.town).count()
    return jsonify({"alerts": alerts, "heritage": 0, "scenery": 0})

@construction_bp.route('/construction/safetydata')
def construction_safetydata():
    from services.safetydata import get_yangpyeong_safety, TYPE_NAMES
    data = get_yangpyeong_safety()
    total = sum(len(v) for v in data.values())
    return jsonify({"available": True, "total": total, "types": {k: {"name": TYPE_NAMES.get(k,k), "items": v[:10]} for k, v in data.items() if v}}) 

@construction_bp.route('/api/user/location', methods=['GET','POST'])
def api_user_location():
    if request.method == 'POST':
        uid = session.get('user_id')
        if not uid: return jsonify({"status":"error","msg":"login"})
        user = User.query.get(uid)
        loc = request.get_json().get('manual_loc','')
        if not loc: return jsonify({"status":"error","msg":"need location"})
        parts = loc.strip().split()
        if len(parts) >= 2:
            user.curr_town = parts[0]
            user.curr_village = parts[1]
            user.location_updated_at = datetime.now()
            db.session.commit()
            return jsonify({"status":"success","msg":"ok"})
        return jsonify({"status":"error","msg":"format"})
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "login"}), 401
    from models import User
    user = User.query.get(uid)
    if not user:
        return jsonify({"error": "not_found"}), 404
    return jsonify({"town": user.curr_town or "", "village": user.curr_village or "", "address": user.curr_address or "", "home_town": user.town or "", "home_village": user.village or ""})

@construction_bp.route('/construction/refresh')
def construction_refresh():
    if session.get('role') not in ('admin', 'leader'):
        return "권한 없음", 403
    from flask import current_app
    from config import Config
    dg_key = getattr(Config, 'DATA_GO_KR_API_KEY', '')
    gg_key = getattr(Config, 'GG_TRAFFIC_API_KEY', '')
    build_key = getattr(Config, 'GG_BUILDING_API_KEY', '')
    arch_hub_key = getattr(Config, 'ARCH_HUB_API_KEY', '')
    odcloud_key = getattr(Config, 'ODCLOUD_API_KEY', '')
    if not dg_key and not gg_key and not build_key and not arch_hub_key:
        return "<script>alert('API 키가 설정되지 않았습니다. config.py를 확인하세요.'); history.back();</script>"
    import threading
    if dg_key:
        threading.Thread(target=sync_construction_notices, args=(current_app._get_current_object(), dg_key)).start()
    if gg_key:
        threading.Thread(target=sync_traffic_incidents, args=(current_app._get_current_object(), gg_key)).start()
        threading.Thread(target=sync_congestion_info, args=(current_app._get_current_object(), gg_key)).start()
    if build_key:
        from services.construction import sync_building_permits
        threading.Thread(target=sync_building_permits, args=(current_app._get_current_object(), build_key)).start()
    if arch_hub_key:
        from services.construction import sync_architecture_hub
        threading.Thread(target=sync_architecture_hub, args=(current_app._get_current_object(), arch_hub_key)).start()
    if odcloud_key:
        from services.construction import sync_odcloud_building
        threading.Thread(target=sync_odcloud_building, args=(current_app._get_current_object(), odcloud_key)).start()
    from services.construction import geocode_missing_notices
    threading.Thread(target=geocode_missing_notices, args=(current_app._get_current_object(),)).start()
    return "<script>alert('정보 갱신이 시작되었습니다.'); location.href='/construction';</script>"

# --- [상시 서비스 3종] ---


def _unit_of(loc):
    if not loc:
        return ''
    s = str(loc).replace('경기도', '').replace('양평군', '')
    for suf in ('면', '읍', '동', '리'):
        i = s.find(suf)
        if i >= 0:
            return s[max(0, i - 4):i + 1].strip()
    return ''

@construction_bp.route('/api/construction/notices')
def api_construction_notices():
    # 도로명 주소 누락 시 백그라운드 역지오코딩 1회 자동 수행
    global _ADDR_BACKFILL_RUNNING
    if not _ADDR_BACKFILL_RUNNING:
        try:
            missing = ConstructionNotice.query.filter(
                ConstructionNotice.is_active == True,
                db.or_(ConstructionNotice.address.is_(None), ConstructionNotice.address == ''),
            ).first()
            if missing:
                _ADDR_BACKFILL_RUNNING = True
                from services.construction import geocode_missing_notices
                import threading
                def _run():
                    try:
                        geocode_missing_notices(current_app._get_current_object())
                    finally:
                        global _ADDR_BACKFILL_RUNNING
                        _ADDR_BACKFILL_RUNNING = False
                threading.Thread(target=_run).start()
        except Exception:
            _ADDR_BACKFILL_RUNNING = False
    notices = ConstructionNotice.query.filter(
        ConstructionNotice.is_active == True
    ).all()
    gps_lat = request.args.get('lat', type=float)
    gps_lng = request.args.get('lng', type=float)
    ref_lat = ref_lng = None
    town = village = ''
    uid = session.get('user_id')
    user = User.query.get(uid) if uid else None
    if gps_lat and gps_lng:
        ref_lat, ref_lng = gps_lat, gps_lng
        try:
            from services.geocode import gps_to_town_village
            t, v = gps_to_town_village(gps_lat, gps_lng)
            town, village = t or '', v or ''
        except Exception:
            pass
    else:
        if user and (user.curr_latitude or user.reg_latitude):
            ref_lat = user.curr_latitude or user.reg_latitude
            ref_lng = user.curr_longitude or user.reg_longitude
            town = user.curr_town or ''
            village = user.curr_village or ''
    user_unit = _unit_of(village or (getattr(user, 'curr_address', '') if user else '') or '')
    out = []
    for n in notices:
        d = None
        if ref_lat and n.latitude and n.longitude:
            d = round(haversine_km(ref_lat, ref_lng, n.latitude, n.longitude), 1)
        out.append({
            "id": n.id, "title": n.title, "description": n.description,
            "location": n.location, "address": n.address, "latitude": n.latitude, "longitude": n.longitude,
            "notice_type": n.notice_type, "source": n.source,
            "start_date": n.start_date.strftime('%Y-%m-%d') if n.start_date else None,
            "end_date": n.end_date.strftime('%Y-%m-%d') if n.end_date else None,
            "distance_km": d,
            "unit": _unit_of(n.location),
        })
    if ref_lat:
        out.sort(key=lambda x: (
            0 if (user_unit and x['unit'] == user_unit) else 1,
            x['distance_km'] if x['distance_km'] is not None else 999,
            -int((x['start_date'] or '0000-00-00').replace('-', '') or 0),
        ))
    return jsonify({"notices": out, "town": town, "village": village,
                    "based_on": "gps" if (gps_lat and gps_lng) else "home"})

@construction_bp.route('/api/construction/alerts')
def api_construction_alerts():
    alerts = VillageAlert.query.filter_by(is_active=True).order_by(VillageAlert.created_at.desc()).limit(20).all()
    out = [{
        "id": a.id, "title": a.title, "content": a.content,
        "alert_type": a.alert_type, "urgency": a.urgency,
        "town": a.town, "village": a.village,
        "created_at": a.created_at.strftime('%Y-%m-%d %H:%M') if a.created_at else None,
    } for a in alerts]
    return jsonify({"alerts": out})

@construction_bp.route('/api/facilities')
def api_facilities():
    ftype = request.args.get('type', 'toilet')
    facs = PublicFacility.query.filter_by(facility_type=ftype, is_active=True).all()
    uid = session.get('user_id')
    home_lat = home_lng = None
    if uid:
        user = User.query.get(uid)
        if user and (user.curr_latitude or user.reg_latitude):
            home_lat = user.curr_latitude or user.reg_latitude
            home_lng = user.curr_longitude or user.reg_longitude
    out = []
    for f in facs:
        d = None
        if home_lat and f.latitude and f.longitude:
            d = round(haversine_km(home_lat, home_lng, f.latitude, f.longitude), 1)
        out.append({
            "id": f.id, "name": f.name, "address": f.address,
            "latitude": f.latitude, "longitude": f.longitude,
            "open_hr": f.open_hr, "tel": f.tel, "manager": f.manager,
            "emergency_bell": f.emergency_bell, "cctv": f.cctv,
            "facility_type": f.facility_type, "distance_km": d,
            "is_community": f.is_community, "status": f.status,
            "verified_count": f.verified_count, "reject_count": f.reject_count,
            "notes": f.notes, "photo_url": f.photo_url,
            "submitted_by": f.submitted_by,
        })
    if home_lat:
        out.sort(key=lambda x: x['distance_km'] if x['distance_km'] is not None else 999)
    return jsonify({"facilities": out, "type": ftype})


@construction_bp.route('/api/geocode')
def api_geocode():
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify({"error": "주소를 입력하세요."}), 400
    from config import Config
    from services.transit import geocode_address
    geo = geocode_address(q, Config.KAKAO_REST_API_KEY, Config.NAVER_SEARCH_CLIENT_ID or Config.NAVER_CLIENT_ID, Config.NAVER_SEARCH_CLIENT_SECRET or Config.NAVER_CLIENT_SECRET)
    if not geo or not geo.get("lat"):
        return jsonify({"error": "주소를 찾지 못했습니다."}), 404
    return jsonify({"lat": geo["lat"], "lng": geo["lng"], "address": geo.get("address") or q})


@construction_bp.route('/api/facilities/map')
def api_facilities_map():
    ftype = request.args.get('type', 'toilet')
    facs = PublicFacility.query.filter_by(is_active=True)
    if ftype and ftype not in ('all', 'ALL'):
        types = [t.strip() for t in ftype.split(',') if t.strip()]
        if types:
            facs = facs.filter(PublicFacility.facility_type.in_(types))
    facs = facs.all()
    uid = session.get('user_id')
    user_reports = {}
    home_lat = home_lng = None
    if uid:
        user = User.query.get(uid)
        if user and (user.curr_latitude or user.reg_latitude):
            home_lat = user.curr_latitude or user.reg_latitude
            home_lng = user.curr_longitude or user.reg_longitude
        reports = FacilityReport.query.filter_by(user_id=uid).all()
        for r in reports:
            user_reports[r.facility_id] = r.report_type
    items = []
    for f in facs:
        d = None
        if home_lat and f.latitude and f.longitude:
            d = round(haversine_km(home_lat, home_lng, f.latitude, f.longitude), 1)
        items.append({
            "id": f.id, "name": f.name, "lat": f.latitude, "lng": f.longitude,
            "address": f.address, "status": f.status or 'active',
            "is_community": f.is_community, "source": f.source,
            "verified_count": f.verified_count or 0, "reject_count": f.reject_count or 0,
            "open_hr": f.open_hr, "tel": f.tel, "notes": f.notes,
            "my_report": user_reports.get(f.id), "distance_km": d,
            "gender_type": f.gender_type or 'mixed', "accessible": f.accessible or False,
            "facility_type": f.facility_type or 'toilet',
        })
    if home_lat:
        items.sort(key=lambda x: x['distance_km'] if x['distance_km'] is not None else 999)
    items = items[:200]
    from config import Config
    return jsonify({"facilities": items, "type": ftype,
                    "naver_map_key": Config.NAVER_MAP_CLIENT_ID})


@construction_bp.route('/api/facilities', methods=['POST'])
def api_facilities_create():
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    data = request.get_json()
    name = (data.get('name') or '').strip()
    try:
        lat = float(data.get('latitude'))
        lng = float(data.get('longitude'))
    except (TypeError, ValueError):
        lat = lng = None
    if not name or not lat or not lng:
        return jsonify({"error": "이름과 위치가 필요합니다."}), 400
    f = PublicFacility(
        facility_type=data.get('facility_type', 'toilet'),
        name=name, address=(data.get('address') or '').strip(),
        latitude=lat, longitude=lng,
        open_hr=(data.get('open_hr') or '').strip(),
        tel=(data.get('tel') or '').strip(),
        notes=(data.get('notes') or '').strip(),
        gender_type=data.get('gender_type') or 'mixed',
        accessible=bool(data.get('accessible', False)),
        source='community', is_community=True, submitted_by=uid,
        status='active',
    )
    db.session.add(f)
    db.session.commit()
    return jsonify({"success": True, "id": f.id, "msg": "화장실이 등록되었습니다."})


@construction_bp.route('/api/facilities/<int:fid>', methods=['PUT'])
def api_facilities_update(fid):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    f = PublicFacility.query.get_or_404(fid)
    role = session.get('role', '')
    if f.is_community:
        # 주민 등록 시설은 등록자 본인 또는 관리자/마을지기만 수정 가능
        if f.submitted_by != uid and role not in ('admin', 'leader'):
            return jsonify({"error": "수정 권한이 없습니다."}), 403
    else:
        # 공공 시설은 관리자/마을지기만 수정 가능
        if role not in ('admin', 'leader'):
            return jsonify({"error": "수정 권한이 없습니다."}), 403
    data = request.get_json()
    for field in ['name', 'address', 'open_hr', 'tel', 'notes', 'status', 'photo_url', 'gender_type']:
        if field in data:
            setattr(f, field, (data[field] or '').strip() if isinstance(data[field], str) else data[field])
    if 'accessible' in data:
        f.accessible = bool(data['accessible'])
    for field in ['latitude', 'longitude']:
        if field in data and data[field] is not None:
            setattr(f, field, float(data[field]))
    f.updated_at = datetime.now()
    db.session.commit()
    return jsonify({"success": True, "msg": "수정되었습니다."})


@construction_bp.route('/api/facilities/<int:fid>/report', methods=['POST'])
def api_facilities_report(fid):
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    f = PublicFacility.query.get_or_404(fid)
    data = request.get_json()
    report_type = data.get('report_type', '')
    comment = (data.get('comment') or '').strip()
    if report_type not in ('verify', 'reject', 'memo'):
        return jsonify({"error": "잘못된 보고 유형입니다."}), 400
    existing = FacilityReport.query.filter_by(facility_id=fid, user_id=uid, report_type=report_type).first()
    if existing:
        existing.comment = comment
        existing.created_at = datetime.now()
    else:
        r = FacilityReport(facility_id=fid, user_id=uid, report_type=report_type, comment=comment)
        db.session.add(r)
    if report_type == 'verify':
        f.verified_count = (f.verified_count or 0) + (0 if existing else 1)
    elif report_type == 'reject':
        f.reject_count = (f.reject_count or 0) + (0 if existing else 1)
    db.session.commit()
    return jsonify({"success": True, "msg": "보고가 접수되었습니다.",
                    "verified_count": f.verified_count, "reject_count": f.reject_count})

@construction_bp.route('/construction/refresh-facilities', methods=['POST'])
def refresh_facilities():
    if session.get('role') not in ('admin', 'leader'):
        return jsonify({"error": "권한 없음"}), 403
    from config import Config
    key = getattr(Config, 'GG_PUBLTOLT_API_KEY', '') or getattr(Config, 'SAFEMAP_API_KEY', '')
    if not key:
        return jsonify({"error": "API 키 미설정"}), 400
    from services.construction import sync_public_facilities
    sync_public_facilities(current_app._get_current_object(), key)
    return jsonify({"status": "success", "msg": "편의시설 동기화 완료"})


# ── 네이버 플레이스 자동 검색 ──

@construction_bp.route('/construction/naver-search')
def naver_place_search():
    """좌표 기반 네이버 로컬 검색 — 가게 자동 등록용"""
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    lat = request.args.get('lat', type=float)
    lng = request.args.get('lng', type=float)
    query = request.args.get('query', '').strip()
    if not lat or not lng:
        return jsonify({"error": "좌표가 필요합니다."}), 400

    naver_id = Config.NAVER_SEARCH_CLIENT_ID or getattr(Config, 'NAVER_CLIENT_ID', '')
    naver_secret = Config.NAVER_SEARCH_CLIENT_SECRET or getattr(Config, 'NAVER_CLIENT_SECRET', '')

    # 1) 역지오코딩으로 주소 획득
    from services.transit import reverse_geocode
    geo = reverse_geocode(lat, lng, naver_id=naver_id, naver_secret=naver_secret)
    address = geo.get('address', '') if geo else ''

    # 2) 네이버 로컬 검색
    results = []
    if naver_id and naver_secret:
        import requests as _req
        search_query = query or address or f"양평 음식점"
        try:
            r = _req.get(
                'https://openapi.naver.com/v1/search/local.json',
                headers={
                    'X-Naver-Client-Id': naver_id,
                    'X-Naver-Client-Secret': naver_secret,
                },
                params={'query': search_query, 'display': 10,
                        'x': str(lng), 'y': str(lat)},
                timeout=10,
            )
            if r.status_code == 200:
                items = r.json().get('items', [])
                for item in items:
                    results.append({
                        'name': item.get('title', '').replace('<b>', '').replace('</b>', ''),
                        'category': item.get('category', ''),
                        'address': item.get('address', '') or item.get('roadAddress', ''),
                        'phone': item.get('telephone', ''),
                        'link': item.get('link', ''),
                        'mapx': item.get('mapx', ''),
                        'mapy': item.get('mapy', ''),
                        'dist': item.get('distance', ''),
                    })
        except Exception as e:
            current_app.logger.warning(f"네이버 로컬 검색 실패: {e}")

    return jsonify({
        'address': address,
        'results': results,
    })


@construction_bp.route('/construction/photo-nearby-stores')
def photo_nearby_stores():
    """사진 좌표 기반 네이버맵 100m 이내 가게 검색 (전체 또는 특정 사진)"""
    naver_id = Config.NAVER_SEARCH_CLIENT_ID or getattr(Config, 'NAVER_CLIENT_ID', '')
    naver_secret = Config.NAVER_SEARCH_CLIENT_SECRET or getattr(Config, 'NAVER_CLIENT_SECRET', '')
    if not naver_id or not naver_secret:
        return jsonify({"error": "네이버 API 키가 설정되지 않았습니다."}), 500

    import requests as _req

    photo_id = request.args.get('photo_id', type=int)
    town = request.args.get('town', '')
    village = request.args.get('village', '')

    if photo_id:
        photos = [ShareReport.query.get(photo_id)]
        photos = [p for p in photos if p and p.latitude and p.longitude]
    else:
        q = ShareReport.query.filter_by(status='approved')
        if town:
            q = q.filter_by(town=town)
        if village:
            q = q.filter_by(village=village)
        photos = q.filter(ShareReport.latitude.isnot(None), ShareReport.longitude.isnot(None)).all()

    results = []
    for p in photos[:30]:  # 최대 30장
        try:
            r = _req.get(
                'https://openapi.naver.com/v1/search/local.json',
                headers={
                    'X-Naver-Client-Id': naver_id,
                    'X-Naver-Client-Secret': naver_secret,
                },
                params={
                    'query': f'{p.town or "양평"} 음식점 카페',
                    'display': 10,
                    'x': str(p.longitude),
                    'y': str(p.latitude),
                },
                timeout=8,
            )
            if r.status_code == 200:
                items = r.json().get('items', [])
                stores = []
                for item in items:
                    mapx = int(item.get('mapx', 0)) / 1e7  # 네이버 microdegree → 도
                    mapy = int(item.get('mapy', 0)) / 1e7
                    dist_m = int(haversine_km(mapy, mapx, p.latitude, p.longitude) * 1000)
                    if dist_m <= 100:
                        stores.append({
                            'name': item.get('title', '').replace('<b>', '').replace('</b>', ''),
                            'category': item.get('category', ''),
                            'phone': item.get('telephone', ''),
                            'address': item.get('address', '') or item.get('roadAddress', ''),
                            'distance': dist_m,
                        })
                results.append({
                    'photo_id': p.id,
                    'title': p.title,
                    'lat': p.latitude,
                    'lng': p.longitude,
                    'stores': stores,
                })
        except Exception as e:
            current_app.logger.warning(f"사진 {p.id} 네이버 검색 실패: {e}")

    return jsonify({"results": results, "total": len(results)})


@construction_bp.route('/construction/auto-register-store', methods=['POST'])
def auto_register_store():
    """네이버 플레이스 검색 결과로 StoreInfo 자동 등록"""
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다."}), 401
    user = User.query.get(uid)
    if not user:
        return jsonify({"error": "사용자 없음"}), 400
    town = user.town or user.curr_town
    village = user.village or user.curr_village

    data = request.get_json() or {}
    name = data.get('name', '').strip()
    phone = data.get('phone', '').strip()
    address = data.get('address', '').strip()
    link = data.get('link', '').strip()
    mapx = data.get('mapx')  # 경도 (네이버 API 형식: 정수 * 10000000)
    mapy = data.get('mapy')  # 위도

    if not name:
        return jsonify({"error": "가게 이름이 필요합니다."}), 400

    # 네이버 좌표 → 십진수 변환
    lng = float(mapx) / 1e7 if mapx else None
    lat = float(mapy) / 1e7 if mapy else None

    # 중복 체크 (같은 이름 + 같은 동네)
    existing = StoreInfo.query.filter_by(name=name, town=town, village=village).first()
    if existing:
        return jsonify({"error": "이미 등록된 가게입니다.", "id": existing.id}), 409

    si = StoreInfo(
        name=name,
        latitude=lat,
        longitude=lng,
        town=town,
        village=village,
        phone=phone or None,
        our_link=link or None,
    )
    db.session.add(si)
    db.session.commit()
    return jsonify({"success": True, "id": si.id, "msg": f"'{name}' 가게가 등록되었습니다."})


# ─── 가게 이름 추천/투표 ───────────────────────────────────────────────
def _make_group_key(lat, lng):
    """좌표를 소수점 3자리로 반올림하여 그룹 키 생성 (约 110m 격자)"""
    return f"{round(float(lat), 3)}_{round(float(lng), 3)}"


@construction_bp.route('/construction/store-name-recommendations')
def store_name_recommendations():
    """특정 좌표 근처 가게 이름 추천 목록 반환"""
    lat = request.args.get('lat', '0')
    lng = request.args.get('lng', '0')
    group_key = _make_group_key(lat, lng)

    # 투표된 이름 목록 (vote_count 기준)
    from sqlalchemy import func
    rows = (
        db.session.query(StoreNameVote.name, func.count(StoreNameVote.id).label('votes'))
        .filter_by(group_key=group_key)
        .group_by(StoreNameVote.name)
        .order_by(func.count(StoreNameVote.id).desc())
        .all()
    )
    # 사용자 투표 현황
    uid = session.get('user_id')
    my_votes = set()
    if uid:
        my_votes = {v.name for v in StoreNameVote.query.filter_by(group_key=group_key, user_id=uid).all()}

    total_users = db.session.query(func.count(db.distinct(StoreNameVote.user_id))).filter_by(group_key=group_key).scalar() or 0

    recommendations = []
    for r in rows:
        pct = round(r.votes / total_users * 100, 1) if total_users else 0
        recommendations.append({
            "name": r.name,
            "votes": r.votes,
            "pct": pct,
            "voted": r.name in my_votes,
        })

    return jsonify({
        "group_key": group_key,
        "recommendations": recommendations,
        "total_users": total_users,
        "my_votes": list(my_votes),
    })


@construction_bp.route('/construction/store-name-suggest', methods=['POST'])
def store_name_suggest():
    """가게 이름 추천 등록 (또는 기존 이름에 투표)"""
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다"}), 401

    data = request.get_json(force=True)
    name = (data.get('name') or '').strip()
    lat = data.get('lat', 0)
    lng = data.get('lng', 0)

    if not name:
        return jsonify({"error": "이름을 입력하세요"}), 400
    if len(name) > 50:
        return jsonify({"error": "이름은 50자 이내로 입력하세요"}), 400

    group_key = _make_group_key(lat, lng)

    # 이미 해당 가게에서 이 이름을 추천했는지 확인
    existing = StoreNameVote.query.filter_by(group_key=group_key, name=name, user_id=uid).first()
    if existing:
        return jsonify({"error": "이미 추천하셨습니다", "voted": True}), 200

    vote = StoreNameVote(group_key=group_key, name=name, user_id=uid)
    db.session.add(vote)
    db.session.commit()
    return jsonify({"success": True, "msg": f"'{name}'을(를) 추천했습니다."})


@construction_bp.route('/construction/store-name-cancel-vote', methods=['POST'])
def store_name_cancel_vote():
    """추천 취소"""
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다"}), 401

    data = request.get_json(force=True)
    name = (data.get('name') or '').strip()
    lat = data.get('lat', 0)
    lng = data.get('lng', 0)
    group_key = _make_group_key(lat, lng)

    vote = StoreNameVote.query.filter_by(group_key=group_key, name=name, user_id=uid).first()
    if vote:
        db.session.delete(vote)
        db.session.commit()
    return jsonify({"success": True})


@construction_bp.route('/construction/store-name-apply', methods=['POST'])
def store_name_apply():
    """최다 득표 이름을 StoreInfo 이름으로 반영 (관리자 또는 일정 투표 수 이상)"""
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "로그인이 필요합니다"}), 401

    data = request.get_json(force=True)
    lat = data.get('lat', 0)
    lng = data.get('lng', 0)
    town = data.get('town', '')
    village = data.get('village', '')
    group_key = _make_group_key(lat, lng)

    # 최다 득표 이름 찾기
    from sqlalchemy import func
    top = (
        db.session.query(StoreNameVote.name, func.count(StoreNameVote.id).label('votes'))
        .filter_by(group_key=group_key)
        .group_by(StoreNameVote.name)
        .order_by(func.count(StoreNameVote.id).desc())
        .first()
    )
    if not top:
        return jsonify({"error": "추천된 이름이 없습니다"}), 400

    # 150m 이내 StoreInfo 찾아서 이름 업데이트
    store_infos = StoreInfo.query.filter_by(town=town, village=village).all()
    target = None
    for si in store_infos:
        if si.latitude and si.longitude:
            d = haversine_km(si.latitude, si.longitude, float(lat), float(lng))
            if d <= 0.15:
                target = si
                break

    if target:
        target.name = top[0]
        db.session.commit()
        return jsonify({"success": True, "name": top[0], "msg": f"가게 이름이 '{top[0]}'(으)로 변경되었습니다."})

    # StoreInfo 없으면 새로 생성
    si = StoreInfo(name=top[0], town=town, village=village, latitude=float(lat), longitude=float(lng))
    db.session.add(si)
    db.session.commit()
    return jsonify({"success": True, "name": top[0], "msg": f"가게 '{top[0]}'이(가) 새로 등록되었습니다."})


# ─── 관리자: 사진 정보 수정 검토 ──────────────────────────────────────
@construction_bp.route('/construction/admin/reviews')
def admin_store_reviews():
    """관리자용 검토 대기 목록"""
    uid = session.get('user_id')
    user = User.query.get(uid) if uid else None
    if not user or not user.is_admin:
        return jsonify({"error": "관리자만 접근 가능합니다."}), 403

    status = request.args.get('status', 'pending')
    reviews = StoreInfoReview.query.filter_by(status=status).order_by(StoreInfoReview.created_at.desc()).all()

    result = []
    for r in reviews:
        photo = ShareReport.query.get(r.photo_id)
        reporter = User.query.get(r.reporter_id)
        result.append({
            "id": r.id,
            "photo_id": r.photo_id,
            "photo_image": photo.image_path if photo else None,
            "photo_title": photo.title if photo else "",
            "store_name": "",
            "comment": r.comment,
            "reporter_name": reporter.nickname if reporter else "익명",
            "status": r.status,
            "created_at": r.created_at.strftime('%m/%d %H:%M') if r.created_at else "",
        })
        # 사진 좌표로 StoreInfo 매칭
        if photo and photo.latitude and photo.longitude:
            for si in StoreInfo.query.all():
                if si.latitude and si.longitude and haversine_km(photo.latitude, photo.longitude, si.latitude, si.longitude) <= 0.15:
                    result[-1]["store_name"] = si.name
                    break

    return jsonify({"reviews": result, "total": len(result)})


@construction_bp.route('/construction/admin/review/<int:review_id>/<string:action>', methods=['POST'])
def admin_review_action(review_id, action):
    """관리자 검토 반영/반려"""
    uid = session.get('user_id')
    user = User.query.get(uid) if uid else None
    if not user or not user.is_admin:
        return jsonify({"error": "관리자만 접근 가능합니다."}), 403

    review = StoreInfoReview.query.get(review_id)
    if not review:
        return jsonify({"error": "검토 요청을 찾을 수 없습니다."}), 404
    if review.status != 'pending':
        return jsonify({"error": "이미 처리된 요청입니다."}), 400

    review.status = 'approved' if action == 'approve' else 'rejected'
    review.reviewed_by = uid
    review.reviewed_at = datetime.now()

    # 반영 시: 정보 제공자에게 1니아 보상
    if action == 'approve':
        reporter = User.query.get(review.reporter_id)
        if reporter:
            reporter.points = (reporter.points or 0) + 1
            review.reward_given = True

    db.session.commit()

    return jsonify({
        "success": True,
        "msg": f"{'반영' if action == 'approve' else '반려'} 완료" + (f" (제공자 {review.reporter_id}번에게 1니아 지급)" if action == 'approve' else ""),
    })
