# YP Project 배포 지침서

## 아키텍처

```
서버 (3.38.80.64)
├── yp_flask     (port 5000) - Flask + Gunicorn
├── yp_scheduler (port 없음) - 백그라운드 스케줄러
├── yp_postgres  (port 5432) - PostgreSQL 16
└── yp_rag       (port 8001) - RAG 서비스

로컬 개발
├── yp_flask     (port 5000)
├── yp_react     (port 5173) - Vite 개발 서버
├── yp_postgres  (port 5432)
└── yp_rag       (port 8001)
```

## 배포 순서 (6단계)

### 1단계: 로컬 개발 완료

```bash
# 프론트엔드 빌드
cd frontend && npm run build

# 로컬 테스트
docker compose up -d
# → http://localhost:5000 에서 확인
```

### 2단계: DB 마이그레이션 생성 (모델 변경 시)

```bash
# models.py를 수정한 경우에만 실행
docker exec -e FLASK_APP=run.py yp_flask flask db migrate -m "변경 설명"
# → migrations/versions/ 폴더에 .py 파일 생성됨

# 생성된 마이그레이션 파일 확인
cat migrations/versions/*.py
```

### 3단계: git에 커밋 & 푸시

```bash
# 변경된 모든 파일 추가
git add .

# 커밋
git commit -m "변경 설명"

# 푸시
git push origin dev
```

**커밋 필수 항목:**
- `run.py`, `scheduler.py` (코드 변경)
- `route_modules/*.py` (API 변경)
- `models.py` (DB 모델 변경)
- `migrations/versions/*.py` (마이그레이션 파일)
- `frontend/src/**` (프론트엔드 변경)
- `DEPLOY.md`, `requirements.txt` (설정 변경)

**커밋에서 제외할 것 (.gitignore):**
- `DockerDesktopWSL/`
- `*.dump`, `*.dump.*`
- `.env`, `instance/`
- `frontend/dist/`
- `tmp_*`, `cookies.txt`

### 4단계: 서버 배포

**방법 A: deploy.sh 자동 배포 (권장)**
```bash
# 서버에서
cd /home/ubuntu/yp_project
bash deploy.sh
```

**방법 B: 수동 배포**
```bash
# 서버 접속
ssh -i 키경로 ubuntu@3.38.80.64

# 코드 pull
cd /home/ubuntu/yp_project
git pull origin dev

# DB 마이그레이션 실행
docker exec -e FLASK_APP=run.py yp_flask flask db upgrade

# 프론트엔드 빌드 (서버에서)
cd frontend && npm run build

# 컨테이너에 반영
docker cp frontend/dist/. yp_flask:/yp_project/frontend/dist/

# 재시작
docker restart yp_flask yp_scheduler
```

### 5단계: 배포 후 검증

```bash
# 사이트 접속 확인
curl -s -o /dev/null -w "%{http_code}" https://www.unocum.kr
# → 200 이면 정상

# 로그 확인
docker logs yp_flask --tail 20

# 에러 없는지 확인
docker logs yp_flask --tail 100 | grep -i error
```

### 6단계: 문제 발생 시 롤백

```bash
# git으로 이전 커밋으로 되돌리기
git log --oneline -5       # 이전 커밋 해시 확인
git revert <커밋해시>       # 되돌리기 커밋 생성
git push origin dev        # 서버에 반영

# 서버에서 배포
ssh ubuntu@3.38.80.64
cd /home/ubuntu/yp_project && git pull origin dev
docker restart yp_flask yp_scheduler
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
flask db upgrade → 서버 DB에 SQL 적용
```

### 주의사항

- `flask db migrate`는 **로컬에서만** 실행 (서버 DB와 비교)
- `flask db upgrade`는 **서버에서** 실행 (실제 DB 변경)
- 마이그레이션 파일은 **반드시 git에 커밋**
- `flask db upgrade`는 INSERT/UPDATE/DELETE를 하지 않음 (DDL만 실행)

### 수동 SQL로 마이그레이션하는 경우

만약 Flask-Migrate가 안 되는 상황에서 수동으로:

```sql
-- 새 컬럼 추가
ALTER TABLE news_article ADD COLUMN labor_only BOOLEAN DEFAULT FALSE;

-- 새 테이블 생성
CREATE TABLE IF NOT EXISTS labor_news_article (...);

-- 컬럼 삭제
ALTER TABLE news_article DROP COLUMN labor_only;

-- 컬럼 타입 변경
ALTER TABLE news_article ALTER COLUMN title TYPE VARCHAR(500);
```

## 문제 해결 FAQ

### Q: 서버에서 "column xxx does not exist" 에러

**원인:** models.py에 컬럼을 추가했는데 `flask db upgrade`를 안 함
**해결:**
```bash
ssh ubuntu@3.38.80.64
docker exec -e FLASK_APP=run.py yp_flask flask db upgrade
docker restart yp_flask
```

### Q: 서버에서 "relation xxx does not exist" 에러

**원인:** 새 테이블을 추가했는데 DB에 없음
**해결:**
```bash
docker exec -e FLASK_APP=run.py yp_flask flask db upgrade
```

### Q: `flask db migrate`가 빈 마이그레이션을 생성

**원인:** models.py와 DB가 이미 동기화된 상태
**해결:** 마이그레이션 파일을 삭제하고 다시 생성, 또는 DB가 의도한 대로인지 확인

### Q: 배포 후 프론트엔드가 안 바뀜

**해결:**
```bash
# 로컬에서 빌드
cd frontend && npm run build

# 서버로 복사
ssh ubuntu@3.38.80.64
docker cp /home/ubuntu/yp_project/frontend/dist/. yp_flask:/yp_project/frontend/dist/
docker restart yp_flask
```

### Q: Docker Desktop WSL2 디스크 용량이 늘어남

**원인:** Docker Desktop이 프로젝트 폴더 안에 .vhdx 파일 생성
**해결:**
1. Docker Desktop 중지
2. `DockerDesktopWSL/` 폴더 삭제
3. Docker Desktop 설정 → Resources → WSL Integration → 데이터 경로 변경
4. Docker Desktop 재시작
