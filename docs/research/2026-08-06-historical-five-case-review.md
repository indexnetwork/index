# IND-637 historical five-case independent review receipt

Date: 2026-08-06

## Issue and purpose

IND-637 hardens the five historical matching cases before they seed shared-pool retrieval experiments. The work requires every model-facing historical statement to have pre-connection provenance, synthetic negatives to remain explicitly authored, outcomes and real identities to remain report-only, and combination-based recognizability to receive independent review.

This receipt records the independent citation, cutoff, provenance, synthetic-negative, leakage, and current-serialization review. It does not approve the legacy discovery-environment matrix adapter: `matrixModelInput` remains explicitly **PENDING Task 8**.

## Reviewed checkpoints and participants

- Corrected checkpoint for Cases 01, 02, 04, and 05: `770cf7f754e63e4a7a61362389a0759d4d8632b9`.
- Case 03 final corrected checkpoint: `b6deffd73584e5f5a8f31a5435e0901229a57003`.
- Review date recorded in case metadata: `2026-08-06`.
- The sole patch-applying writer was the Task 7 implementation `worker` in the assigned worktree. All initial and final reviewer sessions were read-only.

### Initial independent web audits

The initial audits supplied the source/title/publisher/excerpt evidence used by the writer and requested revisions; they were not approvals.

| Case | Initial audit ID | Durable artifact |
|---|---|---|
| 01 | `937423ed` | `.pi-subagents/artifacts/outputs/937423ed/.superpowers/sdd/2026-08-06-ind-637-historical-five-case-hardening/task-7-case-01-initial.md` |
| 02 | `7f2f4495` | `.pi-subagents/artifacts/outputs/7f2f4495/.superpowers/sdd/2026-08-06-ind-637-historical-five-case-hardening/task-7-case-02-initial.md` |
| 03 | `bc201caf` | `.pi-subagents/artifacts/outputs/bc201caf/.superpowers/sdd/2026-08-06-ind-637-historical-five-case-hardening/task-7-case-03-initial.md` |
| 04 | `bc6e2bcd` | `.pi-subagents/artifacts/outputs/bc6e2bcd/.superpowers/sdd/2026-08-06-ind-637-historical-five-case-hardening/task-7-case-04-initial.md` |
| 05 | `3665943a` | `.pi-subagents/artifacts/outputs/3665943a/.superpowers/sdd/2026-08-06-ind-637-historical-five-case-hardening/task-7-case-05-initial.md` |

### Final independent approvals

| Case | Final reviewer | Reviewed checkpoint | Durable artifact | Decision | Recognizability |
|---|---|---|---|---|---|
| 01 | `pi-reviewer:e8085cfa` | `770cf7f754e63e4a7a61362389a0759d4d8632b9` | `.pi-subagents/artifacts/outputs/e8085cfa/.superpowers/sdd/2026-08-06-ind-637-historical-five-case-hardening/task-7-case-01-approval.md` | approved | medium |
| 02 | `pi-reviewer:5e071b82` | `770cf7f754e63e4a7a61362389a0759d4d8632b9` | `.pi-subagents/artifacts/outputs/5e071b82/.superpowers/sdd/2026-08-06-ind-637-historical-five-case-hardening/task-7-case-02-approval.md` | approved | medium |
| 03 | `pi-reviewer:a091da6e` | `b6deffd73584e5f5a8f31a5435e0901229a57003` | `.pi-subagents/artifacts/5166b71c_reviewer_output.md` | approved | medium |
| 04 | `pi-reviewer:ba43fe8c` | `770cf7f754e63e4a7a61362389a0759d4d8632b9` | `.pi-subagents/artifacts/outputs/ba43fe8c/.superpowers/sdd/2026-08-06-ind-637-historical-five-case-hardening/task-7-case-04-approval.md` | approved | medium |
| 05 | `pi-reviewer:07908e5e` | `770cf7f754e63e4a7a61362389a0759d4d8632b9` | `.pi-subagents/artifacts/outputs/07908e5e/.superpowers/sdd/2026-08-06-ind-637-historical-five-case-hardening/task-7-case-05-approval.md` | approved | medium |

## Citation verification

Every row below records the final URL, exact stored title and publisher, and the independent verdict on the stored excerpt. Outcome-only use is called out where applicable.

### Case 01 — `historical/builder-and-operator`

| Citation | URL | Exact title | Publisher | Excerpt verification |
|---|---|---|---|---|
| `esquire-1971` | https://classic.esquire.com/secrets-of-the-blue-box/ | Secrets of the Little Blue Box | Esquire | PASS — exact publication date; ordering-only. |
| `npr-wozniak-2006` | https://www.npr.org/2006/09/29/6167297/a-chat-with-computing-pioneer-steve-wozniak | A Chat with Computing Pioneer Steve Wozniak | NPR | PASS — exact article discovery, fifth/sixth-grade project practice, and repeated high-school design passages. |
| `computerworld-jobs-1995` | https://www.computerworld.com/article/1476597/steve-jobs-interview-one-on-one-in-1995.html | Steve Jobs interview: One-on-one in 1995 | Computerworld | PASS — corrected direct rudiments, completed-Heathkit, and first-computer passages. |
| `npr-jobs-lost-interview` | https://www.npr.org/sections/alltechconsidered/2011/11/16/142373973/steve-jobs-dishes-on-the-tech-business-in-lost-interview-from-1995 | Steve Jobs Dishes On The Tech Business In 'Lost Interview' From 1995 | NPR | PASS — explicit first-big-project and Esquire-before-project chronology. |
| `npr-wozniak-transcript` | https://www.npr.org/transcripts/6179983 | Computer Pioneer Steve Wozniak Tells His Story | NPR | PASS — prior-computer and introduction passage supports “another person,” not “school friend.” |
| `computer-history-museum-jobs` | https://computerhistory.org/blog/steve-jobs/ | Steve Jobs: From Garage to World’s Most Valuable Company | Computer History Museum | PASS — exact 1971 mutual-friend introduction passage; retained as report-side evidence. |
| `loc-apple-founding` | https://guides.loc.gov/this-month-in-business-history/april/apple-computer-founded | The Founding of Apple Computer, Inc. | Library of Congress | PASS — corrected exact “college dropouts” founding/sales passage; outcome-only. |

### Case 02 — `historical/co-researchers-structure`

| Citation | URL | Exact title | Publisher | Excerpt verification |
|---|---|---|---|---|
| `nobel-watson-biographical` | https://www.nobelprize.org/prizes/medicine/1962/watson/biographical/ | James Watson – Biographical | Nobel Foundation | PASS — zoology/phage/Copenhagen/May redirection and early-October ordering summary verified. |
| `wellcome-crick-archives` | https://wellcomecollection.org/works/hz43r7re | Francis Crick (1916-2004): archives | Wellcome Collection | PASS — physics, broad interests, and June 1949 crystallographic work summary verified. |
| `asu-1953-paper-history` | https://embryo.asu.edu/pages/molecular-structure-nucleic-acids-structure-deoxyribose-nucleic-acid-1953-james-watson-and | “Molecular Structure of Nucleic Acids: A Structure for Deoxyribose Nucleic Acid” (1953), by James Watson and Francis Crick | Arizona State University Embryo Project Encyclopedia | PASS — corrected exact title and October-collaboration excerpt. |
| `science-history-biographies` | https://www.sciencehistory.org/education/scientific-biographies/francis-crick-rosalind-franklin-james-watson-and-maurice-wilkins/ | Francis Crick, Rosalind Franklin, James Watson, and Maurice Wilkins | Science History Institute | PASS — image-viewing/redirection passage verified and kept out of serialized profiles. |
| `nobel-1962-summary` | https://www.nobelprize.org/prizes/medicine/1962/summary/ | The Nobel Prize in Physiology or Medicine 1962 | Nobel Foundation | PASS — prize rationale verified; outcome-only. |

### Case 03 — `historical/songwriting-duo`

| Citation | URL | Exact title | Publisher | Excerpt verification |
|---|---|---|---|---|
| `nml-first-meeting` | https://www.liverpoolmuseums.org.uk/stories/when-paul-mccartney-met-john-lennon | When Paul McCartney met John Lennon | National Museums Liverpool | PASS — verbatim 6 July meeting, guitar demonstration, and invitation-weeks-later passages. |
| `john-lennon-mother` | https://www.johnlennon.com/news/mother-%E2%86%92-watch-the-4k-remastered-video-discover-more-about-johns-childhood/ | MOTHER. → Watch the 4K Remastered Video & discover more about John's childhood. | JohnLennon.com | PASS — exact banjo-to-guitar and practice passage; unsupported pre-performance claim removed. |
| `mccartney-lyrics-special` | https://www.paulmccartney.com/news/you-gave-me-the-answer-the-lyrics-1956-to-the-present-special | You Gave Me The Answer - 'The Lyrics: 1956 to the Present' Special | PaulMcCartney.com | PASS — exact first-song/age-fourteen passage; evidence-only. |
| `national-trust-history` | https://www.nationaltrust.org.uk/visit/liverpool-lancashire/the-beatles-childhood-homes/history-of-the-beatles-childhood-homes | History of the Beatles' Childhood Homes | National Trust | PASS — exact better-guitarist recruitment and joining passage. |
| `guinness-songwriter-number-ones` | https://www.guinnessworldrecords.com/world-records/69695-most-number-one-singles-by-a-songwriter | Most US No.1 singles by a songwriter | Guinness World Records | PASS — exact songwriter record passage; outcome-only. |

### Case 04 — `historical/first-check-investor`

| Citation | URL | Exact title | Publisher | Excerpt verification |
|---|---|---|---|---|
| `stanford-search-paper` | http://infolab.stanford.edu/~backrub/google.html | The Anatomy of a Large-Scale Hypertextual Web Search Engine | Stanford University | PASS — April 1998 prototype/scale/quality summary verified. |
| `nsf-origins-context` | https://www.nsf.gov/news/origins-google | On the Origins of Google | National Science Foundation | PASS — link-ranking and unnamed collaborator context verified. |
| `stanford-otl-uniquely-google` | http://infolab.stanford.edu/pub/voy/museum/google.htm | Uniquely Google(TM) | Stanford Office of Technology Licensing | PASS — company-decision, demonstration/check, and incorporation ordering summary verified. |
| `stanford-engineering-hero-talk` | https://engineering.stanford.edu/news/andy-bechtolsheim-hero-talks-innovation-success-and-engineering | Andy Bechtolsheim: Hero talks innovation, success and engineering | Stanford Engineering | PASS — corrected 1998 invitation/demonstration and check-after-demonstration summary; unsupported August/trust wording absent. |
| `stanford-engineering-bechtolsheim` | https://engineering.stanford.edu/about/history/heroes/2012-heroes/andreas-bechtolsheim | Andreas Bechtolsheim | Stanford Engineering | PASS — exact workstation and separate networking-founder career passages; details remain provenance-side. |
| `nsf-origins-outcome` | https://www.nsf.gov/news/origins-google | On the Origins of Google | National Science Foundation | PASS — later funding/relocation/incorporation summary; outcome-only. |

### Case 05 — `historical/domain-expert-and-ml`

| Citation | URL | Exact title | Publisher | Excerpt verification |
|---|---|---|---|---|
| `nobel-kariko-banquet-speech` | https://www.nobelprize.org/prizes/medicine/2023/kariko/speech/ | Katalin Karikó – Banquet speech | Nobel Foundation | PASS — verbatim 1997 meeting/start-of-work ordering passage. |
| `cell-persistent-progress` | https://pmc.ncbi.nlm.nih.gov/articles/PMC8462135/ | Persistent progress | Cell | PASS — corrected direct pre-1997 source and partner activity passages; 1997 RNA-gap use removed. |
| `nobel-medicine-2023-press-release` | https://www.nobelprize.org/prizes/medicine/2023/press-release/ | Press release: The Nobel Prize in Physiology or Medicine 2023 | Nobel Foundation | PASS — corrected exact title and direct appointment/training passages. |
| `nobel-medicine-2023-advanced-information` | https://www.nobelprize.org/prizes/medicine/2023/advanced-information/ | The Nobel Prize in Physiology or Medicine 2023 – Advanced information | Nobel Foundation | PASS — direct RNA/protein-expression and immunology/microbiology/NIH passages. |
| `pnas-kariko-weissman-profile` | https://pmc.ncbi.nlm.nih.gov/articles/PMC10907315/ | Profile of Katalin Karikó and Drew Weissman: 2023 Nobel laureates in Physiology or Medicine | Proceedings of the National Academy of Sciences | PASS — corrected exact title and outcome sentence; outcome-only. |

## Final checklist verdicts and corrections

| Case | Cutoff | Provenance | Synthetic negatives | Leakage | Current historical/canonical serialization | Matrix serialization | Corrections applied |
|---|---|---|---|---|---|---|---|
| 01 | PASS — exclusive `1971`, first-big-project ordering | PASS — all nonblank paths mapped; participant-only activities | PASS — three authored, requirement-specific failures | medium | PASS — names, relationship/year/project/outcome/business clues absent | PENDING Task 8 | Exact Computerworld/LOC text; authoritative NPR ordering; “another person”; removed quasi-identifiers; generalized capability complement and intents. |
| 02 | PASS — exclusive `1951-10`, collaboration begins in October | PASS — age/image/interpretation/modeling desire removed; independent activities | PASS — method, scientific-role, and molecular-scale failures | medium | PASS — names, outcome, image/age/data-possession and identifying subject conjunction absent | PENDING Task 8 | Exact ASU title; biological-macromolecule/physical-method generalization; generalized locations; independently supported activities. |
| 03 | PASS — exclusive `1957-07`, meeting/demonstration before later invitation/joining | PASS — blank locations unmapped; recruitment and demonstrated ability retained | PASS — wrong-side recruitment, absent performance ability, absent popular-group interest | medium | PASS — region/local/event/tuning/recall/invitation/song/place clues absent | PENDING Task 8 | Exact all-citation fixtures; first-substantive boundary; removed synthetic geography/event clues; further generalized positive pair. |
| 04 | PASS — exclusive `1998-08`, company decision/invitation before demonstration and check | PASS — evaluator-only intent; no trust/funding willingness; both founding facts support abstractions | PASS — capital direction, stage, and technical-fluency failures | medium | PASS at module-level — names, transaction, trust/funding, distinctive prototype/career sequences absent | PENDING Task 8 | Corrected hero-talk text; evaluator-not-backer framing; generalized prototype and career sequence; retained two founding facts in provenance. |
| 05 | PASS — exclusive `1997`, encounter/joint work excluded | PASS — RNA-gap removed; participant-only activities and exact path mappings | PASS — same-side role, lab method, and human-domain failures | medium | PASS — names, meeting, outcome, mRNA+dendritic+HIV, antigen/payload, and reciprocal-intent clues absent | PENDING Task 8 | Exact titles/verbatim excerpts; removed RNA gap; independent activities; generalized nucleic-acid/immune complement and negatives. |

All five final reviewer decisions are **approved** with no required changes. Residual recognizability is **medium** for each case: the requirement-relevant complement can suggest a famous pairing to a knowledgeable reader, but the unique confirming conjunctions and outcome clues have been removed from current historical and canonical matching inputs.

## Serialization boundary and deferred work

The reviewed `historicalModelSafeProjection` contains only `description`, a clone of `case.input`, and cloned trigger inputs. The module-level `historicalMatchingCaseProjection` also preserves each reviewed module's exact `case.input`; those two module projections passed all five final reviews. The matching runner consumes the `c.input` supplied by its corpus, so this statement does not approve a separate legacy aggregate entry.

`matrixModelInput` and the legacy aggregate adapter are **PENDING Task 8**. In particular, this Task 7 receipt does not switch or approve the legacy Case 04 entry in `matching.historical.ts`. No matching aggregate or matrix file was modified for this approval.

## Execution statement

No live model, provider, database, Redis, Neon, or paid evaluation command ran during authoring or review. Reviewers inspected source evidence, provenance, and static serialization read-only. The implementation writer ran only provider-free focused tests, typechecks, lint, and whitespace checks.
