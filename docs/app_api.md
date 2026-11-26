# 모바일 앱 API (`/api/app/*`)

작성일: 2026-11-24
대상: React Native(Expo) 앱 개발
백엔드: 기존 Flask 앱(`~/yp_parity/yp_project`)에 추가된 앱 전용 API

## 1. 공통

- Base URL: `https://unocum.kr/api/app`
- 인증: `Authorization: Bearer <JWT>` (웹 세션 쿠키와 분리)
- 토큰 만료: **30일 단일 토큰**(`APP_JWT_DAYS`로 조정). 갱신 API 없음 → 401 시 재로그인
- 로그인 실패 제한: 이메일 기준 **5회/15분** → 6번째부터 `429` + `retry_after_sec: 900`
- 응답 시간은 서버 로컬(KST) 기준 `YYYY-MM-DDTHH:MM:SS` (타임존 표기 없음)
- 좌표·이메일 원문은 로그에 남기지 않음

### 공통 오류

| HTTP | error | 의미 |
|---|---|---|
| 400 | `*_required`, `invalid_*` | 필수값/형식 오류 |
| 401 | `unauthorized`, `invalid_credentials` | 토큰 없음/만료, 로그인 실패 |
| 403 | `forbidden_plan` | 다른 사용자의 일정 참조 |
| 404 | `not_found` | 일정 없음 |
| 409 | `schedule_conflict`, `route_not_ready` | 시간 충돌, 경로 미생성 |
| 422 | `route_not_ready`, `location_not_found` | 좌표 확인 불가 |
| 429 | `too_many_attempts` | 로그인 실패 제한 |
| 503 | `no_candidates` | 추천 경로 계산 불가(교통 API 장애/쿼터) |

## 2. 인증

### POST `/login`

```json
{ "email": "user@example.com", "password": "plain-password" }
```

```json
{
  "token": "eyJ...",
  "token_type": "Bearer",
  "expires_at": "2026-12-24T14:29:08+00:00",
  "user": { "id": 1, "username": "...", "email": "...", "real_name": "...", "town": "...", "village": "..." }
}
```

- 기존 `User` 테이블 재사용. `password_v2` 계정은 웹과 동일하게 `SHA-256('ypsite_2026_client_hash' + password)`로 검증
- 앱은 토큰을 Keychain(iOS)/Keystore(Android)에 저장

## 3. 오늘 / 일정

### GET `/today`

```json
{
  "date": "2026-11-25",
  "now": "2026-11-25T09:00:00",
  "schedules": [ /* schedule 객체 */ ],
  "next_transport": {
    "schedule_id": 100, "occurrence_id": null, "title": "서울역 업무 이동",
    "depart_at": "2026-11-25T09:20:00", "arrive_at": "2026-11-25T10:50:00",
    "minutes_until_departure": 20,
    "departure_location": "...", "arrival_location": "..."
  },
  "departure_alarms": [
    { "schedule_id": 101, "occurrence_id": null, "title": "미팅",
      "alarm_at": "2026-11-25T13:30:00", "minutes_before": 30, "status": "scheduled" }
  ]
}
```

- `next_transport`는 아직 지나지 않은 첫 이동/귀가 일정
- `departure_alarms`는 **서버가 아는 예약 정보**일 뿐이며, 실제 울림은 앱이 `expo-notifications`로 로컬 예약한다

### GET `/schedules?from=YYYY-MM-DD&to=YYYY-MM-DD`

- 최대 366일
- 반복 일정은 발생일마다 1건씩 펼쳐서 반환 (`occurrence_id` 예: `12880_20261203`)
- `id`는 원본(시리즈) 일정 ID. 반복 발생 건 수정/삭제 시 `id` + `occurrence_date` 사용

### schedule 객체

```json
{
  "id": 12876, "occurrence_id": null, "occurrence_date": null,
  "kind": "base", "title": "미팅", "location": "...", "description": "...",
  "start_at": "2026-11-25T14:00:00", "end_at": "2026-11-25T16:00:00",
  "all_day": false, "busy": true, "status": "active", "source": "",
  "departure_location": "", "return_location": "",
  "is_move": false, "route_kind": null,
  "repeat": { "enabled": false, "type": "", "interval": 1, "weekdays": 0,
               "week_of_month": 0, "month_of_year": 0, "last_day": false,
               "infinite": false, "end_at": null, "exceptions": "" },
  "alarm_minutes": 30, "alarm_at": "2026-11-25T13:30:00",
  "route": { "total_min": 52, "transfers": 1, "walk_min": 12, "wait_min": 4,
             "departure": "13:08", "arrival": "14:00", "distance_km": 28.4, "steps": 5 }
}
```

- `kind`: `base`(일반 일정) / `route`(자동 생성 이동·귀가) / `custom_route`(사용자 수정 경로)
- `route` 요약은 이동/귀가 일정에만 채워짐
- 반복 일정의 `repeat.end_at`은 반복 종료일

### POST `/schedules`

```json
{
  "title": "서울역 업무",
  "location": "서울특별시 중구 한강대로 405",
  "start_at": "2026-11-27T10:00:00",
  "end_at": "2026-11-27T12:00:00",
  "description": "",
  "memo": "",
  "all_day": false,
  "busy": true,
  "alarm_minutes": 30,
  "is_recurring": true,
  "repeat_type": "daily",           // daily | weekly | monthly | yearly
  "repeat_interval": 1,
  "repeat_weekdays": 0,             // bitmask Mon=1<<0 .. Sun=1<<6
  "repeat_week_of_month": 0,
  "repeat_month_of_year": 0,
  "repeat_lastday": false,
  "repeat_infinite": false,
  "repeat_end_at": "2026-12-07T12:00:00",
  "departure_location": "", "return_location": ""
}
```

응답 `201 {"success": true, "id": 12877, "warning": null}`

- `busy=true` 일반 일정은 시간 충돌 시 `409` (이동/귀가 일정은 충돌 검사 제외)
- 저장 후 서버가 백그라운드로 이동/귀가 경로를 재생성한다(비동기). 경로는 `kind=route` 일정으로 생성됨
- `warning: "장소가 분명하지 않습니다"`는 지오코딩 실패 안내

### PUT `/schedules/:id`

- 위 필드 중 변경할 값만 전송
- 반복 일정의 `end_at`은 1회 종료시각, `repeat_end_at`은 반복 종료일
- 이동/귀가 일정의 `memo`를 직접 수정하면 `custom_route`로 전환되어 자동 재생성에서 제외

### DELETE `/schedules/:id?mode=all|this_only|this_after&date=YYYY-MM-DD`

- 반복 일정: `this_only`(해당 발생일 제외), `this_after`(해당일 이후 종료), `all`(전체)
- 단건 일정: 쿼리 없이 삭제

## 4. 경로 / 체크인

### GET `/route/:scheduleId`

- 일반 일정 ID를 넘겨도 같은 날짜의 자동 경로 일정을 찾아 반환
- 자동 경로가 없으면 서버가 즉시 계획을 계산(`generated: true`, 저장하지 않음)

```json
{
  "schedule": { /* route 일정 */ },
  "plan": {
    "steps": [
      { "mode": "🚶 도보", "from": "...", "to": "양평역", "time_min": 7,
        "from_lat": 37.49, "from_lng": 127.48, "to_lat": 37.49, "to_lng": 127.49 },
      { "mode": "🚄 지하철", "from": "양평역", "to": "서울역", "time_min": 55,
        "detail": "경의중앙선 ...", "subway_name": "경의중앙선" }
    ],
    "total_min": 62, "departure": "09:08", "arrival": "10:10",
    "distance_km": 28.4, "from_lat": 37.49, "from_lng": 127.48,
    "to_lat": 37.55, "to_lng": 126.97
  },
  "plan_summary": { "total_min": 62, "transfers": 0, "walk_min": 12, "wait_min": 3 },
  "actual": null,
  "planned_min": 62,
  "deviation_min": null,
  "generated": false
}
```

- `steps[].from_lat/from_lng/to_lat/to_lng`를 WebView 네이버 지도 폴리라인으로 사용
- 응답의 `actual`은 체크인 실측(아래)

### POST `/route/:scheduleId/checkin`

```json
{ "type": "depart", "lat": 37.4981, "lng": 127.4847, "at": "2026-11-27T09:00:00" }
```

- `type`: `depart` | `arrive` (`at` 생략 시 서버 현재시각)
- 같은 경로에 대해 1행을 갱신(멱등)
- `arrive` 시 `duration_min` 자동 계산, `planned_min`/`deviation_min` 반환
- `route_kind`: 제목에 `귀가`/`집으로 이동`/`임시숙소로 이동`이면 `return`, 아니면 `move`

```json
{
  "success": true,
  "checkin": { "type": "arrive", "at": "2026-11-27T10:45:00" },
  "actual": { "id": 1, "plan_id": 12878, "route_kind": "move",
              "depart_at": "...", "arrive_at": "...", "duration_min": 105,
              "transfers": 0, "walk_min": 12, "wait_min": 5, "source": "checkin" },
  "planned_min": 62,
  "deviation_min": 43
}
```

## 5. 이동 요약 업로드 / 통계

### POST `/trips`

```json
{
  "plan_id": 12878,
  "route_kind": "move",
  "start_at": "2026-11-27T09:00:00",
  "end_at": "2026-11-27T10:45:00",
  "duration_min": 105,
  "depart_lat": 37.4981, "depart_lng": 127.4847,
  "arrive_lat": 37.5560, "arrive_lng": 126.9702,
  "transfers": 1, "walk_min": 12, "wait_min": 5,
  "quality": 87,
  "polyline_simplified": [[37.4981,127.4847],[37.52,127.30],[37.556,126.97]]
}
```

- **Wi-Fi + 품질 80점 이상 판정은 앱에서 수행**. 서버는 전송된 요약만 저장
- 서버는 `user_ref`를 HMAC 익명키로 변환해 저장(사용자 ID 원문 미저장)
- `segment_key`: 출발/도착 좌표를 소수 3자리(약 100m)로 반올림한 익명 구간키
- 동일 `plan_id + start_at` 재전송은 갱신(큐 재시도 멱등)
- `quality < 80` 데이터는 저장되지만 익명 통계 집계에서는 제외(`aggregated: false`)

응답 `201`:

```json
{ "success": true, "id": 1, "quality": 87, "aggregated": true,
  "segment_key": "37.498,127.485>37.556,126.970", "retention_days": 180 }
```

### GET `/route-stats?days=30`

```json
{
  "days": 30,
  "summary": { "count": 8, "avg_min": 64, "median_min": 61,
               "p25": 58, "p75": 72, "stddev_min": 9, "uploaded_trips": 12 },
  "recent": [
    { "id": 1, "plan_id": 12878, "route_kind": "move",
      "depart_at": "...", "arrive_at": "...", "duration_min": 105,
      "planned_min": 62, "deviation_min": 43, "delay_tag": "very_delayed",
      "title": "서울역 업무 이동", "source": "checkin" }
  ],
  "segments": [
    { "segment_key": "37.498,127.485>37.556,126.970", "dow": 4, "hour_bucket": 9,
      "median_min": 61, "p25": 58, "p75": 72, "samples": 12 }
  ]
}
```

- `delay_tag`: `early`(≤-3분) / `on_time`(≤5분) / `delayed`(≤15분) / `very_delayed`
- `recent`는 체크인 실측 기준, `segments`는 익명 통계 기준

## 6. 추천

### GET `/recommend/:scheduleId`

```json
{
  "schedule_id": 12877,
  "origin": { "name": "...", "lat": 37.49, "lng": 127.48 },
  "destination": { "name": "...", "lat": 37.55, "lng": 126.97 },
  "target_arrival": "2026-11-27T10:00:00",
  "based_on": { "samples": 12, "median_min": 61, "window_days": 30, "level": "high" },
  "fallback": false,
  "options": [
    { "kind": "min_time", "label": "최소 시간", "total_min": 58,
      "transfers": 1, "walk_min": 12, "wait_min": 4,
      "departure": "09:02", "arrival": "10:00",
      "steps": [ /* route plan steps */ ],
      "confidence": { "level": "high", "score": 0.9, "samples": 12,
                      "basis": "최근 30일 이 구간 표본 12건 (중앙값 61분)" } }
  ]
}
```

- ODSay 다중 경로에서 **최소시간 / 최소환승 / 최소도보** 후보를 최대 3개 선택(중복 제거)
- 신뢰도: 최근 30일 품질 80점 이상 표본 수 기준
  - `high` ≥10, `medium` ≥5, `low` ≥1, `none` 0
- ODSay 쿼터/장애 시 `fallback: true`로 계획 1건만 반환할 수 있음
- `recommendation` 테이블에는 일정별 최신 스냅샷 1건만 보관

## 7. 기기 / 동의 / 전체 삭제

### POST `/device`

```json
{ "platform": "ios", "push_token": "<APNs or FCM token>" }
```

- `enabled: false`로 보내면 해당 토큰 삭제
- 무효 토큰은 발송 시 자동 제거

### POST `/consent`

```json
{ "location": true, "background": true, "aggregate_use": true, "version": "1.0" }
```

- 동의 이력은 append-only로 저장(거부 이력 포함)
- 앱은 권한 요청 **전에** 목적·보관기간·거부권을 설명하는 화면을 보여야 함

### DELETE `/my-data`

- 앱 데이터 즉시 파기: 일정(이동/귀가 포함), 체크인 실측, 업로드 요약, 추천, 기기 토큰, 동의 이력
- 계정은 **익명화 소프트 삭제**: 이메일/전화/이름/주소/좌표 삭제, 비밀번호 무효화, `username='탈퇴회원'`
- 삭제 후 기존 JWT는 즉시 401 (이메일이 없으면 토큰 인증 거부)
- 웹 게시글 등 기존 콘텐츠 참조는 유지(작성자만 탈퇴회원으로 표시)

## 8. 보관/파기

| 데이터 | 위치 | 보관 |
|---|---|---|
| 원시 GPS | 앱 SQLite | 30일 후 앱이 삭제 |
| 좌표 원본 | 서버 | 저장하지 않음(출발/도착 중심 + 단순화 폴리라인만) |
| `trip_summary` | 서버 | 180일 후 스케줄러가 자동 파기 (`APP_TRIP_RETENTION_DAYS`) |
| `route_stat` | 서버 | 장기 보관(익명 집계) |
| `app_login_attempt` | 서버 | 1일 후 정리 |

## 9. 서버 환경변수

```dotenv
# 필수 권장 (미설정 시 SECRET_KEY에서 파생)
APP_JWT_SECRET=<32자 이상 랜덤>
APP_JWT_DAYS=30
APP_TRIP_RETENTION_DAYS=180

# 푸시 (없으면 발송은 no-op)
FCM_SERVICE_ACCOUNT_JSON=/path/to/firebase-service-account.json
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
APNS_TOPIC=kr.unocum.app       # iOS bundle id
APNS_KEY_PATH=/path/to/AuthKey_XXXXXXXXXX.p8
APNS_USE_SANDBOX=false
```

- FCM/APNs 자격증명은 절대 Git에 커밋하지 않는다(`.gitignore`/서버 `.env`)
- `desired` APNs payload는 `interruption-level: time-sensitive`를 포함한다
