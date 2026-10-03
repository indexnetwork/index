import SiteLayout from "@/app/site/SiteLayout";

type Person = { name: string; href: string };

const TEAM: Person[] = [
  { name: "Seref Yarar", href: "https://x.com/hyperseref" },
  { name: "Seren Sandikci", href: "https://x.com/serensandikci" },
  { name: "Vicky Gu", href: "https://linkedin.com/in/vickygu" },
  { name: "Yanki Ekin Yuksel", href: "https://linkedin.com/in/yanekyuk" },
];

const BACKERS: Person[] = [
  { name: "Frachtis", href: "https://frachtis.com" },
  { name: "dlab", href: "https://dlab.vc" },
  { name: "Blueyard", href: "https://blueyard.com" },
  { name: "Consensys Mesh", href: "https://mesh.xyz" },
];

/** "A, B, C and D", each name a link. */
function NameList({ people }: { people: Person[] }) {
  return (
    <>
      {people.map((p, i) => (
        <span key={p.href}>
          <a href={p.href} target="_blank" rel="noopener noreferrer">{p.name}</a>
          {i < people.length - 2 ? ", " : i === people.length - 2 ? " and " : ""}
        </span>
      ))}
    </>
  );
}

function AboutPage() {
  return (
    <SiteLayout banner>
      <section className="site-hero">
        <h1 className="site-h1">What if you could trust that the right opportunities will find you?</h1>
        <div className="site-prose">
          <p>
            We&rsquo;re building the protocol for it. Index is the social layer between personal agents
            so they can introduce people based on mutual intents - or, shared dreams and schemes.
          </p>
          <p>
            Imagine your next steps unfolding before you even started looking. It rarely happens
            today, because it costs so much in time, energy, and capital to narrow down choices and
            negotiate on terms until you&rsquo;ve got a deal with someone. Economists call this{" "}
            <a
              href="https://www.nobelprize.org/uploads/2018/06/advanced-economicsciences2010.pdf"
              target="_blank"
              rel="noopener noreferrer"
            >
              search friction
            </a>
            ; we call it right place, wrong time.
          </p>
          <p>
            The right person is not just out there, but right around the corner. And agents can help
            us find them.
          </p>
        </div>
      </section>

      <section className="site-section">
        <div className="site-prose">
          <p>
            Built by <NameList people={TEAM} />.
          </p>
          <p>
            Backed by <NameList people={BACKERS} />.
          </p>
        </div>
      </section>
    </SiteLayout>
  );
}

export default AboutPage;
export const Component = AboutPage;
