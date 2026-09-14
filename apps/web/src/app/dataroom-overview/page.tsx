'use client';
import { useEffect } from 'react';

import { UnlistedDoc } from '@/components/UnlistedDoc';

import bodyHtml from './dataroom-overview-body.html?raw';
import './dataroom-overview.css';

export default function DataroomOverviewPage() {
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
      title="Index Network: The Social Discovery Protocol"
      scope="dro"
      bodyHtml={bodyHtml}
    />
  );
}

export const Component = DataroomOverviewPage;
