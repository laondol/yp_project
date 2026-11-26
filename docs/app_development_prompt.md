# 일정·이동 앱 개발 프롬프트 (별도 작업용)

> 사용 방법
> 1. **백엔드 프롬프트**를 먼저 기존 저장소(`~/yp_parity/yp_project`)에서 실행해 `/api/app/*` 를 만든다.
> 2. **앱 프롬프트**를 새 저장소(예: `~/yp_app`)에서 실행해 React Native(Expo) 앱을 만든다.
> 3. 각 마일스톤마다 테스트 결과를 확인하고 다음 단계로 넘어간다.

---

# 1. 백엔드 API 프롬프트 (기존 Flask 저장소에서 실행)

```
기존 Flask 저장소(~/yp_parity/yp_project)에 모바일 앱 전용 API를 추가하세요.
기존 웹 기능은 그대로 유지되어야 하며, 웹 회귀 테스트를 통과해야 합니다.

## 인증
- POST /api/app/login  {email, password} → {token}
  · 기존 User 테이블 재사용, 비밀번호 해시 검증
  · Bearer 토큰(JWT). 기존 웹 세션 쿠키와 분리
- 앱 전용 토큰 만료·갱신 정책 정의
- 로그인 실패 제한(5회/15분) 적용

## 일정
- 기존 TongBotSchedule 재사용 (kind='base', 'route' 포함)
- GET  /api/app/today
- GET  /api/app/schedules?from&to
- POST /api/app/schedules
- PUT  /api/app/schedules/:id
- DELETE /api/app/schedules/:id
- 이동/귀가 일정은 충돌 검사에서 제외(항상 추가 생성) 규칙 유지

## 경로
- GET /api/app/route/:scheduleId → 계획(단계·수단·소요시간)
- services/route_recalc.py 의 경로 생성 로직 재사용
- 네이버 지도/교통 API 사용 (서버 키)

## 체크인/실측
- 신규 테이블 route_actual
  (id, user_id, plan_id, route_kind, depart_at, arrive_at, duration_min,
   depart_lat/lng, arrive_lat/lng, transfers, walk_min, wait_min,
   source(checkin|manual), memo, created_at)
- POST /api/app/route/:id/checkin {type: depart|arrive, lat, lng, at}

## 요약 업로드
- POST /api/app/trips
  · 앱이 품질 80점 이상 + Wi-Fi 일 때만 전송
  · 폴리라인 단순화(점 90% 감축)
  · 사용자 식별자는 통계와 분리(익명 키)
- 신규 테이블 trip_summary  → 6개월 보관 후 자동 파기
- 신규 테이블 route_stat    → 익명 통계(시간대·요일·중앙값·표본수), 장기 보관
- GET /api/app/route-stats?days=30
- GET /api/app/recommend/:scheduleId → 후보 2~3개 + 근거·신뢰도

## 푸시/동의/삭제
- 신규 테이블 app_device(platform, push_token)
- POST /api/app/device
- APNs/FCM 발송 유틸 추가
- 신규 테이블 app_consent(location, background, aggregate_use, version, created_at)
- POST /api/app/consent
- DELETE /api/app/my-data → 계정·기록 전체 삭제

## 운영
- 6개월 경과 trip_summary 자동 파기 스케줄러 추가
- 좌표·이메일 원문을 로그에 남기지 않기
- DB 스키마 변경은 기존 자동 마이그레이션 방식(db.create_all + ALTER) 준수

## 완료 기준
- 각 엔드포인트 curl 테스트 결과 보고
- 기존 웹 페이지 주요 기능(로그인·일정·게시판) 회귀 확인
- 비밀키·인증서 커밋 금지
```

---

# 2. 앱 개발 프롬프트 (새 저장소에서 실행)

```
당신은 React Native(Expo) 앱을 처음부터 개발하는 시니어 개발자입니다.
아래 확정 사양을 그대로 구현하세요. 추측하지 말고, 불명확하면 먼저 질문하세요.

## 0. 프로젝트 개요
- 목적: 개인 일정 + 이동(경로) 기록 + 알람 + 경로 추천 앱
- 기존 서비스: 함께사는양평(Flask 웹, https://unocum.kr)
- 앱은 별도 Git 저장소에서 개발한다 (예: ~/yp_app). 기존 웹 저장소와 분리.
- 백엔드 API는 /api/app/* 를 사용한다 (백엔드 프롬프트로 먼저 준비).

## 1. 확정된 기술/정책 (변경 금지)
| 항목 | 결정 |
|---|---|
| 프레임워크 | React Native + Expo (EAS Build) |
| 최소 OS | iOS 16, Android 10 |
| 지도 | 네이버 지도 (표시: WebView + 네이버 지도 JS, 경로 계산: 서버 API) |
| 위치 | 전체 백그라운드 추적 (거리 필터 50~100m, 정지 시 수집 중단) |
| 로컬 보관 | 원시 GPS 30일 후 자동 삭제 (SQLite) |
| 서버 업로드 | Wi-Fi 연결 시에만, 품질 80점 이상만 |
| 서버 보관 | 요약 기록 6개월, 익명 통계는 장기 보관 |
| 알람 | 로컬 예약 알림(±1분 목표), 오프라인 동작, Time Sensitive |
| 푸시 | APNs/FCM 푸시만 (문자/카카오 없음) |
| 배포 | App Store + Play Store |

## 2. 기능 요구사항
### 2.1 화면
1) 오늘: 타임라인, 다음 이동까지 남은 시간, 출발 알림 상태
2) 일정: 주간/월간 달력
3) 일정 편집: 제목·장소·시작/종료·반복·알림(시작 N분 전)
4) 이동 상세: 계획 경로 단계, [출발] / [도착] 체크인, 실제 vs 계획
5) 기록: 최근 이동 목록, 평균·편차, 지연 태그
6) 추천: 후보 2~3개(최소시간/최소환승/최소도보), 근거·신뢰도(표본 수)
7) 설정: 위치 권한, 백그라운드 수집 on/off, 알림, 데이터 삭제(전체)

### 2.2 알람
- 일정 시작 알림: 시작 -N분 (기본 30/10분 선택)
- 귀가 출발 알림: (귀가 목표시각) - (실시간 교통 소요시간) - 준비 5분
- 지연 알림: 서버 재계산 결과 변동 시 푸시로 예약 갱신
- 구현: expo-notifications로 절대 시각 로컬 예약(최대 7일치), 앱 실행/백그라운드 fetch 시 재예약
- 인터넷이 없어도 예약된 알람은 울려야 함
- iOS: Time Sensitive 권한 요청. 무음/집중모드 소리 제한은 OS 한계로 안내 문구 표시
- iOS 16이므로 AlarmKit(26+)은 사용하지 않음

### 2.3 위치 수집
- expo-location + expo-task-manager로 백그라운드 수집
- 거리 필터 50~100m, 이동 감지(Core Motion/Activity)로 정지 시 중단
- 수집 데이터는 SQLite에만 저장(서버 업로드 전)
- 30일 경과 데이터 자동 삭제

### 2.4 품질 점수 & 업로드
- 점수(100점): GPS 정확도 30 + 좌표 밀도 20 + 계획 일치율 30 + 완주 10 + 속도 타당성 10
- 80점 이상 + Wi-Fi일 때만 요약 업로드
- 업로드는 폴리라인 단순화(점 90% 감축), 개인식별자 분리
- 업로드 실패 시 큐에 보관 후 Wi-Fi 재연결 시 재시도

## 3. 데이터 모델
### 3.1 앱 로컬(SQLite)
gps_point(id, ts, lat, lng, acc, speed, mode)
trip(id, plan_id, started_at, ended_at, polyline, quality, uploaded, source)
queue(id, payload, retry)

### 3.2 서버(PostgreSQL)
trip_summary(id, user_ref(익명), plan_id, route_kind, start_at, end_at, duration_min,
             depart_lat, depart_lng, arrive_lat, arrive_lng, transfers, walk_min, wait_min,
             quality, polyline_simplified, created_at)  -- 6개월 보관
route_stat(id, segment_key, dow, hour_bucket, median_min, p25, p75, samples)  -- 익명 장기
recommendation(id, plan_id, options_json, created_at)
app_device(id, user_id, platform, push_token, updated_at)
app_consent(id, user_id, location, background, aggregate_use, version, created_at)

## 4. API 계약
POST /api/app/login            {email, password} → {token}
GET  /api/app/today            → 오늘 일정+이동
GET  /api/app/schedules?from&to
POST /api/app/schedules
PUT  /api/app/schedules/:id
DELETE /api/app/schedules/:id
GET  /api/app/route/:scheduleId        → 계획(단계·수단·소요)
POST /api/app/route/:id/checkin        {type: depart|arrive, lat, lng, at}
POST /api/app/trips                    요약 업로드
GET  /api/app/route-stats?days=30
GET  /api/app/recommend/:scheduleId
POST /api/app/device                   푸시 토큰 등록
POST /api/app/consent                  동의 기록
DELETE /api/app/my-data                전체 삭제
※ 인증: Bearer 토큰(JWT). 기존 웹 세션 쿠키와 분리.

## 5. 개인정보/보안 (필수)
- 위치정보 별도 동의(목적·보관기간·거부권 고지), 동의 기록 저장
- 좌표는 출발·도착 지점 중심 저장(전체 궤적 업로드 지양)
- 원시 데이터 로컬 30일, 서버 요약 6개월 자동 파기
- 앱 내 "수집 중단"·"전체 삭제" 기능
- HTTPS 필수, 토큰은 Keychain(iOS)/Keystore(Android)에 저장
- 로그에 좌표·이메일 원문 남기지 않기

## 6. 스토어 심사 대비
- 개인정보 처리방침 URL
- 위치 권한 사유 문구: "이동 경로 개선 및 소요시간 통계"
- 백그라운드 위치 사용 목적 명시(심사 시 소명 자료)
- 계정 삭제 기능(Apple 필수)
- 알림 권한 요청 전 설명 화면

## 7. 개발 순서(마일스톤)와 완료 기준
M0. Expo 프로젝트 생성, EAS 설정, 로그인
   - 완료: 실기기에서 로그인 후 토큰 저장 확인
M1. 일정 CRUD + 오프라인 캐시
   - 완료: 비행기모드에서 목록 조회, 복귀 시 동기화
M2. 경로 표시(WebView 지도) + 출발/도착 체크인
   - 완료: 체크인 시 서버에 기록, 실제 소요시간 표시
M3. 로컬 알람 + 귀가 출발 계산
   - 완료: 오프라인 상태에서 예약 알람이 ±1분 내 울림
M4. 위치 수집 + 품질 점수 + Wi-Fi 업로드
   - 완료: 80점 미만 미전송, 30일 후 로컬 삭제 확인
M5. 서버 집계 + 추천 화면
   - 완료: 표본 수·신뢰도와 함께 후보 2~3개 표시
M6. 심사 제출
   - 완료: TestFlight/내부테스트 통과

## 8. 작업 규칙
- 비밀키·인증서·.env는 절대 커밋하지 말 것
- DB 스키마 변경 전 확인받기
- 각 마일스톤 완료 시 변경 파일 목록과 테스트 결과 보고
- 실기기 테스트 없이 "완료"라고 보고하지 말 것
- iOS 16 제약(강제 알람 불가)은 사용자에게 명확히 안내

## 9. 첫 작업
1) 저장소 구조와 Expo 프로젝트 생성
2) EAS 설정, iOS/Android 번들ID
3) 로그인 화면 + 토큰 저장 + /api/app/login 연동(백엔드 준비 전이면 목 API)
4) M0 결과 보고 후 다음 단계 진행
```
