#!/bin/sh
set -eu
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "created deploy/.env from .env.example"
fi
if grep -q 'host.docker.internal:5000' .env; then
  sed -i 's|host.docker.internal:5000|host.docker.internal:15000|' .env
  echo "updated FOT_SHOP_API_URL to shop-proxy :15000"
fi
if ! grep -q '^FOT_TUNNEL_AUTH=' .env; then
  echo 'FOT_TUNNEL_AUTH=fot:e7Kq9mN2pL4xW8vR' >> .env
fi

docker compose up -d --build
docker compose ps
echo
echo "seller gateway: http://0.0.0.0:${FOT_HTTP_PORT:-4700}"
echo "seller direct:  http://0.0.0.0:${FOT_SELLER_PORT:-4701}"
