import { describe, expect, it, vi } from "vitest";

import { ApiClient, TopcalApiError } from "./http";

type FetchInput = Parameters<typeof fetch>[0];

function mockFetch(
  responder: (input: FetchInput, init?: RequestInit) => Response | Promise<Response>,
) {
  return vi
    .fn<(input: FetchInput, init?: RequestInit) => Promise<Response>>()
    .mockImplementation(async (input, init) => responder(input, init));
}

describe("ApiClient", () => {
  it("attaches Authorization + body and returns parsed JSON", async () => {
    const fetchSpy = mockFetch((input, init) => {
      const url = String(input);
      expect(url).toBe("https://book.example.com/api/v1/agent/identities");
      expect(init?.method).toBe("POST");
      expect(
        (init?.headers as Record<string, string>).authorization,
      ).toBe("Bearer tofu_test_key");
      expect((init?.headers as Record<string, string>)["content-type"]).toBe(
        "application/json",
      );
      expect(init?.body).toBe(
        JSON.stringify({ prospectEmail: "a@b.com", agentLabel: "agent-x" }),
      );
      return new Response(
        JSON.stringify({ principalId: "abc", status: "pending" }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });

    const client = new ApiClient({
      apiUrl: "https://book.example.com",
      apiKey: "tofu_test_key",
      fetch: fetchSpy,
    });
    const result = await client.request<{ principalId: string }>({
      method: "POST",
      path: "/agent/identities",
      body: { prospectEmail: "a@b.com", agentLabel: "agent-x" },
    });
    expect(result.principalId).toBe("abc");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("attaches X-Topcal-Agent-Intent only when withAgentIntent is set", async () => {
    let lastHeaders: Record<string, string> = {};
    const fetchSpy = mockFetch((_input, init) => {
      lastHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new ApiClient({
      apiUrl: "https://book.example.com",
      apiKey: "tofu_test",
      intentToken: "jwt.intent",
      fetch: fetchSpy,
    });

    await client.request({ path: "/agent/users", method: "POST", body: {} });
    expect(lastHeaders["x-topcal-agent-intent"]).toBeUndefined();

    await client.request({ path: "/agent/users", method: "POST", body: {}, withAgentIntent: true });
    expect(lastHeaders["x-topcal-agent-intent"]).toBe("jwt.intent");
  });

  it("normalizes error envelopes into TopcalApiError", async () => {
    const fetchSpy = mockFetch(() =>
      new Response(
        JSON.stringify({
          error: { code: "auth.required", message: "Missing Bearer token" },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new ApiClient({
      apiUrl: "https://book.example.com",
      apiKey: "tofu_test",
      fetch: fetchSpy,
    });
    await expect(
      client.request({ path: "/agent/identities", method: "POST", body: {} }),
    ).rejects.toMatchObject({
      name: "TopcalApiError",
      status: 401,
      code: "auth.required",
      message: "Missing Bearer token",
    });
  });

  it("falls back to status text when no JSON envelope is present", async () => {
    const fetchSpy = mockFetch(() =>
      new Response("oops", { status: 502, statusText: "Bad Gateway" }),
    );
    const client = new ApiClient({
      apiUrl: "https://book.example.com",
      apiKey: "tofu_test",
      fetch: fetchSpy,
    });
    await expect(client.request({ path: "/health", skipAuth: true })).rejects.toBeInstanceOf(
      TopcalApiError,
    );
  });

  it("requires an API key unless skipAuth is set", async () => {
    const client = new ApiClient({
      apiUrl: "https://book.example.com",
      fetch: mockFetch(() => new Response("{}")),
    });
    await expect(
      client.request({ path: "/agent/identities", method: "POST", body: {} }),
    ).rejects.toMatchObject({ status: 401, code: "auth.required" });
  });

  it("supports an explicit basePath override (for /api/mcp)", async () => {
    let lastUrl = "";
    const fetchSpy = mockFetch((input) => {
      lastUrl = String(input);
      return new Response('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}', {
        headers: { "content-type": "application/json" },
      });
    });
    const client = new ApiClient({
      apiUrl: "https://book.example.com",
      apiKey: "tofu_test",
      fetch: fetchSpy,
    });
    await client.request({
      method: "POST",
      basePath: "/api/mcp",
      path: "/mcp",
      body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(lastUrl).toBe("https://book.example.com/api/mcp/mcp");
  });
});
