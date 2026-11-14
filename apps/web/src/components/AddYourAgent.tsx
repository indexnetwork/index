import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { HERMES_INSTALL_COMMAND, HERMES_INSTALL_URL } from "@/app/site/links";
import { useAgents } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { agentPrompt } from "@/lib/agent-prompt";

const btn: CSSProperties = { textDecoration: "none", color: "inherit", cursor: "pointer" };
const title_: CSSProperties = { fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15, fontWeight: 600, color: "#000" };
const blurb: CSSProperties = { fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, lineHeight: 1.45, color: "#5a5548" };
const code: CSSProperties = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11, lineHeight: 1.5, color: "#000", background: "#f7f7f5", borderRadius: 2 };

function Choice({ title, detail, action }: { title: string; detail: ReactNode; action: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "14px 0", borderTop: "1px solid #e6e6e6" }}>
      <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 3 }}>
        <span style={title_}>{title}</span>
        <span style={blurb}>{detail}</span>
      </span>
      {action}
    </div>
  );
}

function useMissingOwnAgent(enabled: boolean) {
  const agents = useAgents();
  const { isAuthenticated } = useAuthContext();
  const [missing, setMissing] = useState<boolean | null>(enabled ? null : false);
  useEffect(() => {
    if (!enabled || !isAuthenticated) return;
    let cancelled = false;
    agents.list()
      .then((list) => { if (!cancelled) setMissing(!list.some((agent) => agent.type === "external")); })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [agents, enabled, isAuthenticated]);
  return missing;
}

/** Ways to connect an agent the person already uses. `linkToPage` is off on /agents. */
export function AddYourAgent({
  linkToPage = true,
  onlyIfMissing = false,
  onRegister,
  registerForm,
}: {
  linkToPage?: boolean;
  onlyIfMissing?: boolean;
  onRegister?: () => void;
  /** The name form, shown in place of the register row. */
  registerForm?: ReactNode;
}) {
  const missing = useMissingOwnAgent(onlyIfMissing);
  const [copied, setCopied] = useState<"mcp" | "cli" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prompt = agentPrompt();

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = (which: "mcp" | "cli", text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(which);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1500);
  };

  if (onlyIfMissing && missing !== true) return null;

  const byHand = registerForm ?? (onRegister && (
    <Choice
      title="register manually"
      detail="name an agent on this page."
      action={<button type="button" className="wb-btn small" onClick={onRegister}>register</button>}
    />
  ));

  return (
    <div style={{ display: "grid", width: "100%", textAlign: "left" }}>
      <h2 className="st-h">add your agent</h2>
      <p className="st-note" style={{ marginBottom: 6 }}>
        index speaks for you until yours does.
      </p>
      {linkToPage && (
        <Choice
          title="agents page"
          detail="register one, and choose who negotiates."
          action={<Link to="/agents" className="wb-btn small" style={btn}>open</Link>}
        />
      )}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, padding: "14px 0", borderTop: "1px solid #e6e6e6" }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={title_}>hermes agent</div>
          <p style={{ ...blurb, margin: "3px 0 0" }}>
            the agent you already talk to. it negotiates for you once the plugin is in.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, flex: "1 1 auto", minWidth: 0 }}>
          <a className="wb-btn small" href={HERMES_INSTALL_URL} style={btn}>install desktop</a>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, minWidth: 0, maxWidth: "100%" }}>
            <span style={{ ...code, minWidth: 0, padding: "4px 8px", overflowWrap: "anywhere" }}>{HERMES_INSTALL_COMMAND}</span>
            <button type="button" className="wb-btn small" style={{ flex: "0 0 auto" }} onClick={() => copy("cli", HERMES_INSTALL_COMMAND)}>{copied === "cli" ? "copied" : "copy cli cmd"}</button>
          </div>
        </div>
      </div>
      <div style={{ padding: "14px 0", borderTop: "1px solid #e6e6e6" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
          <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 3 }}>
            <span style={title_}>any other agent</span>
            <span style={blurb}>paste this into claude, cursor, or another mcp client.</span>
          </span>
          <button type="button" className="wb-btn small" onClick={() => copy("mcp", prompt)}>{copied === "mcp" ? "copied" : "copy"}</button>
        </div>
        <p className="mac-scroll" style={{ ...code, margin: 0, padding: "10px 12px", maxHeight: 119, overflow: "auto", whiteSpace: "pre-wrap", color: "#5a5548" }}>{prompt}</p>
      </div>
      {byHand}
    </div>
  );
}
