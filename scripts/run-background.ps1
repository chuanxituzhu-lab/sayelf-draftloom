$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root '.local-data\draftloom.config.json'
if (-not (Test-Path -LiteralPath $configPath)) {
  throw 'Local configuration not found. Run npm run configure:local first.'
}

$config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
$secure = ConvertTo-SecureString ([string]$config.appSecretProtected)
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plainSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }

$env:WECHAT_APP_ID = [string]$config.appId
$env:WECHAT_APP_SECRET = $plainSecret
$env:PORT = if ($config.port) { [string]$config.port } else { '4177' }
$logDir = Join-Path $root '.local-data'
$stdoutLog = Join-Path $logDir 'draftloom-server.log'
$stderrLog = Join-Path $logDir 'draftloom-server.error.log'
$node = (Get-Command node.exe -ErrorAction Stop).Source
& $node (Join-Path $root 'server.mjs') >> $stdoutLog 2>> $stderrLog
