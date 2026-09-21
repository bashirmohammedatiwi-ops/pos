#!/bin/sh
set -eu
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "created deploy/.env from .env.example"
  echo "edit FOT_SHOP_API_URL then run again if the shop API is not on this machine"
fi

docker compose up -d --build
docker compose ps
echo
echo "seller gateway: http://0.0.0.0:${FOT_HTTP_PORT:-4700}"
echo "seller direct:  http://0.0.0.0:${FOT_SELLER_PORT:-4701}"
