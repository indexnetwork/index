import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface PageMeta {
  title: string;
  description: string;
  image: string;
  type?: string;
}

export const ORIGIN = process.env.WEB_APP_URL || "https://index.network";
const DEFAULT_IMAGE = `${ORIGIN}/link-preview.png`;

const MARKETING: Record<string, PageMeta> = {
  "/found-in-translation": {
    title: "Found in Translation | Index Network",
    description:
      "Some things find you. Most don't. That is, until language became our new interface and agents became our calling cards.",
    image: `${ORIGIN}/found-in-translation/found-in-translation-1-hero.png`,
    type: "article",
  },
  "/download": {
    title: "Download Index for macOS",
    description:
      "Get the Index macOS app. Opportunity links open directly in the app, where you can review and accept them.",
    image: DEFAULT_IMAGE,
    type: "website",
  },
  "/overview": {
    title: "Index Network: Protocol Overview",
    description:
      "Index Network is a private, intent-driven social discovery protocol.",
    image: DEFAULT_IMAGE,
    type: "website",
  },
  "/protocol": {
    title: "Index Network: Protocol Overview",
    description:
      "Index Network is a private, intent-driven social discovery protocol.",
    image: DEFAULT_IMAGE,
    type: "website",
  },
};

/**
 * Prefix-matched meta for dynamic deep-link routes. Ids/codes cannot be
 * enumerated into the exact-match map, so document navigations to these
 * paths resolve by prefix instead. (`/u/:id` is intentionally absent: it
 * keeps its real profile-page meta/behavior.)
 */
const DEEP_LINK_PREFIXES: Record<string, PageMeta> = {
  "/c/": {
    title: "Open in the Index app",
    description:
      "This Index link opens in the Index macOS app. Install the app or open this link on your Mac.",
    image: DEFAULT_IMAGE,
    type: "website",
  },
  "/o/": {
    title: "Open in the Index app",
    description:
      "This Index opportunity link opens in the Index macOS app. Install the app or open this link on your Mac.",
    image: DEFAULT_IMAGE,
    type: "website",
  },
};

export function resolvePageMeta(
  map: Record<string, PageMeta>,
  pathname: string,
): PageMeta | undefined {
  const exact = map[pathname];
  if (exact) return exact;
  for (const [prefix, meta] of Object.entries(DEEP_LINK_PREFIXES)) {
    if (pathname.startsWith(prefix)) return meta;
  }
  return undefined;
}

export function buildMetaMap(distDir: string): Record<string, PageMeta> {
  const map: Record<string, PageMeta> = { ...MARKETING };

  const postsPath = join(distDir, "blog", "posts.json");
  if (existsSync(postsPath)) {
    const posts: { slug: string; title: string; description?: string; image?: string }[] =
      JSON.parse(readFileSync(postsPath, "utf-8"));

    for (const p of posts) {
      map[`/blog/${p.slug}`] = {
        title: `${p.title} — Index Network`,
        description: p.description || "",
        image: p.image ? `${ORIGIN}${p.image}` : DEFAULT_IMAGE,
        type: "article",
      };
    }
  }

  return map;
}
