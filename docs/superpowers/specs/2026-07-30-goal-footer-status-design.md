# Goal Footer Status Design

## Purpose

Make the active `/goal` state visible in Index's project-local custom Pi footer. The footer currently replaces Pi's built-in footer, so it does not render the status that `@narumitw/pi-goal` already publishes.

## Scope

Update only `.pi/extensions/active-context.ts`.

- Do not change `@narumitw/pi-goal` or its settings.
- Do not add another extension, command, or persisted state.
- Do not change the existing PR, Linear issue, model, context, or subscription-usage displays.

## Design

Pi-goal publishes its current compact state under the extension-status key `goal` through `ctx.ui.setStatus()`. The custom footer will read that state from `footerData.getExtensionStatuses()` while rendering.

On footer line 2, append a goal indicator after the PR and Linear issue context when the `goal` status is present:

```text
🔀 PR#1297  🎯 IND-123  🏁 active 3m
```

The indicator uses the distinct `🏁` icon to avoid conflating goal progress with the existing `🎯` Linear issue icon. Its text is the status published by pi-goal without reimplementing or parsing pi-goal state. This supports all existing states consistently, including:

- `active 3m`
- `active 18k/100k`
- `paused`
- `blocked`
- `usage`
- `budget 100k/100k`
- `queue off`
- the package's brief `complete` state

When pi-goal has no status, the indicator is omitted. Pi-goal already clears its status when no goal remains.

## Data Flow

1. pi-goal updates its existing `goal` status through Pi's status API.
2. Pi supplies the current extension-status map to the custom footer as `footerData`.
3. `active-context.ts` retrieves the `goal` value and conditionally adds the compact indicator to its existing line-2 left-side parts.
4. The existing `composeLine()` and `truncateToWidth()` behavior handles narrow terminals without adding a line or displacing the existing model information incorrectly.

## Error Handling

A missing `goal` entry is normal and renders no goal indicator. The footer must not assume pi-goal is installed or enabled. It treats the status map as the single source of truth, so unknown future pi-goal status strings still render safely as compact text.

## Verification

1. Type-check or load the project-local extension without TypeScript/runtime errors.
2. In an interactive Pi session, start a goal and confirm line 2 displays `🏁 active …`.
3. Pause or otherwise stop the goal and confirm the indicator updates to the status pi-goal supplies.
4. Clear the goal and confirm the indicator disappears while existing footer context remains unchanged.
5. Check a narrow terminal width to confirm the existing truncation behavior still limits each rendered line to the available width.
