/** Pixel-ish nav glyphs shared by the home shelf and the compact tab bar. */

export function ChatGlyph({ size = 17.6 }: { size?: number }) {
  return (
    <svg width={size} height={size * (20 / 22)} viewBox="0 0 22 20" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="miter" style={{ display: "block" }}>
      <path d="M2 2h18v12H9l-5 4v-4H2z" />
    </svg>
  );
}

export function NetworksGlyph({ scale = 1 }: { scale?: number }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 4 * scale }}>
      {[0, 1].map((row) => (
        <span key={row} style={{ display: "flex", gap: 3.2 * scale, alignItems: "center" }}>
          <span style={{ width: 3.2 * scale, height: 3.2 * scale, background: "currentColor" }} />
          <span style={{ width: 10.4 * scale, height: 3.2 * scale, background: "currentColor" }} />
        </span>
      ))}
    </span>
  );
}

export function AgentGlyph({ size = 20.8 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" strokeLinejoin="miter" style={{ display: "block" }}>
      <line x1="12" y1="3" x2="12" y2="6" />
      <circle cx="12" cy="2.5" r="1" fill="currentColor" stroke="none" />
      <rect x="4" y="6" width="16" height="12" rx="1.5" />
      <line x1="2" y1="11" x2="4" y2="11" />
      <line x1="20" y1="11" x2="22" y2="11" />
      <rect x="8.5" y="10" width="2" height="2.5" fill="currentColor" stroke="none" />
      <rect x="13.5" y="10" width="2" height="2.5" fill="currentColor" stroke="none" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

/** A dot broadcasting outward: a signal your agent carries. */
export function SignalGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="square" style={{ display: "block" }}>
      <rect x="10" y="10" width="4" height="4" fill="currentColor" stroke="none" />
      <path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10" />
      <path d="M3.5 3.5a12 12 0 0 0 0 17M20.5 3.5a12 12 0 0 1 0 17" />
    </svg>
  );
}
