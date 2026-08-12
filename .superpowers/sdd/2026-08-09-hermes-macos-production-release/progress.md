# SDD ledger — plan: docs/superpowers/plans/2026-08-09-hermes-macos-production-release.md
Task 1: fix round 1/5 (3 addressed, 0 open; commits fe363db5f..a05a67fec)
Task 1: complete (commits 8643df0ac..a05a67fec, review clean)
Task 2: fix round 1/5 (3 Important + 1 Minor addressed, 1 new Important open; commits 5147651d6..c40a0c61c)
Task 2: fix round 2/5 (1 addressed, 0 open; commits c40a0c61c..e4bf13274)
Task 2: complete (commits a05a67fec..e4bf13274, review clean)
Task 3: fix round 1/5 (2 Critical + 5 Important + 2 Minor addressed, 0 open; commits 83927d0c5..cbac9ad7d)
Task 3: complete (commits e4bf13274..cbac9ad7d, review clean)
Task 4: fix round 1/5 (3 Critical addressed, 5 Important + 1 new Important open; commits 46d5ac7da..6013f86b3)
Task 4: fix round 2/5 (4 Important addressed, 2 Important open; commits 6013f86b3..0398b895d)
Task 4: fix round 3/5 (1 Important addressed, 2 Important open including new cleanup window; commits 0398b895d..734a2fd73)
Task 4: fix round 4/5 (copy-on-success and promotion cleanup improved, 2 Important filesystem races open; commits 734a2fd73..04bf0bf7e)
Task 4: fix round 5/5 (native no-clobber promotion and immutable-source transform added, 3 same-UID/signal race observations open; commits 04bf0bf7e..8e676b6b1)
Task 4: parked — concurrent same-UID output-symlink insertion can race private-output copy — ruling: real only under a malicious concurrent process already running as the protected runner user, which can replace release scripts and artifacts directly; outside the dedicated fresh protected-runner threat model; Task 6 must use an isolated runner and mode-0700 transaction roots.
Task 4: parked — same-UID replacement can race identity-checked quarantine deletion — ruling: same trusted-runner boundary; no untrusted concurrent same-UID workloads are permitted in protected release execution, and a same-UID adversary already has equivalent arbitrary mutation authority.
Task 4: parked — SIGKILL/helper-termination after successful atomic rename can leave a candidate visible — ruling: no users/publication can observe the private protected-runner filesystem and SIGKILL cannot be made cleanup-safe in shell; publication remains a later explicit verified step and Task 6 must begin/end with absence/final-hash gates.
Task 4: complete (commits cbac9ad7d..8e676b6b1, 3 parked after breaker; all in-scope isolated-runner release gates implemented)
Task 5: implementation complete pending review (deterministic exact-schema metadata/checksums, strict Task 4 provenance consumption, provider-free CMS sign/verify contracts; no identity used)
