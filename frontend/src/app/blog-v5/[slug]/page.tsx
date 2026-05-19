import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import ReactMarkdown, { type Components } from "react-markdown";
import { visit } from "unist-util-visit";
import type { Root } from "hast";
import Nav, { ensureLandingV5Fonts } from "@/app/landing-v5/Nav";
import Footer from "@/app/landing-v5/Footer";
import { type BlogPost, getPostBySlug } from "@/lib/blog";
import "@/app/landing-v5/landing-v5.css";
import "../blog-v5.css";

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
};

type PostState =
  | { kind: "loading" }
  | { kind: "ready"; post: BlogPost }
  | { kind: "not_found" };

function BlogV5PostPage() {
  const { slug } = useParams();
  const [state, setState] = useState<PostState>({ kind: "loading" });

  useEffect(() => {
    ensureLandingV5Fonts();
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
    <div className="landing-v5 blog-v5 blog-post">
      <header className="blog-nav-wrap">
        <Nav />
      </header>

      <article className="post-frame">
        <Link className="post-back" to="/blog-v5">
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

export default BlogV5PostPage;
export const Component = BlogV5PostPage;
