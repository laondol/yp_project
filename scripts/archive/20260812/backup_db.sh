#!/bin/bash
# DB 백업 스크립트 (서버에서 실행)
# 매일 03:00 실행, 3일 보관

set -e

BACKUP_DIR="/backup/db"
DATE=$(date +%F)
FILE="${BACKUP_DIR}/yp_local_${DATE}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting DB backup..."
docker exec yp_postgres pg_dump -U yp_dev yp_local | gzip > "${FILE}"
echo "[$(date)] Backup saved: ${FILE}"

# 3일 초과 파일 삭제
find "${BACKUP_DIR}" -name "yp_local_*.sql.gz" -mtime +2 -delete
echo "[$(date)] Old backups cleaned (keep 3 days)"