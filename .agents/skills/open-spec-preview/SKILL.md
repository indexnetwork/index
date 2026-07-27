---
name: open-spec-preview
description: Open a freshly written spec or implementation-plan markdown in a new Herdr pane on the right rendered with glow, so the user can review it inline. Use right after writing or substantially updating a spec, plan, or design doc (docs/superpowers/specs/*.md or docs/superpowers/plans/*.md) and asking the user to review it.
---

# Open Spec Preview

After writing a spec, implementation plan, or design doc, show it to the user rendered —
don't just hand them a path.

Skill input: optional path to the markdown file. When omitted, use the markdown file
you most recently wrote or edited (typically under `docs/superpowers/specs/` or
`docs/superpowers/plans/`).

## Steps

1. Resolve the target file: `$ARGUMENTS` if given, else the most recently
   written/edited `.md` from this session. Confirm it exists.
2. Preflight Herdr (do not silently fall back to plain text if unavailable — ask):

   ```bash
   command -v herdr && herdr status server
   ```

3. Split the current pane to the right and capture the new pane id:

   ```bash
   herdr pane split --current --direction right
   ```

4. Render the doc with glow in the new pane (absolute path):

   ```bash
   herdr pane run <PANE_ID> glow /absolute/path/to/spec.md
   ```

   If `glow` is missing (`command -v glow`), fall back to `less` the same way.

5. Tell the user the doc is open in the right-hand pane and ready for review.

## Notes

- Keep the agent pane untouched — the preview always goes in the *new* right pane so
  the conversation stays put.
- One preview pane per review round: if a preview pane from this session is already
  open, reuse it (`herdr pane run` again) instead of stacking splits.
- Do not block on the pane; it's a viewer for the user, not part of the workflow.

## See also

- `create-worktree` — Herdr preflight details and pane-management conventions.
