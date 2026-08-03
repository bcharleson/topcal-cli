import type { Command } from "commander";

import { loadConfig } from "../config.js";
import { ApiClient } from "../http.js";
import { createOutput } from "../output.js";

interface SignupOptions {
  name?: string;
  timezone?: string;
  json?: boolean;
}

export function registerUserCommands(program: Command): void {
  program
    .command("user")
    .description("Agent-driven user actions (requires a verified intent).")
    .command("signup")
    .description("Provision a topcal account for the verified principal.")
    .option("--name <name>", "Display name override")
    .option("--timezone <tz>", "IANA timezone (e.g. America/Los_Angeles)")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: SignupOptions) => {
      const out = createOutput({ json: !!opts.json });
      const cfg = loadConfig();
      const client = new ApiClient({
        apiUrl: cfg.apiUrl,
        ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
        ...(cfg.intentToken ? { intentToken: cfg.intentToken } : {}),
      });

      const result = await client.request<{
        user: { id: string; email: string; name: string; createdAt: string };
        workspaces: Array<{ id: string; slug: string; name: string; role: string }>;
        created: boolean;
      }>({
        method: "POST",
        path: "/agent/users",
        body: {
          ...(opts.name ? { name: opts.name } : {}),
          ...(opts.timezone ? { timezone: opts.timezone } : {}),
        },
        withAgentIntent: true,
      });

      out.ok(
        result.created
          ? `Created user ${result.user.email} with ${result.workspaces.length} workspace(s).`
          : `User ${result.user.email} already existed; ${result.workspaces.length} workspace(s) attached.`,
      );
      out.json(result);
    });
}
