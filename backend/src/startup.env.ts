import { config } from 'dotenv';
import { z } from 'zod';

const environment = process.env.NODE_ENV;

const dotenvPath =
  environment === 'development'
    ? '.env.development'
    : environment === 'production'
      ? '.env.production'
      : environment === 'test'
        ? '.env.test'
        : '.env';

config({ path: dotenvPath });

// ---------------------------------------------------------------------------
// Environment validation
// Validates process.env on startup. Does NOT change how code accesses env vars
// — all existing process.env.* usage continues to work as-is.
// ---------------------------------------------------------------------------

const isTest = environment === 'test';
const requiredUnlessTest = isTest ? z.string().optional() : z.string().min(1);

const envSchema = z.object({
  // 1. Core
  DATABASE_URL: z.string().url(),
  PORT: z.string().default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BASE_URL: z.string().url().optional(),
  FRONTEND_URL: z.string().url().optional(),

  // 2. Authentication
  BETTER_AUTH_SECRET: requiredUnlessTest,
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  TRUSTED_ORIGINS: z.string().optional(),

  // 3. LLM / AI (OpenRouter)
  OPENROUTER_API_KEY: requiredUnlessTest,
  OPENROUTER_BASE_URL: z.string().url().optional(),
  CHAT_MODEL: z.string().optional(),
  CHAT_REASONING_EFFORT: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIMENSIONS: z.string().regex(/^\d+$/).optional(),
  SMARTEST_VERIFIER_MODEL: z.string().optional(),
  SMARTEST_GENERATOR_MODEL: z.string().optional(),

  // 4. Redis
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.string().regex(/^\d+$/).optional(),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().regex(/^\d+$/).optional(),

  // 5. Storage (S3-compatible)
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  PRESIGNED_URL_EXPIRATION_SECONDS: z.string().regex(/^\d+$/).optional(),

  // 7. Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_PRODUCTION_MODE: z.string().optional(),
  TESTING_EMAIL_ADDRESS: z.string().email().optional(),

  // 8. Integrations
  COMPOSIO_API_KEY: z.string().optional(),
  UNSTRUCTURED_API_URL: z.string().url().optional(),
  PARALLELS_API_KEY: z.string().optional(),

  // 10. Onboarding
  AUTO_JOIN_INDEX_IDS: z.string().optional(),

  // 9. Observability
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().url().optional(),
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.string().optional(),
  LOG_LEVEL: z.enum(['verbose', 'debug', 'info', 'warn', 'error']).optional(),
  LOG_FILTER: z.string().optional(),
  ENABLE_DEBUG_API: z.string().optional(),
  ADMIN_QUEUES_PORT: z.string().regex(/^\d+$/).optional(),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('❌ Invalid environment variables:');
  for (const issue of result.error.issues) {
    console.error(`   ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}
