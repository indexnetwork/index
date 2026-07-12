'use client';
import { useEffect } from 'react';

// ── Protocol Overview ──────────────────────────────────────────────
// The overview is a finished, self-contained HTML artifact (its own global
// CSS + embedded fonts, authored outside the app). It renders as a bare route
// (no app header/sidebar — registered in ClientWrapper `bareRoutes`) inside a
// full-viewport iframe so its global selectors (`*`, `html`, `body`, `table`…)
// cannot collide with the app's Tailwind/global styles, and its ~1.4MB of
// embedded fonts/images stay a static asset (public/overview.html) loaded on
// demand rather than bundled into the JS. Meta is set here for client-side
// navigation; server.ts/meta.config.ts inject the same tags for crawlers.

const TITLE = 'Index Network: Protocol Overview';
const DESCRIPTION =
  'Index Network is a private, intent-driven social discovery protocol.';

export default function OverviewPage() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = TITLE;

    const setMeta = (name: string, content: string, attr = 'name') => {
      let el = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
      return el;
    };

    const origin = window.location.origin;
    const url = `${origin}/overview`;
    const image = `${origin}/link-preview.png`;

    setMeta('description', DESCRIPTION);
    setMeta('og:type', 'website', 'property');
    setMeta('og:title', TITLE, 'property');
    setMeta('og:description', DESCRIPTION, 'property');
    setMeta('og:url', url, 'property');
    setMeta('og:image', image, 'property');
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', TITLE);
    setMeta('twitter:description', DESCRIPTION);
    setMeta('twitter:image', image);

    return () => {
      document.title = prevTitle;
    };
  }, []);

  return (
    <iframe
      src="/overview.html"
      title={TITLE}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        border: 'none',
      }}
    />
  );
}

export const Component = OverviewPage;
