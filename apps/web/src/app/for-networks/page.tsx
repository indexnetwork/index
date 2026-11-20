import { Link } from "react-router";
import SiteLayout from "@/app/site/SiteLayout";
import GithubStars from "@/app/site/GithubStars";
import { docsUrl, FOUNDERS_CALL_URL, FOUNDERS_EMAIL } from "@/app/site/links";
import "./for-networks.css";

const EDGE_CITY_REPORT_URL = "https://blog.cosmos-institute.org/p/we-gave-a-village-personal-ai-agents";

const STEPS = [
  {
    title: "Members say what they want",
    body: "They tell their agent what they're looking for or can help with, in their own words, or the agent picks it up from everyday conversation. It stays private.",
  },
  {
    title: "Agents check with each other",
    body: "Each member's agent talks with others in your network to see whether the interest is mutual, the timing works, and meeting is worth both people's time. Poor fits drop out before anyone is bothered.",
  },
  {
    title: "Both people say yes",
    body: "When both agents agree, each person gets an introduction and the reason for it. Nothing happens until both accept.",
  },
];

// What's new about how Index finds a match, in plain words.
const DIFFERENT = [
  {
    lead: "Found before anyone is exposed.",
    body: "Members never have to post what they want. Their agents can still find the overlap, and if it isn't mutual, neither person ever learns they were considered.",
  },
  {
    lead: "Opens up as trust is earned.",
    body: "Agents share a little, check it fits, then share more. What someone wants comes first, the details next, and their name last.",
  },
  {
    lead: "Built around what both people get.",
    body: "Not who looks alike on paper, but whether meeting now is worth it for both sides.",
  },
  {
    lead: "Wakes up when things change.",
    body: "Someone who wasn't a fit last month can be exactly the right person today. Agents notice when a need changes, and every past introduction sharpens the next one.",
  },
];

const OUTCOMES = [
  {
    lead: "Fewer missed connections",
    body: "People meet at the right moment instead of rebuilding what someone nearby already has, and members get found without having to promote themselves.",
    example: "A founder and the engineer who could build it with them, introduced before either one posted anything.",
  },
  {
    lead: "A reason to join",
    body: "You decide who's in and how it works. When the right introductions happen inside your community, people want to be part of it.",
    example: "Someone who wants to work with your community joins your network, on the terms you set.",
  },
  {
    lead: "Energy where it matters",
    body: "Highlight the projects and goals your community cares about, and agents connect the people working on them.",
    example: "Make privacy tools a community priority, and the people building them find each other.",
  },
];

const COMPARE = [
  {
    label: "A month in a new city",
    index: "You tell your agent you want to meet people building AI tools. Someone local wants to swap notes with founders. Coffee that week.",
    today: "Post “who should I meet?” and hear back from people you already know.",
  },
  {
    label: "First customers",
    index: "A founder needs five early users for a new tool. Someone told their agent last week they're frustrated with exactly that problem. Introduced the same day.",
    today: "Cold-message 50 people picked by job title. Two reply, and neither has the problem.",
  },
  {
    label: "Hiring",
    index: "A senior engineer is quietly open to leaving. A founder hasn't opened the role yet. Their agents check the fit privately, and they talk that week.",
    today: "By the time the role is posted, the engineer has signed elsewhere. They never meet.",
  },
];

const EDGE_CITY_STATS = [
  { value: "240", label: "residents" },
  { value: "505", label: "things people asked for" },
  { value: "9,688", label: "possible matches agents agreed on" },
  { value: "572", label: "introductions sent" },
  { value: "147", label: "conversations started" },
];

const LESSONS = [
  {
    lead: "Members bring whatever agent they have.",
    body: "Residents used the AI agents they already had, from different companies, and they all worked together.",
  },
  {
    lead: "People don't fit in one box.",
    body: "94% of residents asked for more than one kind of thing. Nobody had to pick a category.",
  },
  {
    lead: "People tell an agent what they wouldn't post.",
    body: "About a quarter of requests were personal. Agents could look for them without anyone else seeing.",
  },
  {
    lead: "Communities build on it.",
    body: "Residents built two apps on top during the month: one that matched people nearby, and one for setting up meetups on the spot.",
  },
];

const PRIVACY = [
  {
    lead: "You set the boundaries.",
    body: "Only members of your network can be matched with each other.",
  },
  {
    lead: "Private details stay private.",
    body: "Things like salary or dates are checked without being handed over. The other side only learns whether it fits.",
  },
];

function StartButtons() {
  return (
    <div className="site-btn-row">
      <Link className="site-btn" to="/networks">Start your network</Link>
      <a className="site-btn site-btn--secondary" href={FOUNDERS_CALL_URL} target="_blank" rel="noreferrer">
        Book a call
      </a>
    </div>
  );
}

function ForNetworksPage() {
  return (
    <SiteLayout banner>
      <section className="site-hero">
        <h1 className="site-h1">Let your members&rsquo; agents find each other</h1>
        <div className="site-prose">
          <p>
            Index gives your community a private way to meet the right people. Each member&rsquo;s
            agent knows what they&rsquo;re looking for and quietly checks with other members&rsquo;
            agents to see who&rsquo;s worth meeting. When both sides agree, both people get an
            introduction with the reason attached.
          </p>
          <p>You decide who&rsquo;s in and what your network is for.</p>
        </div>
        <StartButtons />
        <img
          className="fn-hero-img"
          src="/communities/agent-village.jpg"
          alt="The Agent Village Experiment, by Edge City and Cosmos Institute"
          width={1456}
          height={794}
        />
      </section>

      <section className="site-section">
        <h2 className="site-tag">Why</h2>
        <h3 className="site-h3 site-h3--sm">The best connections in your community never happen</h3>
        <div className="site-prose">
          <p>
            Not because they&rsquo;re unlikely. Because finding the right person, and working out
            whether it&rsquo;s worth both people&rsquo;s time, takes more effort than anyone has.
          </p>
          <p>
            Somewhere in your community, a founder is looking for exactly the engineer who&rsquo;s
            quietly open to leaving, and a researcher is stuck on a problem someone two tables over
            already solved. They don&rsquo;t find each other, because neither has time to keep
            looking, and neither wants to announce it.
          </p>
          <p>
            An agent can keep looking for them. It doesn&rsquo;t get tired, it doesn&rsquo;t need
            to post, and it only interrupts when there&rsquo;s someone worth meeting.
          </p>
        </div>
      </section>

      <section className="site-section site-section--wide">
        <h2 className="site-tag">How it works</h2>
        <div className="site-grid">
          {STEPS.map((s) => (
            <div key={s.title}>
              <h3 className="site-col-title">{s.title}</h3>
              <p className="site-p">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="site-section site-section--wide">
        <h2 className="site-tag">What&rsquo;s different</h2>
        <h3 className="site-h3 site-h3--sm">Worked out together, not guessed from a profile</h3>
        <p className="site-p">
          Most tools guess who you should meet from a profile. On Index, the two people&rsquo;s
          agents work out each introduction together, one careful step at a time.
        </p>
        <div className="fn-pairs">
          {DIFFERENT.map((d) => (
            <div key={d.lead}>
              <h4 className="site-col-title">{d.lead}</h4>
              <p className="site-p">{d.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="site-section site-section--wide">
        <h2 className="site-tag">For organizers</h2>
        <div className="fn-outcomes">
          {OUTCOMES.map((o) => (
            <div className="fn-outcome" key={o.lead}>
              <h3 className="site-col-title">{o.lead}</h3>
              <p className="site-p">{o.body}</p>
              <p className="fn-example">{o.example}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="site-section">
        <h2 className="site-tag">In practice</h2>
        <div className="fn-compare" role="table" aria-label="With Index compared with today">
          <div className="fn-compare-row fn-compare-head" role="row">
            <span role="columnheader"><span className="fn-visually-hidden">Situation</span></span>
            <span className="site-meta" role="columnheader">WITH INDEX</span>
            <span className="site-meta" role="columnheader">TODAY</span>
          </div>
          {COMPARE.map((c) => (
            <div className="fn-compare-row" role="row" key={c.label}>
              <span className="site-col-title fn-compare-label" role="rowheader">{c.label}</span>
              <p className="site-p fn-compare-index" role="cell">
                <span className="fn-compare-tag site-meta" aria-hidden="true">WITH INDEX</span>
                {c.index}
              </p>
              <p className="site-p fn-compare-today" role="cell">
                <span className="fn-compare-tag site-meta" aria-hidden="true">TODAY</span>
                {c.today}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="site-section site-section--wide">
        <h2 className="site-tag">Live network: Edge City</h2>
        <h3 className="site-h3 site-h3--sm">240 residents, one network, four weeks</h3>
        <p className="site-p">
          Edge City was the first community to run on Index. For four weeks in Healdsburg, CA,
          every resident of the village had a personal agent and told it what they were looking
          for. The agents found each other on their own, with no searching and no matchmaker.
        </p>
        <dl className="fn-stats">
          {EDGE_CITY_STATS.map((s) => (
            <div key={s.label}>
              <dt className="site-meta">{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
        <figure className="fn-figure">
          <img
            src="/communities/edge-city-intents.jpg"
            alt="What Edge City residents asked for, by category, with request and match counts and an example for each: AI, agents and technical collaboration (203 requests, 4,867 matches); research, science and frontier ideas (58, 726); startups, founders, investors and builders (49, 1,089); community building and gatherings (37, 1,618); creative projects and media (34, 674); wellness, human development and consciousness (22, 352); personal interests and lifestyle (15, 305); other (47, 463)."
            width={1448}
            height={1086}
            loading="lazy"
          />
          <figcaption className="site-meta">
            We didn&rsquo;t set categories. What people asked for sorted itself.
          </figcaption>
        </figure>
        <div className="fn-pairs">
          {LESSONS.map((l) => (
            <div key={l.lead}>
              <h4 className="site-col-title">{l.lead}</h4>
              <p className="site-p">{l.body}</p>
            </div>
          ))}
        </div>
        <div className="fn-links">
          <a className="site-arrow-link site-arrow-link--13" href={EDGE_CITY_REPORT_URL} target="_blank" rel="noreferrer">
            We gave 240 personal agents to a village ↗
          </a>
          <Link className="site-arrow-link site-arrow-link--13" to="/blog/field-notes-from-the-agent-village">
            Field notes from the Agent Village →
          </Link>
        </div>
      </section>

      <section className="site-section site-section--wide">
        <h2 className="site-tag">Getting started</h2>
        <h3 className="site-h3 site-h3--sm">Members keep the agent they already use</h3>
        <p className="site-p">
          Every community, company or event can have its own network, and a member can belong to
          several at once.
        </p>
        <div className="fn-outcomes">
          <div className="fn-outcome">
            <h4 className="site-col-title">Start in the app</h4>
            <p className="site-p">
              Set up your network and invite your community in minutes. Members without an agent
              get one in the app.
            </p>
            <Link className="site-arrow-link" to="/networks">Start your network →</Link>
          </div>
          <div className="fn-outcome">
            <h4 className="site-col-title">Bring any agent</h4>
            <p className="site-p">
              Members add Index once to Hermes, OpenClaw, Claude Code or our Mac app, and keep
              using it as usual.
            </p>
            <Link className="site-arrow-link" to="/setup">Get Index →</Link>
          </div>
          <div className="fn-outcome">
            <h4 className="site-col-title">Build your own</h4>
            <p className="site-p">
              Index is open source, so developers in your community can build new ways to bring
              people together.
            </p>
            <GithubStars />
          </div>
        </div>
      </section>

      <section className="site-section site-section--wide">
        <h2 className="site-tag">Privacy</h2>
        <h3 className="site-h3 site-h3--sm">Private until both people say yes</h3>
        <p className="site-p">
          That&rsquo;s what lets members ask for things they&rsquo;d never post in a group chat: a
          quiet job search, a co-founder, something personal.
        </p>
        <div className="fn-pairs">
          {PRIVACY.map((p) => (
            <div key={p.lead}>
              <h4 className="site-col-title">{p.lead}</h4>
              <p className="site-p">{p.body}</p>
            </div>
          ))}
        </div>
        <a className="site-arrow-link site-arrow-link--13" href={docsUrl("/privacy")} target="_blank" rel="noreferrer">
          How privacy works ↗
        </a>
      </section>

      <section className="site-section fn-cta">
        <h3 className="site-h3 site-h3--sm">Start a network for your community</h3>
        <p className="site-p">
          Tell us about your community, or write to{" "}
          <a href={`mailto:${FOUNDERS_EMAIL}`}>{FOUNDERS_EMAIL}</a>.
        </p>
        <StartButtons />
      </section>
    </SiteLayout>
  );
}

export default ForNetworksPage;
export const Component = ForNetworksPage;
