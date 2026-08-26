import type { Command } from "commander";

import { loadConfig } from "../config.js";
import { ApiClient } from "../http.js";
import { createOutput } from "../output.js";

import { runRegister } from "./auth.js";
import { runOwnerCheckout } from "./billing.js";
import { runCalendarsConnect } from "./calendars.js";

/**
 * Agent entrypoint: install → human signup/login/email confirm → API key →
 * calendar OAuth. The CLI never impersonates the human in Google/Microsoft.
 */
export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description(
      "End-to-end agent install: device auth (human signs up / confirms email) then calendar connect.",
    )
    .option("--url <url>", "Topcal API base URL")
    .option("--wait <mode>", "Wait for browser approval: auto, yes, or no", "auto")
    .option("--timeout <seconds>", "Max seconds to wait per step", "300")
    .option(
      "--calendar <provider>",
      "google | microsoft | skip (default google)",
      "google",
    )
    .option("--agent-name <name>", "Label for the API key")
    .option("--client-name <name>", "Client name (e.g. cursor, claude)")
    .option(
      "--checkout",
      "After calendar connect, mint Stripe Checkout so the human can subscribe",
    )
    .option("--json", "Output machine-readable JSON")
    .action(
      async (opts: {
        url?: string;
        wait?: string;
        timeout?: string;
        calendar?: string;
        agentName?: string;
        clientName?: string;
        checkout?: boolean;
        json?: boolean;
      }) => {
        const out = createOutput({ json: !!opts.json });
        const calendar = (opts.calendar ?? "google").toLowerCase();
        if (
          calendar !== "google" &&
          calendar !== "microsoft" &&
          calendar !== "skip"
        ) {
          out.error("--calendar must be google, microsoft, or skip");
          process.exit(1);
        }

        out.note(
          "Install (any agent): npx --yes -p @topcal/cli topcal setup --json",
        );
        out.note(
          "A human must: (1) sign up or sign in, (2) confirm email if asked, (3) Allow CLI access, (4) connect a calendar.",
        );

        const already = loadConfig();
        if (!already.apiKey) {
          await runRegister({
            ...(opts.url ? { url: opts.url } : {}),
            ...(opts.wait ? { wait: opts.wait } : {}),
            ...(opts.timeout ? { timeout: opts.timeout } : {}),
            ...(opts.agentName ? { agentName: opts.agentName } : {}),
            clientName: opts.clientName ?? "agent",
            ...(opts.json ? { json: true } : {}),
          });
        } else {
          out.ok(
            `Already connected to ${already.workspaceSlug ?? already.apiUrl}`,
          );
        }

        const cfg = loadConfig();
        if (!cfg.apiKey) {
          out.error("Setup did not finish — no API key stored.");
          process.exit(1);
        }

        const client = new ApiClient({ apiUrl: cfg.apiUrl, apiKey: cfg.apiKey });
        const listed = await client.request<{
          calendars: Array<{
            id: string;
            provider: string;
            email: string;
            seatStatus: string;
          }>;
        }>({
          path: "/cli/calendars",
        });
        const active = listed.calendars.filter((c) => c.seatStatus === "active");

        if (calendar !== "skip" && active.length === 0) {
          await runCalendarsConnect({
            provider: calendar,
            wait: opts.wait !== "no",
            ...(opts.timeout ? { timeout: opts.timeout } : {}),
            ...(opts.json ? { json: true } : {}),
          });
        } else if (active.length > 0) {
          out.ok(
            `Calendar already connected: ${active.map((c) => `${c.provider}:${c.email}`).join(", ")}`,
          );
        }

        const after = loadConfig();
        const calendars = await client.request<{
          calendars: Array<{
            id: string;
            email: string;
            provider: string;
            seatStatus: string;
          }>;
        }>({ path: "/cli/calendars" });

        let checkoutUrl: string | null = null;
        if (opts.checkout) {
          const started = await runOwnerCheckout({
            skipStdoutJson: true,
            ...(opts.json ? { json: true } : {}),
          });
          checkoutUrl = started.url;
        }

        out.json({
          ok: true,
          connected: true,
          workspace: after.workspaceSlug
            ? {
                id: after.workspaceId ?? null,
                name: after.workspaceName ?? null,
                slug: after.workspaceSlug,
              }
            : null,
          calendars: calendars.calendars,
          checkoutUrl,
          human: checkoutUrl
            ? "Open checkoutUrl on Stripe to subscribe, then: topcal billing wait --json"
            : null,
          next: checkoutUrl
            ? ["topcal billing wait --json", "topcal billing status --json"]
            : [
                "topcal tools list --json",
                "topcal billing checkout --json",
                "topcal billing wait --json",
              ],
        });
        if (!opts.json) {
          out.ok("topcal is ready for this agent.");
          out.note(
            checkoutUrl
              ? "Human: pay on Stripe, then topcal billing wait --json"
              : "Next: topcal tools list --json  ·  to subscribe: topcal buy --json",
          );
        }
      },
    );
}
