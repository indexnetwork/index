import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import ChatView from "@/components/chat/ChatView";
import { InAppFrameContext } from "@/components/intents-home/appFrameContext";
import { useAgentWindow } from "@/components/intents-home/agentWindowContext";
import { PersonPane, PersonSummary, type PersonTab } from "@/components/intents-home/PersonPane";
import { personKey, type Entry } from "@/components/intents-home/stages";
import { useUndo } from "@/components/intents-home/undo";
import { useOpportunities } from "@/contexts/APIContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import type { OpportunityDetailResponse } from "@/services/opportunities";

/**
 * One match on the right of a list: the person on top, then "summary · chat".
 * Summary is who they are and every opportunity between you two (this one
 * open: why your agent found them and the agents' log); chat is the
 * conversation, once you both said yes. Accept and pass sit at the foot
 * while it's waiting on you; a pass waits a few seconds behind "undo".
 */
export default function MatchWindow() {
  const navigate = useNavigate();
  const { log: match, setLog, decisions, decide } = useAgentWindow();
  const { entriesByIntent, opportunityActionLoading, handleOpportunityAction, loadRadar } = useIntentsData();
  const opportunities = useOpportunities();
  const later = useUndo();
  const [chatCount, setChatCount] = useState(0);
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

  useEffect(() => {
    if (!match) return;
    const id = match.opportunityId;
    let active = true;
    opportunities.getOpportunity(id).then((res) => { if (active) setDetailFor({ id, detail: res }); }).catch(() => {});
    return () => { active = false; };
  }, [match, opportunities]);
  const detail = detailFor && detailFor.id === match?.opportunityId ? detailFor.detail : null;

  if (!match) return null;
  const first = match.name.split(" ")[0];
  const item = lead?.item;
  const key = match.personKey ?? (lead ? personKey(lead.item) : null);

  // The longest account of why this match, falling back to the card's short one.
  const headline = item?.headline || detail?.presentation?.title || "";
  const why = [item?.personalizedSummary, detail?.presentation?.description, item?.mainText]
    .map((text) => text?.trim())
    .filter((text): text is string => !!text && text !== headline)
    .filter((text, index, all) => all.indexOf(text) === index);
  const surfaced = why[0] || headline;
  const busy = entries.some((entry) => opportunityActionLoading[entry.item.opportunityId]);

  // Chat opens once you've said yes (or the chat already exists); before that the tab says why not.
  const accepted = stage === "chat" || (key ? decisions[key] === "accepted" : false);
  const chatOff = accepted && match.userId && !match.notOnIndex ? undefined
    : stage === "awaiting" ? `accept below and your chat with ${first} starts right here.`
    : match.notOnIndex || !match.userId ? `${first} isn't on index yet. the chat opens here once they join.`
    : stage === "closed" ? "this one is closed."
    : "opens here once you both accept.";
  const tab: PersonTab = match.view === "chat" ? "chat" : "summary";
  const setTab = (next: PersonTab) => setLog({ ...match, view: next === "chat" ? "chat" : undefined });
  const close = () => setLog(null);

  const act = (action: "accepted" | "rejected") => {
    // The list leaves a line where they were, whichever side the decision came from.
    if (key) decide(key, action);
    // Accepting opens the chat at once; the accept finishes behind it.
    const chatting = action === "accepted" && !!match.userId && !match.notOnIndex;
    if (chatting) setLog({ ...match, view: "chat" });
    const pending = entries.filter((e) => e.stage === "awaiting" && !opportunityActionLoading[e.item.opportunityId]);
    const send = () => void Promise.all(pending.map((entry) => handleOpportunityAction(entry.item.opportunityId, action, match.userId, {
      notOnIndex: match.notOnIndex,
      scope: { intentId: entry.intentId },
    }).then((ok) => { void loadRadar(entry.intentId); return ok; }))).then((results) => {
      // It didn't go through: back to the summary, with the error already shown.
      if (results.includes(false)) { if (key) decide(key, null); if (chatting) setLog(match); }
    });
    if (action === "accepted") { send(); return; }
    setLog(null);
    later(`passed on ${first}`, send, () => { if (key) decide(key, null); setLog(match); });
  };

  const foot = stage === "awaiting" && !accepted ? (
    <>
      <button aria-busy={busy} type="button" className="sv-btn go" data-sv-key="accept" disabled={busy} onClick={() => act("accepted")}>{busy ? "accepting" : "accept"}</button>
      <button type="button" className="sv-btn" data-sv-key="pass" disabled={busy} onClick={() => act("rejected")}>pass</button>
      <span className="hint">accepting opens the chat right here</span>
    </>
  ) : stage === "chat" && match.notOnIndex && lead ? (
    <button type="button" className="sv-btn" onClick={() => navigate(`/i/${lead.intentId}`)}>send invite</button>
  ) : stage === "talks" ? (
    <span className="note">your agents are still talking. chat opens here once you both accept.</span>
  ) : stage === "closed" ? (
    <span className="note">this one is closed.</span>
  ) : undefined;

  return (
    <PersonPane
      key={match.opportunityId}
      person={{ name: match.name, userId: match.userId, avatar: match.avatar, notOnIndex: match.notOnIndex, fallbackId: match.opportunityId }}
      tab={tab}
      onTab={setTab}
      chatOff={chatOff}
      chatCount={chatOff ? undefined : chatCount}
      onClose={close}
      foot={foot}
      summary={<PersonSummary userId={match.notOnIndex ? undefined : match.userId} focusId={match.opportunityId} why={surfaced} intentId={lead?.intentId} />}
      chat={match.userId && (
        <InAppFrameContext.Provider value>
          <ChatView key={match.userId} userId={match.userId} userName={match.name} userAvatar={match.avatar ?? undefined} onClose={close} bare onCount={setChatCount} />
        </InAppFrameContext.Provider>
      )}
    />
  );
}
