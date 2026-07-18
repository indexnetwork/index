import { describe, expect, it } from "bun:test";

import { joinOutcomeHypotheses } from "../outcome.hypotheses.js";
import type { OutcomeLabel } from "../outcome.types.js";
import type { MinedDiscriminator, VerifiedAssignment } from "../../discriminator/discriminator.types.js";

/** Build a two-sided discriminator: `sideA` ids on "A", `sideB` on "B". */
function discriminator(
  label: string,
  sideA: string[],
  sideB: string[],
  opts: { unknown?: string[]; unverifiedA?: string[] } = {},
): MinedDiscriminator {
  const assignments: VerifiedAssignment[] = [
    ...sideA.map((id) => ({ id, side: "A", evidence: "ev", verified: true })),
    ...sideB.map((id) => ({ id, side: "B", evidence: "ev", verified: true })),
    ...(opts.unknown ?? []).map((id) => ({ id, side: null, evidence: null, verified: false })),
    // Unverified proposals (evidence failed) must never count toward support.
    ...(opts.unverifiedA ?? []).map((id) => ({ id, side: "A", evidence: "bad", verified: false })),
  ];
  return { label, questionSeed: `q-${label}`, sides: ["A", "B"], assignments, evidenceRate: 1 };
}

/** Map n accepted + m rejected ids to outcome labels. */
function labels(accepted: string[], rejected: string[]): Map<string, OutcomeLabel> {
  const m = new Map<string, OutcomeLabel>();
  for (const id of accepted) m.set(id, "accepted");
  for (const id of rejected) m.set(id, "rejected");
  return m;
}

const A = (n: number, p = "a") => Array.from({ length: n }, (_, i) => `${p}${i}`);
const B = (n: number, p = "b") => Array.from({ length: n }, (_, i) => `${p}${i}`);

describe("joinOutcomeHypotheses", () => {
  it("emits a hypothesis only when >= 2 sides each clear k=5 independent support", () => {
    const d = discriminator("axis", A(5), B(5));
    // Side A (a0..a4): 3 accepted, 2 rejected. Side B (b0..b4): 4 accepted, 1 rejected.
    const examples = labels(["a0", "a1", "a2", "b0", "b1", "b2", "b3"], ["a3", "a4", "b4"]);
    const result = joinOutcomeHypotheses({ discriminators: [d], examples });

    expect(result.eligibleCount).toBe(1);
    const h = result.hypotheses[0];
    expect(h.label).toBe("axis");
    expect(h.sides.map((s) => s.side).sort()).toEqual(["A", "B"]);
    expect(h.minIndependentSupport).toBe(5);
    const sideA = h.sides.find((s) => s.side === "A")!;
    expect(sideA.independentSupport).toBe(5);
    expect(sideA.acceptRate).toBe(0.6); // 3 accepted / 5
  });

  it("drops a side below k and excludes the hypothesis when < 2 sides qualify", () => {
    const d = discriminator("lopsided", A(5), B(3)); // B has only 3
    const examples = labels([...A(5), ...B(3)], []);
    const result = joinOutcomeHypotheses({ discriminators: [d], examples });
    expect(result.eligibleCount).toBe(0); // only one side qualifies
  });

  it("never counts unverified or unknown assignments toward support (no small cells)", () => {
    // Side A: 5 verified. Side B: 3 verified + 2 unverified => B support = 3 < k.
    const d = discriminator("evidence", A(5), B(3), { unverifiedA: B(2, "bU") });
    const examples = labels([...A(5), ...B(3), ...B(2, "bU")], []);
    const result = joinOutcomeHypotheses({ discriminators: [d], examples });
    expect(result.eligibleCount).toBe(0);
  });

  it("ignores candidates with no owner outcome label (join happens after assignment)", () => {
    const d = discriminator("axis", A(6), B(6));
    // Only 5 per side have a recorded outcome; the 6th on each is unlabeled.
    const examples = labels([...A(5)], [...B(5)]);
    const result = joinOutcomeHypotheses({ discriminators: [d], examples });
    expect(result.eligibleCount).toBe(1);
    expect(result.hypotheses[0].sides.every((s) => s.independentSupport === 5)).toBe(true);
  });

  it("orders hypotheses by min support desc then label asc (deterministic)", () => {
    const weak = discriminator("weak", A(5, "wa"), B(5, "wb"));
    const strong = discriminator("strong", A(8, "sa"), B(7, "sb"));
    const examples = labels(
      [...A(5, "wa"), ...B(5, "wb"), ...A(8, "sa"), ...B(7, "sb")],
      [],
    );
    const result = joinOutcomeHypotheses({ discriminators: [weak, strong], examples });
    expect(result.hypotheses.map((h) => h.label)).toEqual(["strong", "weak"]);
  });

  it("reports poolSize as the number of distinct labeled examples", () => {
    const d = discriminator("axis", A(5), B(5));
    const examples = labels([...A(5), ...B(5)], []);
    const result = joinOutcomeHypotheses({ discriminators: [d], examples });
    expect(result.poolSize).toBe(10);
  });

  it("does not let duplicate assignments inflate independent support", () => {
    const d = discriminator("duplicate-assignments", A(4), B(5));
    // Repeat a0 twice: raw assignment rows would reach 5, but there are only
    // four genuinely distinct examples on side A, so the hypothesis must fail.
    d.assignments.push(
      { id: "a0", side: "A", evidence: "duplicate", verified: true },
      { id: "a0", side: "A", evidence: "duplicate", verified: true },
    );
    const examples = labels([...A(4), ...B(5)], []);
    const result = joinOutcomeHypotheses({ discriminators: [d], examples });
    expect(result.eligibleCount).toBe(0);
  });

  it("rejects empty or duplicate normalized side sets", () => {
    const ids = [...A(5), ...B(5)];
    const examples = labels(ids, []);
    const assignments: VerifiedAssignment[] = ids.map((id, index) => ({
      id,
      side: index < 5 ? "A" : "B",
      evidence: "ev",
      verified: true,
    }));
    const duplicate: MinedDiscriminator = {
      label: "duplicate",
      questionSeed: "q",
      sides: ["A", " A ", "B"],
      assignments,
      evidenceRate: 1,
    };
    const empty: MinedDiscriminator = {
      ...duplicate,
      label: "empty",
      sides: ["A", "B", "   "],
    };
    const result = joinOutcomeHypotheses({ discriminators: [duplicate, empty], examples });
    expect(result.eligibleCount).toBe(0);
  });

  it("excludes an example assigned ambiguously to two sides", () => {
    const d = discriminator("ambiguous", A(5), B(5));
    // a0 is claimed by both sides. Excluding it leaves side A at four distinct
    // examples, below k, so the hypothesis must not become eligible.
    d.assignments.push({ id: "a0", side: "B", evidence: "conflict", verified: true });
    const examples = labels([...A(5), ...B(5)], []);
    const result = joinOutcomeHypotheses({ discriminators: [d], examples });
    expect(result.eligibleCount).toBe(0);
  });
});
