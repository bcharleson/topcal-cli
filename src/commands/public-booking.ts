import type { Command } from "commander";

import { loadConfig } from "../config.js";
import { ApiClient } from "../http.js";
import { createOutput } from "../output.js";
import { parseFieldOptions } from "./booking.js";

/**
 * The OPEN booker plane from a terminal: book a meeting with ANY topcal
 * customer by their public handle. No login, no API key — the emailed
 * 6-digit code is the only gate. One-to-one mirrors of the public REST
 * operations (`public_request_booking_otp`, `public_confirm_booking`) and
 * the public MCP tools (`request_booking_code`, `confirm_booking`).
 *
 * Built for agents that run scripts (Grok Bot, Claude Code, …). An agent
 * with its own inbox passes `--agent-email`: the code goes to the agent,
 * which reads it and confirms alone, while `--email` stays the human on
 * the calendar invite.
 */

export interface PublicHandle {
  workspace: string;
  username: string;
  eventSlug?: string;
}

/**
 * Accept `workspace/username[/event]` or a full booking URL
 * (`https://topcal.ai/tofu/brandon/intro?x=1`) and pull the handle out.
 */
export function parsePublicHandle(input: string): PublicHandle {
  let path = input.trim();
  if (/^https?:\/\//i.test(path)) {
    path = new URL(path).pathname;
  }
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(
      `Expected workspace/username[/event] or a booking URL, got: ${input}`,
    );
  }
  const [workspace, username, eventSlug] = parts as [string, string, string?];
  return { workspace, username, ...(eventSlug ? { eventSlug } : {}) };
}

function eventPath(handle: PublicHandle): string {
  if (!handle.eventSlug) {
    throw new Error(
      "This command needs an event: workspace/username/event (run `topcal public calendar` to list them).",
    );
  }
  return `/public/${enc(handle.workspace)}/${enc(handle.username)}/${enc(handle.eventSlug)}`;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

interface JsonOpt {
  json?: boolean;
}

interface SlotsOptions extends JsonOpt {
  timezone?: string;
  from?: string;
  to?: string;
  limit?: string;
}

interface RequestCodeOptions extends JsonOpt {
  email: string;
  name?: string;
  agentEmail?: string;
}

interface ConfirmOptions extends JsonOpt {
  start: string;
  email: string;
  timezone: string;
  code: string;
  name?: string;
  agentEmail?: string;
  guest?: string[];
  field?: string[];
  idempotencyKey?: string;
}

export function registerPublicBookingCommands(program: Command): void {
  const pub = program
    .command("public")
    .description(
      "Book with any topcal calendar by its public handle — no login. The emailed code is the only gate.",
    );

  pub
    .command("calendar <handle>")
    .description("List bookable event types and the fields a booker must provide (handle: workspace/username or URL).")
    .option("--json", "Output machine-readable JSON")
    .action(async (raw: string, opts: JsonOpt) => {
      const out = createOutput({ json: !!opts.json });
      const h = parsePublicHandle(raw);
      const result = await makeClient().request<{
        eventTypes?: Array<{ slug: string; name: string; durationMinutes?: number }>;
      }>({ method: "GET", path: `/public/${enc(h.workspace)}/${enc(h.username)}`, skipAuth: true });
      out.json(result);
      if (!opts.json) {
        for (const et of result.eventTypes ?? []) {
          out.note(`  ${h.workspace}/${h.username}/${et.slug} — ${et.name}`);
        }
      }
    });

  pub
    .command("slots <handle>")
    .description("Open times for an event (handle: workspace/username/event or URL).")
    .option("--timezone <tz>", "Booker IANA timezone for local display times")
    .option("--from <iso>", "ISO 8601 UTC lower bound")
    .option("--to <iso>", "ISO 8601 UTC upper bound")
    .option("--limit <n>", "Max slots to return")
    .option("--json", "Output machine-readable JSON")
    .action(async (raw: string, opts: SlotsOptions) => {
      const out = createOutput({ json: !!opts.json });
      const qs = new URLSearchParams();
      if (opts.timezone) qs.set("timezone", opts.timezone);
      if (opts.from) qs.set("from", opts.from);
      if (opts.to) qs.set("to", opts.to);
      if (opts.limit) qs.set("limit", opts.limit);
      const query = qs.toString() ? `?${qs}` : "";
      const result = await makeClient().request({
        method: "GET",
        path: `${eventPath(parsePublicHandle(raw))}/slots${query}`,
        skipAuth: true,
      });
      out.json(result);
    });

  pub
    .command("request-code <handle>")
    .description(
      "Step 1: email the 6-digit confirmation code. With --agent-email the code goes to your own inbox instead of the attendee's.",
    )
    .requiredOption("--email <email>", "Attendee email — the calendar invite goes here")
    .option("--name <name>", "Attendee name")
    .option(
      "--agent-email <email>",
      "Your own agent inbox (recognized providers: mail.grokbot.com). The code is sent here so you can confirm without asking the attendee.",
    )
    .option("--json", "Output machine-readable JSON")
    .action(async (raw: string, opts: RequestCodeOptions) => {
      const out = createOutput({ json: !!opts.json });
      const result = await makeClient().request<{
        codeSentTo?: string;
        notice?: string;
        message: string;
      }>({
        method: "POST",
        path: `${eventPath(parsePublicHandle(raw))}/otp`,
        skipAuth: true,
        body: {
          email: opts.email,
          ...(opts.name ? { name: opts.name } : {}),
          ...(opts.agentEmail ? { agentEmail: opts.agentEmail } : {}),
        },
      });
      out.json(result);
      if (result.notice) out.warn(result.notice);
      if (!opts.json) out.ok(result.message);
    });

  pub
    .command("confirm <handle>")
    .description("Step 2: confirm the booking with the code. Creates the real calendar event + invite.")
    .requiredOption("--start <iso>", "Slot start, ISO 8601 UTC (from `topcal public slots`)")
    .requiredOption("--email <email>", "Attendee email (same as request-code)")
    .requiredOption("--timezone <tz>", "Attendee IANA timezone (e.g. America/New_York)")
    .requiredOption("--code <code>", "The 6-digit code")
    .option("--name <name>", "Attendee name")
    .option("--agent-email <email>", "The --agent-email you passed to request-code, if any")
    .option("--guest <email...>", "Extra people to add to the invite (repeatable)")
    .option(
      "--field <key=value...>",
      "Form answer for the event's intake form (repeatable). Value is parsed as JSON when possible.",
    )
    .option("--idempotency-key <key>", "Idempotency key (min 8 chars) to make retries safe")
    .option("--json", "Output machine-readable JSON")
    .action(async (raw: string, opts: ConfirmOptions) => {
      const out = createOutput({ json: !!opts.json });
      const customFields = parseFieldOptions(opts.field);
      const result = await makeClient().request<{
        booking: { id: string; startAt: string; endAt: string; status: string; joinUrl?: string };
        message: string;
      }>({
        method: "POST",
        path: `${eventPath(parsePublicHandle(raw))}/book`,
        skipAuth: true,
        body: {
          startAt: opts.start,
          code: opts.code,
          invitee: {
            email: opts.email,
            ...(opts.name ? { name: opts.name } : {}),
            timezone: opts.timezone,
          },
          ...(opts.agentEmail ? { agentEmail: opts.agentEmail } : {}),
          ...(opts.guest?.length ? { guests: opts.guest } : {}),
          ...(customFields ? { customFields } : {}),
          ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
        },
      });
      out.json(result);
      if (!opts.json) {
        out.ok(result.message);
        out.kv([
          ["booking", result.booking.id],
          ["when", `${result.booking.startAt} → ${result.booking.endAt}`],
          ["status", result.booking.status],
          ...(result.booking.joinUrl ? [["join", result.booking.joinUrl] as [string, string]] : []),
        ]);
      }
    });
}

function makeClient(): ApiClient {
  // Public plane: only the API origin matters — never send stored credentials.
  return new ApiClient({ apiUrl: loadConfig().apiUrl });
}
