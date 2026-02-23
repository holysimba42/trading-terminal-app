# HFT Cash v6 - Security & Compliance

## Terms of Service & Regulatory

- **Packet sniffing** may violate Webull's Terms of Service. Use at your own risk.
- **Ghost-Mode (UI automation)** may violate broker automation policies. Verify with your broker.
- **0DTE options** carry significant risk. Past performance (e.g. 55.86% max drawdown) does not guarantee future results.
- This software is for educational/research purposes. Not financial advice.

## Secrets Handling

- **Never** commit API keys, tokens, or passwords to git.
- Use environment variables for sensitive config:
  - `SKIP_GIT_PERSIST` – disable git persistence
  - `GIT_PERSIST_PUSH` – enable remote push (requires auth)
  - `MOCK_EXECUTION` – test mode (no real clicks)
  - `DEBUG` – verbose logging
- `data/db.json` contains account state; add to `.gitignore` if storing locally only.
- `.env` files are gitignored; use for local secrets.

## Recommendations

1. Run sniffer only on isolated network segments.
2. Use a dedicated trading account with limited capital.
3. Monitor audit_trail for compliance review.
4. Keep Npcap/Scapy usage within legal bounds (own traffic only).
