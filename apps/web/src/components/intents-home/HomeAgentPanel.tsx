import { useEffect, useRef, useState, type AnchorHTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router";
import remarkGfm from "remark-gfm";

import { useHomeAgentChat } from "@/components/intents-home/useHomeAgentChat";
import { MyAgentAvatar } from "@/components/workbench/agent-avatar";
import { formatChatClock } from "@/lib/utils";

const SUGGESTIONS = [
  "start a new intent",
  "what's waiting on me?",
  "pause one of my intents",
  "update my profile",
];

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
 * The agent chat on the right of Home: talk to your agent to start, change,
 * pause or archive intents, check matches, or update your profile. It acts
 * with the Index tools; `onChanged` refreshes the page after it changes something.
 */
export default function HomeAgentPanel({ onClose, onChanged }: { onClose: () => void; onChanged: (tools: string[]) => void }) {
  const { messages, loaded, loadFailed, sending, error, send, retry } = useHomeAgentChat(onChanged);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, sending]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async (text = draft) => {
    if (!text.trim() || sending) return;
    setDraft("");
    const ok = await send(text);
    if (!ok) setDraft(text);
    inputRef.current?.focus();
  };

  return (
    <aside className="pl-agent" aria-label="your agent">
      <div className="pl-agent-head">
        <span>YOUR AGENT</span>
        <button type="button" className="pl-agent-close" aria-label="close" title="close" onClick={onClose}>×</button>
      </div>

      <div className="pl-agent-log">
        {!loaded ? (
          <p className="pl-dim pl-small">loading…</p>
        ) : loadFailed && !messages.length ? (
          <p className="pl-dim pl-small">couldn&apos;t load this chat. <button type="button" onClick={() => void retry()}>try again</button></p>
        ) : messages.length === 0 ? (
          <div className="pl-agent-hello">
            <div className="pl-agent-line">
              <MyAgentAvatar size={22} />
              <div className="pl-agent-bubble">
                hi. tell me who you want to meet and i&apos;ll start an intent, or ask me to change, pause or archive one, check your matches, or update your profile.
              </div>
            </div>
            <div className="pl-agent-suggest">
              {SUGGESTIONS.map((text) => (
                <button key={text} type="button" onClick={() => void submit(text)} disabled={sending}>{text}</button>
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
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: AgentLink }}>{message.text}</ReactMarkdown>
                </div>
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
          placeholder="tell your agent…"
          aria-label="Message your agent"
        />
        <button type="submit" className="go" disabled={!draft.trim() || sending}>send</button>
      </form>
    </aside>
  );
}
