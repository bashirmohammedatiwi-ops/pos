#!/bin/sh
# Run from anywhere on the VPS:  sh ~/pos/deploy/update.sh
set -eu

if [ -f "$0" ]; then
  here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
else
  here="$HOME/pos/deploy"
fi
root=$(CDPATH= cd -- "$here/.." && pwd)

cd "$root"
echo "repo: $root"

if git status --porcelain | grep -q .; then
  echo "stashing local VPS edits so git pull can run"
  git stash push -u -m "vps-local-$(date +%Y%m%d%H%M%S)" || true
fi

git pull origin main
chmod +x "$here/up.sh" "$here/update.sh" "$here/enable-host-tunnel.sh" 2>/dev/null || true
sh "$here/up.sh"

echo
echo "expected containers: hub, seller, manager, gateway"
docker compose -f "$here/docker-compose.yml" --env-file "$here/.env" ps
echo
echo "hub sync port 4705:"
ss -lnt 2>/dev/null | grep 4705 || netstat -lnt 2>/dev/null | grep 4705 || echo "4705 is not listening — hub failed"
