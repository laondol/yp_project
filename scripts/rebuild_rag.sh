#!/bin/bash
# RAG 검색 인덱스 즉시 재구축 (삭제된 내용을 검색에서 제거)
# 사용법: bash scripts/rebuild_rag.sh
cd "$(dirname "$0")/.."
docker exec yp_flask python - <<'EOF'
import sys
sys.path.insert(0, '/yp_project')
from run import create_app
app = create_app()
with app.app_context():
    from services.rag import rebuild_index
    rebuild_index(app)
    print('RAG 인덱스 재구축 완료 (수 분 소요, 삭제 내용 검색에서 제거됨)')
EOF
