import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import EmailSection from './EmailSection';

const changeEmail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth-client', () => ({ authClient: { changeEmail } }));
beforeEach(() => changeEmail.mockReset());

it('requests verification without displaying the new address as the current email', async () => {
  changeEmail.mockResolvedValue({ data: { status: true } });
  render(<MemoryRouter><EmailSection email="old@example.com" /></MemoryRouter>);
  fireEvent.click(screen.getByText('change email'));
  fireEvent.change(screen.getByLabelText('new email'), { target: { value: 'NEW@example.com' } });
  fireEvent.click(screen.getByText('send verification link'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('current email stays active'));
  expect(changeEmail).toHaveBeenCalledWith({ newEmail: 'new@example.com', callbackURL: `${window.location.origin}/settings?tab=access&emailChange=1` });
  expect(screen.getByText('old@example.com')).toBeInTheDocument();
});

it('keeps the form open after a failed request', async () => {
  changeEmail.mockResolvedValue({ error: { message: 'Please sign in again.' } });
  render(<MemoryRouter><EmailSection email="old@example.com" /></MemoryRouter>);
  fireEvent.click(screen.getByText('change email'));
  fireEvent.change(screen.getByLabelText('new email'), { target: { value: 'new@example.com' } });
  fireEvent.click(screen.getByText('send verification link'));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Please sign in again.'));
  expect(screen.getByLabelText('new email')).toHaveValue('new@example.com');
});

it('explains verification callback failures', () => {
  render(<MemoryRouter initialEntries={['/settings?tab=access&emailChange=1&error=TOKEN_EXPIRED']}><EmailSection email="old@example.com" /></MemoryRouter>);
  expect(screen.getByRole('alert')).toHaveTextContent('request a new link');
});
