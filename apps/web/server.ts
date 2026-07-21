import { existsSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { buildMetaMap, ORIGIN, type PageMeta } from "./meta.config";

const DEFAULT_DIST = join(dirname(fileURLToPath(import.meta.url)), "dist");
const HTML_CACHE_CONTROL = "no-store";
const HASHED_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const STATIC_FILE_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const NOT_FOUND_CACHE_CONTROL = "no-store";

interface WebHandlerOptions {
  distDir?: string;
  template?: string;
  metaMap?: Record<string, PageMeta>;
}

function replaceMeta(html: string, attr: string, key: string, value: string): string {
  return html.replace(
    new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`, "i"),
    `$1${value}$2`,
  );
}

function injectMeta(template: string, meta: PageMeta, pathname: string): string {
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

function stripPreviewSurface(html: string): string {
  return html
    .replace(
      /<meta\s+(?:property|name)="(?:og:[^"]+|twitter:[^"]+)"[^>]*>\s*/gi,
      "",
    )
    .replace(/<meta\s+name="description"[^>]*>\s*/gi, "")
    .replace(/<title>[^<]*<\/title>\s*/i, "<title></title>");
}

function isDocumentNavigation(req: Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  return (
    req.headers.get("sec-fetch-mode") === "navigate" ||
    req.headers.get("accept")?.toLowerCase().includes("text/html") === true
  );
}

function notFound(req: Request): Response {
  return new Response(req.method === "HEAD" ? null : "Not Found", {
    status: 404,
    headers: {
      "Cache-Control": NOT_FOUND_CACHE_CONTROL,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

/**
 * Creates the production web request handler.
 *
 * Document navigations receive the SPA entrypoint, while missing assets and
 * non-document requests fail as real 404s instead of receiving HTML.
 */
export function createWebHandler(options: WebHandlerOptions = {}): (req: Request) => Response {
  const distDir = options.distDir ?? DEFAULT_DIST;
  const template = options.template ?? readFileSync(join(distDir, "index.html"), "utf-8");
  const metaMap = options.metaMap ?? buildMetaMap(distDir);

  return (req: Request): Response => {
    const reqUrl = new URL(req.url);
    const pathname = reqUrl.pathname;
    const suppressPreview = reqUrl.searchParams.get("link_preview") === "false";
    const relativePath = pathname.replace(/^\/+/, "");
    const filePath = join(distDir, relativePath);

    if (pathname !== "/" && existsSync(filePath) && statSync(filePath).isFile()) {
      const file = Bun.file(filePath);
      const cacheControl = pathname.startsWith("/assets/")
        ? HASHED_ASSET_CACHE_CONTROL
        : pathname.endsWith(".html")
          ? HTML_CACHE_CONTROL
          : STATIC_FILE_CACHE_CONTROL;

      return new Response(req.method === "HEAD" ? null : file, {
        headers: {
          "Cache-Control": cacheControl,
          "Content-Type": file.type,
        },
      });
    }

    if (pathname.startsWith("/assets/") || !isDocumentNavigation(req)) {
      return notFound(req);
    }

    const meta = metaMap[pathname];
    let html = meta ? injectMeta(template, meta, pathname) : template;
    if (suppressPreview) html = stripPreviewSurface(html);

    return new Response(req.method === "HEAD" ? null : html, {
      headers: {
        "Cache-Control": HTML_CACHE_CONTROL,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  };
}

if (import.meta.main) {
  const port = parseInt(process.env.PORT || "4173", 10);

  Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: createWebHandler(),
  });

  console.log(`Listening on :${port}`);
}
