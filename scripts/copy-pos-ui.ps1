$ErrorActionPreference = "Stop"
$src = "c:\Users\Future of Technology\Documents\pos\web\fot-pos\dist"
$dst = "C:\Program Files\FOT POS Cashier\resources\fot-pos"
New-Item -ItemType Directory -Path (Join-Path $dst "assets") -Force | Out-Null
Copy-Item -Path (Join-Path $src "index.html") -Destination $dst -Force
Copy-Item -Path (Join-Path $src "assets\*") -Destination (Join-Path $dst "assets") -Force
Write-Host "POS UI copied to $dst"
