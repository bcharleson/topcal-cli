import { describe, expect, it } from "vitest";

import { parseArgsJson } from "./tools.js";

describe("parseArgsJson", () => {
  it("treats empty as {}", () => {
    expect(parseArgsJson(undefined)).toEqual({});
    expect(parseArgsJson("")).toEqual({});
    expect(parseArgsJson("{}")).toEqual({});
  });

  it("parses a JSON object", () => {
    expect(parseArgsJson('{"filter":"upcoming","limit":3}')).toEqual({
      filter: "upcoming",
      limit: 3,
    });
  });

  it("rejects arrays and scalars", () => {
    expect(() => parseArgsJson("[]")).toThrow(/JSON object/);
    expect(() => parseArgsJson('"nope"')).toThrow(/JSON object/);
  });
});
