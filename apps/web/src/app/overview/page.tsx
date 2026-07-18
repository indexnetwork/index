'use client';
import { useEffect, useRef } from 'react';

import overviewBodyHtml from './overview-body.html?raw';
import './overview.css';

// ── Protocol Overview ──────────────────────────────────────────────
// The overview is a finished, self-contained HTML artifact authored outside
// the app. It renders natively (no iframe) as a bare route (no app
// header/sidebar — registered in ClientWrapper `bareRoutes`): the article
// markup is imported raw and injected inline, and its stylesheet is scoped
// under `.ovw` so it cannot collide with the app's Tailwind/global styles.
// Meta is set here for client-side navigation; server.ts/meta.config.ts
// inject the same tags for crawlers.

const TITLE = 'Index Network: Protocol Overview';
const DESCRIPTION =
  'Index Network is a private, intent-driven social discovery protocol.';

export function OverviewArticle({
  bodyHtml,
  pathname,
}: {
  bodyHtml: string;
  pathname: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

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
    const url = `${origin}${pathname}`;
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
  }, [pathname]);

  // Auto-fit the embedded live-trace frame to its content height (the trace
  // stays an iframe: it is a self-running animation with its own document).
  useEffect(() => {
    const frame = rootRef.current?.querySelector<HTMLIFrameElement>('iframe.trace');
    if (!frame) return;
    let maxH = 0;
    const fit = () => {
      try {
        const d = frame.contentWindow?.document;
        if (!d) return;
        const h = Math.max(d.body.scrollHeight, d.documentElement.scrollHeight);
        if (h > maxH) {
          maxH = h;
          frame.style.height = `${h}px`;
        }
      } catch {
        /* cross-origin — leave the CSS fallback height */
      }
    };
    let interval: ReturnType<typeof setInterval> | undefined;
    const onLoad = () => {
      fit();
      interval = setInterval(fit, 400);
    };
    frame.addEventListener('load', onLoad);
    return () => {
      frame.removeEventListener('load', onLoad);
      if (interval) clearInterval(interval);
    };
  }, []);

  return <div ref={rootRef} className="ovw" dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
}

export default function OverviewPage() {
  return <OverviewArticle bodyHtml={overviewBodyHtml} pathname="/overview" />;
}

export const Component = OverviewPage;
