#!/usr/bin/env bun
import { IntentClarifier } from "../../src/intent/intent.clarifier.js";
import { CASES } from "./clarification.cases.js";
import { runCase } from "./clarification.runner.js";
import { scoreCase } from "./clarification.scorer.js";

async function main(): Promise<void> {
  const clarifier = new IntentClarifier();
  let failures = 0;

  console.log(`Running ${CASES.length} clarification taxonomy cases…`);
  for (const c of CASES) {
    process.stdout.write(`  ${c.id} … `);
    const result = scoreCase(c, await runCase(clarifier, c));
    if (!result.passed) failures += 1;
    console.log(
      result.passed
        ? `pass (${String(result.actualType)})`
        : `fail (expected ${String(result.expectedType)}, got ${String(result.actualType)})`,
    );
  }

  console.log(`\n${CASES.length - failures}/${CASES.length} exact type matches`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(2);
});
