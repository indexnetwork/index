import { describe, it, expect } from "bun:test";

import { arg, has, flagValue } from "../cli.js";

describe("cli helpers", () => {
  const argv = ["bun", "eval.ts", "--runs", "5", "--report", "--html", "out.html", "--rolling-baseline", "--alpha"];

  it("arg reads the value after a flag", () => {
    expect(arg("--runs", argv)).toBe("5");
    expect(arg("--missing", argv)).toBeUndefined();
  });

  it("has detects presence", () => {
    expect(has("--report", argv)).toBe(true);
    expect(has("--nope", argv)).toBe(false);
  });

  it("flagValue ignores a following flag as a value", () => {
    expect(flagValue("--html", argv)).toBe("out.html");
    expect(flagValue("--report", argv)).toBeUndefined(); // followed by --html
    expect(flagValue("--rolling-baseline", argv)).toBeUndefined(); // followed by --alpha
  });
});
