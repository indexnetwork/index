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
  it('running: narrates the run in progress and says the page can be left', () => {
    render(<DiscoveryWarmupLog progress={progress()} communities={communities} />);

    expect(screen.getByTestId('discovery-warmup-status')).toHaveTextContent('scanning');
    expect(screen.getByText('Finding your first conversations')).toBeInTheDocument();
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

  it('completed: keeps the tallies in the summary', () => {
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
    expect(screen.getByText('Scanned 4 communities — 11 possible overlaps, 2 conversations started')).toBeInTheDocument();
    expect(logLines().join('\n')).toContain('＋ 11 possible overlaps found, 2 conversations started');
  });

  it('completed with nothing found: reports the zero run rather than an empty card', () => {
    render(
      <DiscoveryWarmupLog
        progress={progress({ status: 'completed', processedCommunityCount: 4, completedAt: COMPLETED_AT })}
        communities={communities}
      />,
    );

    expect(screen.getByText('Scanned 4 communities — no overlaps yet')).toBeInTheDocument();
    expect(logLines().join('\n')).toContain('＋ 0 possible overlaps found, 0 conversations started');
    // Past tense: the scan is over, so the line must not read as still running.
    expect(logLines().join('\n')).toContain('scanned 4 communities');
  });

  it('unknown: admits the status is unavailable and fabricates no log', () => {
    render(<DiscoveryWarmupLog communities={communities} />);

    expect(screen.getByTestId('discovery-warmup-status')).toHaveTextContent('unknown');
    expect(screen.getByText('Status unavailable.')).toBeInTheDocument();
    expect(screen.queryByTestId('discovery-warmup-log')).toBeNull();
  });

  it('renders under reduced motion (the sweep is decorative, not a state)', () => {
    // jsdom reports no motion preference; the card must be complete either way.
    render(<DiscoveryWarmupLog progress={progress()} communities={communities} />);

    expect(screen.getByTestId('discovery-warmup-sweep')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('discovery-warmup-log')).toBeInTheDocument();
  });
});

describe('DiscoveryWarmupLog conversation lane', () => {
  it('logs each started negotiation, merged into the progress lane by time', () => {
    render(
      <DiscoveryWarmupLog
        progress={progress({
          status: 'completed',
          processedCommunityCount: 4,
          possibleOverlapCount: 3,
          conversationsStartedCount: 1,
          completedAt: COMPLETED_AT,
        })}
        communities={communities}
        conversations={[{ id: 'conv-1', counterpartLabel: 'Ashley', startedAt: '2026-08-19T09:18:00.000Z' }]}
      />,
    );

    const lines = logLines();
    expect(lines.some((line) => line.includes("conversation with Ashley's agent started"))).toBe(true);
    // Merged chronologically: started 09:15 → conversation 09:18 → completed 09:21.
    const order = lines.map((line) => line.replace(/^\d{2}:\d{2}/, ''));
    expect(order.findIndex((line) => line.includes('scanned'))).toBeLessThan(
      order.findIndex((line) => line.includes('Ashley')),
    );
    expect(order.findIndex((line) => line.includes('Ashley'))).toBeLessThan(
      order.findIndex((line) => line.includes('possible overlaps found')),
    );
  });

  it('marks the two lanes apart so the live feed is distinguishable', () => {
    render(
      <DiscoveryWarmupLog
        progress={progress()}
        communities={communities}
        conversations={[{ id: 'conv-1', counterpartLabel: 'Ashley', startedAt: '2026-08-19T09:18:00.000Z' }]}
      />,
    );

    const lanes = within(screen.getByTestId('discovery-warmup-log'))
      .getAllByRole('listitem')
      .map((item) => item.getAttribute('data-lane'));
    expect(lanes).toContain('progress');
    expect(lanes).toContain('conversation');
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
      conversations: [{ id: 'conv-1', counterpartLabel: 'Ashley', startedAt: null }],
    });

    expect(entries).toEqual([]);
  });

  it('is stable across reloads: the same snapshot yields the same log', () => {
    const snapshot = {
      progress: progress({ status: 'completed', completedAt: COMPLETED_AT }),
      conversations: [{ id: 'conv-1', counterpartLabel: 'Ashley', startedAt: '2026-08-19T09:18:00.000Z' }],
    };

    expect(buildWarmupLog(snapshot)).toEqual(buildWarmupLog(snapshot));
  });

  it('caps the live lane at the most recent conversations', () => {
    const conversations = Array.from({ length: 8 }, (_, index) => ({
      id: `conv-${index}`,
      counterpartLabel: `Person ${index}`,
      startedAt: new Date(Date.parse(STARTED_AT) + index * 60_000).toISOString(),
    }));

    const lane = buildWarmupLog({ conversations }).filter((entry) => entry.lane === 'conversation');

    expect(lane).toHaveLength(5);
    expect(lane[0]!.text).toContain('Person 3');
    expect(lane[4]!.text).toContain('Person 7');
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
