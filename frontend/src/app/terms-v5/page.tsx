import { useEffect, type ReactNode } from "react";
import Nav, { ensureLandingV5Fonts } from "@/app/landing-v5/Nav";
import Footer from "@/app/landing-v5/Footer";
import "@/app/landing-v5/landing-v5.css";
import "@/app/privacy-v5/legal-v5.css";

type Section = {
  id: string;
  title: string;
  body: ReactNode;
};

const EFFECTIVE_DATE = new Date(2025, 9, 20).toLocaleDateString("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const SECTIONS: Section[] = [
  {
    id: "acceptance",
    title: "acceptance of terms",
    body: (
      <p>
        These Terms of Use (&ldquo;Terms&rdquo;) govern your access to and use of
        the websites, products, and services provided by Index Network, Inc.
        (&ldquo;Index&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). By accessing
        or using our services, you agree to be bound by these Terms and our
        Privacy Policy. If you do not agree, do not use the services.
      </p>
    ),
  },
  {
    id: "eligibility",
    title: "eligibility & accounts",
    body: (
      <p>
        You must be legally able to form a binding contract and comply with
        applicable laws. You are responsible for maintaining the confidentiality
        of your account credentials and for all activities under your account.
        Notify us immediately of any unauthorized use.
      </p>
    ),
  },
  {
    id: "conduct",
    title: "user conduct & acceptable use",
    body: (
      <ul className="legal-list">
        <li>Do not violate laws, intellectual property, privacy, or other rights.</li>
        <li>
          Do not upload harmful code, attempt to disrupt or bypass security, or
          misuse APIs.
        </li>
        <li>
          Do not use the services to spam, harass, or engage in fraudulent or
          misleading activities.
        </li>
        <li>Respect rate limits and fair use guidelines we may publish.</li>
      </ul>
    ),
  },
  {
    id: "ip",
    title: "intellectual property",
    body: (
      <>
        <p>
          We and our licensors own all rights in the services, including
          software, content, logos, and trademarks. These are protected by
          intellectual property laws. Except as expressly allowed, you may not
          copy, modify, distribute, or create derivative works.
        </p>
        <p>
          You retain ownership of content you submit. You grant us a limited,
          non-exclusive, worldwide, royalty-free license to host, store,
          reproduce, and display your content solely to operate and improve the
          services.
        </p>
      </>
    ),
  },
  {
    id: "feedback",
    title: "feedback",
    body: (
      <p>
        If you provide feedback or suggestions, you grant us a non-exclusive,
        transferable, sublicensable, worldwide, perpetual license to use the
        feedback without restriction or compensation to you.
      </p>
    ),
  },
  {
    id: "third-party",
    title: "third-party services & links",
    body: (
      <p>
        The services may link to or integrate third-party content or services. We
        do not control and are not responsible for third-party services. Your
        use of them is subject to their terms and policies.
      </p>
    ),
  },
  {
    id: "disclaimer",
    title: "disclaimers",
    body: (
      <p className="legal-caps">
        The services are provided &ldquo;as is&rdquo; and &ldquo;as
        available&rdquo; without warranties of any kind, express or implied,
        including merchantability, fitness for a particular purpose, and
        non-infringement. We do not warrant that the services will be
        uninterrupted, secure, or error-free.
      </p>
    ),
  },
  {
    id: "liability",
    title: "limitation of liability",
    body: (
      <p className="legal-caps">
        To the maximum extent permitted by law, in no event will Index or its
        affiliates be liable for any indirect, incidental, special,
        consequential, or punitive damages, or any loss of profits or revenues,
        whether incurred directly or indirectly, or any loss of data, use,
        goodwill, or other intangible losses.
      </p>
    ),
  },
  {
    id: "indemnification",
    title: "indemnification",
    body: (
      <p>
        You agree to defend, indemnify, and hold harmless Index and its
        affiliates from and against any claims, liabilities, damages, losses,
        and expenses arising out of or related to your use of the services or
        your violation of these Terms or applicable law.
      </p>
    ),
  },
  {
    id: "termination",
    title: "termination & suspension",
    body: (
      <p>
        We may suspend or terminate access to the services at any time if we
        believe you have violated these Terms or to protect the services or
        other users. Upon termination, your right to use the services ceases
        immediately.
      </p>
    ),
  },
  {
    id: "law",
    title: "governing law & disputes",
    body: (
      <p>
        These Terms are governed by the laws of the State of Delaware, without
        regard to conflict of law rules. Any disputes will be resolved in the
        state or federal courts located in Delaware, and you consent to
        jurisdiction and venue in those courts. Where applicable law requires,
        you and Index agree to first attempt to resolve disputes informally.
      </p>
    ),
  },
  {
    id: "changes",
    title: "changes to terms",
    body: (
      <p>
        We may update these Terms from time to time. If changes are material, we
        will provide notice where required by law. The updated Terms will be
        effective when posted with a revised effective date.
      </p>
    ),
  },
  {
    id: "contact",
    title: "contact",
    body: (
      <>
        <p>
          Questions about these Terms?{" "}
          <a href="mailto:hello@index.network">hello@index.network</a>
        </p>
        <p>Index Network, Inc.</p>
      </>
    ),
  },
];

function TermsV5Page() {
  useEffect(() => {
    ensureLandingV5Fonts();
  }, []);

  return (
    <div className="landing-v5 legal-v5">
      <div className="hero h1 page-hero">
        <div className="canvas-area">
          <Nav />
          <div className="hero-split">
            <div className="well">
              <h1 className="display">Terms of Use</h1>
              <p className="body-italic">
                The agreement between you and Index — how the services may be
                used and the limits that apply.
              </p>
              <p className="legal-effective">
                effective · {EFFECTIVE_DATE}
              </p>
            </div>
          </div>
        </div>
      </div>

      <section className="how legal-toc">
        <div className="how-inner">
          <div className="how-head">
            <span className="title">
              <span className="arrow">›</span>contents
            </span>
            <span className="meta">{SECTIONS.length} sections</span>
          </div>
          <ol className="legal-toc-list">
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>
                  <span className="legal-toc-num">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="legal-toc-title">{s.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {SECTIONS.map((s, i) => (
        <section key={s.id} id={s.id} className="how legal-section">
          <div className="how-inner">
            <div className="how-head">
              <span className="title">
                <span className="arrow">›</span>
                {s.title}
              </span>
              <span className="meta">
                section · {String(i + 1).padStart(2, "0")}
              </span>
            </div>
            <div className="legal-body">{s.body}</div>
          </div>
        </section>
      ))}

      <Footer />
    </div>
  );
}

export default TermsV5Page;
export const Component = TermsV5Page;
