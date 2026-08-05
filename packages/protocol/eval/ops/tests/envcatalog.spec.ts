import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { HARNESS_ENV_KEYS } from "../ops.envcatalog.js";
import { buildEnvCatalog, ENV_SECRET_KEYS, HARNESS_ENTRY_POINTS, PROTOCOL_ROOT, renderEnvCatalog } from "../ops.envcatalog.build.js";
import { reachableEnvKeys } from "../ops.envscan.js";
import { OPS_HARNESSES } from "../ops.registry.js";

const CATALOG_FILE = path.join(PROTOCOL_ROOT, "eval/ops/ops.envcatalog.ts");

/**
 * The eight model and provider keys every scorecard harness reaches. They are
 * spelled out rather than counted because a count passes when two keys swap,
 * and swapping is the realistic failure: these arrive through a shared model
 * adapter, so one refactor can change which of them survives.
 */
const SCORECARD_KEYS = [
  "CHAT_MODEL",
  "CHAT_REASONING_EFFORT",
  "EVAL_MODEL_OVERRIDES",
  "OPENROUTER_FALLBACK_MODEL",
  "OPENROUTER_MAX_RETRIES",
  "OPENROUTER_REQUEST_TIMEOUT_MS",
  "OPENROUTER_RUNNABLE_MAX_ATTEMPTS",
  "SMARTEST_VERIFIER_MODEL",
];

/**
 * The one scorecard key discovery does *not* reach.
 *
 * `SMARTEST_VERIFIER_MODEL` is read in src/shared/agent/tests/llm-assert.ts, a
 * test-only assertion helper the four eval harnesses import. The opportunity
 * graph is production code and never loads it. That asymmetry is the catalogue
 * working as intended — an operator configuring a discovery run is not offered
 * a knob that only moves an eval harness's own verifier.
 */
const VERIFIER_ONLY_KEY = "SMARTEST_VERIFIER_MODEL";

/** The twenty-six discovery reads, in full. */
const DISCOVERY_KEYS = [
  ...SCORECARD_KEYS.filter((key) => key !== VERIFIER_ONLY_KEY),
  "DISCOVERY_ALLOWED_TYPES",
  "DISCOVERY_CONTEXT_TO_INTENT",
  "DISCOVERY_PROFILE_SOURCE",
  "DISCOVERY_REJECTION_COOLDOWN_DAYS",
  "DISCOVERY_SOURCE_PREMISE_LIMIT",
  "HYDE_FRAME_CONSTRAINTS_ENABLED",
  "NEGOTIATION_ASK_USER_ENABLED",
  "NEGOTIATION_ASK_USER_WINDOW_MS",
  "NEGOTIATION_CONSULTATION_POLICY_MODE",
  "NEGOTIATION_DEADLOCK_SHIFT_ENABLED",
  "NEGOTIATION_DEADLOCK_THRESHOLD",
  "NEGOTIATION_INCLUDE_OTHER_INTENTS",
  "NEGOTIATION_MAX_TURNS_AMBIENT",
  "NEGOTIATION_MAX_TURNS_CHAT",
  "NEGOTIATION_PROTOCOL_VERSION",
  "NEGOTIATION_SCREEN_MODE",
  "NEGOTIATOR_STANCE",
  "NEGOTIATOR_TURN_TIMEOUT_MS",
  "RUN_OPPORTUNITY_EVAL_IN_PARALLEL",
].sort();

describe("HARNESS_ENV_KEYS", () => {
  it("matches a fresh scan of the code, byte for byte", () => {
    // The whole point of the catalogue: the committed file is a cache of what
    // the code says, so it is compared against a regeneration rather than
    // eyeballed. Rendering both sides means a formatting drift fails too — the
    // committed file must be exactly what the generator would write.
    expect(renderEnvCatalog(buildEnvCatalog())).toEqual(readFileSync(CATALOG_FILE, "utf8"));
  });

  it("offers every harness the site can launch, and nothing else", () => {
    expect(Object.keys(HARNESS_ENV_KEYS).sort()).toEqual([...OPS_HARNESSES].sort());
  });

  it("offers discovery exactly the twenty-six keys its graph reads", () => {
    expect([...HARNESS_ENV_KEYS.discovery]).toEqual(DISCOVERY_KEYS);
  });

  it.each(["matching", "profile", "premise", "opportunity"] as const)(
    "offers %s exactly the eight model and provider keys it reads",
    (harness) => {
      expect([...HARNESS_ENV_KEYS[harness]]).toEqual(SCORECARD_KEYS);
    },
  );

  it("gives discovery every scorecard key except the test-only verifier", () => {
    // Discovery runs the real opportunity graph, so it reaches every product
    // flag the scorecards do — plus nineteen they cannot. The single exception
    // is the verifier model, which lives in a test helper production code never
    // loads. Pinned rather than waved through: if discovery ever *did* reach it,
    // that would mean the graph had picked up a test-only import.
    for (const harness of ["matching", "profile", "premise", "opportunity"] as const) {
      for (const key of HARNESS_ENV_KEYS[harness]) {
        if (key === VERIFIER_ONLY_KEY) {
          expect(HARNESS_ENV_KEYS.discovery).not.toContain(key);
          continue;
        }
        expect(HARNESS_ENV_KEYS.discovery).toContain(key);
      }
    }
    expect(HARNESS_ENV_KEYS.discovery.length).toBeGreaterThan(HARNESS_ENV_KEYS.matching.length);
  });

  it("is sorted and free of duplicates, so a diff shows a real change", () => {
    for (const harness of OPS_HARNESSES) {
      const keys = [...HARNESS_ENV_KEYS[harness]];
      expect(keys).toEqual([...keys].sort());
      expect(new Set(keys).size).toEqual(keys.length);
    }
  });
});

describe("ENV_SECRET_KEYS", () => {
  it("is excluded from every harness's catalogue", () => {
    // The first of the two independent guards named in the spec. A credential
    // offered in a browser form is a way to bill another account or repoint a
    // run at another endpoint; the second guard lives at the request boundary,
    // so neither alone can publish one.
    for (const harness of OPS_HARNESSES) {
      for (const secret of ENV_SECRET_KEYS) {
        expect(HARNESS_ENV_KEYS[harness]).not.toContain(secret);
      }
    }
  });

  it("names keys the harnesses really do read, so the exclusion is load-bearing", () => {
    // If a secret stopped being reachable, excluding it would be theatre and
    // this test would say so. Scanned directly rather than read from the
    // catalogue, which by construction cannot contain them.
    for (const harness of OPS_HARNESSES) {
      const entry = path.join(PROTOCOL_ROOT, HARNESS_ENTRY_POINTS[harness]);
      const reachable = reachableEnvKeys(entry, ENV_SECRET_KEYS);
      expect([...reachable].sort()).toEqual([...ENV_SECRET_KEYS].sort());
    }
  });
});
