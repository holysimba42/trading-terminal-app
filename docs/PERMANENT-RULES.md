# Permanent Rules

**MANDATORY: Run the Pre-Completion Checklist before finalizing any task.**

---

## Pre-Completion Checklist (run every time before finishing)

- [ ] **Dashboard verified**: `npm run dashboard:stop` → `npm run dashboard` → `curl http://127.0.0.1:31338/health` returns OK → content check passes. If giving a URL to the user, include: `cd <project-path>` first.
- [ ] **Reasoning stated**: Goal and approach explained before edits.
- [ ] **Tests before commit**: `npm run build` and `npm run test` pass before committing.
- [ ] **Conventional commit**: Used `feat:`, `fix:`, `refactor:`, `docs:`, or `chore:` prefix.
- [ ] **One logical change**: No unrelated edits in the same commit.
- [ ] **Errors researched**: If an error occurred, searched the web before applying a fix.

---

## 1. Always verify the dashboard before finishing

Before marking any task complete:
- Run `npm run dashboard:stop` then `npm run dashboard` (or start the monitor).
- Confirm the dashboard loads at `http://127.0.0.1:31338/`.
- Verify any new or modified UI elements are visible and functional.
- If changes affect the API, confirm `/api/status` returns correct data.
- Do not finalize until verification passes.

---

## 2. Prefer small, incremental commits (with remedies)

### Commit strategy
- One logical change per commit (feature, fix, or refactor—not one line).
- Use **conventional commits**: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.
- Commit after each working step; avoid one giant commit at the end.
- Avoid mixing unrelated edits (e.g., feature + formatting + unrelated fixes).

### Remedies for cons

| Con | Remedy |
|-----|--------|
| **Noisy history** | Squash before merge; keep feature branches; use conventional prefixes |
| **More overhead** | Use "What / Why" template; aim for one logical change; batch related tweaks |
| **Incomplete states** | Commit only when tests pass; use feature flags; WIP: + squash; keep main deployable |
| **Merge noise** | Rebase before merge; short-lived branches; clear ownership |
| **Over-fragmentation** | Minimum meaningful size; "Would I revert this alone?" test; squash on merge |
| **Rebase complexity** | Squash merge in UI; limit rebases; automate when possible |

---

## 3. Explain your reasoning before making changes

Before editing code:
- State the goal and approach.
- Note assumptions or tradeoffs.
- For non-obvious changes, explain why this approach was chosen.
- Keep explanations concise but sufficient.

---

## 4. Internet-based error discovery/analysis/correction

When encountering errors or unclear behavior:
- Search for the exact error message, library, and version.
- Use results to identify causes and recommended fixes.
- Prefer official docs, GitHub issues, and Stack Overflow.
- Apply fixes that align with the project's stack and constraints.
- Note what was found and why the fix was applied when non-trivial.
