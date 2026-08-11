# Protocol Atlas Readability Design

## Problem

The guided-flow diagram presents concept and implementation nodes as fixed-height cards inside a horizontally scrolling canvas. Long definitions create nested vertical scrollbars, while SVG relationship lines and labels pass behind or through the cards. The result is difficult to scan and especially confusing at intermediate desktop widths.

## Goal

Make every guided-flow node and relationship readable without nested scrolling, clipped text, or overlaid graphics while preserving the Atlas interaction model, evidence, and static dependency-free runtime.

## Scope

Change only the guided-flow diagram renderer, its styles, and affected Atlas tests:

- `docs/protocol-atlas/atlas.js`
- `docs/protocol-atlas/atlas.css`
- affected tests under `scripts/tests/`

Do not change curated content, generated evidence, configuration semantics, deep links, hosting, package versions, or external dependencies.

## Layout

Replace the SVG-backed horizontal canvas with a content-first section:

1. Render node buttons in a natural-height responsive grid.
2. Use three columns on wide screens, two at intermediate widths, and one on mobile.
3. Allow every card to display its full definition or summary.
4. Let the document page scroll; node cards must not have independent vertical scrolling.
5. Render semantic relationship rows beneath the node grid.

The section must not create an SVG relationship layer or require horizontal scrolling for ordinary guided-flow content.

## Node Interaction

Node cards remain buttons and retain existing behavior:

- selecting a node updates `selectedNodeId` through the current dispatch path;
- selected and configuration-delta styling remains visible;
- the inspector continues to expose metadata and implementation evidence;
- keyboard focus and `aria-pressed` behavior remain unchanged;
- filter-empty states remain in the node grid and retain the reset action.

No state, URL, search, filter, layer-switching, or Configuration Lab contracts change.

## Relationship Presentation

Each valid relationship is rendered as one semantic list row with:

- source node label;
- edge kind plus human-readable relationship label;
- target node label;
- configuration-delta label when applicable.

Rows retain textual edge-kind labels and existing non-color cues. Color may reinforce the edge kind but cannot be the only encoding. At narrow widths, source, relationship, target, and delta fields stack in reading order.

Relationships whose source or target is not visible continue to be omitted. Missing or malformed relationship records must not prevent readable nodes from rendering.

## Responsive Behavior

- Wide (`> 900px`): three node columns; relationship rows use source / relationship / target / delta columns.
- Intermediate (`641–900px`): two node columns; relationship rows stack their fields and align left.
- Mobile (`≤ 640px`): one node column; relationship rows remain stacked and left-aligned.

Cards have no fixed height, `max-height`, or `overflow-y: auto`. Definitions use ordinary wrapping and readable line height.

## Accessibility

- Preserve semantic button nodes and the relationship list.
- Remove the redundant SVG image semantics along with the SVG layer.
- Preserve focus indicators, minimum touch target sizing, `aria-pressed`, and status announcements.
- Keep edge kind and direction available as text.
- Maintain grayscale-safe and reduced-motion behavior.

## Failure and Degradation Behavior

- Zero nodes: show the existing no-nodes or filter-empty state.
- Zero valid relationships: keep the Relationships section readable with an empty semantic list; no decorative line layer is required.
- Malformed generated data: preserve existing fail-soft validation and curated-layer availability.
- Schema-1 artifacts: preserve the existing Configuration Lab degradation behavior.

## Testing and Verification

Tests must establish:

- the renderer no longer creates an SVG diagram layer;
- nodes remain selectable and inspector behavior is unchanged;
- relationships remain available as semantic text;
- node cards do not use nested vertical scrolling or fixed maximum height;
- responsive CSS defines three columns above 900px, two columns from 641–900px, and one column at 640px or below;
- mobile relationship rows stack in source-to-target reading order;
- empty/filter states, configuration deltas, and malformed-data degradation remain intact.

Run the complete Atlas suite, generated artifact check, web production build, targeted ESLint, and `git diff --check`. Obtain an independent scoped review before updating PR #1356.

## Acceptance Criteria

1. All node definitions are visible without scrolling inside a card.
2. No relationship line or label crosses node content.
3. Ordinary guided flows require no horizontal scrolling.
4. Relationships remain explicit and understandable without color.
5. Existing Atlas navigation, selection, inspector, filters, deltas, and degradation behavior pass unchanged.
