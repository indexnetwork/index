/**
 * Compile-time contract test for QuestionerDatabase. Verifies the interface
 * is importable and that a mock implementation satisfies the contract.
 */
import { describe, it, expect } from "bun:test";
import type {
  QuestionerDatabase,
  PersistableQuestion,
  PersistedQuestion,
} from "../questioner.interface.js";
import type { QuestionAnswer } from "../../schemas/question.schema.js";

describe("QuestionerDatabase interface", () => {
  it("is satisfiable by a mock implementation", () => {
    const mock: QuestionerDatabase = {
      persist: async (_questions: PersistableQuestion[]): Promise<string[]> => [],
      findPending: async (_userId: string): Promise<PersistedQuestion[]> => [],
      answer: async (_questionId: string, _userId: string, _answer: QuestionAnswer): Promise<boolean> => false,
      dismiss: async (_questionId: string, _userId: string): Promise<boolean> => false,
    };
    expect(mock).toBeDefined();
    expect(typeof mock.persist).toBe("function");
    expect(typeof mock.findPending).toBe("function");
    expect(typeof mock.answer).toBe("function");
    expect(typeof mock.dismiss).toBe("function");
  });
});
