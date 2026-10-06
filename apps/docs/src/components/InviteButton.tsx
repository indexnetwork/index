'use client'

/**
 * "Request your invite" button that opens an email dialog, used on the
 * install cards. Mirrors the navbar dialog on the landing site
 * (apps/web/src/app/site/InviteModal.tsx).
 *
 * Posts straight to the Loops form behind `POST /api/subscribe`, since the API
 * does not trust the docs origin for CORS. A form-encoded body keeps it a
 * simple request with no preflight.
 * Styles live in `src/pages/_root.css` under "Invite dialog".
 */

import { useEffect, useState, type FormEvent } from 'react'

const LOOPS_FORM_URL = 'https://app.loops.so/api/newsletter-form/cmkq2slhq0aii0iuf7jigfxos'

type Status = 'idle' | 'loading' | 'success' | 'error'

export function InviteButton({ className }: { className: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <span>Request your invite</span>
      </button>
      {open && <InviteDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email || status === 'loading') return
    setStatus('loading')
    try {
      const res = await fetch(LOOPS_FORM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email, source: 'waitlist' }).toString(),
      })
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div
      className="invite-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-dialog-title"
      onClick={onClose}
    >
      <div className="invite-dialog__card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="invite-dialog__close" aria-label="Close" onClick={onClose}>
          &times;
        </button>
        <p id="invite-dialog-title" className="invite-dialog__title">
          Request your invite
        </p>
        {status === 'success' ? (
          <p className="invite-dialog__text">You&rsquo;re on the list. We&rsquo;ll be in touch.</p>
        ) : (
          <>
            <p className="invite-dialog__text">
              Index is opening in cycles. Leave your email and we&rsquo;ll reach out when there&rsquo;s
              a spot for you.
            </p>
            <form className="invite-dialog__form" onSubmit={submit} noValidate>
              <input
                type="email"
                className="invite-dialog__input"
                placeholder="you@domain.com"
                aria-label="Email address"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (status === 'error') setStatus('idle')
                }}
                disabled={status === 'loading'}
                autoFocus
                required
              />
              <button type="submit" className="invite-dialog__submit" disabled={status === 'loading'}>
                {status === 'loading' ? 'Sending…' : 'Request your invite →'}
              </button>
            </form>
            {status === 'error' && (
              <p className="invite-dialog__error">Something went wrong. Please try again.</p>
            )}
            <p className="invite-dialog__note">
              You&rsquo;re also subscribing to our newsletter. Unsubscribe anytime.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
