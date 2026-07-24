/** Internal-only metadata persisted when a deadlock causes a stance shift. */
export interface DeadlockShiftRecord {
  reason: "consecutive_non_convergent";
  consecutiveNonConvergent: number;
  threshold: number;
  /** Zero-based session turn index at which the shifted draft happened. */
  shiftedAtTurn: number;
  seat: "initiator" | "counterparty";
  detectedAt: string;
}
