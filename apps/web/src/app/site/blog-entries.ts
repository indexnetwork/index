import { useCallback, useEffect, useState } from "react";
import { type BlogPost, fetchAllPosts } from "@/lib/blog";

/** A row in the blog index: a markdown post or a standalone page. */
export type BlogEntry = {
  href: string;
  date: string;
  title: string;
  summary?: string;
};

/** Essays that live on their own route but belong in the blog index. */
const EXTERNAL_ENTRIES: BlogEntry[] = [
  {
    href: "/found-in-translation",
    date: "2026-04-01",
    title: "Found in Translation",
    summary:
      "Some things find you, but most don't. Language has become the new interface, and agents are becoming our calling cards.",
  },
];

function toEntry(post: BlogPost): BlogEntry {
  return {
    href: `/blog/${post.slug}`,
    date: post.date,
    title: post.title,
    summary: post.description?.trim(),
  };
}

/** Blog index state: `entries` is `null` while loading; `failed` when the post index didn't load. */
export function useBlogIndex(): { entries: BlogEntry[] | null; failed: boolean; retry: () => void } {
  const [entries, setEntries] = useState<BlogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchAllPosts()
      .then((posts) => ({ posts, ok: true }))
      .catch(() => ({ posts: [] as BlogPost[], ok: false }))
      .then(({ posts, ok }) => {
        if (cancelled) return;
        // External essays still render when the post index fails; the page flags the gap.
        const all = [...posts.map(toEntry), ...EXTERNAL_ENTRIES];
        all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setEntries(all);
        setFailed(!ok);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setEntries(null);
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  return { entries, failed, retry };
}

/** Newest-first entries; `null` while loading. */
export function useBlogEntries(): BlogEntry[] | null {
  return useBlogIndex().entries;
}

/** "JUL 29, 2026" */
export function formatEntryDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" })
    .toUpperCase();
}
