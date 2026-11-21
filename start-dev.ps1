$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

Start-Process powershell.exe -ArgumentList @(
  '-NoExit',
  '-Command',
  "Set-Location -LiteralPath '$backend'; node server.js"
)

Start-Process powershell.exe -ArgumentList @(
  '-NoExit',
  '-Command',
  "Set-Location -LiteralPath '$frontend'; npm run dev"
)

Write-Host 'Backend y frontend iniciados en ventanas separadas.'
Write-Host 'Frontend: http://localhost:5173'
