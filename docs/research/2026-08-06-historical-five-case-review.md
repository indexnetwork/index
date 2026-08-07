# IND-637 historical five-case independent review receipt

Dates: 2026-08-06 initial review; 2026-08-07 corrective review, with H5 pending re-review

## Issue, corrective chronology, and durability

IND-637 hardens five historical matching cases before they seed shared-pool retrieval experiments. Every model-facing historical statement must have pre-connection provenance; synthetic negatives must remain explicitly authored; outcomes and real identities must remain report-only; and combination recognizability must receive independent review.

PR #1341 passed its initial independent review and was merged at `5e33ee4cd8625cadd3e3da760698023b0c8d630b`. A post-merge owner audit then found that H1 and H5 violated the intended owner decisions: H1 represented the wrong historical collaboration, H5 reversed the required seeker direction, and the corpus still used a flat date cutoff. The audit also found admission, serializer-coverage, and documentation gaps. The focused corrective work replaced H1, repaired H5, introduced event-relative cutoffs, and added exact all-five-case serializer and no-leak coverage. A final evaluation-validity correction then rewrote H5's model-facing negatives, equalized its candidate RAG scores, and returned H5 to pending re-review, so strict aggregate admission is intentionally unavailable. Therefore, the former statement that the original integration had no required changes is superseded and incorrect.

Raw `.pi-subagents` paths identify session evidence only. They are gitignored and unavailable in a fresh checkout. This committed receipt is the durable repository record: it preserves reviewer identity, reviewed commit, decision, recognizability, required changes, and the exact citation/projection verdicts needed to audit the corpus.

No protected-base refresh and no live model, provider, database, Redis, Neon, paid evaluation, or other live measurement occurred during the corrective work. The work changed corpus contracts, H1/H5 fixtures, approval metadata, provider-free serializer tests, and this receipt; it did not claim a protected base was refreshed or that historical-quality performance was measured.

## Review checkpoints and participants

### Initial PR #1341 review sessions

These raw artifacts document the initial review chronology. They are not durable repository artifacts. The H1 and H5 conclusions from this checkpoint are **superseded** by the corrective reviews below; H2, H3, and H4 evidence remains valid.

| Case | Initial audit ID | Session-local raw artifact (not committed) |
|---|---|---|
| 01 | `937423ed` | `.pi-subagents/artifacts/outputs/937423ed/.superpowers/sdd/2026-08-06-ind-637-historical-five-case-hardening/task-7-case-01-initial.md` |
| 02 | `7f2f4495` | `.pi-subagents/artifacts/outputs/7f2f4495/.superpowers/sdd/2026-08-06-ind-637-historical-five-case-hardening/task-7-case-02-initial.md` |
| 03 | `bc201caf` | `.pi-subagents/artifacts/outputs/bc201caf/.superpowers/sdd/2026-08-06-ind-637-historical-five-case-hardening/task-7-case-03-initial.md` |
| 04 | `bc6e2bcd` | `.pi-subagents/artifacts/outputs/bc6e2bcd/.superpowers/sdd/2026-08-06-ind-637-historical-five-case-hardening/task-7-case-04-initial.md` |
| 05 | `3665943a` | `.pi-subagents/artifacts/outputs/3665943a/.superpowers/sdd/2026-08-06-ind-637-historical-five-case-hardening/task-7-case-05-initial.md` |

### Current independent review record

H1–H4 retain their approved evidence. H5's prior approval is superseded because its model-facing synthetic profiles, intents, and RAG scores changed after that checkpoint; H5 is pending independent re-review and is unavailable to strict aggregate admission. The current case modules and tests record the operative review state.

| Case | Direction | Final reviewer | Reviewed checkpoint | Reviewed date | Decision | Recognizability | Required changes |
|---|---|---|---|---|---|---|---|
| 01 | Ted Nierenberg → Jens Quistgaard; Martha Nierenberg was a material participant in the joint search | `ind637.source-auditor:56c4419b` | `6c20448cc20387953c0bf22b7d17f3249d47e391` | 2026-08-07 | approved | medium | none |
| 02 | James Watson → Francis Crick | `pi-reviewer:5e071b82` | `770cf7f754e63e4a7a61362389a0759d4d8632b9` | 2026-08-06 | approved | medium | none |
| 03 | John Lennon → Paul McCartney | `pi-reviewer:a091da6e` | `b6deffd73584e5f5a8f31a5435e0901229a57003` | 2026-08-06 | approved | medium | none |
| 04 | Larry Page → Andy Bechtolsheim | `pi-reviewer:ba43fe8c` | `770cf7f754e63e4a7a61362389a0759d4d8632b9` | 2026-08-06 | approved | medium | none |
| 05 | Drew Weissman → Katalin Karikó | `ind637.fixture-author` | pending | 2026-08-07 | pending | medium | Independent re-review of neutral affirmative negatives and equalized candidate RAG scores |

The current H1 session-local review path is `.pi-subagents/ind-637-repair/final-reviews/h1-final-approval.md`. The former H5 review at `.pi-subagents/ind-637-repair/final-reviews/h5-rereview.md` is a superseded historical checkpoint, not approval of the current model-facing content. These paths are locators for raw session evidence, not checkout-stable links.

## Event-relative cutoff contract

Event identity is primary. Each cutoff identifies the first substantive connection event and excludes that event and later facts. `calendarProxy` is only a confidence-qualified calendar approximation of that event; it is not an independent exact cutoff unless the evidence establishes that precision.

| Case | Event ID | Primary exclusive event boundary | Calendar proxy | Confidence | Ordering evidence |
|---|---|---|---|---|---|
| 01 | `h1-nierenberg-quistgaard-first-contact` | Immediately before Ted and Martha Nierenberg telephoned Jens Quistgaard during their 1954 European design-sourcing trip. | `1954` (year) | medium — “Independent accounts agree on first contact and company formation in 1954 but differ on the discovery location and do not establish an exact day.” | `new-yorker-dansk-history`, `latimes-nierenberg-obituary` |
| 02 | `h2-first-substantive-collaboration` | Immediately before James Watson and Francis Crick began substantive collaboration in October 1951 | `1951-10` (month) | high — independent histories establish the month, not the first working day | `nobel-watson-biographical`, `asu-1953-paper-history` |
| 03 | `h3-first-substantive-collaboration` | Immediately before John Lennon invited Paul McCartney to join after their July 1957 meeting and demonstration | `1957-07` (month) | high — the 6 July meeting and later invitation are ordered, but the invitation day is unknown | `nml-first-meeting`, `national-trust-history` |
| 04 | `h4-first-substantive-collaboration` | Immediately before Larry Page demonstrated the search prototype to Andreas Bechtolsheim for its first substantive evaluation; the later check is excluded subsequent ordering evidence | `1998-08` (month) | medium — institutional accounts support the demonstration month, not the exact day | `stanford-otl-uniquely-google`, `stanford-engineering-hero-talk` |
| 05 | `h5-weissman-kariko-first-substantive-conversation` | Immediately before Drew Weissman and Katalin Karikó's first substantive conversation and joint work. | `1997` (year) | medium — “Stored first-person and institutional evidence places the encounter around 1997 but does not establish an exact date.” | `cell-persistent-progress`, `nobel-kariko-banquet-speech` |

H5's `1997` value is therefore a calendar proxy for an uncertain event around 1997, not an exact calendar cutoff. The earlier unsupported 1998-disagreement finding was removed and is **superseded**.

## Citation verification

Every row records the current citation ID, exact stored URL, title, and publisher plus the independent verdict on the stored excerpt. Outcome-only use is explicit.

### Case 01 — `historical/builder-and-operator` (corrective evidence)

| Citation | URL | Exact title | Publisher | Excerpt/source verdict |
|---|---|---|---|---|
| `new-yorker-dansk-history` | https://www.newyorker.com/culture/cultural-comment/dansk-and-the-promise-of-a-simple-scandinavian-life | Dansk and the Promise of a Simple Scandinavian Life | The New Yorker | **PASS.** Verified the Nierenbergs' joint 1954 European design search, telephone-call-before-doorstep ordering, company-start ordering, and Quistgaard's apprenticeship with his sculptor father. |
| `latimes-nierenberg-obituary` | https://www.latimes.com/local/obituaries/la-me-theodore-nierenberg5-2009aug05-story.html | Theodore D. Nierenberg dies at 86; founder of Dansk | Los Angeles Times | **PASS.** Verified the 1944 engineering-management degree, family manufacturing-business work, 1954 discovery/contact chronology, direction, and Quistgaard product-design facts. |
| `moma-quistgaard-1953` | https://www.moma.org/collection/works/1190 | Jens H. Quistgaard. Fjord Flatware. 1953 | The Museum of Modern Art | **QUALIFIED PASS.** Direct fetch returned HTTP 403; indexed results confirmed the exact URL/title and 1953 object date. This citation is not used by historical claim provenance. |
| `cooper-hewitt-quistgaard` | https://collection.cooperhewitt.org/people/18044007/ | Jens H. Quistgaard | Smithsonian Institution | **PASS; outcome-only.** Verified the current 40-object statement and Dansk relationship. The object count is dynamic and the relationship display has no date. |

Martha Nierenberg materially participated in the discovery/founding story: the source evidence describes Ted and Martha's joint search, telephone call, doorstep visit, and start of Dansk. The benchmark must remain dyadic for evaluator compatibility, so its report mapping is Ted → Jens, but that projection does not erase Martha. Her role is retained in the cutoff event, historical claims, source biography/intent attribution, review rationale, and this receipt while her identity remains outside model-facing projection.

### Case 02 — `historical/co-researchers-structure` (preserved evidence)

| Citation | URL | Exact title | Publisher | Excerpt verification |
|---|---|---|---|---|
| `nobel-watson-biographical` | https://www.nobelprize.org/prizes/medicine/1962/watson/biographical/ | James Watson – Biographical | Nobel Foundation | PASS — zoology/phage/Copenhagen/May redirection and early-October ordering summary verified. |
| `wellcome-crick-archives` | https://wellcomecollection.org/works/hz43r7re | Francis Crick (1916-2004): archives | Wellcome Collection | PASS — physics, broad interests, and June 1949 crystallographic work summary verified. |
| `asu-1953-paper-history` | https://embryo.asu.edu/pages/molecular-structure-nucleic-acids-structure-deoxyribose-nucleic-acid-1953-james-watson-and | “Molecular Structure of Nucleic Acids: A Structure for Deoxyribose Nucleic Acid” (1953), by James Watson and Francis Crick | Arizona State University Embryo Project Encyclopedia | PASS — corrected exact title and October-collaboration excerpt. |
| `science-history-biographies` | https://www.sciencehistory.org/education/scientific-biographies/francis-crick-rosalind-franklin-james-watson-and-maurice-wilkins/ | Francis Crick, Rosalind Franklin, James Watson, and Maurice Wilkins | Science History Institute | PASS — image-viewing/redirection passage verified and kept out of serialized profiles. |
| `nobel-1962-summary` | https://www.nobelprize.org/prizes/medicine/1962/summary/ | The Nobel Prize in Physiology or Medicine 1962 | Nobel Foundation | PASS — prize rationale verified; outcome-only. |

### Case 03 — `historical/songwriting-duo` (preserved evidence)

| Citation | URL | Exact title | Publisher | Excerpt verification |
|---|---|---|---|---|
| `nml-first-meeting` | https://www.liverpoolmuseums.org.uk/stories/when-paul-mccartney-met-john-lennon | When Paul McCartney met John Lennon | National Museums Liverpool | PASS — verbatim 6 July meeting, guitar demonstration, and invitation-weeks-later passages. |
| `john-lennon-mother` | https://www.johnlennon.com/news/mother-%E2%86%92-watch-the-4k-remastered-video-discover-more-about-johns-childhood/ | MOTHER. → Watch the 4K Remastered Video & discover more about John's childhood. | JohnLennon.com | PASS — exact banjo-to-guitar and practice passage; unsupported pre-performance claim removed. |
| `mccartney-lyrics-special` | https://www.paulmccartney.com/news/you-gave-me-the-answer-the-lyrics-1956-to-the-present-special | You Gave Me The Answer - 'The Lyrics: 1956 to the Present' Special | PaulMcCartney.com | PASS — exact first-song/age-fourteen passage; evidence-only. |
| `national-trust-history` | https://www.nationaltrust.org.uk/visit/liverpool-lancashire/the-beatles-childhood-homes/history-of-the-beatles-childhood-homes | History of the Beatles' Childhood Homes | National Trust | PASS — exact better-guitarist recruitment and joining passage. |
| `guinness-songwriter-number-ones` | https://www.guinnessworldrecords.com/world-records/69695-most-number-one-singles-by-a-songwriter | Most US No.1 singles by a songwriter | Guinness World Records | PASS — exact songwriter record passage; outcome-only. |

### Case 04 — `historical/first-check-investor` (preserved evidence)

| Citation | URL | Exact title | Publisher | Excerpt verification |
|---|---|---|---|---|
| `stanford-search-paper` | http://infolab.stanford.edu/~backrub/google.html | The Anatomy of a Large-Scale Hypertextual Web Search Engine | Stanford University | PASS — April 1998 prototype/scale/quality summary verified. |
| `nsf-origins-context` | https://www.nsf.gov/news/origins-google | On the Origins of Google | National Science Foundation | PASS — link-ranking and unnamed collaborator context verified. |
| `stanford-otl-uniquely-google` | http://infolab.stanford.edu/pub/voy/museum/google.htm | Uniquely Google(TM) | Stanford Office of Technology Licensing | PASS — company-decision, demonstration/check, and incorporation ordering summary verified. |
| `stanford-engineering-hero-talk` | https://engineering.stanford.edu/news/andy-bechtolsheim-hero-talks-innovation-success-and-engineering | Andy Bechtolsheim: Hero talks innovation, success and engineering | Stanford Engineering | PASS — corrected 1998 invitation/demonstration and check-after-demonstration summary; unsupported August/trust wording absent. |
| `stanford-engineering-bechtolsheim` | https://engineering.stanford.edu/about/history/heroes/2012-heroes/andreas-bechtolsheim | Andreas Bechtolsheim | Stanford Engineering | PASS — exact workstation and separate networking-founder career passages; details remain provenance-side. |
| `nsf-origins-outcome` | https://www.nsf.gov/news/origins-google | On the Origins of Google | National Science Foundation | PASS — later funding/relocation/incorporation summary; outcome-only. |

### Case 05 — `historical/domain-expert-and-ml` (corrective evidence)

| Citation | URL | Exact title | Publisher | Excerpt/source verdict |
|---|---|---|---|---|
| `nobel-kariko-banquet-speech` | https://www.nobelprize.org/prizes/medicine/2023/kariko/speech/ | Katalin Karikó – Banquet speech | Nobel Foundation | **PASS.** Verified the 1997 meeting account and that joint work followed. Used for event ordering, not model-facing provenance. |
| `cell-persistent-progress` | https://pmc.ncbi.nlm.nih.gov/articles/PMC8462135/ | Persistent progress | Cell | **PASS.** Verified Weissman's NIH/Penn dendritic-cell and vaccine work, stated lack of access to or knowledge of making RNA, then meeting Kati; also verified Karikó's 1989 therapeutic-protein mRNA direction. |
| `nobel-medicine-2023-press-release` | https://www.nobelprize.org/prizes/medicine/2023/press-release/ | Press release: The Nobel Prize in Physiology or Medicine 2023 | Nobel Foundation | **PASS.** Verified Karikó's pre-connection appointments and Weissman's 1987 degrees, clinical training, and NIH research. |
| `nobel-medicine-2023-advanced-information` | https://www.nobelprize.org/prizes/medicine/2023/advanced-information/ | The Nobel Prize in Physiology or Medicine 2023 – Advanced information | Nobel Foundation | **PASS WITH CAUTION.** Verified Weissman's immunology/microbiology degrees and subsequent training. The page contains later discoveries, but none is projected. |
| `pnas-kariko-weissman-q-and-a` | https://www.pnas.org/doi/10.1073/pnas.2119757118 | QnAs with Katalin Karikó | Proceedings of the National Academy of Sciences | **PASS.** Direct PNAS fetch returned HTTP 403; PMC, Crossref, Europe PMC, OpenAlex, and indexed PNAS evidence confirmed the exact metadata and the stored first-person excerpt: “I met Drew around 1997 … I had been working with mRNA for almost 10 years.” |
| `pnas-kariko-weissman-profile` | https://pmc.ncbi.nlm.nih.gov/articles/PMC10907315/ | Profile of Katalin Karikó and Drew Weissman: 2023 Nobel laureates in Physiology or Medicine | Proceedings of the National Academy of Sciences | **PASS; outcome-only.** Verified the exact title and stored later-outcome excerpt; it is disjoint from cutoff ordering and model-facing provenance. |

H5 uses Weissman as the seeker: his pre-contact vaccine research had an RNA-input gap, and Karikó had the needed long-running mRNA research direction. The boundary excludes the first substantive conversation, joint work, and all post-contact immune-sensing discoveries. Modified nucleosides, inflammatory response, Toll-like receptors, pseudouridine, later joint findings, COVID-19, companies, awards, and Nobel outcomes are absent from model-facing fields.

## Current case verdicts and corrections

| Case | Direction and material participants | Provenance | Negative categories | Current correction status |
|---|---|---|---|---|
| 01 | Ted → Jens; Ted and Martha jointly discovered/contacted Jens and founded the relationship represented by the dyadic benchmark | PASS — all nonblank model fields terminate in the three pre-telephone historical roots; outcome isolated | “National retail assortment curation and supplier sourcing represent buyer-side merchandising activity.”; “Packaging and brand identity represent visual-communications design for household-product companies.”; “Commissioned public architectural sculpture represents a site-specific civic-art application domain.” | Replaced the superseded Jobs/Wozniak fixture; repaired joint-spouse attribution, event boundary, neutral feasible `[0,29]` negatives, equal RAG scores, publisher field, and approval metadata |
| 02 | James → Francis | PASS — independent activity and method provenance; outcome isolated | method, scientific role, molecular scale | Original approved evidence preserved; flat cutoff representation migrated to the event-relative contract |
| 03 | John → Paul | PASS — demonstrated ability and recruitment evidence; outcome isolated | wrong-side recruitment, missing performance ability, missing popular-group interest | Original approved evidence preserved; flat cutoff representation migrated to the event-relative contract |
| 04 | Larry → Andy | PASS — evaluator activity and technical background are pre-demonstration; outcome isolated | capital direction, stage, technical fluency | Original approved evidence preserved; flat cutoff representation migrated to the event-relative contract |
| 05 | Drew → Katalin | PASS — Weissman's need and Karikó's pre-contact capability terminate in affirmative historical roots; outcome isolated | Hidden audit reasons remain same-side role, computational method, and plant domain; model-facing profiles and intents use neutral affirmative language | Reversed the superseded direction, grounded capability at the meeting, excluded post-contact science, rewrote all synthetic profiles/intents neutrally, equalized all candidate RAG scores at 70, and returned approval to pending re-review |

H1–H4 are **approved** with medium recognizability. H5 has medium author-assessed recognizability and is **pending independent re-review** after model-facing changes; strict aggregate admission remains unavailable until approval.

## Projection and serialization verdicts

The safe boundary is the projection or adapter output, not every containing object. A complete compatibility `MatchingCase` retains expectations and report names, and complete base seed payload control rows retain hashed expected/excluded IDs; neither complete container may be supplied wholesale to a model.

| Case | Reviewed checkpoint | `historicalModelSafeProjection` | Exact matching input | `matrixModelInput` | `baseSeedPayload` | Required changes |
|---|---|---|---|---|---|---|
| 01 | `6c20448cc20387953c0bf22b7d17f3249d47e391` | PASS — no identities, citations, provenance, review data, negative rationales, or outcome evidence | PASS — expectations stay control-side; all RAG scores equal 70 | PASS — audit/answer-key fields excluded | QUALIFIED PASS — model-facing separation passes; control case rows retain hashed labels | none |
| 02 | `7cb873b4bbd69f1e9fdecb30c35cd778ddb0563c` | PASS | PASS | PASS | Identity/audit separation confirmed by current serializer contract | none |
| 03 | `7cb873b4bbd69f1e9fdecb30c35cd778ddb0563c` | PASS | PASS | PASS | Identity/audit separation confirmed by current serializer contract | none |
| 04 | `7cb873b4bbd69f1e9fdecb30c35cd778ddb0563c` | PASS | PASS — the former legacy aggregate deferral was closed | PASS | Identity/audit separation confirmed by current serializer contract | none |
| 05 | pending re-review | AUTHORING PASS — report identity, citations, audit fields, negative rationale, and outcome evidence excluded; all candidate RAG scores equal 70 | AUTHORING PASS for `.input`; complete compatibility object is not control-label safe | Unavailable under strict aggregate admission while review is pending | Unavailable under strict aggregate admission while review is pending | Independent re-review pending |

The corrective all-five-case serializer tests at `4deb3e1a5` and `c7dfb9c88` invoke the real `baseSeedPayload(HISTORICAL_MATRIX_CASES)`, verify the exact 5-case/25-participant rows and references, and recursively reject report identities, citation IDs/URLs/titles/publishers/excerpts, semantic-negative rationales, and audit/report keys. These are provider-free contract checks, not evidence of a protected-base refresh or a live discovery measurement.

## Residual risks

- Every case remains moderately recognizable from its historical capability combination even though identifying and outcome clues are excluded.
- H1 keeps the positive first in participant order, but equalizes all candidate RAG scores. Its MoMA source is directly unfetchable, and retrospective sources disagree on discovery location.
- H5 remains unavailable to strict aggregate and matrix consumers until independent re-review approves the neutral affirmative negatives and equalized RAG presentation. Direct PNAS access returned HTTP 403, so verification used PMC and independent metadata indexes.
- Complete compatibility and seed-control containers retain answer-key material outside model input. Callers must use the explicit model-safe projections/adapters.
- Session-local raw review artifacts are not reproducible from a fresh checkout; this receipt and the current case review metadata are the committed audit record.

## Execution statement

The corrective review used source inspection, provider-free focused tests, typechecks, static serializer tests, lint, and whitespace checks. No protected-base refresh, shared-pool reseed, live model/provider invocation, database mutation, Redis/Neon operation, paid evaluation, baseline update, or live performance measurement occurred. Runtime integration and any authorized protected-base operation remain separate work; this receipt makes no IND-638 runtime claim.
