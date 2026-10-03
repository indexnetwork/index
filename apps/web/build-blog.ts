import { readdirSync, readFileSync, mkdirSync, cpSync, writeFileSync, existsSync } from "fs";
import { join, extname } from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ORIGIN } from "./meta.config";
import type { LegalSection } from "./src/app/pages/LegalPage";
import * as privacyPolicy from "./src/app/pages/privacy-policy/page";
import * as termsOfUse from "./src/app/pages/terms-of-use/page";
import { parseFrontmatter, transformAssetPaths } from "./src/lib/blog";

const CONTENT_DIR = join(import.meta.dir, "content/blog");
const PUBLIC_DIR = join(import.meta.dir, "public");
const OUTPUT_DIR = join(PUBLIC_DIR, "blog");
const DEFAULT_IMAGE = `${ORIGIN}/link-preview.png`;

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;1,8..60,400&family=Public+Sans:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400&display=swap";

/** Non-markdown entries the blog index lists alongside the posts. */
const EXTERNAL_ENTRIES = [
  { href: "/found-in-translation", date: "2026-04-01", title: "Found in Translation" },
];

/** Step headlines mirrored from the landing page, for the no-JS home fragment. */
const HOME_STEPS = ["Intent creation", "Discovery + negotiation", "Outcome + learning"];

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

/** Mirrors src/app/site/site.css and src/app/blog/blog.css for the no-JS pages. */
const STYLES = `
:root {
  --ink: #041729;
  --bg: #FCFEFB;
  --body: #2E3B45;
  --muted: #5E6F7C;
  --green: #123A00;
  --blue: #4091BB;
  --tag-bg: #ECEEEC;
  --tag-ink: #3F4C56;
  --card-border: #DCE7D7;
  --divider: rgba(4, 23, 41, .12);
  --serif: 'Source Serif 4', Georgia, serif;
  --mono: 'SF Mono', Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--ink);
  font-family: 'Public Sans', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}
::selection { background: var(--blue); color: var(--bg); }
a { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
a:hover { color: var(--blue); }
@keyframes blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
.col { max-width: 836px; margin: 0 auto; padding: 0 24px; }
.nav { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; padding: 26px 0; }
.nav-logo { display: flex; align-items: center; text-decoration: none; }
.nav-logo img { height: 14px; width: auto; display: block; }
.nav-links { display: flex; gap: 18px; align-items: center; font-size: 13px; }
.nav-links a { text-decoration: none; color: var(--green); }
.nav-links a.btn {
  background: var(--ink); color: var(--bg); display: inline-flex; align-items: center;
  height: 32px; line-height: 1; padding: 0 12px; margin: -8px 0;
}
.nav-links a:hover { color: var(--blue); }
.nav-links a.btn:hover { background: var(--blue); color: var(--bg); }
.nav-links a.btn--ghost { background: transparent; color: var(--ink); border: 1px solid var(--ink); }
.nav-links a.btn--ghost:hover { background: var(--ink); color: var(--bg); }
.frame { padding: 70px 0 10px; display: flex; flex-direction: column; }
.display, .post-title {
  margin: 0; font-family: var(--serif); font-size: 40px; line-height: 1.2;
  letter-spacing: -.015em; font-weight: 400; text-wrap: balance;
}
.lede { margin: 28px 0 0; font-size: 15px; line-height: 1.7; font-weight: 300; color: var(--body); }
.meta, .row-date { font-family: var(--mono); font-size: 11px; letter-spacing: .06em; color: var(--muted); }
.back { align-self: flex-start; font-size: 12px; margin-bottom: 40px; }
.frame .meta { margin-bottom: 14px; }
.post-title { margin-bottom: 40px; }
.post-body { font-size: 16px; line-height: 1.75; font-weight: 300; color: var(--body); }
.post-body p { margin: 0 0 22px; }
.post-body strong { color: var(--ink); font-weight: 500; }
.post-body h2 { font-family: var(--serif); font-weight: 400; font-size: 28px; line-height: 1.25; letter-spacing: -.015em; color: var(--ink); margin: 48px 0 16px; }
.post-body h3 { font-family: var(--serif); font-weight: 400; font-size: 20px; line-height: 1.3; color: var(--ink); margin: 36px 0 12px; }
.post-body ul, .post-body ol { margin: 0 0 22px; padding-left: 22px; }
.post-body li { margin-bottom: 8px; }
.post-body hr { display: none; }
.post-body blockquote {
  border-left: 2px solid var(--ink); padding: 4px 0 4px 18px; margin: 0 0 24px;
  font-family: var(--serif); font-size: 18px; font-style: italic; color: var(--ink);
}
.post-body code { font-family: var(--mono); font-size: 13px; background: var(--tag-bg); color: var(--tag-ink); padding: 2px 6px; }
.post-body pre { background: var(--ink); color: var(--bg); border-radius: 8px; padding: 18px 22px; overflow-x: auto; margin: 0 0 24px; font-size: 13px; line-height: 1.6; }
.post-body pre code { background: transparent; color: inherit; padding: 0; }
.post-body img { width: 100%; height: auto; border: 1px solid var(--card-border); border-radius: 10px; margin: 8px 0 24px; }
.post-body table {
  width: 100%; border-collapse: collapse; margin: 10px 0 30px; font-family: var(--mono);
  font-size: 12.5px; line-height: 1.5; font-variant-numeric: tabular-nums; font-weight: 400;
}
.post-body th {
  font-weight: 400; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
  text-align: left; padding: 0 18px 10px 0; border-bottom: 1px solid var(--ink);
}
.post-body td { padding: 12px 18px 12px 0; border-bottom: 1px solid var(--card-border); vertical-align: baseline; }
.rows { display: flex; flex-direction: column; border-top: 1px solid var(--divider); margin-top: 40px; }
.row {
  display: grid; grid-template-columns: 110px minmax(0, 1fr) auto; gap: 20px; align-items: baseline;
  padding: 18px 0; border-bottom: 1px solid var(--divider); text-decoration: none; color: var(--ink);
}
.row:hover, .row:hover .row-date { color: var(--blue); }
.row-title { font-family: var(--serif); font-size: 20px; line-height: 1.3; letter-spacing: -.01em; }
.row-arrow { font-size: 13px; }
.foot {
  max-width: 836px; margin: 0 auto; padding: 60px 24px 24px; display: flex; flex-wrap: wrap;
  gap: 18px; font-family: var(--mono); font-size: 11px; color: var(--green);
}
.foot a { font-family: 'Public Sans', system-ui, sans-serif; font-size: 12px; color: var(--green); }
.foot a:hover { color: var(--blue); }
.foot-copy { margin-left: auto; }
.foot-copy span { animation: blink 1.2s step-end infinite; }
@media (max-width: 520px) {
  .display, .post-title { font-size: 34px; }
  .row { grid-template-columns: minmax(0, 1fr) auto; gap: 6px 16px; }
  .row-date { grid-column: 1 / -1; }
}
`.trim();

const NAV = `
<div class="col">
<header class="nav">
  <a class="nav-logo" href="/" aria-label="Index Network"><img src="/site/index-logo.svg" alt="Index Network" /></a>
  <nav class="nav-links">
    <a href="/">home</a>
    <a href="/hermes">hermes</a>
    <a href="/blog">blog</a>
    <a href="/about">about</a>
    <a class="btn btn--ghost" href="https://github.com/indexnetwork/index" aria-label="Star Index Network on GitHub"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style="margin-right:5px"><path fill-rule="evenodd" fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>&#9733;</a>
    <a class="btn" href="/download">Get early access</a>
  </nav>
</header>`.trim();

const FOOT = `
</div>
<footer class="foot">
  <a href="mailto:founders@index.network">founders@index.network</a>
  <a href="https://github.com/indexnetwork/index">GitHub</a>
  <a href="https://x.com/indexnetwork_">X</a>
  <a href="/pages/privacy-policy">Privacy</a>
  <a href="/pages/terms-of-use">Terms</a>
  <span class="foot-copy">&copy; ${new Date().getFullYear()}<span>&#9646;</span></span>
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
    title: `${post.title} | Index Network`,
    description: post.description || "",
    path: `/blog/${post.slug}`,
    image: post.image ? `${ORIGIN}${post.image}` : DEFAULT_IMAGE,
    type: "article",
    body: `<main class="frame">
      <a class="back" href="/blog">&larr; All posts</a>
      <div class="meta">${escapeHtml(formatListDate(post.date))}</div>
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
      <p class="lede">Writing on intent-driven discovery, agents, and finding your others.</p>
      <div class="rows">
${renderRows(listEntries(posts))}
      </div>
    </main>`,
  });
}

/** Legal page text for the SPA shell's `<noscript>`, so readers without JavaScript see the policy. */
function renderLegalFragment({ TITLE, LEDE, SECTIONS }: { TITLE: string; LEDE: string; SECTIONS: LegalSection[] }): string {
  return renderToStaticMarkup(
    createElement(
      "div",
      { className: "nojs" },
      createElement("h1", null, TITLE),
      createElement("p", null, LEDE),
      ...SECTIONS.map((section) =>
        createElement("section", { key: section.id, id: section.id }, createElement("h2", null, section.title), section.body),
      ),
    ),
  );
}

/**
 * Marketing fragment injected into the SPA shell's `<noscript>` on `/`. The
 * root route also renders the signed-in app, so this cannot be a static page.
 */
function renderHomeFragment(posts: PostEntry[]): string {
  const latest = listEntries(posts).slice(0, 3);

  return `<style>
.nojs { max-width: 836px; margin: 0 auto; padding: 70px 24px; font-family: 'Public Sans', system-ui, sans-serif; color: #041729; background: #FCFEFB; }
.nojs h1 { font-family: 'Source Serif 4', Georgia, serif; font-weight: 400; font-size: 40px; line-height: 1.2; margin: 0 0 28px; }
.nojs h2 { font-family: 'SF Mono', Menlo, Consolas, monospace; font-weight: 400; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; margin: 48px 0 12px; }
.nojs p, .nojs li { font-size: 15px; line-height: 1.7; font-weight: 300; color: #2E3B45; }
.nojs a { color: #041729; }
</style>
<div class="nojs">
  <h1>Give your agent someone to talk to</h1>
  <p>Index is the social layer between personal agents. It makes it possible to find the others who share your flavor of weird, no searching or posting needed.</p>
  <p><a href="/download">Get early access</a></p>
  <h2>How it works</h2>
  <ol>
${HOME_STEPS.map((step) => `    <li>${escapeHtml(step)}</li>`).join("\n")}
  </ol>
  <h2>Blog</h2>
  <ul>
${latest.map((entry) => `    <li><a href="${entry.href}">${escapeHtml(entry.title)}</a></li>`).join("\n")}
  </ul>
  <p>
    <a href="/hermes">Hermes</a> &middot;
    <a href="/blog">All posts</a> &middot;
    <a href="/about">About</a> &middot;
    <a href="https://github.com/indexnetwork/index">GitHub</a> &middot;
    <a href="mailto:founders@index.network">founders@index.network</a>
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
writeFileSync(join(PUBLIC_DIR, "noscript-privacy-policy.html"), renderLegalFragment(privacyPolicy));
writeFileSync(join(PUBLIC_DIR, "noscript-terms-of-use.html"), renderLegalFragment(termsOfUse));
console.log(`Built ${posts.length} blog posts to ${OUTPUT_DIR}`);
