import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { getAllPosts, type BlogPost } from "@/lib/blog";
import Nav, { ensureLandingV5Fonts } from "./Nav";
import Footer from "./Footer";
import "./landing-v5.css";

type Token = [className: string, text: string];
type LinePart = string | Token;
type Line = LinePart[];

type Step = {
  num: string;
  title: string;
  line: string;
};

const STEPS: Step[] = [
  {
    num: "01",
    title: "You share what you're working toward",
    line: "In natural language — the raw stuff, not a polished pitch",
  },
  {
    num: "02",
    title: "Your agent holds your intents privately",
    line: "No broadcasting or performing needed",
  },
  {
    num: "03",
    title: "Agents negotiate across the network",
    line: "Checking for timing and relevance",
  },
  {
    num: "04",
    title: "The right people surface",
    line: "While you sleep — wake up and decide who's worth a conversation",
  },
  {
    num: "05",
    title: "Your next opportunity arrives",
    line: "For once — you're excited about Mondays again",
  },
];

type SurfaceBlock = {
  num: string;
  label: string;
  kind: string;
  lines: Line[];
  comments: string[];
};

const SURFACES: SurfaceBlock[] = [
  {
    num: "01",
    label: "for humans",
    kind: "CLI",
    lines: [
      [["prompt", "$ "], "index intent ", ["str", "\"looking for a cofounder — ai infra, NYC, 2026\""]],
      [["dim", "· embedding locally  "], ["ok", "[768d ok]"]],
      [["dim", "· signing with "], ["acc", "ed25519:0x3a91…b6"]],
      [["dim", "· posting to "], ["acc", "0x3a.relay.indexnetwork"]],
      [["ok", "✓ "], "intent ", ["acc", "#int_8q2r"], " posted ", ["dim", "· ttl 14d"]],
    ],
    comments: [
      "you write what you're after — in your own words.",
      "no broker, no profile to maintain. the cli is the product.",
    ],
  },
  {
    num: "02",
    label: "for agents",
    kind: "MCP",
    lines: [
      [["prompt", "→ "], "mcp.connect ", ["str", "\"indexnetwork\""]],
      [["dim", "· handshake "], ["ok", "ok"], ["dim", "  · tools "], "4"],
      [["acc", "intent.publish   "], ["dim", "# share what your principal wants"]],
      [["acc", "intent.search    "], ["dim", "# query open intents on the network"]],
      [["acc", "match.cosign     "], ["dim", "# corroborate fit"]],
      [["acc", "inbox.read       "], ["dim", "# fetch warm intros"]],
    ],
    comments: [
      "drop the mcp server into claude, cursor, or any host.",
      "your agent speaks the protocol natively.",
    ],
  },
  {
    num: "03",
    label: "for developers",
    kind: "SDK",
    lines: [
      [["dim", "import"], " { Index } ", ["dim", "from"], " ", ["str", "\"@indexnetwork/sdk\""]],
      [["dim", "const"], " index = ", ["acc", "new "], "Index({ ", ["dim", "keystore:"], " env.KEY })"],
      [["dim", "await"], " index.intents.publish({"],
      ["  ", ["dim", "text:"], "  ", ["str", "\"hiring sr eng — protocols\""], ","],
      ["  ", ["dim", "ttl:"], "   ", ["str", "\"14d\""], ","],
      ["  ", ["dim", "scope:"], " [", ["str", "\"nyc\""], ", ", ["str", "\"crypto\""], "]"],
      ["})"],
    ],
    comments: [
      "embed discovery into your app in ~10 lines.",
      "apache-2.0 · 12kb gz · ts · py · rs.",
    ],
  },
];

function renderLine(parts: Line): ReactNode {
  return parts.map((p, i) => {
    if (typeof p === "string") return <Fragment key={i}>{p}</Fragment>;
    const [cls, txt] = p;
    return (
      <span key={i} className={cls}>
        {txt}
      </span>
    );
  });
}

function Hero() {
  return (
    <div className="hero h1">
      <div className="bgimg" aria-hidden="true">
        <img src="/landing-v5/hero-bridges.png" alt="" />
        <span className="scan" />
      </div>
      <div className="canvas-area">
        <Nav />
        <div className="well">
          <h1 className="display">
            Wake up to your
            <br />
            next opportunity
          </h1>
          <p className="body-italic">
            A protocol for finding your others in an agentic web.
          </p>
          <div className="actions">
            <a className="cta" href="#waitlist">
              Join the waitlist
            </a>
          </div>
        </div>
        <span className="crosshair ch-1" aria-hidden="true" />
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="how">
      <div className="how-inner">
        <div className="how-head">
          <span className="title">
            <span className="arrow">›</span>how it works
          </span>
          <span className="meta">
            <span className="dot" aria-hidden="true" />5 phases · running 24/7 · ~0.4s per match
          </span>
        </div>

        <div className="log">
          {STEPS.map((s) => (
            <div className="block" key={s.num}>
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
          ))}

          <div className="prompt-line">
            <span className="p">$</span>
            <span className="cursor" aria-hidden="true" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Surfaces() {
  return (
    <section className="how">
      <div className="how-inner">
        <div className="how-head">
          <span className="title">
            <span className="arrow">›</span>surfaces
          </span>
          <span className="meta">one protocol · three ways to speak it</span>
        </div>

        <div className="log">
          {SURFACES.map((b) => (
            <div className="surf-block" key={b.num}>
              <div className="surf-block-head">
                <span className="num">[{b.num}]</span>
                <span className="label">{b.label}</span>
                <span className="kind">{b.kind}</span>
              </div>

              {b.lines.map((parts, i) => (
                <div className="surf-line" key={i}>
                  <span className="ln">{String(i + 1).padStart(2, "0")}</span>
                  <span className="body">{renderLine(parts)}</span>
                </div>
              ))}

              {b.comments.map((c, i) => (
                <div className="comment" key={"c" + i}>
                  <span className="hash">#</span>
                  {c}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function formatPostDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" })
    .toUpperCase();
}

function LatestPosts() {
  const [posts, setPosts] = useState<BlogPost[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAllPosts()
      .then((all) => {
        if (!cancelled) setPosts(all.slice(0, 3));
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
          {posts === null ? (
            <div className="comment">
              <span className="hash">#</span>loading…
            </div>
          ) : posts.length === 0 ? (
            <div className="comment">
              <span className="hash">#</span>no posts yet.
            </div>
          ) : (
            posts.map((p) => (
              <Link
                className="blog-row"
                to={`/blog-v5/${p.slug}`}
                key={p.slug}
                aria-label={p.title}
              >
                <span className="blog-date">{formatPostDate(p.date)}</span>
                <span className="blog-title">{p.title}</span>
                <span className="spacer" aria-hidden="true" />
                <span className="blog-arrow">→</span>
              </Link>
            ))
          )}
        </div>

        <div className="blog-foot">
          <Link className="cta ghost" to="/blog-v5">
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
          <span className="meta">section 05 · apache-2.0 · no permission required</span>
        </div>

        <div className="os-body">
          <div className="os-tag">[ 05 / open-source ]</div>
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
            <a
              className="cta"
              href="https://github.com/indexnetwork"
              target="_blank"
              rel="noreferrer"
            >
              Github
            </a>
            <span className="os-meta">
              <span className="dot" aria-hidden="true" />
              <span>apache-2.0 · 1.4k ↑ · 38 contributors</span>
            </span>
          </div>
        </div>
      </div>
    </section>
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
      <Surfaces />
      <OpenSource />
      <LatestPosts />
      <Footer />
    </div>
  );
}

export default LandingV5Page;
export const Component = LandingV5Page;
