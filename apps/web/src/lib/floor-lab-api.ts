import { apiUrl } from '@/lib/api';
import type { IntentCycleNegotiationDetail, IntentCycleSnapshot } from '@/services/conversation';

export type FloorSeatInput = {
  name: string;
  intent: string;
  profile?: string;
  location?: string;
};

export type FloorRunSeat = {
  name: string;
  userId: string;
  email: string;
  intentId: string;
  jwt: string;
};

export type FloorRunResult = {
  runId: string;
  networkId: string;
  password: string;
  seats: FloorRunSeat[];
};

async function seatJson<T>(jwt: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(`/api${path}`), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

export async function startFloorRun(seats: FloorSeatInput[]): Promise<FloorRunResult> {
  const response = await fetch(apiUrl('/api/dev/floor/runs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seats }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<FloorRunResult>;
}

export async function fetchIntentCycle(jwt: string, intentId: string): Promise<IntentCycleSnapshot> {
  const data = await seatJson<{ cycle: IntentCycleSnapshot }>(
    jwt,
    `/conversations/negotiations/intent-cycle?intentId=${encodeURIComponent(intentId)}`,
  );
  return data.cycle;
}

export async function fetchNegotiationDetail(
  jwt: string,
  intentId: string,
  taskId: string,
): Promise<IntentCycleNegotiationDetail> {
  const data = await seatJson<{ negotiation: IntentCycleNegotiationDetail }>(
    jwt,
    `/conversations/negotiations/intent-cycle/${encodeURIComponent(taskId)}?intentId=${encodeURIComponent(intentId)}`,
  );
  return data.negotiation;
}

export async function answerAsSeat(jwt: string, intentId: string, message: string): Promise<void> {
  const response = await fetch(apiUrl('/api/chat/web/stream'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ message, scopeType: 'intent', scopeId: intentId }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  if (!response.body) return;
  const reader = response.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

export type FloorPairStatus = 'waiting' | 'negotiating' | 'matched' | 'rejected' | 'stalled' | 'error';

export function mapFloorStatus(
  opportunityStatus: string,
  state: string,
  pause: { reason: string; by: 'yours' | 'theirs' | null } | null,
): FloorPairStatus {
  if (opportunityStatus === 'pending') return 'matched';
  if (opportunityStatus === 'rejected') return 'rejected';
  if (pause?.reason === 'turn_cap') return 'stalled';
  if (pause?.reason === 'open_failed') return 'error';
  if (state === 'working' || state === 'submitted') return 'negotiating';
  if (pause?.reason === 'needs_principal') return 'negotiating';
  if (state === 'paused') return 'negotiating';
  return 'waiting';
}

export function principalQuestion(
  detail: IntentCycleNegotiationDetail | null,
): string | null {
  const pause = detail?.task.pause;
  if (!pause || pause.reason !== 'needs_principal' || pause.by !== 'yours') return null;
  const payload = pause.payload as { question?: string } | undefined;
  return payload?.question?.trim() || null;
}
