import { useEffect, useState } from "react";
import { Link } from "react-router";
import Nav, { ensureLandingFonts } from "@/app/landing/Nav";
import Footer from "@/app/landing/Footer";
import { type BlogPost, getAllPosts } from "@/lib/blog";
import "@/app/landing/landing.css";
import "./blog.css";

function formatPostDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" })
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

function BlogIndexPage() {
  const [posts, setPosts] = useState<BlogPost[] | null>(null);

  useEffect(() => {
    ensureLandingFonts();
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
    <div className="landing blog">
      <div className="hero h1 page-hero">
        <div className="canvas-area">
          <Nav />
          <div className="hero-split">
            <div className="well">
              <h1 className="display">Field notes from Index</h1>
            </div>
          </div>
        </div>
      </div>

      <section className="how blog-list-section">
        <div className="how-inner">
          <div className="how-head">
            <span className="title">
              <span className="arrow">›</span>notes
            </span>
          </div>

          <div className="log">
            {posts === null ? (
              <div className="comment">
                <span className="hash">#</span>loading…
              </div>
            ) : (
              mergeEntries(posts, EXTERNAL_ENTRIES).map((entry) => {
                const isExternal = "kind" in entry;
                const to = isExternal ? entry.href : `/blog/${entry.slug}`;
                const key = isExternal ? `ext:${entry.href}` : entry.slug;
                return (
                  <Link
                    className="blog-row"
                    to={to}
                    key={key}
                    aria-label={entry.title}
                  >
                    <span className="blog-date">{formatPostDate(entry.date)}</span>
                    <span className="blog-title">{entry.title}</span>
                    <span className="blog-arrow">→</span>
                  </Link>
                );
              })
            )}
          </div>

        </div>
      </section>

      <Footer />
    </div>
  );
}

export default BlogIndexPage;
export const Component = BlogIndexPage;
