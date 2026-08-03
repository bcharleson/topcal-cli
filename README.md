# @topcal/cli

Agent-native CLI for [topcal](https://topcal.ai) — browser device auth, calendar connect, booking, and MCP.

## Install

```bash
npm install -g @topcal/cli
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

Credentials are stored in `~/.topcal/config.json` (mode `0600`).

## Commands

| Command | Purpose |
|---------|---------|
| `topcal auth register` | Open browser approve → save API key |
| `topcal auth wait` | Finish a `--wait no` register |
| `topcal auth status` | Connection + workspace |
| `topcal calendars connect` | Google / Microsoft OAuth |
| `topcal calendars status` | List active calendar seats |
| `topcal login` | Manual API key (CI) |
| `topcal mcp probe` | Hit the MCP surface |

Every command accepts `--json` for agent/CI output.

## Links

- Product: [topcal.app](https://topcal.app)
- Skill: [topcal.ai/skill/SKILL.md](https://topcal.ai/skill/SKILL.md)
- Source: [github.com/bcharleson/topcal-cli](https://github.com/bcharleson/topcal-cli)
