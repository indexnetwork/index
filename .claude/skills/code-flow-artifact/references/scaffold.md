# Structural scaffold

The mechanically-correct parts of a flow page — the ones that are the same
whatever the subject looks like. **Palette values and typefaces below are
placeholders**; re-choose them per subject, as `artifact-design` requires. What is
worth reusing verbatim is the token structure, the SVG class taxonomy, and the
overflow behavior.

## Contents

- [Theme tokens](#theme-tokens) — the three-state pattern
- [SVG class taxonomy](#svg-class-taxonomy)
- [Arrow markers](#arrow-markers)
- [Node geometry](#node-geometry)
- [Grid planning](#grid-planning)
- [Before/after columns](#beforeafter-columns)

## Theme tokens

Three states, not two: explicit dark, explicit light, and the unstamped default
where only `prefers-color-scheme` separates them. Define the full palette on bare
`:root`, then redefine *only the tokens* twice.

```css
:root {
  --paper: …; --panel: …; --frame: …;         /* grounds */
  --ink: …; --ink-2: …; --ink-3: …;           /* text, descending emphasis */
  --rule: …; --rule-soft: …; --rule-hard: …;  /* hairlines; -hard draws arrows */
  --accent: …;                                 /* the marked dimension */
  --alert: …;                                  /* the failure/removal path */
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* redefine the same names */ }
}
:root[data-theme="dark"] { /* redefine again so the toggle wins */ }
```

`body` must set `background: var(--paper)` explicitly — the viewer paints its own
ground behind the page, so a transparent body borrows the host's theme.

Three ink levels is the useful number: node labels, prose, and mono sub-lines.
`--rule-hard` exists because arrows need more contrast than box borders do.

## SVG class taxonomy

Style inline SVG from the page stylesheet — no `<style>` inside the `<svg>`.

```css
.dg { display: block; width: 100%; min-width: 940px; height: auto; }

.dg .box    { fill: var(--panel); stroke: var(--rule-hard); stroke-width: 1; }
.dg .llm    { stroke: var(--accent); stroke-width: 1.5; }   /* the marked step */
.dg .opt    { stroke-dasharray: 5 4; }                       /* may not fire */
.dg .term   { fill: var(--frame); stroke: var(--ink); stroke-width: 1.5; }
.dg .frame  { fill: var(--frame); stroke: var(--rule-hard); stroke-dasharray: 6 5; }

.dg .lbl    { fill: var(--ink);   font: 500 13px "…Sans", sans-serif; }
.dg .sub    { fill: var(--ink-3); font: 400 10.5px "…Mono", monospace; }
.dg .tag    { fill: var(--accent);font: 500 9.5px "…Mono", monospace; letter-spacing: .14em; }
.dg .el     { fill: var(--ink-2); font: 400 11px "…Mono", monospace; }  /* arrow label */
.dg .grp    { fill: var(--ink-3); font: 500 10.5px "…Mono", monospace; letter-spacing: .16em; }

.dg .e      { fill: none; stroke: var(--rule-hard); stroke-width: 1.25; }
.dg .ah     { fill: var(--rule-hard); }                       /* arrowhead */
.dg .divide { stroke: var(--rule); stroke-dasharray: 3 5; }   /* column divider */
```

Type group labels in uppercase literally rather than relying on `text-transform`.

## Arrow markers

Marker ids are document-global, so give each figure its own (`f1a`, `f2a`) rather
than sharing one across several `<svg>` elements.

```html
<defs>
  <marker id="f1a" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path class="ah" d="M0 0 L10 5 L0 10 Z"></path>
  </marker>
</defs>
```

`orient="auto-start-reverse"` keeps the head correct on leftward and upward runs.

## Node geometry

For a box at `(X, Y)` of width `W`, height `42–50`:

| part | position |
|---|---|
| label | `x = X + 16`, `y = Y + 19` |
| mono sub-line | `x = X + 16`, `y = Y + 34` |
| tag (`LLM`, `SQL`) | `x = X + W − 12`, `y = Y + 17`, `text-anchor="end"` |
| single centered label (no sub) | `x = X + W/2`, `y = Y + 25`, `text-anchor="middle"` |
| cut/step badge | `cx = X − 16`, circle `r = 9`, text `y = cy + 3.5` |

`rx="4"`. Vertical pitch of 60 gives a 42-high box an 18px gap — enough for an
arrow, tight enough to read as one stack.

## Grid planning

Write the grid down before any coordinates:

```
viewBox   0 0 1180 H          # 1180 fits three 300-wide columns plus gutters
columns   left 40..340   centre 420..760   right 840..1140
centres   190             590               990
pitch     60 (box 42 + gap 18)
```

Then every path is `M <centre> <boxBottom> V <nextBoxTop>`, and merges are
`M <c> <y> V <yRun> H <c2> V <target>`. Fan-outs from one point to several
columns share the `yRun`, which is what makes them read as one fork.

## Before/after columns

Split the viewBox down the middle with a dashed `.divide` line and mirror the
geometry (`+580` on every x for a 1180-wide figure). The removed steps stay
**in place** in the before column, struck through:

```css
.dg .gone    { stroke: var(--ink-3); stroke-width: 1; stroke-dasharray: 4 4; fill: var(--frame); }
.dg .gone-t  { fill: var(--ink-3); font: 400 13px "…Sans", sans-serif; }
.dg .strike  { stroke: var(--alert); stroke-width: 1.5; }
```

with `<line class="strike" x1="X+8" y1="Y+21" x2="X+W-8" y2="Y+21">` across the
box. Put the removal rules **last** in the stylesheet so they win over `.box`
and `.llm`.

Close each column with a tally line in mono at a shared baseline — the two
numbers side by side are the whole argument.
