/**
 * Smartest runner: resolve fixtures, invoke SUT, run verification.
 * Does not log to console; returns a report (timings) and verification.reasoning
 * so tests can use expectSmartest(result) and get a single, bun-test-friendly failure message.
 */

import type { RunScenarioResult, RunScenarioOptions, RunScenarioReport, SmartestScenario } from './smartest.types';
import { resolveFixtures, resolveInputRefs } from './smartest.fixtures';
import { mergeGeneratorRegistry } from './smartest.generators';
import { getSmartestVerifierModel } from './smartest.config';
import { runSchemaCheck, runLlmVerifier } from './smartest.verifier';

/**
 * Run a single scenario: generate fixtures, resolve input refs, invoke SUT, verify.
 * All data is in-memory; nothing is persisted.
 * Pass options.generators to override or extend the default generator registry.
 * Returns pass, output, verification (with reasoning), schemaError, and report (timings).
 * Use expectSmartest(result) in tests so failures surface reasoning via bun test output.
 */
export async function runScenario(
  scenario: SmartestScenario,
  options?: RunScenarioOptions
): Promise<RunScenarioResult> {
  const startTotal = Date.now();
  const phases: Record<string, number> = {};

  const registry = mergeGeneratorRegistry(options?.generators);

  let t0 = Date.now();
  const resolved = await resolveFixtures(scenario, registry);
  const resolvedInput = resolveInputRefs(scenario.sut.input, resolved);
  phases.resolveFixtures = Date.now() - t0;

  t0 = Date.now();
  const instance = scenario.sut.factory();
  const output = await scenario.sut.invoke(instance, resolvedInput);
  phases.invoke = Date.now() - t0;

  const { verification: config } = scenario;
  const llmVerify = config.llmVerify !== false;

  const report: RunScenarioReport = {
    scenarioName: scenario.name,
    phases: { ...phases },
    totalMs: 0,
  };

  if (config.schema) {
    t0 = Date.now();
    const schemaResult = runSchemaCheck(output, config.schema);
    phases.schemaCheck = Date.now() - t0;
    report.phases = { ...phases };
    if (!schemaResult.ok) {
      report.totalMs = Date.now() - startTotal;
      return {
        pass: false,
        output,
        schemaError: schemaResult.error,
        report,
      };
    }
  }

  if (!llmVerify) {
    report.phases = { ...phases };
    report.totalMs = Date.now() - startTotal;
    return {
      pass: true,
      output,
      report,
    };
  }

  report.verifierModel = getSmartestVerifierModel();
  t0 = Date.now();
  const verification = await runLlmVerifier(
    scenario.description,
    resolvedInput,
    output,
    config.criteria
  );
  phases.llmVerifier = Date.now() - t0;
  report.phases = { ...phases };
  report.totalMs = Date.now() - startTotal;

  return {
    pass: verification.pass,
    output,
    verification,
    report,
  };
}
