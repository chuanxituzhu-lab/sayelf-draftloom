param(
  [string]$AppId = '',
  [int]$Port = 4177
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root '.local-data'
$configPath = Join-Path $dataDir 'draftloom.config.json'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

if (-not $AppId) { $AppId = Read-Host 'Enter WeChat Official Account AppID' }
$secret = Read-Host 'Enter the new WeChat AppSecret (hidden input; never written to command history)' -AsSecureString
if (-not $AppId) { throw 'AppID cannot be empty' }

$config = [ordered]@{
  appId = $AppId
  appSecretProtected = ($secret | ConvertFrom-SecureString)
  port = $Port
}
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
Write-Host "Local configuration saved with DPAPI protection: $configPath"
Write-Host 'Next: run npm run start:background or npm run autostart:install'
