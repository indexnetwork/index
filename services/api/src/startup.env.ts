import path from 'node:path';
import { z } from 'zod';

import { loadEnvironmentWithTestLock } from './lib/env/test-environment';
// Runtime env files live at the repo root (see root .env.example). Resolve
// relative to this file so the path works regardless of cwd. No bare `.env`
// fallback: development is the default when NODE_ENV is unset; deployments
// use platform-injected variables, never files.
const repoRoot = path.resolve(import.meta.dir, '../../..');
loadEnvironmentWithTestLock({
  requestedNodeEnv: process.env.NODE_ENV,
  testEnvPath: path.join(repoRoot, '.env.test'),
  developmentEnvPath: path.join(repoRoot, '.env.development'),
});

// ---------------------------------------------------------------------------
// Environment validation
// Validates process.env on startup. Does NOT change how code accesses env vars
// — all existing process.env.* usage continues to work as-is.
// ---------------------------------------------------------------------------

const runtimeEnvironment = process.env.NODE_ENV;
const isTest = runtimeEnvironment === 'test';
const isDeployment =
  runtimeEnvironment === 'production' ||
  Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME);

// EVAL_MODEL_OVERRIDES is a local-only hook. Gated on `isDeployment`, not on
// NODE_ENV alone: a deployment may not set NODE_ENV (railway.toml runs the
// `start` script, which does not), and in that case the protocol's own
// NODE_ENV=production guard goes inert and the override would actually be
// honoured. A value present in a deployed environment means someone believes
// it is doing something. Fail loudly rather than ignore it silently.
if (isDeployment && process.env.EVAL_MODEL_OVERRIDES) {
  throw new Error(
    'EVAL_MODEL_OVERRIDES must not be set in a deployed environment. It is a local-only model override; remove it from the deployment environment.',
  );
}

const requiredUnlessTest = isTest ? z.string().optional() : z.string().trim().min(1);
const optionalUrl = z.union([z.literal(''), z.string().url()]).optional();
const optionalInt = z.union([z.literal(''), z.string().regex(/^\d+$/)]).optional();
const optionalPositiveInt = z.union([z.literal(''), z.string().regex(/^[1-9]\d*$/)]).optional();
const optionalBoolean = z.union([z.literal(''), z.enum(['true', 'false'])]).optional();
const optionalOne = z.union([z.literal(''), z.literal('1')]).optional();
const decimalValue = /^[+]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const optionalDecimalInRange = (max: number) => z.string().refine((raw) => {
  const normalized = raw.trim();
  if (normalized === '') return true;
  if (!decimalValue.test(normalized)) return false;
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 && value <= max;
}, `expected a finite decimal between 0 and ${max} (inclusive)`).optional();

const envSchema = z.object({
  // 1. Core
  DATABASE_URL: z.string().url(),
  PORT: z.string().regex(/^\d+$/).default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_URL: optionalUrl,
  WEB_APP_URL: optionalUrl,

  // 2. Authentication
  BETTER_AUTH_SECRET: requiredUnlessTest,
  OPPORTUNITY_OWNER_APPROVAL_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  TRUSTED_ORIGINS: z.string().optional(),
  STAFF_EMAILS: z.string().optional(),

  // 3. LLM / AI (OpenRouter)
  OPENROUTER_API_KEY: requiredUnlessTest,
  CHAT_MODEL: z.string().optional(),
  CHAT_REASONING_EFFORT: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  // Eval-only per-agent model overrides (JSON). Ignored by the protocol in
  // production, and rejected outright above when NODE_ENV=production.
  EVAL_MODEL_OVERRIDES: z.string().optional(),

  // 4. Redis
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: optionalInt,
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: optionalInt,

  // 5. Storage (S3-compatible)
  S3_ENDPOINT: optionalUrl,
  S3_REGION: z.string().optional(),
  S3_BUCKET: requiredUnlessTest,
  S3_ACCESS_KEY_ID: requiredUnlessTest,
  S3_SECRET_ACCESS_KEY: requiredUnlessTest,

  // 6. Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_PRODUCTION_MODE: optionalBoolean,
  TESTING_EMAIL_ADDRESS: z.union([z.literal(''), z.string().email()]).optional(),

  // 7. Integrations
  COMPOSIO_API_KEY: z.string().optional(),
  UNSTRUCTURED_API_URL: optionalUrl,
  PARALLELS_API_KEY: z.string().optional(),
  UNAVATAR_TOKEN: z.string().optional(),
  UNAVATAR_BASE: optionalUrl,

  // 8. Discovery / protocol runtime
  DISCOVERY_CONTEXT_TO_INTENT: z.union([z.literal(''), z.literal('0'), z.literal('1')]).optional(),
  INTRODUCER_DISCOVERY_ENABLED: optionalBoolean,
  DISCOVERY_SOURCE_PREMISE_LIMIT: optionalInt,
  DISCOVERY_ALLOWED_TYPES: z.string().optional(),
  DISCOVERY_MIN_SIMILARITY: optionalDecimalInRange(1),
  DISCOVERY_EVALUATOR_MIN_SCORE: optionalDecimalInRange(100),
  // Parsed with warn-and-fallback in the protocol accessor (discoveryProfileSource());
  // a typo must never disable discovery, so startup validation stays permissive.
  DISCOVERY_PROFILE_SOURCE: z.string().optional(),
  FAST_SIGNAL_INTAKE: optionalBoolean,
  SIGNAL_INTAKE_MAX_QUESTIONS: z.string().optional(),
  NEGOTIATOR_STANCE: z.union([z.literal(''), z.enum(['advocate', 'evaluator', 'skeptic'])]).optional(),

  // Test harness (repo-root .env.test only)
  TEST_DATABASE_SAFE: optionalOne,
  RUN_PAID_INTEGRATION_TESTS: optionalOne,
  RUN_REDIS_INTEGRATION_TESTS: optionalOne,
  RUN_LOCAL_API_E2E: optionalOne,

  // 9. MCP / tool runtime

  // 10. Rate limiting

  // 11. Telegram Bot
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_WEBHOOK_URL: optionalUrl,

  // 12. Observability
  SENTRY_DSN: optionalUrl,
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  LOG_LEVEL: z.union([z.literal(''), z.enum(['verbose', 'debug', 'info', 'warn', 'error'])]).optional(),

  // 12b. LangGraph checkpoint retention

  // 12c. Frame-drift measurement (disabled by default)

  // 13. Platform-provided metadata
  RAILWAY_ENVIRONMENT: z.string().optional(),
  RAILWAY_ENVIRONMENT_NAME: z.string().optional(),
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
  GITHUB_SHA: z.string().optional(),

  // 14. Test / local-only compatibility flags seen in the codebase
  OPENAI_API_KEY: z.string().optional(),
  DEBUG: z.string().optional(),
  FORCE_COLOR: z.string().optional(),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('❌ Invalid environment variables:');
  for (const issue of result.error.issues) {
    console.error(`   ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const hasValue = (name: string): boolean => {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '';
};

const hasAnyValue = (names: string[]): boolean => names.some(hasValue);

function collectEnvWarnings(): string[] {
  if (!isDeployment) return [];

  const warnings: string[] = [];
  const warnMissing = (name: string, message: string): void => {
    if (!hasValue(name)) warnings.push(`${name}: ${message}`);
  };
  const warnMissingAny = (names: string[], message: string): void => {
    if (!hasAnyValue(names)) warnings.push(`${names.join(' / ')}: ${message}`);
  };
  const warnPartial = (names: string[], message: string): void => {
    const present = names.filter(hasValue);
    if (present.length > 0 && present.length < names.length) {
      warnings.push(`${names.join(' + ')}: ${message}`);
    }
  };

  warnMissing('API_URL', 'set the deployed API origin so MCP configs, connect links, and webhooks do not fall back to defaults.');
  warnMissing('WEB_APP_URL', 'set the deployed web app origin for auth, notifications, and integration callbacks.');
  warnMissingAny(['REDIS_URL', 'REDIS_HOST'], 'set Railway Redis; otherwise queues/cache/limiter may target localhost or in-memory fallbacks.');
  warnMissing('S3_ENDPOINT', 'set the Railway bucket endpoint when using Tigris/S3-compatible storage.');
  warnMissing('S3_REGION', 'set the S3 region, often "auto" for Railway buckets.');
  warnMissing('RESEND_API_KEY', 'emails will be skipped, including invite and notification email flows.');
  warnMissing('SENTRY_DSN', 'backend errors and traces will not be reported to Sentry.');
  warnMissing('COMPOSIO_API_KEY', 'external integrations such as Gmail, Notion, Slack, Airtable, and Google Docs are disabled.');
  warnMissing('UNSTRUCTURED_API_URL', 'document parsing for some uploaded file types is disabled.');
  warnMissing('PARALLELS_API_KEY', 'web crawling/profile extraction for links is disabled.');

  warnPartial(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], 'set both values or Google OAuth will not work.');
  warnPartial(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'], 'set both values or Telegram webhook registration will be skipped/rejected.');
  if (hasValue('TELEGRAM_BOT_TOKEN') && !hasValue('TELEGRAM_BOT_USERNAME')) {
    warnings.push('TELEGRAM_BOT_USERNAME: set the bot username so Telegram integration links can be generated.');
  }
  return warnings;
}

const warnings = collectEnvWarnings();
if (warnings.length > 0) {
  console.warn('⚠️ Environment warnings:');
  for (const warning of warnings) {
    console.warn(`   ${warning}`);
  }
}
