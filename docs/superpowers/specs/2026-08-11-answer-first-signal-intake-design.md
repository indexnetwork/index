# Answer-First Signal Intake Follow-Ups

**Date:** 2026-08-11
**Status:** Approved design

## Problem

Fast signal intake currently generates live follow-up questions from two inputs:

1. a cached per-user brief derived from active premises, global user context, and community memberships; and
2. the intake rounds the user has answered.

The planner is told to ground follow-up options in both. It has no structural distinction between options grounded in the current interview and options personalized from the profile brief. As a result, a strong profile theme can dominate a newly stated intent.

For example, when a technology-focused user says they want to meet “scuba divers,” the next question may offer “underwater tech,” “marine AI/ML,” and “digital media underwater.” Those are coherent intersections, but they collapse the option set around the user’s existing technology identity instead of first exploring what they mean by meeting scuba divers.

## Goal

Make live fast-intake follow-ups **answer-first**:

- the current intake answers determine what the next question asks;
- at least two selectable options come directly from those answers;
- profile premises may contribute at most one optional bridge option; and
- personalization is omitted when it does not produce a natural intersection.

The design preserves useful personalization without allowing premises to reinterpret or narrow a new intent.

## Non-goals

- Changing the precomputed opening intake question.
- Removing premises, global context, or memberships from intake pack generation.
- Changing the public question payload consumed by Mac or web clients.
- Changing intake persistence, caching, controllers, database schemas, proposal synthesis, or confirmation.
- Selecting one universal follow-up dimension for every broad answer. The planner may choose among bounded missing axes based on the current answers.

## Current Flow

1. `SignalIntakePackGenerator` builds and caches a brief and opening question from active premises, global context, and network titles.
2. The user answers the opening question.
3. `SignalIntakeService.followUpQuestions` passes the cached brief and ordered answered rounds to `SignalIntakeOrchestrator.generateFollowUps`.
4. One structured model call chooses the follow-up question and returns an ordinary list of options.
5. The question is normalized and returned unchanged to Mac or web.

The failure occurs at step 4: the planner sees both evidence sources but the output contract does not preserve their priority or provenance. Live evaluation additionally proved that a one-call schema with separate option fields is insufficient: the model can still misclassify profile-derived ideas as answer-grounded.

## Design

### 1. Evidence isolation

Use two sequential structured model stages instead of asking one model call to self-classify provenance:

1. **Core generation receives answered rounds only**
   - Determines the missing axis.
   - Writes a standalone, domain-naming question prompt.
   - Produces two or three concrete answer-grounded options.
   - Cannot be contaminated by profile context because the profile brief is absent from this call.

2. **Bridge generation receives the immutable core output plus the profile brief**
   - May append one optional profile bridge after the core options.
   - Cannot rewrite, replace, remove, or reclassify core options.
   - Returns null when the intersection is forced or redundant.

This boundary makes answer-first behavior structural rather than dependent on the model honestly labeling its own profile-derived ideas.

### 2. Bounded missing axes

The planner chooses the next useful missing dimension from a small internal set:

- `purpose`: what the user wants to do or achieve through the connection;
- `desired_attributes`: which kind of counterpart would be useful;
- `exchange`: what the user brings and what gap the counterpart should fill; or
- `constraint`: timing, location, format, availability, or another practical bound.

The planner must not re-ask a dimension already answered. No single axis is mandatory for every broad answer; the current rounds determine which missing axis is most useful.

### 3. Internal structured output

Replace the planner’s undifferentiated question options with separate internal core and bridge contracts shaped conceptually as:

```ts
interface AnswerFirstCoreQuestion {
  missingAxis: "purpose" | "desired_attributes" | "exchange" | "constraint";
  title: string;
  prompt: string;
  answerGroundedOptions: Array<{
    label: string;
    description: string;
  }>;
  multiSelect: boolean;
}

interface AnswerFirstFollowUpPlan {
  questions: AnswerFirstCoreQuestion[];
  plannedFollowUpCount: number;
}

interface ProfileBridgeDecision {
  questionIndex: number;
  profileBridgeOption: {
    label: string;
    description: string;
  } | null;
}
```

The plan wrapper preserves the existing singular/plural question batching and locked `plannedFollowUpCount` behavior. The bridge stage returns at most one indexed decision per immutable core question. Neither internal contract changes the public `IntakePackQuestion` type.

### 4. Assembly and validation

Normalization converts each valid internal candidate into the existing public question shape.

Rules:

- Require at least two usable `answerGroundedOptions`.
- Permit at most three answer-grounded options.
- Permit zero or one `profileBridgeOption`.
- Put all answer-grounded options before the profile bridge.
- Trim and deduplicate labels.
- Cap the final list at four options.
- Do not force a profile bridge merely to fill the list.

“Require at least two” applies to generated selectable options, not to the user’s answer. If the model returns fewer than two usable answer-grounded choices, the generated candidate is invalid and is not shown.

The deterministic validator enforces the core-option quota and appends only the bridge stage's indexed option. Because core generation never receives the profile, it no longer relies on model-authored provenance labels.

If core generation or normalization fails, serve the existing neutral `FALLBACK_BRING_QUESTION`. If optional bridge generation fails, preserve and return the valid core questions without personalization.

### 5. Public compatibility

After normalization, the returned value remains:

```ts
interface IntakePackQuestion {
  title: string;
  prompt: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}
```

No Mac, web, controller, persistence, or database changes are required. Grounding categories and `missingAxis` are internal and are removed before returning the question.

## Example

Given:

- profile brief: technology founder working with AI and digital media;
- opening answer: “scuba divers.”

A valid follow-up could be:

> **What would make meeting scuba divers valuable to you?**
>
> - Find local dive buddies
> - Learn from experienced divers
> - Explore marine conservation
> - Discuss underwater technology

The first three choices are answer-grounded. The final choice is an optional profile bridge.

An invalid result would contain one direct option followed by several technology-derived options:

- Find dive buddies
- Marine AI/ML
- Underwater technology
- Underwater digital media

That candidate is discarded because it contains fewer than two answer-grounded options.

## Failure Handling

- **Core structured-model error:** return the existing neutral fallback.
- **Fewer than two answer-grounded options:** discard the candidate and return the fallback.
- **Duplicate option labels:** deduplicate; if fewer than two answer-grounded options remain, return the fallback.
- **Bridge structured-model error:** return the valid core questions without a bridge.
- **Duplicate or out-of-range bridge decision:** accept at most the first valid decision for each existing question index.
- **No natural profile intersection:** return only answer-grounded options.
- **Client behavior:** unchanged; clients continue to offer free text in addition to generated options.

## Testing

### Provider-free unit tests

Add or update tests around `SignalIntakeOrchestrator.generateFollowUps` to prove:

1. the core planner prompt contains the answered rounds and no profile brief;
2. bridge generation receives the profile brief and immutable core questions;
3. two or three answer-grounded options normalize successfully;
4. a profile bridge is optional;
5. no more than one profile bridge reaches the public payload;
6. answer-grounded options always precede the profile bridge;
7. duplicate labels are removed;
8. fewer than two usable answer-grounded options returns `FALLBACK_BRING_QUESTION`;
9. a bridge-model failure preserves valid core questions;
10. the public `IntakePackQuestion` shape remains unchanged.

### Live semantic intake harness

Add `eval/intake`, a live harness that runs the real two-stage planner and an independent semantic judge, with provider-free corpus/runner/scorer tests gated by `eval:verify`. Cover:

- **Unrelated profile:** scuba divers plus a technology-heavy profile. Most options must explore diving-related purposes or counterpart types; no more than one option may bridge to technology.
- **Unrelated profile:** a running club plus an investor profile. Investment themes must not dominate.
- **Relevant profile:** climate founders plus an existing climate premise. One profile bridge is allowed when it naturally follows the answer.
- **No useful bridge:** profile context has no meaningful connection to the stated intent. The planner should emit `profileBridgeOption: null`.

The semantic success criterion is that premises enrich rather than dominate: unrelated premises never control the question or option set, while a genuinely useful intersection can remain as one optional path.

## Rollout and Observability

This change remains behind the existing `FAST_SIGNAL_INTAKE` gate. No new feature flag is needed.

The initial change does not alter service telemetry. It must not log the user’s premises, answers, brief, prompts, or option text. A future need to distinguish validation fallback reasons should use content-free metadata and is outside this implementation scope.

## Files Expected to Change During Implementation

- `packages/protocol/src/signals/application/intake.orchestrator.ts`
- `packages/protocol/src/signals/application/tests/intake.orchestrator.spec.ts`
- `packages/protocol/eval/intake/**`
- `packages/protocol/eval/verify.ts`
- `packages/protocol/eval/README.md`
- `packages/protocol/package.json`
- `packages/protocol/CHANGELOG.md`

No changes are expected in Mac, web, service controllers, database adapters, or database schemas.
