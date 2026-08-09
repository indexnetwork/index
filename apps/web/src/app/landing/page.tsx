import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { getAllPosts, type BlogPost } from "@/lib/blog";
import Nav, { GithubStar, ensureLandingFonts } from "./Nav";
import Footer from "./Footer";
import { WaitlistForm } from "./WaitlistForm";
import "./landing.css";

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

function openAccessModal() {
  window.dispatchEvent(new CustomEvent("openAccessModal"));
}

function Hero() {
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

            <div className="hero-access">
              <button
                type="button"
                className="cta primary hero-access-btn"
                onClick={openAccessModal}
              >
                Request Access
              </button>
              <p className="hero-lede">
                Index is opening in cycles. Get early access, find your networks,
                or start your own.
              </p>
            </div>
          </div>
          <div className="hero-image">
            <video
              src="/landing/hero-index-bg.mp4"
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
            how it works
          </span>
          <span className="meta" />
        </div>

        <div className="log how-log">
          {STEPS.map((s) => (
            <div className="block how-block" key={s.num}>
              <div className="how-block-text">
                <div className="step-row">
                  <span className="num">{s.num}</span>
                  <span className="cmd">{s.title}</span>
                  <span className="spacer" aria-hidden="true" />
                </div>
                <div className="comment">
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
            <span className="ex-log-ts">{item.ts}</span>
            <span className="ex-log-text">{item.text}</span>
            <span className="ex-log-status">OK</span>
          </div>
        ))}
        <div className="ex-log-row ex-log-active" key="cursor">
          <span className="ex-log-ts">{nextTs.slice(0, 6)}</span>
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
    .toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" })
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
            field notes
          </span>
          <span className="meta" />
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
            entries.map((entry) => {
              const isExternal = "kind" in entry;
              return (
                <Link
                  className="blog-row"
                  to={isExternal ? entry.href : `/blog/${entry.slug}`}
                  key={isExternal ? `ext:${entry.href}` : entry.slug}
                  aria-label={entry.title}
                >
                  <span className="blog-date">{formatPostDate(entry.date)}</span>
                  <span className="blog-title">{entry.title}</span>
                  <span className="spacer" aria-hidden="true" />
                  <span className="blog-arrow">→</span>
                </Link>
              );
            })
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
            open source
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

function AccessModal() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onOpen = () => {
      setLoading(false);
      setOpen(true);
    };
    window.addEventListener("openAccessModal", onOpen);
    window.addEventListener("openWaitlistModal", onOpen);
    window.addEventListener("openSubscribeModal", onOpen);
    return () => {
      window.removeEventListener("openAccessModal", onOpen);
      window.removeEventListener("openWaitlistModal", onOpen);
      window.removeEventListener("openSubscribeModal", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, loading]);

  if (!open) return null;

  return (
    <div
      className="landing-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="landing-access-title"
      onClick={() => !loading && setOpen(false)}
    >
      <div className="landing-modal-backdrop" aria-hidden="true" />
      <div className="landing-modal-card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="landing-modal-close"
          onClick={() => setOpen(false)}
          disabled={loading}
          aria-label="Close"
        >
          ×
        </button>

        <WaitlistForm
          idPrefix="landing-access"
          onStatusChange={(s) => setLoading(s === "loading")}
          header={
            <>
              <h3 id="landing-access-title" className="landing-modal-title">
                request access
              </h3>
              <p className="landing-modal-lede">
                Index is opening in cycles. Leave your email and we&rsquo;ll
                let you know when the next one opens.
              </p>
            </>
          }
          successAction={
            <button
              type="button"
              className="landing-modal-submit is-primary"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          }
        />
      </div>
    </div>
  );
}

function LandingPage() {
  useEffect(() => {
    ensureLandingFonts();
  }, []);

  return (
    <div className="landing">
      <Hero />
      <HowItWorks />
      <LatestPosts />
      <OpenSource />
      <Footer />
      <AccessModal />
    </div>
  );
}

export default LandingPage;
export const Component = LandingPage;
