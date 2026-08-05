import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import type { EnvFlagMeta } from '../api/client';

interface FlagListboxProps {
  /** Every flag this harness reads, in the order the server sent them. */
  flags: readonly EnvFlagMeta[];
  /** Keys already spoken for by another row; offered nowhere twice. */
  takenKeys: ReadonlySet<string>;
  /** The chosen key, or '' while the row is still empty. */
  value: string;
  /** Accessible name, e.g. "flag 2" — the row number the operator sees. */
  label: string;
  onChange: (key: string) => void;
}

/**
 * The flag picker: a themed listbox that shows each flag's label, key AND its
 * description.
 *
 * Replaces a native `<select>`, which the operator reported as visibly foreign —
 * the popup renders in the platform's own font with an OS-blue highlight against
 * a dark monospace page, and an `<option>` can carry no second line, so the
 * description had to live outside the control and only appeared once a flag had
 * already been chosen. With twenty-six flags on the discovery harness, choosing
 * blind and reading afterwards is the wrong order.
 *
 * ACCESSIBILITY. A native select brings keyboard operation for free and this
 * does not, so the ARIA listbox pattern is implemented here rather than
 * approximated: `role="combobox"` on the trigger with `aria-expanded` and
 * `aria-controls`, `role="listbox"` on the popup with `aria-activedescendant`
 * tracking the active option, and Up/Down/Home/End/Enter/Space/Escape/Tab all
 * doing what that pattern says. Focus returns to the trigger on close, so the
 * tab order never strands anyone inside a dismissed popup. This is standard
 * control semantics, which the site's "no bespoke keyboard chords" rule is not
 * about: that rule bans inventing j/k and `?` overlays, not implementing the
 * behaviour every listbox already owes its user.
 *
 * Mouse-first as the site requires: click to open, click to choose, click away
 * to dismiss.
 */
export function FlagListbox({ flags, takenKeys, value, label, onChange }: FlagListboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();

  // The chosen flag stays selectable so the operator can see what a row holds;
  // every other taken key belongs to another row and is not offered twice.
  const options = useMemo(
    () => flags.filter((flag) => flag.key === value || !takenKeys.has(flag.key)),
    [flags, takenKeys, value],
  );

  const selectedIndex = useMemo(
    () => options.findIndex((flag) => flag.key === value),
    [options, value],
  );

  const selected = selectedIndex === -1 ? undefined : options[selectedIndex];

  const close = useCallback(
    ({ refocus }: { refocus: boolean }) => {
      setOpen(false);
      // Returning focus is part of the pattern: without it, dismissing the popup
      // drops the caret to the top of the document and a keyboard operator has
      // to walk back through the whole form.
      if (refocus) triggerRef.current?.focus();
    },
    [],
  );

  const choose = useCallback(
    (index: number) => {
      const flag = options[index];
      if (flag === undefined) return;
      onChange(flag.key);
      close({ refocus: true });
    },
    [options, onChange, close],
  );

  const openAt = useCallback(() => {
    // Opening lands on the current choice, not always at the top: for a row that
    // already holds a flag, arrowing from row one would be a lie about where you are.
    setActiveIndex(selectedIndex === -1 ? 0 : selectedIndex);
    setOpen(true);
  }, [selectedIndex]);

  // Click-away. Registered only while open, so a page carrying twenty-six of
  // these does not keep twenty-six live document listeners.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) === true) return;
      if (listRef.current?.contains(target) === true) return;
      // No refocus: the operator has already pointed somewhere else, and stealing
      // focus back would fight the click they just made.
      close({ refocus: false });
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!open) {
        // The pattern's opening keys. Enter and Space are deliberately included:
        // a combobox that only opens on ArrowDown is a control most keyboard
        // users cannot find.
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
          event.preventDefault();
          openAt();
        }
        return;
      }
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, options.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Home':
          event.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setActiveIndex(options.length - 1);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          choose(activeIndex);
          break;
        case 'Escape':
          event.preventDefault();
          close({ refocus: true });
          break;
        case 'Tab':
          // Tab moves on rather than being swallowed, so the popup cannot trap
          // the tab order. No preventDefault, and no refocus for the same reason.
          close({ refocus: false });
          break;
        default:
          break;
      }
    },
    [open, options.length, activeIndex, choose, close, openAt],
  );

  const optionId = useCallback((index: number) => `${baseId}-option-${index}`, [baseId]);

  /**
   * Keeps the active option visible while arrowing.
   *
   * `aria-activedescendant` moves a virtual cursor, and the browser does NOT
   * scroll for it the way it does for real focus. The popup is capped at 20
   * lines and discovery offers twenty-six flags, so without this, arrowing past
   * the twentieth option moved the active row somewhere below the fold and the
   * control appeared frozen.
   *
   * `block: 'nearest'` scrolls only when the option is actually out of view, so
   * the list does not jump on every keypress. Guarded because happy-dom does not
   * implement scrollIntoView — which is also why this behaviour is reasoned from
   * the API contract rather than asserted in a test that cannot observe it.
   */
  useEffect(() => {
    if (!open) return;
    const active = document.getElementById(optionId(activeIndex));
    active?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex, optionId]);

  return (
    <div className="relative flex-1">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${baseId}-listbox`}
        aria-haspopup="listbox"
        // On the TRIGGER, because ARIA only honours aria-activedescendant on the
        // element that actually has DOM focus — and focus never leaves the
        // trigger here (the popup is opened, but not focused). Placed on the
        // <ul> it announced nothing while arrowing, which is the one affordance
        // a native <select> gives for free. This is what the APG's select-only
        // combobox pattern specifies.
        aria-activedescendant={open && options.length > 0 ? optionId(activeIndex) : undefined}
        className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh] text-left"
        onClick={() => (open ? close({ refocus: false }) : openAt())}
        onKeyDown={handleKeyDown}
      >
        {selected === undefined ? (
          <span className="text-term-dim">choose a flag…</span>
        ) : (
          <span>
            {selected.label} <span className="text-term-dim">— {selected.key}</span>
          </span>
        )}
      </button>

      {open && (
        <ul
          ref={listRef}
          id={`${baseId}-listbox`}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className="absolute z-10 mt-1 max-h-[20lh] w-full overflow-y-auto border border-term-rule bg-term-panel"
          onKeyDown={handleKeyDown}
        >
          {options.length === 0 && (
            <li className="px-[1ch] py-[0.5lh] text-term-dim">
              Every flag this harness reads is already set.
            </li>
          )}
          {options.map((flag, index) => (
            <li
              key={flag.key}
              id={optionId(index)}
              role="option"
              aria-selected={flag.key === value}
              // The active row is marked with the site's selection colour and a
              // rule, never the OS highlight the operator objected to.
              className={`cursor-pointer px-[1ch] py-[0.5lh] border-l-2 ${
                index === activeIndex
                  ? 'border-term-cyan bg-term-bg'
                  : 'border-transparent'
              }`}
              // onPointerMOVE, not onPointerEnter: the popup renders under the
              // cursor that opened it, so `enter` fires on whichever option
              // happens to be beneath the pointer the moment it appears —
              // yanking the active option away from the one `openAt` chose
              // before the operator has moved anything. `move` only fires once
              // the pointer actually travels, so opening with the keyboard and
              // then arrowing is not overridden by a stationary mouse.
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <span className={index === activeIndex ? 'text-term-cyan' : ''}>{flag.label}</span>{' '}
              <span className="text-term-dim">— {flag.key}</span>
              {/* The reason this control exists: the description is readable
                  BEFORE choosing, and wraps rather than overflowing its column. */}
              <span className="block text-term-dim whitespace-normal break-words">
                {flag.description}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
