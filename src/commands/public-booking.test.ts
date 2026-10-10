import { describe, expect, it } from "vitest";

import { parsePublicHandle } from "./public-booking.js";

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
