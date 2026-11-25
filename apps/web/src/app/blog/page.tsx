import { Link } from "react-router";
import SiteLayout from "@/app/site/SiteLayout";
import NewsletterForm from "@/app/site/NewsletterForm";
import { formatEntryDate, useBlogIndex } from "@/app/site/blog-entries";
import { Placeholder } from "@/components/ui/Placeholder";

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
            <Placeholder.Rows count={4} avatar={false} sub={false} label="loading posts" />
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
        <div className="site-newsletter-block">
          <h2 className="site-col-title">Letters from Index</h2>
          <NewsletterForm />
        </div>
      </section>
    </SiteLayout>
  );
}

export default BlogIndexPage;
export const Component = BlogIndexPage;
