import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { Component as HermesAuthorizePage } from '@/app/hermes-authorize/page';
import { HERMES_CAPABILITIES } from '@/lib/hermes-auth';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getRequest: vi.fn(),
  approve: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: mocks.getSession },
}));

vi.mock('@/services/connected-agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/connected-agents')>();
  return {
    ...actual,
    hermesAuthorizationService: {
      getRequest: mocks.getRequest,
      approve: mocks.approve,
    },
  };
});

const requestId = '33333333-3333-4333-8333-333333333333';
const installationId = '11111111-1111-4111-8111-111111111111';
const installationName = 'Hermes on macOS';
const state = 'abcdefghijklmnopqrstuvwxyzABCDEFGH';
const redirectUri = 'http://127.0.0.1:49152/callback';

function setValidPage(): void {
  window.location.href = `http://localhost/hermes-authorize?request_id=${requestId}&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

describe('Hermes authorization consent', () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.getRequest.mockReset();
    mocks.approve.mockReset();
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
    setValidPage();
    mocks.getSession.mockResolvedValue({
      data: { session: { id: 'session-1' }, user: { id: 'owner-1', email: 'owner@example.com', name: 'Owner' } },
    });
    mocks.getRequest.mockResolvedValue({
      requestId,
      installationId,
      installationName,
      actions: HERMES_CAPABILITIES.map((capability) => capability.action),
      expiresAt: '2026-08-09T12:10:00.000Z',
    });
    mocks.approve.mockResolvedValue({
      requestId,
      code: 'one-time-code',
      state,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('shows account, installation identity, exact six capabilities, 30-day expiry, and complete exclusions', async () => {
    render(<HermesAuthorizePage />);

    expect(await screen.findByText('Connect Hermes to Index')).toBeTruthy();
    expect(screen.getByText('owner@example.com')).toBeTruthy();
    expect(screen.getByText(installationName)).toBeTruthy();
    expect(screen.getByText(installationId)).toBeTruthy();
    for (const capability of HERMES_CAPABILITIES) {
      expect(screen.getByText(capability.label)).toBeTruthy();
    }
    expect(screen.getByText(/30 days/)).toBeTruthy();
    expect(screen.getByText("Hermes cannot manage login or sign-in methods, account security, credentials or API keys, permissions, billing, account deletion, connected or other agents, or other agents' data or control.")).toBeTruthy();
    expect(mocks.getRequest).toHaveBeenCalledWith(requestId, state, redirectUri);
  });

  test('approves only the validated request and redirects with no credential or verifier', async () => {
    render(<HermesAuthorizePage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Allow connection' }));

    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith(requestId, state, redirectUri));
    await waitFor(() => expect(window.location.href).toBe(
      `${redirectUri}?request_id=${requestId}&code=one-time-code&state=${state}`,
    ));
    expect(window.location.href).not.toContain('credential');
    expect(window.location.href).not.toContain('verifier');
  });

  test('fails closed when approval does not return the original request id and state', async () => {
    mocks.approve.mockResolvedValueOnce({
      requestId: '44444444-4444-4444-8444-444444444444',
      code: 'one-time-code',
      state,
    });
    render(<HermesAuthorizePage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Allow connection' }));

    expect(await screen.findByText(/could not be authorized/i)).toBeTruthy();
    expect(window.location.href).toContain('/hermes-authorize?');
  });

  test('fails closed when server metadata does not match the browser request id', async () => {
    mocks.getRequest.mockResolvedValueOnce({
      requestId: '44444444-4444-4444-8444-444444444444',
      installationId,
      installationName,
      actions: HERMES_CAPABILITIES.map((capability) => capability.action),
      expiresAt: '2026-08-09T12:10:00.000Z',
    });

    render(<HermesAuthorizePage />);

    expect(await screen.findByText(/invalid or has expired/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow connection' })).toBeNull();
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  test('rejects malformed query before session or API access and offers a local close-and-retry path', async () => {
    window.location.href = 'http://localhost/hermes-authorize?request_id=one&state=two&redirect_uri=http%3A%2F%2Flocalhost%3A49152%2Fcallback';

    render(<HermesAuthorizePage />);

    expect(await screen.findByText(/invalid or has expired/i)).toBeTruthy();
    expect(screen.getByText(/open the Hermes dashboard, select Index, and choose Connect/i)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close this tab and retry in Hermes' }));
    expect(window.close).toHaveBeenCalledTimes(1);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getRequest).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
  });
});
