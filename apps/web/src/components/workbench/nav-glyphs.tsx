/** Thin line nav glyphs shared by the home shelf and the compact tab bar. */

const STROKE = 1.25;

export function ChatGlyph({ size = 17.6 }: { size?: number }) {
  return (
    <svg width={size} height={size * (20 / 22)} viewBox="0 0 22 20" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinejoin="round" style={{ display: "block" }}>
      <path d="M2 2h18v12H9l-5 4v-4H2z" />
    </svg>
  );
}

export function NetworksGlyph({ scale = 1 }: { scale?: number }) {
  return (
    <svg width={16 * scale} height={12 * scale} viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" style={{ display: "block" }}>
      <line x1="1.5" y1="3" x2="2.5" y2="3" />
      <line x1="5.5" y1="3" x2="14.5" y2="3" />
      <line x1="1.5" y1="9" x2="2.5" y2="9" />
      <line x1="5.5" y1="9" x2="14.5" y2="9" />
    </svg>
  );
}

export function AgentGlyph({ size = 20.8 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <line x1="12" y1="3.5" x2="12" y2="6" />
      <circle cx="12" cy="2.5" r="1" />
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <line x1="2" y1="11" x2="4" y2="11" />
      <line x1="20" y1="11" x2="22" y2="11" />
      <line x1="9.5" y1="10" x2="9.5" y2="12.5" />
      <line x1="14.5" y1="10" x2="14.5" y2="12.5" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

/** A dot broadcasting outward: an intent your agent carries. */
export function IntentGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" style={{ display: "block" }}>
      <circle cx="12" cy="12" r="2" />
      <path d="M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10" />
      <path d="M3.5 3.5a12 12 0 0 0 0 17M20.5 3.5a12 12 0 0 1 0 17" />
    </svg>
  );
}

/** A house: the way home from a screen with nothing behind it. */
export function HomeGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d="M3 11 12 3l9 8" />
      <path d="M5.5 9.5V21h13V9.5" />
      <path d="M10 21v-7h4v7" />
    </svg>
  );
}
