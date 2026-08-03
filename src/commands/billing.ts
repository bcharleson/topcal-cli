import type { Command } from "commander";

import { loadConfig } from "../config.js";
import { ApiClient } from "../http.js";
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

export function registerBillingCommands(program: Command): void {
  const billing = program
    .command("billing")
    .description("Agent-initiated Stripe Checkout flows (requires a verified intent).");

  billing
    .command("checkout")
    .description("Start a Starter Stripe Checkout session for the verified principal.")
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
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: CheckoutOptions) => {
      const out = createOutput({ json: !!opts.json });
      const cfg = loadConfig();
      const client = new ApiClient({
        apiUrl: cfg.apiUrl,
        ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
        ...(cfg.intentToken ? { intentToken: cfg.intentToken } : {}),
      });

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
      out.note(`Share this URL with the human: ${result.url}`);
      out.json(result);
    });

  billing
    .command("intent <intentId>")
    .description("Poll the status of a checkout intent.")
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

function parseLegacyCheckoutTier(raw: string): LegacyCheckoutTier {
  if (raw !== "starter" && raw !== "team" && raw !== "scale") {
    throw new Error(`Unknown tier "${raw}" (must be starter | team | scale)`);
  }
  return raw;
}
