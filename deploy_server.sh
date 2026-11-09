#!/bin/bash
# ============================================================
# 양평서버 안전 배포 스크립트 (v2)
# 사용법 (양평서버에서): bash deploy_server.sh [옵션]
#
#   --no-build   프론트 빌드 생략 (이미 dist 반영된 경우)
#   --force      변경 없음 검사 무시하고 강제 재배포
#   --dry-run    실제 반영 없이 점검만
#
# 안전 장치:
#   - 배포 전 HEAD/프론트 dist 자동 백업
#   - 빌드 실패 시 서비스 건드리지 않고 중단
#   - 파이썬 변경 없으면 재시작 생략 (무중단)
#   - 검증 실패 시 자동 롤백
# ============================================================
set -Eeuo pipefail
cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/deploy_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

NO_BUILD=0; FORCE=0; DRY=0
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
    --force) FORCE=1 ;;
    --dry-run) DRY=1 ;;
    *) echo "알 수 없는 옵션: $arg"; exit 1 ;;
  esac
done

echo "============================================================"
echo " 양평서버 안전 배포  $(date '+%Y-%m-%d %H:%M:%S')"
echo " 로그: $LOG"
echo "============================================================"

# ---------- 유틸 ----------
fail() { echo "❌ $*"; exit 1; }
http_code() { curl -s -o /dev/null -m 5 -w "%{http_code}" "$1" || echo "000"; }
wait_ok() {  # url, tries, label
  local url="$1" tries="${2:-20}" label="$3" code
  for i in $(seq 1 "$tries"); do
    code=$(http_code "$url")
    if [ "$code" = "200" ] || [ "$code" = "302" ]; then
      echo "  ✅ $label: $code"
      return 0
    fi
    sleep 2
  done
  echo "  ❌ $label: $code (실패)"
  return 1
}

# ---------- 1) 사전 점검 ----------
echo "[1/8] 사전 점검"
[ -f .env ] || fail ".env 없음 (프로젝트 루트 확인)"
[ -d frontend ] || fail "frontend 디렉터리 없음"
command -v git >/dev/null || fail "git 없음"
docker ps >/dev/null 2>&1 || fail "docker 응답 없음"
for c in yp_flask yp_postgres; do
  docker ps --format '{{.Names}}' | grep -qx "$c" || fail "$c 컨테이너가 실행 중이 아님"
done
AVAIL_MB=$(df -Pm . | awk 'NR==2{print $4}')
[ "$AVAIL_MB" -ge 300 ] || fail "디스크 여유 부족: ${AVAIL_MB}MB"
echo "  디스크 여유: ${AVAIL_MB}MB"

PREV_HEAD=$(git rev-parse HEAD)
DIST_BACKUP=""
echo "  현재 HEAD: $PREV_HEAD"

# ---------- 2) 코드 최신화 ----------
echo "[2/8] 코드 최신화"
git fetch origin dev
REMOTE_HEAD=$(git rev-parse origin/dev)
echo "  원격 HEAD: $REMOTE_HEAD"

if [ "$PREV_HEAD" = "$REMOTE_HEAD" ] && [ "$FORCE" = "0" ]; then
  echo "  변경 없음 → 배포 생략 (--force 로 강제 가능)"
  exit 0
fi

CHANGED=$(git diff --name-only "$PREV_HEAD..$REMOTE_HEAD" || true)
echo "  변경 파일:"
echo "$CHANGED" | sed 's/^/    /' | head -40

NEED_RESTART=0
if echo "$CHANGED" | grep -qE '(\.py$|requirements\.txt$|Dockerfile)'; then
  NEED_RESTART=1
fi
FRONT_CHANGED=0
if echo "$CHANGED" | grep -qE '^frontend/'; then
  FRONT_CHANGED=1
fi
echo "  파이썬 변경(재시작 필요): $NEED_RESTART / 프론트 변경: $FRONT_CHANGED"

if [ "$DRY" = "1" ]; then
  echo "  --dry-run: 여기서 종료 (실제 반영 안 함)"
  exit 0
fi

# ---------- 3) 프론트 빌드 (서비스 무중단) ----------
echo "[3/8] 프론트엔드 빌드"
if [ "$NO_BUILD" = "1" ]; then
  echo "  --no-build: 생략"
elif [ "$FRONT_CHANGED" = "0" ] && [ "$FORCE" = "0" ]; then
  echo "  프론트 변경 없음 → 빌드 생략"
else
  command -v npm >/dev/null || fail "npm 없음 → WSL에서 빌드 후 dist 복사 필요"
  ( cd frontend && npm run build ) || fail "프론트 빌드 실패 (서비스는 그대로 유지)"
  echo "  빌드 성공"
fi

# ---------- 4) 백업 (코드/프론트) ----------
echo "[4/8] 백업"
if [ -d frontend/dist ]; then
  DIST_BACKUP="$LOG_DIR/dist_$(date +%Y%m%d_%H%M%S).tgz"
  tar czf "$DIST_BACKUP" -C frontend dist
  echo "  dist 백업: $DIST_BACKUP"
fi

# ---------- 5) 반영 ----------
echo "[5/8] 코드 반영"
git reset --hard "$REMOTE_HEAD"
echo "  HEAD: $(git log --oneline -1)"

if [ -d frontend/dist ]; then
  docker cp frontend/dist/. yp_flask:/yp_project/frontend/dist/ 2>/dev/null || true
  echo "  dist 컨테이너 반영"
fi

# ---------- 6) 재기동 (필요 시) ----------
echo "[6/8] 서비스 재기동"
if [ "$NEED_RESTART" = "1" ]; then
  # 1차: gunicorn 무중단 리로드(HUP) 시도 → 실패 시 컨테이너 재시작
  if docker exec yp_flask sh -c 'kill -HUP 1' 2>/dev/null; then
    echo "  gunicorn 무중단 리로드(HUP) 요청"
  else
    echo "  HUP 실패 → 컨테이너 재시작"
    docker restart yp_flask
  fi
  sleep 8
  if ! wait_ok "http://127.0.0.1:5000/" 10 "리로드 후 사이트"; then
    echo "  리로드 미반영 → 컨테이너 재시작으로 전환"
    docker restart yp_flask
    sleep 8
  fi
  docker restart yp_scheduler || true
  docker restart yp_moderation_worker 2>/dev/null || true
  echo "  재기동/리로드 완료"
else
  echo "  파이썬 변경 없음 → 재시작 생략 (무중단)"
fi

# ---------- 7) 검증 ----------
echo "[7/8] 검증"
ROLLBACK_NEEDED=0
wait_ok "http://127.0.0.1:5000/" 20 "사이트" || ROLLBACK_NEEDED=1
wait_ok "http://127.0.0.1:5000/yard" 10 "마당" || ROLLBACK_NEEDED=1
wait_ok "http://127.0.0.1:5000/api/news?category=world" 10 "소식 API" || ROLLBACK_NEEDED=1

NEWS_ITEMS=$(curl -s -m 5 "http://127.0.0.1:5000/api/news?category=world" 2>/dev/null | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('items',[])))" 2>/dev/null || echo "?")
echo "  소식 페이지당 건수: $NEWS_ITEMS (기대 21)"

docker exec yp_flask python -c "
from run import app
print('  번역 라우트:', '있음' if any('translate' in str(r) for r in app.url_map.iter_rules()) else '없음')
" 2>/dev/null | tail -1 || true

# ---------- 8) 롤백 ----------
rollback() {
  echo ""
  echo "🔄 이전 버전으로 롤백합니다..."
  git reset --hard "$PREV_HEAD"
  if [ -n "$DIST_BACKUP" ] && [ -f "$DIST_BACKUP" ]; then
    rm -rf frontend/dist && tar xzf "$DIST_BACKUP" -C frontend
    docker cp frontend/dist/. yp_flask:/yp_project/frontend/dist/ 2>/dev/null || true
  fi
  docker restart yp_flask || true
  sleep 8
  if wait_ok "http://127.0.0.1:5000/" 15 "롤백 후 사이트"; then
    echo "✅ 롤백 완료 (이전 커밋: $(git log --oneline -1))"
  else
    echo "❌ 롤백 후에도 응답 이상 → docker logs yp_flask --tail=50 확인"
  fi
}

if [ "$ROLLBACK_NEEDED" = "1" ]; then
  rollback
  fail "검증 실패로 배포 중단 (로그: $LOG)"
fi

echo "[8/8] 완료"
echo ""
echo "✅ 배포 완료: $(git log --oneline -1)"
echo "   https://www.unocum.kr (브라우저 Ctrl+Shift+R)"
echo "   로그: $LOG"
echo ""
echo "📌 선택 작업:"
echo "   미번역 번역: 관리자 화면 버튼 또는"
echo "     docker exec -i yp_flask python3 scripts/translate_untranslated.py --gemini-only --limit 5 --sleep 15"
echo "   RAG 재구축: bash scripts/rebuild_rag.sh"
