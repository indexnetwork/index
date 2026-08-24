import { Link } from 'react-router';

import { askingFirstReasonLabel, type AskingFirstState } from './asking-first';

interface AskingFirstCardProps {
  state: AskingFirstState;
  /** The counterparty's owner name — used verbatim in the one-sidedness line. */
  counterpartName: string;
}

/**
 * The radar's "asking you first" card — the third turn-0 verdict, on the
 * surface where the user watches their signal.
 *
 * Deliberately the PASSED card's shape ({@link GateDecisionCard}): both are
 * pre-contact states of the same decision, and reading them side by side is
 * how the user learns that "before any contact" is a real place their agent can
 * stop. Same headline/eyebrow/evidence/one-sidedness stack, one difference —
 * this decision is not final, so it ends in a way in rather than a full stop.
 *
 * Three things hold:
 * - **The counterparty was never written to.** The closing line is required,
 *   not decoration: the card names someone who cannot see any of this, and
 *   without the line it reads as though an approach were already underway.
 * - **The card does not answer.** No inputs, no options — the question lives in
 *   the signal's DM, which is the one surface with the transcript, the answer
 *   plumbing, and the retirement rules. The link is the whole affordance.
 * - **Nothing here is a promise.** The park resolves on the answer or its
 *   expiry, and this card resolves with it — into a negotiation the agent then
 *   opens, or into the PASSED card.
 */
export function AskingFirstCard({ state, counterpartName }: AskingFirstCardProps) {
  const reasonLabel = askingFirstReasonLabel(state.reason);
  const whatFit = state.whatFit?.trim();

  return (
    <section
      data-testid="asking-first-card"
      aria-label="Your agent's question for you"
      className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-4"
    >
      <h3 className="font-ibm-plex-mono text-[13px] font-bold text-[#041729]">
        Your agent wants to ask you first
      </h3>
      <p className="mt-1 font-ibm-plex-mono text-[11px] uppercase tracking-[0.12em] text-amber-700">
        Asking you · before any contact
      </p>
      {(whatFit || reasonLabel) && (
        <dl className="mt-3 space-y-1.5">
          {whatFit && (
            <div className="flex gap-2 text-[12px]">
              <dt className="w-20 shrink-0 font-ibm-plex-mono text-gray-400">what fit</dt>
              <dd className="text-[#3D3D3D]">{whatFit}</dd>
            </div>
          )}
          {reasonLabel && (
            <div className="flex gap-2 text-[12px]">
              <dt className="w-20 shrink-0 font-ibm-plex-mono text-gray-400">asking about</dt>
              <dd className="text-[#3D3D3D]">{reasonLabel}</dd>
            </div>
          )}
        </dl>
      )}
      <p className="mt-2.5 font-ibm-plex-mono text-[11px] text-gray-400">
        {counterpartName} was not contacted and cannot see this.
      </p>
      <Link
        to={`/i/${state.intentId}`}
        className="mt-2 inline-block text-[13px] font-medium text-[#041729] hover:underline"
      >
        Answer in this signal&apos;s DM
      </Link>
    </section>
  );
}

export default AskingFirstCard;
