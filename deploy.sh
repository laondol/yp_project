#!/bin/bash
set -e

echo "=== 양평자율플랫폼 배포 스크립트 ==="

# 1. 기존 서비스 정지
echo "[1/6] 기존 서비스 정지..."
sudo supervisorctl stop all 2>/dev/null || true
sudo systemctl stop nginx 2>/dev/null || true
sudo systemctl stop postgresql 2>/dev/null || true

# 2. Docker 설치
echo "[2/6] Docker 설치..."
if ! command -v docker &> /dev/null; then
    sudo apt install -y docker.io docker-compose-plugin
    sudo systemctl enable docker
    sudo systemctl start docker
    sudo usermod -aG docker ubuntu
fi

# 3. DB 덤프 (PostgreSQL이 아직 살아있으면)
echo "[3/6] DB 백업..."
if sudo systemctl is-active --quiet postgresql; then
    sudo -u postgres pg_dump -d yp_dev -F c -f /home/ubuntu/yp_dev_backup.dump 2>/dev/null || true
fi

# 4. docker-compose로 실행
echo "[4/6] Docker 컨테이너 시작..."
cd /home/ubuntu/yp_project
docker compose -f docker-compose.prod.yml down 2>/dev/null || true
docker compose -f docker-compose.prod.yml up -d --build

# 5. DB 복원
echo "[5/6] DB 복원..."
sleep 3
if [ -f /home/ubuntu/yp_dev_backup.dump ]; then
    docker exec -i yp_postgres pg_restore -U yp_dev -d yp_local --no-owner --no-privileges < /home/ubuntu/yp_dev_backup.dump 2>/dev/null || true
fi

# 6. Nginx 설정
echo "[6/6] Nginx 설정..."
sudo cp /home/ubuntu/yp_project/nginx/yp_project.conf /etc/nginx/sites-available/yp_project
sudo ln -sf /etc/nginx/sites-available/yp_project /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "=== 배포 완료! ==="
echo "https://test.unocum.kr 접속 테스트!"
