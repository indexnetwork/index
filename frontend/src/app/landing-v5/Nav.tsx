import { useEffect, useState } from "react";
import { Link } from "react-router";

const GH_REPO = "indexnetwork/index";
const GH_STARS_CACHE_KEY = "indexnetwork:gh-stars";
const GH_STARS_TTL_MS = 5 * 60 * 1000;

function formatStars(n: number): string {
  if (n >= 1000) {
    return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  }
  return n.toString();
}

function useGithubStars(): number | null {
  const [stars, setStars] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem(GH_STARS_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { value: number; ts: number };
      if (Date.now() - parsed.ts < GH_STARS_TTL_MS) return parsed.value;
    } catch {
      /* ignore */
    }
    return null;
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`https://api.github.com/repos/${GH_REPO}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data || typeof data.stargazers_count !== "number")
          return;
        setStars(data.stargazers_count);
        try {
          window.sessionStorage.setItem(
            GH_STARS_CACHE_KEY,
            JSON.stringify({ value: data.stargazers_count, ts: Date.now() }),
          );
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* keep cached/null */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return stars;
}

export function GithubStar({ className = "gh-star" }: { className?: string }) {
  const stars = useGithubStars();
  return (
    <a
      className={className}
      href="https://github.com/indexnetwork/index"
      target="_blank"
      rel="noreferrer"
      aria-label="Star Index Network on GitHub"
    >
      <svg
        className="gh-icon"
        viewBox="0 0 16 16"
        width="16"
        height="16"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          fill="currentColor"
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
        />
      </svg>
      <svg
        className="gh-star-icon"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M8 1.2l1.94 4.07 4.46.59-3.28 3.07.84 4.41L8 11.27 4.04 13.34l.84-4.41L1.6 5.86l4.46-.59L8 1.2z"
        />
      </svg>
      {stars !== null && <span className="gh-count">{formatStars(stars)}</span>}
    </a>
  );
}

export default function Nav() {
  return (
    <nav className="nav" aria-label="primary">
      <Link className="logo" to="/" aria-label="Index Network">
        <img src="/landing-v5/index-wordmark.svg" alt="Index Network" />
      </Link>
      <div className="right">
        <Link className="link" to="/blog">Blog</Link>
        <Link className="link" to="/about">About</Link>
        <GithubStar />
        <button
          type="button"
          className="nav-subscribe"
          onClick={() => window.dispatchEvent(new Event("openSubscribeModal"))}
        >
          Subscribe
        </button>
      </div>
    </nav>
  );
}

export function ensureLandingV5Fonts() {
  if (typeof document === "undefined") return;
  const fontHref =
    "https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Public+Sans:wght@300;400;500;600&display=swap";
  if (document.querySelector(`link[href="${fontHref}"]`)) return;

  const preconnect1 = document.createElement("link");
  preconnect1.rel = "preconnect";
  preconnect1.href = "https://fonts.googleapis.com";
  const preconnect2 = document.createElement("link");
  preconnect2.rel = "preconnect";
  preconnect2.href = "https://fonts.gstatic.com";
  preconnect2.crossOrigin = "";
  const font = document.createElement("link");
  font.rel = "stylesheet";
  font.href = fontHref;
  document.head.append(preconnect1, preconnect2, font);
}
