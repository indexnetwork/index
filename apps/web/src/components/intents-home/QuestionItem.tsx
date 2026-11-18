import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { PrincipalQuestion } from "@/services/conversation";

/** A question to answer: Home's grouped cards carry a groupId; an intent's chat passes a single question. */
type AgentQuestion = PrincipalQuestion & { intentId: string; groupId?: string };
import { questionAsker } from "@/components/IntentNegotiatorChat";
import TranslatedMark from "@/components/TranslatedMark";
import { MyAgentAvatar, TheirAgentAvatar } from "@/components/workbench/agent-avatar";
import { useNotifications } from "@/contexts/NotificationContext";
import { useContentTranslation } from "@/lib/content-translation";

/** What "skip" sends the agent in place of an answer. */
const SKIP_ANSWER = "skip this one. use your best judgement.";

/** Who's asking, with each person's name linked to their profile. */
function AskerName({ question, fallback }: { question: AgentQuestion; fallback: string }) {
  const { t } = useTranslation();
  const people = (question.matches ?? [])
    .map((match) => match.counterparty)
    .filter((person): person is { id: string; name: string } => Boolean(person?.id && person.name && !/^unknown$/i.test(person.name.trim())));
  if (!people.length) return <>{fallback}</>;
  return (
    <>
      {people.map((person, index) => (
        <span key={person.id}>
          {index > 0 && ", "}
          <Link to={`/u/${person.id}`} className="pl-name" title={t("{{name}}'s profile", { name: person.name })}>{person.name}</Link>
        </span>
      ))}
      {people.length === 1 ? t("'s agent") : t("'s agents")}
    </>
  );
}

/** One answer in progress: the picked option or your own words, and sending it. */
function useQuestionAnswer(question: AgentQuestion, onAnswer: (intentId: string, questionId: string, text: string) => Promise<void>) {
  const { t } = useTranslation();
  const { error: showError } = useNotifications();
  const [choice, setChoice] = useState("");
  const [own, setOwn] = useState("");
  const [sending, setSending] = useState(false);
  const options = question.options ?? [];
  const text = (choice === "__own" || options.length === 0 ? own : choice).trim();
  const submit = async () => {
    if (!text || sending) return;
    setSending(true);
    try {
      await onAnswer(question.intentId, question.id, text);
    } catch {
      showError(t("couldn't send your answer."));
      setSending(false);
    }
  };
  return { choice, setChoice, own, setOwn, sending, options, text, submit };
}

/** The asking agent's face, sized and linked like an opportunity row's avatar. */
function AskerFace({ question, size }: { question: AgentQuestion; size: number }) {
  const { t } = useTranslation();
  const asker = questionAsker(question);
  return asker.owner
    ? <Link to={`/u/${asker.owner.id}`} className="pl-card-face" title={t("{{name}}'s profile", { name: asker.owner.name })}><TheirAgentAvatar owner={{ id: asker.owner.id, name: asker.owner.name }} size={size} /></Link>
    : <span className="pl-card-face"><MyAgentAvatar size={size} /></span>;
}

/** An answer the agent offered: shown in the viewer's language, sent as written. */
function OptionText({ text }: { text: string }) {
  return <>{useContentTranslation(text).text}</>;
}

/**
 * One question from an agent, drawn like an opportunity row: the asker's face
 * on the left, who's asking, the question, its answers as radios, and the
 * card's small send button.
 */
export default function QuestionItem({ question, forIntents, selected, onAnswer }: {
  question: AgentQuestion;
  /** "for: …" under a card that stands for more than one intent. */
  forIntents?: string;
  /** The card a /q/<id> link opened. */
  selected?: boolean;
  onAnswer: (intentId: string, questionId: string, text: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const shown = useContentTranslation(question.question);
  const { choice, setChoice, own, setOwn, sending, options, text, submit } = useQuestionAnswer(question, onAnswer);
  // No skip endpoint: skipping answers for you, so the agent stops waiting and decides on its own.
  const [skipping, setSkipping] = useState(false);
  const skip = async () => {
    setSkipping(true);
    try {
      await onAnswer(question.intentId, question.id, SKIP_ANSWER);
    } catch {
      setSkipping(false);
    }
  };
  const asker = questionAsker(question);
  const name = `q-${question.id}`;
  return (
    <li id={question.groupId ? `q-card-${question.groupId}` : undefined} className={`pl-card pl-q-row${selected ? " on" : ""}`}>
      <AskerFace question={question} size={36} />
      <form className="pl-card-body" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="pl-q-row-meta">
          <AskerName question={question} fallback={asker.label} />
          {forIntents && <div className="pl-q-row-for">{forIntents}</div>}
        </div>
        <div className="pl-blurb pl-q-row-text">{shown.text}</div>
        <TranslatedMark state={shown} />
        <div className="pl-q-options">
          {options.map((option) => (
            <label key={option}>
              <input type="radio" name={name} checked={choice === option} onChange={() => setChoice(option)} /> <OptionText text={option} />
            </label>
          ))}
          {options.length > 0 ? (
            // "something else" is the field itself, as in the new intent questions: picked as you type.
            <label className="pl-ni-else">
              <input type="radio" name={name} checked={choice === "__own"} onChange={() => setChoice("__own")} aria-label={t("something else")} />
              <input type="text" value={own} placeholder={t("something else")} aria-label={t("your answer")}
                onFocus={() => setChoice("__own")}
                onChange={(event) => { setOwn(event.target.value); setChoice("__own"); }} />
            </label>
          ) : (
            <input type="text" value={own} onChange={(event) => setOwn(event.target.value)} placeholder={t("type your answer")} aria-label={t("your answer")} />
          )}
        </div>
        <div className="pl-actions">
          <button type="submit" className="go" disabled={!text || sending || skipping}>{sending ? t("sending…") : t("send answer")}</button>
          <button type="button" className="pl-skip" disabled={sending || skipping} onClick={() => void skip()}>{skipping ? t("skipping…") : t("skip")}</button>
        </div>
      </form>
    </li>
  );
}
