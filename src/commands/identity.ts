import type { Command } from "commander";

import { loadConfig, saveConfig } from "../config.js";
import { ApiClient } from "../http.js";
import { createOutput } from "../output.js";

interface RegisterOptions {
  email: string;
  label: string;
  name?: string;
  company?: string;
  json?: boolean;
}

interface VerifyOptions {
  code: string;
  scope: string[];
  json?: boolean;
}

export function registerIdentityCommands(program: Command): void {
  const identity = program
    .command("identity")
    .description("Manage agent identities (verified humans an agent acts for).");

  identity
    .command("register")
    .description("Declare a verified-human-on-whose-behalf the agent will act. Sends an email OTP.")
    .requiredOption("--email <email>", "Prospect email")
    .requiredOption("--label <label>", "Free-form agent label (model + version)")
    .option("--name <name>", "Prospect name (optional)")
    .option("--company <company>", "Prospect company (optional)")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: RegisterOptions) => {
      const out = createOutput({ json: !!opts.json });
      const cfg = loadConfig();
      const client = makeClient(cfg);

      const result = await client.request<{
        principalId: string;
        status: string;
        verificationExpiresAt: string;
        instructions: string;
      }>({
        method: "POST",
        path: "/agent/identities",
        body: {
          prospectEmail: opts.email,
          agentLabel: opts.label,
          ...(opts.name ? { prospectName: opts.name } : {}),
          ...(opts.company ? { prospectCompany: opts.company } : {}),
        },
      });

      saveConfig({ principalId: result.principalId });
      out.ok(`Pending principal ${result.principalId} created.`);
      out.note(result.instructions);
      out.json(result);
    });

  identity
    .command("verify <principalId>")
    .description("Submit the email OTP and mint a delegated intent token.")
    .requiredOption("--code <code>", "6-digit OTP from the email")
    .option(
      "--scope <scope...>",
      "Scopes to request (default: agent.user.signup agent.billing.checkout)",
      ["agent.user.signup", "agent.billing.checkout"],
    )
    .option("--json", "Output machine-readable JSON")
    .action(async (principalId: string, opts: VerifyOptions) => {
      const out = createOutput({ json: !!opts.json });
      const cfg = loadConfig();
      const client = makeClient(cfg);

      const result = await client.request<{
        principalId: string;
        status: string;
        intentToken: string;
        expiresAt: string;
        scopes: string[];
      }>({
        method: "POST",
        path: `/agent/identities/${encodeURIComponent(principalId)}/verify`,
        body: { code: opts.code, scopes: opts.scope },
      });

      saveConfig({
        intentToken: result.intentToken,
        intentExpiresAt: result.expiresAt,
        principalId: result.principalId,
      });
      out.ok(
        `Principal verified. Intent token stored (expires ${new Date(result.expiresAt).toLocaleString()}).`,
      );
      out.json(result);
    });

  identity
    .command("revoke <principalId>")
    .description("Revoke a verified principal.")
    .option("--json", "Output machine-readable JSON")
    .action(async (principalId: string, opts: { json?: boolean }) => {
      const out = createOutput({ json: !!opts.json });
      const cfg = loadConfig();
      const client = makeClient(cfg);
      const result = await client.request<{
        principalId: string;
        status: string;
        revokedAt: string;
      }>({
        method: "POST",
        path: `/agent/identities/${encodeURIComponent(principalId)}/revoke`,
      });
      out.ok(`Revoked ${result.principalId} at ${result.revokedAt}.`);
      out.json(result);
    });
}

function makeClient(
  cfg: ReturnType<typeof loadConfig>,
): ApiClient {
  return new ApiClient({
    apiUrl: cfg.apiUrl,
    ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
    ...(cfg.intentToken ? { intentToken: cfg.intentToken } : {}),
  });
}
