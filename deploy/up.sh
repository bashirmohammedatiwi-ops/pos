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
# Secrets: the old defaults are public in git, so the hub refuses them (see README).
env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }
new_secret() { openssl rand -hex 32 2>/dev/null || od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
is_weak() { [ -z "$1" ] || [ "${#1}" -lt "$2" ] || [ "$1" = 'fot-hub-sync-e7Kq9mN2pL4xW8vR' ] || [ "$1" = 'FOT-HUB-JWT-CHANGE-THIS-SECRET-MIN-32-CHARS' ]; }
# The session key lives only on the VPS: generate it (every seller/manager/staff signs in once more).
if is_weak "$(env_value FOT_HUB_JWT_KEY)" 32; then
  sed -i '/^FOT_HUB_JWT_KEY=/d' .env
  echo "FOT_HUB_JWT_KEY=$(new_secret)" >> .env
  echo "generated a private FOT_HUB_JWT_KEY in deploy/.env"
fi
# 10-year sessions from the old .env.example → 30 days (expired sessions renew for another 30 days).
if grep -q '^FOT_HUB_JWT_HOURS=87600$' .env; then
  sed -i 's/^FOT_HUB_JWT_HOURS=87600$/FOT_HUB_JWT_HOURS=720/' .env
  echo "shortened FOT_HUB_JWT_HOURS to 720"
fi
# The sync key is shared with the shop server: generate it here once, then paste it in the
# control panel (Team app -> Updates & notifications -> Hub link). Until then shop sync pauses.
if is_weak "$(env_value FOT_HUB_SYNC_KEY)" 24; then
  sed -i '/^FOT_HUB_SYNC_KEY=/d' .env
  echo "FOT_HUB_SYNC_KEY=$(new_secret)" >> .env
  SYNC_KEY_NEW=1
fi
show_sync_key() {
  [ -n "${SYNC_KEY_NEW:-}" ] || return 0
  echo
  echo "=================================================================="
  echo " NEW SHOP SYNC KEY - copy it into the control panel:"
  echo "   Team app -> Updates & notifications -> Hub link -> Enter key"
  echo
  echo "   $(env_value FOT_HUB_SYNC_KEY)"
  echo
  echo " Shop -> VPS sync pauses until it is entered. Show it again any time:"
  echo "   grep FOT_HUB_SYNC_KEY ~/pos/deploy/.env"
  echo "=================================================================="
}
trap show_sync_key EXIT
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
