import { and, eq, isNull } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { hashMasterKey } from '../lib/experiment/master-key';
import * as schema from '../schemas/database.schema';

export interface ExperimentNetwork {
  id: string;
  title: string;
}

export async function ExperimentMasterKeyGuard(
  req: Request,
  params: Record<string, string>,
): Promise<ExperimentNetwork> {
  const networkId = params.id;
  if (!networkId) {
    throw new Response(JSON.stringify({ error: 'Network ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    throw new Response(JSON.stringify({ error: 'x-api-key header is required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const [network] = await db
    .select({
      id: schema.networks.id,
      title: schema.networks.title,
      isExperiment: schema.networks.isExperiment,
      experimentMasterKeyHash: schema.networks.experimentMasterKeyHash,
    })
    .from(schema.networks)
    .where(and(
      eq(schema.networks.id, networkId),
      isNull(schema.networks.deletedAt),
    ))
    .limit(1);

  if (!network || !network.isExperiment || !network.experimentMasterKeyHash) {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const hashedKey = await hashMasterKey(apiKey);
  if (hashedKey !== network.experimentMasterKeyHash) {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return { id: network.id, title: network.title };
}
