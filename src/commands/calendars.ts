import type { Command } from "commander";

import { loadConfig } from "../config.js";
import { ApiClient } from "../http.js";
import { openUrl } from "../open-url.js";
import { createOutput } from "../output.js";

type CalendarRow = {
  id: string;
  provider: string;
  email: string;
  seatStatus: string;
  organizationId: string | null;
  createdAt: string;
};

export function registerCalendarCommands(program: Command): void {
  const calendars = program
    .command("calendars")
    .description("Connect and inspect calendar accounts for the CLI owner.");

  calendars
    .command("connect")
    .description("Open browser OAuth to connect Google or Microsoft calendar.")
    .option("--provider <provider>", "google | microsoft", "google")
    .option("--wait", "Poll until a connection appears", true)
    .option("--no-wait", "Print the install URL and exit")
    .option("--timeout <seconds>", "Max seconds to wait", "300")
    .option("--json", "Output machine-readable JSON")
    .action(
      async (opts: {
        provider?: string;
        wait?: boolean;
        timeout?: string;
        json?: boolean;
      }) => {
        const out = createOutput({ json: !!opts.json });
        const cfg = loadConfig();
        if (!cfg.apiKey) {
          out.error("Not connected. Run: topcal auth register");
          process.exit(1);
        }
        const provider = (opts.provider ?? "google").toLowerCase();
        if (provider !== "google" && provider !== "microsoft") {
          out.error("--provider must be google or microsoft");
          process.exit(1);
        }

        const client = new ApiClient({
          apiUrl: cfg.apiUrl,
          apiKey: cfg.apiKey,
        });

        const before = await client.request<{ calendars: CalendarRow[] }>({
          path: "/cli/calendars",
        });
        const beforeIds = new Set(before.calendars.map((c) => c.id));

        const minted = await client.request<{
          installUrl: string;
          expiresAt: string;
          targetUser: { id: string; email: string };
          instructions: string;
        }>({
          method: "POST",
          path: "/cli/calendars/connect",
          body: { provider },
        });

        out.ok(`Connect ${provider} as ${minted.targetUser.email}`);
        out.note(minted.installUrl);
        openUrl(minted.installUrl);

        if (opts.wait === false) {
          out.json(minted);
          return;
        }

        const timeoutMs =
          (Number.parseInt(opts.timeout ?? "300", 10) || 300) * 1000;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          await sleep(2000);
          const listed = await client.request<{ calendars: CalendarRow[] }>({
            path: "/cli/calendars",
          });
          const next = listed.calendars.find(
            (c) =>
              !beforeIds.has(c.id) &&
              c.provider === provider &&
              c.seatStatus === "active",
          );
          const anyActive = listed.calendars.find(
            (c) => c.provider === provider && c.seatStatus === "active",
          );
          const found = next ?? (beforeIds.size === 0 ? anyActive : undefined);
          if (found) {
            out.ok(
              `Calendar connected: ${found.email} (${found.provider}, ${found.seatStatus})`,
            );
            out.json({ ok: true, calendar: found, calendars: listed.calendars });
            return;
          }
        }
        out.error("Timed out waiting for calendar connect. Re-run topcal calendars status.");
        process.exit(1);
      },
    );

  calendars
    .command("status")
    .description("List connected calendars for this CLI key.")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const out = createOutput({ json: !!opts.json });
      const cfg = loadConfig();
      if (!cfg.apiKey) {
        out.error("Not connected. Run: topcal auth register");
        process.exit(1);
      }
      const client = new ApiClient({
        apiUrl: cfg.apiUrl,
        apiKey: cfg.apiKey,
      });
      const listed = await client.request<{ calendars: CalendarRow[] }>({
        path: "/cli/calendars",
      });
      out.json(listed);
      if (!opts.json) {
        if (listed.calendars.length === 0) {
          out.note("No calendars connected. Run: topcal calendars connect");
          return;
        }
        for (const c of listed.calendars) {
          out.kv([
            ["id", c.id],
            ["provider", c.provider],
            ["email", c.email],
            ["seat", c.seatStatus],
          ]);
        }
      }
    });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
