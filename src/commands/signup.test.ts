import { describe, expect, it } from "vitest";

import { interpretVerify, printablePending, printableSignIn } from "./signup.js";

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

describe("what signup prints", () => {
  const signedIn = {
    apiKey: "topcal_live_0123456789abcdefSECRETSECRET",
    apiUrl: "https://app.topcal.ai",
    workspace: { id: "w", name: "Acme", slug: "acme" },
    user: { email: "bot@mail.grokbot.com", name: "WALL-E" },
    isNewAccount: false,
  };

  it("never echoes the full API key by default", () => {
    const printed = JSON.stringify(printableSignIn(signedIn, false));
    expect(printed).not.toContain("SECRETSECRET");
    expect(printed).toContain("topcal_live_0123");
    expect(printableSignIn(signedIn, false).apiKeyRedacted).toBe(true);
  });

  it("prints the key only when asked", () => {
    expect(printableSignIn(signedIn, true).apiKey).toBe(signedIn.apiKey);
  });

  it("never echoes the poll token by default", () => {
    const pending = { status: "pending_claim" as const, pollToken: "POLLSECRET", claimSentTo: "pat@acme.com", expiresIn: 60 };
    expect(JSON.stringify(printablePending(pending, false))).not.toContain("POLLSECRET");
    expect(printablePending(pending, true).pollToken).toBe("POLLSECRET");
  });
});
