# Changelog

## Unreleased

### Added
- A host can pass a `negotiate` hook. It runs before the built-in negotiator and can return its own turn or stall, or call `next()` to use the built-in one.

### Fixed
- Brief and negotiate runs require a tool call on their first step, so a prose reply cannot drop the brief or the turn.
