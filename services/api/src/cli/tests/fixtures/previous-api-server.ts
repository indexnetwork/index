import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
const port = Number(process.env.PORT ?? '3001');
if (!databaseUrl || !Number.isInteger(port) || port < 1 || port > 65_535) process.exit(1);

const sql = postgres(databaseUrl, { max: 2 });

/** Historical Better Auth API-key digest: SHA-256 encoded as unpadded base64url. */
async function hashHistoricalApiKey(credential: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential));
  return Buffer.from(digest).toString('base64url');
}

Bun.serve({
  hostname: '0.0.0.0',
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') {
      try {
        const [state] = await sql<[{ legacyTable: string | null; dedicatedTable: string | null }]>`
          SELECT
            to_regclass('public.apikey')::text AS "legacyTable",
            to_regclass('public.hermes_agent_credentials')::text AS "dedicatedTable"
        `;
        return new Response(null, {
          status: state?.legacyTable === 'apikey' && state?.dedicatedTable === 'hermes_agent_credentials' ? 200 : 503,
        });
      } catch {
        return new Response(null, { status: 503 });
      }
    }

    if (pathname === '/api/agents/me' && request.method === 'GET') {
      const credential = request.headers.get('x-api-key');
      if (!credential) return new Response(null, { status: 401 });
      try {
        // This deliberately models the previous binary's legacy-table-only
        // authentication boundary using its actual hash algorithm. It must not
        // consult the dedicated table.
        const credentialHash = await hashHistoricalApiKey(credential);
        const rows = await sql`
          SELECT id
          FROM apikey
          WHERE key = ${credentialHash}
            AND enabled = true
            AND (expires_at IS NULL OR expires_at > now())
          LIMIT 1
        `;
        return new Response(null, { status: rows.length === 1 ? 200 : 401 });
      } catch {
        return new Response(null, { status: 401 });
      }
    }

    return new Response(null, { status: 404 });
  },
});
