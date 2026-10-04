import { Link } from "react-router";
import SiteLayout from "@/app/site/SiteLayout";
import { formatEntryDate, useBlogIndex } from "@/app/site/blog-entries";

function BlogIndexPage() {
  const { entries, failed, retry } = useBlogIndex();

  return (
    <SiteLayout>
      <section className="site-hero">
        <h1 className="site-h1">Field notes from Index</h1>
        <p className="site-p">Writing on intent-driven discovery, agents, and finding your others.</p>
        {failed && (
          <div role="alert" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 16, margin: "0 0 20px" }}>
            <span className="site-p" style={{ margin: 0 }}>Couldn&apos;t load the latest posts.</span>
            <button type="button" className="site-btn site-btn--secondary" onClick={retry}>Try again</button>
          </div>
        )}
        <div className="site-post-index">
          {entries === null ? (
            <div className="site-post-row" aria-busy="true">
              <span className="site-meta">Loading…</span>
            </div>
          ) : (
            entries.map((entry) => (
              <Link className="site-post-row" to={entry.href} key={entry.href}>
                <span className="site-meta">{formatEntryDate(entry.date)}</span>
                <span className="site-post-row-title">{entry.title}</span>
                <span className="site-post-row-arrow" aria-hidden="true">→</span>
              </Link>
            ))
          )}
        </div>
      </section>
    </SiteLayout>
  );
}

export default BlogIndexPage;
export const Component = BlogIndexPage;
