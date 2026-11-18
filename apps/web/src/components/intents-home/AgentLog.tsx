import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import TranslatedMark from "@/components/TranslatedMark";
import { useNegotiations } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useContentTranslation } from "@/lib/content-translation";
import type { NegotiationDetail } from "@/services/negotiations";

/** One turn of the agents' thread, in the viewer's language. */
function LogLine({ from, message }: { from: string; message: string }) {
  const shown = useContentTranslation(message);
  return (
    <div className="ih-log-line">
      <span className="ih-log-from">{from}</span>
      <span className="ih-log-text">{shown.text}{shown.active && <> <TranslatedMark state={shown} /></>}</span>
    </div>
  );
}

/** One match's read-only agent-to-agent thread, as plain speaker/text lines. */
export default function AgentLog({ opportunityId, name }: { opportunityId: string; name: string }) {
  const { t } = useTranslation();
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
      {failed && !detail && <div className="ih-log-note">{t("couldn't load this agent log.")}</div>}
      {!detail && !failed && <div className="ih-log-note">{t("loading…")}</div>}
      {detail && detail.turns.length === 0 && <div className="ih-log-note">{t("no turns yet.")}</div>}
      {detail?.turns.map((turn) => (
        <LogLine key={turn.turnIndex} from={turn.seatUserId === user?.id ? t("your agent") : t("{{name}}'s agent", { name: first })} message={turn.message} />
      ))}
    </div>
  );
}
