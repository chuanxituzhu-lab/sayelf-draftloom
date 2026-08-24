$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root '.local-data\draftloom.config.json'
if (-not (Test-Path -LiteralPath $configPath)) {
  throw 'Local configuration not found. Run npm run configure:local first.'
}
$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$port = if ($config.port) { [int]$config.port } else { 4177 }
$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Draftloom is already running at http://127.0.0.1:$port (PID $($existing[0].OwningProcess))"
  exit 0
}

$shellCommand = Get-Command powershell.exe -ErrorAction SilentlyContinue
if (-not $shellCommand) { $shellCommand = Get-Command pwsh.exe -ErrorAction Stop }
$powershell = $shellCommand.Source
$runner = Join-Path $root 'scripts\run-background.ps1'
Start-Process -FilePath $powershell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$runner) -WorkingDirectory $root -WindowStyle Hidden | Out-Null
$listener = $null
for ($attempt = 0; $attempt -lt 16 -and -not $listener; $attempt++) {
  Start-Sleep -Milliseconds 500
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $listener) {
  $errorLog = Join-Path $root '.local-data\draftloom-server.error.log'
  $detail = if (Test-Path -LiteralPath $errorLog) {
    (Get-Content -Tail 12 -LiteralPath $errorLog -ErrorAction SilentlyContinue) -join "`n"
  } else { 'No error log was created.' }
  throw "Draftloom failed to start in background. See $errorLog`n$detail"
}
Write-Host "Draftloom is running in background at http://127.0.0.1:$port (PID $($listener.OwningProcess))"
Write-Host 'You can close this terminal. To stop it, end the matching node process or restart Windows.'
