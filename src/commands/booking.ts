import type { Command } from "commander";

import { loadConfig } from "../config.js";
import { ApiClient } from "../http.js";
import { createOutput } from "../output.js";

/**
 * The booking surface: list event types, propose slots, create a
 * booking. One-to-one mirrors of the REST operations
 * `agent_list_event_types`, `agent_propose_slots`, and
 * `agent_create_booking` (which themselves mirror the MCP tools).
 *
 * `slots` and `book` act on behalf of a verified human, so they send
 * the agent intent JWT minted by `topcal identity verify`.
 */

interface EventTypesListOptions {
  includeInactive?: boolean;
  json?: boolean;
}

interface SlotsOptions {
  from?: string;
  to?: string;
  limit: string;
  json?: boolean;
}

interface BookOptions {
  start: string;
  email: string;
  name?: string;
  timezone: string;
  field?: string[];
  idempotencyKey?: string;
  json?: boolean;
}

interface AgentEventType {
  id: string;
  slug: string;
  name: string;
  durationMinutes: number;
  locationType: string;
  form: { id: string; definition: { fields: Array<{ key: string; label: string; required: boolean; type: string }> } | null } | null;
}

export function registerBookingCommands(program: Command): void {
  program
    .command("event-types")
    .description("List event types the agent can book (includes attached form definitions).")
    .option("--include-inactive", "Include inactive event types")
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: EventTypesListOptions) => {
      const out = createOutput({ json: !!opts.json });
      const client = makeClient();

      const result = await client.request<{ eventTypes: AgentEventType[] }>({
        path: `/agent/event-types${opts.includeInactive ? "?includeInactive=true" : ""}`,
      });

      out.json(result);
      if (!opts.json) {
        for (const et of result.eventTypes) {
          const form = et.form?.definition
            ? ` form: ${et.form.definition.fields.map((f) => f.key + (f.required ? "*" : "")).join(", ")}`
            : "";
          out.note(`${et.id}  ${et.slug} (${et.durationMinutes}m)${form}`);
        }
        out.ok(`${result.eventTypes.length} event type(s).`);
      }
    });

  program
    .command("slots <eventTypeId>")
    .description("Propose bookable slots for an event type (requires a verified intent token).")
    .option("--from <iso>", "ISO 8601 UTC lower bound (default: now)")
    .option("--to <iso>", "ISO 8601 UTC upper bound")
    .option("--limit <n>", "Max slots to return (1-50)", "8")
    .option("--json", "Output machine-readable JSON")
    .action(async (eventTypeId: string, opts: SlotsOptions) => {
      const out = createOutput({ json: !!opts.json });
      const client = makeClient();

      const result = await client.request<{
        eventTypeId: string;
        slots: Array<{ startUtc: string; endUtc: string }>;
        count: number;
      }>({
        method: "POST",
        path: "/agent/slots/propose",
        withAgentIntent: true,
        body: {
          eventTypeId,
          ...(opts.from ? { from: opts.from } : {}),
          ...(opts.to ? { to: opts.to } : {}),
          limit: Number.parseInt(opts.limit, 10),
        },
      });

      out.json(result);
      if (!opts.json) {
        for (const s of result.slots) out.note(`${s.startUtc} → ${s.endUtc}`);
        out.ok(
          result.count > 0
            ? `${result.count} slot(s) available.`
            : "No slots — the rep may have no connected calendar or no availability in range.",
        );
      }
    });

  program
    .command("get-booking <bookingId>")
    .description(
      "Fetch a booking including form answers and host notes (requires agent.booking.read).",
    )
    .option("--json", "Output machine-readable JSON")
    .action(async (bookingId: string, opts: { json?: boolean }) => {
      const out = createOutput({ json: !!opts.json });
      const client = makeClient();

      const result = await client.request<{
        id: string;
        startAt: string;
        endAt: string;
        status: string;
        invitee: { name: string | null; email: string | null };
        hostNotes: string | null;
        formAnswers: Array<{ key: string; label: string; value: unknown }>;
        formAnswersByKey: Record<string, unknown>;
        joinUrl: string | null;
      }>({
        path: `/agent/bookings/${encodeURIComponent(bookingId)}`,
      });

      out.json(result);
      if (!opts.json) {
        out.ok(`Booking ${result.id} (${result.status})`);
        out.kv([
          ["when", `${result.startAt} → ${result.endAt}`],
          [
            "invitee",
            `${result.invitee.name ?? "—"} <${result.invitee.email ?? "—"}>`,
          ],
          ...(result.joinUrl
            ? [["join", result.joinUrl] as [string, string]]
            : []),
          ...(result.hostNotes
            ? [["notes", result.hostNotes] as [string, string]]
            : []),
        ]);
        if (result.formAnswers.length === 0) {
          out.note("No booking-form answers.");
        } else {
          out.note("Booking form:");
          for (const answer of result.formAnswers) {
            const value =
              typeof answer.value === "string"
                ? answer.value
                : JSON.stringify(answer.value);
            out.note(`  ${answer.label}: ${value}`);
          }
        }
      }
    });

  program
    .command("book <eventTypeId>")
    .description("Book a meeting on behalf of the verified human (requires a verified intent token).")
    .requiredOption("--start <iso>", "Slot start, ISO 8601 UTC (from `topcal slots`)")
    .requiredOption("--email <email>", "Invitee email")
    .requiredOption("--timezone <tz>", "Invitee IANA timezone (e.g. America/New_York)")
    .option("--name <name>", "Invitee name")
    .option(
      "--field <key=value...>",
      "Form answer for the event type's attached form (repeatable). Value is parsed as JSON when possible, else kept as a string.",
    )
    .option("--idempotency-key <key>", "Idempotency key (min 8 chars) to make retries safe")
    .option("--json", "Output machine-readable JSON")
    .action(async (eventTypeId: string, opts: BookOptions) => {
      const out = createOutput({ json: !!opts.json });
      const client = makeClient();

      const customFields = parseFieldOptions(opts.field);

      const result = await client.request<{
        booking: {
          id: string;
          startAt: string;
          endAt: string;
          status: string;
          joinUrl?: string;
          htmlLink?: string;
        };
        message: string;
      }>({
        method: "POST",
        path: "/agent/bookings",
        withAgentIntent: true,
        body: {
          eventTypeId,
          startAt: opts.start,
          invitee: {
            email: opts.email,
            ...(opts.name ? { name: opts.name } : {}),
            timezone: opts.timezone,
          },
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

/**
 * Parse repeated `--field key=value` options into a customFields map.
 * Values round-trip through JSON.parse so numbers, booleans, and arrays
 * (`--field seats=12`, `--field channels='["a","b"]'`) arrive typed;
 * anything unparsable stays a plain string.
 */
export function parseFieldOptions(
  fields: string[] | undefined,
): Record<string, unknown> | undefined {
  if (!fields || fields.length === 0) return undefined;
  const result: Record<string, unknown> = {};
  for (const raw of fields) {
    const eq = raw.indexOf("=");
    if (eq <= 0) {
      throw new Error(`--field expects key=value, got: ${raw}`);
    }
    const key = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    try {
      result[key] = JSON.parse(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

function makeClient(): ApiClient {
  const cfg = loadConfig();
  return new ApiClient({
    apiUrl: cfg.apiUrl,
    ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
    ...(cfg.intentToken ? { intentToken: cfg.intentToken } : {}),
  });
}
