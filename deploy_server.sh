#!/bin/bash
# ============================================================
# 양평서버 원클릭 배포 스크립트
# 사용법 (양평서버에서): bash deploy_server.sh
# - 코드 최신화(충돌 없이 reset) → 프론트엔드 빌드 → 재시작 → 자동 확인
# ============================================================
set -e
cd "$(dirname "$0")"

echo "=== [1/5] 코드 최신화 (원격 상태로 초기화 - 충돌 없음) ==="
git fetch origin
git reset --hard origin/dev
echo "  HEAD: $(git log --oneline -1)"

echo "=== [2/5] 프론트엔드 빌드 ==="
cd frontend
npm run build
cd ..

echo "=== [3/5] 컨테이너 재시작 (새 테이블/컬럼 자동 생성) ==="
docker restart yp_flask yp_scheduler
echo "  10초 대기 (마이그레이션)..."
sleep 10

echo "=== [4/5] 마이그레이션 확인 ==="
docker logs yp_flask 2>&1 | grep "auto-add" | tail -5 || echo "  (신규 컬럼 없음 - 정상)"

echo "=== [5/5] 상태 확인 ==="
FLASK_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5000/ || echo "000")
YARD_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5000/yard || echo "000")
echo "  사이트(flask): $FLASK_CODE | 마당(/yard): $YARD_CODE"
echo ""
if [ "$FLASK_CODE" = "200" ]; then
  echo "✅ 배포 완료! https://www.unocum.kr 에서 확인하세요."
else
  echo "⚠️ flask 응답 이상($FLASK_CODE). 다음을 확인하세요:"
  echo "   docker logs yp_flask --tail=30"
  echo "   502이면: sudo systemctl restart nginx"
fi
echo ""
echo "📌 선택 작업:"
echo "   AI 백필(신청기간 등 채우기): docker exec yp_flask python /yp_project/scripts/yard_backfill_fields.py"
echo "   검색 인덱스 즉시 재구축(삭제내용 검색 제거): bash scripts/rebuild_rag.sh"
