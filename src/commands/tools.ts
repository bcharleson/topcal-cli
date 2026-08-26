import type { Command } from "commander";

import { loadConfig } from "../config.js";
import { ApiClient } from "../http.js";
import { createOutput } from "../output.js";

type WorkspaceTool = {
  name: string;
  description: string;
  inputSchema?: unknown;
};

function clientOrDie() {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    const out = createOutput({ json: false });
    out.error("Not connected. Agents: npx -p @topcal/cli topcal setup --json");
    process.exit(1);
  }
  return new ApiClient({
    apiUrl: cfg.apiUrl,
    apiKey: cfg.apiKey,
    ...(cfg.intentToken ? { intentToken: cfg.intentToken } : {}),
  });
}

export function parseArgsJson(raw: string | undefined): Record<string, unknown> {
  if (!raw || raw.trim() === "") return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function registerToolsCommands(program: Command): void {
  const tools = program
    .command("tools")
    .description(
      "Same workspace catalog as MCP / Cal Agent (calendars, event types, meetings, members, billing).",
    );

  tools
    .command("list")
    .description("List every workspace tool this API key can run.")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const out = createOutput({ json: !!opts.json });
      const client = clientOrDie();
      const catalog = await client.request<{
        tools: WorkspaceTool[];
        role: string;
        workspace: { id: string; name: string; slug: string };
      }>({
        path: "/workspace/tools",
      });
      out.json(catalog);
      if (!opts.json) {
        out.ok(
          `${catalog.tools.length} tools in ${catalog.workspace.name} (${catalog.role})`,
        );
        for (const t of catalog.tools) {
          out.note(`${t.name}  ${t.description}`);
        }
      }
    });

  tools
    .command("call <name> [argsJson]")
    .description("Run a workspace tool. Pass arguments as a JSON object.")
    .option("--args <json>", "JSON object of arguments (overrides the positional)")
    .option("--json", "Output machine-readable JSON")
    .action(
      async (
        name: string,
        argsJson: string | undefined,
        opts: { args?: string; json?: boolean },
      ) => {
        const out = createOutput({ json: !!opts.json });
        const client = clientOrDie();
        const args = parseArgsJson(opts.args ?? argsJson);
        const executed = await client.request<{
          ok: true;
          name: string;
          result: unknown;
        }>({
          method: "POST",
          path: "/workspace/tools/execute",
          body: { name, arguments: args },
        });
        out.json(executed);
        if (!opts.json) {
          out.ok(`Ran ${executed.name}`);
          out.note(JSON.stringify(executed.result, null, 2));
        }
      },
    );
}
