import { Command } from "commander";

import { registerAuthCommands } from "./commands/auth.js";
import { registerAvailabilityCommands } from "./commands/availability.js";
import { registerBillingCommands } from "./commands/billing.js";
import { registerCalendarCommands } from "./commands/calendars.js";
import { registerEnrichmentCommands } from "./commands/enrichment.js";
import { registerBookingCommands } from "./commands/booking.js";
import { registerIdentityCommands } from "./commands/identity.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerOpenApiCommand } from "./commands/openapi.js";
import { registerPublicBookingCommands } from "./commands/public-booking.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerSignupCommands } from "./commands/signup.js";
import { registerToolsCommands } from "./commands/tools.js";
import { registerUserCommands } from "./commands/user.js";
import { TopcalApiError } from "./http.js";
import { createOutput } from "./output.js";
import { packageVersion } from "./version.js";

/**
 * `topcal` — the agent-native CLI.
 *
 * Two output modes:
 *   - default: human-readable, colored, side commentary on stderr
 *   - --json: pure JSON on stdout (suitable for `jq`, agent loops, CI)
 *
 * Authentication lives in `~/.topcal/config.json` (mode 0600). All
 * commands also honor the env vars `TOPCAL_API_URL`, `TOPCAL_API_KEY`,
 * `TOPCAL_AGENT_INTENT` so the CLI plays nicely with sandboxes,
 * GitHub Actions, and ephemeral agents.
 *
 * Every command mirrors a REST + MCP operation. There is intentionally
 * no shortcut that bypasses the API — running the CLI on the dev box
 * exercises the same code path a remote agent would hit.
 */
const program = new Command();

program
  .name("topcal")
  .description(
    "Agent-native CLI for topcal — same workspace catalog as MCP. Start with: topcal setup",
  )
  .version(packageVersion());

registerSetupCommand(program);
registerAuthCommands(program);
registerSignupCommands(program);
registerCalendarCommands(program);
registerToolsCommands(program);
registerOpenApiCommand(program);
registerIdentityCommands(program);
registerUserCommands(program);
registerBookingCommands(program);
registerPublicBookingCommands(program);
registerAvailabilityCommands(program);
registerBillingCommands(program);
registerEnrichmentCommands(program);
registerMcpCommand(program);

main();

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    handleError(err);
    process.exit(1);
  }
}

function handleError(err: unknown): void {
  // We respect --json from argv directly because at this point
  // commander's internal state may not have surfaced the option yet.
  const json = process.argv.includes("--json");
  const out = createOutput({ json });

  if (err instanceof TopcalApiError) {
    out.error(`[${err.code}] ${err.message}`);
    out.json({
      ok: false,
      error: { code: err.code, message: err.message, status: err.status, details: err.details },
    });
    return;
  }
  if (err instanceof Error) {
    out.error(err.message);
    out.json({ ok: false, error: { code: "cli.unknown", message: err.message } });
    return;
  }
  out.error(String(err));
  out.json({ ok: false, error: { code: "cli.unknown", message: String(err) } });
}
