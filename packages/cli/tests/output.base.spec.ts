import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";

import {
  RESET,
  BOLD,
  RED,
  GREEN,
  YELLOW,
  CYAN,
  GRAY,
  error,
  success,
  info,
  warn,
  dim,
  heading,
  humanizeToolName,
  wordWrap,
  confidenceBar,
  padTo,
  stripAnsi,
} from "../src/output/base";

// ── Basic message helpers ───────────────────────────────────────────

describe("error", () => {
  let spy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spy = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it("prints a red error message to stderr", () => {
    error("something broke");
    expect(spy).toHaveBeenCalledTimes(1);
    const msg = spy.mock.calls[0][0] as string;
    expect(msg).toContain("error");
    expect(msg).toContain("something broke");
    expect(msg).toContain(RED);
  });
});

describe("success", () => {
  let spy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spy = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it("prints a green success message", () => {
    success("done!");
    expect(spy).toHaveBeenCalledTimes(1);
    const msg = spy.mock.calls[0][0] as string;
    expect(msg).toContain("done!");
    expect(msg).toContain(GREEN);
  });
});

describe("info", () => {
  let spy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spy = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it("prints a cyan info message", () => {
    info("note");
    expect(spy).toHaveBeenCalledTimes(1);
    const msg = spy.mock.calls[0][0] as string;
    expect(msg).toContain("note");
    expect(msg).toContain(CYAN);
  });
});

describe("warn", () => {
  let spy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spy = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it("prints a yellow warning message", () => {
    warn("careful");
    const msg = spy.mock.calls[0][0] as string;
    expect(msg).toContain("careful");
    expect(msg).toContain(YELLOW);
  });
});

describe("dim", () => {
  let spy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spy = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it("prints a gray dim message", () => {
    dim("secondary");
    const msg = spy.mock.calls[0][0] as string;
    expect(msg).toContain("secondary");
    expect(msg).toContain(GRAY);
  });
});

describe("heading", () => {
  let spy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spy = spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it("prints a bold heading with leading newline", () => {
    heading("Title");
    const msg = spy.mock.calls[0][0] as string;
    expect(msg).toContain(BOLD);
    expect(msg).toContain("Title");
    expect(msg.startsWith("\n")).toBe(true);
  });
});

// ── humanizeToolName ────────────────────────────────────────────────

describe("humanizeToolName", () => {
  it("returns known tool descriptions", () => {
    expect(humanizeToolName("read_intents")).toBe("Fetching your active signals...");
    expect(humanizeToolName("create_intent")).toBe("Creating a new signal...");
  });

  it("falls back to replacing underscores for unknown tools", () => {
    expect(humanizeToolName("do_something_custom")).toBe("do something custom...");
  });
});

// ── wordWrap ────────────────────────────────────────────────────────

describe("wordWrap", () => {
  it("wraps text at the given width", () => {
    const result = wordWrap("one two three four five", 10);
    expect(result.length).toBeGreaterThan(1);
    for (const line of result) {
      expect(line.length).toBeLessThanOrEqual(10);
    }
  });

  it("keeps short text on one line", () => {
    const result = wordWrap("short", 80);
    expect(result).toEqual(["short"]);
  });

  it("handles empty string", () => {
    const result = wordWrap("", 80);
    expect(result).toEqual([]);
  });

  it("does not break a single long word", () => {
    const result = wordWrap("superlongword", 5);
    expect(result).toEqual(["superlongword"]);
  });
});

// ── confidenceBar ───────────────────────────────────────────────────

describe("confidenceBar", () => {
  it("renders a full bar at 100%", () => {
    const bar = confidenceBar(100);
    const plain = stripAnsi(bar);
    expect(plain).toContain("##########");
    expect(plain).toContain("100%");
  });

  it("renders an empty bar at 0%", () => {
    const bar = confidenceBar(0);
    const plain = stripAnsi(bar);
    expect(plain).toContain("----------");
    expect(plain).toContain("0%");
  });

  it("renders a partial bar at 50%", () => {
    const bar = confidenceBar(50);
    const plain = stripAnsi(bar);
    expect(plain).toContain("#####");
    expect(plain).toContain("50%");
  });
});

// ── padTo ───────────────────────────────────────────────────────────

describe("padTo", () => {
  it("returns spaces to fill remaining width", () => {
    expect(padTo(10, "hello")).toBe("     ");
  });

  it("returns empty string when text equals width", () => {
    expect(padTo(5, "hello")).toBe("");
  });

  it("returns empty string when text exceeds width", () => {
    expect(padTo(3, "hello")).toBe("");
  });
});

// ── stripAnsi ───────────────────────────────────────────────────────

describe("stripAnsi", () => {
  it("removes ANSI escape codes", () => {
    expect(stripAnsi(`${RED}error${RESET}`)).toBe("error");
    expect(stripAnsi(`${BOLD}${GREEN}ok${RESET}`)).toBe("ok");
  });

  it("returns plain strings unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });
});
