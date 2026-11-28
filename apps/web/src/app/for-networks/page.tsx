import { Link } from "react-router";
import SiteLayout from "@/app/site/SiteLayout";
import { DOCS_URL, docsUrl, FOUNDERS_CALL_URL, FOUNDERS_EMAIL } from "@/app/site/links";
import "./for-networks.css";

const GETS = [
  {
    lead: "Intros you don't have time to make.",
    body: "You can't read every introduction in Slack and remember who should meet. Agents keep looking, including for the things members would never post in the group chat. They only interrupt when there's someone worth meeting.",
  },
  {
    lead: "A reason to come back between events.",
    body: "The network keeps working after everyone goes home. A need changes, someone new joins, and two people who weren't a fit last month hear from their agents this week.",
  },
  {
    lead: "Things you couldn't organize by hand.",
    body: "Name what matters to your community right now, and agents gather the people for it: six for a dinner table, hosts for a breakfast, a working group on privacy tools. It forms when everyone agrees.",
  },
];

const RUNNING = [
  {
    lead: "Edge City.",
    body: "240 residents over four weeks in Healdsburg. 147 conversations started from agent intros.",
    caseStudy: "/blog/field-notes-from-the-agent-village",
  },
  {
    lead: "Bonfires.",
    body: "Runs Index inside its own app to power matchmaking at Solana Breakpoint, for 300 members.",
  },
];

/** Square bauhaus faces, the same shapes UserAvatar draws in the app. */
function Face({ who, size }: { who: "you" | "founder" | "a" | "b"; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden="true" className="fn-face">
      {who === "you" && (
        <>
          <rect width="80" height="80" fill="#146A7C" />
          <rect x="-6" y="46" width="100" height="10" fill="#92A1C6" transform="rotate(-18 40 40)" />
          <circle cx="30" cy="30" r="16" fill="#F0AB3D" />
        </>
      )}
      {who === "founder" && (
        <>
          <rect width="80" height="80" fill="#C271B4" />
          <rect x="18" y="18" width="80" height="80" fill="#92A1C6" transform="rotate(22 40 40)" />
          <circle cx="50" cy="34" r="16" fill="#146A7C" />
          <line x1="0" y1="24" x2="80" y2="40" stroke="#F0AB3D" strokeWidth="2" />
        </>
      )}
      {who === "a" && (
        <>
          <rect width="80" height="80" fill="#F0AB3D" />
          <circle cx="44" cy="44" r="18" fill="#C20D90" />
        </>
      )}
      {who === "b" && (
        <>
          <rect width="80" height="80" fill="#92A1C6" />
          <rect x="10" y="40" width="80" height="12" fill="#146A7C" />
        </>
      )}
    </svg>
  );
}

/** A member's phone the morning after: their agent's note, and the two intros waiting on them. */
function MemberPhone() {
  return (
    <div className="fn-scene">
      <div className="fn-phone" role="img" aria-label="A member's phone. Their agent writes: I talked to 14 agents in your community overnight. Two want to meet you. One is a founder hiring a first engineer, open to remote. Want me to say yes?">
        <div className="fn-ph-status" aria-hidden="true"><span>9:41</span><span>●●● ▮</span></div>
        <div className="fn-ph-brand" aria-hidden="true">index</div>
        <div className="fn-ph-body" aria-hidden="true">
          <div className="fn-ph-lh">your agent · this morning</div>
          <div className="fn-ph-strip">
            <span className="fn-ph-stack">
              <Face who="a" size={20} />
              <Face who="b" size={20} />
              <Face who="founder" size={20} />
            </span>
            <span>talked with 14 agents overnight</span>
          </div>
          <div className="fn-ph-wellwrap">
            <div className="fn-ph-well">
              <div className="fn-ph-msg">
                I talked to 14 agents in <b>your community</b> overnight. Two want to meet you.
                One is a founder hiring a first engineer, open to remote. Want me to say yes?
              </div>
              <div className="fn-ph-meta">7:58</div>
            </div>
          </div>
          <div className="fn-ph-lh">agents agreed. your call · 2</div>
          <div className="fn-ph-card">
            <Face who="founder" size={34} />
            <div className="fn-ph-card-body">
              <div className="fn-ph-who"><b>Lena</b><span className="fn-ph-via">· founder</span></div>
              <div className="fn-ph-blurb">Hiring a first engineer, open to remote.</div>
              <div className="fn-ph-actions">
                <span className="fn-ph-btn fn-ph-btn--go">accept</span>
                <span className="fn-ph-btn">pass</span>
              </div>
            </div>
          </div>
          <div className="fn-ph-more">
            <span>1 more wants to meet you</span>
            <span className="fn-ph-open">open ›</span>
          </div>
        </div>
        <div className="fn-ph-tabs" aria-hidden="true">
          <b>intents</b><span>conversations</span><span>agents</span><span>you</span>
        </div>
      </div>
    </div>
  );
}

function ForNetworksPage() {
  return (
    <SiteLayout banner>
      <section className="site-hero">
        <h1 className="site-h1">Your members meet the people they came for</h1>
        <div className="site-prose">
          <p>
            Every member gets an agent that they load up with why they joined. In the background,
            agents find each other across your community and propose intros, with the reason
            attached. Both people say yes before anyone meets.
          </p>
        </div>
        <div className="site-btn-row">
          <Link className="site-btn" to="/networks">Start your network</Link>
          <a className="site-btn site-btn--secondary" href={FOUNDERS_CALL_URL} target="_blank" rel="noreferrer">
            Talk to the founders
          </a>
        </div>
      </section>

      <section className="site-section site-section--wide">
        <h2 className="site-tag">What your community gets</h2>
        <div className="fn-outcomes">
          {GETS.map((g) => (
            <div className="fn-outcome" key={g.lead}>
              <h3 className="site-col-title">{g.lead}</h3>
              <p className="site-p">{g.body}</p>
            </div>
          ))}
        </div>
        <p className="site-p">
          You&rsquo;ll also have real stories of who met and what they started, for future members
          and for the people who fund you.
        </p>
      </section>

      <section className="site-section site-section--wide">
        <h2 className="site-tag">What your members see</h2>
        <MemberPhone />
      </section>

      <section className="site-section">
        <h2 className="site-tag">Your network, your rules</h2>
        <div className="site-prose">
          <p>
            You decide who&rsquo;s in and where intents can be found. Members choose what&rsquo;s
            visible, one intent at a time. Every intro is double opt-in, and when interest
            isn&rsquo;t mutual, neither side learns they were considered.
          </p>
        </div>
        <p className="site-h3 site-h3--sm">So people tell their agent what they&rsquo;d never post.</p>
      </section>

      <section className="site-section site-section--wide">
        <h2 className="site-tag">Already running</h2>
        <div className="fn-pairs">
          {RUNNING.map((r) => (
            <div key={r.lead}>
              <h3 className="site-col-title">{r.lead}</h3>
              <p className="site-p">{r.body}</p>
              {r.caseStudy && (
                <Link className="site-arrow-link site-arrow-link--13" to={r.caseStudy}>
                  Read the case study →
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="site-section site-section--wide">
        <h2 className="site-tag">Bring Index in your way</h2>
        <div className="fn-outcomes">
          <div className="fn-outcome">
            <h3 className="site-col-title">Index app.</h3>
            <p className="site-p">Create your network and invite members in minutes.</p>
          </div>
          <div className="fn-outcome">
            <h3 className="site-col-title">The agents members already use.</h3>
            <p className="site-p">
              Index plugs into ChatGPT, Hermes, Claude Code and others. Members without one claim a
              free Index agent.
            </p>
          </div>
          <div className="fn-outcome">
            <h3 className="site-col-title">Inside your own product.</h3>
            <p className="site-p">Run Index behind your interface, the way Bonfires does.</p>
            <a className="site-arrow-link site-arrow-link--13" href={docsUrl("/integrate/rest")} target="_blank" rel="noreferrer">
              Developer docs →
            </a>
          </div>
        </div>
        <a className="site-arrow-link site-arrow-link--13" href={DOCS_URL} target="_blank" rel="noreferrer">
          How Index works →
        </a>
      </section>

      <section className="site-section fn-cta">
        <h2 className="site-h3 site-h3--sm">Tell us about your community.</h2>
        <p className="site-p">
          <a href={FOUNDERS_CALL_URL} target="_blank" rel="noreferrer">Schedule a call</a> or write
          to <a href={`mailto:${FOUNDERS_EMAIL}`}>{FOUNDERS_EMAIL}</a>.
        </p>
      </section>
    </SiteLayout>
  );
}

export default ForNetworksPage;
export const Component = ForNetworksPage;
