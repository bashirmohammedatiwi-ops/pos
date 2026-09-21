# Reverse tunnel: shop API :5000 -> VPS localhost:5000 (not published publicly).
# Then on the VPS set FOT_SHOP_API_URL=http://host.docker.internal:5000 and restart docker compose.
param(
    [Parameter(Mandatory = $true)][string]$VpsUser,
    [string]$VpsHost = "187.124.23.65",
    [int]$ShopPort = 5000
)

$ErrorActionPreference = "Stop"
Write-Host "Tunnel $ShopPort on this PC -> ${VpsUser}@${VpsHost}:127.0.0.1:$ShopPort" -ForegroundColor Cyan
Write-Host "Leave this window open. On the VPS: FOT_SHOP_API_URL=http://host.docker.internal:5000 && docker compose up -d" -ForegroundColor DarkCyan
ssh -N -R "127.0.0.1:${ShopPort}:127.0.0.1:${ShopPort}" "${VpsUser}@${VpsHost}"
