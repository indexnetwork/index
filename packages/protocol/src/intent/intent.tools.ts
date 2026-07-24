/**
 * @deprecated Canonical location: signals/application/intent.tools (tool factory)
 * and runtime/foreground/signals/intent.tools (foreground adapter).
 * Retained for backward compatibility during IND-544 migration.
 */
export {
  createIntentTools,
  setIntentClarifierForTesting,
  describeIntentUpdateFailure,
} from "../signals/application/intent.tools.js";
