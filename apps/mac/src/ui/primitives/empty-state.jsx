/* ---------- EmptyState: the one dialect for loading / error / empty ----------
   Every data-backed list or pane renders exactly one of loading, error, empty
   or content. This is the shared look for the first three: mono 12px in
   --ink-2, optionally inside the dashed box the radar and the wire already use.

     tone     "empty" | "error" | "loading"
     message  the line itself. loading defaults to "loading…".
     action   { label, onClick } or an array of them, rendered as small gadgets
              under the message. an error with an onRetry gets "try again".
     onRetry  shorthand for an error's { label:"try again", onClick:onRetry }.
     framed   draw the dashed box (default true). false for inline spots.
*/
function EmptyState({ tone = "empty", message, action, onRetry, framed = true, align = "center", style }) {
  const actions = []
    .concat(action || [])
    .concat(tone === "error" && onRetry ? [{ label:"try again", onClick:onRetry }] : [])
    .filter(Boolean);
  const text = message || (tone === "loading" ? "loading…" : "");
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-busy={tone === "loading" ? true : undefined}
      style={{
        padding: framed ? "18px 16px" : "6px 0",
        textAlign: align,
        fontFamily:"var(--mac-mono)", fontSize:12, lineHeight:1.55,
        color: tone === "error" ? "var(--ink)" : "var(--ink-2)",
        border: framed ? "1px dashed #000" : "none",
        display:"grid", gap:10, justifyItems: align === "center" ? "center" : "start",
        ...style,
      }}
    >
      <span>{text}</span>
      {actions.length > 0 && (
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent: align === "center" ? "center" : "flex-start" }}>
          {actions.map((a) => (
            <Btn key={a.label} small primary={!!a.primary} onClick={a.onClick}>{a.label}</Btn>
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { EmptyState });
