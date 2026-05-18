import type { Question } from "../shared/schemas/question.schema.js";

type SingleChoiceSchema = {
  type: "string";
  enum: string[];
  description: string;
};

type MultiChoiceSchema = {
  type: "array";
  items: { type: "string"; enum: string[] };
  description: string;
};

type ChoiceSchema = SingleChoiceSchema | MultiChoiceSchema;

/**
 * Translates a Question into an MCP `elicitation/create` request payload.
 * The schema has one property named `choice` — a string-with-enum for
 * single-select, an array-of-enum-strings for multi-select.
 *
 * Per-option `description` text is packed into the property `description`
 * joined by ` | ` (MCP `requestedSchema` has no slot for per-option
 * descriptions; this is the spec's accepted lossy mapping).
 *
 * @param q - The question to translate.
 * @returns An MCP `elicitation/create` request payload.
 */
export function buildElicitationCreate(q: Question): {
  message: string;
  requestedSchema: {
    type: "object";
    properties: { choice: ChoiceSchema };
    required: ["choice"];
  };
} {
  const propertyDescription = q.options
    .map((opt) => `${opt.label}: ${opt.description}`)
    .join(" | ");

  const labels = q.options.map((o) => o.label);

  const choiceSchema: ChoiceSchema = q.multiSelect
    ? {
        type: "array",
        items: { type: "string", enum: labels },
        description: propertyDescription,
      }
    : {
        type: "string",
        enum: labels,
        description: propertyDescription,
      };

  return {
    message: `${q.title}: ${q.prompt}`,
    requestedSchema: {
      type: "object",
      properties: { choice: choiceSchema },
      required: ["choice"],
    },
  };
}

/**
 * Flattens an accepted elicitation `choice` value into the user-message
 * format Slice 4 produces. Returns `null` when the choice is missing,
 * empty, or contains no values that match `q.options` — MCP clients can
 * be buggy or non-conformant, so values are validated against the
 * declared enum before being persisted as a user message.
 *
 * For multi-select questions, items that are not strings or not in the
 * options list are dropped silently; if no items remain, returns null.
 *
 * @param q - The question the choice answers.
 * @param choice - The raw value from the elicitation response.
 * @returns A formatted string or `null` if no valid choice remains.
 */
export function flattenChoice(q: Question, choice: unknown): string | null {
  const prefix = `${q.title} (${q.prompt})`;
  const allowedLabels = new Set(q.options.map((o) => o.label));

  if (Array.isArray(choice)) {
    // Only multi-select questions accept arrays. A single-select question
    // receiving an array means a non-conformant client — reject the response
    // rather than recording an impossible multi-answer.
    if (!q.multiSelect) return null;
    const validItems = choice.filter(
      (c): c is string => typeof c === "string" && allowedLabels.has(c),
    );
    if (validItems.length === 0) return null;
    return `${prefix}: ${validItems.join(", ")}`;
  }
  if (typeof choice === "string" && allowedLabels.has(choice)) {
    // Symmetric guard: multi-select questions must receive arrays. A bare
    // string here means a non-conformant client; reject for the same reason.
    if (q.multiSelect) return null;
    return `${prefix}: ${choice}`;
  }
  return null;
}
