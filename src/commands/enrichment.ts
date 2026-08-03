import type { Command } from "commander";

import { loadConfig } from "../config.js";
import { ApiClient } from "../http.js";
import { createOutput } from "../output.js";

const CATALOG_IDS = [
  "enrichment_starter",
  "enrichment_growth",
  "enrichment_scale",
  "enrichment_pack_50",
  "enrichment_pack_200",
  "enrichment_pack_500",
] as const;

type CatalogId = (typeof CATALOG_IDS)[number];

interface EnrichmentCheckoutOptions {
  catalogId: CatalogId;
  email?: string;
  successUrl?: string;
  cancelUrl?: string;
  json?: boolean;
}

export function registerEnrichmentCommands(program: Command): void {
  const enrichment = program
    .command("enrichment")
    .description("Enrichment credits checkout and booking intelligence (requires verified intent where noted).");

  enrichment
    .command("checkout")
    .description("Start a Stripe Checkout session for enrichment credits.")
    .requiredOption(
      "--catalog-id <id>",
      "Catalog id: enrichment_starter | enrichment_growth | enrichment_scale | enrichment_pack_50 | enrichment_pack_200 | enrichment_pack_500",
      (raw) => {
        if (!CATALOG_IDS.includes(raw as CatalogId)) {
          throw new Error(`Unknown catalog id "${raw}"`);
        }
        return raw as CatalogId;
      },
    )
    .option("--email <email>", "Override customer email (defaults to principal's)")
    .option("--success-url <url>", "Stripe success_url override")
    .option("--cancel-url <url>", "Stripe cancel_url override")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: EnrichmentCheckoutOptions) => {
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
        url: string;
        expiresAt: string;
        catalogId: string;
      }>({
        method: "POST",
        path: "/agent/billing/enrichment-checkout-intents",
        body: {
          catalogId: opts.catalogId,
          ...(opts.email ? { customerEmail: opts.email } : {}),
          ...(opts.successUrl ? { successUrl: opts.successUrl } : {}),
          ...(opts.cancelUrl ? { cancelUrl: opts.cancelUrl } : {}),
        },
        withAgentIntent: true,
      });

      out.ok(`Enrichment checkout intent ${result.intentId} created.`);
      out.note(`Share this URL with the human: ${result.url}`);
      out.note(`Poll: topcal billing intent ${result.intentId}`);
      out.json(result);
    });

  enrichment
    .command("booking <bookingId>")
    .description("Fetch enrichment results for a booking (requires agent.booking.read on the API key).")
    .option("--json", "Output machine-readable JSON")
    .action(async (bookingId: string, opts: { json?: boolean }) => {
      const out = createOutput({ json: !!opts.json });
      const cfg = loadConfig();
      const client = new ApiClient({
        apiUrl: cfg.apiUrl,
        ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
        ...(cfg.intentToken ? { intentToken: cfg.intentToken } : {}),
      });

      const result = await client.request<Record<string, unknown>>({
        path: `/agent/bookings/${encodeURIComponent(bookingId)}/enrichment`,
        withAgentIntent: true,
      });

      out.ok(`Enrichment for booking ${bookingId}: ${String(result.status)}`);
      out.json(result);
    });
}
