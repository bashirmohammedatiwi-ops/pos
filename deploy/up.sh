#!/bin/sh
set -eu
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "created deploy/.env from .env.example"
fi
if grep -q 'host.docker.internal' .env; then
  sed -i 's|^FOT_SHOP_API_URL=.*|FOT_SHOP_API_URL=http://hub:4705|' .env
  echo "updated FOT_SHOP_API_URL to hub :4705"
fi
if ! grep -q '^FOT_HUB_SYNC_KEY=' .env; then
  echo 'FOT_HUB_SYNC_KEY=fot-hub-sync-e7Kq9mN2pL4xW8vR' >> .env
fi
if ! grep -q 'hub:' docker-compose.yml; then
  echo "this deploy folder is old. from the VPS run: cd ~/pos && git pull origin main"
  exit 1
fi

docker compose up -d --build
docker compose ps
echo
echo "seller gateway: http://0.0.0.0:${FOT_HTTP_PORT:-4700}"
echo "seller direct:  http://0.0.0.0:${FOT_SELLER_PORT:-4701}"
echo "manager:        http://0.0.0.0:${FOT_MANAGER_PORT:-4703}"
echo "shop sync:      http://0.0.0.0:4705/health"
