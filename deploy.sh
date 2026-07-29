#!/bin/bash
set -e

COMPOSE_FILE="docker-compose.prod.yml"
REMOTE="origin"
BRANCH="dev"

echo "=== YP Project Deploy ==="

# 1. Git pull
echo "[1/4] Pulling latest changes..."
git pull $REMOTE $BRANCH

# 2. Check if RAG requirements changed (need rebuild)
echo "[2/4] Checking for dependency changes..."
RAG_CHANGED=$(git diff HEAD~1 --name-only 2>/dev/null | grep -E "^yp_rag/requirements\.txt$" || true)

if [ -n "$RAG_CHANGED" ]; then
    echo "  -> RAG requirements.txt changed, rebuilding RAG image..."
    docker compose -f $COMPOSE_FILE build rag
else
    echo "  -> No dependency changes, skipping rebuild."
fi

# 3. Restart all services (code changes reflected via volume mount)
echo "[3/4] Restarting services..."
docker compose -f $COMPOSE_FILE up -d

# 4. Verify
echo "[4/4] Verifying..."
sleep 5
docker compose -f $COMPOSE_FILE ps
echo ""
echo "=== Deploy complete ==="
