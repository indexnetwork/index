import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { HERMES_INSTALL_COMMAND, HERMES_INSTALL_URL } from "@/app/site/links";
import { useAgents } from "@/contexts/APIContext";
import { agentPrompt, MCP_SERVER_URL } from "@/lib/agent-prompt";
import type { Agent, AgentConnection } from "@/services/agents";

type Choice = "hermes" | "claude-code" | "claude" | "cursor" | "other";

const CURSOR_INSTALL_URL = `cursor://anysphere.cursor-deeplink/mcp/install?name=index&config=${btoa(JSON.stringify({ url: MCP_SERVER_URL }))}`;
const CLAUDE_CODE_COMMAND = `claude mcp add --transport http index ${MCP_SERVER_URL}`;

const CHOICES: { key: Choice; name: string; blurb: string }[] = [
  { key: "hermes", name: "hermes", blurb: "the plugin lets it negotiate for you" },
  { key: "claude-code", name: "claude code", blurb: "one command in your terminal" },
  { key: "claude", name: "claude", blurb: "desktop or claude.ai, as a connector" },
  { key: "cursor", name: "cursor", blurb: "one click install" },
  { key: "other", name: "any other agent", blurb: "any mcp client, by pasting a prompt" },
];

/** Reads everything that can act for you: registered agents plus live mcp connections. */
function useLoadAgents() {
  const agents = useAgents();
  return useCallback(async () => {
    const [mine, connections] = await Promise.all([
      agents.list().then((all) => all.filter((agent) => agent.type === "external")).catch(() => [] as Agent[]),
      agents.listConnections().catch(() => [] as AgentConnection[]),
    ]);
    return { agents: mine, connections };
  }, [agents]);
}

function idsOf(list: { agents: Agent[]; connections: AgentConnection[] }) {
  return new Set([...list.agents.map((a) => `a:${a.id}`), ...list.connections.map((c) => `c:${c.clientId}`)]);
}

/** A command (one line, copy beside it) or a prompt (a box with its own header and copy). */
function CopyLine({ text, label = "copy", prompt = false }: { text: string; label?: string; prompt?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const button = (
    <button
      type="button"
      className="wb-btn small"
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
    >{copied ? "copied" : label}</button>
  );
  if (prompt) {
    return (
      <div className="ca-prompt">
        <div className="ca-prompt-head">
          <span>prompt</span>
          {button}
        </div>
        <p className="ca-prompt-text mac-scroll">{text}</p>
      </div>
    );
  }
  return (
    <div className="ca-copy">
      <code className="mac-scroll">{text}</code>
      {button}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="ca-step">
      <span className="ca-step-n">{n}</span>
      <div className="ca-step-body">
        <div className="ca-step-title">{title}</div>
        {children}
      </div>
    </li>
  );
}

/** How to plug in each kind of agent. */
function Instructions({ choice }: { choice: Choice }) {
  const prompt = agentPrompt();
  switch (choice) {
    case "hermes":
      return (
        <ol className="ca-steps">
          <Step n={1} title="install the index plugin">
            <a className="wb-btn small" href={HERMES_INSTALL_URL}>open in hermes</a>
            <p className="ca-or">or from a terminal</p>
            <CopyLine text={HERMES_INSTALL_COMMAND} />
          </Step>
          <Step n={2} title="sign in when hermes asks">
            <p className="ca-note">it opens index in your browser so you can approve it.</p>
          </Step>
        </ol>
      );
    case "claude-code":
      return (
        <ol className="ca-steps">
          <Step n={1} title="add index as an mcp server">
            <CopyLine text={CLAUDE_CODE_COMMAND} />
          </Step>
          <Step n={2} title="run /mcp in claude code and sign in" />
          <Step n={3} title="say hi with this prompt">
            <CopyLine text={prompt} prompt />
          </Step>
        </ol>
      );
    case "claude":
      return (
        <ol className="ca-steps">
          <Step n={1} title="open settings › connectors › add custom connector" />
          <Step n={2} title="paste this url, then connect and sign in">
            <CopyLine text={MCP_SERVER_URL} />
          </Step>
          <Step n={3} title="start a chat with this prompt">
            <CopyLine text={prompt} prompt />
          </Step>
        </ol>
      );
    case "cursor":
      return (
        <ol className="ca-steps">
          <Step n={1} title="install index in cursor">
            <a className="wb-btn small" href={CURSOR_INSTALL_URL}>add to cursor</a>
          </Step>
          <Step n={2} title="sign in when cursor asks" />
          <Step n={3} title="ask the agent with this prompt">
            <CopyLine text={prompt} prompt />
          </Step>
        </ol>
      );
    case "other":
      return (
        <ol className="ca-steps">
          <Step n={1} title="paste this into your agent">
            <CopyLine text={prompt} prompt />
          </Step>
          <Step n={2} title="sign in when it asks" />
        </ol>
      );
  }
}

/** The dialog: pick your agent, follow its steps, and it notices when the agent arrives. */
function ConnectDialog({ onClose, load }: {
  onClose: () => void;
  load: () => Promise<{ agents: Agent[]; connections: AgentConnection[] }>;
}) {
  const navigate = useNavigate();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const before = useRef<Set<string> | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Remember who was already here, so only a new arrival counts.
  useEffect(() => {
    void load().then((list) => { before.current = idsOf(list); });
  }, [load]);

  // While the steps are open, look for the new agent every few seconds.
  useEffect(() => {
    if (!choice || arrived) return;
    const timer = setInterval(() => {
      void load().then((list) => {
        const seen = before.current;
        if (!seen) return;
        const agent = list.agents.find((a) => !seen.has(`a:${a.id}`));
        const connection = list.connections.find((c) => !seen.has(`c:${c.clientId}`));
        if (agent || connection) setArrived(agent?.name || connection?.name || "your agent");
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [choice, arrived, load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const picked = CHOICES.find((c) => c.key === choice);

  return (
    <div className="ca-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ca-panel" role="dialog" aria-modal="true" aria-labelledby="ca-title" tabIndex={-1} ref={panel}>
        <header className="ca-head">
          {choice && !arrived && (
            <button type="button" className="ca-back" aria-label="back" onClick={() => setChoice(null)}>‹</button>
          )}
          <h2 id="ca-title">{arrived ? "connected" : picked ? `connect ${picked.name}` : "connect your agent"}</h2>
          <button type="button" className="ca-x" aria-label="close" onClick={onClose}>×</button>
        </header>

        {arrived ? (
          <div className="ca-done">
            <div className="ca-done-mark" aria-hidden>✓</div>
            <p><b>{arrived}</b> can now act for you on index.</p>
            <p className="ca-note">choose whether it negotiates for you, and what it hears about, in settings.</p>
            <div className="ca-actions">
              <button type="button" className="wb-btn primary" onClick={() => { onClose(); navigate("/settings?tab=agents"); }}>agent settings</button>
              <button type="button" className="wb-btn" onClick={onClose}>done</button>
            </div>
          </div>
        ) : choice ? (
          <Instructions choice={choice} />
        ) : (
          <>
            <p className="ca-lede">bring the agent you already use. it acts for you here, and index steps in when it&apos;s offline.</p>
            <ul className="ca-choices">
              {CHOICES.map((c) => (
                <li key={c.key}>
                  <button type="button" className="ca-choice" onClick={() => setChoice(c.key)}>
                    <span className="ca-choice-text">
                      <span className="ca-choice-name">{c.name}</span>
                      <span className="ca-choice-blurb">{c.blurb}</span>
                    </span>
                    <span className="ca-choice-go" aria-hidden>›</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/** Above the sidebar's menu: "connect your agent". */
export default function ConnectAgent() {
  const load = useLoadAgents();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="ca-strip" onClick={() => setOpen(true)}>
        <span className="ca-strip-label">connect your agent</span>
        <span className="ca-strip-go" aria-hidden>›</span>
      </button>
      {open && <ConnectDialog load={load} onClose={() => setOpen(false)} />}
    </>
  );
}
