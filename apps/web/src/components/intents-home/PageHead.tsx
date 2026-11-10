import type { ReactNode } from "react";

/**
 * A page's head, drawn like the intent detail page: a small eyebrow, the title,
 * a status line, and the page's buttons on the right.
 */
export default function PageHead({ eyebrow, title, status, dot, inlineStatus = false, back, children }: {
  eyebrow?: ReactNode;
  /** A drill-in page's way back, shown above the eyebrow. */
  back?: { label: string; onClick: () => void };
  title: ReactNode;
  status?: ReactNode;
  dot?: string;
  /** Put the status on the title's line instead of under it. */
  inlineStatus?: boolean;
  children?: ReactNode;
}) {
  const statusLine = status && (
    <div className={inlineStatus ? "ih-status ih-status-inline" : "ih-status"}>
      {dot && <span className="ih-status-dot" style={{ background: dot }} />}
      <span style={{ flex: 1, minWidth: 0 }}>{status}</span>
    </div>
  );
  return (
    <header className="ih-head">
      <div style={{ flex: 1, minWidth: 240 }}>
        {back && <button type="button" className="pl-back ih-head-back" onClick={back.onClick}>◂ {back.label}</button>}
        {eyebrow && <div className="ih-eyebrow">{eyebrow}</div>}
        {inlineStatus ? (
          <div className="ih-title-row">
            <h1 className="ih-title">{title}</h1>
            {statusLine}
          </div>
        ) : (
          <>
            <h1 className="ih-title">{title}</h1>
            {statusLine}
          </>
        )}
      </div>
      {children && <div className="ih-actions">{children}</div>}
    </header>
  );
}
