import { existsSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { buildMetaMap, resolvePageMeta, ORIGIN, type PageMeta } from "./meta.config";

const DEFAULT_DIST = join(dirname(fileURLToPath(import.meta.url)), "dist");
const HTML_CACHE_CONTROL = "no-store";
const HASHED_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const STATIC_FILE_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const NOT_FOUND_CACHE_CONTROL = "no-store";

// Apple app-site-association (universal links). Served directly — Apple
// rejects redirects and requires an extensionless JSON response.
const AASA_PATH = "/.well-known/apple-app-site-association";
const AASA_CACHE_CONTROL = "no-store";
const MAC_APP_BUNDLE_ID = "network.index.system6";
const APPLE_TEAM_ID_PLACEHOLDER = "TEAMIDPLACEHOLDER";

function appleAppSiteAssociation(): string {
  const teamId = process.env.APPLE_TEAM_ID || APPLE_TEAM_ID_PLACEHOLDER;
  return JSON.stringify({
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${MAC_APP_BUNDLE_ID}`],
          // Order matters: the system uses the first component that matches,
          // and `*` matches path separators too. Without the exclusion, `/u/*`
          // would also claim real web-only routes like `/u/<id>/chat`, which
          // the app cannot render — it would raise its window and drop the
          // link (apps/mac/api/deeplink.mjs only routes 2-segment paths).
          components: [
            { "/": "/c/*" },
            { "/": "/o/*" },
            {
              "/": "/u/*/*",
              exclude: true,
              comment: "Deeper /u/ paths (e.g. /u/<id>/chat) are web-only; do not open the app.",
            },
            { "/": "/u/*" },
          ],
        },
      ],
    },
  });
}

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

    if (pathname === AASA_PATH && (req.method === "GET" || req.method === "HEAD")) {
      return new Response(req.method === "HEAD" ? null : appleAppSiteAssociation(), {
        headers: {
          "Cache-Control": AASA_CACHE_CONTROL,
          "Content-Type": "application/json",
        },
      });
    }

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

    const meta = resolvePageMeta(metaMap, pathname);
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

  if (!process.env.APPLE_TEAM_ID) {
    console.warn(`[web] APPLE_TEAM_ID is not set — serving placeholder team id ${APPLE_TEAM_ID_PLACEHOLDER} in ${AASA_PATH}; set APPLE_TEAM_ID before shipping universal links.`);
  }

  Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: createWebHandler(),
  });

  console.log(`Listening on :${port}`);
}
