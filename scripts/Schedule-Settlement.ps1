# HFT Cash v6 - Schedule T+1 Settlement (Windows Task Scheduler)
# Run as Administrator. Creates two tasks: settle-t1 (EOD) and reset-daily (market open).

$ProjectRoot = $PSScriptRoot + "\.."
$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
$SettlementPath = Join-Path $ProjectRoot "dist\engine\settlement.js"

if (-not (Test-Path $SettlementPath)) {
    Write-Host "Build first: npm run build" -ForegroundColor Red
    exit 1
}

# settle-t1: 4:00 PM ET daily (weekdays)
$action1 = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$SettlementPath`" settle-t1" -WorkingDirectory $ProjectRoot
$trigger1 = New-ScheduledTaskTrigger -Daily -At "4:00PM"
$trigger1.DaysOfWeek = [System.DayOfWeek[]]@(1,2,3,4,5)  # Mon-Fri
Register-ScheduledTask -TaskName "HFT-Cash-V6-Settle-T1" -Action $action1 -Trigger $trigger1 -Force

# reset-daily: 9:30 AM ET daily (weekdays)
$action2 = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$SettlementPath`" reset-daily" -WorkingDirectory $ProjectRoot
$trigger2 = New-ScheduledTaskTrigger -Daily -At "9:30AM"
$trigger2.DaysOfWeek = [System.DayOfWeek[]]@(1,2,3,4,5)
Register-ScheduledTask -TaskName "HFT-Cash-V6-Reset-Daily" -Action $action2 -Trigger $trigger2 -Force

Write-Host "Scheduled: HFT-Cash-V6-Settle-T1 (4:00 PM), HFT-Cash-V6-Reset-Daily (9:30 AM)" -ForegroundColor Green
