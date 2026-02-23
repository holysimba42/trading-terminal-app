# HFT Cash v6 - Configure Npcap for Webull Data Capture
# Run on Windows. Npcap is required for Scapy packet sniffing.
# https://npcap.com

$ErrorActionPreference = "Stop"

Write-Host "=== HFT Cash v6 - Npcap Configuration ===" -ForegroundColor Cyan

# Check if Npcap is installed
$npcapPath = "C:\Program Files\Npcap"
if (-not (Test-Path $npcapPath)) {
    Write-Host "Npcap not found. Install from: https://npcap.com/dist/npcap-1.79.exe" -ForegroundColor Yellow
    Write-Host "During install, enable 'WinPcap API-compatible Mode' for Scapy compatibility." -ForegroundColor Yellow
    exit 1
}

Write-Host "Npcap found at: $npcapPath" -ForegroundColor Green

# List available interfaces for isolation
Write-Host "`nAvailable network interfaces:" -ForegroundColor Cyan
Get-NetAdapter | Where-Object Status -eq "Up" | ForEach-Object {
    Write-Host "  - $($_.Name): $($_.InterfaceDescription)"
}

# Update sniffer config with interface (optional)
$configPath = Join-Path $PSScriptRoot "..\src\sniffer\config.json"
if (Test-Path $configPath) {
    $config = Get-Content $configPath | ConvertFrom-Json
    Write-Host "`nCurrent config.json webull_hosts: $($config.webull_hosts -join ', ')" -ForegroundColor Gray
    Write-Host "To isolate a specific interface, add `"interface`": `"<AdapterName>`" to config.json" -ForegroundColor Gray
}

Write-Host "`nConfigure complete. Run: python src/sniffer/capture.py" -ForegroundColor Green
