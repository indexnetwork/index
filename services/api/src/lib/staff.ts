import type { AuthenticatedUser } from '../guards/auth.guard';

const STAFF_DOMAIN = '@index.network';

function extraStaffEmails(): string[] {
  return (process.env.STAFF_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether a user is Index staff, allowed to review network requests.
 * Staff = an `@index.network` address, or an email listed in STAFF_EMAILS.
 */
export function isStaff(user: Pick<AuthenticatedUser, 'email'>): boolean {
  const email = user.email?.toLowerCase() ?? '';
  if (!email) return false;
  return email.endsWith(STAFF_DOMAIN) || extraStaffEmails().includes(email);
}

/** Addresses that receive a heads-up email when a new network request lands. */
export function staffNotificationEmails(): string[] {
  const configured = extraStaffEmails();
  return configured.length > 0 ? configured : ['hello@index.network'];
}
