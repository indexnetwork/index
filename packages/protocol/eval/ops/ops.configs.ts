import { SQL } from "bun";

import { ConfigProfileSchema, type ConfigProfile } from "./ops.profiles.js";

export class ConfigConflictError extends Error {
  constructor(name: string) {
    super(`A config named "${name}" already exists`);
    this.name = "ConfigConflictError";
  }
}

/**
 * eval-ops app state, not fixture corpus. db:flush truncates a hard-coded
 * list of api-owned tables, so a fixture reset never touches this table, and
 * IF NOT EXISTS makes boot-time application idempotent.
 */
export const CONFIG_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS eval_ops_configs (
    name        text PRIMARY KEY,
    description text NOT NULL,
    models      jsonb NOT NULL DEFAULT '{}',
    env         jsonb NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  )`;

export interface ConfigStore {
  list(): Promise<ConfigProfile[]>;
  get(name: string): Promise<ConfigProfile | null>;
  create(profile: ConfigProfile): Promise<void>;
  update(
    name: string,
    patch: { description?: string; models?: Record<string, string>; env?: Record<string, string> },
  ): Promise<ConfigProfile | null>;
  remove(name: string): Promise<boolean>;
}

export class InMemoryConfigStore implements ConfigStore {
  private readonly configs = new Map<string, ConfigProfile>();

  async list(): Promise<ConfigProfile[]> {
    return [...this.configs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(name: string): Promise<ConfigProfile | null> {
    return this.configs.get(name) ?? null;
  }

  async create(profile: ConfigProfile): Promise<void> {
    if (this.configs.has(profile.name)) throw new ConfigConflictError(profile.name);
    this.configs.set(profile.name, profile);
  }

  async update(
    name: string,
    patch: { description?: string; models?: Record<string, string>; env?: Record<string, string> },
  ): Promise<ConfigProfile | null> {
    const existing = this.configs.get(name);
    if (existing === undefined) return null;
    const updated: ConfigProfile = {
      name,
      description: patch.description ?? existing.description,
      models: patch.models ?? existing.models,
      env: patch.env ?? existing.env,
    };
    this.configs.set(name, updated);
    return updated;
  }

  async remove(name: string): Promise<boolean> {
    return this.configs.delete(name);
  }
}

/**
 * Raw row shape as the driver returns it. Verified on Bun v1.3.14: Bun.SQL
 * decodes jsonb columns to STRINGS, not objects — so `models`/`env` arrive as
 * JSON text and must be parsed before schema validation.
 */
interface ConfigRow {
  name: string;
  description: string;
  models: Record<string, string> | string;
  env: Record<string, string> | string;
}

/** Parses one jsonb field, tolerating drivers that decode to objects instead. */
function parseJsonbField(value: Record<string, string> | string, field: string, name: string): Record<string, string> {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as Record<string, string>;
  } catch (error) {
    throw new Error(
      `Config "${name}" has corrupt JSON in ${field}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Normalises a raw driver row into a validated ConfigProfile. The unit under
 * test for the row-mapping behaviour — kept pure so it needs no database.
 */
export function configFromRow(row: ConfigRow): ConfigProfile {
  return ConfigProfileSchema.parse({
    name: row.name,
    description: row.description,
    models: parseJsonbField(row.models, "models", row.name),
    env: parseJsonbField(row.env, "env", row.name),
  });
}

/**
 * Config persistence in the same Neon database the fixture control plane
 * uses. The connection is long-lived (unlike BunSqlFixtureInspector, which
 * connects per probe): the store sits on the server context for the process
 * lifetime. jsonb values are bound as JSON strings with explicit casts —
 * Bun.SQL leaves parameter typing to Postgres, and the cast makes the target
 * type unambiguous regardless of inference.
 */
export class BunSqlConfigStore implements ConfigStore {
  private readonly sql: SQL;

  constructor(databaseUrl: string) {
    this.sql = new SQL(databaseUrl, { max: 2 });
  }

  async ensureTable(): Promise<void> {
    await this.sql.unsafe(CONFIG_TABLE_DDL);
  }

  async list(): Promise<ConfigProfile[]> {
    const rows = (await this.sql`SELECT name, description, models, env FROM eval_ops_configs ORDER BY name`) as ConfigRow[];
    return rows.map(configFromRow);
  }

  async get(name: string): Promise<ConfigProfile | null> {
    const rows = (await this.sql`SELECT name, description, models, env FROM eval_ops_configs WHERE name = ${name}`) as ConfigRow[];
    return rows.length === 0 ? null : configFromRow(rows[0]);
  }

  async create(profile: ConfigProfile): Promise<void> {
    try {
      await this.sql`INSERT INTO eval_ops_configs (name, description, models, env)
        VALUES (${profile.name}, ${profile.description}, ${JSON.stringify(profile.models)}::jsonb, ${JSON.stringify(profile.env)}::jsonb)`;
    } catch (error) {
      if (error instanceof Error && error.message.includes("duplicate key")) throw new ConfigConflictError(profile.name);
      throw error;
    }
  }

  async update(
    name: string,
    patch: { description?: string; models?: Record<string, string>; env?: Record<string, string> },
  ): Promise<ConfigProfile | null> {
    const existing = await this.get(name);
    if (existing === null) return null;
    const updated: ConfigProfile = {
      name,
      description: patch.description ?? existing.description,
      models: patch.models ?? existing.models,
      env: patch.env ?? existing.env,
    };
    await this.sql`UPDATE eval_ops_configs
      SET description = ${updated.description}, models = ${JSON.stringify(updated.models)}::jsonb,
          env = ${JSON.stringify(updated.env)}::jsonb, updated_at = now()
      WHERE name = ${name}`;
    return updated;
  }

  async remove(name: string): Promise<boolean> {
    const rows = await this.sql`DELETE FROM eval_ops_configs WHERE name = ${name} RETURNING name`;
    return rows.length > 0;
  }
}
