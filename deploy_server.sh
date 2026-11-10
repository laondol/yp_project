#!/bin/bash
# ============================================================
# 양평서버 안전 배포 스크립트 (v4)
# 사용법 (서버): bash deploy_server.sh [옵션]
#   --dry-run     점검만 (반영 안 함)
#   --no-build    프론트 빌드 생략
#   --force       변경 없어도 강제 배포
#   --skip-db     DB 백업 생략
#
# 핵심: 커밋을 여러 번 쌓아도 "한 번의 pull"로 모두 반영되도록:
#   1) origin/dev 최신으로 강제 동기화 (모든 커밋 반영)
#   2) 프론트 빌드/복사 (git에 없는 dist 반영)
#   3) 재기동 후 /api/version 의 커밋 == HEAD 인지 확인
#   4) 불일치 시 컨테이너 강제 재생성, 그래도 실패하면 자동 롤백
# ============================================================
set -Eeuo pipefail
cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/deploy_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

NO_BUILD=0; FORCE=0; DRY=0; SKIP_DB=0
for a in "$@"; do
  case "$a" in
    --no-build) NO_BUILD=1 ;;
    --force) FORCE=1 ;;
    --dry-run) DRY=1 ;;
    --skip-db) SKIP_DB=1 ;;
    *) echo "알 수 없는 옵션: $a"; exit 1 ;;
  esac
done

echo "============================================================"
echo " 양평서버 안전 배포 v4   $(date '+%Y-%m-%d %H:%M:%S')"
echo " 로그: $LOG"
echo "============================================================"

http_code() { curl -s -o /dev/null -m 5 -w "%{http_code}" "$1" || echo "000"; }

wait_http() { # url tries label
  local url="$1" tries="${2:-20}" label="$3" code
  for _ in $(seq 1 "$tries"); do
    code=$(http_code "$url")
    if [ "$code" = "200" ] || [ "$code" = "302" ]; then
      echo "  ✅ $label: $code"
      return 0
    fi
    sleep 2
  done
  echo "  ❌ $label: $code"
  return 1
}

running_commit() {
  curl -s -m 5 "http://127.0.0.1:5000/api/version" 2>/dev/null \
    | python3 -c "import sys,json;print(json.load(sys.stdin).get('commit',''))" 2>/dev/null || true
}

rollback() {
  echo ""
  echo "🔄 이전 버전으로 롤백..."
  git reset --hard "$PREV_HEAD" || true
  if [ -n "${DIST_BACKUP:-}" ] && [ -f "$DIST_BACKUP" ]; then
    rm -rf frontend/dist
    tar xzf "$DIST_BACKUP" -C frontend
    docker cp frontend/dist/. yp_flask:/yp_project/frontend/dist/ 2>/dev/null || true
  fi
  docker restart yp_flask || true
  sleep 8
  if wait_http "http://127.0.0.1:5000/" 15 "롤백 후 사이트"; then
    echo "✅ 롤백 완료: $(git log --oneline -1)"
  else
    echo "❌ 롤백 후에도 응답 이상 → docker logs yp_flask --tail=50"
  fi
}

# ---------------- 1) 사전 점검 ----------------
echo "[1/9] 사전 점검"
[ -f .env ] || { echo "❌ .env 없음"; exit 1; }
command -v git >/dev/null || { echo "❌ git 없음"; exit 1; }
docker ps >/dev/null 2>&1 || { echo "❌ docker 응답 없음"; exit 1; }
for c in yp_flask yp_postgres; do
  docker ps --format '{{.Names}}' | grep -qx "$c" || { echo "❌ $c 미실행"; exit 1; }
done
AVAIL=$(df -Pm . | awk 'NR==2{print $4}')
[ "$AVAIL" -ge 300 ] || { echo "❌ 디스크 부족: ${AVAIL}MB"; exit 1; }
echo "  디스크 여유: ${AVAIL}MB"

PREV_HEAD=$(git rev-parse HEAD)
DIST_BACKUP=""
echo "  현재 HEAD: $PREV_HEAD"

# ---------------- 2) 원격 확인 ----------------
echo "[2/9] 원격 코드 확인"
git fetch origin dev
REMOTE_HEAD=$(git rev-parse origin/dev)
echo "  원격 HEAD: $REMOTE_HEAD"

if [ "$PREV_HEAD" = "$REMOTE_HEAD" ] && [ "$FORCE" = "0" ]; then
  echo "  변경 없음 → 배포 생략 (--force 로 강제)"
  exit 0
fi

echo "  반영될 커밋:"
git log --oneline "$PREV_HEAD..$REMOTE_HEAD" | sed 's/^/    /' | head -30

CHANGED=$(git diff --name-only "$PREV_HEAD..$REMOTE_HEAD" || true)
NEED_RESTART=0
echo "$CHANGED" | grep -qE '(\.py$|requirements\.txt$|Dockerfile)' && NEED_RESTART=1
FRONT_CHANGED=0
echo "$CHANGED" | grep -qE '^frontend/' && FRONT_CHANGED=1
echo "  파이썬 변경: $NEED_RESTART / 프론트 변경: $FRONT_CHANGED"

if [ "$DRY" = "1" ]; then
  echo "  --dry-run: 여기서 종료"
  exit 0
fi

# ---------------- 3) 프론트 빌드 (서비스 무중단) ----------------
echo "[3/9] 프론트엔드 빌드"
if [ "$NO_BUILD" = "1" ]; then
  echo "  --no-build: 생략"
elif [ "$FRONT_CHANGED" = "0" ] && [ "$FORCE" = "0" ]; then
  echo "  프론트 변경 없음 → 생략"
else
  command -v npm >/dev/null || { echo "❌ npm 없음 → WSL에서 빌드 후 dist 복사 필요 (서비스는 그대로)"; exit 1; }
  if ! ( cd frontend && npm run build ); then
    echo "❌ 빌드 실패 → 서비스는 그대로 유지 (중단)"; exit 1
  fi
  echo "  빌드 성공"
fi

# ---------------- 4) 백업 ----------------
echo "[4/9] 백업"
if [ -d frontend/dist ]; then
  DIST_BACKUP="$LOG_DIR/dist_$(date +%Y%m%d_%H%M%S).tgz"
  tar czf "$DIST_BACKUP" -C frontend dist
  echo "  dist 백업: $(basename "$DIST_BACKUP")"
fi
if [ "$SKIP_DB" = "0" ] && docker ps --format '{{.Names}}' | grep -qx yp_postgres; then
  DB_DUMP="$LOG_DIR/db_$(date +%Y%m%d_%H%M%S).dump"
  if docker exec yp_postgres pg_dump -U yp_dev -d yp_local -Fc > "$DB_DUMP" 2>/dev/null; then
    echo "  DB 백업: $(basename "$DB_DUMP") ($(du -h "$DB_DUMP" | cut -f1))"
  else
    rm -f "$DB_DUMP"; echo "  (DB 백업 실패 - 계속 진행)"
  fi
fi

# ---------------- 5) 코드 반영 ----------------
echo "[5/9] 코드 반영"
git reset --hard "$REMOTE_HEAD"
echo "  HEAD: $(git log --oneline -1)"

if [ -d frontend/dist ]; then
  docker cp frontend/dist/. yp_flask:/yp_project/frontend/dist/ 2>/dev/null || true
  echo "  dist 컨테이너 반영"
fi

# ---------------- 6) 재기동 + 실행 커밋 검증 ----------------
echo "[6/9] 서비스 재기동"
if [ "$NEED_RESTART" = "1" ]; then
  docker restart yp_flask
  sleep 10
  RUNNING=$(running_commit)
  echo "  실행 중 커밋: ${RUNNING:-응답없음} (기대: $(git rev-parse --short HEAD))"
  if [ "$RUNNING" != "$(git rev-parse --short HEAD)" ]; then
    echo "  ⚠️ 실행 코드가 최신이 아님 → 컨테이너 강제 재생성"
    docker compose up -d --force-recreate flask_app >/dev/null 2>&1 || docker restart yp_flask
    sleep 12
    RUNNING=$(running_commit)
    echo "  재확인 커밋: ${RUNNING:-응답없음}"
    if [ "$RUNNING" != "$(git rev-parse --short HEAD)" ]; then
      echo "❌ 실행 코드 반영 실패"
      rollback
      echo "배포 중단 (로그: $LOG)"; exit 1
    fi
  fi
  docker restart yp_scheduler || true
  docker restart yp_moderation_worker 2>/dev/null || true
  echo "  재기동 완료"
else
  echo "  파이썬 변경 없음 → 재시작 생략"
fi

# ---------------- 7) HTTP 검증 ----------------
echo "[7/9] HTTP 검증"
FAIL=0
wait_http "http://127.0.0.1:5000/" 20 "사이트" || FAIL=1
wait_http "http://127.0.0.1:5000/yard" 15 "마당" || FAIL=1
wait_http "http://127.0.0.1:5000/api/news?category=world" 15 "소식 API" || FAIL=1
if [ "$FAIL" = "1" ]; then
  rollback
  echo "배포 중단 (로그: $LOG)"; exit 1
fi

# ---------------- 8) 데이터/기능 확인 ----------------
echo "[8/9] 데이터/기능 확인"
NEWS_COUNT=$(curl -s -m 5 "http://127.0.0.1:5000/api/news?category=world" | grep -o '"id":' | wc -l | tr -d ' ')
echo "  소식 페이지당 건수: $NEWS_COUNT (기대 21)"
curl -s -m 5 "http://127.0.0.1:5000/api/yard" | python3 -c "
import sys,json
d=json.load(sys.stdin); items=d.get('items',[])
print('  마당 항목:', len(items), '| 행사(날짜):', sum(1 for i in items if i.get('event_date_iso')))
" 2>/dev/null || echo "  마당 API 확인 실패"
if docker exec yp_flask sh -c "grep -q '미번역 일괄 번역' /yp_project/frontend/dist/assets/*.js" 2>/dev/null; then
  echo "  프론트 번역 버튼: 포함"
else
  echo "  ⚠️ 프론트 번역 버튼 없음 (빌드 확인)"
fi

# ---------------- 9) 완료 ----------------
echo "[9/9] 완료"
echo ""
echo "✅ 배포 완료: $(git log --oneline -1)"
echo "   https://www.unocum.kr (Ctrl+Shift+R)"
echo "   로그: $LOG"
echo ""
echo "📌 선택 작업:"
echo "   미번역 번역: docker exec -i yp_flask python3 scripts/translate_untranslated.py --gemini-only --limit 5 --sleep 15"
echo "   RAG 재구축: bash scripts/rebuild_rag.sh"
