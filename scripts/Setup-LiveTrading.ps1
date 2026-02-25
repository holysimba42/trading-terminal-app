<#
.SYNOPSIS
    HFT Cash v6 - Automated Live Trading Setup
    One script to validate, install, build, configure, and prepare for live trading.

.DESCRIPTION
    Checks all prerequisites, installs dependencies, builds the project and C++ kernel,
    writes .env for live trading, validates the sniffer, detects Webull Desktop, schedules
    T+1 settlement, and reports remaining manual steps.

    Run from the project root:
        .\scripts\Setup-LiveTrading.ps1               # Full live setup
        .\scripts\Setup-LiveTrading.ps1 -Paper         # Paper trading mode
        .\scripts\Setup-LiveTrading.ps1 -CheckOnly     # Validate only, no changes
        .\scripts\Setup-LiveTrading.ps1 -SkipSchedule  # Skip Task Scheduler setup

.PARAMETER Paper
    Configure for paper trading (PAPER_TRADING=1) instead of live.

.PARAMETER CheckOnly
    Only run prerequisite checks. Do not install, build, or modify anything.

.PARAMETER SkipSchedule
    Skip T+1 settlement Task Scheduler registration (requires Administrator).
#>
param(
    [switch]$Paper,
    [switch]$CheckOnly,
    [switch]$SkipSchedule
)

$ErrorActionPreference = "Continue"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# --- Helpers ---

$script:PassCount = 0
$script:FailCount = 0
$script:WarnCount = 0

function Write-Pass {
    param([string]$Message)
    $script:PassCount++
    Write-Host "  [PASS] $Message" -ForegroundColor Green
}

function Write-Fail {
    param([string]$Message)
    $script:FailCount++
    Write-Host "  [FAIL] $Message" -ForegroundColor Red
}

function Write-Warn {
    param([string]$Message)
    $script:WarnCount++
    Write-Host "  [WARN] $Message" -ForegroundColor Yellow
}

function Write-Info {
    param([string]$Message)
    Write-Host "  [INFO] $Message" -ForegroundColor Cyan
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "=== $Message ===" -ForegroundColor White
}

function Test-CommandExists {
    param([string]$Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Get-SemVer {
    param([string]$VersionString)
    if ($VersionString -match '(\d+)\.(\d+)\.(\d+)') {
        return @{ Major = [int]$Matches[1]; Minor = [int]$Matches[2]; Patch = [int]$Matches[3] }
    }
    return $null
}

# --- Banner ---

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  HFT Cash v6 - Live Trading Setup" -ForegroundColor Cyan
if ($Paper) {
    Write-Host "  Mode: PAPER TRADING (no real execution)" -ForegroundColor Yellow
} else {
    Write-Host "  Mode: LIVE TRADING (real execution enabled)" -ForegroundColor Red
}
if ($CheckOnly) {
    Write-Host "  (Check-only mode: no changes will be made)" -ForegroundColor Gray
}
Write-Host "================================================================" -ForegroundColor Cyan


# ============================================================
# PHASE 1: Prerequisite Checks
# ============================================================

Write-Step "Phase 1: Prerequisite Checks"

# --- 1a. Operating System ---

if ($env:OS -eq "Windows_NT") {
    Write-Pass "Windows detected: $([System.Environment]::OSVersion.VersionString)"
} else {
    Write-Fail "This script requires Windows. Ghost-Mode uses Win32 API (SendMessage)."
    Write-Host "         See docs/WINDOWS-SETUP.md for details." -ForegroundColor Gray
    exit 1
}

# --- 1b. Node.js ---

if (Test-CommandExists "node") {
    $nodeRaw = (node --version 2>&1).ToString().TrimStart("v")
    $nodeVer = Get-SemVer $nodeRaw
    if ($nodeVer -and $nodeVer.Major -ge 18) {
        Write-Pass "Node.js v$nodeRaw (>= 18 required)"
    } else {
        Write-Fail "Node.js v$nodeRaw is too old. Version >= 18 required."
        Write-Host "         Download: https://nodejs.org" -ForegroundColor Gray
    }
} else {
    Write-Fail "Node.js not found."
    Write-Host "         Download: https://nodejs.org" -ForegroundColor Gray
}

# --- 1c. npm ---

if (Test-CommandExists "npm") {
    $npmRaw = (npm --version 2>&1).ToString()
    Write-Pass "npm v$npmRaw"
} else {
    Write-Fail "npm not found (should come with Node.js)."
}

# --- 1d. Python ---

$pythonCmd = $null
foreach ($cmd in @("python", "python3", "py")) {
    if (Test-CommandExists $cmd) {
        $pythonCmd = $cmd
        break
    }
}

if ($pythonCmd) {
    $pyRaw = (& $pythonCmd --version 2>&1).ToString()
    if ($pyRaw -match '(\d+\.\d+\.\d+)') {
        $pyVer = Get-SemVer $Matches[1]
        if ($pyVer -and ($pyVer.Major -gt 3 -or ($pyVer.Major -eq 3 -and $pyVer.Minor -ge 8))) {
            Write-Pass "$pyRaw ($pythonCmd) (>= 3.8 required)"
        } else {
            Write-Fail "$pyRaw is too old. Version >= 3.8 required."
            Write-Host "         Download: https://python.org" -ForegroundColor Gray
        }
    } else {
        Write-Warn "Could not parse Python version: $pyRaw"
    }
} else {
    Write-Fail "Python not found. Version >= 3.8 required for sniffer."
    Write-Host "         Download: https://python.org" -ForegroundColor Gray
    Write-Host "         Check 'Add Python to PATH' during installation." -ForegroundColor Gray
}

# --- 1e. Git ---

if (Test-CommandExists "git") {
    $gitRaw = (git --version 2>&1).ToString()
    Write-Pass "$gitRaw"
} else {
    Write-Fail "Git not found. Required for state persistence."
    Write-Host "         Download: https://git-scm.com" -ForegroundColor Gray
}

# --- 1f. Npcap ---

$npcapPath = "C:\Program Files\Npcap"
if (Test-Path $npcapPath) {
    Write-Pass "Npcap found at $npcapPath"

    $wpcapDll = Join-Path $npcapPath "wpcap.dll"
    if (Test-Path $wpcapDll) {
        Write-Pass "WinPcap API-compatible mode enabled (wpcap.dll present)"
    } else {
        Write-Warn "wpcap.dll not found in Npcap directory."
        Write-Host "         Scapy requires WinPcap API-compatible mode." -ForegroundColor Gray
        Write-Host "         Reinstall Npcap with 'WinPcap API-compatible Mode' checked." -ForegroundColor Gray
    }
} else {
    Write-Fail "Npcap not found."
    Write-Host "         Download: https://npcap.com/dist/npcap-1.79.exe" -ForegroundColor Gray
    Write-Host "         During install, CHECK 'Install Npcap in WinPcap API-compatible Mode'." -ForegroundColor Gray
}

# --- 1g. Visual Studio Build Tools (for node-gyp) ---

$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasBuildTools = $false
if (Test-Path $vsWhere) {
    $vsInstalls = & $vsWhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json 2>$null | ConvertFrom-Json
    if ($vsInstalls -and $vsInstalls.Count -gt 0) {
        $hasBuildTools = $true
        Write-Pass "Visual Studio C++ Build Tools found: $($vsInstalls[0].displayName)"
    }
}
if (-not $hasBuildTools) {
    $msbuild = Get-Command msbuild -ErrorAction SilentlyContinue
    if ($msbuild) {
        Write-Pass "MSBuild found at $($msbuild.Source)"
        $hasBuildTools = $true
    } else {
        Write-Warn "Visual Studio C++ Build Tools not detected."
        Write-Host "         Required to build the Ghost-Mode kernel (node-gyp)." -ForegroundColor Gray
        Write-Host "         Download: https://visualstudio.microsoft.com/visual-cpp-build-tools/" -ForegroundColor Gray
        Write-Host "         Select 'Desktop development with C++' workload." -ForegroundColor Gray
        Write-Host "         Or run: npm install -g windows-build-tools" -ForegroundColor Gray
    }
}

# --- 1h. Webull Desktop ---

$webullWindow = $null
try {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Window {
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
}
"@
    $titles = @("Webull Desktop", "Webull")
    foreach ($title in $titles) {
        $hwnd = [Win32Window]::FindWindow([NullString]::Value, $title)
        if ($hwnd -ne [IntPtr]::Zero) {
            $webullWindow = $title
            break
        }
    }
} catch {
    # P/Invoke not available — skip
}

if ($webullWindow) {
    Write-Pass "Webull Desktop window found: '$webullWindow'"
} else {
    Write-Warn "Webull Desktop window not detected."
    Write-Host "         Webull Desktop must be open and logged in for Ghost-Mode." -ForegroundColor Gray
    Write-Host "         Download: https://webull.com/desktop" -ForegroundColor Gray
    Write-Host "         Window title must be 'Webull Desktop' or 'Webull'." -ForegroundColor Gray
}

# --- 1i. Administrator check ---

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if ($isAdmin) {
    Write-Pass "Running as Administrator (required for sniffer and Task Scheduler)"
} else {
    Write-Warn "Not running as Administrator."
    Write-Host "         The sniffer requires Administrator for raw socket access." -ForegroundColor Gray
    Write-Host "         Task Scheduler registration also requires Administrator." -ForegroundColor Gray
    Write-Host "         Re-run this script as Administrator for full setup." -ForegroundColor Gray
}

# --- Phase 1 summary ---

Write-Host ""
Write-Host "  Prerequisites: $script:PassCount passed, $script:FailCount failed, $script:WarnCount warnings" -ForegroundColor White

if ($CheckOnly) {
    Write-Host ""
    Write-Host "Check-only mode: exiting without changes." -ForegroundColor Gray
    exit $(if ($script:FailCount -gt 0) { 1 } else { 0 })
}

if ($script:FailCount -gt 0) {
    Write-Host ""
    Write-Host "  Resolve the FAIL items above before continuing." -ForegroundColor Red
    Write-Host "  Re-run with -CheckOnly to re-validate after fixing." -ForegroundColor Gray
    $continue = Read-Host "  Continue anyway? (y/N)"
    if ($continue -ne "y" -and $continue -ne "Y") {
        exit 1
    }
}


# ============================================================
# PHASE 2: Install Dependencies & Build
# ============================================================

Write-Step "Phase 2: Install Dependencies & Build"
Set-Location $ProjectRoot

# --- 2a. npm install ---

Write-Info "Running npm install..."
$npmResult = npm install 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Pass "npm install succeeded"
} else {
    Write-Fail "npm install failed"
    Write-Host ($npmResult -join "`n") -ForegroundColor Gray
}

# --- 2b. TypeScript build ---

Write-Info "Building TypeScript (npm run build)..."
$buildResult = npm run build 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Pass "TypeScript build succeeded"
    $distFiles = @(
        "dist\engine\orchestrator.js",
        "dist\engine\monitor.js",
        "dist\engine\core.js",
        "dist\engine\parser.js",
        "dist\engine\execution.js",
        "dist\engine\settlement.js"
    )
    $missingDist = $distFiles | Where-Object { -not (Test-Path (Join-Path $ProjectRoot $_)) }
    if ($missingDist.Count -eq 0) {
        Write-Pass "All critical dist files present"
    } else {
        Write-Warn "Missing dist files: $($missingDist -join ', ')"
    }
} else {
    Write-Fail "TypeScript build failed"
    Write-Host ($buildResult -join "`n") -ForegroundColor Gray
}

# --- 2c. C++ kernel build ---

Write-Info "Building C++ Ghost-Mode kernel (npm run rebuild)..."
$rebuildResult = npm run rebuild 2>&1
$addonPath = Join-Path $ProjectRoot "src\kernel\build\Release\webull_ghost.node"
if ($LASTEXITCODE -eq 0 -and (Test-Path $addonPath)) {
    Write-Pass "Kernel addon built: $addonPath"
} else {
    Write-Warn "Kernel addon build failed or not found."
    Write-Host "         This is required for Ghost-Mode live execution." -ForegroundColor Gray
    Write-Host "         Ensure Visual Studio C++ Build Tools are installed." -ForegroundColor Gray
    if ($rebuildResult) {
        $lastLines = ($rebuildResult | Select-Object -Last 5) -join "`n"
        Write-Host "         Last output: $lastLines" -ForegroundColor Gray
    }
}

# --- 2d. Python sniffer dependencies ---

if ($pythonCmd) {
    $reqsPath = Join-Path $ProjectRoot "src\sniffer\requirements.txt"
    if (Test-Path $reqsPath) {
        Write-Info "Installing Python sniffer dependencies..."
        $pipResult = & $pythonCmd -m pip install -r $reqsPath 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Pass "Python dependencies installed (scapy, psutil)"
        } else {
            Write-Warn "pip install failed. You may need to install manually."
            Write-Host "         Run: $pythonCmd -m pip install -r src\sniffer\requirements.txt" -ForegroundColor Gray
        }
    }
} else {
    Write-Warn "Skipping Python dependencies (Python not found)"
}


# ============================================================
# PHASE 3: Configure Environment
# ============================================================

Write-Step "Phase 3: Configure Environment"
Set-Location $ProjectRoot

$envPath = Join-Path $ProjectRoot ".env"
if (Test-Path $envPath) {
    $existingEnv = Get-Content $envPath -Raw
    Write-Info "Existing .env found. Checking key settings..."

    $currentPaper = if ($existingEnv -match 'PAPER_TRADING=(\d)') { $Matches[1] } else { "?" }
    $currentMock = if ($existingEnv -match 'MOCK_EXECUTION=(\d)') { $Matches[1] } else { "?" }

    Write-Info "Current: PAPER_TRADING=$currentPaper, MOCK_EXECUTION=$currentMock"
} else {
    Write-Info "No .env file found. Creating from .env.example..."
}

if ($Paper) {
    $paperVal = "1"
    $mockVal = "1"
    $modeLabel = "PAPER TRADING"
} else {
    $paperVal = "0"
    $mockVal = "0"
    $modeLabel = "LIVE TRADING"
}

$envContent = @"
# HFT Cash v6 - Environment Variables
# Generated by Setup-LiveTrading.ps1 on $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
# Mode: $modeLabel

# Persistence
SKIP_GIT_PERSIST=0
GIT_PERSIST_PUSH=0

# Execution
MOCK_EXECUTION=$mockVal
PAPER_TRADING=$paperVal

# Alerts (set your webhook URL for MAX_DRAWDOWN / DAILY_CAP notifications)
ALERT_WEBHOOK_URL=

# Debug (set to 1 for verbose logging during initial validation)
DEBUG=1

# Monitor
MONITOR_PORT=31338

# Sniffer (set to 1 to save unparseable payloads to data/raw-capture/)
CAPTURE_RAW=0

# Logging
LOG_MAX_MB=5
"@

Set-Content -Path $envPath -Value $envContent -Encoding UTF8
Write-Pass ".env written: PAPER_TRADING=$paperVal, MOCK_EXECUTION=$mockVal (mode: $modeLabel)"
Write-Info "DEBUG=1 is enabled for initial validation. Set to 0 once confirmed working."

if (-not $Paper) {
    Write-Host ""
    Write-Host "  *** LIVE TRADING ENABLED ***" -ForegroundColor Red
    Write-Host "  PAPER_TRADING=0 and MOCK_EXECUTION=0 means Ghost-Mode clicks" -ForegroundColor Red
    Write-Host "  will be sent to Webull Desktop. Real orders will be placed." -ForegroundColor Red
    Write-Host ""
}


# ============================================================
# PHASE 4: Validate Pipeline
# ============================================================

Write-Step "Phase 4: Validate Pipeline"
Set-Location $ProjectRoot

# --- 4a. db.json ---

$dbPath = Join-Path $ProjectRoot "data\db.json"
if (Test-Path $dbPath) {
    try {
        $db = Get-Content $dbPath -Raw | ConvertFrom-Json
        if ($db.account.starting_capital -and $db.account.settled_funds) {
            Write-Pass "data/db.json valid: starting_capital=$($db.account.starting_capital), settled_funds=$($db.account.settled_funds)"
        } else {
            Write-Fail "data/db.json has invalid schema"
        }
    } catch {
        Write-Fail "data/db.json parse error: $_"
    }
} else {
    Write-Fail "data/db.json not found"
    Write-Host "         Run: git checkout -- data/db.json" -ForegroundColor Gray
}

# --- 4b. Kernel addon load test ---

if (Test-Path $addonPath) {
    Write-Info "Testing kernel addon load..."
    $loadTest = node -e "try { require('$($addonPath.Replace('\','\\'))'); console.log('OK'); } catch(e) { console.log('FAIL:' + e.message); }" 2>&1
    if ($loadTest -match "OK") {
        Write-Pass "Kernel addon loads successfully"
    } else {
        Write-Warn "Kernel addon failed to load: $loadTest"
    }
} else {
    Write-Warn "Kernel addon not found — skipping load test"
}

# --- 4c. Sniffer dry-run ---

if ($pythonCmd) {
    $capturePath = Join-Path $ProjectRoot "src\sniffer\capture.py"
    if (Test-Path $capturePath) {
        Write-Info "Running sniffer dry-run..."
        $dryRun = & $pythonCmd $capturePath --dry-run 2>&1
        $dryRunText = $dryRun -join "`n"
        if ($dryRunText -match "Dry-run: config validated") {
            Write-Pass "Sniffer dry-run passed"
            if ($dryRunText -match "Webull IPs isolated: (.+)") {
                Write-Info "Webull IPs: $($Matches[1])"
            }
            if ($dryRunText -match "BPF filter: (.+)") {
                Write-Info "BPF filter: $($Matches[1])"
            }
        } elseif ($dryRunText -match "scapy not installed") {
            Write-Fail "Scapy not installed. Run: $pythonCmd -m pip install -r src\sniffer\requirements.txt"
        } else {
            Write-Warn "Sniffer dry-run produced unexpected output:"
            Write-Host "         $dryRunText" -ForegroundColor Gray
        }
    }
} else {
    Write-Warn "Skipping sniffer dry-run (Python not found)"
}

# --- 4d. Automated tests ---

Write-Info "Running automated tests (npm run test)..."
$testResult = npm run test 2>&1
$testText = $testResult -join "`n"
if ($testText -match "\[E2E\] PASS" -and $testText -match "PASS: 10-trade cap") {
    Write-Pass "E2E test passed"
    Write-Pass "Simulate (10-trade cap) test passed"

    Write-Info "Resetting db.json after test run..."
    git checkout -- data/db.json 2>$null
} else {
    Write-Warn "Some tests may have failed. Review output:"
    Write-Host "         $testText" -ForegroundColor Gray
}

# --- 4e. Dashboard health check ---

Write-Info "Starting dashboard for health check..."
$monitorPath = Join-Path $ProjectRoot "dist\engine\monitor.js"
if (Test-Path $monitorPath) {
    $env:PAPER_TRADING = "1"
    $monitorProc = Start-Process -FilePath "node" -ArgumentList $monitorPath -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 3

    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:31338/health" -TimeoutSec 5 -ErrorAction Stop
        if ($health.status -eq "ok") {
            Write-Pass "Dashboard health check passed (http://127.0.0.1:31338/)"
        } else {
            Write-Warn "Dashboard returned unexpected health response"
        }
    } catch {
        Write-Warn "Dashboard health check failed: $_"
    }

    try { $monitorProc | Stop-Process -Force -ErrorAction SilentlyContinue } catch {}
    $env:PAPER_TRADING = $null
} else {
    Write-Warn "dist/engine/monitor.js not found — skipping dashboard check"
}


# ============================================================
# PHASE 5: Schedule T+1 Settlement
# ============================================================

if (-not $SkipSchedule) {
    Write-Step "Phase 5: T+1 Settlement Tasks"

    if (-not $isAdmin) {
        Write-Warn "Skipping Task Scheduler setup (requires Administrator)."
        Write-Host "         Re-run as Administrator, or run manually:" -ForegroundColor Gray
        Write-Host "         .\scripts\Schedule-Settlement.ps1" -ForegroundColor Gray
    } else {
        $settlementPath = Join-Path $ProjectRoot "dist\engine\settlement.js"
        if (Test-Path $settlementPath) {
            $nodePath = (Get-Command node).Source

            try {
                $action1 = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$settlementPath`" settle-t1" -WorkingDirectory $ProjectRoot
                $trigger1 = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "4:00PM"
                Register-ScheduledTask -TaskName "HFT-Cash-V6-Settle-T1" -Action $action1 -Trigger $trigger1 -Force | Out-Null
                Write-Pass "Scheduled: HFT-Cash-V6-Settle-T1 at 4:00 PM (Mon-Fri)"
            } catch {
                Write-Warn "Failed to create Settle-T1 task: $_"
            }

            try {
                $action2 = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$settlementPath`" reset-daily" -WorkingDirectory $ProjectRoot
                $trigger2 = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "9:30AM"
                Register-ScheduledTask -TaskName "HFT-Cash-V6-Reset-Daily" -Action $action2 -Trigger $trigger2 -Force | Out-Null
                Write-Pass "Scheduled: HFT-Cash-V6-Reset-Daily at 9:30 AM (Mon-Fri)"
            } catch {
                Write-Warn "Failed to create Reset-Daily task: $_"
            }
        } else {
            Write-Warn "dist/engine/settlement.js not found — build may have failed"
        }
    }
} else {
    Write-Info "Skipping T+1 settlement scheduling (-SkipSchedule)"
}


# ============================================================
# PHASE 6: Summary & Remaining Manual Steps
# ============================================================

Write-Step "Setup Complete - Summary"

Write-Host ""
Write-Host "  Automated steps completed:" -ForegroundColor Green
Write-Host "    - Node.js dependencies installed (npm install)" -ForegroundColor White
Write-Host "    - TypeScript compiled (npm run build)" -ForegroundColor White
Write-Host "    - C++ kernel addon built (npm run rebuild)" -ForegroundColor White
Write-Host "    - Python sniffer dependencies installed" -ForegroundColor White
Write-Host "    - .env configured (mode: $modeLabel)" -ForegroundColor White
Write-Host "    - Sniffer config validated (dry-run)" -ForegroundColor White
Write-Host "    - Automated tests executed" -ForegroundColor White
Write-Host "    - Dashboard health verified" -ForegroundColor White
if (-not $SkipSchedule -and $isAdmin) {
    Write-Host "    - T+1 settlement tasks scheduled" -ForegroundColor White
}
Write-Host ""

# --- Remaining manual steps ---

$pyDisplay = if ($pythonCmd) { $pythonCmd } else { "python" }
$manualSteps = @()

if (-not $webullWindow) {
    $manualSteps += @{
        Step = "Open Webull Desktop and log in"
        Detail = @(
            "Download from https://webull.com/desktop if not installed."
            "Log in to your brokerage account."
            "Navigate to the SPY/QQQ options chain view."
            "The window title must be 'Webull Desktop' or 'Webull'."
        )
    }
}

if (-not $Paper) {
    $manualSteps += @{
        Step = "Verify Ghost-Mode click coordinates"
        Detail = @(
            "The kernel sends WM_LBUTTONDOWN at (x,y) coordinates to Webull's window."
            "By default, executeClick(0, 0) is used — you must set the correct values."
            "To find coordinates:"
            "  Option A: Use Spy++ (included with VS Build Tools)"
            "    - Open Spy++ > Find Window > drag crosshair to Webull's Buy/Sell button"
            "    - Note the client-area coordinates"
            "  Option B: PowerShell (run while hovering over the target button):"
            "    Add-Type -AssemblyName System.Windows.Forms"
            "    [System.Windows.Forms.Cursor]::Position"
            "    (subtract Webull window's top-left corner position)"
            "Modify the click coordinates in src/engine/process-payload.ts or orchestrator.ts"
            "to pass the correct (x, y) to executeClickWithRetry()."
        )
    }
}

if (-not $isAdmin) {
    $manualSteps += @{
        Step = "Re-run as Administrator"
        Detail = @(
            "The sniffer requires Administrator for raw socket capture."
            "Right-click PowerShell > 'Run as Administrator' > re-run this script."
            "Or run the sniffer separately as Administrator:"
            "  $pyDisplay src\sniffer\capture.py"
        )
    }
}

if ($manualSteps.Count -gt 0) {
    Write-Host "  Remaining manual steps:" -ForegroundColor Yellow
    Write-Host ""
    for ($i = 0; $i -lt $manualSteps.Count; $i++) {
        $s = $manualSteps[$i]
        Write-Host "  $($i + 1). $($s.Step)" -ForegroundColor Yellow
        foreach ($line in $s.Detail) {
            Write-Host "     $line" -ForegroundColor Gray
        }
        Write-Host ""
    }
} else {
    Write-Host "  No manual steps remaining!" -ForegroundColor Green
    Write-Host ""
}

# --- Startup commands ---

Write-Host "  To start trading:" -ForegroundColor Cyan
Write-Host ""
Write-Host "    Terminal 1 (engine):" -ForegroundColor White
Write-Host "      cd $ProjectRoot" -ForegroundColor Gray
Write-Host "      npm start" -ForegroundColor Gray
Write-Host ""
Write-Host "    Terminal 2 (sniffer - run as Administrator):" -ForegroundColor White
Write-Host "      cd $ProjectRoot\src\sniffer" -ForegroundColor Gray
Write-Host "      $pyDisplay capture.py" -ForegroundColor Gray
Write-Host ""
Write-Host "    Terminal 3 (dashboard - optional):" -ForegroundColor White
Write-Host "      cd $ProjectRoot" -ForegroundColor Gray
Write-Host "      npm run dashboard" -ForegroundColor Gray
Write-Host "      # Opens http://127.0.0.1:31338/" -ForegroundColor Gray
Write-Host ""

# --- Final tally ---

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Results: $script:PassCount passed, $script:FailCount failed, $script:WarnCount warnings" -ForegroundColor $(
    if ($script:FailCount -gt 0) { "Red" }
    elseif ($script:WarnCount -gt 0) { "Yellow" }
    else { "Green" }
)
if ($manualSteps.Count -gt 0) {
    Write-Host "  $($manualSteps.Count) manual step(s) remaining (see above)" -ForegroundColor Yellow
}
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

exit $(if ($script:FailCount -gt 0) { 1 } else { 0 })
