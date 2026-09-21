#!/bin/sh
# Run once on the VPS as root. Keeps shop API off the public internet.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root: sudo sh deploy/enable-host-tunnel.sh"
  exit 1
fi

sshd=""
for c in /etc/ssh/sshd_config /etc/sshd_config; do
  [ -f "$c" ] && sshd="$c" && break
done
if [ -n "$sshd" ]; then
  if grep -q '^GatewayPorts' "$sshd"; then
    sed -i 's/^GatewayPorts.*/GatewayPorts clientspecified/' "$sshd"
  elif grep -q '^#GatewayPorts' "$sshd"; then
    sed -i 's/^#GatewayPorts.*/GatewayPorts clientspecified/' "$sshd"
  else
    printf '\nGatewayPorts clientspecified\n' >> "$sshd"
  fi
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow 4700:4703/tcp || true
  ufw allow from 172.16.0.0/12 to any port 15000 proto tcp || true
  ufw allow from 192.168.0.0/16 to any port 15000 proto tcp || true
  ufw deny 15000/tcp || true
  ufw deny 5000/tcp || true
fi

echo "VPS is ready for the shop tunnel."
echo "From the shop PC keep this running:"
echo "  powershell -File scripts/Start-ShopTunnel.ps1 -VpsUser YOUR_SSH_USER"
echo "Then: cd deploy && ./up.sh"
