import { afterEach, describe, expect, it, test } from 'bun:test';

import { getSignalIntakeConfig, getSignalIntakeMaxQuestions, isFastSignalIntakeEnabled } from '../fast-intake-feature';

const original = process.env.FAST_SIGNAL_INTAKE;
const prevMax = process.env.SIGNAL_INTAKE_MAX_QUESTIONS;

afterEach(() => {
  if (original === undefined) delete process.env.FAST_SIGNAL_INTAKE;
  else process.env.FAST_SIGNAL_INTAKE = original;
  if (prevMax === undefined) delete process.env.SIGNAL_INTAKE_MAX_QUESTIONS;
  else process.env.SIGNAL_INTAKE_MAX_QUESTIONS = prevMax;
});

describe('isFastSignalIntakeEnabled', () => {
  it('is disabled by default', () => {
    delete process.env.FAST_SIGNAL_INTAKE;
    expect(isFastSignalIntakeEnabled()).toBe(false);
  });

  it('is enabled only for the exact string "true"', () => {
    process.env.FAST_SIGNAL_INTAKE = 'true';
    expect(isFastSignalIntakeEnabled()).toBe(true);
    for (const value of ['TRUE', '1', 'yes', 'false', '']) {
      process.env.FAST_SIGNAL_INTAKE = value;
      expect(isFastSignalIntakeEnabled()).toBe(false);
    }
  });
});

describe('SIGNAL_INTAKE_MAX_QUESTIONS', () => {
  test('defaults to 2 when unset', () => {
    delete process.env.SIGNAL_INTAKE_MAX_QUESTIONS;
    expect(getSignalIntakeMaxQuestions()).toBe(2);
  });

  test('parses a valid integer', () => {
    process.env.SIGNAL_INTAKE_MAX_QUESTIONS = '5';
    expect(getSignalIntakeMaxQuestions()).toBe(5);
  });

  test('clamps into [1, 10]', () => {
    process.env.SIGNAL_INTAKE_MAX_QUESTIONS = '0';
    expect(getSignalIntakeMaxQuestions()).toBe(1);
    process.env.SIGNAL_INTAKE_MAX_QUESTIONS = '99';
    expect(getSignalIntakeMaxQuestions()).toBe(10);
  });

  test('falls back to 2 on garbage', () => {
    process.env.SIGNAL_INTAKE_MAX_QUESTIONS = 'abc';
    expect(getSignalIntakeMaxQuestions()).toBe(2);
    process.env.SIGNAL_INTAKE_MAX_QUESTIONS = '2.5';
    expect(getSignalIntakeMaxQuestions()).toBe(2);
  });
});

describe('getSignalIntakeConfig', () => {
  test('reports the question budget', () => {
    process.env.SIGNAL_INTAKE_MAX_QUESTIONS = '4';
    expect(getSignalIntakeConfig()).toEqual({ maxQuestions: 4 });
  });
});
