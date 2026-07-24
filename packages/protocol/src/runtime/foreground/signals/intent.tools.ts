/**
 * runtime/foreground/signals/intent.tools — foreground signals-adapter seam.
 *
 * Canonical runtime registration point for intent/signal tools in the
 * participant-facing (foreground) interaction layer.  Re-exports the tool
 * factory from the signals application layer so the foreground tool registry
 * consumes the adapter rather than reaching directly into the signals
 * implementation directory.
 *
 * Boundary: interaction-composition.  Imports signals only via the signals
 * application contracts; must not import host implementations.
 */
export {
  createIntentTools,
  setIntentClarifierForTesting,
  describeIntentUpdateFailure,
} from "../../../signals/application/intent.tools.js";
