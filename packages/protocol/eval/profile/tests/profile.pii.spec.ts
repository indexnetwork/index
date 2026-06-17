import { describe, it, expect } from "bun:test";

import { findPII } from "../profile.pii.js";

describe("findPII", () => {
  it("detects emails", () => {
    expect(findPII(["reach me at john.park@acme.com please"])).toContain("john.park@acme.com");
  });

  it("detects phone numbers in several formats", () => {
    expect(findPII(["+1 415-555-0199"]).length).toBe(1);
    expect(findPII(["call (212) 555-0143"]).length).toBe(1);
  });

  it("does not flag plain bios, years, or short numbers", () => {
    expect(findPII(["Backend engineer with 9 years of experience since 2015."])).toEqual([]);
    expect(findPII(["Skilled in Go and Postgres. Interested in databases."])).toEqual([]);
  });

  it("scans multiple fields and dedups", () => {
    const hits = findPII(["a@b.com", "a@b.com", "clean text"]);
    expect(hits).toEqual(["a@b.com"]);
  });

  it("ignores empty fields", () => {
    expect(findPII(["", "clean"])).toEqual([]);
  });
});
