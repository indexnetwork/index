#!/usr/bin/env bun
/**
 * Deterministic URL guard for the morning digest.
 *
 * The digest body is composed by an LLM. When an opportunity card lacks a real
 * `acceptUrl` (non-actionable status/role, or a swallowed mint error) the model
 * is prone to fabricating one from the field name — e.g. `index.network/accept/901`,
 * a path that does not exist and 404s. Every prompt-side guardrail against this
 * is natural language the model can ignore; this script is the enforcement layer.
 *
 * The only URLs an opportunity card legitimately carries are the connect link
 * (`<base>/c/<code>`, from `acceptUrl`) and the profile link (`<base>/u/<uuid>`,
 * from `profileUrl`). Any markdown link whose path is not one of those two shapes
 * is demoted to its plain-text label and reported. The check is host-agnostic so
 * dev / railway / prod bases all pass — the path shape is the gate.
 *
 * Usage (from the digest agent's workdir, i.e. $HERMES_HOME):
 *   bun skills/index-network/scripts/validate-digest-urls.ts memory/digest-draft.md
 * Reads the file (or stdin when no path is given), writes the sanitized body to
 * stdout, and logs any stripped URLs to stderr. Exit code is always 0 so the body
 * still ships — minus the fabricated links.
 */

/** Connect link: `/c/<code>`, optional trailing slash. Code is an opaque short token. */
const CONNECT_PATH = /^\/c\/[A-Za-z0-9_-]+\/?$/;
/** Profile link: `/u/<uuid>`, optional trailing slash. */
const PROFILE_PATH = /^\/u\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/?$/;

/**
 * A markdown inline link: `[label](url)`. Label runs to the first `]`; url to the next `)`.
 *
 * Scope is deliberately limited to inline markdown links — the only link shape the
 * digest prompts ever emit. Autolinks (`<https://…>`), bare URLs in prose, and labels
 * containing nested `]` are NOT covered; if the model ever emits one of those it is out
 * of this guard's reach (see the "known non-target" tests). Legitimate connect/profile
 * URLs contain no `(`/`)`/`]`, so this never truncates a real link.
 */
const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)]*)\)/g;

/**
 * Whether `url` is a legitimate digest action link (connect or profile shape).
 * Host-agnostic — only the path shape is checked, so dev/prod bases both pass.
 * A non-absolute or unparseable URL is never allowed.
 */
export function isAllowedDigestUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return CONNECT_PATH.test(parsed.pathname) || PROFILE_PATH.test(parsed.pathname);
}

/**
 * Strip every markdown link whose URL is not an allowed digest action link,
 * leaving the link's label text in place. Allowed links pass through verbatim.
 *
 * @param markdown - the composed digest body
 * @returns the sanitized body and the list of URLs that were stripped (in order)
 */
export function sanitizeDigestUrls(markdown: string): { output: string; stripped: string[] } {
  const stripped: string[] = [];
  const output = markdown.replace(MARKDOWN_LINK, (match, label: string, url: string) => {
    if (isAllowedDigestUrl(url)) return match;
    stripped.push(url);
    return label;
  });
  return { output, stripped };
}

async function main(): Promise<void> {
  const path = process.argv[2];
  const input = path
    ? await Bun.file(path).text()
    : await Bun.readableStreamToText(Bun.stdin.stream());

  const { output, stripped } = sanitizeDigestUrls(input);

  if (stripped.length > 0) {
    console.error(
      `[validate-digest-urls] stripped ${stripped.length} fabricated/unrecognized URL(s):`,
    );
    for (const url of stripped) console.error(`  - ${url || "(empty)"}`);
  }

  process.stdout.write(output);
}

if (import.meta.main) {
  await main();
}
