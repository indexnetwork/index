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

Bun.serve({
  port,
  hostname: "0.0.0.0",
  fetch(req) {
    const reqUrl = new URL(req.url);
    const pathname = reqUrl.pathname;

    if (
      reqUrl.searchParams.get("link_preview") === "false" &&
      (req.headers.get("user-agent") ?? "").includes("TelegramBot")
    ) {
      return new Response("", { status: 403 });
    }

    const filePath = join(DIST, pathname);
    if (pathname !== "/" && existsSync(filePath)) {
      const stat = statSync(filePath);
      if (stat.isFile()) {
        return new Response(Bun.file(filePath));
      }
      if (stat.isDirectory()) {
        const indexPath = join(filePath, "index.html");
        if (existsSync(indexPath) && statSync(indexPath).isFile()) {
          if (!pathname.endsWith("/")) {
            return Response.redirect(`${pathname}/${reqUrl.search}`, 308);
          }
          return new Response(Bun.file(indexPath), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }
    }

    const meta = metaMap[pathname];
    const html = meta ? injectMeta(meta, pathname) : template;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
});

console.log(`Listening on :${port}`);
