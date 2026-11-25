/**
 * How Index reaches a person, used on `/use/introduce`: through a network
 * (discovery) or one hop through someone who knows them (an introduction),
 * never chained further. Inline SVG so it follows the docs theme.
 */

const text = 'var(--vocs-text-color-primary)'
const muted = 'var(--vocs-text-color-muted)'
const border = 'var(--vocs-border-color-primary)'
const accent = 'var(--vocs-color-accent)'
const mono = 'var(--vocs-font-family-mono, ui-monospace, Menlo, monospace)'

export function ReachDiagram() {
  return (
    <figure style={{ margin: '24px 0' }}>
      <svg
        viewBox="0 0 728 300"
        role="img"
        aria-label="Leo is in a network with you; Dana is your contact outside every network. Your introduction reaches Dana in one hop through you. Dana's own contacts are never reached."
        style={{ width: '100%', height: 'auto', display: 'block', fontFamily: mono }}
      >
        <rect x="16" y="20" width="330" height="250" rx="14" fill="none" stroke={border} strokeWidth="2" />
        <text x="32" y="242" fontSize="11" fill={muted}>NETWORK</text>
        <text x="32" y="258" fontSize="11" fill={muted}>reach by discovery</text>

        <circle cx="190" cy="95" r="14" fill="none" stroke={border} strokeWidth="1.5" />
        <circle cx="215" cy="220" r="14" fill="none" stroke={border} strokeWidth="1.5" />
        <line x1="124" y1="140" x2="178" y2="102" stroke={border} strokeWidth="1.5" />
        <line x1="246" y1="150" x2="134" y2="150" stroke={border} strokeWidth="1.5" />

        <circle cx="110" cy="150" r="24" fill="none" stroke={text} strokeWidth="2" />
        <text x="110" y="155" textAnchor="middle" fontSize="13" fontWeight="700" fill={text}>Leo</text>
        <text x="110" y="192" textAnchor="middle" fontSize="11" fill={muted}>needs a payments</text>
        <text x="110" y="206" textAnchor="middle" fontSize="11" fill={muted}>design partner</text>

        <circle cx="270" cy="150" r="24" fill={accent} />
        <text x="270" y="155" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">you</text>

        <line x1="294" y1="150" x2="476" y2="150" stroke={text} strokeWidth="2" />
        <text x="385" y="142" textAnchor="middle" fontSize="11" fill={muted}>your contact</text>

        <circle cx="500" cy="150" r="24" fill="none" stroke={text} strokeWidth="2" strokeDasharray="4 4" />
        <text x="500" y="155" textAnchor="middle" fontSize="13" fontWeight="700" fill={text}>Dana</text>
        <text x="500" y="192" textAnchor="middle" fontSize="11" fill={muted}>not on Index</text>
        <text x="500" y="206" textAnchor="middle" fontSize="11" fill={muted}>reached through you</text>

        <path d="M 118 126 C 200 20, 420 20, 492 126" fill="none" stroke={accent} strokeWidth="3" />
        <text x="305" y="44" textAnchor="middle" fontSize="13" fontWeight="700" fill={accent}>⇄ introduction · one hop through you</text>

        <line x1="524" y1="150" x2="640" y2="110" stroke={muted} strokeWidth="1.5" strokeDasharray="3 5" />
        <line x1="524" y1="150" x2="640" y2="195" stroke={muted} strokeWidth="1.5" strokeDasharray="3 5" />
        <circle cx="655" cy="105" r="13" fill="none" stroke={muted} strokeDasharray="3 3" />
        <circle cx="655" cy="200" r="13" fill="none" stroke={muted} strokeDasharray="3 3" />
        <text x="600" y="157" textAnchor="middle" fontSize="13" fontWeight="700" fill={muted}>✕</text>
        <text x="655" y="240" textAnchor="middle" fontSize="11" fill={muted}>Dana's contacts</text>
        <text x="655" y="254" textAnchor="middle" fontSize="11" fill={muted}>never reached</text>
      </svg>
      <figcaption style={{ fontSize: 13, color: muted, marginTop: 8 }}>
        Discovery reaches Leo because you share a network. Only you can reach Dana, and reach stops there.
      </figcaption>
    </figure>
  )
}
