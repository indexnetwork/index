/**
 * runtime/background — IND-543 outer shell.
 *
 * Entry point for ambient / background workflow adapters: maintenance graphs,
 * enrichment runners, negotiation schedulers, and other non-interactive
 * entry points that operate without a live participant session.
 *
 * Boundary: ambient-background.  May import from any capability via its
 * capabilities/*.facade.ts contract.  Must not import host implementations.
 *
 * Shell is intentionally empty at this phase (IND-543 outer seam only).
 * Domain-level adapter relocations follow in subsequent issues.
 */
