import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { log, setLoggerFactory, sanitizeForLog, type LoggerWithSource } from "../log.js";

// Default factory reference — used to reset state between tests
function defaultFactory(_context: string, source: string): LoggerWithSource {
  const prefix = `[${source}]`;
  return {
    verbose: (msg, meta) => console.debug(prefix, msg, ...(meta ? [meta] : [])),
    debug: (msg, meta) => console.debug(prefix, msg, ...(meta ? [meta] : [])),
    info: (msg, meta) => console.info(prefix, msg, ...(meta ? [meta] : [])),
    warn: (msg, meta) => console.warn(prefix, msg, ...(meta ? [meta] : [])),
    error: (msg, meta) => console.error(prefix, msg, ...(meta ? [meta] : [])),
  };
}

beforeEach(() => {
  // Reset to default factory before each test
  setLoggerFactory(defaultFactory);
});

afterEach(() => {
  setLoggerFactory(defaultFactory);
});

describe("log.protocol.from()", () => {
  it("returns an object with verbose/debug/info/warn/error methods", () => {
    const logger = log.protocol.from("TestComponent");
    expect(typeof logger.verbose).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });
});

describe("default logger", () => {
  it("writes to console.info when .info() is called", () => {
    const spy = spyOn(console, "info").mockImplementation(() => {});
    const logger = log.protocol.from("Src");
    logger.info("hello world");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("writes to console.warn when .warn() is called", () => {
    const spy = spyOn(console, "warn").mockImplementation(() => {});
    const logger = log.protocol.from("Src");
    logger.warn("warning");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("writes to console.error when .error() is called", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const logger = log.protocol.from("Src");
    logger.error("oops");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("setLoggerFactory()", () => {
  it("overrides the logger — subsequent .from() calls use the new factory", () => {
    const calls: Array<{ context: string; source: string }> = [];
    setLoggerFactory((context, source) => {
      calls.push({ context, source });
      return {
        verbose: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      };
    });

    log.protocol.from("MyAgent");
    log.agent.from("AnotherAgent");

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ context: "protocol", source: "MyAgent" });
    expect(calls[1]).toEqual({ context: "agent", source: "AnotherAgent" });
  });

  it("the custom logger's methods are called when logging", () => {
    const infoCalls: string[] = [];
    setLoggerFactory((_context, _source) => ({
      verbose: () => {},
      debug: () => {},
      info: (msg) => infoCalls.push(msg),
      warn: () => {},
      error: () => {},
    }));

    const logger = log.graph.from("SomeGraph");
    logger.info("graph started");

    expect(infoCalls).toContain("graph started");
  });
});

describe("sanitizeForLog()", () => {
  it("returns the value as-is with the default (no sanitize function set)", () => {
    const obj = { name: "Alice", embedding: [0.1, 0.2] };
    const result = sanitizeForLog(obj);
    expect(result).toBe(obj);
  });

  it("delegates to the injected sanitize function after setLoggerFactory(factory, sanitize)", () => {
    const sanitized = { name: "Alice" };
    const sanitizeFn = (_value: unknown) => sanitized;

    setLoggerFactory(defaultFactory, sanitizeFn);

    const input = { name: "Alice", embedding: [0.1, 0.2] };
    const result = sanitizeForLog(input);
    expect(result).toBe(sanitized);
  });
});
