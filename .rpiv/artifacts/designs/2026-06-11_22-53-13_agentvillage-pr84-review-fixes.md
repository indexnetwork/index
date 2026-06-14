---
date: 2026-06-11T22:53:13+0300
author: Yankı Ekin Yüksel
commit: 1d1c539839
branch: dev
repository: index
topic: "AgentVillage PR #84 review fixes — daily-brief question delivery loop"
tags: [design, agentvillage, daily-brief, mcp, digest, code-review-fixes]
status: ready
parent: .rpiv/artifacts/reviews/2026-06-11_22-39-39_agentvillage-pr-84.md
last_updated: 2026-06-11T22:53:13+0300
last_updated_by: Yankı Ekin Yüksel
---

# Design: AgentVillage PR #84 Review Fixes — Question Delivery Loop & Fetcher Hardening

## Summary

Address the 4 important findings (I1, I2, Q2, Q4) and 2 suggestions (Q1, S1) from the code review of Edge-City/agentvillage PR #84 (daily-brief question injection). The chosen architecture mirrors the existing opportunity delivery loop for questions: a `digest-question:id=…` marker embedded at stage time, extracted at send time, recorded in `memory/heartbeat-state.json` under a new cross-day `questionDelivery` key with a 3-day re-delivery cooldown — plus fetcher hardening (`success:false` detection, error-reason threading, prompt sanitization) and prompt-contract documentation.

All changes live in the agentvillage repo (submodule `packages/edge-city/agentvillage`, branch `feat/agentvillage-brief-questions`, on top of `78215c6`). No Index-side changes.

## Requirements

From the review's Recommendation table:

- **I1**: Add question-id delivery bookkeeping (marker + state entry) mirroring the opportunity loop — same question must not be re-staged verbatim every day
- **Q2**: Treat `parsed.success === false` as `source: "unavailable"` with a warning — never mask a failed MCP payload as a successful empty fetch
- **I2**: Reconcile the "One for you" postscript with prepare.md's pointer-only fallback contract
- **Q4**: Add populated-questions `buildDailyBriefContext` end-to-end test asserting `questions` + `questionSource` wiring
- **Q1** (suggestion): Thread failure reason into the `questions MCP unavailable` warning
- **S1** (suggestion): Sanitize MCP-sourced `prompt` before interpolation (length cap, strip markdown-structural sequences)

## Current State Analysis

PR #84 (`ded6332` + `78215c6`) added `fetchPendingQuestionsFromMcp` to `build-daily-brief-context.ts` and a "**One for you:**" postscript to `composeDailyBrief` in `stage-daily-brief.ts`. The review found the question path lacks every piece of the delivery bookkeeping the opportunity path has.

### Key Discoveries

- `read_pending_questions` exists only on the unmerged index branch `feat/agentvillage-brief-questions` (`packages/protocol/src/questioner/questioner.tools.ts`, protocol 3.3.1). **No `confirm_question_delivery` MCP tool exists** — Index-side delivery confirmation is impossible without cross-repo work (deferred).
- A question stays `pending` on Index until answered (`deps.findPendingQuestions(context.userId)` — no delivery state server-side), so the digest re-fetches it every day.
- `deliveredToday` state is same-day-only: `readDeliveredIds` (`build-daily-brief-context.ts:419-430`) returns ids only when `parsed.deliveredToday.date === date`. It cannot carry question dedup across days — a new cross-day state key is required.
- `stripDigestMetadata` (`validate-digest-urls.ts:115-117`) strips **only** the `digest-opportunity` marker regex. A new `digest-question` marker would leak into the delivered Telegram message unless the strip path is extended.
- The PR fetches with `limit: 1` (`build-daily-brief-context.ts:718`) — once cooldown filtering exists, the single fetched question being in cooldown would starve the section even when other pending questions exist. The fetch limit must rise (tool caps at 10; we use 5).
- The post-sign-off `---` postscript placement was deliberate per the original implementation plan (index commit `eebb8135c4` shows the exact exemplar) — the gap is contract documentation, not placement.
- The original FRD (index commit `7eae10d7a9`) required dedup state in `memory/heartbeat-state.json` under a `briefQuestions` key; the requirement was dropped when the implementation switched from LLM-generated to MCP-fetched questions. I1 restores the FRD's intent.
- `heartbeat.md:48` establishes the state-file convention: read the whole object, add to it, write it back, preserve every other key (`prepared`, `deliveredToday`, `signalElicitation`).
- Existing patterns to mirror: `opportunityMarker` (`stage-daily-brief.ts:48-50`), marker extraction + `deliveredToday` recording in `sendDailyBrief` (`send-daily-brief.ts:145-153`), `extractDigestOpportunityIds`/`DIGEST_OPPORTUNITY_MARKER` (`validate-digest-urls.ts:58-101`).
- Test patterns: env save/restore + `globalThis.fetch` mock (`tests/build-daily-brief-context.test.ts:217-280`), `tempWorkspace()` + injected `hermes` runner (`tests/send-daily-brief.test.ts:10-21`), `baseContext` spread (`tests/stage-daily-brief.test.ts:6-26`).

## Scope

### Building

- `fetchPendingQuestionsFromMcp` hardening: `success:false` → `unavailable`, `reason?: string` threading, prompt sanitization, fetch limit 5
- Cross-day `questionDelivery` state key (`{ [questionId]: lastDeliveredDate }`) with `QUESTION_COOLDOWN_DAYS = 3` filter in `buildDailyBriefContext`
- `digest-question:id=…` marker: emitted by `composeDailyBrief`, extracted/stripped by `validate-digest-urls.ts`, recorded by `sendDailyBrief` (with stale-entry pruning)
- "One for you" postscript gated on `hasVerifiedContent` (keeps the deliberate P.S. placement)
- End-to-end tests: populated questions, `success:false`, cooldown filtering, marker render/strip/extract, send-pass state recording
- prepare.md/send.md contract updates sanctioning the postscript and documenting question bookkeeping

### Not Building

- Index-side `confirm_question_delivery` MCP tool (cross-repo; explicit follow-up — Index never learns about delivery in this design)
- Changes to `deliveredToday` / opportunity bookkeeping (working as designed)
- Changes to `read_pending_questions` on the index branch (tool is correct as-is)
- Interaction with the `signalElicitation` heartbeat task (`heartbeat.md:35-48`) — separate question surface, untouched
- Rendering question `options`/`multiSelect` in the digest (original plan decision: prompt-only)
- Answer-capture flow (user replies arrive as normal conversation turns — Index-side concern)

## Decisions

### I1 — Delivery bookkeeping: mirror the opportunity marker loop

**Ambiguity**: Questions had no delivery state; options were stage-time recording (simpler, but records delivery for never-approved digests) vs the marker loop (marker survives human Kanban edits; send records only what shipped).
**Decision**: Mirror the opportunity loop — `<!-- digest-question:id=… -->` marker embedded at stage (`stage-daily-brief.ts:118` pattern), extracted at send (`send-daily-brief.ts:145` pattern), recorded in heartbeat state. Developer-confirmed.

### I1 — Repetition policy: 3-day cooldown

**Ambiguity**: deliver-once-ever vs repeat-daily-until-answered vs N-day cooldown.
**Decision**: `QUESTION_COOLDOWN_DAYS = 3` — skip a question for 3 days after delivery, then re-offer if still pending. Fetch limit raised to 5 so a cooled-down question falls through to the next pending one. State shape: `questionDelivery: { [questionId]: "YYYY-MM-DD" }`, pruned of entries older than the cooldown at send time (entries beyond the cooldown have no effect, so pruning is lossless). Developer-confirmed.

### I2 — Postscript: document placement, gate the fallback

**Ambiguity**: The post-sign-off P.S. was deliberate per the original plan (`eebb8135c4`) but contradicts prepare.md:39's pointer-only fallback promise.
**Decision**: Keep the P.S. placement after the sign-off, render it only when `hasVerifiedContent` is true (a nothing-verified pointer-only digest stays pointer-only), and update prepare.md/send.md to sanction the postscript. Developer-confirmed.

### Scope — agentvillage-only, local state

**Decision**: All bookkeeping in `memory/heartbeat-state.json`. No Index-side `confirm_question_delivery` tool in this design (no such tool exists; adding one means protocol version bump + two-repo coordination). Developer-confirmed.

### Q2 — `success:false` is a failure

**Decision**: `parsed.success === false` returns `{ questions: [], source: "unavailable", reason: <server error or generic> }`, reserving `source: "mcp"` for genuinely successful responses. Single valid fix per the review; evidence `build-daily-brief-context.ts:728-729`.

### Q1 — Thread the failure reason

**Decision**: `fetchPendingQuestionsFromMcp` return gains `reason?: string` populated from `initResp.error.message`, `toolResp.error.message`, the `success:false` payload's `error` field, and the catch-block message. `buildDailyBriefContext` warning becomes `questions MCP unavailable: ${reason}` — mirroring the opportunities warning at `build-daily-brief-context.ts:777`.

### S1 — Sanitize the prompt at fetch-mapping time

**Decision**: Sanitize in the fetcher's mapping step (protects all downstream consumers, including marker extraction): strip HTML-comment sequences (`<!--`/`-->`, prevents forged `digest-opportunity`/`digest-question` markers), collapse whitespace/newlines (prevents section-header injection — `**One for you:**` stays a single line), cap at 300 chars. Evidence: `sanitizeDigestUrls` covers URLs only (`validate-digest-urls.ts:120`).

### Marker strip generalization

**Decision**: `stripDigestMetadata` strips both marker kinds via a shared `DIGEST_METADATA_MARKER` regex (`digest-(?:opportunity|question)`), while extraction keeps two dedicated regexes/functions (`extractDigestOpportunityIds`, `extractDigestQuestionIds`) since the send pass routes the two id streams to different state keys.

## Architecture

### skills/index-network/scripts/build-daily-brief-context.ts — MODIFY

Fetcher hardening (success check, reason threading, prompt sanitization, limit 5) and cooldown filtering against `questionDelivery` state.

```ts
// ── NEW constants, alongside HIGHLIGHTED_EVENT_LIMIT (~line 130) ──
/** How many pending questions to fetch per digest run (tool caps at 10). */
const QUESTION_FETCH_LIMIT = 5;
/** Hard cap on a question prompt interpolated into the digest body. */
const QUESTION_PROMPT_MAX_LENGTH = 300;
/** Days a delivered question stays out of the digest before being re-offered. */
export const QUESTION_COOLDOWN_DAYS = 3;

// ── NEW helpers, near readDeliveredIds (~line 419) ──
/** Whole days from `earlier` to `later` (both YYYY-MM-DD); negative when `earlier` is after `later`. */
function daysBetween(earlier: string, later: string): number {
  const a = parseDateParts(earlier);
  const b = parseDateParts(later);
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.floor(ms / 86_400_000);
}

/**
 * Read the cross-day question delivery log (`questionDelivery`:
 * `{ [questionId]: "YYYY-MM-DD" }`) from heartbeat state. Unlike
 * `deliveredToday`, entries persist across days — a question stays pending on
 * Index until answered, so dedup must outlive a single date. Defensive like
 * readDeliveredIds: missing/malformed state never blocks the brief.
 */
async function readQuestionDelivery(stateFile: string): Promise<Record<string, string>> {
  try {
    const raw = await Bun.file(stateFile).text();
    const parsed = JSON.parse(raw) as { questionDelivery?: unknown };
    if (parsed.questionDelivery && typeof parsed.questionDelivery === "object" && !Array.isArray(parsed.questionDelivery)) {
      return Object.fromEntries(
        Object.entries(parsed.questionDelivery as Record<string, unknown>)
          .filter((entry): entry is [string, string] =>
            Boolean(entry[0]) && typeof entry[1] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry[1])),
      );
    }
  } catch {
    // missing/malformed state should not block the brief
  }
  return {};
}

/**
 * Drop questions delivered within the last QUESTION_COOLDOWN_DAYS days.
 * A question with a future-dated delivery entry (clock skew) is also dropped —
 * never re-spam on ambiguity. Undelivered questions always pass.
 */
export function filterCooldownQuestions(
  questions: BriefQuestion[],
  delivery: Record<string, string>,
  date: string,
): BriefQuestion[] {
  return questions.filter((q) => {
    const deliveredOn = delivery[q.id];
    if (!deliveredOn) return true;
    return daysBetween(deliveredOn, date) >= QUESTION_COOLDOWN_DAYS;
  });
}

// ── NEW helper, above fetchPendingQuestionsFromMcp ──
/**
 * Sanitize an MCP-sourced question prompt before it is interpolated into the
 * digest body: drop HTML-comment sequences (so a hostile prompt cannot forge
 * digest-opportunity/digest-question markers), collapse all whitespace to a
 * single line (so it cannot inject section headers), and cap the length.
 */
function sanitizeQuestionPrompt(raw: string): string {
  const collapsed = raw
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!--|-->/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (collapsed.length <= QUESTION_PROMPT_MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, QUESTION_PROMPT_MAX_LENGTH - 1).trimEnd()}…`;
}

// ── REWRITTEN function (replaces PR-state fetchPendingQuestionsFromMcp, ~lines 700-745) ──
/**
 * Fetch pending questions by calling the Index MCP server directly via
 * JSON-RPC with read_pending_questions. Mirrors fetchOpportunitiesFromMcp.
 *
 * NEVER throws — all errors are caught internally.
 * Returns `{ questions, source, reason? }`: `source: "mcp"` is reserved for
 * genuinely successful fetches (possibly empty); every failure path returns
 * `source: "unavailable"` with a `reason` for the diagnostics warning.
 */
export async function fetchPendingQuestionsFromMcp(opts: {
  apiKey: string;
  mcpUrl: string;
}): Promise<{ questions: BriefQuestion[]; source: "mcp" | "unavailable"; reason?: string }> {
  try {
    const initResp = await postMcpMessage(opts.mcpUrl, opts.apiKey, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "agentvillage-digest", version: "1.0.0" },
      },
    });
    if (initResp.error) {
      return { questions: [], source: "unavailable", reason: `MCP initialize: ${initResp.error.message}` };
    }

    const toolResp = await postMcpMessage(opts.mcpUrl, opts.apiKey, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "read_pending_questions", arguments: { limit: QUESTION_FETCH_LIMIT } },
    });
    if (toolResp.error) {
      return { questions: [], source: "unavailable", reason: `MCP read_pending_questions: ${toolResp.error.message}` };
    }

    const result = toolResp.result as McpToolResult | undefined;
    const text = result?.content?.find((c) => c.type === "text")?.text ?? "";
    if (!text.trim()) return { questions: [], source: "mcp" };

    const parsed = JSON.parse(text) as { success?: boolean; error?: unknown; data?: { questions?: unknown[] } };
    if (parsed.success === false) {
      const detail = typeof parsed.error === "string" && parsed.error.trim() ? parsed.error : "tool reported failure";
      return { questions: [], source: "unavailable", reason: `read_pending_questions: ${detail}` };
    }
    if (!parsed.data?.questions || !Array.isArray(parsed.data.questions)) return { questions: [], source: "mcp" };
    const questions = parsed.data.questions
      .filter((q): q is Record<string, unknown> => q !== null && typeof q === "object")
      .map((q) => ({
        id: String(q.id ?? ""),
        title: String(q.title ?? ""),
        prompt: sanitizeQuestionPrompt(String(q.prompt ?? "")),
        mode: String(q.mode ?? ""),
      }))
      .filter((q) => q.id && q.prompt);
    return { questions, source: "mcp" };
  } catch (err) {
    return { questions: [], source: "unavailable", reason: err instanceof Error ? err.message : String(err) };
  }
}

// ── MODIFIED block inside buildDailyBriefContext (PR-state ~lines 789-797) ──
  if (apiKey) {
    const questionResult = await fetchPendingQuestionsFromMcp({ apiKey, mcpUrl });
    const questionDelivery = await readQuestionDelivery(options.stateFile ?? "memory/heartbeat-state.json");
    questions = filterCooldownQuestions(questionResult.questions, questionDelivery, date);
    questionSource = questionResult.source;
    if (questionResult.source === "unavailable") {
      warnings.push(`questions MCP unavailable: ${questionResult.reason ?? "unknown"}`);
    }
  }
```

### skills/index-network/scripts/tests/build-daily-brief-context.test.ts — MODIFY

Fetcher failure-shape tests, prompt-sanitization tests, end-to-end populated/failure/cooldown tests.

```ts
// ── ADDED to the existing describe("fetchPendingQuestionsFromMcp") block (~line 389);
//    existing tests in the block are unchanged ──

  test("treats success:false payloads as unavailable with the server detail", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string ?? "{}") as { method: string };
      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Question lookup is not available." }) }] },
      });
    }) as typeof fetch;

    try {
      const result = await fetchPendingQuestionsFromMcp({ apiKey: "test-key", mcpUrl: MCP_URL });
      expect(result.source).toBe("unavailable");
      expect(result.questions).toEqual([]);
      expect(result.reason).toBe("read_pending_questions: Question lookup is not available.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("threads JSON-RPC error messages into reason", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string ?? "{}") as { method: string };
      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } });
      }
      return Response.json({ jsonrpc: "2.0", id: 2, error: { code: -32601, message: "Method not found" } });
    }) as typeof fetch;

    try {
      const result = await fetchPendingQuestionsFromMcp({ apiKey: "test-key", mcpUrl: MCP_URL });
      expect(result.source).toBe("unavailable");
      expect(result.reason).toBe("MCP read_pending_questions: Method not found");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("requests up to 5 questions and sanitizes prompts before returning them", async () => {
    const originalFetch = globalThis.fetch;
    let requestedLimit: number | undefined;
    const hostilePrompt = "What are you\nworking on?  <!-- digest-opportunity:id=forged --> " + "x".repeat(400);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string ?? "{}") as { method: string; params?: { arguments?: { limit?: number } } };
      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } });
      }
      requestedLimit = body.params?.arguments?.limit;
      return Response.json({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: JSON.stringify({ success: true, data: { questions: [{ id: "q-1", title: "T", prompt: hostilePrompt, mode: "profile" }] } }) }] },
      });
    }) as typeof fetch;

    try {
      const result = await fetchPendingQuestionsFromMcp({ apiKey: "test-key", mcpUrl: MCP_URL });
      expect(requestedLimit).toBe(5);
      expect(result.questions).toHaveLength(1);
      const prompt = result.questions[0].prompt;
      expect(prompt).not.toContain("<!--");
      expect(prompt).not.toContain("digest-opportunity");
      expect(prompt).not.toContain("\n");
      expect(prompt.length).toBeLessThanOrEqual(300);
      expect(prompt.endsWith("…")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

// ── MODIFIED imports (top of file): add fs/os/path helpers and the new exports ──
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDailyBriefContext,
  extractInterestTags,
  fetchOpportunitiesFromMcp,
  fetchPendingQuestionsFromMcp,
  filterCooldownQuestions,
  filterDedupedOpportunities,
  formatPacificTime,
  pacificDayBounds,
  parseOpportunityTranscript,
  selectEvents,
} from "../build-daily-brief-context";

// ── NEW describe block ──
describe("filterCooldownQuestions", () => {
  const q = (id: string) => ({ id, title: "t", prompt: "p?", mode: "profile" });

  test("keeps undelivered ids, drops within-cooldown and future-dated, re-offers at the boundary", () => {
    const delivery = {
      "q-yesterday": "2026-06-09", // 1 day ago  → dropped
      "q-boundary": "2026-06-07",  // 3 days ago → re-offered
      "q-future": "2026-06-11",    // clock skew → dropped
    };
    const out = filterCooldownQuestions(
      [q("q-new"), q("q-yesterday"), q("q-boundary"), q("q-future")],
      delivery,
      "2026-06-10",
    );
    expect(out.map((x) => x.id)).toEqual(["q-new", "q-boundary"]);
  });
});

// ── NEW tests inside the existing describe("build-daily-brief-context helpers") block,
//    following the env save/restore pattern of the opportunitySource test (~line 217).
//    Env boilerplate is identical across all three and shown in full. ──

  test("buildDailyBriefContext populates questions and questionSource from MCP", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.INDEX_API_KEY;
    const originalMcpUrl = process.env.INDEX_MCP_URL;
    const originalEdgeosKey = process.env.EDGEOS_API_KEY;
    const originalControlPlaneUrl = process.env.EDGE_AGENT_CONTROL_PLANE_URL;
    const originalAdminToken = process.env.ADMIN_TOKEN;
    delete process.env.EDGEOS_API_KEY;
    delete process.env.EDGE_AGENT_CONTROL_PLANE_URL;
    delete process.env.ADMIN_TOKEN;
    process.env.INDEX_API_KEY = "test-key";
    process.env.INDEX_MCP_URL = "https://test.example.com/mcp";

    const mockQuestion = {
      id: "q-0001",
      title: "Collaboration focus",
      prompt: "What kind of collaboration are you most open to right now?",
      mode: "profile",
    };

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("open-meteo") || url.includes("weather.gov")) {
        return new Response("unavailable", { status: 503, statusText: "Service Unavailable" });
      }
      if (url === "https://test.example.com/mcp") {
        const body = JSON.parse(init?.body as string ?? "{}") as { method: string; params?: { name?: string } };
        if (body.method === "initialize") {
          return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } });
        }
        if (body.method === "tools/call") {
          if (body.params?.name === "read_pending_questions") {
            return Response.json({
              jsonrpc: "2.0",
              id: 2,
              result: { content: [{ type: "text", text: JSON.stringify({ success: true, data: { questions: [mockQuestion] } }) }] },
            });
          }
          return Response.json({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "" }] } });
        }
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const context = await buildDailyBriefContext({ date: "2026-06-10", userFiles: [] });
      expect(context.questions).toEqual([mockQuestion]);
      expect(context.diagnostics.questionSource).toBe("mcp");
      expect(context.diagnostics.warnings.some((w) => w.startsWith("questions MCP unavailable"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.INDEX_API_KEY;
      else process.env.INDEX_API_KEY = originalApiKey;
      if (originalMcpUrl === undefined) delete process.env.INDEX_MCP_URL;
      else process.env.INDEX_MCP_URL = originalMcpUrl;
      if (originalEdgeosKey === undefined) delete process.env.EDGEOS_API_KEY;
      else process.env.EDGEOS_API_KEY = originalEdgeosKey;
      if (originalControlPlaneUrl === undefined) delete process.env.EDGE_AGENT_CONTROL_PLANE_URL;
      else process.env.EDGE_AGENT_CONTROL_PLANE_URL = originalControlPlaneUrl;
      if (originalAdminToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = originalAdminToken;
    }
  });

  test("buildDailyBriefContext marks questionSource unavailable with a detailed warning on success:false", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.INDEX_API_KEY;
    const originalMcpUrl = process.env.INDEX_MCP_URL;
    const originalEdgeosKey = process.env.EDGEOS_API_KEY;
    const originalControlPlaneUrl = process.env.EDGE_AGENT_CONTROL_PLANE_URL;
    const originalAdminToken = process.env.ADMIN_TOKEN;
    delete process.env.EDGEOS_API_KEY;
    delete process.env.EDGE_AGENT_CONTROL_PLANE_URL;
    delete process.env.ADMIN_TOKEN;
    process.env.INDEX_API_KEY = "test-key";
    process.env.INDEX_MCP_URL = "https://test.example.com/mcp";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("open-meteo") || url.includes("weather.gov")) {
        return new Response("unavailable", { status: 503, statusText: "Service Unavailable" });
      }
      if (url === "https://test.example.com/mcp") {
        const body = JSON.parse(init?.body as string ?? "{}") as { method: string; params?: { name?: string } };
        if (body.method === "initialize") {
          return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } });
        }
        if (body.method === "tools/call") {
          if (body.params?.name === "read_pending_questions") {
            return Response.json({
              jsonrpc: "2.0",
              id: 2,
              result: { content: [{ type: "text", text: JSON.stringify({ success: false, error: "boom" }) }] },
            });
          }
          return Response.json({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "" }] } });
        }
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const context = await buildDailyBriefContext({ date: "2026-06-10", userFiles: [] });
      expect(context.questions).toEqual([]);
      expect(context.diagnostics.questionSource).toBe("unavailable");
      expect(context.diagnostics.warnings).toContain("questions MCP unavailable: read_pending_questions: boom");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) delete process.env.INDEX_API_KEY;
      else process.env.INDEX_API_KEY = originalApiKey;
      if (originalMcpUrl === undefined) delete process.env.INDEX_MCP_URL;
      else process.env.INDEX_MCP_URL = originalMcpUrl;
      if (originalEdgeosKey === undefined) delete process.env.EDGEOS_API_KEY;
      else process.env.EDGEOS_API_KEY = originalEdgeosKey;
      if (originalControlPlaneUrl === undefined) delete process.env.EDGE_AGENT_CONTROL_PLANE_URL;
      else process.env.EDGE_AGENT_CONTROL_PLANE_URL = originalControlPlaneUrl;
      if (originalAdminToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = originalAdminToken;
    }
  });

  test("buildDailyBriefContext filters questions in cooldown and falls through to the next pending one", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.INDEX_API_KEY;
    const originalMcpUrl = process.env.INDEX_MCP_URL;
    const originalEdgeosKey = process.env.EDGEOS_API_KEY;
    const originalControlPlaneUrl = process.env.EDGE_AGENT_CONTROL_PLANE_URL;
    const originalAdminToken = process.env.ADMIN_TOKEN;
    delete process.env.EDGEOS_API_KEY;
    delete process.env.EDGE_AGENT_CONTROL_PLANE_URL;
    delete process.env.ADMIN_TOKEN;
    process.env.INDEX_API_KEY = "test-key";
    process.env.INDEX_MCP_URL = "https://test.example.com/mcp";

    const dir = mkdtempSync(join(tmpdir(), "brief-questions-"));
    const stateFile = join(dir, "state.json");
    await Bun.write(stateFile, JSON.stringify({
      prepared: { date: "2026-06-09", taskId: "t_x" },
      questionDelivery: { "q-recent": "2026-06-09", "q-stale": "2026-06-01" },
    }));

    const questions = [
      { id: "q-recent", title: "A", prompt: "Recently asked?", mode: "profile" },
      { id: "q-stale", title: "B", prompt: "Asked long ago?", mode: "intent" },
    ];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("open-meteo") || url.includes("weather.gov")) {
        return new Response("unavailable", { status: 503, statusText: "Service Unavailable" });
      }
      if (url === "https://test.example.com/mcp") {
        const body = JSON.parse(init?.body as string ?? "{}") as { method: string; params?: { name?: string } };
        if (body.method === "initialize") {
          return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } });
        }
        if (body.method === "tools/call") {
          if (body.params?.name === "read_pending_questions") {
            return Response.json({
              jsonrpc: "2.0",
              id: 2,
              result: { content: [{ type: "text", text: JSON.stringify({ success: true, data: { questions } }) }] },
            });
          }
          return Response.json({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "" }] } });
        }
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const context = await buildDailyBriefContext({ date: "2026-06-10", userFiles: [], stateFile });
      expect(context.questions.map((q) => q.id)).toEqual(["q-stale"]);
      expect(context.diagnostics.questionSource).toBe("mcp");
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(dir, { recursive: true, force: true });
      if (originalApiKey === undefined) delete process.env.INDEX_API_KEY;
      else process.env.INDEX_API_KEY = originalApiKey;
      if (originalMcpUrl === undefined) delete process.env.INDEX_MCP_URL;
      else process.env.INDEX_MCP_URL = originalMcpUrl;
      if (originalEdgeosKey === undefined) delete process.env.EDGEOS_API_KEY;
      else process.env.EDGEOS_API_KEY = originalEdgeosKey;
      if (originalControlPlaneUrl === undefined) delete process.env.EDGE_AGENT_CONTROL_PLANE_URL;
      else process.env.EDGE_AGENT_CONTROL_PLANE_URL = originalControlPlaneUrl;
      if (originalAdminToken === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = originalAdminToken;
    }
  });
```

### skills/index-network/scripts/validate-digest-urls.ts — MODIFY

`digest-question` marker constant, `extractDigestQuestionIds`, generalized `stripDigestMetadata`.

```ts
// ── NEW constants, below DIGEST_OPPORTUNITY_MARKER (~line 55) ──
/** Hidden marker that ties a digest question fragment to the question it represents. */
const DIGEST_QUESTION_MARKER = /<!--\s*digest-question:id=([^\s>]+)\s*-->/g;
/** Any internal digest metadata marker (opportunity or question) — the strip set. */
const DIGEST_METADATA_MARKER = /<!--\s*digest-(?:opportunity|question):id=[^\s>]+\s*-->/g;

// ── NEW function, below extractDigestOpportunityIds ──
/**
 * Extract question ids from digest question markers that remain in the edited body.
 *
 * @param markdown - the editable digest body
 * @returns unique question ids in first-seen order
 */
export function extractDigestQuestionIds(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const match of markdown.matchAll(DIGEST_QUESTION_MARKER)) {
    const id = match[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

// ── MODIFIED function (replaces the existing stripDigestMetadata body) ──
/**
 * Remove internal digest metadata comments from user-facing output.
 *
 * @param markdown - the digest body
 * @returns markdown without digest opportunity/question markers
 */
export function stripDigestMetadata(markdown: string): string {
  return markdown.replace(DIGEST_METADATA_MARKER, "");
}
```

### skills/index-network/scripts/tests/validate-digest-urls.test.ts — MODIFY

Question-marker extraction and strip tests.

```ts
// ── MODIFIED import (top of file) ──
import {
  extractDigestOpportunityIds,
  extractDigestQuestionIds,
  sanitizeDigestUrls,
  stripDigestMetadata,
} from "../validate-digest-urls";

// ── NEW tests inside the existing describe("sanitizeDigestUrls") block, after
//    the "stripDigestMetadata removes only digest markers" test ──

  test("extracts unique question ids in order, ignoring opportunity markers", () => {
    const md = [
      "- <!-- digest-opportunity:id=opp-1 -->Maya — relevant",
      "<!-- digest-question:id=q-1 -->**One for you:** What are you building?",
      "<!-- digest-question:id=q-1 -->duplicate",
      "<!-- digest-question:id=q-2 -->**One for you:** Something else?",
    ].join("\n");

    expect(extractDigestQuestionIds(md)).toEqual(["q-1", "q-2"]);
    expect(extractDigestOpportunityIds(md)).toEqual(["opp-1"]);
  });

  test("stripDigestMetadata removes question markers as well as opportunity markers", () => {
    const md = "<!-- keep-me -->\n- <!-- digest-opportunity:id=opp-1 -->Maya\n<!-- digest-question:id=q-1 -->**One for you:** What are you building?";

    const stripped = stripDigestMetadata(md);

    expect(stripped).toBe("<!-- keep-me -->\n- Maya\n**One for you:** What are you building?");
    expect(stripped).not.toContain("digest-opportunity");
    expect(stripped).not.toContain("digest-question");
  });

  test("sanitizeDigestUrls strips question markers on final delivery and preserves them by default", () => {
    const md = "<!-- digest-question:id=q-1 -->**One for you:** Anything new?";

    expect(sanitizeDigestUrls(md).output).toBe(md);
    expect(sanitizeDigestUrls(md, { stripDigestMetadata: true }).output).toBe("**One for you:** Anything new?");
  });
```

### skills/index-network/scripts/stage-daily-brief.ts — MODIFY

Question postscript gated on `hasVerifiedContent`; `digest-question` marker emission.

```ts
// ── MODIFIED: composeDailyBrief signature (PR state ~line 84) ──
export function composeDailyBrief(context: DailyBriefContext): { body: string; opportunityIds: string[]; questionIds: string[] } {

// ── MODIFIED: id collectors (PR state ~line 95) ──
  const opportunityIds: string[] = [];
  const questionIds: string[] = [];
  let hasVerifiedContent = false;

// ── MODIFIED: question section (replaces PR-state lines ~170-181, after the sign-off push) ──
  lines.push("That's it for now. You can always ask me for more detail, or any other questions you have!");

  // "One for you" postscript: deliberately placed after the sign-off as a P.S.
  // (sanctioned in prepare.md). Gated on hasVerifiedContent so the pointer-only
  // fallback digest stays pointer-only. The digest-question marker mirrors the
  // opportunity marker: it survives human Kanban edits and lets the send pass
  // record exactly which question actually shipped.
  const pendingQuestions = context.questions ?? [];
  const question = hasVerifiedContent ? pendingQuestions[0] : undefined;
  if (question) {
    questionIds.push(question.id);
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`<!-- digest-question:id=${question.id} -->**One for you:** ${question.prompt}`);
    lines.push("");
    lines.push("Reply to me anytime!");
  }

  return { body: lines.join("\n").replace(/\n{3,}/g, "\n\n"), opportunityIds, questionIds };
}

// ── MODIFIED: stageDailyBrief return type + compose destructuring + prepared state (PR state ~lines 246-289) ──
export async function stageDailyBrief(options: {
  date?: string;
  opportunitiesFile?: string;
  stateFile?: string;
  contextOut?: string;
} = {}): Promise<{ taskId: string; body: string; opportunityIds: string[]; questionIds: string[] }> {
  // ... unchanged through context build ...
  const { body, opportunityIds, questionIds } = composeDailyBrief(context);
  // ... unchanged sanitize / kanban create / block ...
  state.prepared = {
    date,
    taskId,
    taskTitle: `Morning digest — ${date}`,
    opportunityIds,
    questionIds,
  };
  await writeJson(stateFile, state);

  rmSync("memory/digest-draft.md", { force: true });

  return { taskId, body: sanitizedBody, opportunityIds, questionIds };
}

// ── MODIFIED: main() diagnostics line ──
  process.stdout.write(`${JSON.stringify({ taskId: result.taskId, opportunityIds: result.opportunityIds, questionIds: result.questionIds })}\n`);
```

### skills/index-network/scripts/tests/stage-daily-brief.test.ts — MODIFY

Marker render, fallback gating, and placement tests.

```ts
// ── REPLACED: the existing test "renders a One for you section when questions are pending"
//    (it passed bare baseContext, which now correctly fails the hasVerifiedContent gate) ──
  test("renders a gated One for you postscript with a digest-question marker", () => {
    const { body, questionIds } = composeDailyBrief({
      ...baseContext,
      announcements: [{ body: "Town hall at 5pm." }],
      questions: [
        {
          id: "q-0001",
          title: "Collaboration focus",
          prompt: "What kind of collaboration are you most open to right now?",
          mode: "profile",
        },
      ],
    });
    expect(questionIds).toEqual(["q-0001"]);
    expect(body).toContain("<!-- digest-question:id=q-0001 -->**One for you:** What kind of collaboration are you most open to right now?");
    expect(body).toContain("Reply to me anytime!");
    expect(body.indexOf("That's it for now")).toBeLessThan(body.indexOf("**One for you:**"));
  });

// ── NEW test ──
  test("omits the question postscript from the pointer-only fallback digest", () => {
    const { body, questionIds } = composeDailyBrief({
      ...baseContext,
      questions: [{ id: "q-0001", title: "T", prompt: "Anything new?", mode: "profile" }],
    });
    expect(questionIds).toEqual([]);
    expect(body).toContain("I couldn't check the live calendar this morning");
    expect(body).not.toContain("**One for you:**");
    expect(body).not.toContain("digest-question");
  });

// ── UNCHANGED: "does not render a One for you section when questions are absent" and
//    "...when questions array is empty" keep passing (no verified content AND no questions). ──
```

### skills/index-network/scripts/send-daily-brief.ts — MODIFY

Question-id extraction from the approved body; `questionDelivery` state recording with pruning.

```ts
// ── MODIFIED imports (top of file) ──
import { QUESTION_COOLDOWN_DAYS } from "./build-daily-brief-context";
import { extractDigestOpportunityIds, extractDigestQuestionIds, sanitizeDigestUrls } from "./validate-digest-urls";

// ── MODIFIED interface ──
interface SendResult {
  taskId: string;
  opportunityIds: string[];
  questionIds: string[];
  finalBrief: string;
}

// ── NEW helper, near pacificDate ──
/**
 * Whether a question delivery entry is still inside the re-delivery cooldown.
 * Future-dated entries (clock skew) count as within cooldown — never re-spam
 * on ambiguity, matching filterCooldownQuestions in build-daily-brief-context.
 */
function withinQuestionCooldown(deliveredOn: string, today: string): boolean {
  const toUtc = (d: string) => {
    const [year, month, day] = d.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  const elapsedDays = Math.floor((toUtc(today) - toUtc(deliveredOn)) / 86_400_000);
  return elapsedDays < QUESTION_COOLDOWN_DAYS;
}

// ── MODIFIED block inside sendDailyBrief (PR state ~lines 139-153): question bookkeeping
//    inserted between the deliveredToday update and writeJson, so one write covers both ──
  await Bun.write(outgoingFile, body);
  const opportunityIds = extractDigestOpportunityIds(body);
  const questionIds = extractDigestQuestionIds(body);

  const deliveredToday = state.deliveredToday && typeof state.deliveredToday === "object" && !Array.isArray(state.deliveredToday)
    ? state.deliveredToday as Record<string, unknown>
    : {};
  const currentIds = deliveredToday.date === date ? stringArray(deliveredToday.ids) : [];
  state.deliveredToday = {
    date,
    ids: Array.from(new Set([...currentIds, ...opportunityIds])),
  };

  // Cross-day question delivery log: record today's delivered question ids and
  // prune entries past the cooldown (they no longer affect filtering, so the
  // prune is lossless and keeps the state file bounded).
  const questionDelivery = state.questionDelivery && typeof state.questionDelivery === "object" && !Array.isArray(state.questionDelivery)
    ? { ...(state.questionDelivery as Record<string, unknown>) }
    : {};
  for (const [id, deliveredOn] of Object.entries(questionDelivery)) {
    if (typeof deliveredOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(deliveredOn) || !withinQuestionCooldown(deliveredOn, date)) {
      delete questionDelivery[id];
    }
  }
  for (const id of questionIds) questionDelivery[id] = date;
  state.questionDelivery = questionDelivery;

  await writeJson(stateFile, state);

  await hermes(["kanban", "complete", taskId, "--summary", "delivered"]);

  const { output: finalBrief } = sanitizeDigestUrls(body, { stripDigestMetadata: true });
  return { taskId, opportunityIds, questionIds, finalBrief };
```

### skills/index-network/scripts/tests/send-daily-brief.test.ts — MODIFY

Send-pass question bookkeeping test.

```ts
// ── NEW test inside describe("sendDailyBrief") ──
  test("records question delivery dates, prunes stale entries, and preserves sibling state keys", async () => {
    tempWorkspace();
    await Bun.write("state.json", JSON.stringify({
      prepared: { date: "2026-06-10", taskId: "t_digest" },
      questionDelivery: { "q-old": "2026-06-01", "q-recent": "2026-06-09" },
      signalElicitation: { lastAskedDate: "2026-06-09" },
    }));
    const body = [
      "🌞 Good morning",
      "**Announcements**",
      "- Town hall at 5pm.",
      "<!-- digest-question:id=q-0001 -->**One for you:** What are you building?",
    ].join("\n");

    const result = await sendDailyBrief({
      date: "2026-06-10",
      stateFile: "state.json",
      outgoingFile: "outgoing.md",
      hermes: (args) => {
        if (args[0] === "kanban" && args[1] === "show") return JSON.stringify({ task: { id: "t_digest", status: "ready", body } });
        if (args[0] === "kanban" && args[1] === "complete") return "completed";
        throw new Error(`unexpected hermes call: ${args.join(" ")}`);
      },
    });

    expect("silent" in result).toBe(false);
    if ("silent" in result) throw new Error("unexpected silent result");
    expect(result.questionIds).toEqual(["q-0001"]);
    expect(result.finalBrief).not.toContain("digest-question");
    expect(result.finalBrief).toContain("**One for you:** What are you building?");

    const state = JSON.parse(await Bun.file("state.json").text());
    // q-old (9 days ago, past the 3-day cooldown) pruned; q-recent kept; q-0001 recorded today.
    expect(state.questionDelivery).toEqual({ "q-recent": "2026-06-09", "q-0001": "2026-06-10" });
    expect(state.signalElicitation).toEqual({ lastAskedDate: "2026-06-09" });
  });

// ── UNCHANGED: existing tests keep passing — the silent paths return before the new code;
//    the existing "delivers ready cards..." test's state has no questionDelivery key and its
//    body has no question marker, so state.questionDelivery becomes {} (additive key). ──
```

### skills/edge-esmeralda/prompts/prepare.md — MODIFY

Sanction the gated postscript; document the marker and state bookkeeping.

```md
<!-- Edit 1: step 1 paragraph (PR state line 28) -->
OLD: The script resolves the America/Los_Angeles date, fetches opportunities from the Index MCP server, builds structured context, composes the markdown body, runs the URL guard, creates the Kanban task with argv-safe `--body`, blocks it for review, and records `prepared.taskId` in `memory/heartbeat-state.json`. Its JSON stdout is for diagnostics only; do not expose it.
NEW: The script resolves the America/Los_Angeles date, fetches opportunities and pending questions from the Index MCP server, builds structured context, composes the markdown body (including the optional closing question postscript), runs the URL guard, creates the Kanban task with argv-safe `--body`, blocks it for review, and records `prepared.taskId` in `memory/heartbeat-state.json`. Its JSON stdout is for diagnostics only; do not expose it.

<!-- Edit 2: new bullet in "## Data sources and dates", after the "Index people sections" bullet -->
- The optional closing question ("**One for you:**") is fetched by the same script from the Index MCP server's `read_pending_questions` tool. The script renders at most one question, only when the digest has verified content, and skips any question delivered within the last 3 days (tracked under `questionDelivery` in `memory/heartbeat-state.json`). Render the prompt exactly as the script provides it; never invent or rephrase questions.

<!-- Edit 3: new hard rule, after the "Calendar failures must not block launch" rule -->
- The question postscript is sanctioned: when the digest has verified content and a pending question exists, the body ends with `---` followed by a single `**One for you:**` question after the sign-off line. The pointer-only fallback digest never carries a question. The hidden `digest-question` marker beside it is delivery bookkeeping — like opportunity markers, it is stripped before the user sees the brief; do not remove or edit it.
```

### skills/edge-esmeralda/prompts/send.md — MODIFY

Document question-marker extraction and `questionDelivery` recording in the send script's responsibilities.

```md
<!-- Edit 1: step 1 paragraph (PR state line 15) -->
OLD: Do not write Python, shell pipelines, or replacement delivery logic. The script resolves today's America/Los_Angeles date, reads `memory/heartbeat-state.json`, checks the Kanban approval gate, writes `memory/digest-outgoing.md`, extracts digest opportunity markers, updates delivery state, marks the task complete, strips unsafe URLs/internal metadata, and prints either `[SILENT]` or one JSON object.
NEW: Do not write Python, shell pipelines, or replacement delivery logic. The script resolves today's America/Los_Angeles date, reads `memory/heartbeat-state.json`, checks the Kanban approval gate, writes `memory/digest-outgoing.md`, extracts digest opportunity and question markers, updates delivery state (today's opportunity ids plus the per-question 3-day re-delivery cooldown under `questionDelivery`), marks the task complete, strips unsafe URLs/internal metadata, and prints either `[SILENT]` or one JSON object.

<!-- Edit 2: step 3 JSON shape (PR state line 24) -->
OLD: { "taskId": "...", "opportunityIds": ["..."], "finalBrief": "..." }
NEW: { "taskId": "...", "opportunityIds": ["..."], "questionIds": ["..."], "finalBrief": "..." }

<!-- Edit 3: step 4 (PR state line 27), appended sentences -->
OLD: **Confirm delivery only for returned opportunity ids.** For every `opportunityIds[]` value, call `confirm_opportunity_delivery(opportunityId, trigger="digest")`. If the array is empty, skip this step.
NEW: **Confirm delivery only for returned opportunity ids.** For every `opportunityIds[]` value, call `confirm_opportunity_delivery(opportunityId, trigger="digest")`. If the array is empty, skip this step. Never call any MCP tool for `questionIds[]` — question delivery bookkeeping is handled entirely by the script's state file; there is no question confirmation tool.
```

## Slices

### Slice 1: Fetcher hardening (Q2, Q1, S1)

**Files**: `skills/index-network/scripts/build-daily-brief-context.ts`, `skills/index-network/scripts/tests/build-daily-brief-context.test.ts`

#### Automated Verification:
- [ ] Targeted tests pass (from `packages/edge-city/agentvillage`): `bun test skills/index-network/scripts/tests/build-daily-brief-context.test.ts`
- [ ] `success:false` guard exists: `grep -n "success === false" skills/index-network/scripts/build-daily-brief-context.ts` returns a match
- [ ] Reason threading (template-literal warning, not the bare string): `grep -n 'questions MCP unavailable: ' skills/index-network/scripts/build-daily-brief-context.ts` returns a match
- [ ] Sanitizer wired into the mapping: `grep -c "sanitizeQuestionPrompt" skills/index-network/scripts/build-daily-brief-context.ts` returns ≥ 2 (definition + call)

#### Manual Verification:
- [ ] On a dev box with a bad `INDEX_API_KEY`, `memory/daily-brief-context.json` diagnostics carry `questions MCP unavailable: <detail>` (not the bare string)

### Slice 2: Cooldown filter + end-to-end wiring tests (I1 read-side, Q4)

**Files**: `skills/index-network/scripts/build-daily-brief-context.ts`, `skills/index-network/scripts/tests/build-daily-brief-context.test.ts`

#### Automated Verification:
- [ ] Targeted tests pass (from `packages/edge-city/agentvillage`): `bun test skills/index-network/scripts/tests/build-daily-brief-context.test.ts`
- [ ] Q4 closed — populated end-to-end assertion exists: `grep -c 'questionSource).toBe("mcp")' skills/index-network/scripts/tests/build-daily-brief-context.test.ts` returns ≥ 2
- [ ] Cooldown constant exported: `grep -n "export const QUESTION_COOLDOWN_DAYS = 3" skills/index-network/scripts/build-daily-brief-context.ts` returns a match
- [ ] Cooldown wired into the build: `grep -n "filterCooldownQuestions(questionResult.questions" skills/index-network/scripts/build-daily-brief-context.ts` returns a match

#### Manual Verification:
- [ ] With a hand-seeded `questionDelivery` entry dated yesterday in `memory/heartbeat-state.json` (e.g. `{"questionDelivery": {"q-x": "<yesterday>"}}`), a dev-box run of `bun skills/index-network/scripts/build-daily-brief-context.ts --state-file memory/heartbeat-state.json` omits `q-x` from `questions[]` while `diagnostics.questionSource` stays `"mcp"`

### Slice 3: Question marker utilities (I1 foundation)

**Files**: `skills/index-network/scripts/validate-digest-urls.ts`, `skills/index-network/scripts/tests/validate-digest-urls.test.ts`

#### Automated Verification:
- [ ] Targeted tests pass (from `packages/edge-city/agentvillage`): `bun test skills/index-network/scripts/tests/validate-digest-urls.test.ts`
- [ ] Question extractor exported: `grep -n "export function extractDigestQuestionIds" skills/index-network/scripts/validate-digest-urls.ts` returns a match
- [ ] Strip path covers both marker kinds: `grep -n "digest-(?:opportunity|question)" skills/index-network/scripts/validate-digest-urls.ts` returns a match
- [ ] Marker-leak guard (review lesson): `echo '<!-- digest-question:id=q-1 -->hi' | bun skills/index-network/scripts/validate-digest-urls.ts --strip-digest-metadata` prints `hi` with no marker text

#### Manual Verification:
- [ ] None — fully covered by automated checks (pure string utilities)

### Slice 4: Gated postscript + marker emission (I2, I1 stage-side)

**Files**: `skills/index-network/scripts/stage-daily-brief.ts`, `skills/index-network/scripts/tests/stage-daily-brief.test.ts`

#### Automated Verification:
- [ ] Targeted tests pass (from `packages/edge-city/agentvillage`): `bun test skills/index-network/scripts/tests/stage-daily-brief.test.ts`
- [ ] Marker emitted: `grep -n "digest-question:id=" skills/index-network/scripts/stage-daily-brief.ts` returns a match
- [ ] Gate present: `grep -n "hasVerifiedContent ? pendingQuestions" skills/index-network/scripts/stage-daily-brief.ts` returns a match
- [ ] Fallback regression pinned: `grep -n "omits the question postscript" skills/index-network/scripts/tests/stage-daily-brief.test.ts` returns a match

#### Manual Verification:
- [ ] On a dev box with verified content and a pending question, the staged Kanban draft body shows the `---` P.S. with the `digest-question` marker after the sign-off
- [ ] On a dev box with nothing verified, the staged draft is the pointer-only fallback with no question section

### Slice 5: Send-pass question bookkeeping (I1)

**Files**: `skills/index-network/scripts/send-daily-brief.ts`, `skills/index-network/scripts/tests/send-daily-brief.test.ts`

#### Automated Verification:
- [ ] Targeted tests pass (from `packages/edge-city/agentvillage`): `bun test skills/index-network/scripts/tests/send-daily-brief.test.ts`
- [ ] Extractor wired: `grep -c "extractDigestQuestionIds" skills/index-network/scripts/send-daily-brief.ts` returns ≥ 2 (import + call)
- [ ] Cooldown constant shared, not duplicated: `grep -n "QUESTION_COOLDOWN_DAYS" skills/index-network/scripts/send-daily-brief.ts` shows an import from `./build-daily-brief-context`
- [ ] Sibling-key preservation pinned: `grep -n "signalElicitation" skills/index-network/scripts/tests/send-daily-brief.test.ts` returns a match

#### Manual Verification:
- [ ] On a dev box, after approving and sending a digest containing a question, `memory/heartbeat-state.json` gains `questionDelivery` with today's date for that question id, and the delivered Telegram message contains no marker text

### Slice 6: Contract documentation (I1/I2)

**Files**: `skills/edge-esmeralda/prompts/prepare.md`, `skills/edge-esmeralda/prompts/send.md`

#### Automated Verification:
- [ ] Full digest-script suite passes (from `packages/edge-city/agentvillage`): `bun test skills/index-network/scripts/tests/`
- [ ] Postscript sanctioned: `grep -n "One for you" skills/edge-esmeralda/prompts/prepare.md` returns a match
- [ ] Cooldown documented in both contracts: `grep -ln "questionDelivery" skills/edge-esmeralda/prompts/prepare.md skills/edge-esmeralda/prompts/send.md` lists both files
- [ ] Send JSON shape updated: `grep -c "questionIds" skills/edge-esmeralda/prompts/send.md` returns ≥ 2 (shape + step-4 rule)
- [ ] No question-confirmation tool invented: `grep -n "confirm_question_delivery" skills/edge-esmeralda/prompts/prepare.md skills/edge-esmeralda/prompts/send.md` returns nothing

#### Manual Verification:
- [ ] Read both prompts end-to-end: the postscript rule does not contradict any existing hard rule (esp. "Never expose internal IDs / marker comments" — markers are stripped pre-delivery, and the rules now say so)

## Desired End State

A digest day, end to end:

```ts
// Prepare pass (cron, stage-daily-brief.ts):
const context = await buildDailyBriefContext({ date: "2026-06-12", stateFile: "memory/heartbeat-state.json" });
// → fetches up to 5 pending questions, filters those delivered within the last 3 days,
//   context.questions = [first eligible question, ...], diagnostics.questionSource = "mcp"
// On MCP failure: context.questions = [], questionSource = "unavailable",
//   warnings include `questions MCP unavailable: MCP initialize: Unauthorized`

const { body } = composeDailyBrief(context);
// body (verified content present):
//   ...That's it for now. You can always ask me for more detail, or any other questions you have!
//
//   ---
//
//   <!-- digest-question:id=q-0001 -->
//   **One for you:** What kind of collaboration are you most open to right now?
//
//   Reply to me anytime!
// body (nothing verified): pointer-only fallback, NO question section.

// Send pass (send-daily-brief.ts) after human approval:
const result = await sendDailyBrief({ date: "2026-06-12" });
// → extracts q-0001 from the approved body, writes
//   state.questionDelivery = { "q-0001": "2026-06-12" } (stale entries pruned),
//   strips both digest-opportunity and digest-question markers from finalBrief.

// Next 3 days: q-0001 is filtered at context build; the next pending question (if any) surfaces.
// Day 4+: q-0001 still pending on Index → eligible again.
```

## File Map

```
skills/index-network/scripts/build-daily-brief-context.ts            # MODIFY — fetcher hardening + cooldown filter
skills/index-network/scripts/tests/build-daily-brief-context.test.ts # MODIFY — fetcher + e2e + cooldown tests
skills/index-network/scripts/validate-digest-urls.ts                 # MODIFY — question marker extract/strip
skills/index-network/scripts/tests/validate-digest-urls.test.ts      # MODIFY — marker tests
skills/index-network/scripts/stage-daily-brief.ts                    # MODIFY — gated postscript + marker emission
skills/index-network/scripts/tests/stage-daily-brief.test.ts         # MODIFY — compose gating/marker tests
skills/index-network/scripts/send-daily-brief.ts                     # MODIFY — questionDelivery recording
skills/index-network/scripts/tests/send-daily-brief.test.ts          # MODIFY — send bookkeeping test
skills/edge-esmeralda/prompts/prepare.md                             # MODIFY — sanction postscript, document marker
skills/edge-esmeralda/prompts/send.md                                # MODIFY — document question bookkeeping
```

## Ordering Constraints

- Slice 1 before Slice 2 (Slice 2 builds on the hardened fetcher's return shape and limit).
- Slice 3 before Slice 4 (the marker must be strippable before the composer emits it — otherwise it leaks to the user).
- Slices 2 and 3 before Slice 5 (Slice 5 imports `extractDigestQuestionIds` from Slice 3 and `QUESTION_COOLDOWN_DAYS` from Slice 2).
- Slice 6 last (documents Slices 4–5 behavior).
- All work happens in the agentvillage submodule on branch `feat/agentvillage-brief-questions` (PR #84), per the submodule workflow in the root CLAUDE.md.

## Verification Notes

Carried from the review's Precedents section (recurring lessons on this exact file set):

- **MCP response-shape handling repeatedly needed hardening follow-ups** (`064b44e`, `9c183f6`, `d3b831c`): test the fetcher against malformed, empty, error-shaped, AND `success:false` responses.
- **Digest sections break at the wiring/composition layer, not the fetcher** (`dfce2ef`, `d3b831c`): cover absence, single item, and populated flows end-to-end through `buildDailyBriefContext` — this is finding Q4.
- **Daily-brief changes spill across scripts, tests, prompts, and cron wiring** — this design touches scripts+tests+prompts together (the PR's original gap).
- Marker-leak check: `grep -c "digest-question" <finalBrief output>` must be 0 after `stripDigestMetadata`.
- State-key preservation: writing `questionDelivery` must preserve `prepared`, `deliveredToday`, `signalElicitation` (convention at `heartbeat.md:48`).
- Run targeted tests with `bun test skills/index-network/scripts/tests/<file>.test.ts` from the agentvillage repo root.

## Performance Considerations

Negligible. The fetch limit rises 1→5 within a single existing MCP call (tool caps at 10); cooldown filtering is an in-memory Set/Record lookup; state-file pruning bounds `questionDelivery` to entries within the cooldown window.

## Migration Notes

No schema migration. `questionDelivery` is a new optional key in `memory/heartbeat-state.json` — existing files lack it; all readers tolerate absence (default `{}`). No rollback concern: removing the code leaves an inert key.

## Pattern References

- `skills/index-network/scripts/stage-daily-brief.ts:48-50` — `opportunityMarker` HTML-comment marker emission (template for question marker)
- `skills/index-network/scripts/send-daily-brief.ts:139-153` — marker extraction + state recording in the send pass (template for `questionDelivery`)
- `skills/index-network/scripts/validate-digest-urls.ts:58-117` — `DIGEST_OPPORTUNITY_MARKER` / `extractDigestOpportunityIds` / `stripDigestMetadata` (template for question marker utilities)
- `skills/index-network/scripts/build-daily-brief-context.ts:419-430` — `readDeliveredIds` defensive state reading (template for `readQuestionDelivery`)
- `skills/index-network/scripts/build-daily-brief-context.ts:770-779` — opportunities fetch warning with `err.message` detail (template for Q1 reason threading)
- `skills/index-network/scripts/tests/send-daily-brief.test.ts:52-91` — `tempWorkspace` + injected hermes runner + state-file assertion (template for Slice 5 test)
- `skills/index-network/scripts/tests/build-daily-brief-context.test.ts:217-280` — env save/restore + `globalThis.fetch` MCP mock (template for Slices 1–2 tests)

## Developer Context

Recorded from the Step-4 checkpoint (batched, all four independent):

- **Q**: "I1 fix direction: mirror the opportunity delivery loop (marker embedded at stage `stage-daily-brief.ts:118`, extracted at send `send-daily-brief.ts:145`, recorded in heartbeat state) or record at stage time without markers?" → **A**: "Mirror opportunity marker loop."
- **Q**: "Repetition policy for an unanswered question (stays `pending` on Index until answered)?" → **A**: "N-day cooldown" (3 days; fetch limit raised so a cooled-down question falls through to the next pending one).
- **Q**: "I2 placement: the post-sign-off `---` postscript was deliberate per the original plan (`eebb8135c4`) but contradicts prepare.md:39. Gate or document?" → **A**: "Document postscript, gate fallback" (render only when `hasVerifiedContent`; sanction the P.S. in prepare.md/send.md).
- **Q**: "Scope: also add a `confirm_question_delivery` MCP tool on the Index side? No such tool exists today." → **A**: "Agentvillage-only, local state" (Index-side confirmation deferred).
- **Q** (design summary confirm): mirror loop + cooldown + gated postscript + fetcher hardening + docs + e2e tests → **A**: "Proceed."
- **Q** (decomposition): 6 slices as listed → **A**: "Approve."

## Design History

- Slice 1: Fetcher hardening (Q2, Q1, S1) — approved as generated
- Slice 2: Cooldown filter + end-to-end wiring tests (I1 read-side, Q4) — approved as generated (manual criterion made slice-atomic after verifier finding)
- Slice 3: Question marker utilities (I1 foundation) — approved as generated
- Slice 4: Gated postscript + marker emission (I2, I1 stage-side) — approved as generated
- Slice 5: Send-pass question bookkeeping (I1) — approved as generated
- Slice 6: Contract documentation (I1/I2) — approved as generated (send.md Edit-1 anchor made verbatim after verifier finding)

## References

- `.rpiv/artifacts/reviews/2026-06-11_22-39-39_agentvillage-pr-84.md` — source review (findings I1, I2, Q2, Q4, Q1, S1)
- https://github.com/Edge-City/agentvillage/pull/84 — the PR under revision (`2507e15..78215c6`)
- Index branch `feat/agentvillage-brief-questions` — `read_pending_questions` tool (`packages/protocol/src/questioner/questioner.tools.ts`, commit `97e9a77f73`)
- Index commits `7eae10d7a9` (FRD — original dedup requirement), `eebb8135c4` (implementation plan — postscript exemplar)
- Root CLAUDE.md "Subtrees → packages/edge-city/agentvillage" — submodule PR workflow against Edge-City/agentvillage
