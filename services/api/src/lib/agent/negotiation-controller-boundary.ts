/** Preserve the historical test-message ordering: authorize, fetch, heartbeat. */
export async function pickupTestMessageAtControllerBoundary<Result>(input: {
  agentId: string;
  ownerId: string;
  authorize: (agentId: string, ownerId: string) => Promise<unknown>;
  pickup: (agentId: string) => Promise<Result | null>;
  touchLastSeen: (agentId: string) => Promise<void>;
}): Promise<Result | null> {
  await input.authorize(input.agentId, input.ownerId);
  const result = await input.pickup(input.agentId);
  await input.touchLastSeen(input.agentId);
  return result;
}
