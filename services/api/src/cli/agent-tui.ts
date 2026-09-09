#!/usr/bin/env bun
import { ModelClient } from '@indexnetwork/agent';
import { choosePrincipals, createCliRenderer, mountNegotiationTui } from '@indexnetwork/agent-tui';

const USAGE = 'Usage: bun run --cwd services/api agent:tui [model-id ...]\nChoose existing principal/intent sessions. Space selects, Enter starts, Ctrl+C stops.\nUses the API database and services directly; HTTP authentication remains unchanged.';

async function main(): Promise<void> {
  const models = process.argv.slice(2);
  if (models.length === 1 && models[0] === '--help') { console.log(USAGE); return; }
  if (models.length > 3) throw new Error(USAGE);
  await import('../startup.env');
  if (process.env.NODE_ENV !== 'development' || process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME) throw new Error('The agent TUI is a local development command.');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run the agent TUI in an interactive terminal.');
  const [{ ApiNegotiationHost }, { closeDb }, { closeRedisConnection }] = await Promise.all([
    import('../lib/agent/negotiation.host'), import('../lib/drizzle/drizzle'), import('../adapters/cache.adapter'),
  ]);
  let host: InstanceType<typeof ApiNegotiationHost> | undefined;
  let renderer: Awaited<ReturnType<typeof createCliRenderer>> | undefined;
  try {
    const principals = await ApiNegotiationHost.principals();
    if (new Set(principals.map(({ userId }) => userId)).size < 2) throw new Error('The database needs active intents for at least two users.');
    let close!: () => void;
    const closed = new Promise<void>((resolve) => { close = resolve; });
    renderer = await createCliRenderer({ useMouse: true, autoFocus: false, exitOnCtrlC: true, consoleMode: 'disabled', onDestroy: close });
    const selected = await choosePrincipals(renderer, principals);
    if (!selected || renderer.isDestroyed) return;
    host = new ApiNegotiationHost(selected, new ModelClient({ apiKey: process.env.OPENROUTER_API_KEY!, models: models.length ? models : undefined }));
    mountNegotiationTui(renderer, host);
    await host.start();
    await closed;
  } finally {
    renderer?.destroy();
    await host?.stop();
    await Promise.all([closeDb(), closeRedisConnection()]);
  }
}

if (import.meta.main) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
