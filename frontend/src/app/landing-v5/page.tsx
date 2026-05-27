import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { apiUrl } from "@/lib/api";
import { getAllPosts, type BlogPost } from "@/lib/blog";
import Nav, { GithubStar, ensureLandingV5Fonts } from "./Nav";
import Footer from "./Footer";
import "./landing-v5.css";

type Step = {
  num: string;
  title: string;
  line: string;
  example: ReactNode;
};

const STEPS: Step[] = [
  {
    num: "01",
    title: "You share what you're working toward",
    line: "In natural language — the raw stuff, not a polished pitch",
    example: (
      <div className="ex-card cli-card">
        <div className="cli-body">
          <div className="cli-line">
            <span className="cli-prompt">$</span>
            <span className="cli-cmd">index intent</span>
          </div>
          <div className="cli-line cli-input">
            <span className="cli-prompt">›</span>
            <span>“I&apos;m going to SF next month — who should I meet?”</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    num: "02",
    title: "Your agent reads it and fills in the gaps",
    line: "Expands your shorthand into the kind of people worth meeting — privately",
    example: (
      <div className="ex-card cli-card">
        <div className="cli-body">
          <div className="cli-output">
            <div className="cli-comment">
              <span className="cli-hash">#</span> user is heading to SF for a week.
            </div>
            <div className="cli-comment">
              <span className="cli-hash">#</span> looking for{" "}
              <span className="ex-hl">investors</span>,{" "}
              <span className="ex-hl">builders interested in ai &amp; privacy</span>,{" "}
              <span className="ex-hl">long-term collaborator</span>.
            </div>
            <div className="cli-comment">
              <span className="cli-hash">#</span> weighting toward people available for coffee.
            </div>
          </div>
        </div>
        <div className="ex-foot">
          <span className="ex-ok">✓ ready to negotiate</span>
        </div>
      </div>
    ),
  },
  {
    num: "03",
    title: "Agents negotiate across the network",
    line: "Checking for timing, context and relevance — quietly, in the background",
    example: <NegotiationStream />,
  },
  {
    num: "04",
    title: "The right people surface",
    line: "Wake up and decide who's worth a conversation",
    example: (
      <div className="ex-card cli-card">
        <div className="cli-body">
          <div className="cli-output">
            <div className="cli-comment">
              <span className="cli-hash">#</span> I found 3 opportunities based on your active signals:
            </div>
          </div>
          <ul className="cli-list">
            <li>
              <span className="cli-bullet">●</span>
              <span className="cli-list-name">alice</span>
              <span className="cli-list-why">
                free thursday afternoon — runs infra fund, loves talking shop.
              </span>
            </li>
            <li>
              <span className="cli-bullet">●</span>
              <span className="cli-list-name">marcus</span>
              <span className="cli-list-why">
                building an agent platform; said yes to a coffee next week.
              </span>
            </li>
            <li>
              <span className="cli-bullet">●</span>
              <span className="cli-list-name">jenny</span>
              <span className="cli-list-why">
                looking for the same kind of cofounder — in SF the same week.
              </span>
            </li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    num: "05",
    title: "Your next opportunity arrives ambiently",
    line: "For once — you're excited about Mondays again",
    example: (
      <div className="ex-card cli-card">
        <div className="cli-body">
          <div className="cli-output">
            <div className="cli-comment">
              <span className="cli-hash">#</span> 2 days later — a new signal surfaced from the ambient stream:
            </div>
            <div className="cli-narrative">
              <span className="cli-plus">+</span> sarah just joined the network. her intent overlaps yours —
              she&apos;s looking for an infra cofounder, ex-anthropic, nyc.
            </div>
          </div>
        </div>
        <div className="ex-foot">
          <span className="ex-ok">+1 surfaced</span>
        </div>
      </div>
    ),
  },
];

type SurfaceTab = {
  id: string;
  kind: string;
  label: string;
  blurb: string;
  steps: { num?: string; title?: string; cmd?: string | string[]; soon?: boolean }[];
  docs?: { href: string; label: string };
  cta?: { href: string; label: string };
};

const SURFACE_TABS: SurfaceTab[] = [
  {
    id: "cli",
    kind: "CLI",
    label: "cli",
    blurb: "Command-line interface for the Index Network social discovery protocol. Chat with your agent, manage signals, and discover opportunities.",
    steps: [
      { num: "1", title: "install", cmd: "npm install -g @indexnetwork/cli" },
    ],
    docs: {
      href: "https://www.npmjs.com/package/@indexnetwork/cli",
      label: "Read the documentation →",
    },
  },
  {
    id: "skill",
    kind: "SKILL",
    label: "agent skill",
    blurb: "Ships as a Hermes plugin and an OpenClaw plugin — your intents, available to your agent natively.",
    steps: [
      {
        num: "1",
        title: "install (openclaw)",
        cmd: [
          "openclaw plugins install @indexnetwork/openclaw-plugin",
          "openclaw index connect",
        ],
      },
      {
        num: "2",
        title: "install (hermes)",
        soon: true,
      },
    ],
  },
  {
    id: "web",
    kind: "WEB",
    label: "web app",
    blurb: "Sign in, write what you want, and let the network bring people to you.",
    steps: [],
    cta: {
      href: "https://index.network",
      label: "Sign in",
    },
  },
  {
    id: "mcp",
    kind: "MCP",
    label: "mcp",
    blurb: "Plug the MCP server into Claude, Cursor, or any host. Your agent speaks the protocol natively.",
    steps: [
      {
        title: "server url",
        cmd: "https://protocol.index.network/mcp",
      },
    ],
  },
];

function Hero() {
  const [activeId, setActiveId] = useState<string>(SURFACE_TABS[0].id);
  const [copied, setCopied] = useState<string | null>(null);
  const active = SURFACE_TABS.find((t) => t.id === activeId) ?? SURFACE_TABS[0];

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="hero h1">
      <div className="canvas-area">
        <Nav />
        <div className="hero-split">
          <div className="well">
            <h1 className="display">
              Wake up to your
              <br />
              next idea partner
            </h1>
            <p className="body-italic">
              Have your agent surface the right people for you, before you
              even think to look.
            </p>

            <div className="hero-surf">
              <div className="surf-tabs" role="tablist" aria-label="surfaces">
                {SURFACE_TABS.map((t) => {
                  const isActive = t.id === activeId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={"surf-tab" + (isActive ? " is-active" : "")}
                      onClick={() => setActiveId(t.id)}
                    >
                      <span className="surf-tab-label">{t.label}</span>
                    </button>
                  );
                })}
              </div>

              <p className="surf-blurb">{active.blurb}</p>

              <div className="hero-cli">
                {active.steps.map((s) => {
                  const key = `${active.id}-${s.num}`;
                  const lines = Array.isArray(s.cmd) ? s.cmd : s.cmd ? [s.cmd] : [];
                  const showNum = active.steps.length > 1;
                  return (
                    <div className="hero-cli-step" key={key}>
                      {s.title ? (
                        <div className="hero-cli-head">
                          <span className="hero-cli-title">
                            {showNum ? `${s.num}. ` : ""}{s.title}
                            {s.soon ? (
                              <span className="hero-cli-soon">soon</span>
                            ) : null}
                          </span>
                          {s.soon ? null : (
                            <button
                              type="button"
                              className="hero-cli-copy"
                              onClick={() => copy(key, lines.join("\n"))}
                            >
                              {copied === key ? "copied" : "copy"}
                            </button>
                          )}
                        </div>
                      ) : null}
                      {s.soon ? null : (
                        <div className="hero-cli-box">
                          {lines.map((line, i) => (
                            <div className="hero-cli-line" key={i}>
                              <span className="hero-cli-cmd">{line}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {active.cta ? (
                  <a
                    className="cta hero-cli-cta"
                    href={active.cta.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {active.cta.label}
                  </a>
                ) : null}
                {active.docs ? (
                  <a
                    className="hero-cli-docs"
                    href={active.docs.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {active.docs.label}
                  </a>
                ) : null}
              </div>
            </div>
          </div>
          <div className="hero-image">
            <video
              src="/landing-v5/hero-index.mp4"
              autoPlay
              loop
              muted
              playsInline
              aria-hidden="true"
            />
            <span className="scan" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="how how-it-works">
      <div className="how-inner">
        <div className="how-head">
          <span className="title">
            <span className="arrow">›</span>how it works
          </span>
          <span className="meta" />
        </div>

        <div className="log how-log">
          {STEPS.map((s) => (
            <div className="block how-block" key={s.num}>
              <div className="how-block-text">
                <div className="step-row">
                  <span className="num">[{s.num}]</span>
                  <span className="cmd">{s.title}</span>
                  <span className="spacer" aria-hidden="true" />
                </div>
                <div className="comment">
                  <span className="hash">#</span>
                  {s.line}
                </div>
              </div>
              <div className="how-block-example">{s.example}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const STREAM_EVENTS = [
  "scanning index (12,481,002 records)",
  "opportunity detected",
  "proposer agent spawned",
  "responder agent engaged",
  "proposer: makes case",
  "responder: counter-argues",
  "exchange round 1 complete",
  "exchange round 2 complete",
  "trust handshake → 0.86",
  "alignment check: ok",
  "opportunity accepted · routing to inbox",
  "scanning index (12,481,029 records)",
  "opportunity detected",
  "proposer: presents context",
  "responder: requests proof",
  "verification handshake",
  "exchange round 1 complete",
  "exchange round 2 complete",
];

const VISIBLE_ROWS = 9;
const STREAM_INTERVAL_MS = 1300;
const STREAM_STEP_MS = 142;
const STREAM_BASE_MS = 219;

const padN = (n: number) => n.toString().padStart(2, "0");

function tsFromTick(tick: number): string {
  const total = STREAM_BASE_MS + tick * STREAM_STEP_MS;
  const ms = total % 100;
  const ss = Math.floor(total / 100) % 60;
  const mm = Math.floor(total / 6000);
  return `${padN(mm)}:${padN(ss)}:${padN(ms)}`;
}

type StreamItem = { id: number; ts: string; text: string };

function makeRow(tick: number): StreamItem {
  return {
    id: tick,
    ts: tsFromTick(tick),
    text: STREAM_EVENTS[tick % STREAM_EVENTS.length],
  };
}

function NegotiationStream() {
  const [items, setItems] = useState<StreamItem[]>(() =>
    Array.from({ length: VISIBLE_ROWS }, (_, i) => makeRow(i)),
  );

  useEffect(() => {
    let tick = VISIBLE_ROWS;
    const id = setInterval(() => {
      setItems((prev) => [...prev.slice(1), makeRow(tick++)]);
    }, STREAM_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const nextTs = items.length > 0
    ? tsFromTick(items[items.length - 1].id + 1)
    : tsFromTick(VISIBLE_ROWS);

  return (
    <div className="ex-card ex-nego">
      <div className="ex-log ex-log-stream">
        {items.map((item) => (
          <div className="ex-log-row" key={item.id}>
            <span className="ex-log-ts">[{item.ts}]</span>
            <span className="ex-log-text">{item.text}</span>
            <span className="ex-log-status">OK</span>
          </div>
        ))}
        <div className="ex-log-row ex-log-active" key="cursor">
          <span className="ex-log-ts">[{nextTs.slice(0, 6)}</span>
          <span className="cursor" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function formatPostDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" })
    .toUpperCase();
}

type ExternalEntry = {
  kind: "external";
  href: string;
  date: string;
  title: string;
};

const EXTERNAL_ENTRIES: ExternalEntry[] = [
  {
    kind: "external",
    href: "/found-in-translation",
    date: "2026-04-01",
    title: "Found in Translation",
  },
];

function LatestPosts() {
  const [posts, setPosts] = useState<BlogPost[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAllPosts()
      .then((all) => {
        if (!cancelled) setPosts(all);
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const entries =
    posts === null
      ? null
      : [...posts, ...EXTERNAL_ENTRIES]
          .sort(
            (a, b) =>
              new Date(b.date).getTime() - new Date(a.date).getTime(),
          )
          .slice(0, 3);

  return (
    <section className="how blog">
      <div className="how-inner">
        <div className="how-head">
          <span className="title">
            <span className="arrow">›</span>field notes
          </span>
          <span className="meta">latest 3 · /blog</span>
        </div>

        <div className="log">
          {entries === null ? (
            <div className="comment">
              <span className="hash">#</span>loading…
            </div>
          ) : entries.length === 0 ? (
            <div className="comment">
              <span className="hash">#</span>no posts yet.
            </div>
          ) : (
            entries.map((entry) =>
              "kind" in entry ? (
                <Link
                  className="blog-row"
                  to={entry.href}
                  key={`ext:${entry.href}`}
                  aria-label={entry.title}
                >
                  <span className="blog-date">{formatPostDate(entry.date)}</span>
                  <span className="blog-title">{entry.title}</span>
                  <span className="spacer" aria-hidden="true" />
                  <span className="blog-arrow">→</span>
                </Link>
              ) : (
                <Link
                  className="blog-row"
                  to={`/blog/${entry.slug}`}
                  key={entry.slug}
                  aria-label={entry.title}
                >
                  <span className="blog-date">{formatPostDate(entry.date)}</span>
                  <span className="blog-title">{entry.title}</span>
                  <span className="spacer" aria-hidden="true" />
                  <span className="blog-arrow">→</span>
                </Link>
              ),
            )
          )}
        </div>

        <div className="blog-foot">
          <Link className="cta ghost" to="/blog">
            All posts
          </Link>
        </div>
      </div>
    </section>
  );
}

function OpenSource() {
  return (
    <section className="how os">
      <div className="how-inner">
        <div className="how-head">
          <span className="title">
            <span className="arrow">›</span>open source
          </span>
        </div>

        <div className="os-body">
          <h2 className="display os-display">
            We&rsquo;re building
            <br />
            in the open
          </h2>
          <p className="os-lede">
            Index is an open-source social discovery protocol.
            <br />
            No permission required.
          </p>
          <div className="os-actions">
            <GithubStar />
          </div>
        </div>
      </div>
    </section>
  );
}

function SubscribeModal() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  );

  useEffect(() => {
    const onOpen = () => {
      setStatus("idle");
      setEmail("");
      setOpen(true);
    };
    window.addEventListener("openSubscribeModal", onOpen);
    return () => window.removeEventListener("openSubscribeModal", onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && status !== "loading") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, status]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setStatus("loading");
    try {
      const res = await fetch(apiUrl("/api/subscribe"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, type: "waitlist" }),
      });
      setStatus(res.ok ? "success" : "error");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div
      className="lv5-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lv5-subscribe-title"
      onClick={() => status !== "loading" && setOpen(false)}
    >
      <div className="lv5-modal-backdrop" aria-hidden="true" />
      <div className="lv5-modal-card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="lv5-modal-close"
          onClick={() => setOpen(false)}
          disabled={status === "loading"}
          aria-label="Close"
        >
          ×
        </button>

        {status === "success" ? (
          <div className="lv5-modal-success">
            <h3 id="lv5-subscribe-title" className="lv5-modal-title">
              subscribed
            </h3>
            <p className="lv5-modal-lede">
              You&rsquo;re on the list — we&rsquo;ll let you know when we&rsquo;re live.
            </p>
            <button
              type="button"
              className="cta"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <h3 id="lv5-subscribe-title" className="lv5-modal-title">
              subscribe
            </h3>
            <p className="lv5-modal-lede">
              Drop your email — we&rsquo;ll keep you posted on updates.
            </p>
            <form onSubmit={submit} className="lv5-modal-form">
              <label htmlFor="lv5-subscribe-email" className="lv5-modal-label">
                Email <span className="lv5-modal-req">*</span>
              </label>
              <input
                id="lv5-subscribe-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="lv5-modal-input"
                required
                disabled={status === "loading"}
                autoFocus
              />
              {status === "error" && (
                <p className="lv5-modal-error">
                  Something went wrong. Please try again.
                </p>
              )}
              <button
                type="submit"
                className="lv5-modal-submit"
                disabled={status === "loading"}
              >
                {status === "loading" ? "Submitting…" : "Subscribe"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function LandingV5Page() {
  useEffect(() => {
    ensureLandingV5Fonts();
  }, []);

  return (
    <div className="landing-v5">
      <Hero />
      <HowItWorks />
      <LatestPosts />
      <OpenSource />
      <Footer />
      <SubscribeModal />
    </div>
  );
}

export default LandingV5Page;
export const Component = LandingV5Page;
