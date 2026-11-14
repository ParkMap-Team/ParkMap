param(
    [switch]$AllowPublicAccess,
    [string]$CloudflaredPath = 'cloudflared'
)

$ErrorActionPreference = 'Stop'
if (-not $AllowPublicAccess) {
    throw 'Not started. This exposes LIFF port 3001 to the internet. Review that access, then run again with -AllowPublicAccess.'
}
$command = Get-Command $CloudflaredPath -ErrorAction SilentlyContinue
if (-not $command) {
    throw 'Install cloudflared from https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/ or provide -CloudflaredPath.'
}
$null = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/mobile-camera' -UseBasicParsing
Write-Host 'Temporary HTTPS access for LIFF port 3001. Calibration UI and Vision API are not tunneled.'
Write-Host 'Paste the HTTPS origin into Setup > Mobile camera / QR, then create a QR.'
Write-Host 'Keep this terminal running. Ctrl+C closes the public link.'
& $command.Source tunnel --no-autoupdate --url http://127.0.0.1:3001 --protocol http2
