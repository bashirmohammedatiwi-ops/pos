#!/bin/sh
# Optional VPS helper: keep shop API off the public internet, open seller + sync ports.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root: sudo sh deploy/enable-host-tunnel.sh"
  exit 1
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow 4700:4703/tcp || true
  ufw allow 4705/tcp || true
  ufw deny 5000/tcp || true
  ufw deny 15000/tcp || true
fi

echo "VPS ports ready: 4700-4703 seller web, 4705 shop sync."
echo "No tunnel is required. Shop POS Server pushes data to :4705."
echo "Then: cd ~/pos/deploy && ./up.sh"
