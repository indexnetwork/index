'use client';
import { useEffect } from 'react';

import { ensureLandingFonts } from '@/app/landing/Nav';

// ── Unlisted document page ─────────────────────────────────────────
// Renders a finished HTML artifact authored outside the app: the markup is
// imported raw and injected inline, and its stylesheet is scoped under a
// class prefix so it cannot collide with the app's Tailwind/global styles.
//
// These pages are unlisted, not public: each is reachable only through the
// token in its path, carries `noindex, nofollow`, has no meta.config.ts entry
// (so crawlers get no social card) and is linked from nowhere. Unlisted is not
// private — anyone holding the link can open or forward it.
//
// Routes are registered in three places: `routes.tsx`, `bareRoutes` in
// ClientWrapper (no app header/sidebar) and `publicPrefixes` in AuthContext
// (without it the page redirects to `/` and opens the sign-in modal).

export function UnlistedDoc({
  title,
  scope,
  bodyHtml,
}: {
  title: string;
  scope: string;
  bodyHtml: string;
}) {
  useEffect(() => {
    ensureLandingFonts();

    const prevTitle = document.title;
    document.title = title;

    const robots = document.createElement('meta');
    robots.setAttribute('name', 'robots');
    robots.setAttribute('content', 'noindex, nofollow');
    document.head.appendChild(robots);

    return () => {
      document.title = prevTitle;
      robots.remove();
    };
  }, [title]);

  return <div className={scope} dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
}
