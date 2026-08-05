import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isCredentialEnvKey } from "../ops.allowlist.js";
import { HARNESS_ENV_KEYS } from "../ops.envcatalog.js";
import { buildEnvCatalog, ENV_SECRET_KEYS, HARNESS_ENTRY_POINTS, PROTOCOL_ROOT, renderEngineFlags, renderEnvCatalog } from "../ops.envcatalog.build.js";
import { reachableEnvKeys, referencedEnvKeys } from "../ops.envscan.js";
import { OPS_HARNESSES } from "../ops.registry.js";

const CATALOG_FILE = path.join(PROTOCOL_ROOT, "eval/ops/ops.envcatalog.ts");
const ENGINE_FLAGS_FILE = path.resolve(PROTOCOL_ROOT, "../../services/api/src/cli/discovery.flags.ts");

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

  it("keeps the engine's forced copy byte-identical to what it would generate", () => {
    // services/api cannot import this catalogue (rootDir ./src makes it TS6059,
    // and the package exports only its built dist entry), so the engine holds a
    // copy. Generating that copy rather than typing it is what stops the two
    // from disagreeing — and a disagreement here is not cosmetic: the engine's
    // list decides which flags a run refuses, so a stale copy refuses a flag
    // the graph does read, with a message asserting it does not.
    expect(renderEngineFlags(buildEnvCatalog())).toEqual(readFileSync(ENGINE_FLAGS_FILE, "utf8"));
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

describe("buildEnvCatalog", () => {
  it("refuses a harness whose entry point does not exist", () => {
    // reachableEnvKeys skips a path that is not there, so before this guard a
    // typo'd entry point derived an empty set and the site offered that harness
    // no environment at all — indistinguishable, in the UI, from a harness that
    // genuinely reads nothing. Proved by deleting premise.eval.ts, which
    // silently yielded "premise": []. An empty temp root reproduces the same
    // condition without touching the tree.
    const emptyRoot = mkdtempSync(path.join(tmpdir(), "envcatalog-"));
    try {
      expect(() => buildEnvCatalog(emptyRoot)).toThrow(/entry point not found/);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("names the harness and the path it looked for", () => {
    // The error has to be actionable: "not found" alone would leave a reader
    // guessing which of five harnesses moved.
    const emptyRoot = mkdtempSync(path.join(tmpdir(), "envcatalog-"));
    try {
      expect(() => buildEnvCatalog(emptyRoot)).toThrow(/matching/);
      expect(() => buildEnvCatalog(emptyRoot)).toThrow(/HARNESS_ENTRY_POINTS/);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
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

/**
 * The catalogue is the request boundary: `validateConfigOverrides` asks it
 * whether a browser may set a key. So "what reached the catalogue" and "what a
 * credential is" have to be checked against each other, not just against a list
 * somebody maintained.
 */
describe("credential shape", () => {
  it("offers no key that is shaped like a credential", () => {
    // The strong form of the guard: not "the two known secrets are absent" but
    // "nothing a reasonable person would call a credential is present". This is
    // what catches a secret nobody has added to a list yet — the case that made
    // the exact-match denylist fail open, since a new API key reaching a harness
    // closure would have been offered until someone noticed.
    for (const harness of OPS_HARNESSES) {
      for (const key of HARNESS_ENV_KEYS[harness]) {
        expect(isCredentialEnvKey(key), `${harness} offers credential-shaped key ${key}`).toBe(false);
      }
    }
  });

  it("classifies the candidate universe the way a reader would", () => {
    // Pins the rule against every key named anywhere in src/ and eval/, so a
    // pattern change that started matching model knobs, or stopped matching
    // endpoints, fails here rather than in a browser form. Spelled out because
    // this is the list a reviewer should be able to check by eye.
    const universe = [...referencedEnvKeys([path.join(PROTOCOL_ROOT, "src"), path.join(PROTOCOL_ROOT, "eval")])];
    const flagged = universe.filter((key) => isCredentialEnvKey(key)).sort();
    expect(flagged).toEqual([
      "API_URL",
      "DATABASE_URL",
      "EVAL_OPS_UI_URL",
      "KEY",
      "NEON_API_KEY",
      "OPENROUTER_API_KEY",
      "OPENROUTER_BASE_URL",
      "SOME_KEY",
      "TEST_EVAL_SECRET",
      "WEB_APP_URL",
    ]);
  });

  it("leaves model and provider knobs settable", () => {
    // The rule has to be narrow enough to be useful. These are the keys an
    // operator legitimately configures, and every one of them would be lost to a
    // pattern that matched on "MODEL" or on any underscore-separated noun.
    for (const key of SCORECARD_KEYS) {
      expect(isCredentialEnvKey(key), `${key} must stay offerable`).toBe(false);
    }
  });

  it("refuses a credential the generator never saw, by shape alone", () => {
    // The names in the review's fake-root reproduction. None is in ENV_SECRET_KEYS;
    // all must still be refused, because that is the difference between a list
    // that has to be updated in advance and a rule that does not.
    for (const key of ["OPENROUTER_API_KEY_2", "ANTHROPIC_API_KEY", "DATABASE_URL", "NEON_API_KEY", "REDIS_URL"]) {
      expect(isCredentialEnvKey(key), `${key} must be refused`).toBe(true);
    }
  });

  it("covers the two named secrets by shape alone, so the list is redundant", () => {
    // The design doc claims deleting ENV_SECRET_KEYS would change nothing,
    // because the shape rule already covers both entries — and keeps the list
    // only to name the two keys this system actually holds. That claim was
    // unpinned: `isCredentialEnvKey` consults the list FIRST, so every test
    // above passes whether or not the shape rule covers these two names, and
    // the nearest test exercises only names that were never on the list.
    //
    // This is the missing half: the shape rule alone, applied to the very keys
    // the list names. If a rename escapes it (OPENROUTER_APIKEY, say) this
    // fails, and the list stops being redundant — which is the fact the doc
    // asserts and the reason the list is safe to keep.
    const source = readFileSync(path.join(import.meta.dir, "..", "ops.allowlist.ts"), "utf8");
    const literal = source.match(/const CREDENTIAL_NAME_PATTERN\s*=\s*\/(.+)\/([a-z]*)\s*;/);
    if (!literal) throw new Error("CREDENTIAL_NAME_PATTERN not found in ops.allowlist.ts");
    const shapeOnly = new RegExp(literal[1]!, literal[2]!);

    expect(ENV_SECRET_KEYS.length).toBeGreaterThan(0);
    for (const key of ENV_SECRET_KEYS) {
      expect(shapeOnly.test(key), `${key} must be caught by the shape rule alone`).toBe(true);
    }
  });
});
