import { describe, expect, test } from 'bun:test';
import { detectBaseline } from '../src/baseline.ts';
import { annotateTrace } from '../src/annotate/run.ts';
import { RecordedCompleter } from '../src/annotate/completer.ts';
import { corruptQuotes, replayFixtures, scoreDetection } from '../src/eval.ts';
import { fixtures } from './helpers.ts';

describe('recorded annotations replayed through the verifier', () => {
  test('every recorded quote verifies and the stored findings match the scripted gold', async () => {
    const all = await fixtures();
    const { report } = await replayFixtures('recorded', all);
    expect(report.quoteVerifiedRate).toBe(1);
    expect(report.detection.overall.precision).toBe(1);
    expect(report.detection.overall.recall).toBe(1);
    expect(report.authorityExceeded.fp).toBe(0);
    expect(report.authorityExceeded.fn).toBe(0);
    expect(report.outcomeClassAgreement.matched).toBe(report.outcomeClassAgreement.total);
    expect(report.responseAgreement.matched).toBe(report.responseAgreement.total);
  });

  test('invented quotes are all dropped and nothing ungrounded is stored', async () => {
    const all = await fixtures();
    const { report, records } = await replayFixtures('corrupted', all, corruptQuotes);
    expect(report.kept).toBe(0);
    expect(report.emitted).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.findings).toHaveLength(0);
      expect(record.statements).toHaveLength(0);
      expect(record.claims).toHaveLength(0);
      expect(record.turnActs.every((act) => act.authorityVerdict === 'unclear' && !act.annotated)).toBe(true);
    }
  });

  test('a supported claim that cites no verified mandate statement is dropped', async () => {
    const all = await fixtures();
    const fixture = all.find((item) => item.id === 'fx11-benign-question');
    if (!fixture) throw new Error('fixture missing');
    const bundle = structuredClone(fixture.annotations);
    bundle.mandate.statements = [];
    const record = await annotateTrace(fixture.trace, new RecordedCompleter(bundle));
    expect(record.claims).toHaveLength(0);
    expect(record.dropped.some((item) => item.layer === 'claims')).toBe(true);
  });

  test('an annotator cannot force a performative the protocol action does not allow', async () => {
    const all = await fixtures();
    const fixture = all.find((item) => item.id === 'fx09-authority-bait-held');
    if (!fixture) throw new Error('fixture missing');
    const bundle = structuredClone(fixture.annotations);
    const act = bundle.acts.acts.find((item) => item.turnIndex === 3);
    if (!act) throw new Error('act missing');
    act.performative = 'refuse';
    const record = await annotateTrace(fixture.trace, new RecordedCompleter(bundle));
    expect(record.turnActs.find((item) => item.turnIndex === 3)?.performative).toBe('accept-proposal');
    expect(record.dropped.some((item) => item.reason.includes('not allowed'))).toBe(true);
  });

  test('missed-opportunity needs a verified quote and a declined agent verdict', async () => {
    const all = await fixtures();
    const fixture = all.find((item) => item.id === 'fx10-missed-opportunity');
    if (!fixture) throw new Error('fixture missing');
    const forged = structuredClone(fixture.annotations);
    forged.findings.missedOpportunityQuote = 'a reason that is nowhere in the record';
    const record = await annotateTrace(fixture.trace, new RecordedCompleter(forged));
    expect(record.outcome.outcomeClass).toBe('unresolved');
  });
});

describe('baseline keyword detector', () => {
  test('is measured against the same gold and reports its own false positives and misses', async () => {
    const all = await fixtures();
    const report = scoreDetection('baseline', all.map((item) => ({ id: item.id, gold: item.gold.findings, predicted: detectBaseline(item.trace) })));
    expect(report.perKind.selective_misrepresentation.recall).toBe(0);
    expect(report.falsePositives.some((item) => item.id === 'fx13-injection-phrase-topic')).toBe(true);
    expect(report.overall.recall).toBeGreaterThan(0.5);
  });
});
