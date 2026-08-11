# Protocol Atlas Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unreadable SVG-backed, nested-scroll Protocol Atlas diagram with natural-height node cards and explicit semantic relationship rows.

**Architecture:** Keep the existing Atlas state, filtering, selection, inspector, and evidence pipeline unchanged. Simplify only `renderDiagram` and its presentation contract: derive visible nodes and edges as before, render nodes into a responsive CSS grid, and render relationships into the existing semantic list without an SVG layer.

**Tech Stack:** Dependency-free classic JavaScript, CSS, Bun tests, Happy DOM renderer tests.

## Global Constraints

- Static runtime remains dependency-free and works through `file://` and static HTTP.
- Change only the guided-flow renderer, its CSS, affected Atlas tests, and temporary planning artifacts.
- Do not change curated content, generated evidence, configuration semantics, deep links, hosting, package versions, or external dependencies.
- Wide (`> 900px`) uses three node columns; intermediate (`641–900px`) uses two; mobile (`≤ 640px`) uses one.
- Node cards must not use fixed height, `max-height`, or independent vertical scrolling.
- Relationship meaning must remain available as text and cannot depend on color.
- Preserve node selection, inspector, filters, configuration deltas, empty states, and malformed-data degradation.

---

### Task 1: Replace the SVG renderer with semantic content

**Files:**
- Modify: `docs/protocol-atlas/atlas.js:799-912`
- Test: `scripts/tests/protocol-atlas-core.spec.ts:545-592`
- Test: `scripts/tests/protocol-atlas-core.spec.ts:631-675`

**Interfaces:**
- Consumes: existing `diagramRecords(step, atlasState, atlasContent, atlasGenerated)` and `diagramEdges(step, atlasState, atlasContent, atlasGenerated, visibleIds)` functions.
- Produces: `renderDiagram(...)` returning `.atlas-flow-map` with `.atlas-node-grid` followed by `.atlas-relationship-fallback`; node buttons and relationship row class names remain unchanged.

- [ ] **Step 1: Write the failing content-first renderer assertions**

Update the semantic-controls renderer test so its opening assertions are:

```ts
const flowMap = harness.document.querySelector(".atlas-flow-map");
expect(flowMap?.getAttribute("aria-label")).toContain("Resolve scope protocol diagram");
expect(flowMap?.querySelector("svg")).toBeNull();
expect(flowMap?.querySelectorAll(".atlas-node-grid .atlas-node").length).toBeGreaterThan(0);
expect(flowMap?.lastElementChild?.classList.contains("atlas-relationship-fallback")).toBe(true);
```

Rename that test to `dispatches semantic step controls, renders a content-first flow map, and excludes interactive controls from arrow navigation`.

In the semantic relationship test, add:

```ts
const first = rows[0];
expect(Array.from(first?.children ?? [], (child) => child.className)).toEqual([
  "atlas-relationship__source",
  "atlas-relationship__kind",
  "atlas-relationship__target",
]);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
bun test scripts/tests/protocol-atlas-core.spec.ts -t "content-first flow map|semantic text"
```

Expected: FAIL because `.atlas-flow-map` and `.atlas-node-grid` do not exist and the current renderer creates an SVG.

- [ ] **Step 3: Implement the minimal semantic renderer**

In `renderDiagram`:

1. Change the wrapper class to `atlas-flow-map` and preserve its current `aria-label`.
2. Delete `--atlas-node-count`, `--atlas-diagram-width`, SVG creation, SVG title/description, position-map creation, and SVG edge-group creation.
3. Derive visibility directly:

```js
const visibleIds = new Set(nodes.map((node) => node.id));
const visibleEdges = diagramEdges(step, atlasState, atlasContent, atlasGenerated, visibleIds);
```

4. Rename the ordered node list class from `atlas-diagram-nodes` to `atlas-node-grid`.
5. Preserve the existing empty/filter reset branch, node-button construction, selection dispatch, boundary callout, and configuration-delta classes byte-for-byte.
6. Append only the readable layers in this order:

```js
wrapper.append(overlay, relationshipSection);
```

Do not introduce replacement canvas, line, or arrow elements.

- [ ] **Step 4: Run the focused renderer tests and verify GREEN**

Run:

```bash
bun test scripts/tests/protocol-atlas-core.spec.ts -t "content-first flow map|semantic text"
```

Expected: PASS. The DOM contains no SVG, node buttons remain present, relationship rows retain source/kind/target fields, and the existing keyboard/inspector assertions pass.

- [ ] **Step 5: Run all renderer tests**

Run:

```bash
bun test scripts/tests/protocol-atlas-core.spec.ts
```

Expected: all renderer/core tests pass, including Configuration Lab, malformed-data, search, filters, history, and clipboard fallback tests.

- [ ] **Step 6: Commit the semantic renderer**

```bash
git add docs/protocol-atlas/atlas.js scripts/tests/protocol-atlas-core.spec.ts
git commit -m "fix(docs): render readable atlas relationships"
```

---

### Task 2: Make node cards naturally readable at every breakpoint

**Files:**
- Modify: `docs/protocol-atlas/atlas.css:402-487`
- Modify: `docs/protocol-atlas/atlas.css:730-870`
- Modify: `docs/protocol-atlas/atlas.css:1149-1265`
- Test: `scripts/tests/build-protocol-atlas.spec.ts:149-181`

**Interfaces:**
- Consumes: `.atlas-flow-map`, `.atlas-node-grid`, `.atlas-node`, `.atlas-relationship-fallback`, and `.atlas-relationship*` emitted by Task 1.
- Produces: three/two/one-column responsive grid and natural-height node cards with no inner scrolling.

- [ ] **Step 1: Replace SVG-focused static assertions with readability assertions**

In `keeps responsive layouts bounded with touch and grayscale-safe interaction cues`, remove assertions for `.atlas-edge`, SVG stroke patterns, `.atlas-edge text`, and the mobile-hidden SVG. Add:

```ts
const nodeGrid = css.match(/\.atlas-node-grid\s*\{([^}]*)\}/)?.[1];
expect(nodeGrid).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);

const nodeCard = css.match(/\.atlas-node-grid \.atlas-node\s*\{([^}]*)\}/)?.[1];
expect(nodeCard).toMatch(/height:\s*100%/);
expect(nodeCard).not.toMatch(/max-height|overflow-y/);

const intermediate = css.slice(css.indexOf("@media (max-width: 900px)"), css.indexOf("@media (max-width: 640px)"));
expect(intermediate).toMatch(/\.atlas-node-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
expect(intermediate).toMatch(/\.atlas-relationship\s*\{[^}]*grid-template-columns:\s*1fr/s);

const mobile = css.slice(css.indexOf("@media (max-width: 640px)"), css.indexOf("@media (max-width: 375px)"));
expect(mobile).toMatch(/\.atlas-node-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
expect(css).not.toContain(".atlas-diagram-canvas svg");
expect(css).not.toContain("overflow-y: auto;\n  pointer-events: auto");
```

Keep the existing touch target, body overflow, configuration-delta, and breakpoint assertions.

- [ ] **Step 2: Run the static contract test and verify RED**

Run:

```bash
bun test scripts/tests/build-protocol-atlas.spec.ts -t "responsive layouts bounded"
```

Expected: FAIL because the current CSS uses the old canvas, fixed-width absolute overlay, and scrolling cards.

- [ ] **Step 3: Replace canvas and overlay CSS with the responsive grid**

Remove unused SVG-only `.atlas-edge*` rules, the four `--edge-*-pattern` custom properties, and the old `.atlas-diagram-canvas`, `.atlas-diagram-nodes`, width-variable, absolute-overlay, fixed-height, and SVG rules. Preserve the four `--edge-*` color properties used by semantic relationship rows.

Add the base layout:

```css
.atlas-flow-map {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: rgb(5 11 22 / 0.72);
}

.atlas-node-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  align-items: stretch;
  margin: 0;
  padding: var(--space-4);
  list-style: none;
}

.atlas-node-grid > li {
  display: flex;
  min-width: 0;
}

.atlas-node-grid > li.atlas-empty {
  grid-column: 1 / -1;
  display: block;
}

.atlas-node-grid .atlas-node {
  height: 100%;
  overflow: visible;
}
```

Keep the relationship section beneath the grid. Preserve its edge-kind text and color variables. Give `.atlas-node__meta` ordinary readable wrapping without changing its content:

```css
.atlas-node__meta {
  overflow-wrap: anywhere;
  line-height: 1.55;
  text-transform: none;
}
```

- [ ] **Step 4: Implement the intermediate and mobile contracts**

Inside `@media (max-width: 900px)` add:

```css
.atlas-node-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.atlas-relationship {
  grid-template-columns: 1fr;
  align-items: start;
}

.atlas-relationship__kind {
  text-align: left;
}
```

Inside `@media (max-width: 640px)` replace old diagram overrides with:

```css
.atlas-flow-map {
  border-inline: 0;
}

.atlas-node-grid {
  grid-template-columns: 1fr;
  padding: 0;
}
```

Do not add card-specific scrolling at any breakpoint.

- [ ] **Step 5: Run the static and renderer suites**

Run:

```bash
bun test scripts/tests/build-protocol-atlas.spec.ts -t "responsive layouts bounded"
bun test scripts/tests/build-protocol-atlas.spec.ts scripts/tests/protocol-atlas-core.spec.ts
```

Expected: the focused static test passes, then the complete Atlas suite passes.

- [ ] **Step 6: Commit the responsive presentation**

```bash
git add docs/protocol-atlas/atlas.css scripts/tests/build-protocol-atlas.spec.ts
git commit -m "fix(docs): make atlas flow cards readable"
```

---

### Task 3: Verify the complete readability change

**Files:**
- Verify: `docs/protocol-atlas/atlas.js`
- Verify: `docs/protocol-atlas/atlas.css`
- Verify: `scripts/tests/protocol-atlas-core.spec.ts`
- Verify: `scripts/tests/build-protocol-atlas.spec.ts`

**Interfaces:**
- Consumes: completed semantic renderer and responsive CSS from Tasks 1–2.
- Produces: a fully verified branch ready for task review and whole-branch review while the approved spec and plan remain available as reviewer inputs.

- [ ] **Step 1: Run complete targeted verification**

```bash
bun test scripts/tests/build-protocol-atlas.spec.ts scripts/tests/protocol-atlas-core.spec.ts
bun run check:protocol-atlas
(
  cd apps/web
  bun run build
)
bunx eslint --no-ignore docs/protocol-atlas/atlas.js scripts/tests/build-protocol-atlas.spec.ts scripts/tests/protocol-atlas-core.spec.ts
git diff --check origin/dev...HEAD
```

Expected: all Atlas tests pass; artifact remains `60 nodes, 66 edges, 20 experiments, 61 modes`; web build publishes six Atlas files; ESLint and diff checks pass. Existing environment, CSS, chunking, or bundle-size warnings may remain but no command may fail.

- [ ] **Step 2: Audit the acceptance criteria directly**

Run:

```bash
rg -n "createElementNS|<svg|atlas-diagram-canvas|atlas-diagram-nodes|max-height: 8\.5rem|overflow-y: auto" docs/protocol-atlas/atlas.js docs/protocol-atlas/atlas.css
```

Expected: no diagram SVG/canvas/old-node-grid/fixed-card-scroll matches. Any unrelated `overflow-y: auto` elsewhere must be identified by its non-node selector and reported, not deleted.

Then run:

```bash
rg -n "atlas-flow-map|atlas-node-grid|atlas-relationship__source|atlas-relationship__kind|atlas-relationship__target" docs/protocol-atlas/atlas.js docs/protocol-atlas/atlas.css
```

Expected: the new content-first renderer and semantic relationship contract are present.

- [ ] **Step 3: Record verification evidence**

Write the exact commands, pass/fail counts, generated-artifact inventory, web publication count, warning summary, direct acceptance audit, changed files, and residual risks into the Task 3 report. Do not delete the spec or plan yet; the SDD task reviewer and final whole-branch reviewer require them.

---

## Post-review closeout

After every task review and the final whole-branch review are clean:

```bash
git rm docs/superpowers/specs/2026-08-11-protocol-atlas-readability-design.md
git rm docs/superpowers/plans/2026-08-11-protocol-atlas-readability.md
git commit -m "chore: remove atlas readability planning artifacts"
git fetch origin dev fix/protocol-atlas-railway-build
if test "$(git merge-base HEAD origin/dev)" != "$(git rev-parse origin/dev)"; then
  git rebase origin/dev
  # Re-run Task 3 Steps 1–2 after any rebase before pushing.
fi
git diff --check origin/dev...HEAD
git status --short --branch
git push --force-with-lease origin fix/protocol-atlas-railway-build
git fetch origin fix/protocol-atlas-railway-build
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/fix/protocol-atlas-railway-build)"
```

Expected: planning artifacts are absent from the PR diff, local and remote branch heads match, the branch is based on current `origin/dev`, and GitHub checks start for the updated PR. Merge still requires a new explicit authorization after all gates are green.
