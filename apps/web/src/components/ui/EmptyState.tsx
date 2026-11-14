import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";

export type EmptyStateAction =
  | { label: string; onClick: () => void; primary?: boolean; large?: boolean }
  | { label: string; to: string; primary?: boolean; large?: boolean };

export interface EmptyStateProps {
  /** loading, error or empty. Error is announced to assistive tech. */
  tone?: "empty" | "error" | "loading";
  /** Defaults to `loading…` for the loading tone. */
  message?: ReactNode;
  /** One CTA, or several rendered side by side. */
  action?: EmptyStateAction | EmptyStateAction[];
  /** Draws the 1px hairline box used by empty panes. */
  framed?: boolean;
  /** Left-aligns instead of centring (for inline list slots). */
  align?: "center" | "start";
  style?: CSSProperties;
  className?: string;
}

/**
 * The one empty / loading / error block for the authenticated web app.
 * Sans 13px in `--ink-3`, optional hairline frame, actions use the workbench button.
 */
export function EmptyState({
  tone = "empty",
  message,
  action,
  framed = false,
  align = "center",
  style,
  className,
}: EmptyStateProps) {
  const actions = action ? (Array.isArray(action) ? action : [action]) : [];
  const text = message ?? (tone === "loading" ? "loading…" : null);
  const centred = align === "center";
  return (
    <div
      className={className}
      role={tone === "error" ? "alert" : tone === "loading" ? "status" : undefined}
      aria-live={tone === "loading" ? "polite" : undefined}
      data-tone={tone}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: centred ? "center" : "flex-start",
        textAlign: centred ? "center" : "left",
        gap: 10,
        padding: framed ? "18px 14px" : "10px 6px",
        border: framed ? "1px solid var(--wb-hairline, #e3e3e0)" : undefined,
        borderRadius: framed ? 3 : undefined,
        fontFamily: "var(--mac-sans)",
        fontSize: 13,
        lineHeight: 1.5,
        color: "var(--ink-3, #777)",
        ...style,
      }}
    >
      {text != null && <div>{text}</div>}
      {actions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: centred ? "center" : "flex-start" }}>
          {actions.map((a) => {
            const cls = `wb-btn${a.large ? "" : " small"}${a.primary ? " primary" : ""}`;
            return "to" in a ? (
              <Link key={a.label} to={a.to} className={cls} style={{ textDecoration: "none" }}>
                {a.label}
              </Link>
            ) : (
              <button key={a.label} type="button" className={cls} onClick={a.onClick}>
                {a.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
