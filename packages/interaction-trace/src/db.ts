import postgres from 'postgres';

export type Sql = ReturnType<typeof postgres>;

export function connect(url: string): Sql {
  return postgres(url, { max: 2, ssl: url.includes('sslmode=disable') ? false : 'require', idle_timeout: 10, onnotice: () => {} });
}

export function connectionUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.TRACE_DATABASE_URL;
  if (!url) throw new Error('TRACE_DATABASE_URL is required (a dev branch of the production database, never the production primary)');
  return url;
}
