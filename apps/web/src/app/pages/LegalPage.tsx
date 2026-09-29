import type { ReactNode } from "react";
import SiteLayout from "@/app/site/SiteLayout";
import "./privacy-policy/legal.css";

export type LegalSection = {
  id: string;
  title: string;
  body: ReactNode;
};

/** Privacy and Terms: title, lede, numbered contents, then each section. */
export default function LegalPage({
  title,
  lede,
  sections,
}: {
  title: string;
  lede: string;
  sections: LegalSection[];
}) {
  return (
    <SiteLayout className="legal">
      <section className="site-hero">
        <h1 className="site-h1">{title}</h1>
        <p className="site-p">{lede}</p>
        <ol className="legal-toc-list">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>
                <span className="legal-toc-num">{String(i + 1).padStart(2, "0")}</span>
                <span className="legal-toc-title">{s.title}</span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      {sections.map((s) => (
        <section key={s.id} id={s.id} className="legal-section">
          <h2 className="site-col-title legal-section-title">{s.title}</h2>
          <div className="legal-body">{s.body}</div>
        </section>
      ))}
    </SiteLayout>
  );
}
