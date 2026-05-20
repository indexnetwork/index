import { readFileSync, existsSync, statSync } from "fs";
import { join, extname } from "path";
import { buildMetaMap, type PageMeta } from "./meta.config";

const DIST = join(import.meta.dir, "dist");
const ORIGIN = process.env.APP_URL || "https://index.network";
const template = readFileSync(join(DIST, "index.html"), "utf-8");
const metaMap = buildMetaMap(DIST);

function replaceMeta(html: string, attr: string, key: string, value: string): string {
  return html.replace(
    new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`,"i"),
    `$1${value}$2`,
  );
}

function injectMeta(meta: PageMeta, pathname: string): string {
  let html = template.replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`);
  html = replaceMeta(html, "name", "description", meta.description);
  html = replaceMeta(html, "property", "og:type", meta.type ?? "website");
  html = replaceMeta(html, "property", "og:url", `${ORIGIN}${pathname}`);
  html = replaceMeta(html, "property", "og:title", meta.title);
  html = replaceMeta(html, "property", "og:description", meta.description);
  html = replaceMeta(html, "property", "og:image", meta.image);
  html = replaceMeta(html, "name", "twitter:title", meta.title);
  html = replaceMeta(html, "name", "twitter:description", meta.description);
  html = replaceMeta(html, "name", "twitter:image", meta.image);
  return html;
}

const port = parseInt(process.env.PORT || "4173", 10);

function stripPreviewSurface(html: string): string {
  return html
    .replace(
      /<meta\s+(?:property|name)="(?:og:[^"]+|twitter:[^"]+)"[^>]*>\s*/gi,
      "",
    )
    .replace(/<meta\s+name="description"[^>]*>\s*/gi, "")
    .replace(/<title>[^<]*<\/title>\s*/i, "<title></title>");
}

Bun.serve({
  port,
  hostname: "0.0.0.0",
  fetch(req) {
    const reqUrl = new URL(req.url);
    const pathname = reqUrl.pathname;
    const suppressPreview = reqUrl.searchParams.get("link_preview") === "false";

    const filePath = join(DIST, pathname);
    if (pathname !== "/" && existsSync(filePath) && statSync(filePath).isFile()) {
      return new Response(Bun.file(filePath));
    }

    const meta = metaMap[pathname];
    let html = meta ? injectMeta(meta, pathname) : template;
    if (suppressPreview) html = stripPreviewSurface(html);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
});

console.log(`Listening on :${port}`);
