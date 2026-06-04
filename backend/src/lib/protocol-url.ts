import { log } from './log';

let warnedMissingProtocolBaseUrl = false;

/**
 * Resolve the public base URL of the protocol service.
 *
 * Protocol-host routes — short connect links (`/c/:code`) and the MCP endpoint
 * (`/mcp`) — are served ONLY by the protocol backend, so this consults only the
 * protocol-host vars (`BASE_URL`, then `API_BASE_URL`) and never the frontend
 * `APP_URL`/`FRONTEND_URL`. A frontend host (e.g. `index.network`) must never
 * leak into these URLs — it would 404 against the SPA instead of resolving on
 * the protocol host. When neither var is set the provided `fallback` is used
 * (localhost for in-process dev callers, the public protocol host for URLs
 * handed to external integrators); in production a missing protocol base URL is
 * logged once so the misconfig surfaces loudly.
 *
 * @param fallback - Base URL to use when no protocol-host env var is set.
 * @returns Protocol base URL with any trailing slashes stripped.
 */
export function resolveProtocolBaseUrl(fallback = 'http://localhost:3001'): string {
  const explicit = process.env.BASE_URL || process.env.API_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  if (process.env.NODE_ENV === 'production' && !warnedMissingProtocolBaseUrl) {
    warnedMissingProtocolBaseUrl = true;
    log.lib.error(
      'protocol-url: BASE_URL/API_BASE_URL unset in production — protocol URLs may be unusable. ' +
        'Set BASE_URL to the protocol host (e.g. https://protocol.index.network).',
    );
  }
  return fallback.replace(/\/+$/, '');
}
