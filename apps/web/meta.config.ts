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
  "/overview": {
    title: "Index Network: Protocol Overview",
    description:
      "Index Network is a private, intent-driven social discovery protocol.",
    image: DEFAULT_IMAGE,
    type: "website",
  },
};

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
