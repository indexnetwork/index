import { isValidElement, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import type { Root } from "hast";
import Nav, { ensureLandingFonts } from "@/app/landing/Nav";
import Footer from "@/app/landing/Footer";
import { type BlogPost, getPostBySlug } from "@/lib/blog";
import "@/app/landing/landing.css";
import "../blog.css";

function getAudioType(src: string): string {
  const ext = src.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp3": return "audio/mpeg";
    case "wav": return "audio/wav";
    case "ogg": return "audio/ogg";
    case "m4a": return "audio/mp4";
    case "aac": return "audio/aac";
    default:    return "audio/mpeg";
  }
}

function getYouTubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?]+)/);
  return match ? match[1] : null;
}

function unwrapImages() {
  return (tree: Root) => {
    visit(tree, "element", (node, index, parent) => {
      if (
        node.tagName === "p" &&
        parent &&
        typeof index === "number" &&
        node.children.length === 1 &&
        node.children[0].type === "element" &&
        node.children[0].tagName === "img"
      ) {
        parent.children[index] = node.children[0];
      }
    });
  };
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/** Cells drawn entirely out of block glyphs are text bar charts, not prose. */
const BAR_CELL = /^[▀-▟\s]+$/;

/** Eighth-block glyphs, in width order — U+2588 is a full cell, U+258F is 1/8. */
const BAR_UNITS: Record<string, number> = {
  "█": 1, "▉": 7 / 8, "▊": 6 / 8, "▋": 5 / 8,
  "▌": 4 / 8, "▍": 3 / 8, "▎": 2 / 8, "▏": 1 / 8,
};

function barUnits(text: string): number {
  return [...text].reduce((sum, ch) => sum + (BAR_UNITS[ch] ?? 0), 0);
}

/**
 * Block glyphs don't tile into a solid bar at body sizes — the font leaves a
 * subpixel gap between cells. Draw the bar instead, sized from the same glyph
 * count the author typed. Decorative: the adjacent column carries the value.
 */
function BarCell({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <td className="cell-bar" style={style}>
      <span
        className="bar"
        style={{ "--bar-units": barUnits(text) } as CSSProperties}
        aria-hidden="true"
      />
    </td>
  );
}

function cellClass(children: ReactNode): string | undefined {
  const text = textOf(children).trim();
  return text && BAR_CELL.test(text) ? "cell-bar" : undefined;
}

const markdownComponents: Components = {
  a: ({ href, children }) => {
    const text = typeof children === "string"
      ? children
      : Array.isArray(children) ? children.join("") : "";

    if (text.toLowerCase() === "audio" && href) {
      return (
        <div className="embed-audio">
          <audio controls preload="metadata">
            <source src={href} type={getAudioType(href)} />
            Your browser does not support the audio element.
          </audio>
        </div>
      );
    }

    if (text.toLowerCase() === "video" && href) {
      return (
        <div className="embed-video">
          <video src={href} autoPlay muted loop playsInline />
        </div>
      );
    }

    if (text.toLowerCase() === "youtube" && href) {
      const videoId = getYouTubeVideoId(href);
      if (videoId) {
        return (
          <div className="embed-youtube">
            <iframe
              src={`https://www.youtube.com/embed/${videoId}`}
              title="YouTube video player"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        );
      }
    }

    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
  img: ({ src, alt }) => {
    if (!src || typeof src !== "string") return null;
    const [altText] = (alt || "").split("|").map((s) => s.trim());
    return <img src={src} alt={altText || ""} loading="lazy" />;
  },
  table: ({ children }) => (
    <div className="post-table">
      <table>{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th className={cellClass(children)} style={style}>{children}</th>
  ),
  td: ({ children, style }) => {
    const text = textOf(children).trim();
    if (text && BAR_CELL.test(text)) return <BarCell text={text} style={style} />;
    return <td style={style}>{children}</td>;
  },
};

type PostState =
  | { kind: "loading" }
  | { kind: "ready"; post: BlogPost }
  | { kind: "not_found" };

function BlogPostPage() {
  const { slug } = useParams();
  const [state, setState] = useState<PostState>({ kind: "loading" });

  useEffect(() => {
    ensureLandingFonts();
  }, []);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    getPostBySlug(slug).then((result) => {
      if (cancelled) return;
      setState(result ? { kind: "ready", post: result } : { kind: "not_found" });
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <div className="landing blog blog-post">
      <div className="hero h1 page-hero post-nav-only">
        <div className="canvas-area">
          <Nav />
        </div>
      </div>

      <article className="post-frame">
        <Link className="post-back" to="/blog">
          ← back to all posts
        </Link>

        {state.kind === "loading" ? (
          <div className="post-status">loading…</div>
        ) : state.kind === "not_found" ? (
          <div className="post-status">post not found.</div>
        ) : (
          <>
            <div className="post-meta">
              {new Date(state.post.date).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </div>
            <h1 className="post-title">{state.post.title}</h1>
            <hr className="post-divider" />
            <div className="post-body">
              <ReactMarkdown
                components={markdownComponents}
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[unwrapImages]}
              >
                {state.post.content || ""}
              </ReactMarkdown>
            </div>
          </>
        )}
      </article>

      <Footer />
    </div>
  );
}

export default BlogPostPage;
export const Component = BlogPostPage;
