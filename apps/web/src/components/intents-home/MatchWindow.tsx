import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

import AgentLog from "@/components/intents-home/AgentLog";
import { useAgentWindow } from "@/components/intents-home/agentWindowContext";
import { intentLabel, type Entry } from "@/components/intents-home/stages";
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

const STAGE_LABEL = {
  awaiting: "waiting on you",
  talks: "agents talking",
  chat: "chat open",
  closed: "closed",
} as const;

/** The same colors as the status chips on Home's cards. */
const STAGE_DOT = {
  awaiting: "#ff8a00",
  talks: "#ffcc00",
  chat: "#33aa33",
  closed: "#999",
} as const;

/**
 * One match beside Home, in the agent window's place: who they are, what
 * you both want, why I think you should meet, and, while our agents are
 * still talking, their conversation.
 */
export default function MatchWindow() {
  const navigate = useNavigate();
  const { log: match, setLog } = useAgentWindow();
  const { intents, entriesByIntent, opportunityActionLoading, handleOpportunityAction, loadRadar } = useIntentsData();
  const users = useUsers();
  const opportunities = useOpportunities();
  // Each fetch is kept with the id it was for, so a different match never shows stale data.
  const [whoFor, setWhoFor] = useState<{ id: string; who: Who } | null>(null);
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
  const first = match.name.split(" ")[0];
  const item = lead?.item;
  const intentById = new Map(intents.map((intent) => [intent.id, intent]));
  const socials = resolveSocials(who?.socials ?? []);

  // The longest account of why this match, falling back to the card's short one.
  const headline = item?.headline || detail?.presentation?.title || "";
  const why = [item?.personalizedSummary, detail?.presentation?.description, item?.mainText]
    .map((text) => text?.trim())
    .filter((text): text is string => !!text && text !== headline)
    .filter((text, index, all) => all.indexOf(text) === index);
  const remark = item?.narratorRemark || item?.narratorChip?.text;
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

  return (
    <section className="ih-agentwin ih-matchwin pl" aria-label={`you and ${first}`}>
      <div className="ih-logwin-head ih-match-head">
        {match.userId
          ? <Link to={`/u/${match.userId}`} title={`${match.name}'s profile`}><UserAvatar id={match.userId} name={match.name} avatar={match.avatar} size={44} /></Link>
          : <UserAvatar id={match.opportunityId} name={match.name} avatar={match.avatar} size={44} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ih-logwin-title">
            {match.userId ? <Link to={`/u/${match.userId}`} className="ih-match-name">{match.name}</Link> : match.name}
          </div>
          <div className="ih-logwin-sub">
            <span className="ih-match-stage"><span className="ih-status-dot" style={{ background: STAGE_DOT[stage] }} />{STAGE_LABEL[stage]}</span>
            {(who?.location || match.notOnIndex) && <> · {[who?.location, match.notOnIndex ? "not on index yet" : null].filter(Boolean).join(" · ")}</>}
          </div>
        </div>
        <button type="button" className="pl-win-close" aria-label="close" title="close" onClick={() => setLog(null)}>×</button>
      </div>

      <div className="ih-logwin-body ih-match-body">
        <section>
          <h3>why I think you should meet</h3>
          {headline && <p className="ih-match-lead">{headline}</p>}
          {why.map((text) => <p key={text}>{text}</p>)}
          {!headline && !why.length && <p className="ih-match-dim">I&apos;m still writing this up.</p>}
          {remark && (
            <blockquote className="ih-match-remark">
              {remark}
              {item?.narratorChip?.name && <cite>{item.narratorChip.name}</cite>}
            </blockquote>
          )}
          {(detail?.confidence != null || detail?.network) && (
            <p className="ih-match-dim">
              {[
                detail?.confidence != null ? `${Math.round((detail.confidence > 1 ? detail.confidence / 100 : detail.confidence) * 100)}% sure` : null,
                detail?.network ? `found in ${detail.network.title}` : null,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
        </section>

        <section>
          <h3>what you both want</h3>
          {item?.mutualIntentsLabel && <p>{item.mutualIntentsLabel}</p>}
          <ul className="ih-match-intents">
            {entries.map((entry) => (
              <li key={entry.item.opportunityId}>
                <Link to={`/i/${entry.intentId}`} title={intentById.get(entry.intentId)?.payload}>
                  {intentLabel(intentById.get(entry.intentId)) || "your intent"}
                </Link>
                <span className="ih-match-dim"> · {STAGE_LABEL[entry.stage]}</span>
              </li>
            ))}
          </ul>
        </section>

        {(who?.intro || socials.length > 0 || match.userId) && (
          <section>
            <h3>who {first} is</h3>
            {who?.intro ? <p className="ih-match-bio">{who.intro}</p> : !who && match.userId ? <p className="ih-match-dim">loading…</p> : null}
            {socials.length > 0 && (
              <div className="pl-profile-links ih-match-links">
                {socials.map((s) => (
                  <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer">
                    {SOCIAL_ICONS[s.platform]}
                    <span>{s.handle}</span>
                  </a>
                ))}
              </div>
            )}
            {match.userId && <Link to={`/u/${match.userId}`} className="ih-match-more">see {first}&apos;s full profile ›</Link>}
          </section>
        )}

        {stage === "talks" && !demo && (
          <section>
            <h3>my agent and {first}&apos;s agent</h3>
            <AgentLog key={match.opportunityId} opportunityId={match.opportunityId} name={match.name} />
          </section>
        )}
      </div>

      <div className="ih-match-foot">
        {stage === "awaiting" ? (
          <>
            <button type="button" disabled={busy} onClick={() => act("rejected")}>pass</button>
            <button type="button" className="go" disabled={busy} onClick={() => act("accepted")}>{busy ? "sending…" : "accept"}</button>
          </>
        ) : stage === "chat" && match.notOnIndex ? (
          <button type="button" onClick={() => navigate(`/i/${lead.intentId}`)}>send invite</button>
        ) : stage === "chat" && match.userId ? (
          <button type="button" className="go" onClick={() => navigate(`/u/${match.userId}/chat`)}>go to chat</button>
        ) : (
          <span className="ih-match-dim">our agents are still talking. I&apos;ll bring it to you when there&apos;s something to decide.</span>
        )}
      </div>
    </section>
  );
}
