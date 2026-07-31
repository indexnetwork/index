import type { ReactNode } from 'react';

export interface FrameProps {
  /** Omit for an unlabelled frame; an empty <h2> would be announced as a blank heading. */
  label?: string;
  children: ReactNode;
}

/**
 * A terminal frame drawn with CSS borders and an inset label.
 *
 * Literal box-drawing characters would look right at exactly one width and break
 * everywhere else — they cannot reflow and they garble under a screen reader.
 * Real box-drawing survives only inside <pre> content that already contains it.
 */
export function Frame({ label, children }: FrameProps) {
  return (
    <section className="relative border border-term-rule bg-term-panel px-[2ch] pt-[1lh] pb-[1lh]">
      {label !== undefined && label !== '' && (
        <h2 className="absolute -top-[0.6lh] left-[2ch] bg-term-panel px-[1ch] text-term-dim">{label}</h2>
      )}
      {children}
    </section>
  );
}
