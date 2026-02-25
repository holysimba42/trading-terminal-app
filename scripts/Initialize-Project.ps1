# HFT Cash v6 - Initialize-Project
# Wipes current directory (excluding .git), scaffolds new stack, binds C++ N-API module.
# Run from project root.

param(
    [switch]$Wipe,
    [switch]$SkipRebuild
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot + "\.."

if ($Wipe) {
    Write-Host "Wiping non-git files..." -ForegroundColor Yellow
    Get-ChildItem -Path $ProjectRoot -Exclude ".git" | Remove-Item -Recurse -Force
    Set-Location $ProjectRoot
}

# Scaffold directories
$dirs = @("src\engine", "src\kernel", "src\sniffer", "data")
foreach ($d in $dirs) {
    $path = Join-Path $ProjectRoot $d
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
        Write-Host "Created: $d"
    }
}

# npm install
Set-Location $ProjectRoot
if (Test-Path "package.json") {
    npm install
}

# Build TypeScript
if (Test-Path "tsconfig.json") {
    npm run build
}

# Rebuild C++ native addon (Windows: full Webull Ghost-Mode; Linux: stub)
if (-not $SkipRebuild) {
    Set-Location $ProjectRoot
    npm run rebuild
    Write-Host "C++ kernel module built." -ForegroundColor Green
}

Write-Host "Initialize-Project complete." -ForegroundColor Green
