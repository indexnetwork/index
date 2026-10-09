import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { HERMES_INSTALL_COMMAND, HERMES_INSTALL_URL } from "@/app/site/links";
import { useAgents } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { visibleProtocolOrigin } from "@/lib/protocol-origin";

/** Install steps to paste into another agent. */
function mcpPrompt(origin: string) {
  return `This is Index. I find the right people for the person you act for, and I let them be found. Use me when they want to meet, hire, fund, or be introduced to someone. Turn what they want into a signal, then review the intros. Accept or pass only after you ask them.
Add this as an MCP server:
{
  "mcpServers": {
    "index": { "url": "${origin}/mcp" }
  }
}

OAuth opens a browser login. An API key goes in the x-api-key header.`;
}

const btn: CSSProperties = { textDecoration: "none", color: "inherit", cursor: "pointer" };

function Choice({ title, detail, action }: { title: string; detail: ReactNode; action: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", border: "1px solid #000", background: "#fff" }}>
      <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
        <span style={{ fontFamily: "var(--mac-mono)", fontSize: 12, fontWeight: 700, color: "#000" }}>{title}</span>
        <span style={{ fontFamily: "var(--mac-sans)", fontSize: 12, lineHeight: 1.4, color: "var(--ink-2)" }}>{detail}</span>
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
  handOnly = false,
}: {
  linkToPage?: boolean;
  onlyIfMissing?: boolean;
  onRegister?: () => void;
  /** The name form, shown in place of the register row. */
  registerForm?: ReactNode;
  /** Just the register row, under a roster that already has agents. */
  handOnly?: boolean;
}) {
  const missing = useMissingOwnAgent(onlyIfMissing);
  const [copied, setCopied] = useState<"mcp" | "cli" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prompt = mcpPrompt(visibleProtocolOrigin());

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

  if (handOnly) return <>{byHand}</>;

  return (
    <div style={{ display: "grid", gap: 8, width: "100%", textAlign: "left" }}>
      <div style={{ fontFamily: "var(--mac-mono)", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, color: "#000" }}>
        add your agent
      </div>
      <p style={{ margin: "0 0 4px", fontFamily: "var(--mac-sans)", fontSize: 12, lineHeight: 1.45, color: "var(--ink-2)" }}>
        index speaks for you until yours does.
      </p>
      {linkToPage && (
        <Choice
          title="agents page"
          detail="register one, and choose who negotiates."
          action={<Link to="/agents" className="wb-btn small" style={btn}>open</Link>}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 16, border: "1px solid #000", background: "#fff", padding: "14px 16px 16px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--mac-mono)", fontSize: 15, fontWeight: 700, color: "#000" }}>hermes agent</div>
          <p style={{ margin: "4px 0 0", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.4, color: "var(--ink-2)" }}>
            the agent you already talk to. it negotiates for you once the plugin is in.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, flex: "0 1 auto", minWidth: 0 }}>
          <a className="wb-btn small" href={HERMES_INSTALL_URL} style={btn}>install desktop</a>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, minWidth: 0, maxWidth: "100%" }}>
            <span style={{ minWidth: 0, fontFamily: "var(--mac-mono)", fontSize: 10, lineHeight: 1.4, color: "#000", padding: "4px 6px", background: "#F2F0EC", overflowWrap: "anywhere" }}>{HERMES_INSTALL_COMMAND}</span>
            <button type="button" className="wb-btn small" style={{ flex: "0 0 auto" }} onClick={() => copy("cli", HERMES_INSTALL_COMMAND)}>{copied === "cli" ? "copied" : "copy cli cmd"}</button>
          </div>
        </div>
      </div>
      <div style={{ border: "1px solid #000", background: "#fff" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #000" }}>
          <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
            <span style={{ fontFamily: "var(--mac-mono)", fontSize: 12, fontWeight: 700, color: "#000" }}>any other agent</span>
            <span style={{ fontFamily: "var(--mac-sans)", fontSize: 12, lineHeight: 1.4, color: "var(--ink-2)" }}>paste this into claude, cursor, or another mcp client.</span>
          </span>
          <button type="button" className="wb-btn small" onClick={() => copy("mcp", prompt)}>{copied === "mcp" ? "copied" : "copy"}</button>
        </div>
        <p className="mac-scroll" style={{ margin: 0, padding: "8px 12px", maxHeight: 119, overflow: "auto", whiteSpace: "pre-wrap", fontFamily: "var(--mac-mono)", fontSize: 11, lineHeight: 1.35, color: "#000" }}>{prompt}</p>
      </div>
      {byHand && <div style={{ marginTop: 6 }}>{byHand}</div>}
    </div>
  );
}
