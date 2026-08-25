# @topcal/cli

Agent-native CLI for [topcal](https://topcal.ai) — device auth, calendars, booking, billing, enrichment, and MCP probe.

Thin client over **app.topcal.ai** REST only. Product logic stays in [topcal-app](https://github.com/bcharleson/topcal-app). Remote MCP for ChatGPT / Claude / Grok connectors lives in [topcal-mcp](https://github.com/bcharleson/topcal-mcp).

## Install

```bash
npm install -g @topcal/cli
topcal --help
```

Without a global install (scoped packages need `-p`):

```bash
npx --yes -p @topcal/cli topcal --help
```

Or paste into your agent:

```text
Set up topcal from https://topcal.ai/skill/SKILL.md
```

## Quick start

```bash
topcal auth register --wait auto
topcal auth status
topcal calendars connect --provider google
topcal calendars status
```

Credentials: `~/.topcal/config.json` (mode `0600`). Override with `TOPCAL_API_URL`, `TOPCAL_API_KEY`, `TOPCAL_AGENT_INTENT`.

## Commands

| Command | Purpose |
|---------|---------|
| `topcal auth register` | Browser approve → save API key |
| `topcal auth wait` | Finish a `--wait no` register |
| `topcal auth status` | Connection + workspace |
| `topcal auth login` / `logout` | Manual API key (CI) |
| `topcal calendars connect` | Google / Microsoft OAuth |
| `topcal calendars status` | List active calendar seats |
| `topcal event-types` | List bookable event types |
| `topcal slots <eventTypeId>` | Propose slots (needs intent JWT) |
| `topcal book <eventTypeId>` | Create a booking |
| `topcal get-booking <id>` | Booking detail + form answers |
| `topcal identity register` | Start OTP for a human |
| `topcal identity verify` | Consume OTP → intent JWT |
| `topcal identity revoke` | Revoke a principal |
| `topcal user signup` | Provision the verified human |
| `topcal availability blocks` | List time-off blocks |
| `topcal availability block` / `unblock` | Add / remove time off |
| `topcal billing checkout` | Start Stripe Checkout |
| `topcal billing intent <id>` | Poll a checkout intent |
| `topcal enrichment checkout` | Start enrichment credit checkout |
| `topcal enrichment booking <id>` | Fetch booking enrichment |
| `topcal openapi` | Print the OpenAPI spec URL |
| `topcal mcp probe` | Initialize + `tools/list` (API-key MCP) |

Every command accepts `--json` for agents/CI.

`topcal mcp probe` talks to the **in-app** MCP (`/api/mcp/mcp`) until the standalone host is the default. Override with `--url`.

## Links

- Dashboard: [app.topcal.ai](https://app.topcal.ai)
- API reference: [app.topcal.ai/docs](https://app.topcal.ai/docs)
- Skill: [topcal.ai/skill/SKILL.md](https://topcal.ai/skill/SKILL.md)
- MCP (connectors): [github.com/bcharleson/topcal-mcp](https://github.com/bcharleson/topcal-mcp)
- Source: [github.com/bcharleson/topcal-cli](https://github.com/bcharleson/topcal-cli)
