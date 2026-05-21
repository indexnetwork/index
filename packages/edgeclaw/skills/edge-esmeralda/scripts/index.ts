import { NotionAPI } from "notion-client";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { convert } from "html-to-text";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const REFS_DIR = join(import.meta.dir, "..", "references");
mkdirSync(REFS_DIR, { recursive: true });

// ── Newsletter Indexer ──────────────────────────────────────────────────────

async function indexNewsletter(): Promise<void> {
  console.log("Indexing newsletter...");
  const { data: xml } = await axios.get(
    "https://edgeesmeralda2026.substack.com/feed"
  );

  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
  });
  const feed = parser.parse(xml);
  const items = feed?.rss?.channel?.item ?? [];

  let md = "# Edge Esmeralda 2026 Newsletter\n\n";
  md += `Source: https://edgeesmeralda2026.substack.com/\n`;
  md += `Last indexed: ${new Date().toISOString()}\n\n---\n\n`;

  for (const item of Array.isArray(items) ? items : [items]) {
    const title = item.title ?? "Untitled";
    const date = item.pubDate ?? "";
    const author = item["dc:creator"] ?? "Edge Esmeralda";
    const link = item.link ?? "";
    const htmlContent = item["content:encoded"] ?? item.description ?? "";

    const textContent = convert(htmlContent, {
      wordwrap: false,
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
      ],
    }).trim();

    md += `## ${title}\n\n`;
    md += `**Date**: ${date} | **Author**: ${author}\n`;
    md += `**Link**: ${link}\n\n`;
    md += `${textContent}\n\n---\n\n`;
  }

  writeFileSync(join(REFS_DIR, "newsletter-digest.md"), md);
  console.log(`  Newsletter: ${Array.isArray(items) ? items.length : 1} posts`);
}

// ── Website Indexer ─────────────────────────────────────────────────────────

const WEBSITE_PAGES = [
  { path: "/about", title: "About Edge City" },
  { path: "/roadmap", title: "Roadmap" },
  { path: "/ecosystem", title: "Ecosystem" },
  { path: "/media", title: "Media" },
];

async function indexWebsite(): Promise<void> {
  console.log("Indexing website...");
  let md = "# Edge City Website Content\n\n";
  md += `Source: https://edgecity.live\n`;
  md += `Last indexed: ${new Date().toISOString()}\n\n---\n\n`;

  for (const page of WEBSITE_PAGES) {
    try {
      const { data: html } = await axios.get(
        `https://edgecity.live${page.path}`,
        { timeout: 15000 }
      );

      const text = convert(html, {
        wordwrap: false,
        baseElements: { selectors: ["main", "article", "body"] },
        selectors: [
          { selector: "nav", format: "skip" },
          { selector: "footer", format: "skip" },
          { selector: "script", format: "skip" },
          { selector: "style", format: "skip" },
          { selector: "header", format: "skip" },
          { selector: "a", options: { ignoreHref: true } },
          { selector: "img", format: "skip" },
        ],
      }).trim();

      // Remove excessive blank lines
      const cleaned = text.replace(/\n{3,}/g, "\n\n");

      md += `## ${page.title}\n\n`;
      md += `${cleaned}\n\n---\n\n`;
      console.log(`  Website: ${page.path} (${cleaned.length} chars)`);
    } catch (err: any) {
      console.error(`  Website: ${page.path} failed: ${err.message}`);
      md += `## ${page.title}\n\n`;
      md += `*Failed to fetch this page. Try again later.*\n\n---\n\n`;
    }
  }

  writeFileSync(join(REFS_DIR, "website-content.md"), md);
}

// ── Notion Wiki Indexer ─────────────────────────────────────────────────────

const WIKI_PAGE_ID = "317d45cdfc5981d2a571f52b024c5141";

function extractNotionText(titleArr: any[]): string {
  if (!titleArr) return "";
  return titleArr
    .map((t: any) => {
      if (!Array.isArray(t)) return String(t);
      let text = t[0];
      if (t[1]) {
        for (const ann of t[1]) {
          if (ann[0] === "a") text = `${text} (${ann[1]})`;
        }
      }
      return text;
    })
    .join("");
}

async function indexWiki(): Promise<void> {
  console.log("Indexing Notion wiki...");
  const notion = new NotionAPI();
  const recordMap = await notion.getPage(WIKI_PAGE_ID);
  const blocks = recordMap.block;

  let md = "# Edge Esmeralda 2026 Wiki\n\n";
  md += `Source: https://www.notion.so/edgecity/Edge-Esmeralda-2026-Wiki-${WIKI_PAGE_ID}\n`;
  md += `Last indexed: ${new Date().toISOString()}\n\n---\n\n`;

  let blockCount = 0;

  for (const [bid, bdata] of Object.entries(blocks) as any[]) {
    const v = bdata?.value?.value || bdata?.value;
    if (!v || !v.type) continue;

    const text = extractNotionText(v.properties?.title);
    if (!text && !["divider"].includes(v.type)) continue;

    blockCount++;

    switch (v.type) {
      case "page":
        // Skip the root page title (we have our own header)
        break;
      case "header":
        md += `# ${text}\n\n`;
        break;
      case "sub_header":
        md += `## ${text}\n\n`;
        break;
      case "sub_sub_header":
        md += `### ${text}\n\n`;
        break;
      case "text":
        md += `${text}\n\n`;
        break;
      case "bulleted_list":
        md += `- ${text}\n`;
        break;
      case "numbered_list":
        md += `1. ${text}\n`;
        break;
      case "toggle":
        md += `**${text}**\n\n`;
        break;
      case "callout":
        md += `> ${text}\n\n`;
        break;
      case "quote":
        md += `> ${text}\n\n`;
        break;
      case "divider":
        md += `---\n\n`;
        break;
      case "bookmark":
        md += `${text}\n\n`;
        break;
      default:
        if (text.length > 0) md += `${text}\n\n`;
    }
  }

  writeFileSync(join(REFS_DIR, "wiki-content.md"), md);
  console.log(`  Wiki: ${blockCount} blocks`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Starting indexer...\n");

  const results = await Promise.allSettled([
    indexNewsletter(),
    indexWebsite(),
    indexWiki(),
  ]);

  console.log("\nResults:");
  for (const r of results) {
    if (r.status === "rejected") {
      console.error(`  FAILED: ${r.reason}`);
    }
  }

  console.log("\nDone.");
}

main();
