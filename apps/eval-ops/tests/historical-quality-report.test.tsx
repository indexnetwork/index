import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HistoricalQualityReport } from '../src/components/HistoricalQualityReport';
import { groupHistoricalQualityCases } from '../src/lib/historical-quality';
import type { HistoricalQualityArtifact } from '../src/api/client';
import { COMPLETE_HISTORICAL_QUALITY_ARTIFACT, INCOMPLETE_HISTORICAL_QUALITY_ARTIFACT } from './historical-quality.fixture';

afterEach(cleanup);

const FORBIDDEN_QUALITY_TEXT = [
  /pass rate/i,
  /quality percentage/i,
  /baseline/i,
  /regression/i,
  /winner/i,
  /compar/i,
  /prompt/i,
  /profile/i,
  /citation/i,
  /reviewer/i,
  /raw log/i,
];

function expectForbiddenQualityPresentationAbsent(container: HTMLElement) {
  expect(container.textContent).not.toContain('%');
  for (const forbidden of FORBIDDEN_QUALITY_TEXT) {
    expect(container.textContent).not.toMatch(forbidden);
  }
}

describe('HistoricalQualityReport', () => {
  it('groups schema-validated rows deterministically by logical case and trigger', () => {
    const rows = [...COMPLETE_HISTORICAL_QUALITY_ARTIFACT.payload.cases].reverse();
    const groups = groupHistoricalQualityCases(rows);

    expect(groups).toHaveLength(10);
    expect(groups.map(({ logicalCaseId, trigger }) => `${logicalCaseId}:${trigger}`)).toEqual([
      'historical/case-1:enrichment',
      'historical/case-1:intent',
      'historical/case-2:enrichment',
      'historical/case-2:intent',
      'historical/case-3:enrichment',
      'historical/case-3:intent',
      'historical/case-4:enrichment',
      'historical/case-4:intent',
      'historical/case-5:enrichment',
      'historical/case-5:intent',
    ]);
    expect(groups[0]).toMatchObject({
      repetitions: [0, 1, 2],
      completedRepetitions: 3,
      requestedRepetitions: 3,
      targetRetrievalRanks: [1, 1, 1],
      targetFinalRanks: [1, 1, 1],
      stageFunnel: {
        slots: 3,
        participants: 72,
        target: { total: 3, finalIncluded: 3 },
        semanticNegatives: { total: 9, finalIncluded: 9 },
        backgrounds: { total: 60, finalIncluded: 60 },
        failureStages: { none: 72 },
      },
    });
  });

  it('renders one complete group per case and trigger with per-repetition participant evidence', () => {
    const { container } = render(
      <HistoricalQualityReport
        artifact={COMPLETE_HISTORICAL_QUALITY_ARTIFACT as HistoricalQualityArtifact}
      />,
    );

    expect(screen.getByText('30/30')).toBeInTheDocument();
    expect(screen.getAllByTestId('quality-group')).toHaveLength(10);
    expect(screen.getAllByText('historical/case-1')).toHaveLength(2);
    expect(screen.getAllByText('intent', { selector: '[data-trigger]' })).toHaveLength(5);
    expect(screen.getAllByText('enrichment', { selector: '[data-trigger]' })).toHaveLength(5);

    const firstGroup = screen.getAllByTestId('quality-group')[0]!;
    expect(within(firstGroup).getByText('stage funnel')).toBeInTheDocument();
    expect(within(firstGroup).getByText('3/3 repetitions')).toBeInTheDocument();
    expect(within(firstGroup).getByText('target retrieval rank distribution')).toBeInTheDocument();
    expect(within(firstGroup).getByText('target final rank distribution')).toBeInTheDocument();
    expect(within(firstGroup).getByText('failure stages')).toBeInTheDocument();
    expect(within(firstGroup).getAllByTestId('participant-repetition')).toHaveLength(3);
    expect(within(firstGroup).getAllByTestId('participant-metric')).toHaveLength(72);
    expect(within(firstGroup).getAllByText('target', { selector: '[data-role]' })).toHaveLength(3);
    expect(within(firstGroup).getAllByText('semantic-negative', { selector: '[data-role]' })).toHaveLength(9);
    expect(within(firstGroup).getAllByText('background', { selector: '[data-role]' })).toHaveLength(60);
    expect(within(firstGroup).getAllByText('retrieval rank')).toHaveLength(3);
    expect(within(firstGroup).getAllByText('retrieval score')).toHaveLength(3);
    expect(within(firstGroup).getAllByText('evidence type')).toHaveLength(3);
    expect(within(firstGroup).getAllByText('eligible')).toHaveLength(3);
    expect(within(firstGroup).getAllByText('submitted')).toHaveLength(3);
    expect(within(firstGroup).getAllByText('returned')).toHaveLength(3);
    expect(within(firstGroup).getAllByText('evaluator score')).toHaveLength(3);
    expect(within(firstGroup).getAllByText('final rank')).toHaveLength(3);
    expect(within(firstGroup).getAllByText('failure stage')).toHaveLength(3);
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

    expect(screen.getByText('29/30')).toBeInTheDocument();
    expect(screen.getByText(/quality verdict unavailable/i)).toBeInTheDocument();
    expect(screen.queryByTestId('quality-group')).toBeNull();
    expect(screen.queryByText('stage funnel')).toBeNull();
    expect(screen.queryByTestId('participant-metric')).toBeNull();
    expectForbiddenQualityPresentationAbsent(container);
  });
});
