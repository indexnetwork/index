import { sql } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import type { HermesCredentialExpiryHealth, HermesCredentialExpiryHealthStore } from '../lib/agent/hermes-runtime-telemetry';

/** Indexed aggregate snapshot for privacy-safe active Hermes credential gauges. */
export class HermesRuntimeTelemetryDatabaseAdapter implements HermesCredentialExpiryHealthStore {
  constructor(private readonly database: Pick<typeof db, 'execute'> = db) {}

  async countActiveCredentialExpiryHealth(input: {
    now: Date;
    nearExpiryCutoff: Date;
  }): Promise<HermesCredentialExpiryHealth> {
    const rows = await this.database.execute(sql`
      SELECT
        (
          SELECT count(*)::int
          FROM hermes_agent_credentials
          WHERE activation_state = 'active'
            AND expires_at > ${input.now}
            AND expires_at <= ${input.nearExpiryCutoff}
        ) AS "nearExpiry",
        (
          SELECT count(*)::int
          FROM hermes_agent_credentials
          WHERE activation_state = 'active'
            AND expires_at <= ${input.now}
        ) AS "expired"
    `);
    const [row] = rows as unknown as Array<{ nearExpiry: number; expired: number }>;
    return {
      nearExpiry: row?.nearExpiry ?? 0,
      expired: row?.expired ?? 0,
    };
  }
}

export const hermesRuntimeTelemetryDatabaseAdapter = new HermesRuntimeTelemetryDatabaseAdapter();
