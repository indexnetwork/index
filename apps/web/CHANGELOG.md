# Changelog

All notable changes to the Index Network frontend are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add unread indicators to conversation rows and a thread-count badge to the Chats navigation entry, with mark-read wiring for open threads (IND-475).
- Add viewer-scoped `via:` signal chips, client-rendered match-seeded openers, and optional inbox provenance subtitles for human match threads (IND-475).
- Polished the signal-first Discover home (IND-473): header totals show listed signals and waiting opportunities, fresh signals display a WARMING state while discovery runs, and the list includes network scope, clamped titles, and the conversational new-signal CTA.


- Persisted the signal workspace's answered question log across visits, with server-backed answers, optimistic deduplication, and clearer pending-question copy (IND-472).

- Added the default-off Signal Agent main-web cutover (IND-449): every main-web continuation uses the dedicated Signal transport, legacy orchestrator history stays readable with all mutation controls disabled, and successful intent proposal confirmation navigates to the exact returned signal ID with truthful async undo behavior. Confirmations have per-proposal ownership and are bound to their originating route, in-memory session, and navigation generation, so concurrent cards in one chat complete independently while stale success or failure reports a safe non-actionable notification without mutating or navigating the newer chat. Request-local stream/load ownership prevents stale responses from overwriting newer chats, and typed policy refusals remain actionable in both home and loaded-chat states. CLI browser auth now uses an explicit state-bound v2 contract and a project-JWT-authenticated, fixed-shape CLI credential endpoint, while a temporary fail-closed v1 bridge mints separately tagged API keys for already-released clients without redirecting browser JWT compatibility back to the orchestrator.

- Added a neutral, informational empty state to the intent-page Questions surfaces (IND-439 visibility-audit slice): both the fallback Questions panel and the Personal Agent chat zero-state now explain "No open questions right now — your agent asks when new matches need a decision" instead of leaving an unexplained gap. No warning colors or deprioritization cues.

- Added proactive high-VoI pool-question delivery surfaces: the Personal Agent badge now combines global pending questions with successfully pushed pool questions, while the Questions page remains global-only; intent-page mounts send a best-effort explicit visit ping and answer/dismiss actions refresh the canonical split counts (IND-421 P5).
- Added intent pause/resume controls: live intents show Pause, paused intents show Resume, mutations expose loading and error feedback, and the existing questions and Radar workspace remain visible while paused. A successful Resume starts bounded workspace refresh checkpoints through three minutes so new Radar matches, pending questions, and negotiator updates surface without permanent polling.

### Fixed

- Keep the answered Q&A log visible in the Personal Agent negotiator chat branch after questions are answered (IND-481).
- Clear stale browser auth sessions automatically when user lookup fails.
- Show experiment networks such as Edge City in shared profile networks and link them to their network pages.
- Limit automatic onboarding redirects to the home page so signed-in users can open app routes like `/networks` before finishing setup.
