import type { GateDecision } from './gate-decision';

interface GateDecisionCardProps {
  decision: GateDecision;
  /** The counterparty's owner name — used verbatim in the one-sidedness line. */
  counterpartName: string;
}

/**
 * IND-610 — the owner-only outreach-gate card.
 *
 * A zero-turn `screened_out` negotiation is a decision the viewer's own agent
 * made *for* them and, until now, never told them about: the transcript
 * dead-ended at "No messages in this negotiation". This surfaces the reasoning
 * the gate already persisted.
 *
 * Three invariants hold this together:
 * - **It is not a message.** House style for this surface is the turn rail
 *   (`TurnRail.tsx`: "verb + role chips + reasoning per turn. No DM bubbles"),
 *   and the precedent for an inline non-turn element is the missed-window decay
 *   line. Rendering a withdraw as a message would push it into `state.messages`,
 *   the thread both sides read back as `priorDialogue` — leaking "your agent
 *   judged me not worth it" to the counterparty. This component only reads
 *   already-projected data; it writes nothing.
 * - **It is one-sided, and says so.** The closing line is required, not
 *   decoration: without it a card naming the counterparty reads like a leak.
 * - **The data is owner-only.** The API projects `screenDecision` only when
 *   `initiatorUserId === viewerUserId`; a non-owner never receives the fields
 *   this component renders.
 */
export function GateDecisionCard({ decision, counterpartName }: GateDecisionCardProps) {
  const reasoning = decision.reasoning.trim();
  const evidence: Array<{ label: string; value: string }> = [];
  if (decision.counterpartyPremiseFit?.trim()) {
    evidence.push({ label: 'what fit', value: decision.counterpartyPremiseFit.trim() });
  }
  if (decision.intentAlignment?.trim()) {
    evidence.push({ label: 'intent', value: decision.intentAlignment.trim() });
  }

  return (
    <section
      data-testid="gate-decision-card"
      aria-label="Your agent's outreach decision"
      className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-4"
    >
      <h3 className="font-ibm-plex-mono text-[13px] font-bold text-[#041729]">
        Your agent did not reach out
      </h3>
      <p className="mt-1 font-ibm-plex-mono text-[11px] uppercase tracking-[0.12em] text-gray-400">
        Passed · before any contact
      </p>
      {reasoning && <p className="mt-2 text-[13px] text-[#3D3D3D]">{reasoning}</p>}
      {evidence.length > 0 && (
        <dl className="mt-3 space-y-1.5">
          {evidence.map((item) => (
            <div key={item.label} className="flex gap-2 text-[12px]">
              <dt className="w-20 shrink-0 font-ibm-plex-mono text-gray-400">{item.label}</dt>
              <dd className="text-[#3D3D3D]">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2.5 font-ibm-plex-mono text-[11px] text-gray-400">
        {counterpartName} was not contacted and cannot see this.
      </p>
    </section>
  );
}

export default GateDecisionCard;
