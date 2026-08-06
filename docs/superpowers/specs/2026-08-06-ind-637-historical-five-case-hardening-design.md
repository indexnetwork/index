# IND-637 Historical Five-Case Hardening — Design

**Status:** Approved
**Date:** 2026-08-06
**Issue:** IND-637
**Scope:** `packages/protocol/eval/matching/` and `packages/protocol/eval/discovery-env-matrix/`

## Purpose

Make the five existing historical discovery cases defensible before they seed shared-pool retrieval experiments. Every model-facing statement about a real historical participant must be supported by evidence that predates the first substantive collaboration. Synthetic hard negatives remain explicitly authored test fixtures. Real identities, citations, excerpts, cutoff analysis, and review notes remain report-only and cannot reach a model invocation.

This is a provider-free corpus-hardening change. It does not run a model, database, Redis, or Neon branch and does not tune retrieval or evaluator quality.

## Decisions

- Keep `packages/protocol/eval/matching/matching.historical.ts` as the single canonical source.
- Export complete audited cases plus a compatibility projection for existing matching consumers; do not create a duplicate v2 corpus or a detached metadata sidecar.
- Preserve the five stable case IDs and existing participant IDs.
- Keep three fictional, anonymized semantic hard negatives per case and identify them explicitly as authored fixtures.
- Represent Larry Page alone as the source participant in the first-check-investor case. Sergey Brin may appear only as anonymized, cited context and never as a composite source identity.
- Use a fresh-context agent, independent of the authoring agent, to review every citation, cutoff, provenance mapping, and anonymization decision.
- Remove unsupported plausible biography and intent text rather than preserving current matching semantics by inference.
- Require the current five cases to pass the HDQ1 corpus contract and model-safe projection tests before IND-638 can consume them.

## Canonical Corpus Architecture

`matching.historical.ts` exports two views of one authored data source:

1. `HISTORICAL_QUALITY_CASES` contains the complete five-case audit records and is the authoritative corpus.
2. `HISTORICAL_CASES` is derived from those records for the existing matching harness. It contains only the matching contract and report fields the harness already understands; no second copy of the case text exists.

The discovery-matrix adapter consumes the authoritative audited cases and derives its fixture-facing shape. Existing case IDs, positive labels, negative labels, and participant IDs remain stable so later fixture identity does not depend on text equality. Descriptive case IDs remain control-plane metadata and are removed from model payloads; anonymous participant IDs remain stable evaluator entity keys.

Changing the canonical corpus changes the protected fixture fingerprint. The API eval fixture marker advances from `historical-matrix-v1` to `historical-matrix-v2`, and provider-free tests prove v1 metadata is refused. This issue does not reseed Neon; the authorized shared-pool base refresh remains part of IND-638.

No audit object is passed by object spread to a model boundary. Projection functions construct model-safe objects explicitly. Tests inspect the exact matching and matrix payloads and fail if citations, excerpts, real identities, reviewer information, semantic labels/reasons, descriptive case IDs, or audit notes appear.

## Participant and Provenance Model

Each participant is classified as one of:

- `historical`: the real source person or documented eventual collaborator, represented anonymously;
- `synthetic`: an authored hard-negative test profile that does not purport to be a historical person.

Every claim-bearing model-safe field maps to one provenance record. Provenance has three explicit forms:

### Historical fact

A statement directly supported by one or more citations. The record contains the exact model-facing text, citation IDs, and an explicit pre-connection assertion. It is valid only when every citation exists and the case cutoff establishes that the fact predates the collaboration.

### Derived wording

An anonymized or generalized sentence composed only from cited historical facts. It records the exact model-facing text, the historical claim IDs on which it is based, and a concise transformation rationale. Its basis must resolve transitively to historical facts; cycles and empty bases are invalid.

Derived wording supports safe transformations such as replacing an institution with “a university laboratory” or expressing a normalized retrieval query from documented pre-connection work. It cannot introduce a psychological intention, skill, goal, or relationship absent from its cited basis.

### Authored fixture text

Synthetic text written solely to construct a semantic hard negative. It records the exact field text, the candidate ID, and the case requirement that candidate violates. It is allowed only on participants classified as synthetic and referenced by `semanticNegatives`. Historical participant fields, historical trigger inputs, outcome claims, and cutoff evidence cannot use authored-fixture provenance.

This separation prevents fictional distractors from pretending to have historical citations while preventing `authored` from becoming an escape hatch for unsupported historical biography or intent.

## Evidence and Cutoff Rules

Each case records:

- an exclusive first-substantive-collaboration cutoff;
- ordering citations that prove the boundary, including ordering within a year when only year precision is available;
- independent outcome citations;
- citations with stable IDs, URL, title, publisher, and exact excerpt;
- field-level claims and provenance;
- report-only real identities and audit notes.

Retrospective sources are acceptable only when their excerpts clearly distinguish pre-connection facts from later events. An outcome source is independent when at least one outcome citation is not also used as pre-connection or cutoff evidence.

The authoring flow for each case is:

1. establish and cite the exclusive cutoff;
2. collect independent outcome evidence;
3. collect pre-connection evidence for both historical participants;
4. remove claims whose ordering cannot be established;
5. author concise anonymous profiles from retained claims;
6. derive model-safe intent, frozen premises, and frozen user context only from retained claims;
7. generalize unique names, dates, institutions, projects, products, papers, and songs wherever semantics allow;
8. record at least three synthetic semantic negatives and each violated requirement;
9. freeze the model-facing case data;
10. run deterministic validation and independent review.

### Pair-specific constraints

- **Builder and operator:** audit the Jobs/Wozniak relationship from their earliest substantive collaboration, not Apple’s incorporation. Commercial intent learned during prior joint work is excluded.
- **Molecular structure researchers:** retain only pre-collaboration disciplinary, data, and model-building facts; remove outcome-derived certainty.
- **Songwriting duo:** generalize the city, groups, repertoire, song titles, and exact meeting details. Do not claim either person was actively seeking the other role unless evidence says so.
- **First-check investor:** `h4-a` maps only to Larry Page. Sergey Brin may be described anonymously as an existing research collaborator when supported, but is not a participant composite. Product, company, university, and exact check details stay report-only unless a broad form is required for matching semantics.
- **RNA biochemist and immunologist:** use the first documented meeting/collaboration boundary and separate their pre-existing research programs from discoveries produced jointly afterward.

## Frozen Trigger Inputs

Every case contains reviewed trigger inputs for both future graph shapes:

- `intent.text`: concise model-safe wording derived from cited pre-connection facts;
- `enrichment.premises`: one or more reviewed, immutable premise strings;
- `enrichment.userContext`: a reviewed, immutable paragraph synthesized only from those premises.

The arrays, nested trigger objects, and containing case are deeply frozen. Tests prove mutation is rejected or ineffective. This issue authors and validates the text but does not integrate the enrichment trigger into the live runner; IND-638 owns that runtime work.

## Anonymization Boundary

Model input excludes:

- real names and aliases;
- citations, URLs, titles, publishers, and excerpts;
- exact dates where a broad period suffices;
- unique institution, project, product, paper, or song names;
- outcome-revealing language;
- expected labels, semantic-negative reasons, reviewer identity, recognizability decisions, and audit notes.

Pseudonymous participant names may remain when they carry no historical signal; neutral participant labels are preferred when a pseudonym adds no test value. Structural IDs remain stable anonymous IDs.

An adversarial recognizability review records `low`, `medium`, or `high`. Approval requires a rationale explaining why remaining detail is necessary for matching semantics or why further generalization was applied. A `high` case cannot be approved without an explicit necessity rationale.

## Independent Review

After authoring and deterministic validation, a fresh-context agent independently reviews every case. It receives the corpus, source URLs, and a checklist but not the author’s private reasoning. The reviewer must:

1. open every cited URL;
2. verify title, publisher, and excerpt accuracy;
3. verify cutoff ordering and the independence of outcome evidence;
4. map every historical and derived field back to its evidence;
5. confirm synthetic provenance appears only on synthetic negatives;
6. inspect the serialized model-safe projection for identity, citation, fame, and outcome leakage;
7. challenge recognizability through combinations of otherwise generalized facts;
8. approve or request revision per case.

The review output is preserved in a committed five-case review record. The corpus stores the resulting reviewer identifier, date, recognizability rating, decision, and rationale. The authoring agent may apply requested changes, but the same independent reviewer must re-check changed cases before they become approved.

## Validation and Failure Behavior

Provider-free validation fails with case and field-path context when it encounters:

- missing, duplicate, malformed, or blank citations;
- an inclusive cutoff or unproved year ordering;
- no independent outcome citation;
- a historical field without cited or citation-derived provenance;
- derived wording with an unknown, empty, cyclic, or non-historical basis;
- authored provenance on a historical participant or trigger;
- an unknown or unclassified participant;
- fewer than three authored semantic negatives;
- a semantic negative not tied to a rejected synthetic candidate and violated requirement;
- unstable or duplicate case/participant IDs;
- a positive partner that is absent or also negative;
- incomplete or unapproved anonymization review;
- the composite Page/Brin source identity;
- real identities or audit data in model-safe projections;
- mutable frozen trigger or participant text.

Errors are deterministic and provider-free. Validation never attempts to repair data, fetch a source, call a model, or mutate a fixture.

## Testing and Verification

Focused tests cover:

- all five canonical cases passing the HDQ1 contract;
- complete field-level provenance coverage;
- historical, derived, and authored provenance success and mutation failures;
- exclusive cutoff and independent-outcome enforcement;
- at least three semantic negatives with violated requirements;
- stable participant IDs and Larry Page’s single-source identity;
- explicit matching and discovery-matrix projections;
- leakage scans for every report identity, URL, citation excerpt, audit key, unique proper noun selected by the review, and outcome term;
- deep freezing of premises, contexts, and participant text;
- rejection of unsupported historical text introduced by mutation;
- rejection of authored provenance used on a historical participant.

Required verification:

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.corpus.spec.ts \
  eval/discovery-env-matrix/tests/historical-matrix.cases.spec.ts \
  eval/discovery-env-matrix/tests/historical-matrix.policy.spec.ts \
  eval/matching/tests/matching.historical.spec.ts
bun x tsc --noEmit -p eval/discovery-env-matrix/tsconfig.json
bun x tsc --noEmit -p eval/matching/tsconfig.json
bun run eval:verify
cd ../../services/api
bun test src/cli/tests/discovery-env-matrix.spec.ts \
  src/cli/tests/discovery-env-matrix-base.spec.ts
```

Also run applicable lint/static inventory checks, `git diff --check`, and repository version/lockfile checks required by the Development Reference.

No live model, embedding, database, Redis, or Neon command is part of this issue.

## Files Expected to Change

- `packages/protocol/eval/matching/matching.historical.ts`
- `packages/protocol/eval/discovery-env-matrix/historical-quality.corpus.ts`
- `packages/protocol/eval/discovery-env-matrix/historical-matrix.cases.ts`
- `services/api/src/cli/discovery-env-matrix.shared.ts` and its provider-free fixture specs
- focused specs under both eval suites
- a committed case-by-case provenance/anonymization review record
- `packages/protocol/package.json` and root `bun.lock` for the required package version bump
- focused eval documentation if the canonical-corpus boundary changes materially

No production API runtime, database schema, eval-ops UI, live runner, baseline, or production package source changes are planned. The API change is limited to the eval fixture corpus-version marker and provider-free tests; no branch is reset or reseeded.

## Preliminary Source Set

These are starting points, not automatic approval. The independent reviewer must open and verify each final citation used by the corpus.

- MIT Lemelson Center, “Steve Jobs and Steve Wozniak”: https://lemelson.mit.edu/resources/steve-jobs-and-steve-wozniak
- U.S. National Library of Medicine, “The Discovery of the Double Helix, 1951–1953”: https://profiles.nlm.nih.gov/spotlight/sc/feature/doublehelix
- The Beatles Story, “Lennon–McCartney”: https://www.beatlesstory.com/blog/lennon-mccartney/
- Google, “Our Story”: https://about.google/company-info/our-story/
- Boston University, “How Drew Weissman and Katalin Karikó Developed the mRNA Technology Inside COVID Vaccines”: https://www.bu.edu/articles/2021/how-drew-weissman-and-katalin-kariko-developed-mrna-technology-inside-covid-vaccines/

## Acceptance

The design is satisfied when all five audited cases pass the extended HDQ1 contract and projection-leakage tests, unsupported biography and intent text is removed, Larry Page replaces the composite source identity, each case has at least three authored hard negatives with explicit violated requirements, frozen trigger inputs are present, and an independent fresh-context reviewer approves provenance and anonymization for every case without any live model or database run.
