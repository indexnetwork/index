import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useSearchParams } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { authClient } from '@/lib/auth-client';
import './EmailSection.css';

export default function EmailSection({ email }: { email: string }) {
  const { t } = useTranslation();
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
      if (result.error) throw new Error(result.error.message || t('Could not request email change.'));
      setSentTo(address);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not request email change. Try again.'));
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
        <div className="email-setting-label">{t("email", { context: "address" })}</div>
        <div className="email-setting-well">
          <span>{email}</span>
          <Dialog.Trigger asChild><button type="button" aria-label={t("change email")} className="email-setting-change">{t("change")}</button></Dialog.Trigger>
        </div>
        {verificationFailed && <p role="alert" className="email-setting-error">{t("Verification failed. Sign in to your account and request a new link.")}</p>}
      </div>
      <Dialog.Portal>
        {/* Portals leave the app shell; restore its theme tokens for the window chrome. */}
        <div className="workbench">
        <Dialog.Overlay className="email-dialog-overlay" />
        <Dialog.Content className="email-dialog amiga-window" onEscapeKeyDown={event => { event.stopPropagation(); if (busy) event.preventDefault(); }} onInteractOutside={event => event.preventDefault()}>
          <div className="mac-titlebar"><Dialog.Title className="mac-title"><span className="t">{sentTo ? t('check your inbox') : t('change email')}</span></Dialog.Title></div>
          <form onSubmit={event => { event.preventDefault(); if (!sentTo) void send(); }}>
            <div className="email-dialog-body">
              <Dialog.Description className="email-dialog-description">
                {sentTo ? <Trans i18nKey="Follow the link sent to <strong>{{email}}</strong> to finish updating your email." values={{ email: sentTo }} components={{ strong: <strong /> }} /> : t('We’ll send a link to verify your new address.')}
              </Dialog.Description>
              {sentTo ? <p className="email-dialog-note" role="status">{t("Your current email stays active until you verify.")}</p> : <label className="email-setting-label">{t("new email")}
                <input className="email-dialog-input" aria-label={t("new email")} type="email" autoComplete="email" required value={newEmail} disabled={busy} placeholder="you@example.com" onChange={event => setNewEmail(event.target.value)} />
              </label>}
              {error && <p role="alert" className="email-setting-error">{error}</p>}
            </div>
            <div className="email-dialog-footer">
              {sentTo ? <Dialog.Close asChild><button type="button" className="wb-btn primary">{t("done")}</button></Dialog.Close> : <>
                <Dialog.Close asChild><button type="button" className="wb-btn" disabled={busy}>{t("cancel")}</button></Dialog.Close>
                <button type="submit" className="wb-btn primary" disabled={busy || !newEmail.trim() || newEmail.trim().toLowerCase() === email.toLowerCase()}>{busy ? t('sending…') : t('continue')}</button>
              </>}
            </div>
          </form>
        </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
