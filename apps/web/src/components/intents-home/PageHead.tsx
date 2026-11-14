import type { ReactNode } from "react";

/**
 * A page's head, drawn like the intent detail page: a small eyebrow, the title,
 * a status line, and the page's buttons on the right.
 */
export default function PageHead({ eyebrow, title, status, dot, centered = false, back, children }: {
  eyebrow?: ReactNode;
  /** A drill-in page's way back, shown above the eyebrow. */
  back?: { label: string; onClick: () => void };
  title: ReactNode;
  status?: ReactNode;
  dot?: string;
  /** Center the title on the buttons' line (a one-line head, like Home's). */
  centered?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className={centered ? "ih-head ih-head-centered" : "ih-head"}>
      <div style={{ flex: 1, minWidth: 240 }}>
        {back && <button type="button" className="pl-back ih-head-back" onClick={back.onClick}>◂ {back.label}</button>}
        {eyebrow && <div className="ih-eyebrow">{eyebrow}</div>}
        <h1 className="ih-title">{title}</h1>
        {status && (
          <div className="ih-status">
            {dot && <span className="ih-status-dot" style={{ background: dot }} />}
            <span style={{ flex: 1, minWidth: 0 }}>{status}</span>
          </div>
        )}
      </div>
      {children && <div className="ih-actions">{children}</div>}
    </header>
  );
}
