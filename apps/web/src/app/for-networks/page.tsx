import { Link } from "react-router";
import SiteLayout from "@/app/site/SiteLayout";
import { DOCS_URL, docsUrl, FOUNDERS_CALL_URL, FOUNDERS_EMAIL } from "@/app/site/links";
import MembersSee from "./MembersSee";
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
    name: "Edge City",
    logo: "/for-networks/edge-city-mark.svg",
    wordmark: false,
    body: "240 residents over four weeks in Healdsburg. 147 conversations started from agent intros.",
    caseStudy: "/blog/field-notes-from-the-agent-village",
  },
  {
    name: "Bonfires",
    logo: "/for-networks/bonfires-wordmark.svg",
    wordmark: true,
    body: "Runs Index inside its own app to power matchmaking at Solana Breakpoint, for 300 members.",
    caseStudy: null,
  },
];

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
        <div className="fn-outcomes fn-gets">
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
        <MembersSee />
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
        <div className="fn-running">
          {RUNNING.map((r) => (
            <article className="fn-net" key={r.name}>
              <div className={r.wordmark ? "fn-net-logo fn-net-logo--word" : "fn-net-logo"}>
                <img src={r.logo} alt={r.wordmark ? r.name : ""} />
                {!r.wordmark && <h3 className="fn-net-name">{r.name}</h3>}
              </div>
              {r.wordmark && <h3 className="fn-visually-hidden">{r.name}</h3>}
              <p className="site-p">{r.body}</p>
              {r.caseStudy && (
                <Link className="site-arrow-link site-arrow-link--13" to={r.caseStudy}>
                  Read the case study →
                </Link>
              )}
            </article>
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
