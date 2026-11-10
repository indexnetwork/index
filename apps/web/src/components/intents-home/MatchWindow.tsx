import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import AgentLog from "@/components/intents-home/AgentLog";
import { useAgentWindow } from "@/components/intents-home/agentWindowContext";
import type { Entry } from "@/components/intents-home/stages";
import { SOCIAL_ICONS } from "@/components/SocialIcons";
import UserAvatar from "@/components/UserAvatar";
import { useOpportunities, useUsers } from "@/contexts/APIContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { resolveSocials } from "@/lib/socials";
import type { OpportunityDetailResponse } from "@/services/opportunities";

/** What the window shows about the person, from their profile. */
interface Who {
  intro?: string | null;
  location?: string | null;
  socials?: Array<{ label: string; value: string }> | null;
}

/**
 * One match beside Home, in the agent window's place: their profile, why
 * your agent surfaced them, and the agents' conversation behind "agent log".
 */
export default function MatchWindow() {
  const navigate = useNavigate();
  const { log: match, setLog } = useAgentWindow();
  const { entriesByIntent, opportunityActionLoading, handleOpportunityAction, loadRadar } = useIntentsData();
  const users = useUsers();
  const opportunities = useOpportunities();
  // Each fetch is kept with the id it was for, so a different match never shows stale data.
  const [whoFor, setWhoFor] = useState<{ id: string; who: Who } | null>(null);
  // The agents' conversation opens from "agent log", kept per match so a new one starts closed.
  const [logFor, setLogFor] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<{ id: string; detail: OpportunityDetailResponse } | null>(null);

  // The card's entries, refreshed from the live list so a decision shows here at once.
  const entries: Entry[] = useMemo(() => {
    if (!match) return [];
    const base = match.entries?.length ? match.entries : [];
    return base
      .map((entry) => (entriesByIntent[entry.intentId] ?? []).find((live) => live.item.opportunityId === entry.item.opportunityId) ?? entry)
      .sort((a, b) => (a.stage === b.stage ? 0 : a.stage === "awaiting" ? -1 : b.stage === "awaiting" ? 1 : 0));
  }, [match, entriesByIntent]);
  const lead = entries.find((entry) => entry.item.opportunityId === match?.opportunityId) ?? entries[0];
  const stage = lead?.stage ?? "talks";
  const demo = match?.opportunityId.startsWith("demo-") ?? false;

  useEffect(() => {
    if (!match?.userId) return;
    const id = match.userId;
    let active = true;
    users.getUserProfile(id).then((profile) => { if (active) setWhoFor({ id, who: profile as Who }); }).catch(() => {});
    return () => { active = false; };
  }, [match?.userId, users]);

  useEffect(() => {
    if (!match || demo) return;
    const id = match.opportunityId;
    let active = true;
    opportunities.getOpportunity(id).then((res) => { if (active) setDetailFor({ id, detail: res }); }).catch(() => {});
    return () => { active = false; };
  }, [match, demo, opportunities]);

  const who = whoFor && whoFor.id === match?.userId ? whoFor.who : null;
  const detail = detailFor && detailFor.id === match?.opportunityId ? detailFor.detail : null;

  if (!match) return null;
  const showLog = logFor === match.opportunityId;
  const setShowLog = (on: boolean) => setLogFor(on ? match.opportunityId : null);
  const first = match.name.split(" ")[0];
  const item = lead?.item;
  const socials = resolveSocials(who?.socials ?? []);

  // The longest account of why this match, falling back to the card's short one.
  const headline = item?.headline || detail?.presentation?.title || "";
  const why = [item?.personalizedSummary, detail?.presentation?.description, item?.mainText]
    .map((text) => text?.trim())
    .filter((text): text is string => !!text && text !== headline)
    .filter((text, index, all) => all.indexOf(text) === index);
  const busy = entries.some((entry) => opportunityActionLoading[entry.item.opportunityId]);

  const act = (action: "accepted" | "rejected") => {
    if (demo) { setLog(null); return; }
    for (const entry of entries.filter((e) => e.stage === "awaiting")) {
      if (opportunityActionLoading[entry.item.opportunityId]) continue;
      void handleOpportunityAction(entry.item.opportunityId, action, match.userId, {
        notOnIndex: match.notOnIndex,
        scope: { intentId: entry.intentId },
      }).then(() => loadRadar(entry.intentId));
    }
    if (action === "rejected") setLog(null);
  };

  // One paragraph on why: the longest account there is, else the headline.
  const surfaced = why[0] || headline;
  const canLog = !demo && (stage === "talks" || stage === "awaiting" || stage === "chat");

  // Drawn like the classic profile window (as on main): who they are first, then why.
  return (
    <section className="ih-agentwin ih-matchwin ih-classic ih-profile" aria-label={`you and ${first}`}>
      <div className="profile-header ih-match-top">
        {match.userId
          ? <Link to={`/u/${match.userId}`} title={`${match.name}'s profile`} style={{ display: "flex" }}><UserAvatar id={match.userId} name={match.name} avatar={match.avatar} size={54} /></Link>
          : <UserAvatar id={match.opportunityId} name={match.name} avatar={match.avatar} size={54} />}
        <div className="profile-identity">
          <div className="profile-name">
            {match.userId ? <Link to={`/u/${match.userId}`} className="ih-match-name">{match.name}</Link> : match.name}
          </div>
          {match.notOnIndex && <div className="profile-location">not on index yet</div>}
        </div>
        <button type="button" className="pl-win-close" aria-label="close (esc)" title="close (esc)" onClick={() => setLog(null)}>×</button>
      </div>

      <div className="mac-scroll profile-content ih-match-content">
        {(who?.intro || (!who && match.userId)) && (
          <section>
            <h3 className="ih-match-label">bio</h3>
            {who?.intro ? <p className="profile-bio">{who.intro}</p> : <div className="profile-dim">loading…</div>}
          </section>
        )}

        <section>
          <h3 className="ih-match-label">why your agent surfaced them</h3>
          {surfaced ? <p className="profile-bio">{surfaced}</p> : <div className="profile-dim">I&apos;m still writing this up.</div>}
        </section>

        {socials.length > 0 && (
          <section>
            <h3 className="ih-match-label">elsewhere</h3>
            <div className="profile-chips">
              {socials.map((s) => (
                <a className="profile-social" key={s.href} href={s.href} target="_blank" rel="noopener noreferrer">
                  {SOCIAL_ICONS[s.platform]}
                  <span>{s.handle}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {who?.location && <div className="profile-dim">{who.location}</div>}

        {showLog && canLog && (
          <section id="ih-match-log" className="profile-ruled">
            <h3 className="ih-match-label">my agent and {first}&apos;s agent</h3>
            <AgentLog key={match.opportunityId} opportunityId={match.opportunityId} name={match.name} />
          </section>
        )}
      </div>

      <div className="ih-match-foot">
        {stage === "awaiting" && (
          <>
            <button type="button" className="wb-btn primary" disabled={busy} onClick={() => act("accepted")}>{busy ? "sending…" : "accept"}</button>
            <button type="button" className="wb-btn" disabled={busy} onClick={() => act("rejected")}>pass</button>
          </>
        )}
        {stage === "chat" && match.notOnIndex && <button type="button" className="wb-btn" onClick={() => navigate(`/i/${lead.intentId}`)}>send invite</button>}
        {stage === "chat" && !match.notOnIndex && match.userId && <button type="button" className="wb-btn primary" onClick={() => navigate(`/u/${match.userId}/chat`)}>go to chat</button>}
        {canLog && (
          <button type="button" className="wb-btn" aria-pressed={showLog} onClick={() => {
            const next = !showLog;
            setShowLog(next);
            if (next) setTimeout(() => document.getElementById("ih-match-log")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
          }}>agent log {showLog ? "▾" : "›"}</button>
        )}
      </div>
    </section>
  );
}
