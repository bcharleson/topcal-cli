# Changelog

## 0.1.5 — 2026-10-10

- `topcal signup start | verify | poll` — an AI assistant with its own inbox signs up headlessly. It names the person it works for (`--human-email`), that person approves in the browser, and `signup poll` saves the assistant's agent-seat key. Keys and poll tokens are not printed unless `--show-key` is passed.
- `topcal calendars connect --for <email>` — with an agent-seat key, prints a connect link for a person in the workspace. Only that person can finish Google or Microsoft consent. `--no-open` never launches a browser.

## 0.1.3 — 2026-08-26

- `topcal setup` — agent install: device auth (human signs up / confirms email), then calendar connect. `--checkout` mints Stripe after connect.
- `topcal tools list` / `tools call` — full workspace catalog (same as MCP / Cal Agent).
- `topcal buy` and `billing checkout|status|wait|portal` — owner Stripe conversion. Human pays on Stripe; agent polls until `planState=active`.
- Device-auth copy now tells the human to sign up, confirm email if asked, and Allow CLI access.
