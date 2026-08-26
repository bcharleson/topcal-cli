# Changelog

## 0.1.3 — 2026-08-26

- `topcal setup` — agent install: device auth (human signs up / confirms email), then calendar connect. `--checkout` mints Stripe after connect.
- `topcal tools list` / `tools call` — full workspace catalog (same as MCP / Cal Agent).
- `topcal buy` and `billing checkout|status|wait|portal` — owner Stripe conversion. Human pays on Stripe; agent polls until `planState=active`.
- Device-auth copy now tells the human to sign up, confirm email if asked, and Allow CLI access.
