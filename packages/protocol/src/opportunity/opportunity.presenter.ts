/**
 * Thin backward-compat shim — IND-551.
 * Canonical location: opportunity/application/opportunity.presenter.ts
 *
 * Explicit named re-exports are required in addition to export * because
 * some Bun ESM environments do not surface class and function exports
 * through a star re-export chain when the module is loaded indirectly
 * (e.g. radar/radar.graph.ts → ../opportunity.presenter.js → application/).
 */
export * from "./application/opportunity.presenter.js";

// Value exports that must be explicitly named for Bun ESM shim compatibility.
export { OpportunityPresenter, summarizeSignalsForPresenter, gatherPresenterContext, CardLLMSchema } from "./application/opportunity.presenter.js";
export type { PresenterDatabase, OpportunityPresentationResult, CardPresenterInput, CardLLMResult, CardPresentationResult, PresenterInput } from "./application/opportunity.presenter.js";
