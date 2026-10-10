import type { Command } from "commander";

import { configPath, loadConfig, saveConfig } from "../config.js";
import { ApiClient } from "../http.js";
import { createOutput } from "../output.js";
import { clean } from "./public-booking.js";

/**
 * Headless signup — no browser on the agent's side.
 *
 *   topcal signup start  --email <inbox> [--human-email <person>]
 *   topcal signup verify --code <6 digits>
 *   topcal signup poll   [--wait]
 *
 * A person signing up with their own email gets a key at `verify`.
 * An AI agent signing up with its own inbox (e.g. mail.grokbot.com) must name
 * its human with `--human-email`: that person gets a link, reviews the
 * request and approves; they own the workspace. `poll` then returns the
 * agent's free seat key. Run `start` + `verify` again later (no
 * `--human-email`) to sign back in: the seat stays, the key is rotated.
 */

interface SignedIn {
  apiKey: string;
  apiUrl: string;
  workspace: { id: string; name: string; slug: string };
  user: { email: string; name: string | null };
  isNewAccount: boolean;
}

interface PendingClaim {
  status: "pending_claim";
  pollToken?: string;
  claimSentTo: string;
  expiresIn: number;
  instructions?: string;
}

export type VerifyOutcome =
  | { kind: "signed_in"; result: SignedIn }
  | { kind: "pending_claim"; result: PendingClaim };

/** Tell a finished sign-in from "waiting for the human to approve". */
export function interpretVerify(body: unknown): VerifyOutcome {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.status === "pending_claim") {
    return { kind: "pending_claim", result: b as unknown as PendingClaim };
  }
  if (typeof b.apiKey === "string" && b.apiKey) {
    return { kind: "signed_in", result: b as unknown as SignedIn };
  }
  throw new Error("Unexpected sign-in response from topcal.");
}

function storeSignedIn(result: SignedIn): void {
  saveConfig({
    apiKey: result.apiKey,
    apiUrl: result.apiUrl,
    workspaceId: result.workspace.id,
    workspaceName: result.workspace.name,
    workspaceSlug: result.workspace.slug,
    pendingChallengeId: "",
    pendingClaimPollToken: "",
  });
}

/** First characters only — enough to recognise a key, useless to steal. */
function keyPreview(key: string): string {
  return `${key.slice(0, 16)}…`;
}

/**
 * What we print after a sign-in. The key is saved to the config file and is
 * NOT echoed: stdout ends up in agent transcripts and shell logs. Pass
 * `--show-key` to print it deliberately.
 */
export function printableSignIn(
  result: SignedIn,
  showKey: boolean,
): Record<string, unknown> {
  return {
    ...result,
    apiKey: showKey ? result.apiKey : keyPreview(result.apiKey),
    apiKeyRedacted: !showKey,
    saved: true,
    savedTo: configPath(),
  };
}

/** Same for a pending approval: the poll token redeems the seat key. */
export function printablePending(
  result: PendingClaim,
  showKey: boolean,
): Record<string, unknown> {
  const { pollToken, ...rest } = result;
  return {
    ...rest,
    ...(pollToken
      ? showKey
        ? { pollToken }
        : { pollTokenSaved: true, savedTo: configPath() }
      : {}),
  };
}

function client(): ApiClient {
  // Signup is unauthenticated: only the API origin matters.
  return new ApiClient({ apiUrl: loadConfig().apiUrl });
}

interface StartOpts {
  email: string;
  humanEmail?: string;
  agentName?: string;
  json?: boolean;
}
interface VerifyOpts {
  code: string;
  challenge?: string;
  agentName?: string;
  showKey?: boolean;
  json?: boolean;
}
interface PollOpts {
  pollToken?: string;
  wait?: boolean;
  timeout?: string;
  showKey?: boolean;
  json?: boolean;
}

export function registerSignupCommands(program: Command): void {
  const signup = program
    .command("signup")
    .description(
      "Headless signup with an emailed code — no browser. Agents with their own inbox name their human with --human-email.",
    );

  signup
    .command("start")
    .description("Step 1: email a 6-digit code to --email.")
    .requiredOption("--email <email>", "Inbox that receives the code (yours, or the agent's own inbox)")
    .option(
      "--human-email <email>",
      "Agents only: the person you work for. They get a link to review and approve; they own the workspace.",
    )
    .option("--agent-name <name>", "How you appear to the human and in the audit log (e.g. \"WALL-E\")")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: StartOpts) => {
      const out = createOutput({ json: !!opts.json });
      const result = await client().request<{ challengeId: string; expiresIn: number; resendAfter: number }>({
        method: "POST",
        path: "/native/auth/email/start",
        skipAuth: true,
        body: {
          email: opts.email,
          ...(opts.humanEmail ? { prospectEmail: opts.humanEmail } : {}),
          ...(opts.agentName ? { agentName: opts.agentName } : {}),
        },
      });
      saveConfig({ pendingChallengeId: result.challengeId });
      out.json(result);
      if (!opts.json) {
        out.ok(`Code sent to ${clean(opts.email)}. It expires in ${Math.round(result.expiresIn / 60)} minutes.`);
        out.note("Next: topcal signup verify --code <6 digits>");
      }
    });

  signup
    .command("verify")
    .description("Step 2: confirm the code. Returns a key, or waits for the human's approval.")
    .requiredOption("--code <code>", "The 6-digit code from the inbox")
    .option("--challenge <id>", "challengeId from `signup start` (defaults to the last one)")
    .option("--agent-name <name>", "How you appear to the human and in the audit log")
    .option("--show-key", "Print the full API key / poll token (they are saved to the config file either way)")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: VerifyOpts) => {
      const out = createOutput({ json: !!opts.json });
      const challengeId = opts.challenge ?? loadConfig().pendingChallengeId;
      if (!challengeId) {
        out.error("No signup in progress. Run: topcal signup start --email <inbox>");
        process.exit(1);
      }
      const body = await client().request<unknown>({
        method: "POST",
        path: "/native/auth/email/verify",
        skipAuth: true,
        body: {
          challengeId,
          code: opts.code,
          ...(opts.agentName ? { agentName: opts.agentName } : {}),
        },
      });
      const outcome = interpretVerify(body);
      if (outcome.kind === "signed_in") {
        storeSignedIn(outcome.result);
        out.json(printableSignIn(outcome.result, !!opts.showKey));
        if (!opts.json) {
          out.ok(`Signed in to ${clean(outcome.result.workspace.name)}. Key saved (${keyPreview(outcome.result.apiKey)}).`);
          out.note("Next: topcal calendars connect");
        }
        return;
      }
      saveConfig({
        pendingChallengeId: "",
        pendingClaimPollToken: outcome.result.pollToken ?? "",
      });
      out.json(printablePending(outcome.result, !!opts.showKey));
      if (!opts.json) {
        out.ok(`Waiting for ${clean(outcome.result.claimSentTo)} to approve.`);
        out.note("They got an email with a link: open it, review, press Approve.");
        out.note("Next: topcal signup poll --wait");
      }
    });

  signup
    .command("poll")
    .description("Step 3 (agents): check whether your human approved; saves your seat key when they have.")
    .option("--poll-token <token>", "pollToken from `signup verify` (defaults to the saved one)")
    .option("--wait", "Keep checking until approved or --timeout")
    .option("--timeout <seconds>", "Max seconds to wait with --wait", "600")
    .option("--show-key", "Print the full API key (it is saved to the config file either way)")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: PollOpts) => {
      const out = createOutput({ json: !!opts.json });
      const pollToken = opts.pollToken ?? loadConfig().pendingClaimPollToken;
      if (!pollToken) {
        out.error("No approval pending. Run: topcal signup start --email <inbox> --human-email <person>");
        process.exit(1);
      }
      const deadline = Date.now() + (Number.parseInt(opts.timeout ?? "600", 10) || 600) * 1000;
      for (;;) {
        const body = await client().request<unknown>({
          method: "POST",
          path: "/native/auth/claim/poll",
          skipAuth: true,
          body: { pollToken },
        });
        const outcome = interpretVerify(body);
        if (outcome.kind === "signed_in") {
          storeSignedIn(outcome.result);
          out.json({ ...printableSignIn(outcome.result, !!opts.showKey), status: "claimed" });
          if (!opts.json) {
            out.ok(`Approved. You have a seat in ${clean(outcome.result.workspace.name)}. Key saved (${keyPreview(outcome.result.apiKey)}).`);
            out.note("Next: topcal calendars connect   (prints a link to send your human)");
          }
          return;
        }
        if (!opts.wait || Date.now() >= deadline) {
          out.json(printablePending(outcome.result, !!opts.showKey));
          if (!opts.json) out.note(`Still waiting for ${clean(outcome.result.claimSentTo)} to approve.`);
          if (opts.wait) process.exit(2);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    });
}
