import type { ReactNode, RefObject } from "react";

import "@/styles/split.css";
import { useZone } from "@/components/intents-home/keyboard";

/**
 * The one layout for home, intents, conversations and introduce: a list on
 * the left (its title, a filter row, then the list) and the thing you picked
 * on the right. The list keeps its scroll while you work in it.
 */
export function SplitView({ title, actions, seg, list, pane, listRef }: {
  title: ReactNode;
  /** Beside the title, e.g. "+ new intent". */
  actions?: ReactNode;
  /** The filter row under the title. */
  seg?: ReactNode;
  list: ReactNode;
  pane: ReactNode;
  listRef?: RefObject<HTMLDivElement | null>;
}) {
  const zone = useZone();
  return (
    <div className="sv">
      <aside className={`sv-list${zone === "list" ? " sv-focus" : ""}`} data-zone="list">
        <header className="sv-head">
          <div className="sv-title"><span>{title}</span>{actions}</div>
          {seg}
        </header>
        <div className="sv-scroll" ref={listRef} data-sv-list>{list}</div>
      </aside>
      <section className={`sv-pane${zone === "pane" ? " sv-focus" : ""}`} data-zone="pane">{pane}</section>
    </div>
  );
}

/** The filter row: counts for each part of the list. Pressing one is optional. */
export function Seg({ items }: { items: Array<{ label: string; n?: number; on?: boolean; onClick?: () => void }> }) {
  // Nothing picked reads as the first one ("all").
  const none = !items.some((item) => item.on);
  return (
    <span className="sv-seg">
      {items.map((item, i) => (
        <button key={item.label} type="button" aria-pressed={!!item.on || (none && i === 0)} onClick={item.onClick}>
          {item.label}{item.n !== undefined && <span className="n">{item.n}</span>}
        </button>
      ))}
    </span>
  );
}

/** A heading inside the list, e.g. "waiting on you · 3". */
export function ListHead({ id, children }: { id?: string; children: ReactNode }) {
  return <div className="sv-lh" id={id}>{children}</div>;
}

/** The right side when nothing is picked. */
export function Blank({ children }: { children: ReactNode }) {
  return <div className="sv-blank">{children}</div>;
}

/**
 * A page on its own: one centred column (title, actions, an optional line
 * under it, then the content) that scrolls as a whole. Home, the intents list
 * and an intent use it; the agent sits beside it on the right (see AppFrame).
 * `fill` gives the column the full height instead, for a pane with its own
 * scroll and footer, like writing a new intent.
 */
export function PageView({ title, actions, sub, seg, fill = false, children }: {
  title?: ReactNode;
  actions?: ReactNode;
  /** A line under the title, e.g. an intent's status. */
  sub?: ReactNode;
  seg?: ReactNode;
  fill?: boolean;
  children: ReactNode;
}) {
  const zone = useZone();
  return (
    <div className="sv sv-page">
      <div className={`sv-page-scroll${zone === "list" ? " sv-focus" : ""}`} data-zone="list" data-sv-list>
        <div className={`sv-page-col${fill ? " sv-fill" : ""}`}>
          {title !== undefined && (
            <header className="sv-page-head">
              <div className="sv-title"><span className="sv-page-t">{title}</span>{actions}</div>
              {sub && <div className="sv-page-sub">{sub}</div>}
              {seg && <div className="sv-page-seg">{seg}</div>}
            </header>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
