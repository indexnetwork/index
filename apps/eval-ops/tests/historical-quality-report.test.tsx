import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HistoricalQualityReport } from '../src/components/HistoricalQualityReport';
import type { HistoricalQualityArtifact } from '../src/api/client';
import { COMPLETE_HISTORICAL_QUALITY_ARTIFACT, INCOMPLETE_HISTORICAL_QUALITY_ARTIFACT } from './historical-quality.fixture';

afterEach(cleanup);

const FORBIDDEN_QUALITY_TEXT = [
  /aggregate pass rate/i,
  /quality percentage/i,
  /baseline delta/i,
  /regression/i,
  /winner/i,
  /compare/i,
  /prompt/i,
  /profile/i,
  /citation/i,
  /reviewer/i,
];

function expectForbiddenQualityPresentationAbsent(container: HTMLElement) {
  expect(container.textContent).not.toContain('%');
  for (const forbidden of FORBIDDEN_QUALITY_TEXT) {
    expect(container.textContent).not.toMatch(forbidden);
  }
}

describe('HistoricalQualityReport', () => {
  it('renders complete case-by-trigger funnels and all 24 participant metrics per slot', () => {
    const { container } = render(
      <HistoricalQualityReport
        artifact={COMPLETE_HISTORICAL_QUALITY_ARTIFACT as HistoricalQualityArtifact}
      />,
    );

    expect(screen.getByText('10/10')).toBeInTheDocument();
    expect(screen.getAllByTestId('quality-slot')).toHaveLength(10);
    expect(screen.getAllByText('historical/case-1')).toHaveLength(2);
    expect(screen.getAllByText('intent', { selector: '[data-trigger]' })).toHaveLength(5);
    expect(screen.getAllByText('enrichment', { selector: '[data-trigger]' })).toHaveLength(5);

    const firstSlot = screen.getAllByTestId('quality-slot')[0]!;
    expect(within(firstSlot).getByText('stage funnel')).toBeInTheDocument();
    expect(within(firstSlot).getByText('target retrieval rank')).toBeInTheDocument();
    expect(within(firstSlot).getByText('target final rank')).toBeInTheDocument();
    expect(within(firstSlot).getByText('failure stages')).toBeInTheDocument();
    expect(within(firstSlot).getAllByTestId('participant-metric')).toHaveLength(24);
    expect(within(firstSlot).getByText('target', { selector: '[data-role]' })).toBeInTheDocument();
    expect(within(firstSlot).getAllByText('semantic-negative', { selector: '[data-role]' })).toHaveLength(3);
    expect(within(firstSlot).getAllByText('background', { selector: '[data-role]' })).toHaveLength(20);
    expect(within(firstSlot).getByText('retrieval rank')).toBeInTheDocument();
    expect(within(firstSlot).getByText('retrieval score')).toBeInTheDocument();
    expect(within(firstSlot).getByText('evidence type')).toBeInTheDocument();
    expect(within(firstSlot).getByText('eligible')).toBeInTheDocument();
    expect(within(firstSlot).getByText('submitted')).toBeInTheDocument();
    expect(within(firstSlot).getByText('returned')).toBeInTheDocument();
    expect(within(firstSlot).getByText('evaluator score')).toBeInTheDocument();
    expect(within(firstSlot).getByText('final rank')).toBeInTheDocument();
    expect(within(firstSlot).getByText('failure stage')).toBeInTheDocument();
    expect(screen.getByText(/restores the selected child before every measured slot/i)).toBeInTheDocument();
    expect(screen.getByText(/uses one attempt/i)).toBeInTheDocument();
    expectForbiddenQualityPresentationAbsent(container);
  });

  it('renders incomplete execution as unavailable without any funnel or participant rollup', () => {
    const { container } = render(
      <HistoricalQualityReport
        artifact={INCOMPLETE_HISTORICAL_QUALITY_ARTIFACT as HistoricalQualityArtifact}
      />,
    );

    expect(screen.getByText('9/10')).toBeInTheDocument();
    expect(screen.getByText(/quality verdict unavailable/i)).toBeInTheDocument();
    expect(screen.queryByTestId('quality-slot')).toBeNull();
    expect(screen.queryByText('stage funnel')).toBeNull();
    expect(screen.queryByTestId('participant-metric')).toBeNull();
    expectForbiddenQualityPresentationAbsent(container);
  });
});
