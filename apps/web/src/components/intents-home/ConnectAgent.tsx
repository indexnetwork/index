import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { HERMES_INSTALL_COMMAND, HERMES_INSTALL_URL } from "@/app/site/links";
import { useAgents } from "@/contexts/APIContext";
import { MCP_SERVER_URL } from "@/lib/agent-prompt";
import i18n from "@/lib/i18n";
import type { Agent, AgentConnection } from "@/services/agents";

type Choice = "hermes" | "other";

const CHOICES: { key: Choice; name: string; blurb: string }[] = [
  { key: "other", name: "MCP", blurb: "Connect with a prompt" },
  { key: "hermes", name: "Hermes plugin", blurb: "Install directly into Hermes" },
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

/** One copyable prompt or install command, with its action underneath. */
function CopyLine({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const button = (
    <button
      type="button"
      className="wb-btn primary small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          setFailed(true);
          return;
        }
        setFailed(false);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
    >{copied ? t("copied") : label}</button>
  );
  return (
    <div className="ca-copy-block">
      <p className="ca-prompt-text">{text}</p>
      {button}
      <span className="ca-note" role="status">{failed ? t("Couldn't copy. Select the text above to copy it.") : copied ? t("Copied to clipboard.") : ""}</span>
    </div>
  );
}

/** How to plug in each kind of agent. */
function Instructions({ choice }: { choice: Choice }) {
  const { t } = useTranslation();
  const prompt = `Connect me to Index using its MCP server at ${MCP_SERVER_URL} and help me sign in. Then suggest three things I might want or offer based on what you know about me, and ask which to create as intents. Ask me before accepting or passing on introductions.`;
  switch (choice) {
    case "hermes":
      return (
        <div className="ca-instructions">
          <p className="ca-note">{t("Connect Hermes with the Index plugin.")}</p>
          <a className="wb-btn small" href={HERMES_INSTALL_URL}>{t("open in hermes")}</a>
          <p className="ca-note">{t("or install from your terminal")}</p>
          <CopyLine text={HERMES_INSTALL_COMMAND} label={t("copy install command")} />
          <p className="ca-note">{t("Sign in when Hermes asks.")}</p>
        </div>
      );
    case "other":
      return (
        <div className="ca-instructions">
          <p className="ca-note">{t("For Claude, Cursor, and any MCP-compatible agent.")}</p>
          <CopyLine text={prompt} label={t("copy prompt")} />
          <p className="ca-note">{t("Paste into your agent. Sign in when asked.")}</p>
        </div>
      );
  }
}

/** The dialog: pick your agent, follow its steps, and it notices when the agent arrives. */
function ConnectDialog({ onClose, load }: {
  onClose: () => void;
  load: () => Promise<{ agents: Agent[]; connections: AgentConnection[] }>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [choice, setChoice] = useState<Choice>("other");
  const [arrived, setArrived] = useState<string | null>(null);
  const before = useRef<Set<string> | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Remember who was already here, so only a new arrival counts.
  useEffect(() => {
    void load().then((list) => { before.current = idsOf(list); });
  }, [load]);

  // While the steps are open, look for the new agent every few seconds.
  useEffect(() => {
    if (arrived) return;
    const timer = setInterval(() => {
      void load().then((list) => {
        const seen = before.current;
        if (!seen) return;
        const agent = list.agents.find((a) => !seen.has(`a:${a.id}`));
        const connection = list.connections.find((c) => !seen.has(`c:${c.clientId}`));
        if (agent || connection) setArrived(agent?.name || connection?.name || i18n.t("your agent"));
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

  return (
    <div className="ca-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ca-panel" role="dialog" aria-modal="true" aria-labelledby="ca-title" tabIndex={-1} ref={panel}>
        <header className="ca-head">
          <h2 id="ca-title">{arrived ? t("connected") : t("connect your agent")}</h2>
          <button type="button" className="ca-x" aria-label={t("close")} onClick={onClose}>×</button>
        </header>

        {arrived ? (
          <div className="ca-done">
            <div className="ca-done-mark" aria-hidden>✓</div>
            <p><b>{arrived}</b> {t("can now act for you on index.")}</p>
            <p className="ca-note">{t("choose whether it negotiates for you, and what it hears about, in settings.")}</p>
            <div className="ca-actions">
              <button type="button" className="wb-btn primary" onClick={() => { onClose(); navigate("/settings?tab=agents"); }}>{t("agent settings")}</button>
              <button type="button" className="wb-btn" onClick={onClose}>{t("done")}</button>
            </div>
          </div>
        ) : (
          <>
            <p className="ca-lede">{t("Bring the agent you already use to Index.")}</p>
            <ul className="ca-choices">
              {CHOICES.map((c) => (
                <li key={c.key}>
                  <button
                    type="button"
                    className="ca-choice"
                    id={`ca-choice-${c.key}`}
                    aria-expanded={choice === c.key}
                    aria-controls={`ca-content-${c.key}`}
                    onClick={() => setChoice(c.key)}
                  >
                    <span className="ca-choice-text">
                      <span className="ca-choice-name">{t(c.name)}</span>
                      {choice !== c.key && <span className="ca-choice-blurb">{t(c.blurb)}</span>}
                    </span>
                    <span className="ca-choice-go" aria-hidden>{choice === c.key ? "−" : "+"}</span>
                  </button>
                  <div id={`ca-content-${c.key}`} role="region" aria-labelledby={`ca-choice-${c.key}`} hidden={choice !== c.key}>
                    {choice === c.key && <Instructions choice={c.key} />}
                  </div>
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
  const { t } = useTranslation();
  const load = useLoadAgents();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="ca-strip" onClick={() => setOpen(true)}>
        <span className="ca-strip-label">{t("connect your agent")}</span>
        <span className="ca-strip-go" aria-hidden>›</span>
      </button>
      {open && <ConnectDialog load={load} onClose={() => setOpen(false)} />}
    </>
  );
}
