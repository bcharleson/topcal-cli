import { describe, expect, it } from "vitest";

import { parseFieldOptions } from "./booking.js";

describe("parseFieldOptions", () => {
  it("returns undefined when no fields given", () => {
    expect(parseFieldOptions(undefined)).toBeUndefined();
    expect(parseFieldOptions([])).toBeUndefined();
  });

  it("keeps plain strings as strings", () => {
    expect(parseFieldOptions(["company=Acme Corp"])).toEqual({
      company: "Acme Corp",
    });
  });

  it("parses JSON values: numbers, booleans, arrays", () => {
    expect(
      parseFieldOptions(['seats=12', 'active=true', 'channels=["a","b"]']),
    ).toEqual({ seats: 12, active: true, channels: ["a", "b"] });
  });

  it("splits on the first = only", () => {
    expect(parseFieldOptions(["note=a=b"])).toEqual({ note: "a=b" });
  });

  it("rejects entries without a key", () => {
    expect(() => parseFieldOptions(["=oops"])).toThrowError(/key=value/);
    expect(() => parseFieldOptions(["nokey"])).toThrowError(/key=value/);
  });
});
