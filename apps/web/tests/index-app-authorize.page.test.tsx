import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { Component as IndexAppAuthorizePage } from '@/app/index-app-authorize/page';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), getRequest: vi.fn(), approve: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({ authClient: { getSession: mocks.getSession } }));
vi.mock('@/services/index-app-owner-authorization', () => ({
  indexAppOwnerAuthorizationService: { getRequest: mocks.getRequest, approve: mocks.approve },
}));

const requestId = '33333333-3333-4333-8333-333333333333';
const installationId = '11111111-1111-4111-8111-111111111111';
const state = 'abcdefghijklmnopqrstuvwxyzABCDEFGH';
const redirectUri = 'http://127.0.0.1:49152/callback';

function validPage() {
  window.location.href = `http://localhost/index-app-authorize?request_id=${requestId}&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

describe('Index app owner consent', () => {
  beforeEach(() => {
    vi.clearAllMocks(); validPage();
    mocks.getSession.mockResolvedValue({
      data: { session: { id: 's1' }, user: { id: 'owner-1', email: 'owner@example.test' } },
    });
    mocks.getRequest.mockResolvedValue({
      requestId, installationId, legacyRevocationRequired: true,
      expiresAt: '2026-08-09T12:10:00.000Z',
    });
    mocks.approve.mockResolvedValue({ requestId, code: 'one-time-code', state });
  });

  test('shows fresh-login, Keychain, expiry, and legacy revocation disclosure', async () => {
    render(<IndexAppAuthorizePage />);
    expect(await screen.findByText('Sign in to Index for macOS')).toBeTruthy();
    expect(screen.getByText('owner@example.test')).toBeTruthy();
    expect(screen.getByText(installationId)).toBeTruthy();
    expect(screen.getByText(/stored in macOS Keychain and expires after 30 days/)).toBeTruthy();
    expect(screen.getByText(/previous plaintext app credential will be revoked before/)).toBeTruthy();
    expect(screen.getByText(/browser receives only a one-time code/)).toBeTruthy();
  });

  test('approves the state/redirect-bound request and returns no credential in callback', async () => {
    render(<IndexAppAuthorizePage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in to this Mac' }));
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith(requestId, state, redirectUri));
    await waitFor(() => expect(window.location.href).toBe(
      `${redirectUri}?request_id=${requestId}&code=one-time-code&state=${state}`,
    ));
    expect(window.location.href).not.toMatch(/credential|api_key|verifier|idxo_/i);
  });

  test('rejects malformed callback before session or API access with a stable invalid-or-expired reason', async () => {
    window.location.href = 'http://localhost/index-app-authorize?request_id=x&state=abcdefghijklmnopqrstuvwxyzABCDEFGH&redirect_uri=http%3A%2F%2Flocalhost%3A49152%2Fcallback';
    render(<IndexAppAuthorizePage />);
    expect(await screen.findByText('Sign-in unavailable')).toBeTruthy();
    expect(screen.getByText(/sign-in request is invalid or has expired/i)).toBeTruthy();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getRequest).not.toHaveBeenCalled();
  });

  test('reports a stale server request as invalid or expired after session validation', async () => {
    mocks.getRequest.mockRejectedValueOnce(new Error('authorization_expired'));
    render(<IndexAppAuthorizePage />);
    expect(await screen.findByText(/sign-in request is invalid or has expired/i)).toBeTruthy();
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    expect(mocks.getRequest).toHaveBeenCalledWith(requestId, state, redirectUri);
    expect(mocks.approve).not.toHaveBeenCalled();
  });
});
