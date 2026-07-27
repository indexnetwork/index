/**
 * Compatibility re-export shim — IND-543.
 *
 * The canonical implementation has moved to
 *   runtime/foreground/composition/tool.registry.ts
 * (interaction-composition concern).
 *
 * This shim preserves all existing import paths inside the package and in
 * src/index.ts so that consumers need zero changes from this relocation.
 * It will be removed once direct importers are migrated.
 */
export { createToolRegistry } from '../../runtime/foreground/composition/tool.registry.js';
