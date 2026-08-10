import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { Component as ConnectedAgentsPage } from '@/app/agents/connected/page';
import { HERMES_CAPABILITIES } from '@/lib/hermes-auth';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  pause: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock('@/services/connected-agents', () => ({
  connectedAgentsService: {
    list: mocks.list,
    pause: mocks.pause,
    revoke: mocks.revoke,
  },
}));

const active = {
  installationId: '11111111-1111-4111-8111-111111111111',
  installationName: 'Hermes on macOS',
  agentId: '22222222-2222-4222-8222-222222222222',
  actions: ['manage:identity', 'manage:premises', 'manage:intents', 'manage:networks', 'manage:opportunities', 'manage:negotiations'],
  activationState: 'active' as const,
  selected: true,
  lastHeartbeatAt: '2026-08-09T12:00:00.000Z',
  expiresAt: '2026-09-08T12:00:00.000Z',
  health: 'active' as const,
  indexCovering: false,
};

const paused = { ...active, selected: false, indexCovering: true };

describe('connected Hermes owner controls', () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.pause.mockReset();
    mocks.revoke.mockReset();
    mocks.list.mockResolvedValueOnce([active]);
    mocks.pause.mockResolvedValue(paused);
    mocks.revoke.mockResolvedValue({ revoked: true });
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('lists installation name and id, all six granted capabilities, health, and fallback state', async () => {
    render(<ConnectedAgentsPage />);

    expect(await screen.findByText('Connected Hermes agents')).toBeTruthy();
    expect(screen.getByText(active.installationName)).toBeTruthy();
    expect(screen.getByText(active.installationId)).toBeTruthy();
    for (const capability of HERMES_CAPABILITIES) {
      expect(screen.getByText(capability.label)).toBeTruthy();
    }
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText(/Last heartbeat/)).toBeTruthy();
    expect(screen.getByText(/Expires/)).toBeTruthy();
    expect(screen.getByText(/Hermes is handling negotiations/)).toBeTruthy();
  });

  test('confirms pause and refreshes authoritative server state', async () => {
    mocks.list.mockResolvedValueOnce([paused]);
    render(<ConnectedAgentsPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/pause/i));
    await waitFor(() => expect(mocks.pause).toHaveBeenCalledWith(active.installationId));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Index is covering negotiations/)).toBeTruthy();
  });

  test('confirms revoke, refreshes, and opens no-request reconnect instructions', async () => {
    mocks.list.mockResolvedValueOnce([]);
    render(<ConnectedAgentsPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/revoke/i));
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith(active.installationId));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect in Hermes' }));
    expect(screen.getByRole('dialog', { name: 'Reconnect Hermes securely' })).toBeTruthy();
    expect(screen.getByText(/open the Hermes dashboard/i)).toBeTruthy();
    expect(screen.getByText(/select Index/i)).toBeTruthy();
    expect(screen.getByText(/choose Connect/i)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.pause).not.toHaveBeenCalled();
  });

  test('does nothing when confirmation is declined', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<ConnectedAgentsPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(mocks.pause).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
});
