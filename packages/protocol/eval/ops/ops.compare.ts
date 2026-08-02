import { diffBaseline, type BaselineDiff, type EvalArtifactEnvelope } from "../shared/index.js";

export interface ComparabilityFinding {
  dimension: "harness" | "corpusFingerprint" | "configFingerprint" | "selection";
  reference: string;
  subject: string;
}

export type CompareOutcome =
  | { comparable: false; findings: ComparabilityFinding[] }
  | {
      comparable: true;
      /** Cases where the subject is significantly worse than the reference. */
      regressions: BaselineDiff;
      /** The reversed direction: cases where the reference is significantly worse, i.e. the subject improved. */
      improvements: BaselineDiff;
      aggregate: { reference: number; subject: number; delta: number };
    };

const selectionKey = (envelope: EvalArtifactEnvelope): string =>
  JSON.stringify({
    fullCorpus: envelope.selection.fullCorpus,
    filters: Object.fromEntries(Object.entries(envelope.selection.filters).sort()),
  });

/**
 * Compares two eval artifacts, refusing outright when they are not comparable.
 *
 * Significance uses `diffBaseline`, the same one-sided beta-binomial
 * posterior-predictive test the CLI uses. Because that test is one-sided, both
 * directions are evaluated: `regressions` asks "is the subject worse?" and
 * `improvements` asks the reverse. This is not a symmetric two-sided test and
 * must not be presented as one.
 *
 * `opts.allowConfigMismatch` drops the config-fingerprint refusal for
 * run-vs-run A/B comparison, where the configuration difference is the
 * variable under test rather than evidence of an invalid comparison. Every
 * other dimension still refuses. Artifact compare keeps the refusal: a
 * committed baseline under a non-default config is a governance smell, not an
 * experiment.
 */
export function compareArtifacts(
  reference: EvalArtifactEnvelope,
  subject: EvalArtifactEnvelope,
  alpha = 0.05,
  opts: { allowConfigMismatch?: boolean } = {},
): CompareOutcome {
  const findings: ComparabilityFinding[] = [];
  if (reference.harness !== subject.harness) {
    findings.push({ dimension: "harness", reference: reference.harness, subject: subject.harness });
  }
  if (reference.corpusFingerprint !== subject.corpusFingerprint) {
    findings.push({
      dimension: "corpusFingerprint",
      reference: reference.corpusFingerprint,
      subject: subject.corpusFingerprint,
    });
  }
  if (!opts.allowConfigMismatch && reference.configFingerprint !== subject.configFingerprint) {
    findings.push({
      dimension: "configFingerprint",
      reference: reference.configFingerprint,
      subject: subject.configFingerprint,
    });
  }
  if (selectionKey(reference) !== selectionKey(subject)) {
    findings.push({ dimension: "selection", reference: selectionKey(reference), subject: selectionKey(subject) });
  }
  if (findings.length > 0) return { comparable: false, findings };

  return {
    comparable: true,
    regressions: diffBaseline(subject.payload, reference.payload, alpha),
    improvements: diffBaseline(reference.payload, subject.payload, alpha),
    aggregate: {
      reference: reference.payload.aggregatePassRate,
      subject: subject.payload.aggregatePassRate,
      delta: subject.payload.aggregatePassRate - reference.payload.aggregatePassRate,
    },
  };
}
