import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { authClient } from '@/lib/auth-client';

export default function EmailSection({ email }: { email: string }) {
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [params] = useSearchParams();
  const verificationFailed = params.get('emailChange') === '1' && params.has('error');

  async function send() {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await authClient.changeEmail({
        newEmail: newEmail.trim().toLowerCase(),
        callbackURL: `${window.location.origin}/settings?tab=access&emailChange=1`,
      });
      if (result.error) throw new Error(result.error.message || 'Could not request email change.');
      setMessage(`Check ${newEmail.trim()} for a verification link. Your current email stays active until you verify. If no email arrives, check spam or try another address; an address already in use cannot be added.`);
      setEditing(false);
      setNewEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request email change. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ fontFamily: 'var(--mac-sans)', fontSize: 13 }}>
      <div style={{ fontFamily: 'var(--mac-mono)', fontSize: 11, fontWeight: 600, marginBottom: 5 }}>email</div>
      <div style={{ overflowWrap: 'anywhere', marginBottom: 8 }}>{email}</div>
      {editing ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <label>
            new email
            <input aria-label="new email" type="email" autoComplete="email" value={newEmail} disabled={busy}
              onChange={event => setNewEmail(event.target.value)}
              style={{ display: 'block', width: '100%', border: '1px solid #000', background: '#fff', padding: '7px 10px' }} />
          </label>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim()) || newEmail.trim().toLowerCase() === email.toLowerCase()} onClick={() => void send()}>
              {busy ? 'sending…' : 'send verification link'}
            </button>
            <button type="button" disabled={busy} onClick={() => { setEditing(false); setError(''); }}>cancel</button>
          </div>
        </div>
      ) : <button type="button" style={{ textDecoration: 'underline' }} onClick={() => setEditing(true)}>change email</button>}
      {message && <p role="status">{message}</p>}
      {(error || verificationFailed) && <p role="alert" style={{ color: 'var(--ink-warn)' }}>{error || 'The verification link could not be used. Sign in to the account that requested the change and request a new link.'}</p>}
    </section>
  );
}
