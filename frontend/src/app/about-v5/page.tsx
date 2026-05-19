import { useEffect } from "react";
import Nav, { ensureLandingV5Fonts } from "@/app/landing-v5/Nav";
import "@/app/landing-v5/landing-v5.css";
import "./about-v5.css";

type Person = { name: string; href: string };

const TEAM: Person[] = [
  { name: "Seref Yarar", href: "https://x.com/hyperseref" },
  { name: "Seren Sandikci", href: "https://x.com/serensandikci" },
  { name: "Yanki Ekin Yuksel", href: "https://linkedin.com/in/yanekyuk" },
  { name: "Vicky Gu", href: "https://linkedin.com/in/vickygu" },
];

const INVESTORS: Person[] = [
  { name: "Frachtis", href: "https://frachtis.com" },
  { name: "dlab", href: "https://dlab.vc" },
  { name: "Blueyard", href: "https://blueyard.com" },
  { name: "Consensys Mesh", href: "https://mesh.xyz" },
  { name: "imToken", href: "https://imtoken.ventures/" },
  { name: "SunDAO", href: "https://sundao.ventures/" },
  { name: "Oak", href: "https://x.com/tannedoaksprout" },
  { name: "Billy Luedtke", href: "https://x.com/0xbilly" },
  {
    name: "Kobby Chen",
    href: "https://www.linkedin.com/in/zhehao-kobby-chen-8b6a92a5",
  },
];

function PersonList({ kind, items }: { kind: string; items: Person[] }) {
  return (
    <div className="surf-block">
      <div className="surf-block-head">
        <span className="num">[{kind === "team" ? "01" : "02"}]</span>
        <span className="label">{kind}</span>
        <span className="kind">{items.length} ENTRIES</span>
      </div>
      {items.map((p, i) => (
        <div className="surf-line" key={p.href}>
          <span className="ln">{String(i + 1).padStart(2, "0")}</span>
          <span className="body">
            <a
              className="acc about-link"
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {p.name}
            </a>
          </span>
        </div>
      ))}
    </div>
  );
}

function AboutV5Page() {
  useEffect(() => {
    ensureLandingV5Fonts();
  }, []);

  return (
    <div className="landing-v5 about-v5">
      <header className="about-nav-wrap">
        <Nav />
      </header>

      <section className="about-hero">
        <div className="about-inner">
          <div className="eyebrow">
            <span className="dot-g" aria-hidden="true" />
            <span>section · about</span>
          </div>
          <h1 className="display about-display">
            What if you could trust
            <br />
            that the right opportunities
            <br />
            will find you?
          </h1>
          <p className="about-lede">
            We&rsquo;re building the protocol for it. Index is where agents
            match people based on mutual intents — or, shared dreams and
            schemes. We believe in an internet where your next move
            isn&rsquo;t dependent on having a polished brand, and where you
            can be ambiently optimistic about social discovery.
          </p>
        </div>
      </section>

      <section className="how about-roster">
        <div className="how-inner">
          <div className="how-head">
            <span className="title">
              <span className="arrow">›</span>the roster
            </span>
            <span className="meta">who&rsquo;s behind index · who&rsquo;s backing it</span>
          </div>

          <div className="log">
            <PersonList kind="team" items={TEAM} />
            <PersonList kind="investors" items={INVESTORS} />
          </div>
        </div>
      </section>

      <section className="how about-join">
        <div className="how-inner">
          <div className="how-head">
            <span className="title">
              <span className="arrow">›</span>join us
            </span>
            <span className="meta">say hello</span>
          </div>

          <div className="about-join-body">
            <p className="about-join-line">
              <span className="hash">$</span>
              <span>email&nbsp;</span>
              <a className="acc" href="mailto:hello@index.network">
                hello@index.network
              </a>
              <span className="cursor" aria-hidden="true" />
            </p>
            <p className="comment">
              <span className="hash">#</span>tell us what you&rsquo;re working
              toward — we read every note.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default AboutV5Page;
export const Component = AboutV5Page;
