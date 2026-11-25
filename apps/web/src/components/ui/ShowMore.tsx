import { useState } from "react";

/** How many items a list shows before "show N more". */
export const SHOWN = 5;

/**
 * A list that shows its first few items, then a "show N more" link that opens
 * the rest (and "show fewer" to fold it back). Render `shown`, then `more`.
 * An item `pin` matches stays in view while the list is folded.
 */
export function useShowMore<T>(items: T[], pin?: (item: T) => boolean, max = SHOWN) {
  const [open, setOpen] = useState(false);
  const folded = items.filter((item, index) => index < max || pin?.(item));
  const hidden = items.length - folded.length;
  return {
    shown: open ? items : folded,
    more: hidden > 0 || (open && items.length > max) ? (
      <button type="button" className="pl-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "show fewer" : `show ${hidden} more`}
      </button>
    ) : null,
  };
}
