# HFT Cash v6 - Windows Live Trading Setup Guide

> **WARNING:** Live trading with real money carries significant financial risk. 0DTE options can lose 100% of value within minutes. Packet sniffing and UI automation may violate Webull's Terms of Service. See `docs/SECURITY-COMPLIANCE.md`. This guide is for educational/research purposes.

This guide walks through every step to go from a fresh Windows machine to a fully operational live trading system.

## Quick Start (Automated)

For a one-command setup, run from the project root in PowerShell (as Administrator):

```powershell
.\scripts\Setup-LiveTrading.ps1           # Live trading setup
.\scripts\Setup-LiveTrading.ps1 -Paper     # Paper trading setup
.\scripts\Setup-LiveTrading.ps1 -CheckOnly # Validate prerequisites only
```

This script automates Sections 2–11 below (prerequisite checks, dependency installation, build, .env configuration, pipeline validation, and T+1 scheduling). It reports any remaining manual steps at the end. See the [manual guide below](#1-prerequisites) for details on each step.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install System Dependencies](#2-install-system-dependencies)
3. [Clone and Build the Project](#3-clone-and-build-the-project)
4. [Install and Configure Npcap](#4-install-and-configure-npcap)
5. [Set Up the Python Sniffer](#5-set-up-the-python-sniffer)
6. [Build the C++ Ghost-Mode Kernel](#6-build-the-c-ghost-mode-kernel)
7. [Configure Environment Variables](#7-configure-environment-variables)
8. [Set Up Webull Desktop](#8-set-up-webull-desktop)
9. [Validate with Paper Trading](#9-validate-with-paper-trading)
10. [Go Live](#10-go-live)
11. [Schedule T+1 Settlement](#11-schedule-t1-settlement)
12. [Production with PM2](#12-production-with-pm2)
13. [Tuning Signal Parameters](#13-tuning-signal-parameters)
14. [Architecture Reference](#14-architecture-reference)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Prerequisites

| Component | Version | Download | Purpose |
|-----------|---------|----------|---------|
| Windows | 10/11 (64-bit) | — | OS with Win32 API for Ghost-Mode |
| Node.js | ≥ 18 | https://nodejs.org | Engine runtime, C++ addon host |
| Python | 3.8+ | https://python.org | Sniffer (Scapy packet capture) |
| Npcap | 1.79+ | https://npcap.com | Packet capture driver for Scapy |
| Webull Desktop | Latest | https://webull.com/desktop | Ghost-Mode target (HWND) |
| Visual Studio Build Tools | 2019+ | https://visualstudio.microsoft.com/visual-cpp-build-tools/ | C++ compilation for node-gyp |
| Git | Latest | https://git-scm.com | Clone repo, state persistence |

### Visual Studio Build Tools — required workload

When installing VS Build Tools, select the **"Desktop development with C++"** workload. This provides:
- MSVC compiler
- Windows SDK
- C++ CMake tools

Alternatively, install via npm (run as Administrator):
```powershell
npm install -g windows-build-tools
```

---

## 2. Install System Dependencies

Open **PowerShell as Administrator** and verify each tool:

```powershell
node --version      # Should print v18.x or higher
npm --version       # Should print 8.x or higher
python --version    # Should print 3.8+
git --version       # Should print 2.x+
```

If Python is installed but `python` isn't recognized, try `python3` or ensure it's on your PATH (check "Add Python to PATH" during install).

---

## 3. Clone and Build the Project

```powershell
git clone https://github.com/<your-org>/trading-terminal-app.git
cd trading-terminal-app

# Install Node.js dependencies
npm install

# Build TypeScript → JavaScript
npm run build

# Verify: dist/ directory should contain compiled .js files
dir dist\engine\
```

You should see `orchestrator.js`, `monitor.js`, `core.js`, `parser.js`, `signal.js`, `execution.js`, and others.

Alternatively, run the project initializer which does all of the above plus the C++ build:
```powershell
.\scripts\Initialize-Project.ps1
```

---

## 4. Install and Configure Npcap

Npcap is the packet capture driver that Scapy uses on Windows (replaces the deprecated WinPcap).

### Install

1. Download from https://npcap.com/dist/npcap-1.79.exe
2. Run the installer
3. **Critical:** Check **"Install Npcap in WinPcap API-compatible Mode"** — Scapy requires this
4. Complete the installation

### Verify

Run the provided verification script:
```powershell
.\scripts\Configure-Npcap.ps1
```

This checks:
- Npcap is installed at `C:\Program Files\Npcap`
- Lists your active network adapters (you may want to note the adapter name for `config.json`)

### Optional: Pin sniffer to a specific network interface

Edit `src/sniffer/config.json` and set the `"interface"` field to your adapter name:
```json
{
  "interface": "Ethernet"
}
```

Leave it `null` to sniff on all interfaces (default).

---

## 5. Set Up the Python Sniffer

```powershell
cd src\sniffer
pip install -r requirements.txt
```

This installs:
- `scapy==2.5.0` — packet capture and dissection
- `psutil==5.9.5` — process utilities

### Validate sniffer config (dry run — no capture)

```powershell
python capture.py --dry-run
```

Expected output:
```
Webull IPs isolated: 1.2.3.4, 5.6.7.8, ...
BPF filter: (tcp port 443 or tcp port 8883) and (host 1.2.3.4 or ...)
Dry-run: config validated. Run without --dry-run to capture (requires root/Npcap).
```

If DNS resolution fails (e.g. no internet), you'll see a fallback filter message — this is fine for validation but needs connectivity for live use.

### How the sniffer works

The sniffer (`capture.py`):
1. Resolves Webull hostnames from `config.json` → IP addresses via DNS
2. Builds a BPF (Berkeley Packet Filter) to isolate only Webull traffic on ports 443 and 8883
3. Uses `scapy.sniff()` to capture raw TCP payloads matching the filter
4. Forwards each payload as **hex-encoded bytes** over TCP to `127.0.0.1:31337` (where the Node.js engine listens on Windows)

The sniffer captures **your own Webull Desktop app's network traffic** — it intercepts the MQTT+Protobuf market data stream that Webull sends to its desktop client, giving the engine access to quotes before the UI finishes rendering them.

---

## 6. Build the C++ Ghost-Mode Kernel

The kernel is a native Node.js addon (N-API) that sends Win32 messages to the Webull Desktop window.

```powershell
cd <project-root>
npm run rebuild
```

This runs `node-gyp rebuild --directory src/kernel`, which:
1. Compiles `src/kernel/execution.cpp` using MSVC
2. Produces `src/kernel/build/Release/webull_ghost.node`

### What the kernel does

On Windows, the compiled addon exposes a single function `executeClick(x, y)` that:
1. Finds the Webull Desktop window by title (`FindWindowA("Webull Desktop")` or `"Webull"`)
2. Sends `WM_LBUTTONDOWN` followed by `WM_LBUTTONUP` at coordinates `(x, y)` via `SendMessage`
3. Returns `true` if the window was found and messages were sent

This is "Ghost-Mode" — it clicks inside the Webull window without moving the visible mouse cursor, targeting < 5ms execution latency.

### If the build fails

| Error | Solution |
|-------|----------|
| `MSBUILD : error MSB3428` | Install VS Build Tools with "Desktop development with C++" workload |
| `gyp ERR! find VS` | Set: `npm config set msvs_version 2019` (or 2022) |
| `Cannot find module 'node-addon-api'` | Run `npm install` first |

---

## 7. Configure Environment Variables

Copy the example env file:
```powershell
copy .env.example .env
```

Edit `.env` for live trading:

```env
# CRITICAL: Set both to 0 for live trading
MOCK_EXECUTION=0
PAPER_TRADING=0

# Persistence: auto-commit db.json after each trade
SKIP_GIT_PERSIST=0
GIT_PERSIST_PUSH=0       # Set to 1 to auto-push to remote

# Optional: webhook URL for alerts (MAX_DRAWDOWN, DAILY_CAP, EXECUTION_FAILED)
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Debug: verbose logging (set to 1 while validating, 0 in production)
DEBUG=1

# Monitor dashboard port
MONITOR_PORT=31338
```

### Environment variable reference

| Variable | Values | Effect |
|----------|--------|--------|
| `PAPER_TRADING` | `0` / `1` | `1` = skip Ghost-Mode execution, just record trades |
| `MOCK_EXECUTION` | `0` / `1` | `1` = `executeClick()` always returns `true` (no actual click) |
| `SKIP_GIT_PERSIST` | `0` / `1` | `1` = don't auto-commit `db.json` after trades |
| `GIT_PERSIST_PUSH` | `0` / `1` | `1` = auto-push after each commit |
| `ALERT_WEBHOOK_URL` | URL | POST alerts to this webhook (JSON body) |
| `DEBUG` | `0` / `1` | `1` = verbose console output for parsed quotes, latency |
| `MONITOR_PORT` | number | Dashboard HTTP server port (default: 31338) |
| `CAPTURE_RAW` | `0` / `1` | `1` = save unparseable payloads to `data/raw-capture/` |

---

## 8. Set Up Webull Desktop

### Install and log in

1. Download Webull Desktop from https://webull.com/desktop
2. Install and launch
3. Log in to your brokerage account
4. Verify the window title bar reads **"Webull Desktop"** or **"Webull"** — the kernel searches for these exact strings

### Position the order entry screen

Ghost-Mode sends click events at specific `(x, y)` pixel coordinates within the Webull Desktop window. You need to determine the correct coordinates for your screen resolution and Webull layout:

1. Open the options trading view in Webull Desktop
2. Navigate to the SPY or QQQ 0DTE options chain
3. Identify the Buy/Sell button positions
4. Note the pixel coordinates relative to the **Webull window's top-left corner** (not the screen)

To find coordinates, you can use Windows' built-in tools:
- **Spy++** (included with VS Build Tools) — hover over the Webull window to see client-area coordinates
- **PowerShell:** Use `[System.Windows.Forms.Cursor]::Position` while hovering over the target button, then subtract the window's top-left position

> **Note:** The current codebase calls `executeClick(0, 0)` by default (see `src/engine/execution.ts` line 33). You will need to modify the signal-to-execution mapping in `process-payload.ts` or `orchestrator.ts` to pass the correct `(x, y)` coordinates for your Webull layout. This is the most layout-sensitive part of the setup.

### Keep Webull Desktop running

- Webull Desktop **must remain open and in the foreground** (or at least not minimized) during trading hours
- The window title must match `"Webull Desktop"` or `"Webull"` exactly
- If Webull updates and changes its window title, update the `WINDOW_TITLES` array in `src/kernel/execution.cpp` and rebuild

---

## 9. Validate with Paper Trading

Before going live, validate the entire pipeline in paper mode:

### Step 1: Start the engine in paper mode

```powershell
$env:PAPER_TRADING = "1"
$env:DEBUG = "1"
npm start
```

You should see:
```
Engine initialized. Settled funds: 300.00
Socket bridge active. Awaiting sniffer data.
```

### Step 2: Start the sniffer (separate Administrator terminal)

```powershell
cd <project-root>\src\sniffer
python capture.py
```

### Step 3: Open Webull Desktop and browse options

As you browse SPY/QQQ options in Webull, the sniffer captures packets and forwards them to the engine. Watch the engine terminal for:
```
[Orchestrator] Received payload (xxx bytes)
[Orchestrator] Signal: SELL 2 SPY
[Orchestrator] Trade recorded: 2 SELL SPY
```

### Step 4: Verify via dashboard

In a third terminal:
```powershell
npm run dashboard
```

Open http://127.0.0.1:31338/ and verify:
- Status is "OK"
- Trades Today counter increments as signals fire
- Audit Trail shows YES/NO entries
- Equity curve updates

### Step 5: Run automated tests

```powershell
npm run build
npm run test
```

Both `e2e` and `simulate` tests should pass.

---

## 10. Go Live

Once paper trading validates the pipeline end-to-end:

### Checklist before going live

- [ ] `.env` has `PAPER_TRADING=0` and `MOCK_EXECUTION=0`
- [ ] `npm run rebuild` succeeded (kernel addon built)
- [ ] Webull Desktop is open, logged in, on the options chain view
- [ ] Ghost-Mode click coordinates are correct for your layout
- [ ] `data/db.json` has correct `starting_capital` and `settled_funds`
- [ ] `config.json` signal parameters are tuned (see [Section 13](#13-tuning-signal-parameters))
- [ ] Sniffer dry-run resolves Webull IPs successfully
- [ ] Alert webhook is configured (recommended for safety)

### Startup sequence

The order matters — the engine must be listening before the sniffer connects.

**Terminal 1 — Engine (normal user):**
```powershell
cd <project-root>
npm start
```

The startup validator checks:
- `data/db.json` exists and has valid schema
- Kernel addon loads successfully (required when `PAPER_TRADING=0` and `MOCK_EXECUTION=0`)

**Terminal 2 — Sniffer (run as Administrator):**
```powershell
cd <project-root>\src\sniffer
python capture.py
```

Administrator privileges are required because raw socket capture needs elevated permissions on Windows.

**Webull Desktop** must already be open and logged in.

### What happens during a live trade

```
Webull servers ──MQTT/TLS──▶ Webull Desktop
                    │
         (packet sniffed by Npcap)
                    │
                    ▼
        capture.py (Scapy) ──hex over TCP──▶ Engine (orchestrator.ts)
                                                │
                                    ┌───────────┼───────────┐
                                    ▼           ▼           ▼
                              parsePayload  generateSignal  performAudit
                                                            │
                                                    YES ────┼──── NO → logged, skipped
                                                            ▼
                                                executeClick(x, y)
                                                    │
                                        SendMessage(WM_LBUTTONDOWN)
                                        SendMessage(WM_LBUTTONUP)
                                                    │
                                                    ▼
                                        Webull Desktop processes click
                                        (order submitted to exchange)
```

### Risk safeguards enforced at runtime

| Safeguard | Limit | What happens |
|-----------|-------|-------------|
| Daily trade cap | 10 trades/day | Audit returns NO; alert fired |
| Max contracts | 100 per order | Audit returns NO |
| Max drawdown | 55.86% from peak | Audit returns NO; alert fired |
| Friction | $0.07/contract (spread + slippage) | Deducted from `settled_funds` |
| Execution failure | 3 retries, 50ms delay | Alert fired; trade not recorded |

---

## 11. Schedule T+1 Settlement

Cash accounts require T+1 settlement. Two scheduled tasks handle this automatically.

### Windows Task Scheduler (recommended)

Run as Administrator:
```powershell
.\scripts\Schedule-Settlement.ps1
```

This creates:

| Task | Time (ET) | Action |
|------|-----------|--------|
| `HFT-Cash-V6-Settle-T1` | 4:00 PM (Mon–Fri) | Moves `pending_t1_funds` → `settled_funds` |
| `HFT-Cash-V6-Reset-Daily` | 9:30 AM (Mon–Fri) | Resets `trades_executed_today` to 0 |

### Manual execution

```powershell
npm run settle-t1      # EOD settlement
npm run reset-daily    # Morning reset
```

---

## 12. Production with PM2

For auto-restart and log rotation, use PM2:

```powershell
npm install -g pm2
npm run pm2:start
```

This starts both `hft-cash-v6` (orchestrator) and `hft-cash-v6-monitor` (dashboard) as managed processes. Logs go to `logs/`.

```powershell
pm2 status              # Check process status
pm2 logs hft-cash-v6    # Tail engine logs
pm2 stop all            # Stop everything
```

> **Note:** The PM2 monitor config sets `PAPER_TRADING=1` by default in `ecosystem.config.cjs`. For live trading, either edit the config or override the env var when starting.

---

## 13. Tuning Signal Parameters

Edit `config.json` in the project root:

```json
{
  "signal": {
    "maxSpreadCents": 5,
    "minMidCents": 10,
    "minVolume": 0,
    "maxContracts": 100,
    "positionSizePct": 0.02
  },
  "latency": {
    "targetDataMs": 10,
    "targetExecMs": 5
  },
  "execution": {
    "retries": 3,
    "retryDelayMs": 50
  }
}
```

| Parameter | Default | Effect |
|-----------|---------|--------|
| `maxSpreadCents` | 5 | Reject quotes with bid-ask spread > 5 cents |
| `minMidCents` | 10 | Reject quotes with mid-price < 10 cents |
| `minVolume` | 0 | Minimum volume filter (0 = disabled) |
| `maxContracts` | 100 | Hard cap on contracts per order |
| `positionSizePct` | 0.02 | Position size as fraction of mid × 100 |
| `targetDataMs` | 10 | Latency warning threshold for data path |
| `targetExecMs` | 5 | Latency warning threshold for execution path |
| `retries` | 3 | Ghost-Mode click retry attempts |
| `retryDelayMs` | 50 | Delay between retries (busy-wait) |

Changes to `config.json` are picked up on next engine restart (no hot reload).

---

## 14. Architecture Reference

### File map

```
trading-terminal-app/
├── src/
│   ├── engine/
│   │   ├── orchestrator.ts    ← Entry point: wires sniffer → pipeline
│   │   ├── monitor.ts         ← Dashboard server (engine in-process)
│   │   ├── core.ts            ← Sovereign Engine: risk audit, state, db
│   │   ├── parser.ts          ← Raw payload → OptionsQuote[]
│   │   ├── signal.ts          ← OptionsQuote → TradeSignal (0DTE filter)
│   │   ├── execution.ts       ← Ghost-Mode click via C++ addon
│   │   ├── socket-bridge.ts   ← Unix socket / TCP server for sniffer
│   │   ├── process-payload.ts ← In-process pipeline (monitor mode)
│   │   ├── settlement.ts      ← T+1 settle / daily reset
│   │   ├── config-loader.ts   ← Reads config.json
│   │   ├── signal-config.ts   ← Signal parameter loader
│   │   ├── latency.ts         ← Pipeline stage timing
│   │   ├── alerts.ts          ← Webhook notifications
│   │   ├── git-persist.ts     ← Auto-commit db.json
│   │   ├── inject-payload.ts  ← Test payload builder
│   │   ├── fetch-real-options.ts ← Yahoo Finance data for tests
│   │   ├── startup.ts         ← Pre-flight validation
│   │   ├── simulate.ts        ← 10-trade cap validation
│   │   ├── e2e-test.ts        ← End-to-end pipeline test
│   │   ├── backtest.ts        ← Historical backtest
│   │   └── logger.ts          ← Timestamped logging
│   ├── kernel/
│   │   ├── execution.cpp      ← Win32 SendMessage addon
│   │   └── binding.gyp        ← node-gyp build config
│   └── sniffer/
│       ├── capture.py         ← Scapy packet sniffer
│       ├── config.json        ← Webull hosts, ports, interface
│       └── requirements.txt   ← Python dependencies
├── data/
│   ├── db.json                ← Account state, trades, audit trail
│   └── historical-equity.json ← Generated equity curve
├── config.json                ← Signal, latency, execution params
├── dashboard.html             ← Web dashboard UI
├── ecosystem.config.cjs       ← PM2 process config
├── .env.example               ← Environment variable template
└── scripts/
    ├── Initialize-Project.ps1 ← Full project setup (Windows)
    ├── Initialize-Project.sh  ← Full project setup (Linux/macOS)
    ├── Configure-Npcap.ps1    ← Verify Npcap installation
    ├── Schedule-Settlement.ps1← Create Task Scheduler jobs
    ├── start-dashboard.js     ← Start dashboard + open browser
    └── stop-dashboard.js      ← Stop running dashboard
```

### Ports and sockets

| Endpoint | Protocol | Used by |
|----------|----------|---------|
| `/tmp/hft-cash-v6-sniffer.sock` | Unix socket | Sniffer → Engine (Linux) |
| `127.0.0.1:31337` | TCP | Sniffer → Engine (Windows) |
| `0.0.0.0:31338` | HTTP | Dashboard UI and API |

---

## 15. Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| `executeClick` returns `false` | Webull Desktop not open or wrong title | Ensure window title is exactly "Webull Desktop" or "Webull" |
| `kernel addon not built` on startup | Addon `.node` file missing | Run `npm run rebuild` with VS Build Tools installed |
| `kernel addon load failed` | Architecture mismatch (32/64-bit) | Ensure Node.js and VS Tools match (both x64) |
| Scapy `PermissionError` | Sniffer not running as Administrator | Right-click PowerShell → "Run as Administrator" |
| Sniffer `No module named 'scapy'` | Python deps not installed | `pip install -r src/sniffer/requirements.txt` |
| `Could not resolve Webull hosts` | DNS failure | Check internet connectivity; sniffer will use fallback filter |
| `EADDRINUSE` on port 31338 | Dashboard already running | `npm run dashboard:stop` then retry |
| `ECONNREFUSED` from sniffer | Engine not running | Start engine (`npm start`) before sniffer |
| Trades not recording | Signal filters too strict | Enable `DEBUG=1`, check spread/mid values against `config.json` thresholds |
| `node-gyp` build fails | Missing compiler | Install VS Build Tools C++ workload or run `npm install -g windows-build-tools` |
| Latency warnings in logs | Pipeline > 10ms data or > 5ms exec | Check CPU load; close unnecessary apps; consider disabling Windows Defender real-time scanning for the project folder |
| `db.json: invalid schema` | Corrupted state file | Reset: `git checkout -- data/db.json` |
