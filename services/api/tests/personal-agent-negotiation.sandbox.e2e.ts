import { config } from 'dotenv';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';

config({ path: path.resolve(import.meta.dir, '../../../.env.development'), override: true });
const databaseUrl = new URL(process.env.DATABASE_URL!);
databaseUrl.pathname = '/protocol_sandbox';
const redisUrl = new URL(process.env.REDIS_URL!);
redisUrl.pathname = '/14';
process.env.DATABASE_URL = databaseUrl.toString();
process.env.REDIS_URL = redisUrl.toString();
process.env.NODE_ENV = 'development';

const BASE = 'http://localhost:3101';
const BROWSER_ORIGIN = 'http://localhost:3000';
const enabled = process.env.RUN_SANDBOX_E2E === '1' && process.env.RUN_PAID_INTEGRATION_TESTS === '1' && !!process.env.OPENROUTER_API_KEY;
const CURRENT_VERBS = ['outreach', 'counter', 'question', 'pause', 'withdraw'];

type Mode = 'minimal' | 'twenty';
type Intent = { id: string; payload: string };
type RadarCard = { opportunityId: string; name: string; status?: string };
type CycleNegotiation = { taskId: string; counterpartLabel: string; opportunityId: string; opportunityStatus: string; state: string };
type Cycle = { negotiations: CycleNegotiation[] };
type Detail = { task: { brief: string | null; state: string; pause: { reason: string; by: 'yours' | 'theirs' | null } | null }; transcript: Array<{ actor: 'yours' | 'theirs'; verb: string | null; text: string | null }> };
type TimelineEntry = { event: Record<string, unknown>; act: Record<string, unknown> };

let server: ReturnType<typeof Bun.spawn> | null = null;
let serverLogs = '';
let serverLogDrain: Promise<void> | null = null;

async function seed(mode: Mode): Promise<void> {
  const child = Bun.spawn(['bun', 'src/cli/db-seed-sandbox.ts', '--confirm', `--${mode}`], { cwd: path.resolve(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe', env: process.env });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`sandbox seed failed (${code}): ${stdout}${stderr}`);
}

async function start(): Promise<void> {
  serverLogs = '';
  server = Bun.spawn(['bun', '--preload', './src/instrument.ts', 'src/main.ts'], { cwd: path.resolve(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe', env: { ...process.env, PORT: '3101', API_URL: BASE } });
  serverLogDrain = Promise.all([new Response(server.stdout).text(), new Response(server.stderr).text()]).then((outputs) => { serverLogs = outputs.join(''); });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await fetch(`${BASE}/health`).then((response) => response.ok).catch(() => false)) return;
    await Bun.sleep(200);
  }
  throw new Error(`sandbox API did not start:\n${serverLogs}`);
}

async function stop(): Promise<void> {
  if (!server) return;
  server.kill();
  await server.exited;
  await serverLogDrain;
  server = null;
}

async function login(email: string): Promise<string> {
  const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BROWSER_ORIGIN }, body: JSON.stringify({ email, password: 'sandbox-sandbox' }) });
  if (!signIn.ok) throw new Error(`sign in ${email}: ${await signIn.text()}`);
  const cookie = signIn.headers.getSetCookie().map((value) => value.split(';')[0]!).join('; ');
  const tokenResponse = await fetch(`${BASE}/api/auth/token`, { headers: { Cookie: cookie, Origin: BROWSER_ORIGIN } });
  const token = (await tokenResponse.json() as { token?: string }).token;
  if (!token) throw new Error(`no session JWT for ${email}`);
  return token;
}

async function api<T>(jwt: string, url: string, init: RequestInit = {}): Promise<T> {
  const request = fetch(`${BASE}${url}`, { ...init, signal: init.signal ?? AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } }).then(async (response) => {
    if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  });
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${init.method ?? 'GET'} ${url}: timed out after 20s`)), 20_000); })]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor<T>(read: () => Promise<T | undefined>, label: string): Promise<T> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const value = await read();
    if (value) return value;
    await Bun.sleep(500);
  }
  throw new Error(`timed out after two minutes: ${label}`);
}

describe.skipIf(!enabled)('PersonalAgent + negotiation sandbox HTTP E2E', () => {
  async function run(mode: Mode): Promise<void> {
    console.log(`[sandbox-e2e] ${mode}: reset and boot API`);
    await seed(mode);
    await start();
    try {
      const { SANDBOX_E2E_CASES, SANDBOX_MINIMAL_PERSONAS, SANDBOX_TWENTY_PERSONAS } = await import('../src/cli/sandbox-personas');
      const people = [...SANDBOX_MINIMAL_PERSONAS, ...SANDBOX_TWENTY_PERSONAS];
      const mayaJwt = await login('maya.chen@sandbox.test');
      const danielJwt = await login('daniel.ruiz@sandbox.test');
      const aishaJwt = await login('aisha.okafor@sandbox.test');
      const intent = async (jwt: string, email: string, index: number): Promise<Intent> => {
        const person = people.find((candidate) => candidate.email === email)!;
        const list = await api<{ intents: Intent[] }>(jwt, '/api/intents/list', { method: 'POST', body: '{}' });
        const found = list.intents.find((candidate) => candidate.payload === person.intents[index]);
        if (!found) throw new Error(`missing ${email}[${index}]`);
        return found;
      };
      const mayaDaniel = await intent(mayaJwt, 'maya.chen@sandbox.test', SANDBOX_E2E_CASES.mayaDaniel.source.intentIndex);
      const daniel = await intent(danielJwt, 'daniel.ruiz@sandbox.test', SANDBOX_E2E_CASES.mayaDaniel.candidate.intentIndex);
      const aishaMaya = await intent(aishaJwt, 'aisha.okafor@sandbox.test', SANDBOX_E2E_CASES.mayaAisha.source.intentIndex);
      const mayaAisha = await intent(mayaJwt, 'maya.chen@sandbox.test', SANDBOX_E2E_CASES.mayaAisha.candidate.intentIndex);
      console.log(`[sandbox-e2e] ${mode}: resume designated discovery`);
      for (const [jwt, item] of [[mayaJwt, mayaDaniel], [danielJwt, daniel], [aishaJwt, aishaMaya], [mayaJwt, mayaAisha]] as const) {
        await api(jwt, `/api/intents/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE' }) });
      }

      const radar = (jwt: string, intentId: string) => api<{ items: RadarCard[] }>(jwt, `/api/opportunities/radar?scopeType=intent&scopeId=${intentId}&statuses=latent,draft,negotiating,stalled,pending,accepted,rejected&presentation=skeleton&noCache=1`);
      const findCard = async (jwt: string, intentId: string, opportunityId: string) => (await radar(jwt, intentId)).items.find((card) => card.opportunityId === opportunityId);
      const cycle = (jwt: string, intentId: string) => api<{ cycle: Cycle }>(jwt, `/api/conversations/negotiations/intent-cycle?intentId=${intentId}`);
      const sharedTask = async (
        sourceJwt: string,
        sourceIntentId: string,
        sourceCounterpart: string,
        counterpartJwt: string,
        counterpartIntentId: string,
      ) => {
        const [source, counterpart] = await Promise.all([cycle(sourceJwt, sourceIntentId), cycle(counterpartJwt, counterpartIntentId)]);
        return source.cycle.negotiations.find((task) =>
          task.counterpartLabel === sourceCounterpart
          && counterpart.cycle.negotiations.some((other) => other.opportunityId === task.opportunityId),
        );
      };
      const mayaDanielTask = await waitFor(() => sharedTask(mayaJwt, mayaDaniel.id, 'Daniel Ruiz', danielJwt, daniel.id), 'Maya/Daniel shared opportunity');
      console.log(`[sandbox-e2e] ${mode}: Maya/Daniel discovered`);
      const aishaMayaTask = await waitFor(() => sharedTask(aishaJwt, aishaMaya.id, 'Maya Chen', mayaJwt, mayaAisha.id), 'Maya/Aisha shared opportunity');
      console.log(`[sandbox-e2e] ${mode}: Maya/Aisha discovered`);
      expect(mayaDanielTask.opportunityStatus).not.toBe('accepted');
      expect(aishaMayaTask.opportunityStatus).not.toBe('accepted');

      const timelineFor = (jwt: string, intentId: string) => api<{ entries: TimelineEntry[] }>(jwt, `/api/conversations/negotiations/intent-cycle/timeline?intentId=${intentId}`);
      await waitFor(async () => {
        const timeline = await timelineFor(mayaJwt, mayaDaniel.id);
        return timeline.entries.some((entry) => entry.event.kind === 'all_paused') ? timeline : undefined;
      }, 'Maya kickoff reflection');

      const send = async (jwt: string, intentId: string, message: string): Promise<void> => {
        try {
          const response = await fetch(`${BASE}/api/chat/web/stream`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, scopeType: 'intent', scopeId: intentId }), signal: AbortSignal.timeout(120_000) });
          expect(response.ok).toBe(true);
          await response.text();
        } catch (error) {
          await stop();
          throw new Error(`principal message failed: ${error}\nserver log:\n${serverLogs}`, { cause: error });
        }
      };
      const mayaMessage = 'We have six active design partners and two annual conversions, and are raising a $1.5m seed. For Daniel, I can offer meaningful founding equity and clear technical ownership.';
      const mayaFollowUp = 'Yes. I am the technical co-founder, and we are actively raising the $1.5m seed round.';
      const danielMessage = 'I want a hands-on founding-engineer role with clear technical ownership and meaningful equity. Maya\'s AI-agent observability company is the kind of operational product I want to build.';
      const aishaMessage = 'Maya has six active design partners, two annual conversions, and is raising a $1.5m seed for enterprise AI observability. That is credible enough for a seed conversation.';
      const aishaFollowUp = 'My fund invests $500k to $1.5m at pre-seed and seed in developer tools, data infrastructure, and enterprise software. I have led observability and data-tooling investments and want a narrow enterprise buyer with credible customer signal.';
      await send(mayaJwt, mayaDaniel.id, mayaMessage);
      await waitFor(async () => {
        const timeline = await timelineFor(mayaJwt, mayaDaniel.id);
        return timeline.entries.some((entry) => entry.event.kind === 'user_message') ? timeline : undefined;
      }, 'Maya PersonalAgent user turn');
      // The first reply answers Daniel's traction question. The real agent
      // then asks the remaining Aisha question, so answer it through the same
      // owner chat surface before expecting either negotiation to advance.
      await send(mayaJwt, mayaDaniel.id, mayaFollowUp);
      await waitFor(async () => {
        const timeline = await timelineFor(mayaJwt, mayaDaniel.id);
        return timeline.entries.filter((entry) => entry.event.kind === 'user_message').length >= 2 ? timeline : undefined;
      }, 'Maya follow-up PersonalAgent user turn');
      console.log(`[sandbox-e2e] ${mode}: Maya context sent`);
      await send(danielJwt, daniel.id, danielMessage);
      await waitFor(async () => {
        const timeline = await timelineFor(danielJwt, daniel.id);
        return timeline.entries.some((entry) => entry.event.kind === 'user_message') ? timeline : undefined;
      }, 'Daniel PersonalAgent user turn');
      console.log(`[sandbox-e2e] ${mode}: Daniel context sent`);
      await send(aishaJwt, aishaMaya.id, aishaMessage);
      await waitFor(async () => {
        const timeline = await timelineFor(aishaJwt, aishaMaya.id);
        return timeline.entries.some((entry) => entry.event.kind === 'user_message') ? timeline : undefined;
      }, 'Aisha PersonalAgent user turn');
      await send(aishaJwt, aishaMaya.id, aishaFollowUp);
      await waitFor(async () => {
        const timeline = await timelineFor(aishaJwt, aishaMaya.id);
        return timeline.entries.filter((entry) => entry.event.kind === 'user_message').length >= 2 ? timeline : undefined;
      }, 'Aisha follow-up PersonalAgent user turn');
      console.log(`[sandbox-e2e] ${mode}: Aisha context sent`);

      const targetTaskForOpportunity = async (jwt: string, intentId: string, opportunityId: string) =>
        (await cycle(jwt, intentId)).cycle.negotiations.find((negotiation) => negotiation.opportunityId === opportunityId);
      const danielMayaTask = await waitFor(() => targetTaskForOpportunity(danielJwt, daniel.id, mayaDanielTask.opportunityId), 'Daniel/Maya shared negotiation task');
      const mayaAishaTask = await waitFor(() => targetTaskForOpportunity(mayaJwt, mayaAisha.id, aishaMayaTask.opportunityId), 'Maya/Aisha shared negotiation task');
      const detail = (jwt: string, intentId: string, taskId: string) => api<{ negotiation: Detail }>(jwt, `/api/conversations/negotiations/intent-cycle/${taskId}?intentId=${intentId}`).then((result) => result.negotiation);
      const [mayaDanielDetail, danielMayaDetail, aishaMayaDetail, mayaAishaDetail] = await Promise.all([
        detail(mayaJwt, mayaDaniel.id, mayaDanielTask.taskId), detail(danielJwt, daniel.id, danielMayaTask.taskId), detail(aishaJwt, aishaMaya.id, aishaMayaTask.taskId), detail(mayaJwt, mayaAisha.id, mayaAishaTask.taskId),
      ]);
      for (const taskDetail of [mayaDanielDetail, danielMayaDetail, aishaMayaDetail, mayaAishaDetail]) {
        expect(taskDetail.task.brief).toBeTruthy();
        expect(taskDetail.transcript.length).toBeGreaterThan(0);
        expect(taskDetail.transcript.map((turn) => turn.text)).not.toContain(mayaMessage);
        expect(taskDetail.transcript.map((turn) => turn.text)).not.toContain(mayaFollowUp);
        expect(taskDetail.transcript.map((turn) => turn.text)).not.toContain(danielMessage);
        expect(taskDetail.transcript.map((turn) => turn.text)).not.toContain(aishaMessage);
        expect(taskDetail.transcript.map((turn) => turn.text)).not.toContain(aishaFollowUp);
        for (const turn of taskDetail.transcript) if (turn.verb) expect(CURRENT_VERBS).toContain(turn.verb);
      }
      const timeline = await timelineFor(mayaJwt, mayaDaniel.id);
      expect(timeline.entries.some((entry) => entry.event.kind === 'matches_ready' && entry.act.tool === 'kickoff')).toBe(true);

      const pendingMayaDaniel = await waitFor(async () => {
        const task = await targetTaskForOpportunity(mayaJwt, mayaDaniel.id, mayaDanielTask.opportunityId);
        return task?.opportunityStatus === 'pending' ? task : undefined;
      }, 'Maya/Daniel pending after principal context');
      const pendingMayaAisha = await waitFor(async () => {
        const task = await targetTaskForOpportunity(aishaJwt, aishaMaya.id, aishaMayaTask.opportunityId);
        return task?.opportunityStatus === 'pending' ? task : undefined;
      }, 'Maya/Aisha pending after principal context');
      expect(pendingMayaDaniel.opportunityStatus).toBe('pending');
      expect(pendingMayaAisha.opportunityStatus).toBe('pending');

      const mayaCycle = await cycle(mayaJwt, mayaDaniel.id);
      expect(mayaCycle.cycle.negotiations.find((negotiation) => negotiation.counterpartLabel === 'Sofia Martinez')).toBeUndefined();
      const mayaSofiaCard = (await radar(mayaJwt, mayaDaniel.id)).items.find((card) => card.name === 'Sofia Martinez');
      expect(mayaSofiaCard?.status).not.toBe('negotiating');
      expect(mayaSofiaCard?.status).not.toBe('pending');
      expect(mayaSofiaCard?.status).not.toBe('accepted');

      // An agent never advances to accepted. The only accepted transition in
      // this suite is this explicit owner action through the normal API.
      await api(mayaJwt, `/api/opportunities/${mayaDanielTask.opportunityId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted', scopeType: 'intent', scopeId: mayaDaniel.id }) });
      const acceptedMayaDaniel = await waitFor(async () => {
        const task = await targetTaskForOpportunity(mayaJwt, mayaDaniel.id, mayaDanielTask.opportunityId);
        return task?.opportunityStatus === 'accepted' ? task : undefined;
      }, 'explicit owner acceptance');
      expect(acceptedMayaDaniel.opportunityStatus).toBe('accepted');
    } finally {
      await stop();
    }
  }

  test('minimal market uses only the running API, queues, and provider', () => run('minimal'), 600_000);
  test('twenty-person market uses only the running API, queues, and provider', () => run('twenty'), 600_000);
});

afterAll(stop);
