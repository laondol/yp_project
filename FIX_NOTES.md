# 수정 예정 버그 메모 (마이그레이션 후 처리)

## 1. 로그아웃 버그
- 증상: localhost 접속에서는 로그아웃 됨, 숫자(IP) 접속에서는 안 됨 (어제는 정반대). 책임자/일반 동일.
- 원인 추정: Flask 세션 쿠키 도메인/SameSite 불일치 (접속 호스트별 쿠키 스코프 차이).
- 관련 코드: route_modules/auth_bp.py:381,741 (logout 라우트), frontend/src/lib/api.ts:60, config.py:18-19 (SESSION_COOKIE_SAMESITE='Lax', SECURE 기본 false).
- 해결 방향: C 패리티 세팅 시 nginx 프록시 + SESSION_COOKIE_DOMAIN를 localhost/IP에 맞춰 정렬.

## 2. 풍경(지도) 위치 반영 버그
- 증상: 관리자는 풍경이 위치에 맞게 정상 표시. 일반 회원 중 자기 집(주소)이 등록 안 된 회원은 위치에 맞는 풍경이 리로드되지 않음(갱신 안 됨).
- 원인 추정: home_address/office_address 미등록 회원의 위치 기반 분기 누락 또는 지도 중심좌표 갱신 로직 미동작. API 키 문제 아님(관리자는 정상).
- 관련 코드: services/geocode.py (gps_to_town_village, gps_to_address), route_modules/user_bp.py (GPS 위치, home_address/office_address geocode KAKAO_REST_API_KEY), route_modules/share_bp.py (위치 기반), route_modules/village_bp.py (위치 맞는 마을 페이지).
- 해결 방향: 미등록 회원 경로에서 위치(위도/경도 또는 town/village) 미보유 시 기본 처리/지도 리로드 트리거 확인.

## 환경/마이그레이션 메모
- C 2TB 확보 후 fresh Ubuntu-26.04 설치 -> 양평 서버와 같은 스택(docker/nginx/compose) 패리티.
- 웹서버는 서비스만 이사(프로젝트 + DB 덤프), 디스크 통째 교체 금지.
- 양평 서버 .env(키 값)는 님이 제공. GOOGLE_MAPS_API_KEY만 로컬 비어있음(관리자 풍경은 카카오 키로 동작하므로 무관).
- DB 덤프에 관리자(책임자) 계정 포함 확인 필요.

## 1-추가. 로그아웃 버그 진단 (2026-08-25)
- 관찰: 양평(prod)에서는 정상, 로컬 임시서버(G)에서만 로그아웃 안 됨(관리자 포함). localhost/IP 접속 시 증상 왔다 갔다.
- 인증 방식: Flask 세션 쿠키 기반 (session['user_id'] 등). 별도 JWT/토큰 없음. logout은 session.clear()만 호출.
- 추정 원인: 현재 임시 로컬 서버의 세션 쿠키 설정/서빙 방식(prod 대비 미비) - SameSite/SECURE/Domain 또는 nginx 프록시 구성 차이로, 로그아웃 시 세션 쿠키가 브라우저에서 갱신/삭제되지 않음.
  - 프론트는 fetch 시 credentials:'include' + 상대경로 사용. SPA와 API가 같은 origin이 아니면(포트/호스트 분리) SameSite=Lax(현재 설정) 때문에 POST 로그아웃 쿠키가 안 가가 -> 세션 유지.
- 결론: 로컬 임시서버 한정 이슈. C에 양평과 동일하게 제대로 설치(nginx 프록시 + 쿠키 설정 패리티)하면 해결 가능성 높음. 그때까지 수정 보류.
