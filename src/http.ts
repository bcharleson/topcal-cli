/**
 * Thin fetch wrapper for the topcal API.
 *
 * Centralizes:
 *   - Authorization header (workspace API key)
 *   - X-Topcal-Agent-Intent header (delegated JWT, only when present)
 *   - JSON body encoding + parsing
 *   - Error envelope normalization (matches `lib/api/errors.ts`)
 *
 * Every CLI command goes through `request<T>` so the on-the-wire
 * contract has exactly one implementation.
 */

export interface ApiClientOptions {
  apiUrl: string;
  apiKey?: string;
  intentToken?: string;
  /** Override fetch (for tests). */
  fetch?: typeof fetch;
}

export class TopcalApiError extends Error {
  override readonly name = "TopcalApiError";
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  /** Path WITHOUT the `/api/v1` prefix (e.g. `/agent/identities`). */
  path: string;
  body?: unknown;
  /** Send the agent intent JWT on this request. */
  withAgentIntent?: boolean;
  /** Skip the API key (for `/health`, `/openapi`). */
  skipAuth?: boolean;
  /** When the response is non-JSON, set this to read text. */
  responseType?: "json" | "text";
  /** Default: `/api/v1`. Pass `/api/mcp` for MCP, `""` for absolute paths. */
  basePath?: string;
  /**
   * Override the `Accept` header. The MCP Streamable-HTTP transport
   * requires `application/json, text/event-stream`; everything else uses
   * the default `application/json`.
   */
  accept?: string;
  /** Receives the raw response headers (e.g. to capture `mcp-session-id`). */
  onResponseHeaders?: (headers: Headers) => void;
  /** Extra request headers merged last (e.g. `mcp-session-id`). */
  headers?: Record<string, string>;
}

const USER_AGENT = "topcal-cli/0.1.0";

export class ApiClient {
  private readonly opts: ApiClientOptions;

  constructor(opts: ApiClientOptions) {
    if (!opts.apiUrl) throw new Error("ApiClient requires apiUrl");
    this.opts = opts;
  }

  async request<T = unknown>(input: RequestOptions): Promise<T> {
    const fx = this.opts.fetch ?? fetch;
    const basePath =
      input.basePath !== undefined ? input.basePath : "/api/v1";
    const root = this.opts.apiUrl.replace(/\/+$/, "");
    const url = `${root}${basePath}${input.path}`;

    const headers: Record<string, string> = {
      accept: input.accept ?? "application/json",
      "user-agent": USER_AGENT,
    };
    if (!input.skipAuth) {
      if (!this.opts.apiKey) {
        throw new TopcalApiError(
          401,
          "auth.required",
          "No API key configured. Run `topcal login` or set TOPCAL_API_KEY.",
        );
      }
      headers.authorization = `Bearer ${this.opts.apiKey}`;
    }
    if (input.withAgentIntent) {
      if (!this.opts.intentToken) {
        throw new TopcalApiError(
          401,
          "auth.intent_missing",
          "No agent intent token. Run `topcal identity verify` first.",
        );
      }
      headers["x-topcal-agent-intent"] = this.opts.intentToken;
    }
    if (input.body !== undefined) headers["content-type"] = "application/json";
    if (input.headers) Object.assign(headers, input.headers);

    const init: RequestInit = {
      method: input.method ?? "GET",
      headers,
    };
    if (input.body !== undefined) init.body = JSON.stringify(input.body);
    const res = await fx(url, init);
    input.onResponseHeaders?.(res.headers);

    if (input.responseType === "text") {
      const text = await res.text();
      if (!res.ok) {
        throw new TopcalApiError(res.status, "http.error", text || res.statusText);
      }
      return text as unknown as T;
    }

    const rawText = await res.text();
    // The MCP transport answers as Server-Sent Events even for a single
    // JSON-RPC reply (`event: message\ndata: {…}`). Collapse the SSE frame
    // down to the JSON payload so callers see a normal object.
    const contentType = res.headers.get("content-type") ?? "";
    const text = contentType.includes("text/event-stream")
      ? extractSseData(rawText)
      : rawText;
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const envelope = parsed as
        | { error?: { code?: string; message?: string; details?: unknown } }
        | undefined;
      const code = envelope?.error?.code ?? "http.error";
      const message =
        envelope?.error?.message ?? `HTTP ${res.status} ${res.statusText}`;
      throw new TopcalApiError(
        res.status,
        code,
        message,
        envelope?.error?.details,
      );
    }
    return parsed as T;
  }
}

/**
 * Pull the JSON payload out of an SSE body. Concatenates every `data:`
 * line (per the SSE spec a single event can span multiple data lines)
 * and returns the last event's payload — for a one-shot JSON-RPC reply
 * there is exactly one event.
 */
function extractSseData(body: string): string {
  const events: string[] = [];
  let current: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      current.push(line.slice(5).trimStart());
    } else if (line.trim() === "" && current.length > 0) {
      events.push(current.join("\n"));
      current = [];
    }
  }
  if (current.length > 0) events.push(current.join("\n"));
  return events.at(-1) ?? "";
}
