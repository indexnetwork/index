import type { CSSProperties, ReactNode } from "react";

/**
 * The agent is on a long job. `look` is the hand-drawn eye (searching, reading),
 * `grow` is the hand-drawn leaf (creating, setting up). The line is plain text.
 */
export function AgentWorking({ kind, children, size = 120, style }: {
  kind: "look" | "grow";
  children?: ReactNode;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <div className="agent-working" role="status" aria-live="polite" style={style}>
      <img src={kind === "look" ? "/loading/eye.webp" : "/loading/leaf.webp"} alt="" width={size} height={size} />
      {children && <div>{children}</div>}
    </div>
  );
}

/** First paint, before auth resolves: we don't know yet whether this is the site or the app. */
export function BootSplash() {
  return (
    <div className="boot-splash" role="status" aria-label="loading">
      <img src="/loading/eye.webp" alt="" width={96} height={96} />
    </div>
  );
}

export default AgentWorking;
