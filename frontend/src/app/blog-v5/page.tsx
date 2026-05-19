import { useEffect, useState } from "react";
import { Link } from "react-router";
import Nav, { ensureLandingV5Fonts } from "@/app/landing-v5/Nav";
import { type BlogPost, getAllPosts } from "@/lib/blog";
import "@/app/landing-v5/landing-v5.css";
import "./blog-v5.css";

function formatPostDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" })
    .toUpperCase();
}

function BlogV5IndexPage() {
  const [posts, setPosts] = useState<BlogPost[] | null>(null);

  useEffect(() => {
    ensureLandingV5Fonts();
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAllPosts()
      .then((all) => {
        if (!cancelled) setPosts(all);
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="landing-v5 blog-v5">
      <header className="blog-nav-wrap">
        <Nav />
      </header>

      <section className="blog-hero">
        <div className="blog-inner">
          <div className="eyebrow">
            <span className="dot-g" aria-hidden="true" />
            <span>section · journal</span>
          </div>
          <h1 className="display blog-display">Letters from Index</h1>
          <p className="blog-lede">
            Notes from inside the protocol — what we&rsquo;re building, what
            we&rsquo;re reading, who we&rsquo;re finding.
          </p>
        </div>
      </section>

      <section className="how blog-list-section">
        <div className="how-inner">
          <div className="how-head">
            <span className="title">
              <span className="arrow">›</span>all posts
            </span>
            <span className="meta">
              {posts === null ? "loading…" : `${posts.length} entries`}
            </span>
          </div>

          <div className="log">
            {posts === null ? (
              <div className="comment">
                <span className="hash">#</span>loading…
              </div>
            ) : posts.length === 0 ? (
              <div className="comment">
                <span className="hash">#</span>no posts yet. check back soon.
              </div>
            ) : (
              posts.map((p) => (
                <Link
                  className="blog-row"
                  to={`/blog-v5/${p.slug}`}
                  key={p.slug}
                  aria-label={p.title}
                >
                  <span className="blog-date">{formatPostDate(p.date)}</span>
                  <span className="blog-title">{p.title}</span>
                  <span className="spacer" aria-hidden="true" />
                  <span className="blog-arrow">→</span>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default BlogV5IndexPage;
export const Component = BlogV5IndexPage;
