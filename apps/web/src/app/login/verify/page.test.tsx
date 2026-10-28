import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/components/SiteSignIn', () => ({
  SiteSignInPage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SiteSignInPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/lib/protocol-origin', () => ({ protocolOrigin: () => 'https://protocol.index.network' }));

import { Component } from './page';

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = ''; });

it('does not redeem on page load; only the button navigates to the fixed API endpoint', () => {
  window.location.hash = new URLSearchParams({ token: 'one-time-token', callbackURL: 'https://index.network/seref', url: 'https://evil.example' }).toString();
  const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
  render(<Component />);
  expect(assign).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue to sign in' }));
  const url = new URL(assign.mock.calls[0][0]);
  expect(url.origin + url.pathname).toBe('https://protocol.index.network/api/auth/magic-link/verify');
  expect(url.searchParams.get('token')).toBe('one-time-token');
  expect(url.searchParams.get('callbackURL')).toBe('https://index.network/seref');
  expect(url.searchParams.has('url')).toBe(false);
  expect(new URL(url.searchParams.get('errorCallbackURL')!).pathname).toBe('/login');
});

it('offers a new link when the token is missing', () => {
  render(<Component />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/login');
});
