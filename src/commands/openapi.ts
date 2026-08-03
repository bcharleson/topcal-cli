import { writeFileSync } from "node:fs";

import type { Command } from "commander";

import { loadConfig } from "../config.js";
import { ApiClient } from "../http.js";
import { createOutput } from "../output.js";

export function registerOpenApiCommand(program: Command): void {
  program
    .command("openapi")
    .description("Fetch and (optionally) save the live OpenAPI 3.1 spec.")
    .option("--out <path>", "Write to disk instead of stdout")
    .option("--json", "Output machine-readable JSON (default for stdout)")
    .action(
      async (opts: { out?: string; json?: boolean }) => {
        const out = createOutput({ json: opts.out ? false : true });
        const cfg = loadConfig();
        const client = new ApiClient({
          apiUrl: cfg.apiUrl,
          ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
        });

        const spec = await client.request<Record<string, unknown>>({
          path: "/openapi",
          skipAuth: true,
        });

        if (opts.out) {
          writeFileSync(opts.out, JSON.stringify(spec, null, 2) + "\n", "utf8");
          out.ok(`Spec written to ${opts.out}`);
          return;
        }
        out.json(spec);
      },
    );
}
