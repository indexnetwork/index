import { useEffect, useRef, useState, type AnchorHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router";
import remarkGfm from "remark-gfm";

import IntentActivity from "@/components/intents-home/IntentActivity";
import NewIntentSteps from "@/components/intents-home/NewIntentSteps";
import { intentLabel } from "@/components/intents-home/stages";
import { usePersonalAgentChat } from "@/components/intents-home/usePersonalAgentChat";
import { useNewIntentFlow } from "@/components/intents-home/useNewIntentFlow";
import { MyAgentAvatar } from "@/components/workbench/agent-avatar";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { formatChatClock } from "@/lib/utils";

/** "start a new intent" runs the intents page's new intent flow right here in the chat; the rest go to the agent. */
const NEW_INTENT = "start a new intent";
const SUGGESTIONS = [
  NEW_INTENT,
  "what's waiting on me?",
  "pause one of my intents",
  "update my profile",
];
/** Typing just "new intent" (or "start a new intent") opens the flow too. */
const NEW_INTENT_ASK = /^(please\s+)?((start|create|make|add)\s+)?(a\s+)?new\s+intent[.!]?$/i;

/** Index links the agent writes (index.network/i/…) open in the app instead of a new tab. */
function AgentLink({ href = "", children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  let path: string | null = null;
  try {
    const url = new URL(href, window.location.origin);
    const ours = url.origin === window.location.origin || /(^|\.)index\.network$/.test(url.hostname);
    if (ours && /^\/(i|u|o|chat|intents|settings)(\/|$)/.test(url.pathname)) path = url.pathname + url.search;
  } catch {
    // Not a URL; render it as written.
  }
  if (path) return <Link to={path}>{children}</Link>;
  return <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>;
}

/**
 * The agent chat in its own window beside Home: talk to your agent to start, change,
 * pause or archive intents, check matches, or update your profile. It acts
 * with the Index tools; `onChanged` refreshes the page after it changes something.
 */
export default function PersonalAgentPanel({ onChanged, onClose }: { onChanged: (tools: string[]) => void; onClose?: () => void }) {
  const { messages, loaded, loadFailed, sending, error, send, newChat, recordIntent, retry } = usePersonalAgentChat(onChanged);
  const [draft, setDraft] = useState("");
  const { intents } = useIntentsData();
  // Live activity shows under the most recent intents started here, not every one ever.
  const liveIntents = new Set(messages.filter((m) => m.intentCreated).slice(-3).map((m) => m.intentCreated));
  // The server writes the agent's "started …" line into the chat once the intent exists.
  const flow = useNewIntentFlow(({ id, asked }) => {
    void recordIntent(id, asked);
    onChanged(["create_intent"]);
  });
  const flowWaits = flow.active && flow.stage === "opening";
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, sending, flow.active, flow.stage, flow.turns.length]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const startFlow = () => { flow.start(); inputRef.current?.focus(); };

  const submit = async (text = draft) => {
    if (!text.trim() || sending) return;
    if (flowWaits) {
      setDraft("");
      flow.submitOpening(text);
      return;
    }
    if (flow.active) return;
    if (NEW_INTENT_ASK.test(text.trim())) {
      setDraft("");
      startFlow();
      return;
    }
    setDraft("");
    const ok = await send(text);
    if (!ok) setDraft(text);
    inputRef.current?.focus();
  };

  return (
    <div className="pl pl-agent">
      <div className="pl-agent-head">
        <span>talk to me about your intents, matches or profile</span>
        <button type="button" className="pl-agent-new" disabled={sending || flow.stage === "creating" || (!messages.length && !flow.active)} title="start a new chat"
          onClick={() => { setDraft(""); flow.cancel(); void newChat().then(() => inputRef.current?.focus()); }}>+ new chat</button>
        {onClose && <button type="button" className="pl-win-close" aria-label="collapse" title="collapse" onClick={onClose}>▸</button>}
      </div>

      <div className="pl-agent-log">
        {!loaded ? (
          <p className="pl-dim pl-small">loading…</p>
        ) : loadFailed && !messages.length ? (
          <p className="pl-dim pl-small">couldn&apos;t load this chat. <button type="button" onClick={() => void retry()}>try again</button></p>
        ) : messages.length === 0 && !flow.active ? (
          <div className="pl-agent-hello">
            <div className="pl-agent-line">
              <MyAgentAvatar size={22} />
              <div className="pl-agent-bubble">
                hi. tell me who you want to meet and i&apos;ll start an intent, or ask me to change, pause or archive one, check your matches, or update your profile.
              </div>
            </div>
            <div className="pl-agent-suggest">
              {SUGGESTIONS.map((text) => (
                <button key={text} type="button" className={text === NEW_INTENT ? "go" : undefined} disabled={sending}
                  onClick={() => (text === NEW_INTENT ? startFlow() : void submit(text))}>
                  {text === NEW_INTENT ? `+ ${text}` : text}
                </button>
              ))}
            </div>
          </div>
        ) : messages.map((message) => (
          message.role === "agent" ? (
            <div key={message.id} className="pl-agent-line">
              <MyAgentAvatar size={22} />
              <div className="pl-agent-bubble">
                <div className="pl-agent-meta">your agent · {formatChatClock(message.createdAt)}</div>
                <div className="pl-agent-md">
                  {message.intentCreated ? (() => {
                    const intent = intents.find((i) => i.id === message.intentCreated);
                    return intent
                      ? <p>started <Link to={`/i/${intent.id}`} title={intent.payload}>{intentLabel(intent)}</Link>{intentLabel(intent).endsWith("…") ? "" : "."} i&apos;ll start looking for people now.</p>
                      : <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: AgentLink }}>{message.text}</ReactMarkdown>;
                  })() : <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: AgentLink }}>{message.text}</ReactMarkdown>}
                </div>
                {message.intentCreated && liveIntents.has(message.intentCreated) && <IntentActivity intentId={message.intentCreated} />}
                {message.changed?.length ? <div className="pl-agent-done">✓ {message.changed.map((name) => name.replace(/_/g, " ")).join(", ")}</div> : null}
              </div>
            </div>
          ) : (
            <div key={message.id} className="pl-agent-line mine">
              <div className="pl-agent-bubble mine">
                <div className="pl-agent-meta">you · {formatChatClock(message.createdAt)}</div>
                {message.text}
              </div>
            </div>
          )
        ))}
        {flow.active && <NewIntentSteps flow={flow} />}
        {!flow.active && messages.length > 0 && !sending && (
          <div className="pl-agent-suggest pl-agent-again">
            <button type="button" className="go" onClick={startFlow}>+ start a new intent</button>
          </div>
        )}
        {sending && (
          <div className="pl-agent-line">
            <MyAgentAvatar size={22} />
            <div className="pl-agent-bubble pl-dim">working on it<span className="pl-blink">_</span></div>
          </div>
        )}
        {error && <p className="pl-agent-error">{error}</p>}
        <div ref={endRef} />
      </div>

      <form className="pl-agent-compose" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <textarea
          ref={inputRef}
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          disabled={flow.active && !flowWaits}
          placeholder={flowWaits ? "what are you looking for?" : flow.active ? "answer above…" : "tell your agent…"}
          aria-label="Message your agent"
        />
        <button type="submit" className="go" disabled={!draft.trim() || sending || (flow.active && !flowWaits)}>send</button>
      </form>
    </div>
  );
}
