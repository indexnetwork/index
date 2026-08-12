import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const intakeSource = readFileSync(new URL('../src/ui/new-intent.jsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/ui/app.jsx', import.meta.url), 'utf8');
const macWorkflow = readFileSync(new URL('../../../.github/workflows/mac-app-build.yml', import.meta.url), 'utf8');

describe('macOS fast signal intake parity with web', () => {
  it('overlaps speculative preparation with an explicit where step', () => {
    expect(intakeSource).toContain('fastPrepare.current = client.intents.intake.prepare({ rounds });');
    expect(intakeSource).toContain('showFastWhere();');
    expect(intakeSource).not.toContain('fastPrepare.current.then((r) => { fastRunId.current = r.runId; }).catch(() => {});\n    fastResolve();');
    expect(intakeSource).toContain('fast: "where"');
    expect(intakeSource).toContain('where should we look?');
    expect(intakeSource).toContain('Everywhere');
    expect(intakeSource).toContain('Somewhere more specific?');
    expect(intakeSource).toContain('!network.isPersonal');
  });

  it('carries the selected where choice through proposal and confirmation', () => {
    expect(intakeSource).toContain('...fastChoice.current');
    expect(intakeSource).toContain('...(fastChoice.current.networkId ? { networkId: fastChoice.current.networkId } : {})');
  });

  it('runs this parity contract in macOS CI', () => {
    expect(macWorkflow).toContain('api/intent-intake-ui.spec.mjs');
  });

  it('opens the exact confirmed signal without a forced delay or blocking snapshot reload', () => {
    expect(intakeSource).not.toMatch(/setTimeout\(r, created \? 1200 : 2000\)/);
    expect(intakeSource).toContain('onDone(completedAnswers, created, intentIdRef.current);');

    const finishStart = appSource.indexOf('const finishNewIntent = async');
    const finishEnd = appSource.indexOf('\n\n  // Open a chat from the menubar', finishStart);
    const finishSource = appSource.slice(finishStart, finishEnd);
    expect(finishSource).toContain('if (created && intentId)');
    expect(finishSource).toContain('id: intentId');
    expect(finishSource).toContain('void refreshIntents();');
    expect(finishSource.indexOf('if (created && intentId)')).toBeLessThan(finishSource.indexOf('loadSnapshot()'));
  });
});
