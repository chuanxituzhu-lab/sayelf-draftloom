$ErrorActionPreference = 'Stop'
$taskName = 'Draftloom Local Server'
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removed Windows logon task: $taskName"
