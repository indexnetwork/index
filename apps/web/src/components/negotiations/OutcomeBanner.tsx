interface OutcomeBannerProps {
  counterpartName: string;
  /** Viewer's negotiated role label (Helper/Seeker/Peer), if any turn suggested roles. */
  role: string | null;
  turnCount: number | null;
  /** Pre-formatted conclusion time label. */
  concludedLabel: string | null;
  loading: boolean;
  onStartChat: () => void;
  onPass: () => void;
}

/**
 * Outcome banner for a `pending` opportunity (proposals §2.3): separates what
 * the agents agreed from the human gate. Only "Start chat" writes `accepted`.
 */
export function OutcomeBanner({
  counterpartName,
  role,
  turnCount,
  concludedLabel,
  loading,
  onStartChat,
  onPass,
}: OutcomeBannerProps) {
  const summaryParts: string[] = [];
  if (turnCount != null && turnCount > 0) summaryParts.push(`${turnCount} ${turnCount === 1 ? 'turn' : 'turns'}`);
  if (concludedLabel) summaryParts.push(`concluded ${concludedLabel}`);

  return (
    <div className="mt-4 rounded-lg border border-[#bfe9d5] bg-[#f2fbf6] px-4 py-4">
      <h3 className="font-ibm-plex-mono text-[13px] font-bold text-[#041729]">
        Agents agreed — opportunity pending
      </h3>
      <p className="mt-1 text-[13px] text-[#3D3D3D]">
        {role && (
          <>
            Your negotiated role: <b>{role}</b>.{' '}
          </>
        )}
        {summaryParts.length > 0 && `${summaryParts.join(' · ')}.`}
      </p>
      <div className="mt-3 flex items-center gap-2.5">
        <button
          type="button"
          onClick={onStartChat}
          disabled={loading}
          className="rounded-sm bg-[#041729] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#0A2D4A] disabled:opacity-50"
        >
          Start chat with {counterpartName}
        </button>
        <button
          type="button"
          onClick={onPass}
          disabled={loading}
          className="rounded-sm border border-gray-200 bg-transparent px-3.5 py-2 text-xs font-semibold text-[#3D3D3D] transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          Pass
        </button>
      </div>
      <p className="mt-2.5 font-ibm-plex-mono text-[11px] text-gray-400">
        Your agent&apos;s accept is a recommendation, not a commitment. Only &quot;Start chat&quot; makes it real.
      </p>
    </div>
  );
}

export default OutcomeBanner;
