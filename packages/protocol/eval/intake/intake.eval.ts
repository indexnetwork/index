#!/usr/bin/env bun
import { SignalIntakeOrchestrator } from "../../src/intents/application/intake.orchestrator.js";
import { getModelName } from "../../src/shared/agent/model.config.js";
import { assertLLM } from "../../src/shared/agent/tests/llm-assert.js";
import { CASES } from "./intake.cases.js";
import { runCase } from "./intake.runner.js";
import { buildJudgeCriteria, scoreCase } from "./intake.scorer.js";

interface Options {
  runs: number;
  caseFilter?: string;
  listCases: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { runs: 3, listCases: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(
        "usage: bun run eval:intake -- [--runs N] [--case <id prefix>] [--list-cases]\n" +
          "Runs the real signal-intake follow-up planner; requires OPENROUTER_API_KEY.",
      );
      process.exit(0);
    } else if (arg === "--runs") {
      options.runs = Number(argv[++index]);
    } else if (arg === "--case") {
      options.caseFilter = argv[++index];
    } else if (arg === "--list-cases") {
      options.listCases = true;
    } else {
      console.error(`unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 10) {
    console.error("--runs must be an integer between 1 and 10");
    process.exit(2);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const cases = options.caseFilter
    ? CASES.filter((candidate) => candidate.id.startsWith(options.caseFilter!))
    : CASES;

  if (options.listCases) {
    for (const c of cases) console.log(`${c.id}\t${c.description}`);
    return;
  }
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY is required; run through `bun run eval:intake` so ../../.env.test is loaded.");
    process.exit(2);
  }
  if (cases.length === 0) {
    console.error(`no cases match --case ${options.caseFilter}`);
    process.exit(2);
  }

  const orchestrator = new SignalIntakeOrchestrator();
  const model = getModelName("signalIntakePack");
  let failures = 0;
  console.log(`intake eval — ${cases.length} case(s) × ${options.runs} run(s) against ${model}\n`);

  for (const c of cases) {
    console.log(`── ${c.id} ──`);
    for (let run = 1; run <= options.runs; run++) {
      try {
        const result = scoreCase(c, await runCase(orchestrator, c));
        let judgePassed = false;
        let judgeFailure: string | null = null;
        if (result.passed) {
          try {
            await assertLLM(result.output.questions[0], buildJudgeCriteria(c));
            judgePassed = true;
          } catch (error) {
            judgeFailure = error instanceof Error ? error.message : String(error);
          }
        } else {
          judgeFailure = "skipped because deterministic checks failed";
        }
        const passed = result.passed && judgePassed;
        if (!passed) failures += 1;
        const question = result.output.questions[0];
        console.log(
          `  run ${run}: ${passed ? "pass" : "FAIL"} ` +
            `(domain ${result.domainOptionCount}/${c.minDomainOptions}, profile ${result.profileOptionCount}/${c.maxProfileOptions}, prompt ${result.promptRelevant ? "yes" : "no"}, fallback ${result.usedFallback ? "yes" : "no"}, judge ${judgePassed ? "pass" : "fail"})`,
        );
        console.log(`    Q: ${question?.prompt ?? "(none)"}`);
        console.log(`    options: ${(question?.options ?? []).map((option) => option.label).join(" | ") || "(none)"}`);
        if (judgeFailure) console.log(`    judge: ${judgeFailure}`);
      } catch (error) {
        failures += 1;
        console.log(`  run ${run}: ERROR ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log("");
  }

  const total = cases.length * options.runs;
  console.log(`${total - failures}/${total} live intake runs passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(2);
});
