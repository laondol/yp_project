#!/usr/bin/env bash
# 커밋·푸시 원스톱: 검증 → 스테이징 → 금지파일 검사 → 커밋 → 푸시
# 사용법: ./commit_push.sh "커밋 메시지" [추가할 새 파일 ...]
set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-}"
if [ -z "$MSG" ]; then
  echo '사용법: ./commit_push.sh "커밋 메시지" [추가할 새 파일 ...]'
  exit 1
fi
shift

# 1) 원격 뒤처침 확인 (push 거부 사전 차단)
git fetch origin dev || { echo "[FAIL] fetch 실패 — 네트워크/SSH 확인"; exit 1; }
BEHIND=$(git rev-list --count HEAD..origin/dev)
if [ "$BEHIND" -gt 0 ]; then
  echo "[FAIL] origin/dev가 ${BEHIND}커밋 앞서 있습니다. 먼저 다음을 실행하세요:"
  echo "        git pull --ff-only origin dev"
  exit 1
fi

# 2) 변경 Python 문법 검증
while IFS= read -r f; do
  [ -f "$f" ] || continue
  echo "py_compile: $f"
  python3 -m py_compile "$f"
done < <(git diff --name-only HEAD | grep '\.py$' || true)

# 3) 프론트 빌드 (타입체크 포함)
echo "frontend build..."
(cd frontend && npm run build)

# 4) 스테이징: 수정된 추적 파일 + 명시한 새 파일 (+ 스크립트 본인 최초 1회 자동 등록)
git add -u
for f in "$@"; do git add -- "$f"; done
if ! git ls-files --error-unmatch commit_push.sh >/dev/null 2>&1; then
  git add -- commit_push.sh
fi

if git diff --cached --quiet; then
  echo "[FAIL] 스테이징된 변경이 없습니다."
  exit 1
fi

# 5) AGENTS 커밋 금지 파일 검사
BAD=$(git diff --cached --name-only | grep -E '^deploy/|\.env_b|\.tgz$|backup_.*\.dump$|yard_posts_export\.json$|서버구축계획' || true)
if [ -n "$BAD" ]; then
  echo "[FAIL] 커밋 금지 파일이 포함되어 있습니다:"
  echo "$BAD"
  git reset -q
  exit 1
fi

# 6) 스테이징 요약 확인 → 커밋 → 푸시
echo "=== 커밋 예정 변경 ==="
git diff --cached --stat
git commit -m "$MSG"
git push origin dev
echo "[OK] 커밋·푸시 완료"
git log --oneline -1
