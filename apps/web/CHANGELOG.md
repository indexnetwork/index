# Changelog

All notable changes to the Index Network frontend are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added the default-off Signal Agent main-web cutover (IND-449): new home chats explicitly request the restricted persisted Signal persona, legacy orchestrator history stays readable with a separate-chat continuation action, and successful intent proposal confirmation navigates to the exact returned signal ID while preserving failure and undo behavior.

- Added a neutral, informational empty state to the intent-page Questions surfaces (IND-439 visibility-audit slice): both the fallback Questions panel and the Personal Agent chat zero-state now explain "No open questions right now — your agent asks when new matches need a decision" instead of leaving an unexplained gap. No warning colors or deprioritization cues.

- Added proactive high-VoI pool-question delivery surfaces: the Personal Agent badge now combines global pending questions with successfully pushed pool questions, while the Questions page remains global-only; intent-page mounts send a best-effort explicit visit ping and answer/dismiss actions refresh the canonical split counts (IND-421 P5).
- Added intent pause/resume controls: live intents show Pause, paused intents show Resume, mutations expose loading and error feedback, and the existing questions and Radar workspace remain visible while paused. A successful Resume starts bounded workspace refresh checkpoints through three minutes so new Radar matches, pending questions, and negotiator updates surface without permanent polling.

### Fixed

- Clear stale browser auth sessions automatically when user lookup fails.
- Show experiment networks such as Edge City in shared profile networks and link them to their network pages.
- Limit automatic onboarding redirects to the home page so signed-in users can open app routes like `/networks` before finishing setup.
