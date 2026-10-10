# @topcal/cli

Agent-native CLI for [topcal](https://topcal.ai) — same workspace catalog as the hosted MCP. Thin client over **app.topcal.ai** REST only.

Any AI agent can install it, walk a human through signup + email confirm + calendar OAuth, then run every dashboard action as tools.

## Install (any agent)

```bash
npx --yes -p @topcal/cli topcal setup --json
```

That opens a browser. The human: **sign up or sign in → confirm email if asked → Allow CLI access → connect Google/Microsoft**. The CLI waits and stores a workspace API key in `~/.topcal/config.json`.

Or paste:

```text
Set up topcal from https://topcal.ai/skill/SKILL.md
Then run: npx --yes -p @topcal/cli topcal setup --json
```

## Quick start (already have an account)

```bash
topcal auth register --wait auto
topcal calendars connect --provider google
topcal tools list --json
topcal tools call get_workspace --json
```

Credentials: `~/.topcal/config.json` (mode `0600`). Override with `TOPCAL_API_URL`, `TOPCAL_API_KEY`, `TOPCAL_AGENT_INTENT`.

## Headless signup (no browser)

A person, with their own email:

```bash
topcal signup start --email you@company.com
topcal signup verify --code 123456        # saves your API key
topcal calendars connect                  # opens Google / Microsoft consent
```

An AI agent with its own inbox (for example `mail.grokbot.com`) names the
person it works for. That person gets an email, reviews the request and
approves; they own the workspace and the agent gets a free seat:

```bash
topcal signup start --email bot@mail.grokbot.com --human-email you@company.com --agent-name "WALL-E"
topcal signup verify --code 123456        # code from the agent's inbox
topcal signup poll --wait                 # saves the seat key once approved
topcal calendars connect                  # prints a link to send the human
topcal calendars status                   # shows the human's calendars
```

Only the human can approve calendar access. Billing is per connected
calendar; agent seats are free. To sign in again later, run `signup start`
and `verify` with the agent's inbox alone: the seat stays, the key rotates.

## Commands

| Command | Purpose |
|---------|---------|
| `topcal setup` | Agent install: signup/login + calendar connect |
| `topcal tools list` | Full workspace catalog (same as MCP / Cal Agent) |
| `topcal tools call <name>` | Run any catalog tool (`--args '{...}'`) |
| `topcal buy` / `billing checkout` | Mint Stripe Checkout URL for this workspace |
| `topcal billing wait` | Poll until planState is `active` |
| `topcal billing status` | Plan, trial days, seats |
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

`topcal mcp probe` defaults to the in-app MCP (`/api/mcp/mcp`). For the hosted connector: `topcal mcp probe --url https://mcp.topcal.ai/mcp`.

`topcal tools *` is the full product surface (calendars, event types, meetings, availability, members, teams, billing). Named commands (`event-types`, `book`, `identity`, …) stay as shortcuts.

## Links

- Dashboard: [app.topcal.ai](https://app.topcal.ai)
- API reference: [app.topcal.ai/docs](https://app.topcal.ai/docs)
- Skill: [topcal.ai/skill/SKILL.md](https://topcal.ai/skill/SKILL.md)
- MCP (connectors): [github.com/bcharleson/topcal-mcp](https://github.com/bcharleson/topcal-mcp)
- Source: [github.com/bcharleson/topcal-cli](https://github.com/bcharleson/topcal-cli)
