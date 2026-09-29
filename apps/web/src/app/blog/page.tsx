import { Link } from "react-router";
import SiteLayout from "@/app/site/SiteLayout";
import { formatEntryDate, useBlogEntries } from "@/app/site/blog-entries";

function BlogIndexPage() {
  const entries = useBlogEntries();

  return (
    <SiteLayout>
      <section className="site-hero">
        <h1 className="site-h1">Field notes from Index</h1>
        <p className="site-p">Writing on intent-driven discovery, agents, and finding your others.</p>
        <div className="site-post-index">
          {entries === null ? (
            <div className="site-post-row" aria-busy="true">
              <span className="site-meta">loading…</span>
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
