import type { CSSProperties, ReactNode } from "react";

/**
 * Loading placeholders: each one draws the shape of the content that's coming.
 * Styles live in styles/loading.css. They fade in after 250ms so fast loads don't flash.
 */

// Varied but stable widths, so rows don't look stamped out.
const WIDTHS = [62, 48, 74, 55, 68, 44, 80, 58];
const width = (i: number, offset = 0) => `${WIDTHS[(i + offset) % WIDTHS.length]}%`;

function Root({ label = "loading", className, style, children }: { label?: string; className: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} aria-busy="true" className={`ph ${className}`} style={style}>
      {children}
    </div>
  );
}

function Block({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={`ph-d ${className}`} style={style} />;
}

/** A list: an optional square avatar, a title line and a subline per row. */
function Rows({ count = 3, avatar = true, sub = true, label, style }: { count?: number; avatar?: boolean; sub?: boolean; label?: string; style?: CSSProperties }) {
  return (
    <Root label={label} className="ph-rows" style={style}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ph-row">
          {avatar && <Block className="ph-av" style={{ width: 24, height: 24 }} />}
          <div className="ph-col">
            <Block className="ph-line" style={{ width: width(i) }} />
            {sub && <Block className="ph-line" style={{ width: width(i, 3), height: 6 }} />}
          </div>
        </div>
      ))}
    </Root>
  );
}

/** An opportunity or match card: header with avatar and action, then a short write-up. */
function Card({ label, style }: { label?: string; style?: CSSProperties }) {
  return (
    <Root label={label} className="ph-card" style={style}>
      <div className="ph-row">
        <Block className="ph-av" style={{ width: 30, height: 30 }} />
        <div className="ph-col">
          <Block className="ph-line" style={{ width: "45%" }} />
          <Block className="ph-line" style={{ width: "65%", height: 6 }} />
        </div>
        <Block className="ph-chip" />
      </div>
      <Block className="ph-line" style={{ width: "100%" }} />
      <Block className="ph-line" style={{ width: "88%" }} />
      <Block className="ph-line" style={{ width: "40%" }} />
    </Root>
  );
}

/** A title and/or paragraph that's still coming. */
function Text({ lines = 3, title = false, label, style }: { lines?: number; title?: boolean; label?: string; style?: CSSProperties }) {
  return (
    <Root label={label} className="ph-text" style={style}>
      {title && <Block className="ph-title" style={{ width: "62%" }} />}
      {Array.from({ length: lines }, (_, i) => (
        <Block key={i} className="ph-line" style={{ width: i === lines - 1 && lines > 1 ? "55%" : i % 2 ? "92%" : "100%" }} />
      ))}
    </Root>
  );
}

/** A chat or agent log: bubbles from the agent and from you. */
function Thread({ label, style }: { label?: string; style?: CSSProperties }) {
  return (
    <Root label={label} className="ph-thread" style={style}>
      <div className="ph-bubble" style={{ width: 240 }}>
        <Block className="ph-line" style={{ width: "100%" }} />
        <Block className="ph-line" style={{ width: "70%" }} />
      </div>
      <div className="ph-bubble me" style={{ width: 150 }}>
        <Block className="ph-line" style={{ width: "100%" }} />
      </div>
      <div className="ph-bubble" style={{ width: 200 }}>
        <Block className="ph-line" style={{ width: "100%" }} />
        <Block className="ph-line" style={{ width: "50%" }} />
      </div>
    </Root>
  );
}

/** One agent bubble while the agent answers. `who` is a static label, e.g. "your agent · thinking". */
function Reply({ who = "your agent", label, style }: { who?: string; label?: string; style?: CSSProperties }) {
  return (
    <Root label={label ?? who} className="ph-thread" style={style}>
      <div className="ph-bubble" style={{ width: 220 }}>
        <span className="ph-who">{who}</span>
        <Block className="ph-line" style={{ width: "100%" }} />
        <Block className="ph-line" style={{ width: "60%" }} />
      </div>
    </Root>
  );
}

/** A whole page window: header (avatar, title, subline), a rule, then rows. */
function Window({ rows = 3, label, style }: { rows?: number; label?: string; style?: CSSProperties }) {
  return (
    <Root label={label} className="ph-window" style={style}>
      <div className="ph-row">
        <Block className="ph-av" style={{ width: 44, height: 44 }} />
        <div className="ph-col">
          <Block className="ph-title" style={{ width: "55%" }} />
          <Block className="ph-line" style={{ width: "35%" }} />
        </div>
      </div>
      <div className="ph-rule" />
      <div className="ph-rows">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="ph-row">
            <Block className="ph-av" style={{ width: 18, height: 18 }} />
            <Block className="ph-line" style={{ width: width(i, 2) }} />
          </div>
        ))}
      </div>
    </Root>
  );
}

/** A form or sign-in card: labelled inputs. */
function Form({ fields = 2, label, style }: { fields?: number; label?: string; style?: CSSProperties }) {
  return (
    <Root label={label} className="ph-form" style={style}>
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="ph-field">
          <Block className="ph-line" style={{ width: width(i, 5), maxWidth: 140, height: 6 }} />
          <Block className="ph-input" />
        </div>
      ))}
    </Root>
  );
}

/** A number that's refreshing, inline. */
function Count({ label = "loading" }: { label?: string }) {
  return <span role="status" aria-label={label} className="ph ph-d ph-count" />;
}

export const Placeholder = { Rows, Card, Text, Thread, Reply, Window, Form, Count };
export default Placeholder;
