import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { Command } from "commander";

import { clearConfig, configPath, loadConfig, saveConfig } from "../config.js";
import { ApiClient, TopcalApiError } from "../http.js";
import { openUrl } from "../open-url.js";
import { createOutput } from "../output.js";

interface LoginOptions {
  url?: string;
  apiKey?: string;
  json?: boolean;
}

interface RegisterOptions {
  url?: string;
  wait?: string;
  timeout?: string;
  agentName?: string;
  clientName?: string;
  json?: boolean;
}

interface WaitOptions {
  url?: string;
  deviceCode?: string;
  timeout?: string;
  json?: boolean;
}

type PollResponse = {
  status:
    | "authorization_pending"
    | "approved"
    | "expired"
    | "denied"
    | "slow_down";
  apiKey?: string;
  apiUrl?: string;
  workspace?: { id: string; name: string; slug: string };
  user?: { id: string; email: string };
};

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command("auth")
    .description("CLI device auth (browser approve) and credential status.");

  auth
    .command("register")
    .description("Register this device and open the approval page in your browser.")
    .option("--url <url>", "Topcal API base URL")
    .option("--wait <mode>", "Wait mode: auto, yes, or no", "auto")
    .option("--timeout <seconds>", "Max seconds to wait when --wait is auto/yes", "300")
    .option("--agent-name <name>", "Agent name to label the API key")
    .option("--client-name <name>", "Client name (e.g. cursor)")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: RegisterOptions & { timeout?: string }) => {
      await runRegister(opts);
    });

  auth
    .command("wait")
    .description("Wait for a pending browser approval and save the API key.")
    .option("--url <url>", "Topcal API base URL")
    .option("--device-code <code>", "Device code from auth register --wait no")
    .option("--timeout <seconds>", "Maximum seconds to wait", "300")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: WaitOptions) => {
      await runWait(opts);
    });

  auth
    .command("status")
    .description("Show the current CLI auth and workspace status.")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      await runStatus(opts);
    });

  // Manual paste fallback (CI / existing keys)
  program
    .command("login")
    .description("Store API URL + workspace API key and verify connectivity.")
    .option("--url <url>", "Topcal API base URL")
    .option("--api-key <key>", "Workspace API key (topcal_(live|test)_...; older tofu_ keys still work)")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: LoginOptions) => {
      await runLogin(opts);
    });

  program
    .command("logout")
    .description("Clear the stored API key and intent token (keeps API URL).")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      const out = createOutput({ json: !!opts.json });
      clearConfig();
      out.ok(`Cleared credentials at ${configPath()}`);
      out.json({ ok: true });
    });

  program
    .command("status")
    .description("Show the active CLI configuration and API liveness.")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { json?: boolean }) => {
      await runStatus(opts);
    });
}

export async function runRegister(opts: RegisterOptions): Promise<void> {
  const out = createOutput({ json: !!opts.json });
  const current = loadConfig();
  const apiUrl = (opts.url?.trim() || current.apiUrl).replace(/\/$/, "");
  const waitMode = normalizeWait(opts.wait);
  const client = new ApiClient({ apiUrl, apiKey: "" });

  const registered = await client.request<{
    deviceCode: string;
    userCode: string;
    verificationUrl: string;
    expiresIn: number;
    interval: number;
  }>({
    method: "POST",
    path: "/cli/auth/register",
    body: {
      ...(opts.agentName ? { agentName: opts.agentName } : {}),
      ...(opts.clientName ? { clientName: opts.clientName } : { clientName: "cli" }),
    },
    skipAuth: true,
  });

  saveConfig({
    apiUrl,
    pendingDeviceCode: registered.deviceCode,
    pendingUserCode: registered.userCode,
  });

  out.ok(`User code: ${registered.userCode}`);
  out.note(`Open: ${registered.verificationUrl}`);
  out.note(
    "Human steps: sign up or sign in, confirm email if asked, pick a workspace, Allow CLI access.",
  );
  const opened = openUrl(registered.verificationUrl);
  if (!opened) {
    out.warn("Could not open a browser — paste the URL above manually.");
  }

  if (waitMode === "no") {
    out.json({
      ok: true,
      waiting: false,
      deviceCode: registered.deviceCode,
      userCode: registered.userCode,
      verificationUrl: registered.verificationUrl,
      expiresIn: registered.expiresIn,
      interval: registered.interval,
    });
    out.note("Finish with: topcal auth wait");
    return;
  }

  const timeoutSeconds = Math.min(
    registered.expiresIn,
    Number.parseInt(opts.timeout ?? "300", 10) || 300,
  );
  await pollUntilApproved({
    client,
    deviceCode: registered.deviceCode,
    intervalSeconds: registered.interval,
    timeoutSeconds,
    out,
    json: !!opts.json,
  });
}

async function runWait(opts: WaitOptions): Promise<void> {
  const out = createOutput({ json: !!opts.json });
  const current = loadConfig();
  const apiUrl = (opts.url?.trim() || current.apiUrl).replace(/\/$/, "");
  const deviceCode =
    opts.deviceCode?.trim() || current.pendingDeviceCode || "";
  if (!deviceCode) {
    out.error("No device code. Run topcal auth register first.");
    process.exit(1);
  }
  const client = new ApiClient({ apiUrl, apiKey: "" });
  const timeoutSeconds = Number.parseInt(opts.timeout ?? "300", 10) || 300;
  await pollUntilApproved({
    client,
    deviceCode,
    intervalSeconds: 2,
    timeoutSeconds,
    out,
    json: !!opts.json,
  });
}

async function pollUntilApproved(args: {
  client: ApiClient;
  deviceCode: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  out: ReturnType<typeof createOutput>;
  json: boolean;
}): Promise<void> {
  const deadline = Date.now() + args.timeoutSeconds * 1000;
  let intervalMs = Math.max(1, args.intervalSeconds) * 1000;

  while (Date.now() < deadline) {
    let result: PollResponse;
    try {
      result = await args.client.request<PollResponse>({
        path: `/cli/auth/poll?device_code=${encodeURIComponent(args.deviceCode)}`,
        skipAuth: true,
      });
    } catch (err) {
      if (err instanceof TopcalApiError) {
        args.out.warn(`Poll error ${err.status}: ${err.message}`);
      } else {
        args.out.warn(`Poll unreachable: ${(err as Error).message}`);
      }
      await sleep(intervalMs);
      continue;
    }

    if (result.status === "authorization_pending") {
      await sleep(intervalMs);
      continue;
    }
    if (result.status === "slow_down") {
      intervalMs = Math.min(intervalMs * 2, 10_000);
      await sleep(intervalMs);
      continue;
    }
    if (result.status === "denied") {
      args.out.error("CLI access was denied in the browser.");
      process.exit(1);
    }
    if (result.status === "expired") {
      args.out.error("CLI auth code expired. Run topcal auth register again.");
      process.exit(1);
    }
    if (result.status === "approved" && result.apiKey) {
      const apiUrl = (result.apiUrl || loadConfig().apiUrl).replace(/\/$/, "");
      saveConfig({
        apiUrl,
        apiKey: result.apiKey,
        workspaceId: result.workspace?.id,
        workspaceName: result.workspace?.name,
        workspaceSlug: result.workspace?.slug,
        pendingDeviceCode: "",
        pendingUserCode: "",
      });

      args.out.ok("topcal is installed and connected.");
      if (result.workspace) {
        args.out.kv([
          ["workspace", `${result.workspace.name} (${result.workspace.slug})`],
          ["user", result.user?.email ?? "(unknown)"],
          ["config", configPath()],
        ]);
      }
      args.out.json({
        ok: true,
        connected: true,
        workspace: result.workspace ?? null,
        user: result.user ?? null,
        apiKey: redact(result.apiKey),
      });
      return;
    }
    await sleep(intervalMs);
  }

  args.out.error("Timed out waiting for browser approval.");
  process.exit(1);
}

async function runStatus(opts: { json?: boolean }): Promise<void> {
  const out = createOutput({ json: !!opts.json });
  const cfg = loadConfig();
  const client = new ApiClient({
    apiUrl: cfg.apiUrl,
    ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
    ...(cfg.intentToken ? { intentToken: cfg.intentToken } : {}),
  });

  let healthy = false;
  let serverInfo: Record<string, unknown> | null = null;
  try {
    serverInfo = await client.request<Record<string, unknown>>({
      path: "/health",
      skipAuth: true,
    });
    healthy = true;
  } catch (err) {
    if (err instanceof TopcalApiError) {
      out.warn(`/health returned ${err.status}: ${err.message}`);
    } else {
      out.warn(`/health unreachable: ${(err as Error).message}`);
    }
  }

  const connected = Boolean(cfg.apiKey);
  out.json({
    host: cfg.apiUrl,
    status: connected ? "claimed" : "disconnected",
    connected,
    configPath: configPath(),
    apiKey: redact(cfg.apiKey),
    workspace: cfg.workspaceSlug
      ? {
          id: cfg.workspaceId ?? null,
          name: cfg.workspaceName ?? null,
          slug: cfg.workspaceSlug,
        }
      : null,
    healthy,
    server: serverInfo,
  });
  if (!opts.json) {
    out.kv([
      ["host", cfg.apiUrl],
      ["status", connected ? "claimed" : "disconnected"],
      ["workspace", cfg.workspaceSlug ?? "(none)"],
      ["api key", redact(cfg.apiKey) ?? "(not set)"],
      ["healthy", String(healthy)],
      ["config", configPath()],
    ]);
  }
}

async function runLogin(opts: LoginOptions): Promise<void> {
  const out = createOutput({ json: !!opts.json });
  const current = loadConfig();

  const url =
    opts.url?.trim() ||
    (await prompt(`Topcal API URL [${current.apiUrl}]: `, current.apiUrl));
  const apiKey =
    opts.apiKey?.trim() ||
    (await prompt(
      `Workspace API key${current.apiKey ? " (leave blank to keep)" : ""}: `,
      current.apiKey ?? "",
    ));

  const client = new ApiClient({
    apiUrl: url,
    apiKey: apiKey || current.apiKey || "",
  });

  try {
    const health = await client.request<{ name: string; status: string }>({
      path: "/health",
      skipAuth: true,
    });
    out.note(`Connected to ${health.name} (${health.status})`);
  } catch (err) {
    out.error(
      `Cannot reach ${url}/api/v1/health: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  saveConfig({
    apiUrl: url,
    ...(apiKey ? { apiKey } : current.apiKey ? {} : {}),
  });
  out.ok("Credentials saved.");
  out.json({ ok: true, apiUrl: url, apiKey: redact(apiKey || current.apiKey) });
}

function normalizeWait(raw: string | undefined): "auto" | "yes" | "no" {
  const v = (raw ?? "auto").trim().toLowerCase();
  if (v === "no" || v === "false" || v === "0") return "no";
  if (v === "yes" || v === "true" || v === "1") return "yes";
  return "auto";
}

async function prompt(question: string, fallback: string): Promise<string> {
  const rl = createInterface({ input, output, terminal: true });
  try {
    const answer = await rl.question(question);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

function redact(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
