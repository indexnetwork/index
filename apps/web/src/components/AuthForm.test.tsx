import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-client', () => ({ authClient: {} }));
vi.mock('@/app/landing/fonts', () => ({ ensureLandingFonts: () => {} }));
import AuthForm from './AuthForm';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('labels restricted password access and does not offer signup', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ emailPassword: true, emailPasswordRestricted: true }) }));
  render(<AuthForm />);
  fireEvent.click(await screen.findByRole('button', { name: 'reviewer password sign-in' }));
  expect(screen.queryByRole('button', { name: 'Sign up' })).toBeNull();
});

it('still allows password signup against a development API', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ emailPassword: true, emailPasswordRestricted: false }) }));
  render(<AuthForm />);
  // Wait for the API probe before checking the development signup affordance.
  await screen.findByRole('button', { name: 'sign in with a password' });
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'reviewer password sign-in' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'sign in with a password' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
  expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
});
