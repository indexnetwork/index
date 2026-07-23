# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Repository Guidance

Read and follow the root [`CLAUDE.md`](./CLAUDE.md) in full. It is the canonical,
shared repository guide and its project overview, commands, architecture,
conventions, testing requirements, Git workflow, and safety constraints apply to
all coding agents—not only Claude Code.

When interpreting that guide:

- Treat references to "Claude", "Claude Code", or a Claude session as references
  to the coding agent or agent session currently doing the work, unless the
  passage specifically concerns the Claude plugin under `packages/claude-plugin/`.
- Keep `CLAUDE.md` and this file aligned when changing repository-wide agent
  instructions. Put detailed shared guidance in `CLAUDE.md`; keep this file as the
  agent-neutral entry point so the two guides do not drift.
- More deeply nested `AGENTS.md` files, when present, add to or override these
  instructions for files in their directory tree.
