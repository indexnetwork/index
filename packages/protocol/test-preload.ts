/**
 * Bun test preload — runs before any test module is evaluated.
 *
 * Loads the repo-root `.env.test` (see the root `.env.example`). Individual
 * spec files historically loaded a package-local `.env.test` with
 * `override: true`; those calls are now harmless no-ops since runtime env
 * files moved to the repo root.
 */
import { config } from "dotenv";
import path from "node:path";

config({ path: path.resolve(import.meta.dir, "../../.env.test"), override: true });
