export type ResolvedBannerVariant = 'rejected' | 'stalled';

interface ResolvedBannerProps {
  variant: ResolvedBannerVariant;
  /** outcome.reason (screened_out / turn_cap / timeout / …) drives the phrasing. */
  reason: string | null;
  turnCount: number | null;
  maxTurns: number | null;
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
export function ResolvedBanner({ variant, reason, turnCount, maxTurns, onRevive, onLetGo }: ResolvedBannerProps) {
  if (variant === 'rejected') {
    let body: string;
    if (reason === 'screened_out') {
      body = 'This connection was filtered out before either side reached out, so neither of you was notified.';
    } else if (!reason) {
      // Agent voluntarily withdrew — the candidate didn’t match this opportunity’s query.
      body = `Your agent withdrew after reviewing the opportunity${turnCount != null && turnCount > 0 ? ` (${turnCount} ${turnCount === 1 ? 'turn' : 'turns'})` : ''} — the candidate didn’t align with what you’re looking for. You were never notified while this played out.`;
    } else {
      body = `${turnCount != null && turnCount > 0 ? `After ${turnCount} ${turnCount === 1 ? 'turn' : 'turns'}, the` : 'The'} agents couldn’t justify this connection, so it was quietly set aside. You were never notified while this played out.`;
    }
    return (
      <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-4">
        <h3 className="font-ibm-plex-mono text-[13px] font-bold text-[#041729]">
          No opportunity — filtered out for you
        </h3>
        <p className="mt-1 text-[13px] text-[#3D3D3D]">{body}</p>
        <p className="mt-2.5 font-ibm-plex-mono text-[11px] text-gray-400">
          The other side never learns the details — declines are quiet by design.
        </p>
      </div>
    );
  }

  const timedOut = reason === 'timeout';
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
      <h3 className="font-ibm-plex-mono text-[13px] font-bold text-[#041729]">
        {timedOut ? 'Stalled — the dialogue timed out' : 'Stalled — agents ran out of turns'}
      </h3>
      <p className="mt-1 text-[13px] text-[#3D3D3D]">
        {timedOut
          ? 'The dialogue ended before the agents reached agreement.'
          : `The dialogue hit its ${maxTurns ?? 6}-turn budget without agreement.`}
        {' '}Sometimes a stalled thread is one answer away from resolving.
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
      <p className="mt-2.5 font-ibm-plex-mono text-[11px] text-gray-400">
        Answering routes through your agent and can revive the negotiation.
      </p>
    </div>
  );
}

export default ResolvedBanner;
