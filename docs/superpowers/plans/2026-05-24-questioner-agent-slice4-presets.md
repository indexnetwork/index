# QuestionerAgent Slice 4: Additional Presets

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `intent`, `profile`, and `negotiation` presets for the QuestionerAgent, and add the attachment points in their respective graphs so each process can trigger background question generation.

**Architecture:** Each preset defines a system prompt (tailored to its domain), a strategy subset, and a `buildPrompt` function that turns its `*Context` type into a user message string. The attachment points are single `questionerQueue.add()` calls gated by `QUESTIONER_ENABLED`, placed at the natural completion point of each graph (after intent creation, after profile enrichment, after negotiation stall).

**Tech Stack:** TypeScript, LangChain, BullMQ, `bun:test`

**Depends on:** Slice 1 (core agent + types), Slice 2 (queue), Slice 3 (events wiring)

---

### Task 1: Implement the intent preset

**Files:**
- Modify: `packages/protocol/src/questioner/questioner.presets.ts`
- Test: `packages/protocol/src/questioner/tests/questioner.presets.spec.ts`

- [ ] **Step 1: Write the failing test for the intent preset**

Add to `packages/protocol/src/questioner/tests/questioner.presets.spec.ts`:

```typescript
describe("intent preset", () => {
  it("returns the intent preset with systemPrompt and buildPrompt", () => {
    const preset = getPreset("intent");
    expect(preset).toBeDefined();
    expect(typeof preset.systemPrompt).toBe("string");
    expect(preset.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof preset.buildPrompt).toBe("function");
  });

  it("intent buildPrompt produces a string containing the intent payload", () => {
    const preset = getPreset("intent");
    const result = preset.buildPrompt({
      intentId: "intent-1",
      payload: "I want to find a cofounder for my AI startup",
      userProfile: { name: "Alice", bio: "AI researcher" },
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("cofounder");
    expect(result).toContain("Alice");
  });
});
```

- [ ] **Step 2: Run tests to verify the intent test fails**

Run: `cd packages/protocol && bun test src/questioner/tests/questioner.presets.spec.ts`
Expected: The new `intent preset` tests FAIL (throws "not implemented"), existing `discovery preset` tests PASS.

- [ ] **Step 3: Implement the intent preset**

Add the intent preset to the `presets` map in `questioner.presets.ts`. The system prompt should instruct the LLM to generate questions that help sharpen the user's intent — clarifying scope, timing, constraints, or specificity. The strategies available are: `refine_intent`, `surface_missing_detail`. The `buildPrompt` function should render the intent payload, optional summary, and user profile into a structured user message.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/protocol && bun test src/questioner/tests/questioner.presets.spec.ts`
Expected: All PASS.

- [ ] **Step 5: Remove the "throws for intent" assertion from the existing test**

Update the `it("throws for an unimplemented mode")` test to only check `profile` and `negotiation`.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/questioner/questioner.presets.ts packages/protocol/src/questioner/tests/questioner.presets.spec.ts
git commit -m "feat(protocol): add intent preset to QuestionerAgent"
```

---

### Task 2: Implement the profile preset

**Files:**
- Modify: `packages/protocol/src/questioner/questioner.presets.ts`
- Test: `packages/protocol/src/questioner/tests/questioner.presets.spec.ts`

- [ ] **Step 1: Write the failing test for the profile preset**

Add to the test file:

```typescript
describe("profile preset", () => {
  it("returns the profile preset with systemPrompt and buildPrompt", () => {
    const preset = getPreset("profile");
    expect(preset).toBeDefined();
    expect(typeof preset.systemPrompt).toBe("string");
    expect(preset.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof preset.buildPrompt).toBe("function");
  });

  it("profile buildPrompt produces a string containing the gaps", () => {
    const preset = getPreset("profile");
    const result = preset.buildPrompt({
      userProfile: { name: "Bob", bio: "Engineer" },
      gaps: ["location", "current project"],
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("location");
    expect(result).toContain("current project");
    expect(result).toContain("Bob");
  });
});
```

- [ ] **Step 2: Run tests to verify the profile test fails**

Run: `cd packages/protocol && bun test src/questioner/tests/questioner.presets.spec.ts`
Expected: Profile tests FAIL, others PASS.

- [ ] **Step 3: Implement the profile preset**

Add the profile preset. The system prompt should instruct the LLM to generate questions that fill gaps in the user's profile — asking about location, skills, interests, current work, or goals. Strategies: `surface_missing_detail`, `refine_intent`. The `buildPrompt` function renders the current profile data and the identified gaps.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/protocol && bun test src/questioner/tests/questioner.presets.spec.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/questioner/questioner.presets.ts packages/protocol/src/questioner/tests/questioner.presets.spec.ts
git commit -m "feat(protocol): add profile preset to QuestionerAgent"
```

---

### Task 3: Implement the negotiation preset

**Files:**
- Modify: `packages/protocol/src/questioner/questioner.presets.ts`
- Test: `packages/protocol/src/questioner/tests/questioner.presets.spec.ts`

- [ ] **Step 1: Write the failing test for the negotiation preset**

Add to the test file:

```typescript
describe("negotiation preset", () => {
  it("returns the negotiation preset with systemPrompt and buildPrompt", () => {
    const preset = getPreset("negotiation");
    expect(preset).toBeDefined();
    expect(typeof preset.systemPrompt).toBe("string");
    expect(preset.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof preset.buildPrompt).toBe("function");
  });

  it("negotiation buildPrompt produces a string containing the stall reason", () => {
    const preset = getPreset("negotiation");
    const result = preset.buildPrompt({
      negotiationId: "neg-1",
      counterpartyHint: "AI infra founder, Berlin",
      indexContext: "AI founders community",
      outcomeReason: "turn_cap",
      keyTake: "Both interested but scope unclear",
      userProfile: { name: "Alice" },
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("turn_cap");
    expect(result).toContain("AI infra founder");
    expect(result).toContain("Alice");
  });
});
```

- [ ] **Step 2: Run tests to verify the negotiation test fails**

Run: `cd packages/protocol && bun test src/questioner/tests/questioner.presets.spec.ts`
Expected: Negotiation tests FAIL, others PASS.

- [ ] **Step 3: Implement the negotiation preset**

Add the negotiation preset. The system prompt should instruct the LLM to generate questions that help the user provide information to unblock a stalled or capped negotiation — clarifying their stance, priorities, or flexibility. Strategies: `refine_intent`, `surface_missing_detail`, `reflective_summary`. The `buildPrompt` function renders the counterparty hint, index context, stall reason, key take, and user profile.

- [ ] **Step 4: Run tests to verify they pass and remove the remaining "throws for unimplemented" test**

Run: `cd packages/protocol && bun test src/questioner/tests/questioner.presets.spec.ts`
Expected: All PASS. Remove the "throws for unimplemented mode" test entirely since all modes are now implemented.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/questioner/questioner.presets.ts packages/protocol/src/questioner/tests/questioner.presets.spec.ts
git commit -m "feat(protocol): add negotiation preset to QuestionerAgent"
```

---

### Task 4: Add attachment points in intent, profile, and negotiation graphs

**Files:**
- Modify: Backend graph invocation sites for intent, profile, and negotiation flows

- [ ] **Step 1: Identify the attachment points**

Find where each graph completes its work:
- **Intent graph**: after intent creation/update (likely in the intent service or the intent graph's terminal node)
- **Profile graph**: after profile enrichment completes
- **Negotiation graph**: after a negotiation stalls or hits a turn cap

- [ ] **Step 2: Add question generation trigger to each attachment point**

At each site, add a gated enqueue call:

```typescript
if (process.env.QUESTIONER_ENABLED === "true" && questionerQueue) {
  await questionerQueue.add({
    mode: "<mode>",
    userId,
    sourceType: "<entity-type>",
    sourceId: "<entity-id>",
    context: { /* mode-specific context built from available data */ },
  });
}
```

The context should be built from the data already available at that point in the graph/service — no new DB queries needed.

- [ ] **Step 3: Verify build**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(backend): attach QuestionerAgent to intent, profile, and negotiation flows"
```

---

### Task 5: Update QuestionerAgent test to accept all modes

**Files:**
- Modify: `packages/protocol/src/questioner/tests/questioner.agent.spec.ts`

- [ ] **Step 1: Remove the "throws for unimplemented mode" test**

Remove the test that asserts `agent.invoke()` throws for `intent` mode, since all modes are now implemented.

- [ ] **Step 2: Add a parameterized test for all modes**

```typescript
it.each(["discovery", "intent", "profile", "negotiation"] as const)("mode '%s' invokes the LLM and returns questions", async (mode) => {
  const agent = makeAgent(async () => ({
    questions: [makeQuestion({ title: "Test" })],
  }));
  // Build a minimal context for each mode
  const contexts = {
    discovery: makeDiscoveryInput().context,
    intent: { intentId: "i-1", payload: "test intent", userProfile: { name: "Test" } },
    profile: { userProfile: { name: "Test" }, gaps: ["location"] },
    negotiation: { negotiationId: "n-1", counterpartyHint: "founder", indexContext: "AI", outcomeReason: "turn_cap" as const, keyTake: "test", userProfile: { name: "Test" } },
  };
  const input: QuestionerInput = {
    mode,
    userId: "user-1",
    sourceType: "test",
    sourceId: "test-1",
    context: contexts[mode],
  };
  const result = await agent.invoke(input);
  expect(result).not.toBeNull();
  expect(result!.questions).toHaveLength(1);
});
```

- [ ] **Step 3: Run tests**

Run: `cd packages/protocol && bun test src/questioner/tests/questioner.agent.spec.ts`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/questioner/tests/questioner.agent.spec.ts
git commit -m "test(protocol): update QuestionerAgent tests to cover all four modes"
```

---

### Task 6: Full verification

**Files:** None (verification only)

- [ ] **Step 1: Type-check both packages**

Run: `cd packages/protocol && npx tsc --noEmit && cd ../../backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run all QuestionerAgent tests**

Run: `cd packages/protocol && bun test src/questioner/`
Expected: All PASS.

- [ ] **Step 3: Run all preset tests**

Run: `cd packages/protocol && bun test src/questioner/tests/questioner.presets.spec.ts`
Expected: All PASS.

- [ ] **Step 4: Run existing question tests for regression**

Run: `cd packages/protocol && bun test src/opportunity/tests/question.generator.spec.ts src/opportunity/tests/question.prompt.spec.ts`
Expected: All existing tests still PASS.
