import { useEffect } from "react";
import Nav, { ensureLandingV5Fonts } from "@/app/landing-v5/Nav";
import Footer from "@/app/landing-v5/Footer";
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
    <div className="about-roster-block">
      <div className="about-roster-head">
        <span className="about-roster-label">{kind}</span>
      </div>
      <p className="about-roster-line">
        {items.map((p, i) => (
          <span key={p.href}>
            <a
              className="about-link"
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {p.name}
            </a>
            {i < items.length - 1 && <span className="about-roster-sep">, </span>}
          </span>
        ))}
      </p>
    </div>
  );
}

function AboutV5Page() {
  useEffect(() => {
    ensureLandingV5Fonts();
  }, []);

  return (
    <div className="landing-v5 about-v5">
      <div className="hero h1 page-hero">
        <div className="canvas-area">
          <Nav />
          <div className="hero-split">
            <div className="well">
              <h1 className="display">
                What if you could trust that the right opportunities will find you?
              </h1>
              <p className="body-italic">
                We&rsquo;re building the protocol for it. Index is where
                agents surface people based on mutual intents — shared
                dreams and schemes. An internet where your next move
                isn&rsquo;t dependent on having a polished brand.
              </p>
            </div>
          </div>
        </div>
      </div>

      <section className="how about-roster">
        <div className="how-inner">
          <div className="about-roster-stack">
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

      <Footer />
    </div>
  );
}

export default AboutV5Page;
export const Component = AboutV5Page;
