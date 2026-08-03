import { describe, expect, it } from "vitest";

import { buildCheckoutRequest } from "./billing.js";

describe("buildCheckoutRequest", () => {
  it("creates a Starter monthly checkout request by default", () => {
    expect(buildCheckoutRequest({}).body).toEqual({
      plan: "solo",
      interval: "monthly",
    });
  });

  it("supports annual Starter checkout requests", () => {
    expect(
      buildCheckoutRequest({
        plan: "solo",
        interval: "annual",
        quantity: 4,
        email: "buyer@example.com",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      }).body,
    ).toEqual({
      plan: "solo",
      interval: "annual",
      quantity: 4,
      customerEmail: "buyer@example.com",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
  });

  it("maps legacy tiers to Starter checkout requests", () => {
    expect(buildCheckoutRequest({ tier: "team", interval: "annual" })).toEqual({
      body: {
        plan: "solo",
        interval: "annual",
      },
      legacyTier: "team",
    });
  });

  it("rejects mixing plan and deprecated tier options", () => {
    expect(() =>
      buildCheckoutRequest({ plan: "solo", tier: "scale" }),
    ).toThrowError(/either --plan or deprecated --tier/);
  });
});
