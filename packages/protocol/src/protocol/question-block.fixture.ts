/**
 * Canonical question-message fixture for the question block contract.
 *
 * `questionMessageFixture` is a literal — not derived from the serializer — so
 * a serializer change that would alter the wire format breaks the spec loudly.
 * The web client's steps-UI tests import these from the package root instead
 * of minting their own wire format.
 */
import type { QuestionBlock } from "./question-block.schema.js";

export const questionProseFixture = [
  "I moved three conversations forward on your search for a technical co-founder.",
  "Two of them are waiting on details only you can give — answer here and I will",
  "pick the negotiations back up.",
].join("\n");

export const questionBlockFixture: QuestionBlock = {
  version: 1,
  questions: [
    {
      prompt: "Both counterparts asked about equity: what range are you prepared to offer a founding engineer?",
      opportunityId: "0b0e8a9c-6d3f-4d6a-9f2e-1c5b7a4d8e01",
      alsoUnblocks: ["7f3d2c1b-8a90-4e5f-b6c7-d8e9f0a1b2c3"],
    },
    {
      prompt: "The Berlin robotics lab wants to know whether you can be on-site one week per month.",
      opportunityId: "4a5b6c7d-8e9f-4a1b-8c2d-3e4f5a6b7c8d",
    },
  ],
};

export const questionMessageFixture = `${questionProseFixture}

\`\`\`index-questions
{
  "version": 1,
  "questions": [
    {
      "prompt": "Both counterparts asked about equity: what range are you prepared to offer a founding engineer?",
      "opportunityId": "0b0e8a9c-6d3f-4d6a-9f2e-1c5b7a4d8e01",
      "alsoUnblocks": [
        "7f3d2c1b-8a90-4e5f-b6c7-d8e9f0a1b2c3"
      ]
    },
    {
      "prompt": "The Berlin robotics lab wants to know whether you can be on-site one week per month.",
      "opportunityId": "4a5b6c7d-8e9f-4a1b-8c2d-3e4f5a6b7c8d"
    }
  ]
}
\`\`\``;
