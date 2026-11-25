import { useState } from "react";
import { Link } from "react-router";

import type { PrincipalQuestion } from "@/services/conversation";
import { questionAsker } from "@/components/IntentNegotiatorChat";
import UserAvatar from "@/components/UserAvatar";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useUndo } from "@/components/intents-home/undo";

/** What "skip" sends the agent in place of an answer (there is no skip endpoint). */
export const SKIP_ANSWER = "skip this one. use your best judgement.";

type Question = PrincipalQuestion & { intentId: string; groupId?: string };

/** "40 minutes", "3 hours", "2 days": how long two agents have been at it. */
function talkingFor(since: string, now = Date.now()): string {
  const minutes = Math.max(1, Math.floor((now - Date.parse(since)) / 60000));
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  return days < 14 ? plural(days, "day") : plural(Math.floor(days / 7), "week");
}

/**
 * A question from an agent, built like the other cards in a list: who's
 * asking (and for which intent), the question, then its answers as chips.
 * A rounded chip answers in one click; "something else…" is a chip you type
 * in (enter sends); skip lets the agent decide. Every answer waits a few seconds
 * behind "undo" before it's sent.
 */
export default function QuestionCard({ question, selected, onAnswer, onHide }: {
  question: Question;
  selected?: boolean;
  onAnswer: (intentId: string, questionId: string, text: string) => Promise<void>;
  /** Hide the card while its answer waits (and bring it back on undo). */
  onHide?: (hidden: boolean) => void;
}) {
  const later = useUndo();
  const { error: showError } = useNotifications();
  const { entriesByIntent } = useIntentsData();
  const [own, setOwn] = useState("");
  const [gone, setGone] = useState(false);
  const asker = questionAsker(question);
  const options = question.options ?? [];

  const send = (text: string, label: string) => {
    const value = text.trim();
    if (!value) return;
    setGone(true);
    onHide?.(true);
    later(label, () => {
      onAnswer(question.intentId, question.id, value).catch(() => {
        showError("couldn't send your answer.");
        setGone(false);
        onHide?.(false);
      });
    }, () => { setGone(false); onHide?.(false); });
  };

  if (gone) return null;
  // Their agent wears their photo; yours is the black "ix" square.
  const owner = asker.owner as ({ id: string; name: string; avatar?: string | null } | null);
  const face = owner
    ? <Link to={`/u/${owner.id}`} title={`${owner.name}'s profile`} style={{ display: "flex", flex: "none" }}><UserAvatar id={owner.id} name={owner.name} avatar={owner.avatar ?? null} size={36} /></Link>
    : <span className="sv-mine" aria-hidden>ix</span>;
  const label = owner ? `${owner.name.split(" ")[0]}'s agent` : asker.label;
  // How long their agent and yours have been talking, from the opportunity the question is about.
  const opportunityId = question.matches?.[0]?.opportunityId;
  const since = owner && opportunityId
    ? Object.values(entriesByIntent).flat().find((entry) => entry.item.opportunityId === opportunityId)?.item.createdAt
    : undefined;
  const sent = owner ? `answered. your agent takes it back to ${label}.` : null;

  return (
    <div id={question.groupId ? `q-card-${question.groupId}` : undefined} className={`sv-card sv-static sv-qcard${selected ? " on" : ""}`}>
      {face}
      <div className="sv-card-body">
        <div className="sv-qhead">
          <span><b>{label}</b>{since && <span className="sv-via"> · talking with yours for {talkingFor(since)}</span>}</span>
          <button type="button" className="sv-link" onClick={() => send(SKIP_ANSWER, "question skipped")}>skip</button>
        </div>
        <div className="sv-blurb">{question.question}</div>
        <div className="sv-chips one">
          {options.map((option) => (
            <button key={option} type="button" className="sv-chip" onClick={() => send(option, sent ?? `answered “${option}”`)}>{option}</button>
          ))}
          <form className="sv-chip ghost sv-chip-own" onSubmit={(event) => { event.preventDefault(); send(own, sent ?? `answered “${own.trim()}”`); }}>
            <input value={own} onChange={(event) => setOwn(event.target.value)} placeholder={options.length ? "something else…" : "type your answer…"} aria-label="your answer" size={Math.max(15, own.length + 1)} />
            {own.trim() && <button type="submit" className="sv-chip-send">send</button>}
          </form>
        </div>
      </div>
    </div>
  );
}
