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

  // Scroll-spy for the section links: the link of the section being read is
  // marked current. A section counts as being read once its heading has
  // passed a line near the top of the window; at the very bottom of the page
  // the last link wins, since a short final section never reaches that line.
  useEffect(() => {
    const toc = document.querySelector<HTMLElement>('.dro .toc');
    if (!toc) return;
    const links = Array.from(toc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
    const sections = links
      .map((link) => ({ link, target: document.getElementById(link.hash.slice(1)) }))
      .filter((s): s is { link: HTMLAnchorElement; target: HTMLElement } => s.target !== null);
    if (sections.length === 0) return;

    let current: HTMLAnchorElement | null = null;
    let frame = 0;

    const update = () => {
      frame = 0;
      const line = Math.min(window.innerHeight * 0.3, 160);
      let next = sections[0].link;
      for (const { link, target } of sections) {
        if (target.getBoundingClientRect().top <= line) next = link;
      }
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) next = sections[sections.length - 1].link;
      if (next === current) return;

      current?.classList.remove('is-current');
      current?.removeAttribute('aria-current');
      next.classList.add('is-current');
      next.setAttribute('aria-current', 'location');
      current = next;

      // On narrow screens the links are a bar that scrolls sideways; keep the
      // current one in view without moving the page.
      if (toc.scrollWidth > toc.clientWidth) {
        const bar = toc.getBoundingClientRect();
        const box = next.getBoundingClientRect();
        if (box.left < bar.left + 28 || box.right > bar.right - 28) {
          toc.scrollTo({ left: toc.scrollLeft + box.left - bar.left - 28, behavior: 'smooth' });
        }
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  return (
    <UnlistedDoc
      title="Index Network: Agent-to-agent opportunity discovery"
      scope="dro"
      bodyHtml={bodyHtml}
    />
  );
}

export const Component = DataroomOverviewPage;
