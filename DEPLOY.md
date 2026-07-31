# YP Project 배포 지침서

## 작업 원칙

- **git commit은 반드시 사용자 확인 후에만 수행한다**
- 변경사항을 먼저 검토·테스트 받고, 커밋·푸시는 사용자 승인 후 진행

## 아키텍처

```
서버 (3.38.80.64) - unocum.kr / www.unocum.kr
├── yp_flask     (port 5000) - Flask + Gunicorn
├── yp_scheduler (port 없음) - 백그라운드 스케줄러
├── yp_react     (정적 파일) - 프론트엔드 빌드 결과
├── yp_rag       (port 8001) - RAG 서비스
├── yp_postgres  (port 5432) - PostgreSQL 16
└── yp_pgadmin   (port 5050) - DB 관리 UI

로컬 개발
├── yp_flask     (port 5000)
├── yp_react     (port 5173) - Vite 개발 서버
├── yp_scheduler (port 없음)
├── yp_rag       (port 8001)
├── yp_postgres  (port 6432 → 5432) - Hyper-V 5432 예약으로 6432 사용
└── yp_pgadmin   (port 5050)
```

- **서버 DB(양평서버)가 기준** 데이터
- 로컬은 서버를 따라가는 구조
- `docker-compose.yml` 파일 하나 사용 (로컬/서버 동일)

## 배포 절차 (모델 변경 없는 코드 수정)

```bash
# 1. 프론트엔드 변경 시에만 빌드
cd frontend && npm run build

# 2. 로컬 커밋 & 푸시
git add .
git commit -m "변경 설명"
git push origin dev

# 3. 서버 배포 (로컬 노트북에서)
ssh -i "C:\Users\i0wil\.ssh\LightsailDefaultKey-ap-northeast-2_U .pem" ubuntu@3.38.80.64 \
  "cd /home/ubuntu/yp_project && git pull origin dev"

# 4. 프론트엔드 반영 (빌드한 경우에만)
ssh -i "C:\Users\i0wil\.ssh\LightsailDefaultKey-ap-northeast-2_U .pem" ubuntu@3.38.80.64 \
  "docker cp /home/ubuntu/yp_project/frontend/dist/. yp_flask:/yp_project/frontend/dist/"
```

- 서버는 volume mount(`.:/yp_project`)로 코드가 자동 반영됨
- 프론트엔드만 `docker cp` 필요
- 컨테이너 재시작 불필요 (코드 변경은 다음 요청 시 자동 반영)

## 배포 절차 (models.py 변경 시)

```bash
# 1. models.py 수정

# 2. 로컬에서 마이그레이션 생성
docker exec -e FLASK_APP=run.py yp_flask flask db migrate -m "변경 설명"
# → migrations/versions/xxx_변경설명.py 생성

# 3. 생성된 마이그레이션 파일 확인 (중요!)
#    - upgrade() 함수에 원하는 변경사항이 맞는지 확인
#    - 불필요한 타입 변경이 있으면 수정

# 4. 로컬 커밋 & 푸시
git add .
git commit -m "변경 설명 + 마이그레이션"
git push origin dev

# 5. 서버 배포
ssh -i "C:\Users\i0wil\.ssh\LightsailDefaultKey-ap-northeast-2_U .pem" ubuntu@3.38.80.64 \
  "cd /home/ubuntu/yp_project && git pull origin dev"

# 6. 서버에서 마이그레이션 실행 (DDL만 변경, 데이터 변경 없음)
ssh -i "C:\Users\i0wil\.ssh\LightsailDefaultKey-ap-northeast-2_U .pem" ubuntu@3.38.80.64 \
  "docker exec -e FLASK_APP=run.py yp_flask flask db upgrade"

# 7. 서버 로그 확인
ssh -i "C:\Users\i0wil\.ssh\LightsailDefaultKey-ap-northeast-2_U .pem" ubuntu@3.38.80.64 \
  "docker logs yp_flask --tail 20"
```

## 빠른 배포 (로컬에서 한 번에)

```bash
# 프론트엔드 빌드 + 커밋 + 푸시 + 서버 배포를 한 번에
cd frontend && npm run build
git add . && git commit -m "설명" && git push origin dev

# 서버에서 git pull + 프론트 반영
ssh -i "C:\Users\i0wil\.ssh\LightsailDefaultKey-ap-northeast-2_U .pem" ubuntu@3.38.80.64 \
  "cd /home/ubuntu/yp_project && git pull origin dev && \
   docker cp frontend/dist/. yp_flask:/yp_project/frontend/dist/"
```

## DB 마이그레이션 상세

### Flask-Migrate란?

models.py의 변경사항을 자동으로 감지하여 DB 스키마 SQL 파일로 변환하는 도구.

### 동작 원리

```
models.py 변경
    ↓
flask db migrate → SQL 파일 자동 생성 (migrations/versions/*.py)
    ↓
git commit + push
    ↓
서버: git pull
    ↓
flask db upgrade → 서버 DB에 SQL 적용 (DDL만 변경)
```

### 현재 마이그레이션 베이스라인

- 베이스 리비전: `74e6852263db` (initial schema, no-op)
- `alembic_version` 테이블에 기록됨
- 이후 생성되는 마이그레이션은 이 리비전을 기준으로 체인

### 주의사항

- `flask db migrate`는 **로컬에서만** 실행
- `flask db upgrade`는 **서버에서** 실행 (실제 DB 변경)
- 마이그레이션 파일은 **반드시 git에 커밋**
- `flask db upgrade`는 INSERT/UPDATE/DELETE를 하지 않음 (DDL만 실행)
- 서버 DB(양평서버)가 기준 데이터. 절대 데이터를 삭제하지 않음

### 서버 DB 현황

- 테이블: 71개 (public 스키마)
- 사용자: `yp_dev` / DB: `yp_local`
- 컨테이너: `yp_postgres`

## 백업

### 수동 백업 (필요 시)

```bash
# DB 백업
docker exec yp_postgres pg_dump -U yp_dev yp_local | gzip > /backup/db/yp_local_$(date +%F).sql.gz

# 업로드 백업
tar -czf /backup/uploads/uploads_$(date +%F).tar.gz -C /home/ubuntu/yp_project uploads/
```

### 자동 백업 (스케줄러 미등록, 수동 실행용)

- `scripts/backup_db.sh` - DB 백업 (3일 보관)
- `scripts/backup_uploads.sh` - 업로드 파일 백업 (3일 보관)
- 백업 경로: `/backup/db/`, `/backup/uploads/`
- 스케줄러 등록은 요청 시 `scheduler.py`에 APScheduler 잡 추가

## 배포 검증

```bash
# 사이트 접속 확인
curl -s -o /dev/null -w "%{http_code}" https://www.unocum.kr
# → 200 이면 정상

# 로그 확인
ssh -i "C:\Users\i0wil\.ssh\LightsailDefaultKey-ap-northeast-2_U .pem" ubuntu@3.38.80.64 \
  "docker logs yp_flask --tail 20"

# 에러 확인
ssh -i "C:\Users\i0wil\.ssh\LightsailDefaultKey-ap-northeast-2_U .pem" ubuntu@3.38.80.64 \
  "docker logs yp_flask --tail 100 | grep -i error"

# DB 마이그레이션 상태 확인
ssh -i "C:\Users\i0wil\.ssh\LightsailDefaultKey-ap-northeast-2_U .pem" ubuntu@3.38.80.64 \
  "docker exec -e FLASK_APP=run.py yp_flask flask db current"
```

## 롤백

```bash
# git으로 이전 커밋으로 되돌리기
git log --oneline -5       # 이전 커밋 해시 확인
git revert <커밋해시>       # 되돌리기 커밋 생성
git push origin dev        # 서버에 반영

# 서버에서
ssh ubuntu@3.38.80.64
cd /home/ubuntu/yp_project && git pull origin dev

# DB 롤백이 필요한 경우 (드DMETHOD)
# → 수동으로 SQL 실행 또는 이전 덤프로 복원
```

## 문제 해결 FAQ

### Q: 서버에서 "column xxx does not exist" 에러

**원인:** models.py에 컬럼을 추가했는데 `flask db upgrade`를 안 함
**해결:**
```bash
ssh ubuntu@3.38.80.64
docker exec -e FLASK_APP=run.py yp_flask flask db upgrade
```

### Q: 서버에서 "relation xxx does not exist" 에러

**원인:** 새 테이블을 추가했는데 DB에 없음
**해결:**
```bash
docker exec -e FLASK_APP=run.py yp_flask flask db upgrade
```

### Q: `flask db migrate`가 불필요한 타입 변경을 감지

**원인:** 로컬 DB와 서버 DB 간 타입 차이 (SQLite↔PostgreSQL)
**해결:** 생성된 마이그레이션에서 `upgrade()`를 `pass`로 비우기 (베이스라인용)

### Q: 배포 후 프론트엔드가 안 바뀜

**해결:**
```bash
# 로컬에서 빌드
cd frontend && npm run build

# 서버로 복사
ssh ubuntu@3.38.80.64
docker cp /home/ubuntu/yp_project/frontend/dist/. yp_flask:/yp_project/frontend/dist/
```

### Q: 로컬 컨테이너가 재시작 반복 (crash loop)

**원인:** PostgreSQL 컨테이너가 꺼져있음
**해결:**
```bash
cd "C:\Users\i0wil\OneDrive\바탕 화면\project\yp_project"
docker compose up -d postgres
docker compose up -d
```

### Q: Docker Desktop WSL2 디스크 용량이 늘어남

**원인:** Docker Desktop이 프로젝트 폴더 안에 .vhdx 파일 생성
**해결:**
1. Docker Desktop 중지
2. `DockerDesktopWSL/` 폴더 삭제
3. Docker Desktop 설정 → Resources → WSL Integration → 데이터 경로 변경
4. Docker Desktop 재시작

## SSH 키 위치

```
C:\Users\i0wil\.ssh\LightsailDefaultKey-ap-northeast-2_U .pem
```
