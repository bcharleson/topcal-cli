import { describe, expect, it } from "vitest";

import { clean, parsePublicHandle } from "./public-booking.js";

describe("parsePublicHandle", () => {
  it("reads workspace/username/event", () => {
    expect(parsePublicHandle("tofu/brandon/intro")).toEqual({
      workspace: "tofu",
      username: "brandon",
      eventSlug: "intro",
    });
  });

  it("reads a calendar handle without an event", () => {
    expect(parsePublicHandle("/tofu/brandon/")).toEqual({
      workspace: "tofu",
      username: "brandon",
    });
  });

  it("pulls the handle out of a booking URL", () => {
    expect(
      parsePublicHandle("https://app.topcal.ai/tofu/brandon/intro?utm=x"),
    ).toEqual({ workspace: "tofu", username: "brandon", eventSlug: "intro" });
  });

  it("rejects anything else", () => {
    expect(() => parsePublicHandle("tofu")).toThrowError(/workspace\/username/);
    expect(() => parsePublicHandle("a/b/c/d")).toThrowError(/workspace\/username/);
  });
});

describe("public handle safety", () => {
  it("refuses booking URLs from other hosts", () => {
    expect(() => parsePublicHandle("https://evil.example/tofu/brandon/intro")).toThrowError(/Not a topcal booking URL/);
    expect(() => parsePublicHandle("https://topcal.ai.evil.example/a/b/c")).toThrowError(/Not a topcal booking URL/);
  });

  it("accepts the configured API host (local dev)", () => {
    expect(parsePublicHandle("http://localhost:3002/tofu/brandon/intro", "http://localhost:3002")).toEqual({
      workspace: "tofu",
      username: "brandon",
      eventSlug: "intro",
    });
  });

  it("rejects dot segments and encoded slashes", () => {
    expect(() => parsePublicHandle("tofu/../intro")).toThrowError(/workspace\/username/);
    expect(() => parsePublicHandle("tofu/brandon/..")).toThrowError(/workspace\/username/);
    expect(() => parsePublicHandle("tofu/a%2Fb/intro")).toThrowError(/workspace\/username/);
  });

  it("strips terminal escape sequences from server text", () => {
    expect(clean("Intro\u001b[2J\u001b]0;pwned\u0007 call")).toBe("Intro[2J]0;pwned call");
  });
});
