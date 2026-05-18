import { describe, it, expect } from "bun:test";
import { buildElicitationCreate, flattenChoice } from "../elicitation.builder.js";
import type { Question } from "../../shared/schemas/question.schema.js";

const stageQ: Question = {
  title: "Stage",
  prompt: "Are you pre- or post-revenue?",
  options: [
    { label: "Pre-revenue (Recommended)", description: "No paying customers yet." },
    { label: "Post-revenue", description: "At least one paying customer." },
  ],
  multiSelect: false,
};

const priorityQ: Question = {
  title: "Priority",
  prompt: "Which traits matter most?",
  options: [
    { label: "Technical depth", description: "Engineering chops." },
    { label: "Domain expertise", description: "Industry context." },
  ],
  multiSelect: true,
};

describe("buildElicitationCreate", () => {
  it("emits a string enum schema for single-select questions", () => {
    const out = buildElicitationCreate(stageQ);
    expect(out.message).toBe("Stage: Are you pre- or post-revenue?");
    expect(out.requestedSchema).toEqual({
      type: "object",
      properties: {
        choice: {
          type: "string",
          enum: ["Pre-revenue (Recommended)", "Post-revenue"],
          description:
            "Pre-revenue (Recommended): No paying customers yet. | Post-revenue: At least one paying customer.",
        },
      },
      required: ["choice"],
    });
  });

  it("emits an array-of-enum schema for multi-select questions", () => {
    const out = buildElicitationCreate(priorityQ);
    expect(out.requestedSchema).toEqual({
      type: "object",
      properties: {
        choice: {
          type: "array",
          items: { type: "string", enum: ["Technical depth", "Domain expertise"] },
          description: "Technical depth: Engineering chops. | Domain expertise: Industry context.",
        },
      },
      required: ["choice"],
    });
  });
});

describe("flattenChoice", () => {
  it("formats a single-select string choice as `Title (prompt): Label`", () => {
    expect(flattenChoice(stageQ, "Pre-revenue (Recommended)")).toBe(
      "Stage (Are you pre- or post-revenue?): Pre-revenue (Recommended)",
    );
  });

  it("formats a multi-select array choice with comma-joined labels", () => {
    expect(flattenChoice(priorityQ, ["Technical depth", "Domain expertise"])).toBe(
      "Priority (Which traits matter most?): Technical depth, Domain expertise",
    );
  });

  it("returns null for an empty array choice (treat as unanswered)", () => {
    expect(flattenChoice(priorityQ, [])).toBeNull();
  });

  it("returns null for an undefined/missing choice", () => {
    expect(flattenChoice(stageQ, undefined)).toBeNull();
  });

  it("returns null when a single-select string is not in q.options", () => {
    expect(flattenChoice(stageQ, "Unknown option")).toBeNull();
  });

  it("drops invalid items from a multi-select array; returns null if none remain", () => {
    expect(
      flattenChoice(priorityQ, ["Technical depth", "not-a-real-option", 42, null]),
    ).toBe("Priority (Which traits matter most?): Technical depth");
    expect(flattenChoice(priorityQ, ["not-a-real-option", 42])).toBeNull();
  });

  it("returns null when a single-select question receives an array (non-conformant client)", () => {
    expect(
      flattenChoice(stageQ, ["Pre-revenue (Recommended)", "Post-revenue"]),
    ).toBeNull();
  });

  it("returns null when a multi-select question receives a bare string (non-conformant client)", () => {
    // The schema for multi-select declares an array of enum; a string would
    // be a shape violation even when the label itself is valid.
    expect(flattenChoice(priorityQ, "Technical depth")).toBeNull();
  });
});
