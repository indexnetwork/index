/**
 * runtime/foreground — IND-543 outer shell.
 *
 * Entry point for participant-directed (foreground) interaction composition:
 * tool registry assembly, chat adapters, MCP adapters, persona adapters.
 *
 * Boundary: interaction-composition.  May import from any capability via its
 * capabilities/*.facade.ts contract.  Must not import host implementations.
 *
 * Curated temporary alias — the canonical implementation lives here;
 * shared/agent/tool.registry.ts is a backward-compat shim that delegates here.
 */
export { createToolRegistry } from './composition/tool.registry.js';
