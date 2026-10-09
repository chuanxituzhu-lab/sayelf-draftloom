$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root '.local-data\draftloom.config.json'
if (-not (Test-Path -LiteralPath $configPath)) {
  throw 'Local configuration not found. Run npm run configure:local first.'
}

$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$port = if ($config.port) { [int]$config.port } else { 4177 }
$baseUrl = "http://127.0.0.1:$port"
try {
  $existingStatus = Invoke-RestMethod -Uri "$baseUrl/api/wechat/status" -TimeoutSec 2
  if ($null -ne $existingStatus.remoteReady) {
    Write-Host "Draftloom is already running at $baseUrl"
    exit 0
  }
} catch {
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { throw "Port $port is occupied by another service; Draftloom was not started." }
}
$secure = ConvertTo-SecureString ([string]$config.appSecretProtected)
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plainSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }

$env:WECHAT_APP_ID = [string]$config.appId
$env:WECHAT_APP_SECRET = $plainSecret
$env:PORT = [string]$port
$logDir = Join-Path $root '.local-data'
$stdoutLog = Join-Path $logDir 'draftloom-server.log'
$stderrLog = Join-Path $logDir 'draftloom-server.error.log'
$node = (Get-Command node.exe -ErrorAction Stop).Source
& $node (Join-Path $root 'server.mjs') >> $stdoutLog 2>> $stderrLog
