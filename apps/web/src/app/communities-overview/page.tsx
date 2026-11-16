'use client';
import { useEffect } from 'react';

import { UnlistedDoc } from '@/components/UnlistedDoc';

import bodyHtml from './communities-overview-body.html?raw';
// Same document shell as the dataroom overview: the sheet is scoped under
// `.dro`, so this page reuses it rather than carrying a copy.
import '../dataroom-overview/dataroom-overview.css';

// The overview written for community organizers: the dataroom overview without
// the market, business model and backers, plus "Why Index is good for
// communities". It lives outside the dataroom token on purpose, so sharing it
// never hands out the dataroom path.
export default function CommunitiesOverviewPage() {
  // The screenshot lightbox is a CSS checkbox toggle: the body HTML is injected
  // with dangerouslySetInnerHTML, so it carries no script of its own and Escape
  // has to be handled from here.
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      document
        .querySelectorAll<HTMLInputElement>('input.dro-lb-toggle:checked')
        .forEach((toggle) => {
          toggle.checked = false;
        });
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  return (
    <UnlistedDoc
      title="Index Network for communities"
      scope="dro"
      bodyHtml={bodyHtml}
    />
  );
}

export const Component = CommunitiesOverviewPage;
