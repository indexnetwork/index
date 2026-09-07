import { readdirSync, readFileSync, mkdirSync, cpSync, writeFileSync, existsSync } from "fs";
import { join, extname } from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ORIGIN } from "./meta.config";
import { parseFrontmatter, transformAssetPaths } from "./src/lib/blog";

const CONTENT_DIR = join(import.meta.dir, "content/blog");
const PUBLIC_DIR = join(import.meta.dir, "public");
const OUTPUT_DIR = join(PUBLIC_DIR, "blog");
const DEFAULT_IMAGE = `${ORIGIN}/link-preview.png`;

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Public+Sans:wght@300;400;500;600&display=swap";

/** Non-markdown entries the blog index lists alongside the posts. */
const EXTERNAL_ENTRIES = [
  { href: "/found-in-translation", date: "2026-04-01", title: "Found in Translation" },
];

/** Step headlines mirrored from the landing page, for the no-JS home fragment. */
const HOME_STEPS = [
  "You share what you're working toward",
  "Your agent reads it and fills in the gaps",
  "Agents negotiate across the network",
  "The right people surface",
  "Your next opportunity arrives ambiently",
];

interface PostEntry {
  slug: string;
  title: string;
  date: string;
  description?: string;
  image?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatListDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date
    .toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" })
    .toUpperCase();
}

function formatPostDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

const STYLES = `
:root {
  --bg: #14241f;
  --bg-deep: #0b1612;
  --cream: #F4FBF6;
  --cream-soft: rgba(244, 251, 246, 0.78);
  --cream-faint: rgba(244, 251, 246, 0.5);
  --rule: rgba(244, 251, 246, 0.22);
  --rule-strong: rgba(244, 251, 246, 0.45);
  --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--cream);
  font-family: 'Public Sans', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
img { display: block; max-width: 100%; }
a { color: inherit; }
.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 56px;
  border-bottom: 1px solid var(--rule);
  font-family: var(--mono);
}
.nav img { height: 20px; width: auto; }
.nav-links { display: flex; gap: 26px; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; }
.nav-links a { text-decoration: none; color: var(--cream-soft); }
.nav-links a:hover { color: var(--cream); }
.frame { max-width: 720px; margin: 0 auto; padding: 72px 32px 96px; }
.back {
  display: inline-block;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--cream-soft);
  text-decoration: none;
  margin-bottom: 40px;
}
.display, .post-title {
  font-family: var(--mono);
  font-weight: 700;
  letter-spacing: -0.02em;
  font-size: 40px;
  line-height: 1.08;
  margin: 0 0 48px;
}
.post-meta {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--cream-faint);
  margin-bottom: 18px;
}
.post-body { font-size: 17px; line-height: 1.7; color: var(--cream-soft); }
.post-body p { margin: 0 0 22px; }
.post-body strong { color: var(--cream); font-weight: 600; }
.post-body h2 { font-family: var(--mono); font-size: 22px; color: var(--cream); margin: 44px 0 14px; }
.post-body h3 { font-family: var(--mono); font-size: 17px; color: var(--cream); margin: 36px 0 12px; }
.post-body a { color: var(--cream); text-decoration: none; border-bottom: 1px solid var(--rule-strong); }
.post-body ul, .post-body ol { margin: 0 0 22px; padding-left: 22px; }
.post-body li { margin-bottom: 8px; }
.post-body img { width: 100%; height: auto; border: 1px solid var(--rule); margin: 8px 0 24px; }
.post-body blockquote {
  border-left: 2px solid var(--rule-strong);
  padding: 4px 0 4px 18px;
  margin: 0 0 24px;
  color: var(--cream);
  font-style: italic;
}
.post-body code {
  font-family: var(--mono);
  font-size: 13px;
  background: rgba(244, 251, 246, 0.08);
  color: var(--cream);
  padding: 2px 6px;
}
.post-body pre {
  background: var(--bg-deep);
  border: 1px solid var(--rule);
  padding: 18px 20px;
  overflow-x: auto;
  margin: 0 0 24px;
  font-size: 13px;
}
.post-body pre code { background: transparent; padding: 0; }
.post-body table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--cream-soft);
  margin: 0 0 26px;
}
.post-body th {
  text-align: left;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--cream-faint);
  padding: 0 18px 10px 0;
  border-bottom: 1px solid var(--rule-strong);
}
.post-body td { padding: 12px 18px 12px 0; border-bottom: 1px dashed var(--rule); }
.rows { border-top: 1px solid var(--rule); }
.row {
  display: flex;
  align-items: baseline;
  gap: 20px;
  padding: 18px 0;
  border-bottom: 1px solid var(--rule);
  font-family: var(--mono);
  text-decoration: none;
}
.row-date { font-size: 11px; letter-spacing: 0.12em; color: var(--cream-faint); white-space: nowrap; }
.row-title { font-size: 15px; color: var(--cream); }
.row-arrow { margin-left: auto; color: var(--cream-faint); }
.foot {
  border-top: 1px solid var(--rule);
  padding: 28px 56px 40px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--cream-faint);
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  justify-content: space-between;
}
.foot a { color: var(--cream-soft); text-decoration: none; margin-right: 18px; }
@media (max-width: 720px) {
  .nav, .foot { padding-left: 22px; padding-right: 22px; }
  .frame { padding: 48px 22px 72px; }
  .display, .post-title { font-size: 30px; }
}
`.trim();

const NAV = `
<header class="nav">
  <a href="/" aria-label="Index Network"><img src="/landing/index-wordmark.svg" alt="Index Network" /></a>
  <nav class="nav-links">
    <a href="/blog">Blog</a>
    <a href="/about">About</a>
  </nav>
</header>`.trim();

const FOOT = `
<footer class="foot">
  <div>
    <a href="/">Home</a><a href="/blog">Blog</a><a href="/about">About</a><a href="/pages/privacy-policy">Privacy</a><a href="/pages/terms-of-use">Terms</a>
  </div>
  <div>
    <a href="https://github.com/indexnetwork/index">GitHub</a><a href="mailto:hello@index.network">hello@index.network</a>
  </div>
</footer>`.trim();

function renderDocument(options: {
  title: string;
  description: string;
  path: string;
  image: string;
  type: string;
  body: string;
}): string {
  const title = escapeHtml(options.title);
  const description = escapeHtml(options.description);
  const url = `${ORIGIN}${options.path}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${url}" />
    <link rel="icon" type="image/png" href="/favicon-white.png" />
    <meta property="og:type" content="${options.type}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${escapeHtml(options.image)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${escapeHtml(options.image)}" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="${FONTS_HREF}" />
    <style>${STYLES}</style>
  </head>
  <body>
    ${NAV}
    ${options.body}
    ${FOOT}
  </body>
</html>
`;
}

function renderRows(entries: Array<{ href: string; date: string; title: string }>): string {
  return entries
    .map(
      (entry) => `      <a class="row" href="${entry.href}">
        <span class="row-date">${escapeHtml(formatListDate(entry.date))}</span>
        <span class="row-title">${escapeHtml(entry.title)}</span>
        <span class="row-arrow">&rarr;</span>
      </a>`,
    )
    .join("\n");
}

function listEntries(posts: PostEntry[]): Array<{ href: string; date: string; title: string }> {
  return [
    ...posts.map((post) => ({ href: `/blog/${post.slug}`, date: post.date, title: post.title })),
    ...EXTERNAL_ENTRIES,
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function renderPostPage(post: PostEntry, markdown: string): string {
  const body = renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown),
  );

  return renderDocument({
    title: `${post.title} — Index Network`,
    description: post.description || "",
    path: `/blog/${post.slug}`,
    image: post.image ? `${ORIGIN}${post.image}` : DEFAULT_IMAGE,
    type: "article",
    body: `<main class="frame">
      <a class="back" href="/blog">&larr; back to all posts</a>
      <div class="post-meta">${escapeHtml(formatPostDate(post.date))}</div>
      <h1 class="post-title">${escapeHtml(post.title)}</h1>
      <div class="post-body">${body}</div>
    </main>`,
  });
}

function renderIndexPage(posts: PostEntry[]): string {
  return renderDocument({
    title: "Field notes from Index | Index Network",
    description: "Writing from Index Network on intent-driven discovery, agents, and finding your others.",
    path: "/blog",
    image: DEFAULT_IMAGE,
    type: "website",
    body: `<main class="frame">
      <h1 class="display">Field notes from Index</h1>
      <div class="rows">
${renderRows(listEntries(posts))}
      </div>
    </main>`,
  });
}

/**
 * Marketing fragment injected into the SPA shell's `<noscript>` on `/`. The
 * root route also renders the signed-in app, so this cannot be a static page.
 */
function renderHomeFragment(posts: PostEntry[]): string {
  const latest = listEntries(posts).slice(0, 3);

  return `<style>
.nojs { max-width: 720px; margin: 0 auto; padding: 64px 24px; font-family: 'Public Sans', system-ui, sans-serif; color: #14241f; }
.nojs h1 { font-size: 34px; line-height: 1.1; margin: 0 0 16px; }
.nojs h2 { font-size: 13px; letter-spacing: 0.16em; text-transform: uppercase; margin: 40px 0 12px; }
.nojs p { font-size: 17px; line-height: 1.6; }
.nojs li { margin-bottom: 8px; line-height: 1.5; }
</style>
<div class="nojs">
  <h1>Wake up to your next idea partner</h1>
  <p>Have your agent surface the right people for you, before you even think to look.</p>
  <h2>How it works</h2>
  <ol>
${HOME_STEPS.map((step) => `    <li>${escapeHtml(step)}</li>`).join("\n")}
  </ol>
  <h2>Field notes</h2>
  <ul>
${latest.map((entry) => `    <li><a href="${entry.href}">${escapeHtml(entry.title)}</a></li>`).join("\n")}
  </ul>
  <p>
    <a href="/blog">All posts</a> &middot;
    <a href="/about">About</a> &middot;
    <a href="https://github.com/indexnetwork/index">GitHub</a> &middot;
    <a href="mailto:hello@index.network">hello@index.network</a>
  </p>
</div>`;
}

mkdirSync(OUTPUT_DIR, { recursive: true });

const slugs = readdirSync(CONTENT_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const posts: PostEntry[] = [];

const mediaExtensions = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif",
  ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac",
  ".mp4", ".webm",
]);

for (const slug of slugs) {
  const postDir = join(CONTENT_DIR, slug);
  const indexPath = join(postDir, "index.md");
  if (!existsSync(indexPath)) continue;

  const raw = readFileSync(indexPath, "utf-8");
  const { data, content } = parseFrontmatter(raw);

  const post: PostEntry = {
    slug,
    title: data.title || slug,
    date: data.date || "",
    description: data.description,
    image: data.image ? `/blog/${slug}/${data.image}` : undefined,
  };
  posts.push(post);

  // Copy ALL files from post directory to public/blog/{slug}/
  const outDir = join(OUTPUT_DIR, slug);
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(postDir);
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (mediaExtensions.has(ext) || ext === ".md") {
      cpSync(join(postDir, file), join(outDir, file));
    }
  }

  writeFileSync(
    join(outDir, "index.html"),
    renderPostPage(post, transformAssetPaths(content, slug)),
  );
}

posts.sort((a, b) => {
  const dateA = a.date ? new Date(a.date).getTime() : 0;
  const dateB = b.date ? new Date(b.date).getTime() : 0;
  return dateB - dateA;
});
writeFileSync(join(OUTPUT_DIR, "posts.json"), JSON.stringify(posts, null, 2));
writeFileSync(join(OUTPUT_DIR, "index.html"), renderIndexPage(posts));
writeFileSync(join(PUBLIC_DIR, "noscript-home.html"), renderHomeFragment(posts));
console.log(`Built ${posts.length} blog posts to ${OUTPUT_DIR}`);
