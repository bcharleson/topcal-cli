import type { Command } from "commander";

import { loadConfig } from "../config.js";
import { ApiClient } from "../http.js";
import { openUrl } from "../open-url.js";
import { createOutput } from "../output.js";

interface CheckoutOptions {
  plan?: CheckoutPlan;
  tier?: LegacyCheckoutTier;
  interval?: BillingInterval;
  quantity?: number;
  email?: string;
  successUrl?: string;
  cancelUrl?: string;
  json?: boolean;
}

type CheckoutPlan = "solo";
type BillingInterval = "monthly" | "annual";
type LegacyCheckoutTier = "starter" | "team" | "scale";

interface CheckoutRequestBody {
  plan: CheckoutPlan;
  interval: BillingInterval;
  quantity?: number;
  customerEmail?: string;
  successUrl?: string;
  cancelUrl?: string;
}

function requireOwnerClient(): ApiClient {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    const out = createOutput({ json: false });
    out.error("Not connected. Run: npx -p @topcal/cli topcal setup --json");
    process.exit(1);
  }
  return new ApiClient({
    apiUrl: cfg.apiUrl,
    apiKey: cfg.apiKey,
    ...(cfg.intentToken ? { intentToken: cfg.intentToken } : {}),
  });
}

async function executeWorkspaceTool<T>(
  client: ApiClient,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ ok: true; name: string; result: T }> {
  return client.request({
    method: "POST",
    path: "/workspace/tools/execute",
    body: { name, arguments: args },
  });
}

type BillingSnapshot = {
  plan: string;
  planState: string;
  trialDaysRemaining: number | null;
  seats: number;
  monthlyCostCents: number;
  hasStripeCustomer: boolean;
};

function isPaid(state: string): boolean {
  return state === "active";
}

export async function runOwnerCheckout(opts: {
  interval?: BillingInterval;
  json?: boolean;
  /** When nested under `setup`, skip a second JSON blob on stdout. */
  skipStdoutJson?: boolean;
}): Promise<{ url: string }> {
  const out = createOutput({ json: !!opts.json });
  const interval = opts.interval ?? "monthly";
  const executed = await executeWorkspaceTool<{ url: string; note?: string }>(
    requireOwnerClient(),
    "start_checkout",
    { interval },
  );
  const url = executed.result.url;
  out.ok("Stripe Checkout started for this workspace.");
  out.note(`Human step: open Stripe and pay: ${url}`);
  out.note("Then run: topcal billing wait --json");
  openUrl(url);
  if (!opts.skipStdoutJson) {
    out.json({
      ok: true,
      url,
      interval,
      human: "Open this Stripe URL to pay. Then: topcal billing wait --json",
      next: ["topcal billing wait --json", "topcal billing status --json"],
    });
  }
  return { url };
}

export function registerBillingCommands(program: Command): void {
  const billing = program
    .command("billing")
    .description(
      "Help the host buy: mint Stripe Checkout, poll until paid, open the portal.",
    );

  billing
    .command("status")
    .description("Show plan, trial remaining, and seat count for this workspace.")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const out = createOutput({ json: !!opts.json });
      const executed = await executeWorkspaceTool<BillingSnapshot>(
        requireOwnerClient(),
        "get_billing",
      );
      const b = executed.result;
      out.json(b);
      if (!opts.json) {
        out.ok(
          `${b.plan} / ${b.planState}` +
            (b.trialDaysRemaining != null
              ? ` · ${b.trialDaysRemaining} trial day(s) left`
              : ""),
        );
        out.note(
          `${b.seats} seat(s) · $${(b.monthlyCostCents / 100).toFixed(2)}/mo`,
        );
      }
    });

  billing
    .command("checkout")
    .description(
      "Start Stripe Checkout for this workspace. Human pays on Stripe; you poll billing status.",
    )
    .option("--plan <plan>", "Plan to subscribe to: solo (Starter)", parseCheckoutPlan)
    .option(
      "--tier <tier>",
      "Deprecated alias for Starter: starter | team | scale",
      parseLegacyCheckoutTier,
    )
    .option(
      "--interval <interval>",
      "Billing interval: monthly | annual",
      parseBillingInterval,
      "monthly",
    )
    .option(
      "--quantity <quantity>",
      "Known active calendar seats; server enforces the workspace minimum",
      parseQuantity,
    )
    .option("--email <email>", "Override customer email (defaults to principal's)")
    .option("--success-url <url>", "Stripe success_url override")
    .option("--cancel-url <url>", "Stripe cancel_url override")
    .option("--guest", "Use delegated agent checkout (requires a verified intent JWT)")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: CheckoutOptions & { guest?: boolean }) => {
      const out = createOutput({ json: !!opts.json });
      const client = requireOwnerClient();

      if (opts.guest) {
        const checkout = buildCheckoutRequest(opts);
        if (checkout.legacyTier) {
          out.warn(
            `--tier ${checkout.legacyTier} is deprecated; creating a Starter checkout with plan "solo".`,
          );
        }
        const result = await client.request<{
          intentId: string;
          status: string;
          url: string;
          expiresAt: string;
          plan: string;
          interval: string;
          quantity: number;
        }>({
          method: "POST",
          path: "/agent/billing/checkout-intents",
          body: checkout.body,
          withAgentIntent: true,
        });
        out.ok(`Checkout intent ${result.intentId} created.`);
        out.note(`Human step: open Stripe and pay: ${result.url}`);
        openUrl(result.url);
        out.json({
          ok: true,
          human: "Open this Stripe URL to pay. Then: topcal billing wait --json",
          ...result,
        });
        return;
      }

      await runOwnerCheckout({
        interval: opts.interval ?? "monthly",
        ...(opts.json ? { json: true } : {}),
      });
    });

  billing
    .command("wait")
    .description("Poll until this workspace is paid (planState=active).")
    .option("--timeout <seconds>", "Max seconds to wait", "600")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { timeout?: string; json?: boolean }) => {
      const out = createOutput({ json: !!opts.json });
      const client = requireOwnerClient();
      const timeoutMs =
        (Number.parseInt(opts.timeout ?? "600", 10) || 600) * 1000;
      const deadline = Date.now() + timeoutMs;
      let last: BillingSnapshot | null = null;
      while (Date.now() < deadline) {
        const executed = await executeWorkspaceTool<BillingSnapshot>(
          client,
          "get_billing",
        );
        last = executed.result;
        if (isPaid(last.planState)) {
          out.ok(`Paid: ${last.plan} / ${last.planState}`);
          out.json({ ok: true, paid: true, billing: last });
          return;
        }
        await sleep(4000);
      }
      out.error(
        last
          ? `Still ${last.planState}. Human must finish Stripe. Re-run topcal billing wait.`
          : "Timed out waiting for payment.",
      );
      out.json({ ok: false, paid: false, billing: last });
      process.exit(1);
    });

  billing
    .command("portal")
    .description("Mint a Stripe Customer Portal URL (invoices, card, cancel).")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const out = createOutput({ json: !!opts.json });
      const executed = await executeWorkspaceTool<{ url: string }>(
        requireOwnerClient(),
        "open_billing_portal",
      );
      out.ok("Stripe Customer Portal");
      out.note(executed.result.url);
      openUrl(executed.result.url);
      out.json({ ok: true, url: executed.result.url });
    });

  billing
    .command("intent <intentId>")
    .description("Poll a guest/delegated checkout intent (requires --guest flow).")
    .option("--json", "Output machine-readable JSON")
    .action(async (intentId: string, opts: { json?: boolean }) => {
      const out = createOutput({ json: !!opts.json });
      const cfg = loadConfig();
      const client = new ApiClient({
        apiUrl: cfg.apiUrl,
        ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
        ...(cfg.intentToken ? { intentToken: cfg.intentToken } : {}),
      });
      const result = await client.request<{
        intentId: string;
        status: string;
        completedAt: string | null;
        expiresAt: string;
      }>({
        path: `/agent/billing/checkout-intents/${encodeURIComponent(intentId)}`,
        withAgentIntent: true,
      });
      out.ok(`Intent ${result.intentId} → ${result.status}`);
      out.json(result);
    });

  program
    .command("buy")
    .description(
      "Start Stripe Checkout for this workspace (alias of billing checkout).",
    )
    .option(
      "--interval <interval>",
      "Billing interval: monthly | annual",
      parseBillingInterval,
      "monthly",
    )
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { interval?: BillingInterval; json?: boolean }) => {
      await runOwnerCheckout({
        interval: opts.interval ?? "monthly",
        ...(opts.json ? { json: true } : {}),
      });
    });
}

export function buildCheckoutRequest(opts: CheckoutOptions): {
  body: CheckoutRequestBody;
  legacyTier?: LegacyCheckoutTier;
} {
  if (opts.plan && opts.tier) {
    throw new Error("Use either --plan or deprecated --tier, not both.");
  }

  return {
    body: {
      plan: "solo",
      interval: opts.interval ?? "monthly",
      ...(opts.quantity !== undefined ? { quantity: opts.quantity } : {}),
      ...(opts.email ? { customerEmail: opts.email } : {}),
      ...(opts.successUrl ? { successUrl: opts.successUrl } : {}),
      ...(opts.cancelUrl ? { cancelUrl: opts.cancelUrl } : {}),
    },
    ...(opts.tier ? { legacyTier: opts.tier } : {}),
  };
}

function parseCheckoutPlan(raw: string): CheckoutPlan {
  if (raw !== "solo") {
    throw new Error(`Unknown plan "${raw}" (must be solo)`);
  }
  return raw;
}

function parseBillingInterval(raw: string): BillingInterval {
  if (raw !== "monthly" && raw !== "annual") {
    throw new Error(`Unknown interval "${raw}" (must be monthly | annual)`);
  }
  return raw;
}

function parseQuantity(raw: string): number {
  const quantity = Number(raw);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(`Unknown quantity "${raw}" (must be a positive integer)`);
  }
  return quantity;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLegacyCheckoutTier(raw: string): LegacyCheckoutTier {
  if (raw !== "starter" && raw !== "team" && raw !== "scale") {
    throw new Error(`Unknown tier "${raw}" (must be starter | team | scale)`);
  }
  return raw;
}
