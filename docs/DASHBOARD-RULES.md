# Dashboard Priority Rules

## Rule: Clean Slate Before Every Dashboard Iteration

**Before opening the dashboard or implementing any dashboard update/addition/modification:**

1. **Stop running processes**
   ```bash
   npm run dashboard:stop
   ```
   Or run `npm run dashboard` (it runs stop automatically first).

2. **Close dashboard browser tabs**
   Manually close any open tabs at `http://127.0.0.1:31338/`.

3. **Then** open/start the dashboard.

This ensures:
- Port 31338 is free (avoids EADDRINUSE)
- No stale monitor process blocking the new instance
- Browser loads the latest dashboard code (not cached)
