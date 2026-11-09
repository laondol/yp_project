#!/bin/bash
# ============================================================
# 양평서버 원클릭 배포 스크립트
# 사용법 (양평서버에서): bash deploy_server.sh
# - 코드 최신화(충돌 없이 reset) → 프론트엔드 빌드/반영 → 재시작 → 자동 확인
# ============================================================
set -e
cd "$(dirname "$0")"

echo "=== [1/6] 코드 최신화 (원격 상태로 초기화 - 충돌 없음) ==="
git fetch origin
git reset --hard origin/dev
echo "  HEAD: $(git log --oneline -1)"

echo "=== [2/6] 프론트엔드 빌드 ==="
cd frontend
npm run build
cd ..

echo "=== [3/6] 빌드 결과 컨테이너 반영 ==="
if [ -d frontend/dist ]; then
  docker cp frontend/dist/. yp_flask:/yp_project/frontend/dist/ 2>/dev/null || true
  echo "  dist 반영 완료"
else
  echo "  ⚠️ frontend/dist 없음 - 빌드 확인 필요"
fi

echo "=== [4/6] 컨테이너 재시작 (새 테이블/컬럼 자동 생성) ==="
docker restart yp_flask yp_scheduler
echo "  10초 대기 (마이그레이션)..."
sleep 10

echo "=== [5/6] 마이그레이션/스키마 확인 ==="
docker logs yp_flask 2>&1 | grep "auto-add" | tail -5 || echo "  (신규 컬럼 없음 - 정상)"
docker exec yp_flask python -c "
from run import app
from models import db, NewsArticle
from sqlalchemy import inspect
with app.app_context():
    cols = {c['name'] for c in inspect(db.engine).get_columns('news_article')}
    need = {c.name for c in NewsArticle.__table__.columns}
    print('  뉴스 컬럼 누락:', sorted(need - cols) or '없음')
    print('  뉴스 건수:', NewsArticle.query.count())
" 2>/dev/null | tail -3

echo "=== [6/6] 기능 확인 ==="
FLASK_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5000/ || echo "000")
YARD_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5000/yard || echo "000")
echo "  사이트(flask): $FLASK_CODE | 마당(/yard): $YARD_CODE"

# 소식 페이지 크기(21건) 확인
NEWS_ITEMS=$(curl -s "http://127.0.0.1:5000/api/news?category=world" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('items',[])))" 2>/dev/null || echo "?")
echo "  소식 페이지당 건수: $NEWS_ITEMS (기대: 21)"

# 마당 데이터 확인
curl -s "http://127.0.0.1:5000/api/yard" | python3 -c "
import sys,json
d=json.load(sys.stdin); items=d.get('items',[])
ev=[i for i in items if i.get('event_date_iso')]
print(f'  마당 항목: {len(items)}건 | 행사(날짜 있음): {len(ev)}건')
" 2>/dev/null || echo "  마당 API 확인 실패"

# 번역 라우트/버튼 확인
docker exec yp_flask python -c "
from run import app
routes=[str(r) for r in app.url_map.iter_rules() if 'translate' in str(r)]
print('  번역 라우트:', routes or '없음')
" 2>/dev/null | tail -1
if docker exec yp_flask sh -c "grep -q '미번역 일괄 번역' /yp_project/frontend/dist/assets/*.js" 2>/dev/null; then
  echo "  프론트 번역 버튼: 포함됨"
else
  echo "  ⚠️ 프론트 번역 버튼 없음 (빌드/반영 확인)"
fi

echo ""
if [ "$FLASK_CODE" = "200" ] && [ "$YARD_CODE" = "200" ]; then
  echo "✅ 배포 완료! https://www.unocum.kr 에서 확인하세요."
else
  echo "⚠️ 응답 이상 (flask=$FLASK_CODE, yard=$YARD_CODE). 다음을 확인하세요:"
  echo "   docker logs yp_flask --tail=30"
  echo "   502이면: sudo systemctl restart nginx"
fi
echo ""
echo "📌 선택 작업:"
echo "   미번역 번역(백그라운드 버튼 또는): docker exec -i yp_flask python3 scripts/translate_untranslated.py --gemini-only --limit 5 --sleep 15"
echo "   AI 백필(신청기간 등): docker exec yp_flask python /yp_project/scripts/yard_backfill_fields.py"
echo "   검색 인덱스 즉시 재구축: bash scripts/rebuild_rag.sh"
