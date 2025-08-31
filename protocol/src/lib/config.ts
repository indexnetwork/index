import dotenv from 'dotenv';
dotenv.config();

function num(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function bool(name: string, def: boolean): boolean {
  const v = (process.env[name] || '').toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  return def;
}

export const config = {
  webCrawl: {
    maxDepth: num('WEB_CRAWL_MAX_DEPTH', 1),
    maxPages: num('WEB_CRAWL_MAX_PAGES', 50),
    concurrency: num('WEB_CRAWL_CONCURRENCY', 4),
    respectRobots: bool('RESPECT_ROBOTS', true),
    requestTimeoutMs: num('WEB_CRAWL_TIMEOUT_MS', 10000),
  },
  inference: {
    integrationIntentCount: num('INTEGRATION_INTENT_COUNT', 30),
  },
  linksSync: {
    triggerBrokers: bool('LINKS_SYNC_TRIGGER_BROKERS', false),
  }
};
