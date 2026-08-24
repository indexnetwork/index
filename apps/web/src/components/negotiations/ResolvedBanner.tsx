import type { TerminalTurnAuthor } from './negotiation-turns';

export type ResolvedBannerVariant = 'rejected' | 'stalled';

interface ResolvedBannerProps {
  variant: ResolvedBannerVariant;
  /** outcome.reason (screened_out / turn_cap / timeout / …) drives the phrasing. */
  reason: string | null;
  turnCount: number | null;
  maxTurns: number | null;
  /**
   * Whether the thread this banner renders into holds any agent message.
   *
   * The `screened_out` copy makes three claims about history — nobody reached
   * out, nobody was notified, the other side never learns the details — that the
   * banner cannot verify from an outcome label alone. It was observed rendering
   * all three directly beneath a two-hour-old outreach, because a negotiation
   * recovered from an error stall was re-screened after contact. The outcome is
   * the wrong place to fix that (bad rows already exist and keep their terminal
   * state), so the copy is gated on what the reader can see instead: with
   * messages above it, the banner drops every pre-contact claim and says only
   * what is still true — the negotiation ended without agreement.
   *
   * Omitted (undefined) means "no thread context", which reads as no contact
   * and preserves the existing copy for callers that render without a transcript.
   */
  contactMade?: boolean;
  /**
   * Who authored the turn that ended this negotiation, derived from the
   * transcript rendered above (`terminalTurnAuthor`).
   *
   * The outcome label cannot supply it — `rejected` says a negotiation ended
   * against the match, never which agent decided that — and this banner is the
   * only account the owner gets of what happened. It was observed telling an
   * owner "your agent withdrew after reviewing the opportunity" above a
   * transcript whose final turn was the COUNTERPARTY's agent declining them.
   *
   * Omitted/null means the transcript settles nothing, and the copy says
   * nothing: neutral wording, never a guess about who walked away.
   */
  terminalAuthor?: TerminalTurnAuthor | null;
  /** Stalled only: route to the user's agent to answer the open question. */
  onRevive?: () => void;
  /** Stalled only: leave the transcript. */
  onLetGo?: () => void;
}

/**
 * Resolved-state banners (proposals §2.4). Negative outcomes are framed as
 * filtering done for you, with hedged, reason-based phrasing — a screened-out
 * thread never names who screened, so the counterparty learns nothing.
 */
export function ResolvedBanner({ variant, reason, turnCount, maxTurns, contactMade = false, terminalAuthor = null, onRevive, onLetGo }: ResolvedBannerProps) {
  if (variant === 'rejected') {
    const screenedOutBeforeContact = reason === 'screened_out' && !contactMade;
    const turnsSuffix = turnCount != null && turnCount > 0
      ? ` (${turnCount} ${turnCount === 1 ? 'turn' : 'turns'})`
      : '';
    let body: string;
    if (screenedOutBeforeContact) {
      body = 'This connection was filtered out before either side reached out, so neither of you was notified.';
    } else if (reason === 'screened_out') {
      // Contact exists, so no claim is made about who reached out, who was
      // notified, or what the other side knows — only that it ended here.
      body = 'This negotiation ended without agreement.';
    } else if (terminalAuthor === 'counterparty') {
      // Their agent ended it. Saying "your agent withdrew" here — which is what
      // this banner did — reverses who decided and who was decided about, and
      // it is the owner's only account of the exchange.
      body = `Their agent declined${turnsSuffix} — the two agents didn’t find enough mutual value.`;
    } else if (terminalAuthor === 'own') {
      // Our own agent walked away: the original copy, now stated only where the
      // transcript actually shows this side authoring the terminal turn.
      body = `Your agent withdrew after reviewing the opportunity${turnsSuffix} — the candidate didn’t align with what you’re looking for. You were never notified while this played out.`;
    } else {
      // The transcript does not say who ended it, so neither does the copy.
      body = `${turnCount != null && turnCount > 0 ? `After ${turnCount} ${turnCount === 1 ? 'turn' : 'turns'}, the` : 'The'} agents ended this without a match.`;
    }
    // "filtered out for you" and the quiet-decline footnote are both claims
    // about a decision THIS side made. Above a decline the counterparty
    // authored — or an ending nobody can attribute — neither is ours to make.
    const ownDecision = reason !== 'screened_out' && terminalAuthor === 'own';
    const showQuietFootnote = screenedOutBeforeContact || ownDecision;
    return (
      <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-4">
        <h3 className="font-ibm-plex-mono text-[13px] font-bold text-[#041729]">
          {/*
            "filtered out for you" says this side did the filtering. It survives
            only where that is demonstrably true: a connection screened before it
            reached anyone, or our own agent's withdrawal. Above a thread whose
            terminal turn came from the counterparty — or from nobody the
            transcript can name — only the verdict survives.
          */}
          {screenedOutBeforeContact || ownDecision ? 'No opportunity — filtered out for you' : 'No opportunity'}
        </h3>
        <p className="mt-1 text-[13px] text-[#3D3D3D]">{body}</p>
        {/*
          The quiet-decline footnote is a claim about the counterparty's
          knowledge: that OUR side's decision never reached them. It holds for
          an end reached without contact, and for our own agent's withdrawal —
          but not above a visible outreach the counterparty demonstrably
          received, and not when THEY are the side that declined.
        */}
        {showQuietFootnote && (
          <p className="mt-2.5 font-ibm-plex-mono text-[11px] text-gray-400">
            The other side never learns the details — declines are quiet by design.
          </p>
        )}
      </div>
    );
  }

  // Four distinct ends used to share one line of copy: only `turn_cap` is
  // actually a spent turn budget, and claiming one for the others told the
  // owner a six-turn dialogue had happened when the transcript held a single
  // message. `agent_error` is the honest name for the run that stopped on
  // repeated agent failures — nothing was decided, and nothing was spent.
  const erroredOut = reason === 'agent_error';
  const timedOut = reason === 'timeout';
  const heading = erroredOut
    ? 'Stalled — the agents hit an error'
    : timedOut
      ? 'Stalled — the dialogue timed out'
      : reason === 'turn_cap'
        ? 'Stalled — agents ran out of turns'
        : 'Stalled — the dialogue didn’t conclude';
  const body = erroredOut
    ? 'The agents stopped after repeated errors, so nothing was decided here — this is a fault on our side, not a verdict on the match.'
    : timedOut
      ? 'The dialogue ended before the agents reached agreement.'
      : reason === 'turn_cap'
        ? `The dialogue hit its ${maxTurns ?? 6}-turn budget without agreement.`
        : 'The agents stopped before reaching agreement.';
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
      <h3 className="font-ibm-plex-mono text-[13px] font-bold text-[#041729]">
        {heading}
      </h3>
      <p className="mt-1 text-[13px] text-[#3D3D3D]">
        {body}
        {erroredOut ? '' : ' Sometimes a stalled thread is one answer away from resolving.'}
      </p>
      <div className="mt-3 flex items-center gap-2.5">
        {onRevive && (
          <button
            type="button"
            onClick={onRevive}
            className="rounded-sm border border-gray-200 bg-white px-3.5 py-2 text-xs font-semibold text-[#041729] transition-colors hover:bg-gray-50"
          >
            Answer the open question
          </button>
        )}
        {onLetGo && (
          <button
            type="button"
            onClick={onLetGo}
            className="rounded-sm border border-gray-200 bg-transparent px-3.5 py-2 text-xs font-semibold text-[#3D3D3D] transition-colors hover:bg-gray-50"
          >
            Let it go
          </button>
        )}
      </div>
      {!erroredOut && (
        <p className="mt-2.5 font-ibm-plex-mono text-[11px] text-gray-400">
          Answering routes through your agent and can revive the negotiation.
        </p>
      )}
    </div>
  );
}

export default ResolvedBanner;
