#!/usr/bin/env bun
/**
 * NEGOTIATOR_STANCE live eval (IND-611).
 *
 *   cd packages/protocol
 *   bun run eval:stance                       # all stances, all cases, 3 runs
 *   bun run eval:stance -- --runs 1           # cheap smoke
 *   bun run eval:stance -- --stance skeptic   # one stance only
 *   bun run eval:stance -- --case low/stage-mismatch
 *   bun run eval:stance -- --json eval/stance/runs/out.json   # gitignored
 *
 * Plays each corpus negotiation to termination under each stance and reports
 * decline rate on low-value versus high-value fixtures. The headline is
 * DISCRIMINATION (low decline rate − high decline rate), not raw pessimism: a
 * stance that declines everything scores zero.
 *
 * This harness has no committed baseline and never writes one — the numbers are
 * reported into the PR, and the question ("do the stances change behaviour at
 * all?") is answered by the run, not by a pass/fail gate. It exits 0 on a null
 * result by design. Tuning the corpus until a difference appears would destroy
 * the only thing it measures.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { NEGOTIATOR_STANCES, type NegotiatorStance } from "../../src/negotiation/domain/negotiation.stance.contracts.js";
import { CASES } from "./stance.cases.js";
import { DEFAULT_MAX_TURNS, runNegotiation } from "./stance.runner.js";
import { compareToBaseline, renderScoreTable, scoreStance } from "./stance.scorer.js";
import type { StanceRunResult } from "./stance.types.js";

interface Options {
  runs: number;
  stances: NegotiatorStance[];
  caseFilter?: string;
  maxTurns: number;
  json?: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { runs: 3, stances: [...NEGOTIATOR_STANCES], maxTurns: DEFAULT_MAX_TURNS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(
        "usage: bun run eval:stance -- [--runs N] [--stance advocate|evaluator|skeptic] [--case <id prefix>] [--max-turns N] [--json <path>]\n" +
          "       paths are relative to packages/protocol; eval/stance/runs/ is gitignored",
      );
      process.exit(0);
    } else if (arg === "--runs") {
      opts.runs = Number(argv[++i]);
    } else if (arg === "--max-turns") {
      opts.maxTurns = Number(argv[++i]);
    } else if (arg === "--stance") {
      const value = argv[++i] as NegotiatorStance;
      if (!NEGOTIATOR_STANCES.includes(value)) {
        console.error(`unknown stance: ${value} (expected one of ${NEGOTIATOR_STANCES.join(", ")})`);
        process.exit(2);
      }
      opts.stances = [value];
    } else if (arg === "--case") {
      opts.caseFilter = argv[++i];
    } else if (arg === "--json") {
      opts.json = argv[++i];
    } else {
      console.error(`unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(opts.runs) || opts.runs < 1) {
    console.error("--runs must be a positive integer");
    process.exit(2);
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const cases = opts.caseFilter ? CASES.filter((c) => c.id.startsWith(opts.caseFilter!)) : CASES;
  if (cases.length === 0) {
    console.error(`no cases match --case ${opts.caseFilter}`);
    process.exit(2);
  }

  const originalStance = process.env.NEGOTIATOR_STANCE;
  const results: StanceRunResult[] = [];

  console.log(
    `stance eval — ${opts.stances.length} stance(s) × ${cases.length} case(s) × ${opts.runs} run(s), max ${opts.maxTurns} turns\n`,
  );

  for (const stance of opts.stances) {
    process.env.NEGOTIATOR_STANCE = stance;
    console.log(`── ${stance} ──`);
    for (const c of cases) {
      for (let run = 1; run <= opts.runs; run++) {
        const result = await runNegotiation(c, stance, run, opts.maxTurns);
        results.push(result);
        const detail = result.error
          ? `error: ${result.error}`
          : `${result.verdict}${result.terminalAction ? ` (${result.terminalAction}${result.refusedAtTurnZero ? ", turn 0" : ""})` : ""} after ${result.turns.length} turn(s)`;
        console.log(`  ${c.id} [${c.value}] run ${run}: ${detail}`);
      }
    }
    console.log("");
  }

  if (originalStance === undefined) delete process.env.NEGOTIATOR_STANCE;
  else process.env.NEGOTIATOR_STANCE = originalStance;

  const scores = opts.stances.map((stance) => scoreStance(stance, results));
  console.log(renderScoreTable(scores));

  const baseline = scores.find((s) => s.stance === "advocate");
  if (baseline) {
    console.log("\nversus advocate:");
    for (const score of scores.filter((s) => s.stance !== "advocate")) {
      const cmp = compareToBaseline(baseline, score);
      console.log(
        `  ${cmp.stance}: low-value decline ${cmp.lowValueDeclineDelta >= 0 ? "+" : ""}${(cmp.lowValueDeclineDelta * 100).toFixed(0)}pp, ` +
          `high-value decline ${cmp.highValueDeclineDelta >= 0 ? "+" : ""}${(cmp.highValueDeclineDelta * 100).toFixed(0)}pp ` +
          `⇒ ${cmp.materialLowValueGain ? "material gain" : "no material gain"}${cmp.lostGoodMatches ? ", LOST good matches" : ""}`,
      );
    }
    console.log(
      "\nA null result (no material gain) is a legitimate finding. Report it; do not tune the corpus until a difference appears.",
    );
  }

  const errors = results.filter((r) => r.error);
  if (errors.length > 0) console.log(`\n${errors.length} run(s) errored and were excluded from the rates.`);

  if (opts.json) {
    mkdirSync(dirname(opts.json), { recursive: true });
    writeFileSync(opts.json, JSON.stringify({ options: opts, scores, results }, null, 2));
    console.log(`\nwrote ${opts.json}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(2);
});
