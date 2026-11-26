/** One of a few options, picked like a radio: a square that fills orange, a name, a line under it. */
export default function ChoiceCard({ title, sub, selected, onClick }: { title: string; sub: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" className="pl-plain-btn" onClick={onClick} aria-pressed={selected} style={{ display: "flex", alignItems: "flex-start", gap: 11, width: "100%", textAlign: "left", padding: "10px 12px", cursor: "pointer", border: `1px solid ${selected ? "#ccc" : "#e6e6e6"}`, borderRadius: 2, background: selected ? "#f7f7f5" : "#fff", boxShadow: "none" }}>
      <span style={{ flex: "0 0 auto", width: 13, height: 13, marginTop: 2, border: "1px solid #000", background: selected ? "#FF8A00" : "#fff", boxShadow: selected ? "inset 1px 1px 0 rgba(0,0,0,0.3)" : "none" }} />
      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span style={{ fontFamily: "var(--mac-mono)", fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ fontFamily: "var(--mac-sans)", fontSize: 12, color: "var(--ink-2)" }}>{sub}</span>
      </span>
    </button>
  );
}
