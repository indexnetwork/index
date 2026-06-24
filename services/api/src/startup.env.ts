import { config } from 'dotenv';
import { z } from 'zod';

const environment = process.env.NODE_ENV;

const dotenvPathByEnvironment: Record<string, string> = {
  development: '.env.development',
  production: '.env.production',
  test: '.env.test',
};
const dotenvPath = (environment && dotenvPathByEnvironment[environment]) || '.env';

config({ path: dotenvPath });

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
const requiredUnlessTest = isTest ? z.string().optional() : z.string().trim().min(1);
const requiredInProduction = isTest || runtimeEnvironment !== 'production' ? z.string().optional() : z.string().trim().min(1);
const optionalUrl = z.union([z.literal(''), z.string().url()]).optional();
const optionalInt = z.union([z.literal(''), z.string().regex(/^\d+$/)]).optional();
const optionalBoolean = z.union([z.literal(''), z.enum(['true', 'false'])]).optional();
const optionalOne = z.union([z.literal(''), z.literal('1')]).optional();

const envSchema = z.object({
  // 1. Core
  DATABASE_URL: z.string().url(),
  PORT: z.string().regex(/^\d+$/).default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BASE_URL: optionalUrl,
  API_BASE_URL: optionalUrl,
  APP_URL: optionalUrl,
  FRONTEND_URL: optionalUrl,

  // 2. Authentication
  BETTER_AUTH_SECRET: requiredUnlessTest,
  CONNECT_JWT_SECRET: requiredInProduction,
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  TRUSTED_ORIGINS: z.string().optional(),

  // 3. LLM / AI (OpenRouter)
  OPENROUTER_API_KEY: requiredUnlessTest,
  OPENROUTER_BASE_URL: optionalUrl,
  OPENROUTER_REQUEST_TIMEOUT_MS: optionalInt,
  OPENROUTER_MAX_RETRIES: optionalInt,
  CHAT_MODEL: z.string().optional(),
  CHAT_REASONING_EFFORT: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIMENSIONS: optionalInt,
  SMARTEST_VERIFIER_MODEL: z.string().optional(),
  SMARTEST_GENERATOR_MODEL: z.string().optional(),

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
  PRESIGNED_URL_EXPIRATION_SECONDS: optionalInt,

  // 6. Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_PRODUCTION_MODE: optionalBoolean,
  TESTING_EMAIL_ADDRESS: z.union([z.literal(''), z.string().email()]).optional(),

  // 7. Integrations
  COMPOSIO_API_KEY: z.string().optional(),
  UNSTRUCTURED_API_URL: optionalUrl,
  PARALLELS_API_KEY: z.string().optional(),

  // 8. Discovery / protocol runtime
  AUTO_JOIN_INDEX_IDS: z.string().optional(),
  CONTACTS_ENABLED: optionalBoolean,
  CONTACT_DEDUP_STRATEGY: z.enum(['conservative', 'balanced', 'aggressive', 'off']).optional(),
  RUN_OPPORTUNITY_EVAL_IN_PARALLEL: optionalBoolean,
  DISCOVERY_CONTEXT_TO_INTENT: z.union([z.literal(''), z.literal('0'), z.literal('1')]).optional(),
  ENABLE_DISCOVERY_QUESTIONS: optionalBoolean,
  DISCOVERY_QUESTIONS_INPUT_MODE: z.string().optional(),
  DISCOVERY_QUESTIONS_TIMEOUT_MS: optionalInt,
  NEGOTIATION_SUMMARY_TIMEOUT_MS: optionalInt,
  NEGOTIATION_MAX_TURNS_CHAT: optionalInt,
  NEGOTIATION_MAX_TURNS_AMBIENT: optionalInt,
  NEGOTIATOR_TURN_TIMEOUT_MS: optionalInt,
  QUESTIONER_ENABLED: optionalBoolean,

  // 9. MCP / tool runtime
  MCP_MAX_REQUEST_BYTES: optionalInt,
  MCP_TOOL_TIMEOUT_FAST_MS: optionalInt,
  MCP_TOOL_TIMEOUT_BOUNDED_SLOW_MS: optionalInt,
  MCP_TOOL_TIMEOUT_ASYNC_CANDIDATE_MS: optionalInt,
  MCP_TOOL_MAX_OUTPUT_BYTES: optionalInt,

  // 10. Rate limiting
  LIMITER_AUTH_WRITE_PER_MIN: optionalInt,
  LIMITER_READ_PER_MIN: optionalInt,
  LIMITER_WRITE_PER_MIN: optionalInt,
  MCP_HTTP_LIMIT_PER_MIN: optionalInt,
  LIMITER_IP_HEADERS: z.string().optional(),
  LIMITER_DISABLE: optionalOne,

  // 11. Telegram Bot
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_WEBHOOK_URL: optionalUrl,

  // 12. Observability
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: optionalUrl,
  SENTRY_DSN: optionalUrl,
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.string().optional(),
  ENABLE_SENTRY_TEST_ENDPOINT: optionalBoolean,
  LOG_LEVEL: z.union([z.literal(''), z.enum(['verbose', 'debug', 'info', 'warn', 'error'])]).optional(),
  LOG_FILTER: z.string().optional(),
  ENABLE_DEBUG_API: optionalBoolean,
  ADMIN_QUEUES_PORT: optionalInt,

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

  warnMissingAny(['BASE_URL', 'API_BASE_URL', 'APP_URL'], 'set the deployed API origin so MCP configs, connect links, and webhooks do not fall back to defaults.');
  warnMissing('CONNECT_JWT_SECRET', 'connect redirect tokens will use the local development fallback unless NODE_ENV=production, where startup fails.');
  warnMissingAny(['FRONTEND_URL', 'APP_URL'], 'set the deployed frontend origin for auth, notifications, and integration callbacks.');
  warnMissingAny(['REDIS_URL', 'REDIS_HOST'], 'set Railway Redis; otherwise queues/cache/limiter may target localhost or in-memory fallbacks.');
  warnMissing('S3_ENDPOINT', 'set the Railway bucket endpoint when using Tigris/S3-compatible storage.');
  warnMissing('S3_REGION', 'set the S3 region, often "auto" for Railway buckets.');
  warnMissing('RESEND_API_KEY', 'emails will be skipped, including invite and notification email flows.');
  warnMissing('SENTRY_DSN', 'backend errors and traces will not be reported to Sentry.');
  warnMissing('COMPOSIO_API_KEY', 'external integrations such as Gmail, Notion, Slack, Airtable, and Google Docs are disabled.');
  warnMissing('UNSTRUCTURED_API_URL', 'document parsing for some uploaded file types is disabled.');
  warnMissing('PARALLELS_API_KEY', 'web crawling/profile extraction for links is disabled.');

  warnPartial(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], 'set both values or Google OAuth will not work.');
  warnPartial(['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY'], 'set both values or Langfuse tracing will not work.');
  warnPartial(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'], 'set both values or Telegram webhook registration will be skipped/rejected.');
  if (hasValue('TELEGRAM_BOT_TOKEN') && !hasValue('TELEGRAM_BOT_USERNAME')) {
    warnings.push('TELEGRAM_BOT_USERNAME: set the bot username so Telegram integration links can be generated.');
  }
  const discoveryQuestionsInputMode = process.env.DISCOVERY_QUESTIONS_INPUT_MODE?.trim();
  if (discoveryQuestionsInputMode && !['transcripts', 'insights'].includes(discoveryQuestionsInputMode)) {
    warnings.push('DISCOVERY_QUESTIONS_INPUT_MODE: expected "transcripts" or "insights"; current value will fall back to transcript mode.');
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
