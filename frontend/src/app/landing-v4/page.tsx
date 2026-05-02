import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router";
import "./landing-v4.css";

type Surface = {
  id: string;
  glyph: string;
  title: string;
  desc: string;
  lang: string;
  code: string;
  output?: string;
};

const SURFACES: Surface[] = [
  {
    id: "cli",
    glyph: "□",
    title: "Command line",
    desc: "Terminal-native intents, streams, and receipts.",
    lang: "shell",
    code: `# install
$ npm i -g @indexnetwork/cli

# create an intent
$ idx intent create "looking for a co-author on intent semantics"

# stream opportunities as they surface
$ idx watch --status pending`,
    output: `[ok] cli v0.4.1 installed
[ok] intent_8c2f published  ·  receipt zk-snark`,
  },
  {
    id: "mcp",
    glyph: "◇",
    title: "MCP server",
    desc: "Plug Index into any agent that speaks MCP.",
    lang: "shell",
    code: `# register the index mcp server
$ claude mcp add indexnetwork \\
    --url https://mcp.index.network \\
    --token $INDEX_KEY

# list available tools
$ claude mcp list`,
    output: `[ok] indexnetwork  reachable  ·  7 tools loaded`,
  },
  {
    id: "sdk",
    glyph: "◆",
    title: "SDK",
    desc: "Embed intents and negotiations into your own product.",
    lang: "ts",
    code: `import { Index } from "@indexnetwork/sdk";

const index = new Index({ apiKey: process.env.INDEX_KEY });

await index.intents.create({
  body: "looking for a co-author on intent semantics",
  surface: "private",
});

for await (const op of index.opportunities.stream()) {
  console.log(op.fitScore, op.peerHandle);
}`,
  },
  {
    id: "rest",
    glyph: "◉",
    title: "REST API",
    desc: "Plain HTTP for whatever language we don't ship yet.",
    lang: "http",
    code: `# create an intent
$ curl https://api.index.network/v0/intents \\
    -H "authorization: Bearer $INDEX_KEY" \\
    -H "content-type: application/json" \\
    -d '{
      "body": "looking for a co-author on intent semantics",
      "surface": "private"
    }'

# list opportunities
$ curl https://api.index.network/v0/opportunities?status=pending \\
    -H "authorization: Bearer $INDEX_KEY"`,
    output: `HTTP/2 201
content-type: application/json
x-index-region: eu-west-1
x-index-vector-dim: 1536

{
  "id": "intent_8c2f",
  "status": "active",
  "embedded_at": "2026-04-26T19:03:21Z",
  "matchable_against": 12481002
}`,
  },
  {
    id: "web",
    glyph: "◐",
    title: "Web app",
    desc: "A quiet inbox for your intents and opportunities.",
    lang: "shell",
    code: `# open the index web app
$ open https://index.network/app

# write what you want in plain language.
# the index returns people, not posts.
# no feed, no inbox bloat.`,
  },
  {
    id: "hooks",
    glyph: "▦",
    title: "Webhooks",
    desc: "Get pinged when the protocol surfaces something for you.",
    lang: "http",
    code: `# subscribe to opportunity events
$ curl https://api.index.network/v0/webhooks \\
    -H "authorization: Bearer $INDEX_KEY" \\
    -d '{
      "url": "https://you.example/index-events",
      "events": ["opportunity.surfaced", "intent.cosigned"]
    }'`,
    output: `[ok] webhook_4f2 registered  ·  signing key wh_sec_a1c…`,
  },
];

const STRING_SPLIT = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;

function colorStrings(text: string): ReactNode {
  if (!text) return null;
  return text.split(STRING_SPLIT).map((part, i) =>
    part.startsWith('"') || part.startsWith("'") ? (
      <span key={i} className="st">{part}</span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function tokenizeLine(line: string): ReactNode {
  if (/^\s*(#|\/\/)/.test(line)) {
    return <span className="cm">{line}</span>;
  }
  const promptMatch = line.match(/^(\s*)(\$)( ?)(.*)$/);
  if (promptMatch) {
    const [, lead, dollar, sp, rest] = promptMatch;
    return (
      <>
        {lead}
        <span className="pr">{dollar}</span>
        {sp}
        {colorStrings(rest)}
      </>
    );
  }
  return colorStrings(line);
}

function renderCode(text: string): ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <Fragment key={i}>
      {tokenizeLine(line)}
      {i < lines.length - 1 && "\n"}
    </Fragment>
  ));
}

function LandingV4Page() {
  const [activeId, setActiveId] = useState<string>("rest");
  const [copied, setCopied] = useState(false);
  const current = SURFACES.find((s) => s.id === activeId) ?? SURFACES[0];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(current.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="landing-v4-page">
      {/* ─────────── TOP BAR ─────────── */}
      <header className="topbar">
        <div className="left">
          <Link to="/" className="brand" aria-label="Index Network">
            <img
              src="/logo.svg"
              alt="Index Network"
              width={200}
              height={36}
            />
          </Link>
          <nav className="nav">
            <Link to="/blog">blog</Link>
            <Link to="/about">about</Link>
          </nav>
        </div>
      </header>

      {/* ─────────── MAIN: video + lede ─────────── */}
      <main className="main" data-screen-label="01 Hero">
        <figure className="video-wrap">
          <img
            className="poster"
            src="/landing-v4/street_poster.jpg"
            alt=""
            aria-hidden="true"
          />
          <video
            src="/landing-v4/street.mp4"
            poster="/landing-v4/street_poster.jpg"
            autoPlay
            loop
            muted
            playsInline
            aria-hidden="true"
          />
          <span className="video-tag tl">
            <span className="dot" />
            REC · ANONYMIZED
          </span>
          <span className="video-tag br">SAMPLE 04 / 12</span>
        </figure>

        <aside className="rail">
          <p className="eyebrow">
            <span className="num">01</span>
            <span className="sep">/</span>
            <span className="label">index</span>
          </p>

          <h1 className="display">
            <span className="accent">intent-driven</span>
            <br />
            discovery protocol.
          </h1>

          <p className="lede">
            Broadcast what you&rsquo;re looking for. The network finds who you
            need&nbsp;— and who needs you. People, opportunities, and
            knowledge, surfaced through signals, not searches.
          </p>

          <a href="#surfaces" className="rail-cta">
            <span className="rail-cta-label">open index.network/app</span>
            <span className="rail-cta-arr" aria-hidden="true">→</span>
          </a>
        </aside>
      </main>

      {/* ─────────── INTERFACES ─────────── */}
      <section className="interfaces" id="surfaces">
        <h2 className="section-label">
          <span className="bullet" aria-hidden="true" />
          interfaces · pick your surface · all reach the same protocol
          <span className="rule" aria-hidden="true" />
        </h2>

        <div className="interfaces-grid">
          <ul className="surface-rail" role="tablist" aria-label="surfaces">
            {SURFACES.map((s) => {
              const isActive = s.id === activeId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls="surface-panel"
                    className={`surface-row${isActive ? " is-active" : ""}`}
                    onClick={() => setActiveId(s.id)}
                  >
                    <span className="surface-glyph" aria-hidden="true">
                      {s.glyph}
                    </span>
                    <span className="surface-meta">
                      <span className="surface-title">{s.title}</span>
                      <span className="surface-desc">{s.desc}</span>
                    </span>
                    <span className="surface-dot" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>

          <div
            className="code-card"
            role="tabpanel"
            id="surface-panel"
            aria-labelledby={current.id}
          >
            <div className="code-card-bar">
              <span className="code-card-tab">{current.lang}</span>
              <span className="code-card-spacer" />
              <button
                type="button"
                className="code-card-copy"
                onClick={handleCopy}
              >
                {copied ? "copied" : "copy"}
              </button>
            </div>

            <pre className="code-body">
              <code>{renderCode(current.code)}</code>
            </pre>

            {current.output && (
              <>
                <div className="code-card-divider">terminal output</div>
                <pre className="code-out">
                  <code>{current.output}</code>
                </pre>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ─────────── FOOTER ─────────── */}
      <footer className="footer">
        <div className="links">
          <a href="#">submit</a>
          <a href="#">about</a>
          <a href="#">spec</a>
          <a href="#">github</a>
        </div>
        <div className="center">
          INDEX.NETWORK — BUILT BY HUMANS, CARRIED BY AGENTS
        </div>
        <div className="links">
          <a href="#">privacy</a>
          <a href="#">contact</a>
        </div>
      </footer>
    </div>
  );
}

export default LandingV4Page;
export const Component = LandingV4Page;
