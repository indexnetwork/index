import { useEffect, useState } from "react";
import { type BlogPost, getAllPosts } from "@/lib/blog";

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

/** Newest-first entries; `null` while loading. */
export function useBlogEntries(): BlogEntry[] | null {
  const [entries, setEntries] = useState<BlogEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAllPosts()
      .catch(() => [] as BlogPost[])
      .then((posts) => {
        if (cancelled) return;
        const all = [...posts.map(toEntry), ...EXTERNAL_ENTRIES];
        all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setEntries(all);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return entries;
}

/** "JUL 29, 2026" */
export function formatEntryDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" })
    .toUpperCase();
}
