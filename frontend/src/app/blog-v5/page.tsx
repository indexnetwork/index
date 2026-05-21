import { useEffect, useState } from "react";
import { Link } from "react-router";
import Nav, { ensureLandingV5Fonts } from "@/app/landing-v5/Nav";
import Footer from "@/app/landing-v5/Footer";
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

type ExternalEntry = {
  kind: "external";
  href: string;
  date: string;
  title: string;
};

const EXTERNAL_ENTRIES: ExternalEntry[] = [
  {
    kind: "external",
    href: "/found-in-translation",
    date: "2026-04-01",
    title: "Found in Translation",
  },
];

function mergeEntries(
  posts: BlogPost[],
  extras: ExternalEntry[],
): Array<BlogPost | ExternalEntry> {
  const combined: Array<BlogPost | ExternalEntry> = [...posts, ...extras];
  return combined.sort((a, b) => {
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    return tb - ta;
  });
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
      <div className="hero h1 page-hero">
        <div className="canvas-area">
          <Nav />
          <div className="hero-split">
            <div className="well">
              <h1 className="display">Letters from Index</h1>
              <p className="body-italic">
                Notes from inside the protocol — what we&rsquo;re building,
                what we&rsquo;re reading, who we&rsquo;re finding.
              </p>
            </div>
          </div>
        </div>
      </div>

      <section className="how blog-list-section">
        <div className="how-inner">
          <div className="how-head">
            <span className="title">
              <span className="arrow">›</span>all posts
            </span>
          </div>

          <div className="log">
            {posts === null ? (
              <div className="comment">
                <span className="hash">#</span>loading…
              </div>
            ) : (
              [...mergeEntries(posts, EXTERNAL_ENTRIES)].map((entry) =>
                "kind" in entry ? (
                  <Link
                    className="blog-row"
                    to={entry.href}
                    key={`ext:${entry.href}`}
                    aria-label={entry.title}
                  >
                    <span className="blog-date">{formatPostDate(entry.date)}</span>
                    <span className="blog-title">{entry.title}</span>
                    <span className="spacer" aria-hidden="true" />
                    <span className="blog-arrow">→</span>
                  </Link>
                ) : (
                  <Link
                    className="blog-row"
                    to={`/blog-v5/${entry.slug}`}
                    key={entry.slug}
                    aria-label={entry.title}
                  >
                    <span className="blog-date">{formatPostDate(entry.date)}</span>
                    <span className="blog-title">{entry.title}</span>
                    <span className="spacer" aria-hidden="true" />
                    <span className="blog-arrow">→</span>
                  </Link>
                ),
              )
            )}
          </div>

        </div>
      </section>

      <Footer />
    </div>
  );
}

export default BlogV5IndexPage;
export const Component = BlogV5IndexPage;
