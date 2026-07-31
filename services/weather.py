import requests
import json
import math
from datetime import datetime, timedelta
from flask import current_app

OPENWEATHER_URL = "https://api.openweathermap.org/data/2.5/weather"
OPENWEATHER_AIR_URL = "https://api.openweathermap.org/data/2.5/air_pollution"

YANGPYEONG_LOCATIONS = {
    "양평읍": {"lat": 37.4889, "lon": 127.4903},
    "옥천면": {"lat": 37.5200, "lon": 127.4400},
    "서종면": {"lat": 37.5600, "lon": 127.4000},
    "단월면": {"lat": 37.5700, "lon": 127.5500},
    "개군면": {"lat": 37.4600, "lon": 127.5200},
    "강상면": {"lat": 37.4400, "lon": 127.4700},
    "강하면": {"lat": 37.4300, "lon": 127.4300},
    "지평면": {"lat": 37.4700, "lon": 127.5800},
    "용문면": {"lat": 37.5300, "lon": 127.5800},
    "원덕면": {"lat": 37.5600, "lon": 127.6000},
}

_cache = {}
_cache_ttl = 1800

UV_LABELS = [
    ((0, 2), "낮음", "🟢"),
    ((3, 5), "보통", "🟡"),
    ((6, 7), "높음", "🟠"),
    ((8, 10), "매우높음", "🔴"),
    ((11, 20), "위험", "🟣"),
]


def _estimate_uvIndex(cloud_pct, hour):
    base_uv = 0
    if 6 <= hour <= 18:
        solar_noon = 12.5
        dist = abs(hour - solar_noon)
        base_uv = max(0, 10 * math.exp(-0.5 * (dist / 3.5) ** 2))
    month = datetime.now().month
    if month in (6, 7, 8):
        base_uv *= 1.2
    elif month in (12, 1, 2):
        base_uv *= 0.4
    if cloud_pct > 80:
        base_uv *= 0.3
    elif cloud_pct > 50:
        base_uv *= 0.5
    elif cloud_pct > 20:
        base_uv *= 0.75
    return round(base_uv, 1)


def _uv_label(uv):
    for (lo, hi), label, emoji in UV_LABELS:
        if lo <= uv <= hi:
            return f"{emoji} {label}"
    return "🟢 낮음"


AQI_LABELS = [
    (1, "좋음", "🟢"),
    (2, "보통", "🟡"),
    (3, "나쁨", "🟠"),
    (4, "매우나쁨", "🔴"),
    (5, "위험", "🟣"),
]


def _aqi_label(aqi):
    for v, label, emoji in AQI_LABELS:
        if aqi == v:
            return f"{emoji} {label}"
    return "🟢 좋음"


def _o3_label(o3_ug):
    # 오존 시간평균 (µg/m³ → ppb 기준 근사 등급)
    try:
        o3 = float(o3_ug)
    except (TypeError, ValueError):
        return "🟢 좋음"
    if o3 < 60:
        return "🟢 좋음"
    if o3 < 100:
        return "🟡 보통"
    if o3 < 160:
        return "🟠 나쁨"
    if o3 < 200:
        return "🔴 매우나쁨"
    return "🟣 위험"


def _pm_label(pm, unit="µg/m³"):
    try:
        v = float(pm)
    except (TypeError, ValueError):
        return "🟢 좋음"
    if v < 15:
        return "🟢 좋음"
    if v < 35:
        return "🟡 보통"
    if v < 75:
        return "🟠 나쁨"
    return "🔴 매우나쁨"


def get_air_quality(lat, lon):
    cache_key = f"air_{lat}_{lon}"
    if cache_key in _cache:
        cached_data, cached_time = _cache[cache_key]
        if (datetime.now() - cached_time).total_seconds() < _cache_ttl:
            return cached_data
    api_key = current_app.config.get("OPENWEATHER_API_KEY", "")
    if not api_key:
        return None
    try:
        res = requests.get(OPENWEATHER_AIR_URL, params={
            "lat": lat, "lon": lon, "appid": api_key,
        }, timeout=15)
        if res.status_code != 200:
            print(f"[Air] API 오류: {res.status_code}")
            return None
        data = res.json()
        lst = (data.get("list") or [{}])[0]
        main = lst.get("main", {})
        comp = lst.get("components", {})
        aqi = main.get("aqi", 0)
        air = {
            "aqi": aqi,
            "aqi_text": _aqi_label(aqi),
            "pm10": comp.get("pm10", 0),
            "pm25": comp.get("pm2_5", 0),
            "o3": comp.get("o3", 0),
            "o3_text": _o3_label(comp.get("o3", 0)),
            "no2": comp.get("no2", 0),
        }
        _cache[cache_key] = (air, datetime.now())
        return air
    except Exception as e:
        print(f"[Air] API 오류: {e}")
        return None


def get_weather(town="양평읍"):
    cache_key = f"weather_{town}"
    if cache_key in _cache:
        cached_data, cached_time = _cache[cache_key]
        if (datetime.now() - cached_time).total_seconds() < _cache_ttl:
            return cached_data

    api_key = current_app.config.get("OPENWEATHER_API_KEY", "")
    if not api_key:
        return None

    loc = YANGPYEONG_LOCATIONS.get(town, YANGPYEONG_LOCATIONS["양평읍"])
    params = {
        "lat": loc["lat"],
        "lon": loc["lon"],
        "appid": api_key,
        "units": "metric",
        "lang": "kr",
    }

    try:
        res = requests.get(OPENWEATHER_URL, params=params, timeout=15)
        if res.status_code != 200:
            print(f"[Weather] API 오류: {res.status_code}")
            return None
        data = res.json()

        main = data.get("main", {})
        weather_list = data.get("weather", [{}])
        wind = data.get("wind", {})
        rain = data.get("rain", {})
        clouds = data.get("clouds", {})
        sys_data = data.get("sys", {})
        weather_desc = weather_list[0] if weather_list else {}

        condition_code = weather_desc.get("id", 800)
        description = weather_desc.get("description", "맑음")
        temp = round(main.get("temp", 0))
        feels_like = round(main.get("feels_like", 0))
        temp_min = round(main.get("temp_min", temp))
        temp_max = round(main.get("temp_max", temp))
        humidity = main.get("humidity", 0)
        wind_speed = wind.get("speed", 0)
        cloud_pct = clouds.get("all", 0)
        rain_1h = rain.get("1h", 0)

        now = datetime.now()
        uv = _estimate_uvIndex(cloud_pct, now.hour)
        uv_text = _uv_label(uv)

        pop = 0
        if condition_code < 600:
            pop = min(90, humidity)
        elif condition_code < 700:
            pop = 95
        elif condition_code < 800:
            pop = min(60, humidity // 2)

        rain_info = ""
        if rain_1h > 0:
            rain_info = f"최근1시간 {rain_1h}mm"
        elif pop >= 70:
            rain_info = f"강수확률 {pop}%"
        elif pop >= 40:
            rain_info = f"강수확률 {pop}%"

        if condition_code < 300:
            icon, kr_condition = "⛈️", "뇌우"
        elif condition_code < 500:
            icon, kr_condition = "🌧️", "비"
        elif condition_code < 600:
            icon, kr_condition = "🌧️", "소나기"
        elif condition_code < 700:
            icon, kr_condition = "❄️", "눈"
        elif condition_code < 800:
            icon, kr_condition = "☁️", "흐림"
        elif condition_code == 800:
            icon, kr_condition = "☀️", "맑음"
        elif condition_code < 803:
            icon, kr_condition = "⛅", "구름조금"
        else:
            icon, kr_condition = "☁️", "구름많음"

        sunrise = sys_data.get("sunrise", 0)
        sunset = sys_data.get("sunset", 0)
        sunrise_str = datetime.fromtimestamp(sunrise).strftime("%H:%M") if sunrise else ""
        sunset_str = datetime.fromtimestamp(sunset).strftime("%H:%M") if sunset else ""

        weather = {
            "town": town,
            "temperature": str(temp),
            "feels_like": str(feels_like),
            "temp_min": str(temp_min),
            "temp_max": str(temp_max),
            "humidity": str(humidity),
            "precipitation_prob": str(pop),
            "precipitation": str(rain_1h),
            "sky": kr_condition,
            "condition": kr_condition,
            "wind_speed": str(wind_speed),
            "cloud": str(cloud_pct),
            "uv_index": str(uv),
            "uv_text": uv_text,
            "rain_info": rain_info,
            "sunrise": sunrise_str,
            "sunset": sunset_str,
            "icon": icon,
            "description": description,
            "summary": f"{icon} {town} {kr_condition} {temp}°C",
            "detail": f"체감 {feels_like}°C · 습도 {humidity}% · 바람 {wind_speed}m/s · 강수 {pop}% · 자외선 {uv_text}",
            "updated_at": now.isoformat(),
        }

        air = get_air_quality(loc["lat"], loc["lon"])
        if air:
            weather["air"] = air
            weather["air_text"] = air["aqi_text"]
            weather["pm10"] = air["pm10"]
            weather["pm25"] = air["pm25"]
            weather["o3"] = air["o3"]
            weather["o3_text"] = air["o3_text"]

        _cache[cache_key] = (weather, now)
        return weather

    except Exception as e:
        print(f"[Weather] API 오류: {e}")
        return None


def get_all_village_weather():
    results = {}
    for town in YANGPYEONG_LOCATIONS:
        w = get_weather(town)
        if w:
            results[town] = w
    return results


def get_daily_weather_tip(weather):
    if not weather:
        return ""
    tips = []
    try:
        temp = int(weather.get("temperature", 20))
        pop = int(weather.get("precipitation_prob", 0))
        condition = weather.get("condition", "맑음")
        uv = float(weather.get("uv_index", 0))

        if temp >= 33:
            tips.append("폭염! 물·그늘 필수")
        elif temp >= 28:
            tips.append("더움. 수분 충전")
        elif temp <= 0:
            tips.append("추위! 따뜻히")
        elif temp <= 5:
            tips.append("쌀쌀. 겉옷 필수")

        if pop >= 70:
            tips.append("우산 필수")
        elif pop >= 40:
            tips.append("우산 준비")

        if uv >= 8:
            tips.append("자외선 매우높음")
        elif uv >= 6:
            tips.append("자외선 높음")

        if "뇌우" in condition:
            tips.append("천둥번개 주의")
    except:
        pass
    return " · ".join(tips) if tips else ""
