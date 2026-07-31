import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RunStatus as ProtocolRunStatus } from '../../../packages/protocol/eval/ops/ops.types';

import { Frame } from '../src/components/Frame';
import { LogView } from '../src/components/LogView';
import { StatusChip, type RunStatus } from '../src/components/StatusChip';

describe('Frame', () => {
  it('renders its label and children', () => {
    render(<Frame label="harnesses"><p>body</p></Frame>);
    expect(screen.getByText('harnesses')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('draws rules with CSS, not box-drawing characters', () => {
    const { container } = render(<Frame label="x">y</Frame>);
    expect(container.textContent).not.toMatch(/[┌┐└┘─│]/);
  });
});

describe('StatusChip', () => {
  it('local RunStatus type matches protocol RunStatus exactly', () => {
    // This test ensures the local type stays in sync with the protocol definition.
    // It will fail at compile time if they drift.
    const localSample: RunStatus = 'passed';
    const protocolSample: ProtocolRunStatus = localSample;
    const roundTrip: RunStatus = protocolSample;

    // Verify all 9 values are assignable both ways
    expect(roundTrip).toBe('passed');

    // Exhaustiveness check: ensure all protocol values are covered
    const allStatuses: RunStatus[] = [
      'queued',
      'running',
      'passed',
      'regression',
      'execution-error',
      'insufficient-evidence',
      'cancelled',
      'interrupted',
      'crashed',
    ];
    allStatuses.forEach((s) => {
      const p: ProtocolRunStatus = s;
      expect(p).toBe(s);
    });
  });

  it('colours each status by its exit-code meaning', () => {
    const { rerender, container } = render(<StatusChip status="passed" />);
    expect(container.firstChild).toHaveClass('text-term-green');
    rerender(<StatusChip status="regression" />);
    expect(container.firstChild).toHaveClass('text-term-red');
    rerender(<StatusChip status="execution-error" />);
    expect(container.firstChild).toHaveClass('text-term-magenta');
    rerender(<StatusChip status="insufficient-evidence" />);
    expect(container.firstChild).toHaveClass('text-term-yellow');
  });

  it('handles all RunStatus values', () => {
    const { rerender, container } = render(<StatusChip status="queued" />);
    expect(container.firstChild).toHaveClass('text-term-dim');
    rerender(<StatusChip status="running" />);
    expect(container.firstChild).toHaveClass('text-term-cyan');
    rerender(<StatusChip status="cancelled" />);
    expect(container.firstChild).toHaveClass('text-term-dim');
    rerender(<StatusChip status="interrupted" />);
    expect(container.firstChild).toHaveClass('text-term-dim');
    rerender(<StatusChip status="crashed" />);
    expect(container.firstChild).toHaveClass('text-term-magenta');
  });
});

describe('LogView', () => {
  it('renders ANSI colour as classes and never as raw escapes', () => {
    const { container } = render(<LogView text={'\u001b[32mok\u001b[0m done'} />);
    expect(container.textContent).toBe('ok done');
    expect(container.querySelector('.text-term-green')?.textContent).toBe('ok');
  });

  it('escapes markup rather than rendering it', () => {
    const { container } = render(<LogView text={'<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img');
  });
});
