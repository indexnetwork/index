/**
 * @deprecated — canonical location is `signals/domain/intent.state`.
 * This module is a backward-compatibility re-export retained so existing
 * imports inside `intent/` continue to resolve without change while the
 * signals module migration (IND-544) proceeds incrementally.
 *
 * Do not add new exports here; add them to `signals/domain/intent.state.ts`
 * and let them flow through this shim.
 */
export {
  type VerifiedIntent,
  type IntentValidationFailureCategory,
  type IntentValidationFailure,
  type ExecutionResult,
  IntentGraphState,
} from "../signals/domain/intent.state.js";
