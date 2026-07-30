/**
 * Tests for FastSignalIntakeEnabledGuard — gates the deterministic fast-intake
 * funnel (/intents/intake/*). Throws Error('Not found') (mapped to 404 in
 * main.ts) when the FAST_SIGNAL_INTAKE flag is not exactly 'true'.
 *
 * Run: bun test src/guards/tests/fast-intake.guard.isolated.ts
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { FastSignalIntakeEnabledGuard } from '../fast-intake.guard';

const req = () => new Request('http://localhost/intents/intake/start', { method: 'POST' });
let prev: string | undefined;

describe('FastSignalIntakeEnabledGuard', () => {
  beforeEach(() => {
    prev = process.env.FAST_SIGNAL_INTAKE;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.FAST_SIGNAL_INTAKE;
    else process.env.FAST_SIGNAL_INTAKE = prev;
  });

  test('passes (returns void) when FAST_SIGNAL_INTAKE === "true"', async () => {
    process.env.FAST_SIGNAL_INTAKE = 'true';
    await expect(FastSignalIntakeEnabledGuard(req())).resolves.toBeUndefined();
  });

  test('throws "Not found" (→404) when FAST_SIGNAL_INTAKE === "false"', async () => {
    process.env.FAST_SIGNAL_INTAKE = 'false';
    await expect(FastSignalIntakeEnabledGuard(req())).rejects.toThrow('Not found');
  });

  test('throws "Not found" (→404) when FAST_SIGNAL_INTAKE is unset (disabled-when-unset)', async () => {
    delete process.env.FAST_SIGNAL_INTAKE;
    await expect(FastSignalIntakeEnabledGuard(req())).rejects.toThrow('Not found');
  });

  test('throws when FAST_SIGNAL_INTAKE is any non-"true" value', async () => {
    process.env.FAST_SIGNAL_INTAKE = '1';
    await expect(FastSignalIntakeEnabledGuard(req())).rejects.toThrow('Not found');
  });

  test('runs without requiring authentication — no user/session data is read from the request', async () => {
    // Guard signature only accepts the raw Request; it never inspects
    // Authorization headers or cookies, so it cannot depend on — or leak
    // information gated behind — authentication succeeding first.
    process.env.FAST_SIGNAL_INTAKE = 'false';
    const bareRequest = new Request('http://localhost/intents/intake/start', { method: 'POST' });
    await expect(FastSignalIntakeEnabledGuard(bareRequest)).rejects.toThrow('Not found');
  });
});
