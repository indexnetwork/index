import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect } from "bun:test";
import {
  sanitizeForDebugMeta,
  SANITIZATION_ERROR_PLACEHOLDER,
} from "../debug-meta.sanitizer.js";

describe("sanitizeForDebugMeta", () => {
  it("replaces embedding array with placeholder", () => {
    const out = sanitizeForDebugMeta({
      embedding: [0.1, 0.2, ...new Array(100).fill(0)],
    });
    expect(out).toHaveProperty("embedding");
    expect(String((out as Record<string, unknown>).embedding)).toMatch(
      /\[embedding.*length \d+\]/,
    );
  });

  it("truncates string over max length", () => {
    const long = "x".repeat(3000);
    const out = sanitizeForDebugMeta({ text: long }, 2048);
    expect((out as Record<string, unknown>).text).toMatch(
      /\[truncated, \d+ chars\]/,
    );
  });

  it("keeps normal args and short strings", () => {
    const out = sanitizeForDebugMeta({ name: "read_intents", limit: 10 });
    expect(out).toEqual({ name: "read_intents", limit: 10 });
  });

  it("nested object: only blocklisted or large values replaced", () => {
    const out = sanitizeForDebugMeta({
      keep: "short",
      embedding: [0.1, ...new Array(150).fill(0)],
      inner: { alsoKeep: 42, vector: new Array(200).fill(0) },
    });
    expect((out as Record<string, unknown>).keep).toBe("short");
    expect(String((out as Record<string, unknown>).embedding)).toMatch(
      /\[embedding.*length \d+\]/,
    );
    const inner = (out as Record<string, unknown>).inner as Record<string, unknown>;
    expect(inner.alsoKeep).toBe(42);
    expect(String(inner.vector)).toMatch(/\[embedding.*length \d+\]/);
  });

  it("circular reference returns placeholder", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const out = sanitizeForDebugMeta(circular);
    if (typeof out === "string") {
      expect(out).toBe(SANITIZATION_ERROR_PLACEHOLDER);
    } else {
      const obj = out as Record<string, unknown>;
      expect(obj.a).toBe(1);
      expect(obj.self).toBe(SANITIZATION_ERROR_PLACEHOLDER);
    }
  });
});
