import { useEffect, useState } from "react";

import { useNegotiations } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import type { NegotiationDetail } from "@/services/negotiations";

/** One match's read-only agent-to-agent thread, as plain speaker/text lines. */
export default function AgentLog({ opportunityId, name }: { opportunityId: string; name: string }) {
  const { user } = useAuthContext();
  const service = useNegotiations();
  const [detail, setDetail] = useState<NegotiationDetail>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const record = await service.getNegotiation(opportunityId);
        if (active) { setDetail(record); setFailed(false); }
      } catch {
        if (active) setFailed(true);
      } finally { loading = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5_000);
    return () => { active = false; clearInterval(timer); };
  }, [opportunityId, service]);

  const first = (detail?.counterparty.name || name).split(" ")[0];
  return (
    <div className="ih-log" data-testid="agent-log">
      {failed && !detail && <div className="ih-log-note">couldn&apos;t load this agent log.</div>}
      {!detail && !failed && <div className="ih-log-note">loading…</div>}
      {detail && detail.turns.length === 0 && <div className="ih-log-note">no turns yet.</div>}
      {detail?.turns.map((turn) => (
        <div key={turn.turnIndex} className="ih-log-line">
          <span className="ih-log-from">{turn.seatUserId === user?.id ? "your agent" : `${first}'s agent`}</span>
          <span className="ih-log-text">{turn.message}</span>
        </div>
      ))}
    </div>
  );
}
