# AGENTS.md

## Cursor Cloud specific instructions

### Services overview

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| Dashboard (engine in-process) | `npm run dashboard` | 31338 | Primary dev entry point; runs engine + HTTP server + serves UI |
| Health check | `curl http://127.0.0.1:31338/health` | — | Returns `{"status":"ok"}` when dashboard is ready |

### Build & test

Standard commands are in `package.json`:
- **Build**: `npm run build` (runs `tsc`)
- **Test**: `npm run test` (runs `npm run e2e && npm run simulate`)
- **No dedicated lint script** — use `npm run build` (`tsc --strict`) as the lint/type-check step.

### Running the dashboard

1. `npm run build` (if not already built)
2. `npm run dashboard` — builds, stops any existing dashboard process, starts the monitor on port 31338, and opens a browser.
3. Alternatively, run the monitor directly: `PAPER_TRADING=1 node dist/engine/monitor.js`

The `start-dashboard.js` script automatically calls `stop-dashboard.js` first to avoid `EADDRINUSE`. See `docs/DASHBOARD-RULES.md` for the clean-slate protocol.

### Caveats

- The `simulate` test modifies `data/db.json` (trades counter, equity curve). Run `git checkout -- data/db.json` after testing if you need a clean state.
- The C++ kernel addon (`npm run rebuild`) requires `node-gyp` build tools. It provides a stub on Linux (Ghost-Mode is Windows-only). Build failures are non-blocking for development.
- The Python sniffer (`src/sniffer/`) is optional; it captures live Webull packets and is not needed for dashboard or test workflows.
- `PAPER_TRADING=1` is set automatically by the dashboard script; no `.env` file is required for dev.
- See `docs/PERMANENT-RULES.md` for the pre-completion checklist (dashboard verification, conventional commits, etc.).
