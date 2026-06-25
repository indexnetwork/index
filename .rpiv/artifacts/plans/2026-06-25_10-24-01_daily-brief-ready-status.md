---
date: 2026-06-25T10:24:01+0300
author: Yanek Yuk
commit: 8304e875a0
branch: dev
repository: index
topic: daily-brief-ready-status
tags:
  - agentvillage
  - daily-brief
  - kanban
status: ready
parent: null
phase_count: 2
phases:
  - { n: 1, title: Runtime staging behavior }
  - { n: 2, title: Operator-facing guidance }
unresolved_phase_count: 0
last_updated: 2026-06-25T10:24:01+0300
last_updated_by: Yanek Yuk
---

# Daily Brief Ready Status Implementation Plan

## Overview

Daily morning brief preparation currently creates an editable Hermes Kanban card and immediately blocks it for manual review. This plan changes that deterministic staging behavior so newly-created daily brief cards are promoted into the send-ready Kanban state on creation, while preserving the existing send gate, idempotency guard, URL/marker validation, and delivery bookkeeping.

The implementation is intentionally narrow: the runtime script replaces the post-create `kanban block` command with a post-create ready promotion, tests assert the ready-promotion command occurs and no block operation occurs, and operator-facing prompt/README text is updated so the cron contract no longer tells the agent or operator to require manual unblocking.

## Requirements

- Newly-created daily brief Kanban cards should no longer be placed in `blocked` status.
- Created daily brief cards should be eligible for automatic send without requiring manual acceptance/unblocking.
- Existing staged cards in protected statuses (`blocked`, `ready`, `todo`, `done`, etc.) must remain untouched on reruns.
- The send pass should keep its current status gate: send only `ready`/`todo`; remain silent for old `blocked` cards.
- Prompt and README guidance must stop describing the old blocked-for-review workflow.
- No database schema, API, or control-plane bulk-send behavior changes.

## Current State Analysis

The prepare script owns mechanical staging. It creates a Kanban card and then blocks it:

- `packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts:319-331` creates `Morning digest — ${date}` and calls `hermes(["kanban", "block", taskId, ...])`.
- `packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts:28-36` already treats `ready`, `todo`, and `blocked` as protected existing digest statuses.
- `packages/edge-city/agentvillage/skills/index-network/scripts/send-daily-brief.ts:205-210` already sends only `ready`/`todo` and returns `not-approved:blocked` for old blocked cards.
- `packages/edge-city/agentvillage/skills/index-network/scripts/tests/stage-daily-brief.test.ts:121-162` currently asserts the `kanban block` call.
- `packages/edge-city/agentvillage/skills/index-network/scripts/tests/stage-daily-brief-idempotent.test.ts:45-63` asserts existing `blocked`, `ready`, `todo`, and `done` cards are not recreated or re-blocked.
- `packages/edge-city/agentvillage/skills/edge-esmeralda/prompts/prepare.md:111-124` and `packages/edge-city/agentvillage/README.md:252` still document the blocked/manual-unblock workflow.

### Key Discoveries

- The behavior change lives in the deterministic script, not in the LLM prompt: `prepare.md:103-112` calls `stage-daily-brief.ts --body-stdin`, and the script performs the Kanban operation.
- The send pass does not need to be broadened: it already accepts `ready` or `todo` and rejects everything else at `send-daily-brief.ts:208-210`.
- The idempotency guard already includes both legacy `blocked` and desired `ready` states at `stage-daily-brief.ts:28-36`, so old manually-blocked cards can stay protected.
- Control-plane bulk send targets `ready` cards at `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:932-960`; no change is needed because the send gate remains `ready`-based.

## Desired End State

A new daily brief staging run creates exactly one Kanban card and records it in heartbeat state without issuing a block command:

```ts
const createOutput = await hermes([
  "kanban",
  "create",
  `Morning digest — ${date}`,
  "--body",
  sanitizedBody,
  "--idempotency-key",
  `digest-${date}`,
  "--json",
]);
const taskId = extractTaskId(createOutput);
await hermes(["kanban", "promote", taskId, `ready-for-send: morning brief — ${date}`]);
const promotedTask = parseTask(await hermes(["kanban", "show", taskId, "--json"]));
const promotedStatus = String(promotedTask?.status ?? "").toLowerCase();
if (promotedStatus !== "ready" && promotedStatus !== "todo") {
  throw new Error(`daily brief card was not promoted to a sendable status: ${promotedStatus || "unknown"}`);
}

const state = await readJsonObject(stateFile);
state.prepared = { date, taskId, taskTitle: `Morning digest — ${date}`, opportunityIds, questionIds };
```

The existing send script then sees a `ready`/`todo` task and delivers it automatically; legacy blocked cards still stay silent until someone unblocks them.

## What We're NOT Doing

- Not changing the Hermes Kanban API or adding a new Kanban adapter.
- Not changing `send-daily-brief.ts` status gating or delivery bookkeeping.
- Not changing control-plane bulk send/unblock/archive endpoints.
- Not migrating or mutating existing blocked cards; existing protected cards remain protected by the current idempotency guard.
- Not changing daily brief content generation, URL validation, marker validation, ledger confirmation, or cooldown behavior.

## Decisions

### Decision 1: Change the deterministic staging script, not prompt-side Kanban instructions

The prepare prompt delegates staging to `stage-daily-brief.ts --body-stdin` (`prepare.md:103-112`), and the script performs the `kanban create` followed by `kanban block` (`stage-daily-brief.ts:319-331`). Therefore the implementation replaces the block command in the script with a deterministic ready promotion, rather than adding prompt instructions to move a card after staging. This mirrors the existing landing-admin “Unblock all” direction: the dashboard triggers unblock (`agentvillage-landing/app/admin/kanbans/page.tsx:330-356`), and the control-plane patches digest cards to `{ status: 'ready' }` (`agentvillage-controlplane/control-plane/src/tenants.js:967-1003`).

### Decision 2: Preserve the send gate

`send-daily-brief.ts:208-210` already sends only `ready`/`todo` and stays silent for `blocked`/unknown statuses. Keeping this gate preserves protection for legacy blocked cards while allowing newly-created non-blocked cards to flow through automatically.

### Decision 3: Preserve existing-card protection for legacy blocked cards

`PROTECTED_DIGEST_STATUSES` includes `blocked`, `ready`, `todo`, `done`, and related active/completed statuses (`stage-daily-brief.ts:28-36`). The plan keeps that set intact so reruns do not recreate or mutate an existing blocked card.

### Decision 4: Update prompt and README wording with the runtime behavior

The prepare prompt and AgentVillage README explicitly describe blocked/manual-unblock staging (`prepare.md:111-124`, `README.md:252`). Leaving these stale would reintroduce operational confusion, so the plan updates wording after the runtime change.

## Phase 1: Runtime staging behavior

### Overview

Update the deterministic staging runtime and tests so a newly-created brief is promoted into the ready state instead of blocked. Depends on no prior phase; Phase 2 depends on this behavior.

### Changes Required:

#### 1. packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts:1-331

**File**: `packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts`
**Changes**: MODIFY — remove the create/block wording and replace the post-create `kanban block` command with `kanban promote` so created cards are explicitly send-ready.

```ts
/**
 * Deterministic guardrails for prompt-led daily brief preparation.
 *
 * This script deliberately does not compose the user-facing brief. The prepare
 * prompt owns wholesale synthesis from deterministic JSON context. This module
 * owns the mechanical pieces around that creative step: context collection,
 * idempotency, URL sanitization, marker validation, Kanban create, and
 * heartbeat bookkeeping.
 */

  const createOutput = await hermes([
    "kanban",
    "create",
    `Morning digest — ${date}`,
    "--body",
    sanitizedBody,
    "--idempotency-key",
    `digest-${date}`,
    "--json",
  ]);
  const taskId = extractTaskId(createOutput);

  await hermes(["kanban", "promote", taskId, `ready-for-send: morning brief — ${date}`]);
  const promotedTask = parseTask(await hermes(["kanban", "show", taskId, "--json"]));
  const promotedStatus = String(promotedTask?.status ?? "").toLowerCase();
  if (promotedStatus !== "ready" && promotedStatus !== "todo") {
    throw new Error(`daily brief card was not promoted to a sendable status: ${promotedStatus || "unknown"}`);
  }

  const state = await readJsonObject(stateFile);
```

#### 2. packages/edge-city/agentvillage/skills/index-network/scripts/tests/stage-daily-brief.test.ts:121-166

**File**: `packages/edge-city/agentvillage/skills/index-network/scripts/tests/stage-daily-brief.test.ts`
**Changes**: MODIFY — assert staging creates the card, promotes it to ready, and never calls `kanban block`.

```ts
  test("stages a prompt-authored stdin body without requiring a body file", async () => {
    const dir = makeTmp();
    const stateFile = join(dir, "heartbeat-state.json");
    const contextOut = join(dir, "daily-brief-context.json");
    await writeJson(stateFile, {});
    await writeJson(contextOut, baseContext);
    const body = [
      "Good morning from Edge Esmeralda.",
      "",
      "Creative AI Crit makes today less about tools in general and more about whether your memory work reads as product taste or infrastructure.",
      "",
      "<!-- digest-question:id=daily-identity-2026-06-15 -->**One for you:** Which part of that read feels most like you, and which part should I stop carrying forward?",
    ].join("\n");

    const calls: string[][] = [];
    const hermes = async (args: string[]): Promise<string> => {
      calls.push(args);
      if (args[0] === "kanban" && args[1] === "create") return JSON.stringify({ task: { id: "t_stdin" } });
      if (args[0] === "kanban" && args[1] === "promote") return "promoted";
      if (args[0] === "kanban" && args[1] === "show") return JSON.stringify({ task: { id: "t_stdin", status: "ready" } });
      return "{}";
    };

    const result = await stageDailyBrief({ date: TODAY, stateFile, contextOut, body, hermes });

    expect(result.taskId).toBe("t_stdin");
    expect(result.questionIds).toEqual(["daily-identity-2026-06-15"]);
    expect(calls[0]?.[4]).toBe(result.body);
    expect(calls[1]).toEqual(["kanban", "promote", "t_stdin", `ready-for-send: morning brief — ${TODAY}`]);
    expect(calls[2]).toEqual(["kanban", "show", "t_stdin", "--json"]);
    expect(calls.some((c) => c[0] === "kanban" && c[1] === "block")).toBe(false);
  });

  test("stages a prompt-authored body file, validates markers, leaves it send-ready, and records ids", async () => {
    const dir = makeTmp();
    const stateFile = join(dir, "heartbeat-state.json");
    const contextOut = join(dir, "daily-brief-context.json");
    const bodyFile = join(dir, "brief.md");
    await writeJson(stateFile, {});
    await writeJson(contextOut, baseContext);
    await Bun.write(bodyFile, [
      "Good morning from Edge Esmeralda.",
      "",
      "Creative AI Crit looks like the main test of the day: whether your work is best understood as memory infrastructure or as curation with product taste.",
      "",
      "<!-- digest-opportunity:id=opp-1 -->[Maya](https://index.network/u/11111111-1111-1111-1111-111111111111) is nearby enough to that thread to be worth a light hello. [Say hi](https://protocol.index.network/c/abc123).",
      "",
      "This is a provisional read; correct the part that is off.",
      "",
      "<!-- digest-question:id=q-1 -->**One for you:** What would be a sharper way to say what you want people here to understand about your work?",
    ].join("\n"));

    const calls: string[][] = [];
    const hermes = async (args: string[]): Promise<string> => {
      calls.push(args);
      if (args[0] === "kanban" && args[1] === "create") return JSON.stringify({ task: { id: "t_new" } });
      if (args[0] === "kanban" && args[1] === "promote") return "promoted";
      if (args[0] === "kanban" && args[1] === "show") return JSON.stringify({ task: { id: "t_new", status: "ready" } });
      return "{}";
    };

    const result = await stageDailyBrief({ date: TODAY, stateFile, contextOut, bodyFile, hermes });

    expect(result.taskId).toBe("t_new");
    expect(result.opportunityIds).toEqual(["opp-1"]);
    expect(result.questionIds).toEqual(["q-1"]);
    expect(calls).toEqual([
      [
        "kanban",
        "create",
        `Morning digest — ${TODAY}`,
        "--body",
        result.body,
        "--idempotency-key",
        `digest-${TODAY}`,
        "--json",
      ],
      ["kanban", "promote", "t_new", `ready-for-send: morning brief — ${TODAY}`],
      ["kanban", "show", "t_new", "--json"],
    ]);
    expect(calls.some((c) => c[0] === "kanban" && c[1] === "block")).toBe(false);

    const state = JSON.parse(await Bun.file(stateFile).text()) as { prepared: Record<string, unknown> };
    expect(state.prepared).toMatchObject({
      date: TODAY,
      taskId: "t_new",
      opportunityIds: ["opp-1"],
      questionIds: ["q-1"],
    });
  });

  test("rejects a newly-created card that cannot be promoted to a sendable status", async () => {
    const dir = makeTmp();
    const stateFile = join(dir, "heartbeat-state.json");
    const contextOut = join(dir, "daily-brief-context.json");
    await writeJson(stateFile, {});
    await writeJson(contextOut, baseContext);
    const body = "<!-- digest-question:id=daily-identity-2026-06-15 -->**One for you:** Which part of this thread feels most like you?";

    const calls: string[][] = [];
    const hermes = async (args: string[]): Promise<string> => {
      calls.push(args);
      if (args[0] === "kanban" && args[1] === "create") return JSON.stringify({ task: { id: "t_blocked" } });
      if (args[0] === "kanban" && args[1] === "promote") return "promoted";
      if (args[0] === "kanban" && args[1] === "show") return JSON.stringify({ task: { id: "t_blocked", status: "blocked" } });
      return "{}";
    };

    await expect(stageDailyBrief({ date: TODAY, stateFile, contextOut, body, hermes }))
      .rejects
      .toThrow("not promoted to a sendable status: blocked");
    expect(calls).toEqual([
      [
        "kanban",
        "create",
        `Morning digest — ${TODAY}`,
        "--body",
        body,
        "--idempotency-key",
        `digest-${TODAY}`,
        "--json",
      ],
      ["kanban", "promote", "t_blocked", `ready-for-send: morning brief — ${TODAY}`],
      ["kanban", "show", "t_blocked", "--json"],
    ]);
    expect(JSON.parse(await Bun.file(stateFile).text()).prepared).toBeUndefined();
  });

  // Update the hermes mock in "sanitizes fabricated markdown and bare URLs before staging":
  const hermes = async (args: string[]): Promise<string> => {
    if (args[0] === "kanban" && args[1] === "create") return JSON.stringify({ task: { id: "t_new" } });
    if (args[0] === "kanban" && args[1] === "promote") return "promoted";
    if (args[0] === "kanban" && args[1] === "show") return JSON.stringify({ task: { id: "t_new", status: "ready" } });
    return "{}";
  };

  // Update the hermes mock in "resolves defaults and relative body files under HERMES_HOME, not cwd":
  hermes: async (args) => {
    if (args[0] === "kanban" && args[1] === "create") return JSON.stringify({ task: { id: "t_home" } });
    if (args[0] === "kanban" && args[1] === "promote") return "promoted";
    if (args[0] === "kanban" && args[1] === "show") return JSON.stringify({ task: { id: "t_home", status: "ready" } });
    return "{}";
  },
```

#### 3. packages/edge-city/agentvillage/skills/index-network/scripts/tests/stage-daily-brief-idempotent.test.ts:29-63

**File**: `packages/edge-city/agentvillage/skills/index-network/scripts/tests/stage-daily-brief-idempotent.test.ts`
**Changes**: MODIFY — clarify the idempotency guard comment while preserving legacy blocked/ready protection assertions.

```ts
/**
 * Records every Hermes invocation and replies to `kanban show` with a card in
 * the given status. Any `create`, `promote`, or other status-mutating call is a
 * guard failure — a re-run of prepare must never reach them when a protected card already exists.
 */
function fakeHermes(status: string, body = "EXISTING BODY") {
  const calls: string[][] = [];
  const runner = async (args: string[]): Promise<string> => {
    calls.push(args);
    if (args[0] === "kanban" && args[1] === "show") {
      return JSON.stringify({ task: { id: "t_existing", status, body } });
    }
    return "{}";
  };
  return { calls, runner };
}

      // The guard must NOT recreate or mutate the card's status.
      expect(calls.some((c) => c[1] === "create")).toBe(false);
      expect(calls.some((c) => c[1] === "promote")).toBe(false);
      expect(calls.some((c) => c[1] === "block")).toBe(false);
```

### Success Criteria:

#### Automated Verification:
- [x] Targeted staging tests pass: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/stage-daily-brief.test.ts skills/index-network/scripts/tests/stage-daily-brief-idempotent.test.ts`.
- [x] Send gate regression still passes: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/send-daily-brief.test.ts`.
- [x] No post-create block call remains in the staging script: `rg -n "kanban.*block|create/block" packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts` returns no matches.
- [x] The staging script explicitly promotes and verifies the created card is sendable: `rg -n "kanban.*promote|ready-for-send|not promoted to a sendable status|promotedStatus" packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts` returns matches for the promote call and status guard.

#### Manual Verification:
- [ ] Review `stage-daily-brief.ts` and confirm the script still creates the Kanban card, extracts its id, promotes it to ready, verifies the shown status is `ready`/`todo`, records `state.prepared`, and returns the same `StageResult` shape.
- [ ] Review idempotency tests and confirm existing `blocked`, `ready`, `todo`, and `done` cards remain protected on rerun.

## Phase 2: Operator-facing guidance

### Overview

Update the cron prompt and installer README so operator-facing text matches the new auto-ready staging flow. Depends on Phase 1; no later phases.

### Changes Required:

#### 1. packages/edge-city/agentvillage/skills/edge-esmeralda/prompts/prepare.md:1-124

**File**: `packages/edge-city/agentvillage/skills/edge-esmeralda/prompts/prepare.md`
**Changes**: MODIFY — replace blocked/manual-review wording with ready-for-send staging wording while keeping staging-only and no-delivery constraints.

```md
You are Edge, the user's agent for Edge Esmeralda. This prepares the 08:00 morning brief by collecting deterministic context, composing one integrated note, and staging it on the Hermes Kanban board for the send pass. You deliver NOTHING here — staging only.

   The quoted heredoc keeps markdown intact without creating a persistent draft file. The script reads stdin, validates markers against the context, strips unsafe URLs, creates the Kanban task with argv-safe `--body`, leaves it eligible for the scheduled send pass, and records `prepared.taskId`, delivered opportunity ids, and delivered question ids in `memory/heartbeat-state.json`.

- Never create, block, unblock, or otherwise mutate the Kanban card manually; `stage-daily-brief.ts --body-stdin` is the cron staging path.
- Do not write the composed body into `memory/`; it is not memory and must not become future source context.
- Stage the brief for automatic delivery by the send pass. Do not block it for review, assign it, or manually move it between statuses in this prepare pass.
```

#### 2. packages/edge-city/agentvillage/skills/edge-esmeralda/prompts/send.md:31-35

**File**: `packages/edge-city/agentvillage/skills/edge-esmeralda/prompts/send.md`
**Changes**: MODIFY — describe the ready/todo gate as the automatic send gate and keep legacy blocked behavior silent.

```md
# Hard rules
- The Kanban task body is the source of truth. Never regenerate the brief in this send pass.
- Never reimplement the send flow in generated code. Always call `bun skills/index-network/scripts/send-daily-brief.ts` exactly once.
- One attempt at the send script. If it fails, end immediately with `[SILENT]` — no retries, no diagnosis, no alternative paths.
- Deliver only a staged brief whose Kanban status is `ready` or `todo`, depending on Hermes version. A legacy still-`blocked` task means no send — stay silent until an operator edits, unblocks, or archives it out-of-band.
```

#### 3. packages/edge-city/agentvillage/README.md:10-12,252

**File**: `packages/edge-city/agentvillage/README.md`
**Changes**: MODIFY — update the README capability summary and installer cron description to remove manual unblocking as the normal workflow.

```md
- **Prepares a morning brief for 08:00 host-local time** with admin-set village announcements, today's EdgeOS calendar highlights, the connections worth your attention, and the asks where you can help. Each night's brief is staged as an editable, send-ready Kanban card; it is delivered at 08:00 when the card remains in a sendable status (`ready` or `todo`).

7. Installs the Index cron jobs: a memory signal sync (`0 1 * * *`), a prepare pass (`0 2 * * *`) that composes the morning brief and stages it as an editable, send-ready Kanban task, and a send pass (`0 8 * * *`) that delivers the staged brief when its Kanban status is `ready` or `todo`. (The 30-minute `Edge — heartbeat` cron was retired — see the note under "Overriding the Index cron times" — and is removed from existing tenants on update.) The prepare pass no longer blocks new briefs for manual approval; operators can still edit, archive, or otherwise change the Kanban task before the send pass if a brief should not ship. The end user can't change the schedule from chat, but the installer can override the cron times via `--digest-signals-cron` / `--digest-prepare-cron` / `--digest-send-cron` (or `DIGEST_SIGNALS_CRON` / `DIGEST_PREPARE_CRON` / `DIGEST_SEND_CRON`) — see "Overriding the Index cron times" above.
```

### Success Criteria:

#### Automated Verification:
- [x] Stale blocked-review instructions are gone from daily brief prompt/README text: `rg -n "held for review|blocks it for review|Always stage the brief \*\*blocked\*\*|Never assign it or move it to Ready|human has approved by unblocking|stages each brief as a \*\*blocked\*\*|operator approves it by unblocking" packages/edge-city/agentvillage/skills/edge-esmeralda/prompts packages/edge-city/agentvillage/README.md` returns no matches.
- [x] Runtime staging and send regressions still pass after wording changes: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/stage-daily-brief.test.ts skills/index-network/scripts/tests/stage-daily-brief-idempotent.test.ts skills/index-network/scripts/tests/send-daily-brief.test.ts`.

#### Manual Verification:
- [x] Review `prepare.md` and confirm it still requires exactly one context build, one staging script call, no manual Kanban operations, no delivery, and no durable draft body.
- [x] Review `send.md` and confirm legacy blocked cards remain silent while `ready`/`todo` cards remain deliverable.
- [x] Review `README.md` and confirm it documents auto-ready staging without implying the end user can change cron schedules from chat.

## Ordering Constraints

- Phase 1 must land before Phase 2 because the prompts/README should document behavior implemented by the runtime script.
- No phases can run in parallel: Phase 2's wording depends on the exact Phase 1 behavior.
- There are no schema migrations or cross-package version bumps in this plan artifact; implementation may handle packaging/versioning if the branch touches published packages.

## Verification Notes

- Run the targeted staging tests: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/stage-daily-brief.test.ts skills/index-network/scripts/tests/stage-daily-brief-idempotent.test.ts`.
- Run the send gate regression: `cd packages/edge-city/agentvillage && bun test skills/index-network/scripts/tests/send-daily-brief.test.ts` to confirm blocked cards still remain silent and ready cards still send.
- Grep for stale blocked-review instructions: `rg -n "blocked|unblock|blocks it for review|Never assign it or move it to Ready" packages/edge-city/agentvillage/skills/edge-esmeralda/prompts packages/edge-city/agentvillage/README.md` and inspect that remaining matches describe legacy blocked behavior only.
- Verify no `kanban block` call remains in the staging script: `rg -n "kanban.*block|blocks it for review|create/block" packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts`.

## Performance Considerations

- The prepare pass replaces the old `kanban block` mutation with `kanban promote` plus one `kanban show` verification call. This is a small constant amount of extra local Hermes/Kanban work and is acceptable for a once-daily per-tenant cron.
- No cron fan-out, database queries, N+1 risks, or control-plane dispatch changes are introduced.
- Send pacing and fleet bulk-send behavior remain unchanged.

## Migration Notes

No schema or data migration is required. Existing blocked daily brief cards remain protected by the idempotency guard and will continue to be silent in the send pass until manually unblocked or archived. New cards created after Phase 1 will not be blocked by the staging script.

## Pattern References

- `packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts:319-331` — current deterministic Kanban staging command sequence.
- `packages/edge-city/agentvillage/skills/index-network/scripts/send-daily-brief.ts:205-210` — existing ready/todo approval gate to preserve.
- `packages/edge-city/agentvillage/skills/index-network/scripts/tests/stage-daily-brief.test.ts:121-162` — primary runtime regression test to update.
- `packages/edge-city/agentvillage/skills/index-network/scripts/tests/stage-daily-brief-idempotent.test.ts:45-63` — existing protected-status idempotency pattern.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:932-960` — fleet bulk-send selector already targets `ready` cards.
- `packages/edge-city/agentvillage-landing/app/admin/kanbans/page.tsx:330-356` routes “Unblock all” to `/api/admin/kanbans/unblock-today`, and `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:967-1003` implements that by patching blocked digest cards to `{ status: 'ready' }`.

## Developer Context

- Initial request: "We are currently setting daily briefs as `blocked`, so I need to manually accept them in order for them to be sent automatically. Let's not do that, upon creation, they can be placed on `ready` instead".
- Design checkpoint: asked whether to proceed with changing `stage-daily-brief.ts:319-331`, preserving `send-daily-brief.ts:205-210`, and updating stale prompt/README text at `prepare.md:111-124` and `README.md:252`. Answer: Proceed.
- Decomposition checkpoint: asked whether to use two slices: runtime staging behavior, then operator-facing guidance. Answer: Approve.
- Step 9 reviewer triage: artifact-code-reviewer raised that removing `kanban block` did not prove new cards become `ready`/`todo` for the send gate. Developer selected Apply, then corrected the design to check the landing admin “Unblock all” behavior. Evidence: `packages/edge-city/agentvillage-landing/app/admin/kanbans/page.tsx:330-356` routes the bulk action, and `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:967-1003` patches blocked cards to `{ status: 'ready' }`. Phase 1 was revised to create then `kanban promote` the task to ready.

## Plan History

- Phase 1: Runtime staging behavior — revised after Step 8 concern: create, promote the card to ready, and verify via `kanban show`; tests assert `kanban promote`, `kanban show`, and no `kanban block`
- Phase 2: Operator-facing guidance — approved as generated

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 1 §2 (stage-daily-brief.test.ts) | packages/edge-city/agentvillage/skills/index-network/scripts/send-daily-brief.ts:209 | concern | code-quality | The updated staging tests only assert that `kanban block` is absent; they never verify the created card enters a `ready`/`todo` status accepted by the unchanged send gate. | Add a regression that stages a card and verifies the resulting Kanban status is `ready` or `todo`, or explicitly set the status during creation if Hermes does not guarantee that default. | applied: Phase 1 now creates, `kanban promote`s, `kanban show`s, throws unless status is `ready`/`todo`, and tests both ready success and blocked failure. |

## References

- User-provided free-text request in this session.
- Codebase pattern-finder result: daily brief staging currently blocks at `stage-daily-brief.ts:318-337`; send path already treats `ready`/`todo` as deliverable.
- Integration scanner result: prepare prompt invokes staging script, send prompt invokes send script, control-plane bulk send targets ready cards.
