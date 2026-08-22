/**
 * Unit tests for chat.utils (token utilities).
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect } from "bun:test";
import { estimateTokenCount, truncateToTokenLimit } from "../chat.utils.js";
import { HumanMessage } from "@langchain/core/messages";

describe("chat.utils", () => {
  describe("estimateTokenCount", () => {
    test("returns 0 for empty string", () => {
      expect(estimateTokenCount("")).toBe(0);
    });
    test("estimates ~4 chars per token", () => {
      expect(estimateTokenCount("hello")).toBe(2);
      expect(estimateTokenCount("hello world")).toBe(3);
    });
  });

  describe("truncateToTokenLimit", () => {
    test("returns empty array for no messages", () => {
      expect(truncateToTokenLimit([])).toEqual([]);
    });
    test("returns single message as-is", () => {
      const msg = new HumanMessage("Hi");
      expect(truncateToTokenLimit([msg])).toEqual([msg]);
    });
  });
});
