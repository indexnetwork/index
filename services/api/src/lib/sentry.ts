import * as Sentry from '@sentry/bun';

export interface CaptureAppExceptionOptions {
  subsystem: string;
  operation: string;
  tags?: Record<string, string | number | boolean | null | undefined>;
  context?: Record<string, unknown>;
  userId?: string;
}

export function captureAppException(error: unknown, options: CaptureAppExceptionOptions): string {
  return Sentry.withScope((scope) => {
    scope.setTag('service', 'backend');
    scope.setTag('subsystem', options.subsystem);
    scope.setTag('operation', options.operation);

    for (const [key, value] of Object.entries(options.tags ?? {})) {
      if (value !== undefined && value !== null) {
        scope.setTag(key, value);
      }
    }

    if (options.userId) {
      scope.setUser({ id: options.userId });
    }

    if (options.context) {
      scope.setContext('app', options.context);
    }

    return Sentry.captureException(error);
  });
}
