import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useSearchParams } from 'react-router';
import { authClient } from '@/lib/auth-client';
import './EmailSection.css';

export default function EmailSection({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [params] = useSearchParams();
  const verificationFailed = params.get('emailChange') === '1' && params.has('error');

  async function send() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const address = newEmail.trim().toLowerCase();
      const result = await authClient.changeEmail({
        newEmail: address,
        callbackURL: `${window.location.origin}/settings?tab=access&emailChange=1`,
      });
      if (result.error) throw new Error(result.error.message || 'Could not request email change.');
      setSentTo(address);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request email change. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={value => {
      if (busy) return;
      setOpen(value);
      if (value) { setNewEmail(''); setSentTo(''); setError(''); }
    }}>
      <div className="email-setting">
        <div className="email-setting-label">email</div>
        <div className="email-setting-well">
          <span>{email}</span>
          <Dialog.Trigger asChild><button type="button" aria-label="change email" className="email-setting-change">change</button></Dialog.Trigger>
        </div>
        {verificationFailed && <p role="alert" className="email-setting-error">Verification failed. Sign in to your account and request a new link.</p>}
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="email-dialog-overlay" />
        <Dialog.Content className="email-dialog amiga-window" onEscapeKeyDown={event => { event.stopPropagation(); if (busy) event.preventDefault(); }} onInteractOutside={event => event.preventDefault()}>
          <div className="mac-titlebar"><Dialog.Title className="mac-title"><span className="t">{sentTo ? 'check your inbox' : 'change email'}</span></Dialog.Title></div>
          <form onSubmit={event => { event.preventDefault(); if (!sentTo) void send(); }}>
            <div className="email-dialog-body">
              <Dialog.Description className="email-dialog-description">
                {sentTo ? <>Follow the link sent to <strong>{sentTo}</strong> to finish updating your email.</> : 'We’ll send a link to verify your new address.'}
              </Dialog.Description>
              {sentTo ? <p className="email-dialog-note" role="status">Your current email stays active until you verify.</p> : <label className="email-setting-label">new email
                <input className="email-dialog-input" aria-label="new email" type="email" autoComplete="email" required value={newEmail} disabled={busy} placeholder="you@example.com" onChange={event => setNewEmail(event.target.value)} />
              </label>}
              {error && <p role="alert" className="email-setting-error">{error}</p>}
            </div>
            <div className="email-dialog-footer">
              {sentTo ? <Dialog.Close asChild><button type="button" className="wb-btn primary">done</button></Dialog.Close> : <>
                <Dialog.Close asChild><button type="button" className="wb-btn" disabled={busy}>cancel</button></Dialog.Close>
                <button type="submit" className="wb-btn primary" disabled={busy || !newEmail.trim() || newEmail.trim().toLowerCase() === email.toLowerCase()}>{busy ? 'sending…' : 'continue'}</button>
              </>}
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
