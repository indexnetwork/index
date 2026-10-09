/**
 * Rule audit of the roster, run before seeding and before every scored run.
 *
 * It checks what can be checked mechanically: chronology, anonymization,
 * labels, rationales and explicit hard-negative conflicts. Whether a signal is
 * actionable is decided by normal admission in the seed, not here, and the
 * same-query comparison is a property of the scorer, which reads every member
 * from the same discover() results.
 */
import { GLOBAL_FORBIDDEN_TERMS, type CaseMember, type MatchCase } from './match-quality.cases';

/** One rule's verdict for one case. */
export interface AuditFinding {
  caseId: string;
  rule: 'chronology' | 'sources' | 'anonymization' | 'hindsight' | 'labels' | 'positive rationale' | 'hard-negative conflict' | 'profiles';
  pass: boolean;
  detail: string;
}

/** @returns Every text the agent or Index can read for this member. */
function visibleTexts(member: CaseMember): string[] {
  return [member.signal, member.profile.intro, member.profile.location, member.profile.timezone];
}

/** @returns Whether `term` occurs in `text` as a whole word, case-sensitively. */
function mentions(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(text);
}

/**
 * @param matchCase - One case of the roster.
 * @returns One finding per rule.
 */
export function auditCase(matchCase: MatchCase): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const add = (rule: AuditFinding['rule'], pass: boolean, detail: string) => {
    findings.push({ caseId: matchCase.id, rule, pass, detail });
  };
  const members = matchCase.members;
  const visible = members.flatMap(visibleTexts);

  const cutoff = Date.parse(matchCase.cutoff);
  const earliest = Date.parse(matchCase.introduction.earliest);
  const cutoffYear = new Date(cutoff).getUTCFullYear();
  const laterYears = visible.flatMap((text) => [...text.matchAll(/\b(1[89]\d\d|20\d\d)\b/g)].map((match) => Number(match[1])))
    .filter((year) => year > cutoffYear);
  add(
    'chronology',
    Number.isFinite(cutoff) && Number.isFinite(earliest) && cutoff < earliest && laterYears.length === 0,
    `cutoff ${matchCase.cutoff} before earliest introduction ${matchCase.introduction.earliest}`
      + (laterYears.length ? `; agent-visible text names later years ${laterYears.join(', ')}` : ''),
  );

  const sources = matchCase.sources.filter((source) => /^https?:\/\//.test(source.url) && source.supports.trim());
  add('sources', sources.length >= 2, `${sources.length} sourced claims`);

  const leaks = [...GLOBAL_FORBIDDEN_TERMS, ...matchCase.forbiddenTerms]
    .filter((term) => visible.some((text) => mentions(text, term)));
  add('anonymization', leaks.length === 0, leaks.length ? `exposes ${leaks.join(', ')}` : 'no names or later achievements in agent-visible text');

  const principal = members.filter((member) => member.role === 'principal');
  const hindsight = matchCase.hindsightTerms
    .filter((term) => principal.some((member) => member.signal.toLowerCase().includes(term.toLowerCase())));
  add('hindsight', hindsight.length === 0, hindsight.length ? `principal asks for ${hindsight.join(', ')}` : `principal signal avoids ${matchCase.hindsightTerms.join(', ')}`);

  const positives = members.filter((member) => member.role === 'positive');
  const hard = members.filter((member) => member.role === 'hard_negative');
  const easy = members.filter((member) => member.role === 'easy_negative');
  const keys = new Set(members.map((member) => member.key));
  add(
    'labels',
    principal.length === 1 && positives.length === 1 && hard.length >= 1 && easy.length >= 1 && keys.size === members.length,
    `1 principal, ${positives.length} positive, ${hard.length} hard, ${easy.length} easy, unique keys`,
  );

  add('positive rationale', positives.every((member) => member.rationale.trim().length > 0), 'positive carries a rationale');

  const unexplained = hard.filter((member) => !member.conflictClause || !member.signal.includes(member.conflictClause));
  add(
    'hard-negative conflict',
    unexplained.length === 0,
    unexplained.length
      ? `conflict missing from the signal of ${unexplained.map((member) => member.key).join(', ')}`
      : 'every hard negative states its conflict in its own signal',
  );

  const incomplete = members.filter((member) => !member.profile.intro.trim() || !member.profile.location.trim() || !member.profile.timezone.trim());
  add('profiles', incomplete.length === 0, incomplete.length ? `incomplete: ${incomplete.map((member) => member.key).join(', ')}` : 'every member has intro, location and timezone');

  return findings;
}

/** @returns The findings for every case, in roster order. */
export function auditRoster(cases: MatchCase[]): AuditFinding[] {
  return cases.flatMap(auditCase);
}
