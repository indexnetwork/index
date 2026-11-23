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
