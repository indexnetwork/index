import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createExecute, NegotiatorAgent, OpenRouterClient, TypeSafeClient, type Execute, type NegotiateResult, type TypeSafeContent } from "../src/index.js";

import { CASES } from "./negotiation.cases.js";

const BASELINE = "3e6e277aa";
const MODEL = "google/gemini-3.7-flash";
const REPEATS = 3;
const { OPENROUTER_API_KEY, TYPESAFE_API_KEY } = process.env;
if (!OPENROUTER_API_KEY || !TYPESAFE_API_KEY) throw new Error("This comparison requires OPENROUTER_API_KEY and TYPESAFE_API_KEY.");

// Read the committed gate from Git; keep one implementation in the runtime source tree.
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const directory = mkdtempSync(join(tmpdir(), "index-negotiation-compare-"));
const baselineDirectory = join(directory, "baseline");
mkdirSync(baselineDirectory);
execFileSync("tar", ["-x", "-C", baselineDirectory], {
  input: execFileSync("git", ["archive", BASELINE, "packages/agent/src"], { cwd: root }),
});
const { NegotiatorAgent: GatedNegotiator } = await import(pathToFileURL(join(baselineDirectory, "packages/agent/src/index.ts")).href);
writeFileSync(join(directory, "working-tree.patch"), execFileSync("git", ["diff"], { cwd: root }), { mode: 0o600 });
writeFileSync(join(directory, "cases.ts"), readFileSync(new URL("./negotiation.cases.ts", import.meta.url)), { mode: 0o600 });
writeFileSync(join(directory, "cases.json"), JSON.stringify(CASES, null, 2), { mode: 0o600 });
writeFileSync(join(directory, "metadata.json"), JSON.stringify({
  baseline: BASELINE,
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  model: MODEL, repeats: REPEATS, labelsReviewed: "User confirmed all eight outcomes on 2026-09-21",
  startedAt: new Date().toISOString(), fixedPromptDate: "2026-09-21T00:00:00Z",
}, null, 2), { mode: 0o600 });
console.log(`Results: ${directory}`);

type Mode = "single" | "jev-gate";
type Row = {
  case: string;
  repeat: number;
  mode: Mode;
  expected: string;
  action?: string;
  elapsedMs: number;
  result?: NegotiateResult;
  error?: string;
};
const rows: Row[] = [];
const hashes = new Map<string, string>();
const model = new OpenRouterClient({ apiKey: OPENROUTER_API_KEY, models: [MODEL] });
const jev = new TypeSafeClient({ apiKey: TYPESAFE_API_KEY });
const hash = (value: TypeSafeContent) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function canonicalEvidence(evidence: TypeSafeContent): TypeSafeContent {
  if (typeof evidence !== "object" || !evidence || Array.isArray(evidence)) return evidence;
  const humanEvidence = evidence.humanEvidence;
  const counterpartyEvidence = evidence.counterpartyEvidence;
  if (!isRecord(humanEvidence) || !isRecord(counterpartyEvidence)) return evidence;
  return {
    principalIntent: humanEvidence.principalIntent,
    profile: humanEvidence.confirmedProfile,
    conversation: humanEvidence.conversation,
    brief: evidence.principalInstruction,
    counterparty: { statement: counterpartyEvidence.statement },
    turns: counterpartyEvidence.turns,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

for (let repeat = 1; repeat <= REPEATS; repeat++) {
  for (const [index, sample] of CASES.entries()) {
    const modes: Mode[] = (repeat + index) % 2 ? ["single", "jev-gate"] : ["jev-gate", "single"];
    for (const mode of modes) {
      const modelCalls: object[] = [];
      const jevCalls: object[] = [];
      let evidenceHash: string | undefined;
      let prepared: object | undefined;
      const recordEvidence = (evidence: TypeSafeContent) => {
        evidenceHash = hash(canonicalEvidence(evidence));
        const previous = hashes.get(sample.id);
        if (previous) assert.equal(evidenceHash, previous, `Evidence changed for ${sample.id}`);
        hashes.set(sample.id, evidenceHash);
      };
      const executeModel = createExecute({
        complete: async (...args) => {
          const started = performance.now();
          const response = await model.complete(...args);
          modelCalls.push({ elapsedMs: Math.round(performance.now() - started), response });
          return response;
        },
      });
      const execute: Execute = async (input) => {
        prepared = { instructions: input.instructions, prompt: input.prompt };
        if (mode === "single") {
          const source = input.prompt.split("\n\nEvidence and instruction:\n")[1]?.split("\n\nThis negotiation:\n")[0];
          assert.ok(source, "Missing single-negotiator evidence block");
          recordEvidence(JSON.parse(source));
        }
        await executeModel(input);
      };
      const decisions: Pick<TypeSafeClient, "evaluate"> = {
        evaluate: async (state, questions, abortSignal) => {
          recordEvidence(state);
          const started = performance.now();
          const response = await jev.evaluate(state, questions, abortSignal);
          jevCalls.push({ elapsedMs: Math.round(performance.now() - started), state, questions, response });
          return response;
        },
      };
      const options = {
        principalId: sample.context.profile.id,
        intentId: sample.context.intent.id,
        execute,
        abortSignal: new AbortController().signal,
        now: () => new Date("2026-09-21T00:00:00Z"),
      };
      const agent = mode === "single" ? new NegotiatorAgent(options) : new GatedNegotiator({ ...options, decisions });
      const started = performance.now();
      const row: Row = { case: sample.id, repeat, mode, expected: sample.expected, elapsedMs: 0 };
      try {
        const result: NegotiateResult = await agent.negotiate(structuredClone(sample.context));
        row.result = result;
        row.action = "turn" in result ? result.turn.action : "stall";
      } catch (error) {
        row.error = String(error);
      }
      row.elapsedMs = Math.round(performance.now() - started);
      rows.push(row);
      appendFileSync(join(directory, "results.jsonl"), JSON.stringify({ ...row, evidenceHash, prepared, modelCalls, jevCalls }) + "\n", { mode: 0o600 });
      console.log(`${repeat}/${REPEATS} ${sample.id} ${mode}: ${row.action ?? "ERROR"} (${row.elapsedMs} ms)`);
    }
  }
}

const percentile = (values: number[], fraction: number) => values[Math.ceil(values.length * fraction) - 1];
const summary = (["single", "jev-gate"] as const).map((mode) => {
  const samples = rows.filter((row) => row.mode === mode);
  const durations = samples.map((row) => row.elapsedMs).sort((a, b) => a - b);
  return {
    mode, runs: samples.length,
    correctActions: samples.filter((row) => row.action === row.expected).length,
    unsupportedAdvances: samples.filter((row) => ["stall", "decline"].includes(row.expected) && ["propose", "counter", "accept"].includes(row.action ?? "")).length,
    incorrectDeclines: samples.filter((row) => row.action === "decline" && row.expected !== "decline").length,
    unnecessaryPrincipalQuestionRequests: samples.filter((row) => row.action === "stall" && row.expected !== "stall").length,
    errors: samples.filter((row) => row.error).length,
    meanMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    medianMs: (durations[Math.floor((durations.length - 1) / 2)]! + durations[Math.floor(durations.length / 2)]!) / 2,
    p95Ms: percentile(durations, 0.95),
  };
});
writeFileSync(join(directory, "summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
console.log(JSON.stringify(summary, null, 2));
if (rows.some((row) => row.error)) process.exitCode = 1;
