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
    echo "  -> No dependency changes, skipping rebuild."
fi

# 3. Restart services (code changes reflected via volume mount)
echo "[3/6] Restarting services..."
docker compose -f $COMPOSE_FILE up -d

# 4. DB Migration (Flask-Migrate)
echo "[4/6] Running database migration..."
docker exec -e FLASK_APP=run.py $FLASK_CONTAINER flask db upgrade || {
    echo "  !! WARNING: DB migration failed! Check migration files."
    echo "  !! Continuing with deployment..."
}

# 5. Copy frontend dist if built locally
echo "[5/6] Checking frontend..."
if [ -d "frontend/dist" ]; then
    docker cp frontend/dist/. $FLASK_CONTAINER:/yp_project/frontend/dist/
    echo "  -> Frontend dist copied."
else
    echo "  -> No local frontend/dist found, skipping."
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
