import type { Command } from "commander";

import { loadConfig } from "../config.js";
import { ApiClient } from "../http.js";
import { createOutput } from "../output.js";
import { packageVersion } from "../version.js";

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * `topcal mcp probe` — connects to /api/mcp/mcp, calls `tools/list`,
 * and prints the catalog. Useful as a smoke test for the MCP transport
 * AND as a manual check that REST + MCP haven't drifted.
 *
 * Uses the streamable HTTP transport's request/response shape directly
 * — we don't need a full MCP client because we're only invoking
 * `initialize` + `tools/list` once.
 */
function resolveMcpTarget(
  apiUrl: string,
  override: string,
): { origin: string; basePath: string; path: string } {
  if (override) {
    const url = new URL(override);
    return { origin: url.origin, basePath: "", path: url.pathname || "/mcp" };
  }
  return {
    origin: apiUrl.replace(/\/+$/, ""),
    basePath: "/api/mcp",
    path: "/mcp",
  };
}

export function registerMcpCommand(program: Command): void {
  const mcp = program.command("mcp").description("Probe and inspect the topcal MCP server.");

  mcp
    .command("probe")
    .description("Connect to an MCP endpoint, list tools, and report parity with the OpenAPI spec.")
    .option(
      "--url <url>",
      "MCP origin (default: TOPCAL_MCP_URL or {apiUrl}/api/mcp/mcp)",
    )
    .option("--json", "Output machine-readable JSON")
    .action(async (opts: { url?: string; json?: boolean }) => {
      const out = createOutput({ json: !!opts.json });
      const cfg = loadConfig();
      const mcpTarget = resolveMcpTarget(
        cfg.apiUrl,
        opts.url?.trim() || process.env.TOPCAL_MCP_URL?.trim() || "",
      );
      const mcpClient = new ApiClient({
        apiUrl: mcpTarget.origin,
        ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
        ...(cfg.intentToken ? { intentToken: cfg.intentToken } : {}),
      });
      const apiClient = new ApiClient({
        apiUrl: cfg.apiUrl,
        ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
      });

      // The MCP Streamable-HTTP transport requires the client to accept
      // both JSON and SSE, and threads a session id from `initialize`
      // through every later call via the `mcp-session-id` header.
      const MCP_ACCEPT = "application/json, text/event-stream";
      let sessionId: string | undefined;
      const captureSession = (headers: Headers) => {
        const id = headers.get("mcp-session-id");
        if (id) sessionId = id;
      };

      // 1. Initialize.
      const init = await mcpClient.request<JsonRpcResponse<unknown>>({
        method: "POST",
        basePath: mcpTarget.basePath,
        path: mcpTarget.path,
        accept: MCP_ACCEPT,
        onResponseHeaders: captureSession,
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "topcal-cli", version: packageVersion() },
          },
        },
      });
      if (init.error) {
        out.error(`MCP initialize failed: ${init.error.message}`);
        process.exit(1);
      }

      // 2. List tools (carry the session id if the server issued one).
      const list = await mcpClient.request<JsonRpcResponse<{ tools: McpToolDescriptor[] }>>({
        method: "POST",
        basePath: mcpTarget.basePath,
        path: mcpTarget.path,
        accept: MCP_ACCEPT,
        ...(sessionId ? { headers: { "mcp-session-id": sessionId } } : {}),
        body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      });
      if (list.error || !list.result) {
        out.error(`MCP tools/list failed: ${list.error?.message ?? "no result"}`);
        process.exit(1);
      }
      const tools = list.result.tools;

      // 3. Pull operationIds out of OpenAPI for parity reporting.
      const spec = await apiClient.request<{ paths: Record<string, Record<string, { operationId?: string }>> }>({
        path: "/openapi",
        skipAuth: true,
      });
      const operationIds = new Set<string>();
      for (const path of Object.values(spec.paths ?? {})) {
        for (const op of Object.values(path)) {
          if (op?.operationId) operationIds.add(op.operationId);
        }
      }

      const toolNames = new Set(tools.map((t) => t.name));
      const inMcpOnly = [...toolNames].filter(
        (n) => !operationIds.has(n) && !operationIds.has(`agent_${n}`),
      );

      out.ok(`MCP responded with ${tools.length} tool(s).`);
      if (!opts.json) {
        out.kv(tools.map((t) => [t.name, t.description?.split("\n")[0] ?? ""]));
        if (inMcpOnly.length > 0) {
          out.warn(
            `Tools without a matching REST operationId: ${inMcpOnly.join(", ")}`,
          );
        }
      }
      out.json({
        toolCount: tools.length,
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
        operationIds: [...operationIds].sort(),
        unmatched: inMcpOnly,
      });
    });
}
