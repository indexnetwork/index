import { useState } from "react";
import { Link } from "react-router";

import type { PrincipalQuestion } from "@/services/conversation";
import { questionAsker } from "@/components/IntentNegotiatorChat";
import { MyAgentAvatar, TheirAgentAvatar } from "@/components/workbench/agent-avatar";
import { useNotifications } from "@/contexts/NotificationContext";
import { useUndo } from "@/components/intents-home/undo";

/** What "skip" sends the agent in place of an answer (there is no skip endpoint). */
export const SKIP_ANSWER = "skip this one. use your best judgement.";

type Question = PrincipalQuestion & { intentId: string; groupId?: string };

/**
 * A question from an agent, built like the other cards in a list: who's
 * asking (and for which intent), the question, then its answers as chips.
 * A rounded chip answers in one click; "something else…" opens a box for your
 * own words; skip lets the agent decide. Every answer waits a few seconds
 * behind "undo" before it's sent.
 */
export default function QuestionCard({ question, intentLabel, intentHref, selected, onAnswer, onHide }: {
  question: Question;
  /** The intent it's about, shown after the asker (left out on that intent's own page). */
  intentLabel?: string;
  intentHref?: string;
  selected?: boolean;
  onAnswer: (intentId: string, questionId: string, text: string) => Promise<void>;
  /** Hide the card while its answer waits (and bring it back on undo). */
  onHide?: (hidden: boolean) => void;
}) {
  const later = useUndo();
  const { error: showError } = useNotifications();
  const [own, setOwn] = useState<string | null>(null);
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
  const face = asker.owner
    ? <Link to={`/u/${asker.owner.id}`} title={`${asker.owner.name}'s profile`}><TheirAgentAvatar owner={{ id: asker.owner.id, name: asker.owner.name }} size={36} /></Link>
    : <MyAgentAvatar size={36} />;

  return (
    <div id={question.groupId ? `q-card-${question.groupId}` : undefined} className={`sv-card sv-static${selected ? " on" : ""}`}>
      {face}
      <div className="sv-card-body">
        <b>{asker.label}</b>
        {intentLabel && (
          <span className="sv-via"> · {intentHref ? <Link to={intentHref}>{intentLabel}</Link> : intentLabel}</span>
        )}
        <div className="sv-blurb">{question.question}</div>
        <div className="sv-chips one">
          {options.map((option) => (
            <button key={option} type="button" className="sv-chip" onClick={() => send(option, `answered “${option}”`)}>{option}</button>
          ))}
          <button type="button" className="sv-chip ghost" onClick={() => setOwn(own === null ? "" : null)}>
            {options.length ? "something else…" : "answer…"}
          </button>
          <button type="button" className="sv-link" onClick={() => send(SKIP_ANSWER, "question skipped")}>skip</button>
        </div>
        {own !== null && (
          <form className="sv-own" onSubmit={(event) => { event.preventDefault(); send(own, `answered “${own.trim()}”`); }}>
            <input autoFocus value={own} onChange={(event) => setOwn(event.target.value)} placeholder="your answer" aria-label="your answer" />
            <button type="submit" className="sv-btn go" disabled={!own.trim()}>send</button>
          </form>
        )}
      </div>
    </div>
  );
}
