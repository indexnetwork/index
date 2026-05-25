/**
 * Tests for scripts/build-skills.ts
 *
 * Verifies partial injection, failure on unreplaced tokens, and
 * write-to-multiple-destinations behavior using temporary directories so
 * tests never touch the real output locations.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  writeFileSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  injectPartials,
  resolveClaudePluginOutputs,
  build,
} from '../build-skills.js';

describe('injectPartials', () => {
  test('replaces a known partial key', () => {
    const result = injectPartials('before {{CORE_GUIDANCE}} after', { CORE_GUIDANCE: 'injected' });
    expect(result).toBe('before injected after');
  });

  test('replaces the same partial multiple times', () => {
    const result = injectPartials('{{CORE_GUIDANCE}} and {{CORE_GUIDANCE}}', { CORE_GUIDANCE: 'x' });
    expect(result).toBe('x and x');
  });

  test('throws on unreplaced token', () => {
    expect(() => injectPartials('{{UNKNOWN}}', { CORE_GUIDANCE: 'x' })).toThrow(
      /Unreplaced tokens.*UNKNOWN/,
    );
  });

  test('throws on empty partials when template has tokens', () => {
    expect(() => injectPartials('{{FOO}}', {})).toThrow(/Unreplaced tokens/);
  });

  test('lists all distinct unreplaced tokens in the error message', () => {
    try {
      injectPartials('{{FOO}} and {{BAR}} and {{FOO}}', {});
      throw new Error('expected injectPartials to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('FOO');
      expect(message).toContain('BAR');
    }
  });

  test('preserves non-token braces and brackets verbatim', () => {
    const result = injectPartials('No tokens here, plain text with {single} and [brackets].', {});
    expect(result).toBe('No tokens here, plain text with {single} and [brackets].');
  });

  test('partial value containing braces does not cause false token errors', () => {
    const result = injectPartials('{{CORE_GUIDANCE}}', { CORE_GUIDANCE: 'plain text, no tokens' });
    expect(result).toBe('plain text, no tokens');
  });
});

describe('build', () => {
  let tmpDir: string;
  let templatePath: string;
  let output1: string;
  let output2: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'build-skills-'));
    templatePath = join(tmpDir, 'template.md');
    output1 = join(tmpDir, 'out1/SKILL.md');
    output2 = join(tmpDir, 'out2/nested/SKILL.md');
    writeFileSync(templatePath, '{{CORE_GUIDANCE}}\nstatic content');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes to both output paths', () => {
    build(templatePath, [output1, output2], { CORE_GUIDANCE: 'injected' });
    expect(existsSync(output1)).toBe(true);
    expect(existsSync(output2)).toBe(true);
    const expected = 'injected\nstatic content';
    expect(readFileSync(output1, 'utf8')).toBe(expected);
    expect(readFileSync(output2, 'utf8')).toBe(expected);
  });

  test('creates missing parent directories recursively', () => {
    const deep = join(tmpDir, 'a/b/c/d/SKILL.md');
    build(templatePath, [deep], { CORE_GUIDANCE: 'x' });
    expect(existsSync(deep)).toBe(true);
  });

  test('overwrites existing files on repeated runs', () => {
    build(templatePath, [output1], { CORE_GUIDANCE: 'first' });
    build(templatePath, [output1], { CORE_GUIDANCE: 'second' });
    expect(readFileSync(output1, 'utf8')).toContain('second');
  });

  test('propagates substitution errors', () => {
    writeFileSync(templatePath, 'bad {{UNKNOWN}}');
    expect(() => build(templatePath, [output1])).toThrow(/Unreplaced tokens/);
  });

  test('works with template that has no tokens (backward compatible)', () => {
    writeFileSync(templatePath, 'plain content');
    build(templatePath, [output1]);
    expect(readFileSync(output1, 'utf8')).toBe('plain content');
  });
});

describe('resolveClaudePluginOutputs', () => {
  test('returns correct paths for orchestrator and negotiator', () => {
    const outputs = resolveClaudePluginOutputs('/repo');
    expect(outputs.orchestrator).toEqual([
      '/repo/packages/claude-plugin/skills/index-orchestrator/SKILL.md',
    ]);
    expect(outputs.negotiator).toEqual([
      '/repo/packages/claude-plugin/skills/index-negotiator/SKILL.md',
    ]);
  });
});
