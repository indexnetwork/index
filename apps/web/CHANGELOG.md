# Changelog

All notable changes to the Index Network frontend are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added intent pause/resume controls: live intents show Pause, paused intents show Resume, mutations expose loading and error feedback, and the existing questions and Radar workspace remain visible while paused. A successful Resume starts bounded workspace refresh checkpoints through three minutes so new Radar matches, pending questions, and negotiator updates surface without permanent polling.

### Fixed

- Clear stale browser auth sessions automatically when user lookup fails.
- Show experiment networks such as Edge City in shared profile networks and link them to their network pages.
- Limit automatic onboarding redirects to the home page so signed-in users can open app routes like `/networks` before finishing setup.
