/** Adapted from Figure 1 of the Index opportunity paper. */
const text = 'var(--vocs-text-color-primary)'
const muted = 'var(--vocs-text-color-muted)'
const mono = 'var(--vocs-font-family-mono, ui-monospace, Menlo, monospace)'

export function OpportunityDiagram() {
  return (
    <figure style={{ margin: '24px 0' }}>
      <svg style={{ width: '100%', height: 'auto', display: 'block', fill: text }} viewBox="0 0 640 318" role="img" aria-label="Two people each hold a private intent with their own agent. The agents negotiate. If they agree, an opportunity is shown to both people, and it becomes mutual when both commit.">
        <defs>
          <marker id="opportunity-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={text}/></marker>
        </defs>
        <g fill="none" stroke={text} strokeWidth="1.1">
          <rect x="40" y="14" width="150" height="40"/>
          <rect x="450" y="14" width="150" height="40"/>
          <rect x="40" y="88" width="150" height="46"/>
          <rect x="450" y="88" width="150" height="46"/>
          <rect x="40" y="168" width="150" height="40"/>
          <rect x="450" y="168" width="150" height="40"/>
          <rect x="232" y="166" width="176" height="44" strokeDasharray="4 3"/>
          <rect x="150" y="248" width="340" height="56" strokeWidth="1.6"/>
        </g>
        <g stroke={text} strokeWidth="1.1" markerEnd="url(#opportunity-arrow)">
          <line x1="115" y1="54" x2="115" y2="86"/>
          <line x1="525" y1="54" x2="525" y2="86"/>
          <line x1="115" y1="134" x2="115" y2="166"/>
          <line x1="525" y1="134" x2="525" y2="166"/>
          <line x1="320" y1="210" x2="320" y2="246"/>
        </g>
        <g stroke={text} strokeWidth="1.1">
          <line x1="192" y1="188" x2="230" y2="188" markerEnd="url(#opportunity-arrow)" markerStart="url(#opportunity-arrow)"/>
          <line x1="410" y1="188" x2="448" y2="188" markerEnd="url(#opportunity-arrow)" markerStart="url(#opportunity-arrow)"/>
        </g>
        <g textAnchor="middle" fontSize="15">
          <text x="115" y="39">Person A</text>
          <text x="525" y="39">Person B</text>
          <text x="115" y="108">Intent A</text>
          <text x="525" y="108">Intent B</text>
          <text x="115" y="193">Agent A</text>
          <text x="525" y="193">Agent B</text>
          <text x="320" y="193">Negotiation</text>
          <text x="320" y="271" fontWeight="600">Opportunity</text>
        </g>
        <g textAnchor="middle">
          <text fill={muted} fontFamily={mono} fontSize="11" x="115" y="125">private</text>
          <text fill={muted} fontFamily={mono} fontSize="11" x="525" y="125">private</text>
          <text fill={muted} fontFamily={mono} fontSize="11" x="358" y="233" textAnchor="start">agreed</text>
          <text fontFamily={mono} fontSize="11" x="320" y="292">committed(A) · committed(B)</text>
        </g>
      </svg>
      <figcaption style={{ fontSize: 13, color: muted, marginTop: 8 }}>
        Each agent holds its person's intent; the negotiation joins the two sides.
        Agent agreement presents the opportunity. Both people's commitments make it mutual.
      </figcaption>
    </figure>
  )
}
