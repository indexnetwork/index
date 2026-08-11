export interface HermesPreflightReport {
  invalidLegacyMetadata: number;
  duplicateSelections: number;
  invalidDedicatedCredentials: number;
  expiryMismatches: number;
  missingIndexes: number;
  lockDurationMs: number;
  checkedAt: string;
}

export interface HermesPreflightThresholds {
  maxLockMs: number;
  maxTotalMs: number;
}

/**
 * Classify the legacy `apikey.metadata` text column without returning its
 * payload. Callers must never cast or inspect malformed text before this step.
 */
export function parseLegacyMetadata(metadata: string | null): { valid: boolean } {
  if (metadata === null) return { valid: true };
  try {
    JSON.parse(metadata);
    return { valid: true };
  } catch {
    return { valid: false };
  }
}

function assertValidReport(report: HermesPreflightReport): void {
  const counts = [
    report.invalidLegacyMetadata,
    report.duplicateSelections,
    report.invalidDedicatedCredentials,
    report.expiryMismatches,
    report.missingIndexes,
  ];
  const checkedAt = new Date(report.checkedAt);
  if (counts.some((value) => !Number.isSafeInteger(value) || value < 0)
    || !Number.isFinite(report.lockDurationMs)
    || report.lockDurationMs < 0
    || Number.isNaN(checkedAt.getTime())
    || checkedAt.toISOString() !== report.checkedAt) {
    throw new Error('invalid preflight report');
  }
}

/** Serialize the fixed, low-cardinality report and discard any extra runtime fields. */
export function formatPreflightReport(report: HermesPreflightReport): string {
  assertValidReport(report);
  return JSON.stringify({
    invalidLegacyMetadata: report.invalidLegacyMetadata,
    duplicateSelections: report.duplicateSelections,
    invalidDedicatedCredentials: report.invalidDedicatedCredentials,
    expiryMismatches: report.expiryMismatches,
    missingIndexes: report.missingIndexes,
    lockDurationMs: report.lockDurationMs,
    checkedAt: report.checkedAt,
  });
}

export function assertPreflightPass(
  report: HermesPreflightReport,
  thresholds?: HermesPreflightThresholds & { totalDurationMs?: number },
): void {
  assertValidReport(report);

  const failures: string[] = [];
  if (report.invalidLegacyMetadata > 0) failures.push('invalid legacy API-key metadata');
  if (report.duplicateSelections > 0) failures.push('duplicate selected executors');
  if (report.invalidDedicatedCredentials > 0) failures.push('invalid dedicated credentials');
  if (report.expiryMismatches > 0) failures.push('credential expiry mismatches');
  if (report.missingIndexes > 0) failures.push('missing or invalid indexes/constraints');
  if (thresholds) {
    if (report.lockDurationMs > thresholds.maxLockMs) failures.push('lock duration threshold exceeded');
    if (thresholds.totalDurationMs !== undefined
      && thresholds.totalDurationMs > thresholds.maxTotalMs) {
      failures.push('total duration threshold exceeded');
    }
  }
  if (failures.length > 0) throw new Error(`Hermes migration preflight failed: ${failures.join(', ')}`);
}
