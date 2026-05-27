---
name: diagnosing-matching-eval
description: Use when investigating why the Index Network opportunity evaluator scores matches wrong, or when asked to explain, diagnose, or report on matching-eval results — turning a matching-eval run report (packages/protocol/eval/matching/runs/*.json) into a root-cause and fix report.
---

# Diagnosing Matching-Eval Failures

## Overview

The matching eval harness scores the opportunity evaluator (`invokeEntityBundle`) against a
golden corpus. A **run report** (`--report` → `eval/matching/runs/<ts>.json`) records, per case
per run, each candidate's actual score, role, and the evaluator's **own verbatim `reasoning`**.
This skill turns that artifact into a report that explains *why* the evaluator fails and what to
change.

**Core principle:** The reasoning string is the evidence. Every claim about *why* a case fails
cites the evaluator's own words; every proposed fix cites a verified `file:line`. No guessing,
no memory.

## Get a run report first

- From `packages/protocol`: `bun run eval:matching -- --report` (add `--runs 7` to cut noise).
  Writes `eval/matching/runs/<timestamp>.json` (gitignored). Analyze the newest one.
- **Do NOT analyze `baselines/matching.baseline.json`** — reasoning is stripped from it. It has
  scores only. You need a `--report` artifact for the "why".

## Procedure

1. **Read the reasoning, not just the scores.** For each failing or flaky case, read every run's
   `candidates[].reasoning` alongside the assertion `detail` lines. The reasoning is the model
   explaining itself — that is your evidence.

2. **Classify the cause before prescribing a fix.** For each failure, decide which it is and say so:
   - **Evaluator weakness** — the reasoning is wrong, OR correct reasoning produces a wrong
     score/role/match.
   - **Corpus / harness miscalibration** — the expectation is unsatisfiable as written. The runner
     surfaces any candidate scoring ≥ `minScore` (`matching.runner.ts:26`, currently 30) and the
     scorer counts a surfaced candidate as matched (`matched = score > 0`, `matching.scorer.ts:30`).
     So if a case sets `match:false` but a `scoreBand` whose max is ≥ `minScore`, the band and the
     match expectation cannot both pass — that is a **corpus bug; fix the case, not the prompt.**
   - Do not default to "fix the prompt." Name the classification with evidence.

3. **Separate signal from noise.** Three runs is a small sample. An all-fail (0/N) or all-pass
   (N/N) case is conclusive as-is. But a **mixed** result is flaky — before drawing any conclusion
   from it, re-run just that rule to see where it settles: `bun run eval:matching -- --rule <rule>
   --runs 7 --report`. **Flaky** (mixed passes across runs) is not a **regression** (the harness's
   own baseline diff). Never call sample-to-sample variance a regression.

4. **Locate the responsible clause precisely — and in the RIGHT prompt.** The evaluator has **two
   system prompts** in `src/opportunity/opportunity.evaluator.ts`:
   - `systemPrompt` (~line 21) — strict, single-pair, ≥70 threshold.
   - `entityBundleSystemPrompt` (~line 77) — permissive, batch, ≥30 threshold.

   **The eval calls `invokeEntityBundle`, which uses `entityBundleSystemPrompt` only.** A fix
   applied to `systemPrompt` changes nothing in the eval. grep the rule, read it, cite the exact
   `file:line`, and confirm it lives in `entityBundleSystemPrompt`. Check whether the same rule is
   duplicated elsewhere. Attribute behavior to the right component: surfacing threshold = runner
   `minScore`; matched = scorer (`score > 0`); scoring/role rules = the prompt.

5. **Write the report**, then verify every quoted clause and line number by opening the file —
   never paraphrase a prompt rule from memory.

## Report format

- **Header:** model, runs/case, aggregate pass-rate, path to the analyzed artifact.
- **Per failing rule:** what the case expects → what happened each run (quote the candidate's
  `reasoning`) → cause classification (weakness vs miscalibration, with evidence) → fix with a
  verified `file:line` in the correct prompt.
- **Order fixes by impact.** Mark each fix's confidence, and whether a higher-`--runs` re-run
  confirmed the failure is systematic rather than flaky.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Analyzing the baseline JSON (no reasoning) | Generate a `--report` artifact first |
| Quoting a prompt rule from memory | Open the file; cite exact `file:line`; confirm the text |
| Citing a line *range* (e.g. "21–153") | A clause has ONE location — find it; check for duplicates |
| Fixing `systemPrompt` | The eval uses `entityBundleSystemPrompt` — confirm which prompt |
| Defaulting to "fix the prompt" | First rule out a corpus / `scoreBand`-vs-`minScore` inconsistency |
| Calling 3-run variance a "regression" | Re-run with more iterations; flaky ≠ regression |
| Attributing `minScore` to the scorer | `minScore` is the runner; `matched = score>0` is the scorer |

## Red flags — stop

- About to recommend a prompt edit without having opened the prompt file.
- You cited a line range, not a line — or didn't confirm which of the two prompts it's in.
- You called something a regression off a single run report.
- A "why it fails" claim has no quote from the candidate's `reasoning`.
