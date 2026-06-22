import * as Sentry from '@sentry/bun';

type SentrySpanAttributeValue = string | number | boolean;

type CompactSentrySpanAttributes = Record<string, SentrySpanAttributeValue | undefined>;

export type SentrySpanAttributes = Record<string, SentrySpanAttributeValue | null | undefined>;

export interface TraceAppOperationOptions {
  name: string;
  op: string;
  forceTransaction?: boolean;
  attributes?: SentrySpanAttributes;
}

function compactAttributes(attributes: SentrySpanAttributes | undefined): CompactSentrySpanAttributes {
  const compacted: CompactSentrySpanAttributes = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value !== null && value !== undefined) {
      compacted[key] = value;
    }
  }
  return compacted;
}

/**
 * Wraps an async operation in a Sentry span.
 * @param options - Span name, operation, transaction flag, and safe attributes.
 * @param fn - The async operation to execute inside the active span.
 * @returns The wrapped operation result.
 */
export function traceAppOperation<T>(
  options: TraceAppOperationOptions,
  fn: () => Promise<T>,
): Promise<T> {
  return Sentry.startSpan(
    {
      name: options.name,
      op: options.op,
      forceTransaction: options.forceTransaction,
      attributes: compactAttributes(options.attributes),
    },
    fn,
  );
}

/**
 * Adds safe attributes to the currently active span when one exists.
 * @param attributes - Sentry span attributes; nullish values are ignored.
 */
export function setSpanAttributes(attributes: SentrySpanAttributes): void {
  const span = Sentry.getActiveSpan();
  if (!span) return;
  span.setAttributes(compactAttributes(attributes));
}

/**
 * Sets the HTTP status on the currently active span when one exists.
 * @param status - HTTP response status code.
 */
export function setSpanHttpStatus(status: number): void {
  const span = Sentry.getActiveSpan();
  if (!span) return;
  Sentry.setHttpStatus(span, status);
}
