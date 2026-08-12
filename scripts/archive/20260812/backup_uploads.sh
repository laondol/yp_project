#!/bin/bash
# 업로드 파일 백업 스크립트 (서버에서 실행)
# 매일 03:10 실행, 3일 보관

set -e

BACKUP_DIR="/backup/uploads"
DATE=$(date +%F)
FILE="${BACKUP_DIR}/uploads_${DATE}.tar.gz"
SRC_DIR="/home/ubuntu/yp_project/uploads"

mkdir -p "${BACKUP_DIR}"

if [ -d "${SRC_DIR}" ] && [ "$(ls -A ${SRC_DIR})" ]; then
    echo "[$(date)] Starting uploads backup..."
    tar -czf "${FILE}" -C "$(dirname ${SRC_DIR})" "$(basename ${SRC_DIR})"
    echo "[$(date)] Backup saved: ${FILE}"
else
    echo "[$(date)] No uploads directory or empty, skipping"
    exit 0
fi

# 3일 초과 파일 삭제
find "${BACKUP_DIR}" -name "uploads_*.tar.gz" -mtime +2 -delete
echo "[$(date)] Old backups cleaned (keep 3 days)"