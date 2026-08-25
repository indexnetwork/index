import { config } from 'dotenv';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';

config({ path: path.resolve(import.meta.dir, '../../../.env.development'), override: true });
const databaseUrl = new URL(process.env.DATABASE_URL!); databaseUrl.pathname = '/protocol_sandbox';
const redisUrl = new URL(process.env.REDIS_URL!); redisUrl.pathname = '/14';
process.env.DATABASE_URL = databaseUrl.toString(); process.env.REDIS_URL = redisUrl.toString(); process.env.NODE_ENV = 'development';
const BASE = 'http://localhost:3101';
const BROWSER_ORIGIN = 'http://localhost:3000';
const enabled = process.env.RUN_SANDBOX_E2E === '1' && process.env.RUN_PAID_INTEGRATION_TESTS === '1' && !!process.env.OPENROUTER_API_KEY;
let server: ReturnType<typeof Bun.spawn> | null = null;
let serverLogs = '';
let serverLogDrain: Promise<void> | null = null;

async function seed(mode: 'minimal' | 'twenty') { const p = Bun.spawn(['bun', 'src/cli/db-seed-sandbox.ts', '--confirm', `--${mode}`], { cwd: path.resolve(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe', env: process.env }); const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]); if (code) throw new Error(`seed failed: ${out}${err}`); }
async function start() { server = Bun.spawn(['bun', '--preload', './src/instrument.ts', 'src/main.ts'], { cwd: path.resolve(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe', env: { ...process.env, PORT: '3101', API_URL: BASE } }); serverLogDrain = Promise.all([new Response(server.stdout).text(), new Response(server.stderr).text()]).then(outputs => { serverLogs += outputs.join(''); }); for (let i = 0; i < 150; i++) { if (await fetch(`${BASE}/health`).then(r => r.ok).catch(() => false)) return; await Bun.sleep(200); } throw new Error(`sandbox API did not start:\n${serverLogs}`); }
async function login(email: string) { const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BROWSER_ORIGIN }, body: JSON.stringify({ email, password: 'sandbox-sandbox' }) }); if (!signIn.ok) throw new Error(`sign in ${email}: ${await signIn.text()}`); const cookie = signIn.headers.getSetCookie().map(v => v.split(';')[0]!).join('; '); const response = await fetch(`${BASE}/api/auth/token`, { headers: { Cookie: cookie, Origin: BROWSER_ORIGIN } }); const token = (await response.json() as { token?: string }).token; if (!token) throw new Error(`no session JWT for ${email}`); return token; }
async function api<T>(jwt: string, url: string, init: RequestInit = {}) { const request = fetch(`${BASE}${url}`, { ...init, signal: init.signal ?? AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } }).then(async (r) => { if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${url}: ${r.status} ${await r.text()}`); return r.json() as Promise<T>; }); let timer!: ReturnType<typeof setTimeout>; try { return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${init.method ?? 'GET'} ${url}: timed out after 20s`)), 20_000); })]); } finally { clearTimeout(timer); } }
async function waitFor<T>(read: () => Promise<T | undefined>, label: string | (() => string)) { for (let i = 0; i < 240; i++) { const value = await read(); if (value) return value; await Bun.sleep(500); } throw new Error(`timed out after two minutes: ${typeof label === 'function' ? label() : label}`); }

describe.skipIf(!enabled)('PersonalAgent + negotiation sandbox HTTP E2E', () => {
  async function run(mode: 'minimal' | 'twenty') {
    console.log(`[sandbox-e2e] ${mode}: reset and boot API`);
    await seed(mode); await start();
    const { SANDBOX_E2E_CASES, SANDBOX_MINIMAL_PERSONAS, SANDBOX_TWENTY_PERSONAS } = await import('../src/cli/sandbox-personas');
    const people = [...SANDBOX_MINIMAL_PERSONAS, ...SANDBOX_TWENTY_PERSONAS];
    const mayaJwt = await login('maya.chen@sandbox.test'); const danielJwt = await login('daniel.ruiz@sandbox.test'); const aishaJwt = await login('aisha.okafor@sandbox.test');
    const intent = async (jwt: string, email: string, index: number) => { const person = people.find(p => p.email === email)!; const list = await api<{ intents: { id: string; payload: string }[] }>(jwt, '/api/intents/list', { method: 'POST', body: '{}' }); const found = list.intents.find(i => i.payload === person.intents[index]); if (!found) throw new Error(`missing ${email}[${index}]`); return found; };
    const mayaDaniel = await intent(mayaJwt, 'maya.chen@sandbox.test', SANDBOX_E2E_CASES.mayaDaniel.source.intentIndex); const daniel = await intent(danielJwt, 'daniel.ruiz@sandbox.test', SANDBOX_E2E_CASES.mayaDaniel.candidate.intentIndex); const mayaAisha = await intent(aishaJwt, 'aisha.okafor@sandbox.test', SANDBOX_E2E_CASES.mayaAisha.source.intentIndex); const mayaAishaCandidate = await intent(mayaJwt, 'maya.chen@sandbox.test', SANDBOX_E2E_CASES.mayaAisha.candidate.intentIndex);
    console.log(`[sandbox-e2e] ${mode}: resume designated discovery`);
    for (const [jwt, item] of [[mayaJwt, mayaDaniel], [danielJwt, daniel], [aishaJwt, mayaAisha], [mayaJwt, mayaAishaCandidate]] as const) { await api(jwt, `/api/intents/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) }); console.log(`[sandbox-e2e] ${mode}: resumed ${item.id}`); }
    const radar = (jwt: string, id: string) => api<{ items: { opportunityId: string; name: string; status?: string }[] }>(jwt, `/api/opportunities/radar?scopeType=intent&scopeId=${id}&statuses=latent,draft,negotiating,stalled,pending&presentation=skeleton`);
    let radarSnapshot: unknown;
    const mayaDanielCard = await waitFor(async () => { radarSnapshot = await radar(mayaJwt, mayaDaniel.id); return (radarSnapshot as { items: { opportunityId: string; name: string; status?: string }[] }).items.find(c => c.name === 'Daniel Ruiz'); }, () => `Maya/Daniel; radar=${JSON.stringify(radarSnapshot)}`); console.log(`[sandbox-e2e] ${mode}: Maya/Daniel discovered`);
    const mayaAishaCard = await waitFor(async () => { radarSnapshot = await radar(aishaJwt, mayaAisha.id); return (radarSnapshot as { items: { opportunityId: string; name: string; status?: string }[] }).items.find(c => c.name === 'Maya Chen'); }, () => `Maya/Aisha; radar=${JSON.stringify(radarSnapshot)}`); console.log(`[sandbox-e2e] ${mode}: Maya/Aisha discovered`); expect(mayaDanielCard.status).not.toBe('accepted'); expect(mayaAishaCard.status).not.toBe('accepted');
    const send = async (jwt: string, id: string, message: string) => { try { console.log(`[sandbox-e2e] ${mode}: send principal context`); const r = await fetch(`${BASE}/api/chat/web/stream`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, scopeType: 'intent', scopeId: id }), signal: AbortSignal.timeout(120_000) }); expect(r.ok).toBe(true); await r.text(); } catch (error) { server?.kill(); await server?.exited; await serverLogDrain; throw new Error(`principal message failed: ${error}\nserver log:\n${serverLogs}`, { cause: error }); } };
    await send(mayaJwt, mayaDaniel.id, 'For Daniel, I can offer meaningful founding equity and clear technical ownership.'); await send(danielJwt, daniel.id, 'I am interested if the role has clear technical ownership and meaningful equity.'); await send(aishaJwt, mayaAisha.id, 'For Maya Chen, our six design partners and two annual conversions support a focused seed conversation.');
    await waitFor(async () => (await radar(mayaJwt, mayaDaniel.id)).items.find(c => c.name === 'Daniel Ruiz' && ['negotiating', 'pending', 'rejected'].includes(c.status ?? '')), 'post-context lifecycle');
  }
  test('minimal market uses only the running API, queues, and provider', () => run('minimal'), 600_000);
  test('twenty-person market uses only the running API, queues, and provider', () => run('twenty'), 600_000);
});
afterAll(async () => { if (server) { server.kill(); await server.exited; } });
