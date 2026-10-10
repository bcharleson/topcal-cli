import { describe, expect, it } from "vitest";

import { interpretVerify } from "./signup.js";

describe("interpretVerify", () => {
  it("recognizes a finished sign-in", () => {
    const body = {
      apiKey: "topcal_live_abc",
      apiUrl: "https://app.topcal.ai",
      workspace: { id: "w", name: "Acme", slug: "acme" },
      user: { email: "pat@acme.com", name: null },
      isNewAccount: true,
    };
    expect(interpretVerify(body)).toEqual({ kind: "signed_in", result: body });
  });

  it("recognizes an agent waiting for its human", () => {
    const body = { status: "pending_claim", pollToken: "p", claimSentTo: "pat@acme.com", expiresIn: 172800 };
    expect(interpretVerify(body)).toEqual({ kind: "pending_claim", result: body });
  });

  it("treats a claimed poll (status + apiKey) as signed in", () => {
    const body = {
      status: "claimed",
      apiKey: "topcal_live_seat",
      apiUrl: "https://app.topcal.ai",
      workspace: { id: "w", name: "Acme", slug: "acme" },
      user: { email: "bot@mail.grokbot.com", name: "WALL-E" },
      isNewAccount: true,
    };
    expect(interpretVerify(body).kind).toBe("signed_in");
  });

  it("rejects anything else rather than saving a bad key", () => {
    expect(() => interpretVerify({})).toThrowError(/Unexpected/);
    expect(() => interpretVerify({ apiKey: "" })).toThrowError(/Unexpected/);
    expect(() => interpretVerify(null)).toThrowError(/Unexpected/);
  });
});
