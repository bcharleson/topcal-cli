import type { Command } from "commander";

import { loadConfig } from "../config.js";
import { ApiClient } from "../http.js";
import { createOutput } from "../output.js";

interface ListBlocksOptions {
  from?: string;
  to?: string;
  includePast?: boolean;
  json?: boolean;
}

interface AddBlocksOptions {
  from: string;
  to: string;
  start?: string;
  end?: string;
  reason?: string;
  json?: boolean;
}

interface RemoveBlocksOptions {
  from: string;
  to: string;
  start?: string;
  end?: string;
  json?: boolean;
}

interface AvailabilityBlock {
  id: string;
  kind: "full_day" | "partial";
  date: string;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

export function registerAvailabilityCommands(program: Command): void {
  const availability = program
    .command("availability")
    .description("Manage temporary availability blocks (vacation, appointments).");

  availability
    .command("blocks")
    .description("List upcoming time-off blocks for the verified human.")
    .option("--from <date>", "Inclusive YYYY-MM-DD lower bound")
    .option("--to <date>", "Inclusive YYYY-MM-DD upper bound")
    .option("--include-past", "Include past blocks")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: ListBlocksOptions) => {
      const out = createOutput({ json: !!opts.json });
      const client = makeClient();

      const params = new URLSearchParams();
      if (opts.from) params.set("fromDate", opts.from);
      if (opts.to) params.set("toDate", opts.to);
      if (opts.includePast) params.set("includePast", "true");

      const qs = params.toString();
      const result = await client.request<{
        scheduleId: string;
        blocks: AvailabilityBlock[];
        count: number;
      }>({
        path: `/agent/availability/blocks${qs ? `?${qs}` : ""}`,
        withAgentIntent: true,
      });

      out.json(result);
      if (!opts.json) {
        for (const block of result.blocks) {
          const time =
            block.kind === "partial" && block.startTime && block.endTime
              ? ` ${block.startTime.slice(0, 5)}–${block.endTime.slice(0, 5)}`
              : "";
          const label = block.reason ? ` — ${block.reason}` : "";
          out.note(`${block.date}${time}${label}`);
        }
        out.ok(`${result.count} block(s).`);
      }
    });

  availability
    .command("block")
    .description("Block days or hours without changing weekly availability.")
    .requiredOption("--from <date>", "First blocked day (YYYY-MM-DD)")
    .requiredOption("--to <date>", "Last blocked day (YYYY-MM-DD)")
    .option("--start <time>", "Partial block start (HH:mm)")
    .option("--end <time>", "Partial block end (HH:mm)")
    .option("--reason <text>", 'Optional label, e.g. "Vacation"')
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: AddBlocksOptions) => {
      const out = createOutput({ json: !!opts.json });
      const client = makeClient();

      const result = await client.request<{ kind: string }>({
        path: "/agent/availability/blocks",
        method: "POST",
        withAgentIntent: true,
        body: {
          fromDate: opts.from,
          toDate: opts.to,
          ...(opts.start ? { startTime: opts.start } : {}),
          ...(opts.end ? { endTime: opts.end } : {}),
          reason: opts.reason,
        },
      });

      out.json(result);
      if (!opts.json) {
        const partial =
          opts.start && opts.end ? ` (${opts.start}–${opts.end})` : "";
        out.ok(
          `Blocked ${opts.from}${opts.from !== opts.to ? ` through ${opts.to}` : ""}${partial}.`,
        );
      }
    });

  availability
    .command("unblock")
    .description("Remove time-off blocks for a date range.")
    .requiredOption("--from <date>", "First day to unblock (YYYY-MM-DD)")
    .requiredOption("--to <date>", "Last day to unblock (YYYY-MM-DD)")
    .option("--start <time>", "Partial block start (HH:mm) when removing hours only")
    .option("--end <time>", "Partial block end (HH:mm)")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: RemoveBlocksOptions) => {
      const out = createOutput({ json: !!opts.json });
      const client = makeClient();

      const result = await client.request<{ removed: number }>({
        path: "/agent/availability/blocks",
        method: "DELETE",
        withAgentIntent: true,
        body: {
          fromDate: opts.from,
          toDate: opts.to,
          ...(opts.start ? { startTime: opts.start } : {}),
          ...(opts.end ? { endTime: opts.end } : {}),
        },
      });

      out.json(result);
      if (!opts.json) {
        out.ok(`Removed ${result.removed} block(s).`);
      }
    });
}

function makeClient(): ApiClient {
  const cfg = loadConfig();
  return new ApiClient({
    apiUrl: cfg.apiUrl,
    ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
    ...(cfg.intentToken ? { intentToken: cfg.intentToken } : {}),
  });
}
