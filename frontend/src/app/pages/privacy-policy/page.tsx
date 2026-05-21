import { useEffect, type ReactNode } from "react";
import Nav, { ensureLandingV5Fonts } from "@/app/landing-v5/Nav";
import Footer from "@/app/landing-v5/Footer";
import "@/app/landing-v5/landing-v5.css";
import "./legal-v5.css";

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
    id: "overview",
    title: "overview & scope",
    body: (
      <p>
        This Privacy Policy explains how Index Network, Inc. (&ldquo;Index&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, shares, and safeguards
        personal information when you visit our website, use our services, or
        otherwise interact with us. It applies to information we process as a
        controller under the GDPR and as a business under the CCPA, as amended.
        By using our services, you agree to the practices described here.
      </p>
    ),
  },
  {
    id: "information-we-collect",
    title: "information we collect",
    body: (
      <ul className="legal-list">
        <li>
          <strong>Information you provide</strong> — account details, content
          you upload or submit (notes, files), preferences, and communications.
        </li>
        <li>
          <strong>Usage information</strong> — interactions with our site and
          services, such as page views, navigation flows, and feature usage.
        </li>
        <li>
          <strong>Device and technical data</strong> — browser type, operating
          system, device identifiers, IP address, and cookie identifiers.
        </li>
        <li>
          <strong>Cookies and similar technologies</strong> — essential cookies
          and privacy-respecting analytics to understand aggregate usage. See
          sharing &amp; processors for details.
        </li>
      </ul>
    ),
  },
  {
    id: "how-we-use",
    title: "how we use information",
    body: (
      <ul className="legal-list">
        <li>Provide, maintain, and improve our services and features.</li>
        <li>Personalize experiences, including content relevance and discovery.</li>
        <li>Communicate with you about updates, security, and support.</li>
        <li>Monitor performance, debug issues, and ensure reliability.</li>
        <li>Comply with legal obligations and enforce our terms.</li>
      </ul>
    ),
  },
  {
    id: "legal-bases",
    title: "legal bases (gdpr)",
    body: (
      <p>
        We process personal data under these legal bases:{" "}
        <strong>contract</strong> to provide the services you request;{" "}
        <strong>legitimate interests</strong> such as securing, improving, and
        measuring our services; <strong>consent</strong> for optional features
        where required; and <strong>legal obligations</strong>.
      </p>
    ),
  },
  {
    id: "sharing",
    title: "sharing & processors",
    body: (
      <>
        <p>
          We do not sell personal information. We share data with service
          providers who act as processors and follow our instructions:
        </p>
        <ul className="legal-list">
          <li>
            <strong>Analytics</strong> — Plausible Analytics, a privacy-focused
            platform that measures aggregate site usage without tracking cookies
            for individual profiles.
          </li>
          <li>
            <strong>Hosting</strong> — infrastructure providers to serve our
            website and APIs.
          </li>
          <li>
            <strong>Communications</strong> — email and support tools to contact
            you upon request.
          </li>
        </ul>
        <p>
          We may disclose information if required by law, to protect rights and
          safety, or in connection with a merger, acquisition, or asset transfer.
        </p>
      </>
    ),
  },
  {
    id: "transfers",
    title: "international transfers",
    body: (
      <p>
        If personal data is transferred internationally, we rely on appropriate
        safeguards such as Standard Contractual Clauses or adequacy decisions, as
        applicable, to protect your information.
      </p>
    ),
  },
  {
    id: "retention",
    title: "data retention",
    body: (
      <p>
        We retain personal information only as long as necessary for the purposes
        described in this Policy, to comply with legal obligations, resolve
        disputes, and enforce agreements. Retention periods depend on the type
        and context of the data.
      </p>
    ),
  },
  {
    id: "your-rights",
    title: "your rights (gdpr/ccpa)",
    body: (
      <>
        <p>
          Subject to applicable law, you may have rights to access, correct,
          delete, port, or restrict processing of your personal information, as
          well as to object to processing or withdraw consent where processing is
          based on consent.
        </p>
        <p>
          California residents may have additional rights, including to know
          categories of personal information, sources, purposes, and recipients;
          to request deletion or correction; to opt out of certain sharing; and
          to not be discriminated against for exercising rights.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "security",
    body: (
      <p>
        We use administrative, technical, and organizational measures designed to
        protect personal information. No system is perfectly secure, and we
        cannot guarantee absolute security; we regularly evaluate and improve our
        safeguards.
      </p>
    ),
  },
  {
    id: "children",
    title: "children's privacy",
    body: (
      <p>
        Our services are not directed to children under 13 (or as defined by
        local law). We do not knowingly collect personal information from
        children. If you believe a child has provided personal information,
        please contact us and we will take appropriate steps to delete it.
      </p>
    ),
  },
  {
    id: "changes",
    title: "changes to this policy",
    body: (
      <p>
        We may update this Policy to reflect changes in our practices or the law.
        We will post the updated version with a new effective date, and if
        changes are material, we will provide additional notice where required.
      </p>
    ),
  },
  {
    id: "contact",
    title: "contact",
    body: (
      <>
        <p>
          Questions or requests related to this Policy or your personal
          information?{" "}
          <a href="mailto:hello@index.network">hello@index.network</a>
        </p>
        <p>Index Network, Inc.</p>
      </>
    ),
  },
];

export default function PrivacyPolicyPage() {
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
              <h1 className="display">Privacy Policy</h1>
              <p className="body-italic">
                How Index Network handles personal information — what we
                collect, why, and what choices you have.
              </p>
              <p className="legal-effective">effective · {EFFECTIVE_DATE}</p>
            </div>
          </div>
        </div>
      </div>

      <section className="how legal-toc">
        <div className="how-inner">
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

      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="how legal-section">
          <div className="how-inner">
            <h2 className="legal-section-title">{s.title}</h2>
            <div className="legal-body">{s.body}</div>
          </div>
        </section>
      ))}

      <Footer />
    </div>
  );
}

export const Component = PrivacyPolicyPage;
