import { useEffect, useState } from "react";
import { GITHUB_URL } from "./links";

const CACHE_KEY = "indexnetwork:gh-stars";
const TTL_MS = 5 * 60 * 1000;

function formatStars(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

/** Star action plus the live count, in the GitHub button pattern. Cached for five minutes. */
export default function GithubStars() {
  const [stars, setStars] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { value: number; ts: number };
      if (Date.now() - parsed.ts < TTL_MS) return parsed.value;
    } catch {
      /* ignore */
    }
    return null;
  });

  useEffect(() => {
    let cancelled = false;
    fetch("https://api.github.com/repos/indexnetwork/index")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data || typeof data.stargazers_count !== "number") return;
        setStars(data.stargazers_count);
        try {
          window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ value: data.stargazers_count, ts: Date.now() }));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* keep cached or empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <a className="site-github" href={GITHUB_URL} target="_blank" rel="noreferrer">
      <span className="site-github-star">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter" aria-hidden="true">
          <polygon points="12 2.5 14.9 8.6 21.5 9.4 16.6 14 17.9 20.6 12 17.3 6.1 20.6 7.4 14 2.5 9.4 9.1 8.6" />
        </svg>
        Star
      </span>
      {stars !== null && <span className="site-github-count">{formatStars(stars)}</span>}
    </a>
  );
}
