/**
 * Renders scored runs as a Markdown report for a human reader.
 *
 * Scores are cosine similarities from discover(), shown as returned. There is
 * no pass threshold: the report only states where a positive scored below a
 * hard negative. "No query", "not retrieved" and a failed search are written
 * out as such, never as zero.
 */
import type { AuditFinding } from './match-quality.audit';
import type { MatchCase } from './match-quality.cases';
import type { Placement, RunScore, SeededCase, WakeCapture } from './match-quality.wake';

/** Everything one evaluation produced. */
export interface Evaluation {
  generatedAt: string;
  target: string;
  commit: string;
  fingerprint: string;
  runsPerCase: number;
  audit: AuditFinding[];
  seeded: SeededCase[];
  captures: WakeCapture[];
  scores: RunScore[];
}

const ROLE_LABEL: Record<string, string> = {
  positive: 'positive',
  hard_negative: 'hard −',
  easy_negative: 'easy −',
};

function placement(value: Placement | undefined): string {
  return value ? `${value.score.toFixed(3)} (#${value.rank})` : 'not retrieved';
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function labelled(matchCase: MatchCase) {
  return matchCase.members.filter((member) => member.role !== 'principal');
}

function auditSection(audit: AuditFinding[]): string[] {
  const rules = [...new Set(audit.map((finding) => finding.rule))];
  const cases = [...new Set(audit.map((finding) => finding.caseId))];
  const lines = [
    '## Roster audit',
    '',
    'Mechanical rules over the frozen fixtures. Actionability is checked by normal admission (below); same-query comparison holds by construction, because every member is placed from the same discover() results the agent merged.',
    '',
    `| Case | ${rules.join(' | ')} |`,
    `|---|${rules.map(() => '---').join('|')}|`,
  ];
  for (const caseId of cases) {
    const row = rules.map((rule) => {
      const finding = audit.find((entry) => entry.caseId === caseId && entry.rule === rule)!;
      return finding.pass ? 'pass' : `**fail**: ${cell(finding.detail)}`;
    });
    lines.push(`| ${caseId} | ${row.join(' | ')} |`);
  }
  return lines;
}

function admissionSection(evaluation: Evaluation): string[] {
  const lines = [
    '## Admission',
    '',
    'Every signal in the scored database went through `IntentService.create` (prepare, verify, persist) and was admitted. Wording revisions made before the freeze are in the seed logs, not here.',
    '',
    '| Case | Signals admitted | Admitted at |',
    '|---|---|---|',
  ];
  for (const seeded of evaluation.seeded) {
    lines.push(`| ${seeded.matchCase.id} | ${seeded.members.length} of ${seeded.matchCase.members.length} | ${seeded.stamp.admittedAt} |`);
  }
  return lines;
}

function summarySection(evaluation: Evaluation): string[] {
  const lines = [
    '## Summary',
    '',
    'Per run: the positive\'s best score across that run\'s queries and its rank in the merged list the agent opens from; then which hard negatives outranked it on best score.',
    '',
    '| Case | Run | Outcome | Queries | Positive best | Hard negatives above positive (best) | Queries where a hard negative outranks the positive |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const score of evaluation.scores) {
    const seeded = evaluation.seeded.find((entry) => entry.matchCase.id === score.caseId)!;
    const positive = seeded.members.find(({ member }) => member.role === 'positive')!.member.key;
    const losing = score.hardAbovePositiveByQuery.filter((keys) => keys.length).length;
    lines.push(`| ${score.caseId} | ${score.run} | ${score.outcome} | ${score.queries.length} | ${score.outcome === 'scored' ? placement(score.best[positive]) : '—'} | ${score.hardAbovePositive.join(', ') || 'none'} | ${score.queries.length ? `${losing} of ${score.queries.length}` : '—'} |`);
  }
  return lines;
}

function caseSection(evaluation: Evaluation, seeded: SeededCase): string[] {
  const { matchCase } = seeded;
  const scores = evaluation.scores.filter((score) => score.caseId === matchCase.id);
  const members = labelled(matchCase);
  const lines = [
    `## ${matchCase.title}`,
    '',
    `Case \`${matchCase.id}\`. Wake date ${matchCase.cutoff}; earliest introduction ${matchCase.introduction.earliest}. ${members.length} labelled members; all signals admitted at ${seeded.stamp.admittedAt}.`,
    '',
    '### Best score across queries, by run',
    '',
    `| Member | Label | ${scores.map((score) => `Run ${score.run}`).join(' | ')} | Range |`,
    `|---|---|${scores.map(() => '---').join('|')}|---|`,
  ];
  for (const member of members) {
    const values = scores.map((score) => score.best[member.key]);
    const retrieved = values.filter((value): value is Placement => value !== undefined).map((value) => value.score);
    const range = retrieved.length ? `${Math.min(...retrieved).toFixed(3)}–${Math.max(...retrieved).toFixed(3)}` : '—';
    const runs = scores.map((score) => (score.outcome === 'scored' ? placement(score.best[member.key]) : score.outcome));
    lines.push(`| ${member.key} | ${ROLE_LABEL[member.role]} | ${runs.join(' | ')} | ${range} |`);
  }

  for (const score of scores) {
    const capture = evaluation.captures.find((entry) => entry.caseId === score.caseId && entry.run === score.run)!;
    lines.push('', `### Run ${score.run}`, '');
    lines.push(`Outcome: ${score.outcome}. ${(capture.durationMs / 1000).toFixed(1)} s. Wake actions: ${capture.actions.join(', ') || 'none'}. Would have opened ${capture.picks.flat().length} (nothing was opened).`);
    if (score.error) lines.push('', `Error: ${cell(score.error)}`);
    for (const plan of score.plans) lines.push('', `Plan: ${cell(plan)}`);
    if (!score.queries.length) continue;
    lines.push('', `| Query | Returned | ${members.map((member) => `${member.key} (${ROLE_LABEL[member.role]})`).join(' | ')} |`);
    lines.push(`|---|---|${members.map(() => '---').join('|')}|`);
    for (const query of score.queries) {
      const placements = members.map((member) => (query.error ? 'search failed' : placement(query.placements[member.key])));
      lines.push(`| ${cell(query.query)} | ${query.error ? `failed: ${cell(query.error)}` : query.returned} | ${placements.join(' | ')} |`);
    }
    lines.push('', `Hard negatives above the positive on best score: ${score.hardAbovePositive.join(', ') || 'none'}.`);
  }
  return lines;
}

function failureSection(evaluation: Evaluation): string[] {
  const failures = evaluation.scores.filter((score) => score.outcome !== 'scored' || score.error || score.queries.some((query) => query.error));
  const lines = ['## Failures and misses', ''];
  if (!failures.length) return [...lines, 'None: every wake searched, and every search returned.'];
  for (const score of failures) {
    const failedQueries = score.queries.filter((query) => query.error).length;
    lines.push(`- ${score.caseId} run ${score.run}: ${score.outcome}${score.error ? `; ${cell(score.error)}` : ''}${failedQueries ? `; ${failedQueries} failed searches` : ''}`);
  }
  return lines;
}

/** @returns The full Markdown report. */
export function renderReport(evaluation: Evaluation): string {
  const lines = [
    '# Historical match-quality discovery report',
    '',
    `Generated ${evaluation.generatedAt} from commit \`${evaluation.commit}\`, fixtures \`${evaluation.fingerprint.slice(0, 12)}\` (frozen). Target: ${evaluation.target}. ${evaluation.runsPerCase} live wake(s) per case.`,
    '',
    'Each run is one ordinary first wake of the principal\'s agent with the live model: it writes its own queries, and each query goes through `IntentService.discover()`. Scores are the cosine similarities discover() returned, and `#n` is the rank in that list. "Best" is each member\'s highest score across the run\'s queries, ranked as the agent merges them before opening. Nothing was opened and no negotiation ran. No pass threshold is applied.',
    '',
    ...summarySection(evaluation),
    '',
    ...auditSection(evaluation.audit),
    '',
    ...admissionSection(evaluation),
    '',
    ...evaluation.seeded.flatMap((seeded) => [...caseSection(evaluation, seeded), '']),
    ...failureSection(evaluation),
    '',
  ];
  return lines.join('\n');
}
