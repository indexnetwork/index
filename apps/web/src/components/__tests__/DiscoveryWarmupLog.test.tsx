/**
 * The radar's warmup card. What is load-bearing here is honesty, not chrome:
 *
 *  - every log line is derived from a durable timestamp, so a reload rebuilds
 *    the identical log and nothing is stamped with "now";
 *  - a completed run that found nothing still reports its tallies — an empty
 *    card would read as "the agent never ran";
 *  - a signal with no active community says so instead of showing a scan that
 *    cannot start;
 *  - a signal with no durable row admits the status is unavailable rather than
 *    inventing a run out of freshness.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import DiscoveryWarmupLog from '../DiscoveryWarmupLog';
import { buildWarmupLog, formatLogClock } from '@/lib/discovery-warmup-log';
import type { DiscoveryProgress } from '@/services/intents';

const QUEUED_AT = '2026-08-19T09:14:00.000Z';
const STARTED_AT = '2026-08-19T09:15:00.000Z';
const COMPLETED_AT = '2026-08-19T09:21:00.000Z';

const progress = (overrides: Partial<DiscoveryProgress> = {}): DiscoveryProgress => ({
  status: 'running',
  attempt: 1,
  maxAttempts: 3,
  assignedCommunityCount: 4,
  processedCommunityCount: 0,
  possibleOverlapCount: 0,
  conversationsStartedCount: 0,
  queuedAt: QUEUED_AT,
  startedAt: STARTED_AT,
  completedAt: null,
  updatedAt: STARTED_AT,
  ...overrides,
});

const communities = [
  { id: 'c1', title: 'Builders' },
  { id: 'c2', title: 'Climate Founders' },
];

const logLines = () =>
  within(screen.getByTestId('discovery-warmup-log'))
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '');

describe('DiscoveryWarmupLog states', () => {
  it('queued: shows discovery waiting to scan', () => {
    render(
      <DiscoveryWarmupLog
        progress={progress({ status: 'queued', startedAt: null, updatedAt: QUEUED_AT })}
        communities={communities}
      />,
    );

    expect(screen.getByTestId('discovery-warmup-status')).toHaveTextContent('queued');
    expect(screen.getByText('Finding your first matches')).toBeInTheDocument();
    expect(screen.getByText('Queued — 4 communities to scan.')).toBeInTheDocument();
    expect(logLines().join('\n')).toContain('queued');
  });

  it('running: narrates the run in progress and says the page can be left', () => {
    render(<DiscoveryWarmupLog progress={progress()} communities={communities} />);

    expect(screen.getByTestId('discovery-warmup-status')).toHaveTextContent('scanning');
    expect(screen.getByText('Finding your first matches')).toBeInTheDocument();
    expect(screen.getByText('Scanning 4 communities for possible overlaps.')).toBeInTheDocument();
    expect(logLines().join('\n')).toContain('scanning 4 communities…');
    expect(screen.getByText(/matching continues in the background/i)).toBeInTheDocument();
  });

  it('retrying: names the attempt out of its cap', () => {
    render(
      <DiscoveryWarmupLog
        progress={progress({ status: 'retrying', attempt: 2 })}
        communities={communities}
      />,
    );

    expect(screen.getByTestId('discovery-warmup-status')).toHaveTextContent('retrying');
    expect(logLines().join('\n')).toContain('attempt 2 of 3 — retrying');
  });

  it('blocked: says matching cannot begin, and does not claim a scan', () => {
    render(
      <DiscoveryWarmupLog
        progress={progress({ status: 'blocked', assignedCommunityCount: 0, startedAt: null, completedAt: COMPLETED_AT })}
        communities={[]}
      />,
    );

    expect(screen.getByTestId('discovery-warmup-status')).toHaveTextContent('blocked');
    expect(screen.getByText('Scanning is paused')).toBeInTheDocument();
    expect(screen.getByText(/can’t begin until this signal is shared with an active community/i)).toBeInTheDocument();
    // The run never started, so no log line may claim communities were scanned.
    expect(logLines().join('\n')).not.toMatch(/scann(ing|ed)/i);
    expect(screen.queryByText(/matching continues in the background/i)).toBeNull();
  });

  it('blocked: an intent with no community is paused even when the row says otherwise', () => {
    render(<DiscoveryWarmupLog progress={progress({ status: 'running' })} communities={[]} />);

    expect(screen.getByTestId('discovery-warmup-status')).toHaveTextContent('blocked');
    expect(screen.getByText('Scanning is paused')).toBeInTheDocument();
  });

  it('failed: reports the stopped attempt without promising a retry', () => {
    render(
      <DiscoveryWarmupLog
        progress={progress({ status: 'failed', attempt: 3 })}
        communities={communities}
      />,
    );

    expect(screen.getByTestId('discovery-warmup-status')).toHaveTextContent('failed');
    expect(screen.getByText('Scanning needs attention')).toBeInTheDocument();
    expect(screen.getByText('Discovery stopped after 3 attempts.')).toBeInTheDocument();
    expect(screen.queryByText(/picked up again/i)).toBeNull();
    expect(logLines().join('\n')).toContain('scan started across 4 communities');
    expect(logLines().join('\n')).not.toContain('scanned 4 communities');
  });

  it('completed with matches: reports the PersonalAgent handoff and pending kickoff', () => {
    render(
      <DiscoveryWarmupLog
        progress={progress({
          status: 'completed',
          processedCommunityCount: 4,
          possibleOverlapCount: 11,
          conversationsStartedCount: 2,
          completedAt: COMPLETED_AT,
        })}
        communities={communities}
      />,
    );

    expect(screen.getByTestId('discovery-warmup-status')).toHaveTextContent('completed');
    expect(screen.getByText('First scan complete')).toBeInTheDocument();
    expect(screen.getByText('Scanned 4 communities — 2 matches handed to the PersonalAgent. Kickoff has not started yet.')).toBeInTheDocument();
    expect(logLines().join('\n')).toContain('＋ 2 matches handed to the PersonalAgent; kickoff has not started yet');
    expect(screen.queryByText(/conversations? started/i)).toBeNull();
  });

  it('completed with nothing found: reports the zero run rather than an empty card', () => {
    render(
      <DiscoveryWarmupLog
        progress={progress({ status: 'completed', processedCommunityCount: 4, completedAt: COMPLETED_AT })}
        communities={communities}
      />,
    );

    expect(screen.getByText('Scanned 4 communities — no matches yet.')).toBeInTheDocument();
    expect(logLines().join('\n')).toContain('scan completed with no matches yet');
    // Past tense: the scan is over, so the line must not read as still running.
    expect(logLines().join('\n')).toContain('scanned 4 communities');
  });

  it('unknown: admits the status is unavailable and fabricates no log', () => {
    render(<DiscoveryWarmupLog communities={communities} />);

    expect(screen.getByTestId('discovery-warmup-status')).toHaveTextContent('unknown');
    expect(screen.getByText('Discovery status unavailable')).toBeInTheDocument();
    expect(screen.getByText('Progress is unavailable or stale.')).toBeInTheDocument();
    expect(screen.queryByTestId('discovery-warmup-log')).toBeNull();
  });

  it('renders under reduced motion (the sweep is decorative, not a state)', () => {
    // jsdom reports no motion preference; the card must be complete either way.
    render(<DiscoveryWarmupLog progress={progress()} communities={communities} />);

    expect(screen.getByTestId('discovery-warmup-sweep')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('discovery-warmup-log')).toBeInTheDocument();
  });
});

describe('buildWarmupLog', () => {
  it('derives one line per durable timestamp, in clock order', () => {
    const entries = buildWarmupLog({
      progress: progress({
        status: 'completed',
        processedCommunityCount: 4,
        possibleOverlapCount: 3,
        conversationsStartedCount: 1,
        completedAt: COMPLETED_AT,
      }),
    });

    expect(entries.map((entry) => entry.id)).toEqual(['queued', 'scanning', 'completed']);
    expect(entries.map((entry) => entry.at)).toEqual([
      new Date(QUEUED_AT).getTime(),
      new Date(STARTED_AT).getTime(),
      new Date(COMPLETED_AT).getTime(),
    ]);
  });

  it('drops rows with no timestamp instead of inventing one', () => {
    const entries = buildWarmupLog({
      progress: progress({ queuedAt: null, startedAt: null, completedAt: null, updatedAt: null }),
    });

    expect(entries).toEqual([]);
  });

  it('is stable across reloads: the same snapshot yields the same log', () => {
    const snapshot = {
      progress: progress({ status: 'completed', completedAt: COMPLETED_AT }),
    };

    expect(buildWarmupLog(snapshot)).toEqual(buildWarmupLog(snapshot));
  });

  it('marks only the line the run is currently sitting on', () => {
    const entries = buildWarmupLog({ progress: progress({ status: 'running' }) });

    expect(entries.filter((entry) => entry.current).map((entry) => entry.id)).toEqual(['scanning']);
  });
});

describe('formatLogClock', () => {
  it('renders HH:MM in 24-hour form', () => {
    expect(formatLogClock(Date.parse(STARTED_AT))).toMatch(/^\d{2}:\d{2}$/);
  });
});
