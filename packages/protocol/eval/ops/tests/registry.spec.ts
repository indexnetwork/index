import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { renderRun, RunSpecSchema } from "../ops.argv.js";
import { flagValueIssues } from "../ops.flags.js";
import { resolveProfile } from "../ops.profiles.js";
import { HARNESS_REGISTRY, OPS_HARNESSES } from "../ops.registry.js";
import type { OpsHarness } from "../ops.types.js";

/**
 * discovery is the one harness whose spec is invalid without per-side
 * configuration, so a spec built for it here carries a valid minimal pair;
 * otherwise every parse below would fail for a reason the test is not about.
 */
function specFor(harness: OpsHarness, flags: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: "eval" as const,
    harness,
    profile: "default",
    flags,
    ...(harness === "discovery"
      ? { sides: { a: { DISCOVERY_PROFILE_SOURCE: "premise" }, b: { DISCOVERY_PROFILE_SOURCE: "user_context" } } }
      : {}),
  };
}

const AB_CONTRACT_SOURCE = path.join(
  import.meta.dir, "..", "..", "..", "..", "..",
  "services", "api", "src", "cli", "discovery.contract.ts",
);

/** The four scorecard harnesses' own argument parsers — the authority on what they accept. */
const SCORECARD_SOURCES: Readonly<Record<"matching" | "profile" | "premise" | "opportunity", string>> = {
  matching: path.join(import.meta.dir, "..", "..", "matching", "matching.eval.ts"),
  profile: path.join(import.meta.dir, "..", "..", "profile", "profile.eval.ts"),
  premise: path.join(import.meta.dir, "..", "..", "premise", "premise.eval.ts"),
  opportunity: path.join(import.meta.dir, "..", "..", "opportunity", "opportunity.eval.ts"),
};

function flagOf(harness: OpsHarness, name: string) {
  const flag = HARNESS_REGISTRY[harness].flags.find((f) => f.name === name);
  if (flag === undefined) throw new Error(`${harness} has no --${name}`);
  return flag;
}

describe("HARNESS_REGISTRY", () => {
  it("covers the four scorecard harnesses plus discovery", () => {
    const expected: OpsHarness[] = ["discovery", "matching", "opportunity", "premise", "profile"];
    expect([...OPS_HARNESSES].sort()).toEqual(expected);
    expect(Object.keys(HARNESS_REGISTRY).sort()).toEqual(expected);
  });

  it("maps each harness to its package script", () => {
    for (const harness of OPS_HARNESSES) {
      expect(HARNESS_REGISTRY[harness].script).toBe(`eval:${harness}`);
    }
  });

  it("declares a cwd only for the harness whose script is not in packages/protocol", () => {
    // An unset cwd means packages/protocol. discovery's script lives in
    // services/api/package.json, so running it from the default directory would
    // fail with "script not found" rather than doing anything.
    expect(HARNESS_REGISTRY["discovery"].cwd).toBe("services/api");
    for (const harness of OPS_HARNESSES.filter((h) => h !== "discovery")) {
      expect(HARNESS_REGISTRY[harness].cwd).toBeUndefined();
    }
  });

  it("offers discovery only the two flags its parser reads", () => {
    // The engine's parser reads --case, --runs, --a, --b, --report and --force.
    // It does not refuse the rest: it scans for the flags it knows and ignores
    // everything else, so a selectable flag beyond these two would be dropped in
    // silence rather than failing loudly. --a/--b are per-side configuration
    // (not a HarnessFlag) and --report/--force are supplied by the server.
    expect(HARNESS_REGISTRY["discovery"].flags.map((f) => f.cli)).toEqual(["--runs", "--case"]);
  });

  it("pins discovery's run bounds to the engine's own constants", () => {
    // Hand-copied bounds drift. Read the real constants: if the engine lowers
    // its ceiling, a form built from this registry must not keep offering the
    // old one, because the engine refuses it (exit 2) after the operator has
    // already confirmed the workload.
    const source = readFileSync(AB_CONTRACT_SOURCE, "utf8");
    const constantOf = (name: string): number => {
      const match = source.match(new RegExp(`export const ${name} = (\\d+);`));
      if (!match) throw new Error(`${name} not found in discovery.contract.ts`);
      return Number(match[1]);
    };

    const runs = flagOf("discovery", "runs");
    expect(runs.max).toBe(constantOf("AB_MAX_REPETITIONS"));
    // And the bound the API enforces, which is the one a refusal quotes. It is
    // attributed to the harness because the harness is what holds it: exceeding
    // it is exit 2 from parseAbRunArgs, not a policy of this site.
    expect(runs.accepts?.max).toEqual({ value: constantOf("AB_MAX_REPETITIONS"), heldBy: "harness" });
    expect(HARNESS_REGISTRY["discovery"].defaultRuns).toBe(constantOf("AB_DEFAULT_REPETITIONS"));
  });

  it("pins --alpha to the check the four engines actually run", () => {
    // The regression this closes, in one sentence: the registry's 0.001..0.999
    // was authored as a step-resolution approximation for an HTML control, and
    // making it the API's authority refused `--alpha 0.0005` with the sentence
    // "the harness itself would refuse it" — which the harness contradicts, since
    // it runs any 0 < alpha < 1. So the bound is read from the engines, not
    // copied: if one of them ever narrows its check, this fails instead of the
    // site quietly accepting a run that engine will reject.
    for (const [harness, source] of Object.entries(SCORECARD_SOURCES) as [OpsHarness, string][]) {
      const guard = readFileSync(source, "utf8").match(
        /alpha\s*<=\s*(\d+(?:\.\d+)?)\s*\|\|\s*alpha\s*>=\s*(\d+(?:\.\d+)?)/,
      );
      if (guard === null) throw new Error(`no --alpha guard found in ${source}`);
      // `alpha <= 0 || alpha >= 1` is exactly an exclusive 0..1, and that is what
      // the registry must declare — ends included, because the ends are refused.
      expect(flagOf(harness, "alpha").accepts, harness).toEqual({
        min: { value: Number(guard[1]), exclusive: true, heldBy: "harness" },
        max: { value: Number(guard[2]), exclusive: true, heldBy: "harness" },
      });

      // Both extremes the engine runs, and both ends it refuses, through the
      // schema the API parses with.
      for (const alpha of [0.0005, 0.0001, 0.9995]) {
        expect(RunSpecSchema.safeParse(specFor(harness, { alpha })).success, `${harness} alpha ${alpha}`).toBe(true);
      }
      for (const alpha of [Number(guard[1]), Number(guard[2])]) {
        expect(RunSpecSchema.safeParse(specFor(harness, { alpha })).success, `${harness} alpha ${alpha}`).toBe(false);
      }
    }
  });

  it("attributes a bound to the harness only where the harness holds it", () => {
    // --runs is the pair that makes the distinction visible. The scorecard
    // engines refuse a count below 1 and have NO ceiling of their own: 26 runs
    // is this site's refusal (RunFlagsSchema), and a message claiming the
    // harness would refuse it would be false. discovery is the opposite — its
    // ceiling is the engine's, and saying so is the whole value of the refusal.
    for (const [harness, source] of Object.entries(SCORECARD_SOURCES) as [OpsHarness, string][]) {
      const text = readFileSync(source, "utf8");
      expect(text, `${harness} --runs floor`).toMatch(/runs\s*<\s*1/);
      expect(text.match(/runs\s*>\s*\d/), `${harness} caps --runs itself`).toBeNull();
      expect(flagOf(harness, "runs").accepts, harness).toEqual({
        min: { value: 1, heldBy: "harness" },
        max: { value: 25, heldBy: "site" },
      });
    }

    const siteRefusal = flagValueIssues("matching", HARNESS_REGISTRY.matching.flags, { runs: 26 })[0]!.message;
    expect(siteRefusal).toContain("This site accepts --runs no higher than 25");
    expect(siteRefusal).not.toContain("harness itself");

    const harnessRefusal = flagValueIssues("discovery", HARNESS_REGISTRY["discovery"].flags, { runs: 25 })[0]!
      .message;
    expect(harnessRefusal).toContain("the harness itself would refuse it");
  });

  it("declares who holds every numeric bound, and offers no control value the API refuses", () => {
    // A numeric flag with no `accepts` falls back to its control bounds held by
    // the site — true, but mute about the engine. The registry is where the
    // engine's own limits are known, so every numeric flag states them here.
    let checked = 0;
    for (const harness of OPS_HARNESSES) {
      for (const flag of HARNESS_REGISTRY[harness].flags) {
        if (flag.kind !== "number") continue;
        const accepts = flag.accepts;
        expect(accepts, `${harness} ${flag.cli}`).toBeDefined();
        for (const bound of [accepts!.min, accepts!.max]) {
          if (bound === undefined) continue;
          expect(["harness", "site"], `${harness} ${flag.cli}`).toContain(bound.heldBy);
        }
        // The control never offers what the API refuses: an input whose min is
        // below the accepted floor would hand the operator an unlaunchable value.
        if (flag.min !== undefined && accepts!.min !== undefined) {
          const floor = accepts!.min;
          expect(floor.exclusive === true ? flag.min > floor.value : flag.min >= floor.value, `${harness} ${flag.cli} min`).toBe(true);
        }
        if (flag.max !== undefined && accepts!.max !== undefined) {
          const ceiling = accepts!.max;
          expect(ceiling.exclusive === true ? flag.max < ceiling.value : flag.max <= ceiling.value, `${harness} ${flag.cli} max`).toBe(true);
        }
        checked += 1;
      }
    }
    // Guards the guard: fourteen numeric flags across the five harnesses.
    expect(checked).toBe(14);
  });

  it("refuses to render a flag discovery does not accept", () => {
    // The engine ignores what it does not recognise, so nothing downstream would
    // report a flag this entry offered by mistake: the run would simply not be
    // the run the operator configured. renderRun is the last place that can
    // refuse, and it refuses against this entry's flag list — so widening the
    // list widens what argv can carry, and this fails the moment it does.
    const resolved = resolveProfile({ name: "default", description: "d", models: {}, env: {} });
    expect(() =>
      renderRun(
        {
          kind: "eval",
          harness: "discovery",
          profile: "default",
          flags: { tier: 1 },
          // Valid sides, so the only thing wrong with this spec is the flag.
          sides: { a: { DISCOVERY_PROFILE_SOURCE: "premise" }, b: { DISCOVERY_PROFILE_SOURCE: "user_context" } },
        },
        resolved,
        "/tmp/.ops-runs/run-1/report.json",
      ),
    ).toThrow(/does not accept --tier/);
  });

  it("never exposes a destructive flag", () => {
    const destructive = ["--update-baseline", "--force", "--reason", "--report", "--html", "--no-save"];
    for (const harness of OPS_HARNESSES) {
      for (const flag of HARNESS_REGISTRY[harness].flags) {
        expect(destructive).not.toContain(flag.cli);
      }
    }
  });

  it("only offers --tier on matching", () => {
    const hasTier = (h: (typeof OPS_HARNESSES)[number]) =>
      HARNESS_REGISTRY[h].flags.some((f) => f.name === "tier");
    expect(hasTier("matching")).toBe(true);
    expect(hasTier("premise")).toBe(false);
  });

  it("accepts every declared bound and refuses the first value past each one", () => {
    // Every (harness, numeric flag) pair, not one representative per flag name:
    // discovery narrows --runs to its own ceiling, so a per-name check would
    // never look at it.
    //
    // This once recorded discovery --runs 25 as an accepted spec the engine
    // refuses; RunSpecSchema now enforces each harness's own bounds
    // (flagValueIssues, ops.flags.ts), so there is no direction left to assert
    // instead of a refusal. What is asserted is both halves of the two-bound
    // split: every CONTROL bound launches, and the first value past each API
    // bound does not — which for --alpha's exclusive ends is the ends
    // themselves, 0 and 1, and not the 0.0005 the engines run.
    const numericFlags = OPS_HARNESSES.flatMap((harness) =>
      HARNESS_REGISTRY[harness].flags.filter((flag) => flag.kind === "number").map((flag) => ({ harness, flag })),
    );
    expect(numericFlags.length).toBe(14);

    for (const { harness, flag } of numericFlags) {
      const step = flag.step ?? 1;
      // Every value the control offers launches: an input whose min the schema
      // refuses would hand the operator a value that cannot run.
      for (const value of [flag.min, flag.max]) {
        if (value === undefined) continue;
        expect(
          RunSpecSchema.safeParse(specFor(harness, { [flag.name]: value })).success,
          `${harness} ${flag.cli} ${value}`,
        ).toBe(true);
      }

      // And the first value past each API bound is refused: an exclusive bound
      // refuses its own value (--alpha 0 and 1), an inclusive one refuses the
      // next step beyond it (--runs 0 and 26).
      const { min, max } = flag.accepts ?? {};
      const past = [
        ...(min === undefined ? [] : [min.exclusive === true ? min.value : min.value - step]),
        ...(max === undefined ? [] : [max.exclusive === true ? max.value : max.value + step]),
      ];
      for (const value of past) {
        expect(
          RunSpecSchema.safeParse(specFor(harness, { [flag.name]: value })).success,
          `${harness} accepted ${flag.cli} ${value}`,
        ).toBe(false);
      }
    }

    // The pair that motivated the change, stated once in full: this harness's
    // ceiling is below the shared schema's, and the schema now honours it.
    const abRuns = HARNESS_REGISTRY["discovery"].flags.find((flag) => flag.name === "runs")!;
    expect(abRuns.max).toBeLessThan(25);
    expect(() => RunSpecSchema.parse(specFor("discovery", { runs: 25 }))).toThrow(/--runs/);
    expect(() => RunSpecSchema.parse(specFor("matching", { runs: 25 }))).not.toThrow();
  });
});
