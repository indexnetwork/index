import * as Sentry from '@sentry/bun';
import path from 'node:path';

import { loadEnvironmentWithTestLock } from './lib/env/test-environment';
// Runtime env files live at the repo root (see root .env.example). Resolve
// relative to this file (src/ and dist/ are both two levels below the
// services/api package, four below the repo root) so the path works
// regardless of cwd — dev, worktrees, Railway (`cd services/api`), and CLIs.
// No bare `.env` fallback: development is the default when NODE_ENV is unset;
// deployments use platform-injected variables, never files.
const repoRoot = path.resolve(import.meta.dir, '../../..');
loadEnvironmentWithTestLock({
  requestedNodeEnv: process.env.NODE_ENV,
  testEnvPath: path.join(repoRoot, '.env.test'),
  developmentEnvPath: path.join(repoRoot, '.env.development'),
});

const sentryEnvironment =
  process.env.SENTRY_ENVIRONMENT ??
  process.env.RAILWAY_ENVIRONMENT_NAME ??
  process.env.RAILWAY_ENVIRONMENT ??
  process.env.NODE_ENV ??
  'development';
const sentryDsn = process.env.SENTRY_DSN;
const sentryCommitSha = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
const sentryRelease = process.env.SENTRY_RELEASE?.trim() || (sentryCommitSha ? `index-backend@${sentryCommitSha}` : undefined);

const tracesSampleRate = process.env.NODE_ENV === 'development' ? 1.0 : 0.1;

// Loaded via Bun's --preload flag so Sentry initializes before application imports.
Sentry.init({
  dsn: sentryDsn,
  environment: sentryEnvironment,
  release: sentryRelease,
  enabled: Boolean(sentryDsn) && process.env.NODE_ENV !== 'test',

  // Adds request headers and IP addresses to events.
  sendDefaultPii: true,

  // Capture all traces in development and sample production traffic.
  tracesSampleRate,

  integrations: (defaultIntegrations) => [
    ...defaultIntegrations.filter((integration) => !['LangChain', 'LangGraph', 'PostgresJs'].includes(integration.name)),
    // Forward console.warn/error into Sentry Logs (not issues) so structured
    // protocol signals — e.g. presenter_fallback — become queryable in the
    // logs dataset without creating issue noise. Requires enableLogs below.
    Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
    Sentry.langChainIntegration({
      recordInputs: false,
      recordOutputs: false,
    }),
    Sentry.langGraphIntegration({
      recordInputs: false,
      recordOutputs: false,
    }),
    Sentry.postgresJsIntegration(),
  ],

  // Enable Sentry Logs.
  enableLogs: true,
});

const appAttributes = {
  service: 'backend',
  runtime: 'bun',
  'app.environment': sentryEnvironment,
  'app.release': sentryRelease ?? 'unknown',
  'app.commit_sha': sentryCommitSha ?? 'unknown',
  'sentry.traces_sample_rate': tracesSampleRate,
};

Sentry.setTags(appAttributes);
Sentry.getGlobalScope().setAttributes(appAttributes);
