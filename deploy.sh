#!/bin/bash
set -e

COMPOSE_FILE="docker-compose.yml"
REMOTE="origin"
BRANCH="dev"
FLASK_CONTAINER="yp_flask"

echo "=== YP Project Deploy ==="

# 1. Git pull
echo "[1/6] Pulling latest changes..."
git pull $REMOTE $BRANCH

# 2. Check if RAG requirements changed (need rebuild)
echo "[2/6] Checking for dependency changes..."
RAG_CHANGED=$(git diff HEAD~1 --name-only 2>/dev/null | grep -E "^yp_rag/requirements\.txt$" || true)

if [ -n "$RAG_CHANGED" ]; then
    echo "  -> RAG requirements.txt changed, rebuilding RAG image..."
    docker compose -f $COMPOSE_FILE build rag
else
    echo "  -> No RAG dependency changes."
fi

# 백엔드 requirements 변경 시 Flask 이미지 재빌드 (누락 시 기동 실패: ModuleNotFoundError)
REQ_CHANGED=$(git diff HEAD~1 --name-only 2>/dev/null | grep -E "^requirements\.txt$" || true)
if [ -n "$REQ_CHANGED" ]; then
    echo "  -> requirements.txt changed, rebuilding Flask image..."
    docker compose -f $COMPOSE_FILE build flask_app
else
    echo "  -> No backend dependency changes."
fi

# 3. Restart services (code changes reflected via volume mount)
echo "[3/6] Restarting services..."
docker compose -f $COMPOSE_FILE up -d

# 3-1. Python 프로세스는 기동 시 코드를 메모리에 로드하므로 명시적 재시작 필수
echo "[3-1] Restarting workers..."
docker compose -f $COMPOSE_FILE restart moderation_worker
docker compose -f $COMPOSE_FILE restart scheduler

# 4. DB Migration (Flask-Migrate)
echo "[4/6] Running database migration..."
docker exec -e FLASK_APP=run.py $FLASK_CONTAINER flask db upgrade || {
    echo "  !! WARNING: DB migration failed! Check migration files."
    echo "  !! Continuing with deployment..."
}

# 5. Build frontend on the server when the toolchain is available
echo "[5/6] Preparing frontend..."
if command -v npm >/dev/null 2>&1 && [ -d "frontend/node_modules" ]; then
    echo "  -> Building frontend..."
    (cd frontend && npm run build) || { echo "  !! frontend build failed"; exit 1; }
else
    echo "  -> 서버에 npm 없음 → Docker(node:20-alpine)로 빌드"
    docker run --rm \
      -v "$PWD/frontend:/app" \
      -v yp_node_modules:/app/node_modules \
      -w /app -e NODE_OPTIONS=--max-old-space-size=2048 \
      node:20-alpine sh -c "npm ci --no-audit --no-fund && npm run build" \
      || { echo "  !! Docker frontend build failed"; exit 1; }
fi
if [ -d "frontend/dist" ]; then
    docker cp frontend/dist/. $FLASK_CONTAINER:/yp_project/frontend/dist/
    echo "  -> Frontend dist copied."
else
    echo "  -> No frontend/dist found, skipping."
fi

# 6. Restart flask one more time to pick up any DB changes
echo "[6/6] Final restart..."
docker restart $FLASK_CONTAINER

# Verify
echo ""
sleep 3
docker compose -f $COMPOSE_FILE ps
echo ""
echo "=== Deploy complete ==="
echo "  - DB migration: flask db upgrade (auto)"
echo "  - Frontend: copied to container"
echo "  - Services: restarted"
