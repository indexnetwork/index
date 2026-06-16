import { htmlEscape, rateClass, htmlRateCI, renderRuleTable, renderScorecardShell, type HumanReport, type Regression } from "../shared/index.js";
import type { AssertionKind, CaseResult, ProfileCase, Rule, Scorecard, ProfileRunDetail } from "./profile.types.js";

// ─── Plain-language copy for the non-technical report ────────────────────────

/** Ordered themes for "What we tested", each mapped to one or more rules. */
const GROUPS: { ruleIds: Rule[]; label: string; blurb: string }[] = [
  { ruleIds: ["privacy"], label: "Privacy: never leaking contact info", blurb: "Emails, phone numbers, and addresses must never end up in the public profile." },
  { ruleIds: ["extraction"], label: "Pulling the right facts from a bio", blurb: "Reading raw or messy text and getting the name, role, and details right." },
  { ruleIds: ["location"], label: "Getting the location right", blurb: "Capturing where someone is based." },
  { ruleIds: ["skills_interests"], label: "Capturing skills and interests", blurb: "Listing what someone can do and cares about, without collapsing them together." },
  { ruleIds: ["update"], label: "Applying profile edits", blurb: "Making the change a user asks for while leaving everything else intact." },
];

/** Plain-language name for each failing check, used in "what happened" notes. */
const CHECK_COPY: Record<AssertionKind, string> = {
  name: "got the person's name wrong",
  location: "got the location wrong",
  privacy: "leaked an email or phone number into the public profile",
  skills: "captured too few skills",
  interests: "captured too few interests",
  coverage_skills: "missed an expected skill",
  coverage_interests: "missed an expected interest",
  apply: "didn't apply the requested change",
  preserve: "lost part of the existing profile",
  reasoning: "the result didn't hold up",
};

/** Distinct plain-language reasons a case failed, across its runs. */
function failNote(c: CaseResult): string | undefined {
  const kinds = new Set<AssertionKind>();
  for (const rr of c.runResults) for (const a of rr.assertions) if (!a.passed) kinds.add(a.kind);
  if (kinds.size === 0) return undefined;
  return [...kinds].map((k) => CHECK_COPY[k]).join("; ") + ".";
}

/** Build the plain-language report from the scorecard + corpus narratives. */
function buildHumanReport(sc: Scorecard, cases: ProfileCase[]): HumanReport {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const resultById = new Map(sc.cases.map((c) => [c.caseId, c]));
  const groups = GROUPS.map((g) => ({
    label: g.label,
    blurb: g.blurb,
    ruleIds: g.ruleIds as string[],
    cases: sc.cases
      .filter((c) => g.ruleIds.includes(c.rule))
      .map((c) => {
        const meta = byId.get(c.caseId);
        const result = resultById.get(c.caseId);
        return {
          caseId: c.caseId,
          scenario: meta?.human?.scenario ?? meta?.description ?? c.caseId,
          expectation: meta?.human?.expectation ?? "behave correctly.",
          failNote: result ? failNote(result) : undefined,
        };
      }),
  })).filter((g) => g.cases.length > 0);
  return {
    subject: "the profile builder",
    oneLiner: "It turns raw data about a person into a clean public profile — and must never leak their private contact details.",
    groups,
  };
}

/** Render one run's generated profile behind a collapsible block. */
function detailHtml(d: ProfileRunDetail, i: number): string {
  const pii = d.piiHits.length > 0 ? ` <span class="bad">PII: ${htmlEscape(d.piiHits.join(", "))}</span>` : "";
  return `<div class="reason">
    <span class="muted">run ${i + 1} · ${d.skills.length} skill(s) · ${d.interests.length} interest(s)</span>${pii}
    <p><strong>${htmlEscape(d.name)}</strong> · ${htmlEscape(d.location)}</p>
    <p class="muted">${htmlEscape(d.bio)}</p>
    <p class="muted">skills: ${htmlEscape(d.skills.join(", "))}</p>
    <p class="muted">interests: ${htmlEscape(d.interests.join(", "))}</p>
  </div>`;
}

/** Render failed assertions for a case. */
function failedChecks(c: CaseResult): string {
  const failed = c.runResults.flatMap((rr, i) =>
    rr.assertions
      .filter((a) => !a.passed)
      .map((a) => `<li><span class="muted">run ${i + 1}</span> <span class="component">${htmlEscape(a.kind)}</span>: ${htmlEscape(a.detail)}</li>`),
  );
  if (failed.length === 0) return "";
  return `<details class="failures" open><summary>failed checks (${failed.length})</summary><ul>${failed.join("")}</ul></details>`;
}

/** Render one case card. */
function caseCard(c: CaseResult, meta: ProfileCase | undefined): string {
  const tier = meta ? `<span class="badge">tier ${meta.tier}</span>` : "";
  const flaky = c.flaky ? `<span class="badge flaky">flaky</span>` : "";
  const desc = meta?.description ? `<p class="desc">${htmlEscape(meta.description)}</p>` : "";
  const input = meta ? `<p class="desc"><span class="muted">input:</span> <code>${htmlEscape(meta.input.slice(0, 240))}${meta.input.length > 240 ? "…" : ""}</code></p>` : "";
  const details = c.runResults.map((rr, i) => (rr.detail ? detailHtml(rr.detail, i) : "")).join("");
  return `
  <article class="case ${rateClass(c.passRate)}">
    <header>
      <code class="cid">${htmlEscape(c.caseId)}</code>
      <span class="verdict ${rateClass(c.passRate)}" title="${c.passes}/${c.runs} runs">${htmlRateCI(c.passRate, c.passes, c.runs)}</span>
      ${tier}${flaky}
    </header>
    ${desc}${input}
    ${failedChecks(c)}
    <details><summary>generated profile (${c.runResults.length} run${c.runResults.length === 1 ? "" : "s"})</summary>${details}</details>
  </article>`;
}

const INTRO = `<h2>What this report is measuring</h2>
<p>This is a repeatability test for the profile generator. Cases check structured extraction (name, location, skills, interests) from raw data, update-request handling, and — on every case — the <strong>privacy guarantee</strong>: public fields (bio, narrative, location, …) must never embed contact identifiers (email/phone). Each case runs N times; a run passes only when every check passes, and any PII leak fails the run outright.</p>`;

/**
 * Render a standalone HTML scorecard for a profile-eval run via the shared shell.
 *
 * @param sc - The scorecard (run-report grade, with per-run detail intact).
 * @param regressions - Regressions vs the baseline.
 * @param cases - The corpus, joined by id for input text, tier, and description.
 */
export function renderHtml(sc: Scorecard, regressions: Regression[], cases: ProfileCase[]): string {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const caseCards = [...sc.rules]
    .sort((x, y) => x.passRate - y.passRate)
    .map((r) => {
      const cards = sc.cases.filter((c) => c.rule === r.rule).map((c) => caseCard(c, byId.get(c.caseId))).join("");
      return `<section class="rule"><h2>${htmlEscape(r.rule)}</h2>${cards}</section>`;
    })
    .join("");

  return renderScorecardShell(sc, regressions, {
    title: "Profile eval",
    intro: INTRO,
    sections: [{ heading: "By rule", html: renderRuleTable(sc) }],
    caseCardsHtml: caseCards,
    human: buildHumanReport(sc, cases),
  });
}

/** Write a standalone HTML scorecard to disk. */
export async function writeHtmlReport(
  path: string,
  sc: Scorecard,
  regressions: Regression[],
  cases: ProfileCase[],
): Promise<void> {
  await Bun.write(path, renderHtml(sc, regressions, cases));
}
