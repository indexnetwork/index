import * as Sentry from '@sentry/bun';
import { config } from 'dotenv';

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

const sentryEnvironment =
  process.env.SENTRY_ENVIRONMENT ??
  process.env.RAILWAY_ENVIRONMENT_NAME ??
  process.env.RAILWAY_ENVIRONMENT ??
  process.env.NODE_ENV ??
  'development';
const sentryDsn = process.env.SENTRY_DSN;

// Loaded via Bun's --preload flag so Sentry initializes before application imports.
Sentry.init({
  dsn: sentryDsn,
  environment: sentryEnvironment,
  enabled: Boolean(sentryDsn) && process.env.NODE_ENV !== 'test',

  // Adds request headers and IP addresses to events.
  sendDefaultPii: true,

  // Capture all traces in development and sample production traffic.
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

  // Enable Sentry Logs.
  enableLogs: true,
});

Sentry.setTags({
  service: 'backend',
  runtime: 'bun',
  'app.environment': sentryEnvironment,
});
