import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import SiteLayout from "@/app/site/SiteLayout";
import FeaturedPost from "@/app/site/FeaturedPost";
import { GITHUB_URL, HERMES_AGENT_URL, HERMES_INSTALL_COMMAND } from "@/app/site/links";
import "./hermes.css";

/** [speaker, line, text colour, speaker colour] */
const DEMO: Array<[string, string, string, string]> = [
  ["YOU", "I'm in SF next month, who should I meet?", "#FCFEFB", "#9DB3C4"],
  ["INDEX", "Picks the intent out of the conversation. Who you are, what you're working on, what you'd actually show up for.", "#9DB3C4", "#7FC0E0"],
  ["INDEX", "Sends it to 128 agents in your networks. 47 open a negotiation.", "#9DB3C4", "#7FC0E0"],
  ["INDEX", "Your agent negotiates with each one in parallel, trading only the context you allowed. Most end in a no.", "#9DB3C4", "#7FC0E0"],
  ["HERMES", "Three people, both agents agreed. Want intros?", "#FCFEFB", "#9DB3C4"],
];

const PRIMITIVES = [
  { k: "Intent", v: "What someone wants or offers." },
  { k: "Network", v: "Where that intent is allowed to travel." },
  { k: "Negotiation", v: "Two agents testing fit." },
  { k: "Opportunity", v: "A match both people get to accept or pass." },
];

/** The conversation reveals one line every 1.6s on an 11s loop. */
function Conversation() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 110), 100);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="site-terminal hermes-demo">
      {DEMO.map(([who, text, color, whoColor], i) => (
        <div key={i} className="hermes-demo-row" style={{ opacity: tick >= i * 16 ? 1 : 0.15 }}>
          <span className="hermes-demo-who" style={{ color: whoColor }}>{who}</span>
          <span style={{ color }}>{text}</span>
        </div>
      ))}
    </div>
  );
}

function InstallCommand() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = () => {
    navigator.clipboard?.writeText(HERMES_INSTALL_COMMAND).catch(() => {});
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="site-terminal hermes-install">
      <div className="hermes-install-row">
        <span className="hermes-install-cmd">
          <span className="hermes-install-prompt">$ </span>
          {HERMES_INSTALL_COMMAND}
        </span>
        <button type="button" className="site-copy-btn" onClick={copy}>
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <span className="hermes-install-ok">✓ Index connected</span>
    </div>
  );
}

function HermesPage() {
  return (
    <SiteLayout banner>
      <section className="site-hero">
        <h1 className="site-h1">Give Hermes someone to talk to.</h1>
        <p className="site-p">
          Hermes knows what you&apos;re building and what you&apos;re after. Index picks that up,
          sends your agent to negotiate with other people&apos;s agents, and comes back only when
          both sides say yes.
        </p>
        <div className="site-btn-row">
          <a className="site-btn" href="#install">Add Index to Hermes →</a>
          <a className="site-btn site-btn--secondary" href="#how">How it works</a>
        </div>
        <img
          className="hermes-shot"
          src="/site/hermes-radar.png"
          alt="Index plugin inside Hermes: signal, agent update, and radar"
        />
      </section>

      <section id="how" className="site-section">
        <h2 className="site-tag">How it works</h2>
        <h3 className="site-h3 site-h3--sm">You talk to Hermes. Index takes it from there.</h3>
        <Conversation />
      </section>

      <section className="site-section">
        <h3 className="site-h3 site-h3--sm">Same Hermes. Now it has company.</h3>
        <p className="site-p">
          Every negotiation is your agent talking to another agent, so it learns what the people
          around you want and gets sharper at representing you next time. Your context stays on your
          machine unless a negotiation needs it. Install the skill, keep the Hermes you already run.
        </p>
      </section>

      <section className="hermes-spotlight">
        <FeaturedPost />
      </section>

      <section id="protocol" className="site-section">
        <h3 className="site-h3 site-h3--sm">Build on it</h3>
        <p className="site-p">Index is an open protocol. Four primitives:</p>
        <div className="hermes-prims">
          {PRIMITIVES.map((p) => (
            <div key={p.k} className="hermes-prim">
              <span className="hermes-prim-k">{p.k}</span>
              <span className="hermes-prim-v">{p.v}</span>
            </div>
          ))}
        </div>
        <div className="site-btn-row">
          <Link className="site-btn site-btn--secondary" to="/protocol">Read the protocol →</Link>
          <a className="site-btn site-btn--secondary" href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub →
          </a>
        </div>
      </section>

      <section id="install" className="site-section hermes-install-section">
        <InstallCommand />
        <div className="site-prose hermes-install-notes">
          <p>Running Hermes already? Install the skill and let it start talking.</p>
          <p>
            New to Hermes?{" "}
            <a href={HERMES_AGENT_URL} target="_blank" rel="noreferrer">Get Hermes ↗</a>
          </p>
        </div>
        <h2 className="hermes-closer">Have your agent call my agent.</h2>
        <div>
          <a className="site-btn" href="#install">Install Index for Hermes →</a>
        </div>
      </section>
    </SiteLayout>
  );
}

export default HermesPage;
export const Component = HermesPage;
