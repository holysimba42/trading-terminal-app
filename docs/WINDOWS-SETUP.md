# HFT Cash v6 - Windows Integration Guide

Validate and run the full stack on Windows for Webull Ghost-Mode.

## Prerequisites

| Component | Version | Purpose |
|-----------|---------|---------|
| Node.js | ≥18 | Engine, C++ addon |
| Python | 3.8+ | Sniffer (Scapy) |
| Npcap | 1.79+ | Packet capture (Scapy backend) |
| Webull Desktop | Latest | Ghost-Mode target (HWND) |
| Visual Studio Build Tools | 2019+ | node-gyp C++ compile |

## 1. Install Npcap

1. Download: https://npcap.com/dist/npcap-1.79.exe
2. Run installer
3. **Enable "WinPcap API-compatible Mode"** (required for Scapy)
4. Run `scripts/Configure-Npcap.ps1` to verify

## 2. Build C++ Kernel

```powershell
cd C:\path\to\hft-cash-v6
npm install
npm run rebuild
```

Requires:
- Windows SDK
- Visual Studio Build Tools (C++ workload)
- `node-gyp` (included as devDep)

The addon `webull_ghost.node` sends `WM_LBUTTONDOWN`/`WM_LBUTTONUP` to "Webull Desktop" window.

## 3. Python Sniffer

```powershell
cd src\sniffer
pip install -r requirements.txt
python capture.py --dry-run   # Validate config
python capture.py             # Live capture (admin for raw sockets)
```

On Windows, sniffer connects to `127.0.0.1:31337` (TCP). Engine listens there.

## 4. Engine Startup Order

1. **Start engine first** (listens on TCP 31337):
   ```powershell
   npm start
   ```

2. **Start sniffer** (connects to engine):
   ```powershell
   python src\sniffer\capture.py
   ```

3. **Webull Desktop** must be open for Ghost-Mode execution.

## 5. T+1 Settlement (Task Scheduler)

```powershell
.\scripts\Schedule-Settlement.ps1
```

Creates:
- `HFT-Cash-V6-Settle-T1` — 4:00 PM ET (EOD)
- `HFT-Cash-V6-Reset-Daily` — 9:30 AM ET (market open)

## 6. Latency Targets

| Layer | Target | Notes |
|-------|--------|------|
| Data | <10ms | Scapy + BPF filter on Webull IPs |
| Execution | <5ms | SendMessage to HWND, no mouse driver |

## 7. Troubleshooting

| Issue | Fix |
|-------|-----|
| `executeClick` returns false | Webull Desktop must be open; window title "Webull Desktop" |
| Scapy PermissionError | Run as Administrator or install Npcap |
| node-gyp build fails | Install VS Build Tools: `npm install -g windows-build-tools` |
| Sniffer can't connect | Start `npm start` before sniffer |
