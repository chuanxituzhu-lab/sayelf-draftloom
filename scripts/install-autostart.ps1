$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root '.local-data\draftloom.config.json'
if (-not (Test-Path -LiteralPath $configPath)) {
  throw 'Local configuration not found. Run npm run configure:local first.'
}
$taskName = 'Draftloom Local Server'
$shellCommand = Get-Command powershell.exe -ErrorAction SilentlyContinue
if (-not $shellCommand) { $shellCommand = Get-Command pwsh.exe -ErrorAction Stop }
$powershell = $shellCommand.Source
$runner = Join-Path $root 'scripts\run-background.ps1'
$action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
$userId = "$env:USERDOMAIN\$env:USERNAME"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Installed Windows logon task: $taskName"
