---
name: code-flow-artifact
description: Explain how a real code path actually works — as a published Artifact with hand-drawn SVG diagrams, traced from the source rather than from memory. Use this whenever someone asks you to explain, walk through, draw, diagram, map, or visualize a flow, pipeline, lifecycle, request path, state machine, or "how X works" in a codebase, and also when they ask what a system costs (model calls, network hops, queries) or how to simplify or speed one up. Reach for it even when they only say "explain how intents are created", "use flow", "draw it", "map the auth path", "where does this data go", or "how can we make this faster" — the deliverable is the same, and a flow that lives only in terminal scrollback is a flow the reader has to re-derive tomorrow.
---

# Code flow, drawn

The deliverable is a page a colleague can read cold and come away knowing how the
thing works — including the part they could not have gotten by reading the files
themselves. Two halves, and both have to be real: the tracing has to be honest,
and the drawing has to show mechanism rather than vocabulary.

## 1. Trace before you write a word

Never describe a flow from memory or from names. Names lie — a function called
`prepNode` turned out to fetch data only one later stage uses, and a "clarifier"
turned out to be two model calls, not one. Both facts changed the conclusion.

Work outward from the entry points:

- Grep for the user-facing surface first: the tool name, the route, the CLI verb,
  the button's handler. `grep -rn "create_intent\|/intents/confirm"` finds doors.
- Read the graph/router wiring next if there is one. It hands you the node list
  and the conditional edges — that is the flow's skeleton for free.
- Then read each node. Read the **prompts and schemas**, not just the code around
  them. In model-backed systems the semantics live in the prompt: which speech
  acts get dropped, what the model is forbidden to invent, what a null means.
- Follow what gets enqueued. Background work after the main write is part of the
  flow, and it is the part people forget they own.
- Check what actually runs, not what the file defaults to. Config defaults are
  often the dead branch; look for the env/flag resolver and say which value is live.

Cite `file.ts:123` for every non-obvious claim. It makes the page auditable, and
it is what turns "a doc" into "a reference".

## 2. Find the shape

Most real flows are not a line. Before drawing, name the shape out loud:

- **Doors → spine → tail** is the most common: several entry points converge on a
  shared core, and a queue picks up afterward.
- **Fork at a gate**: one decision point with two or three genuinely different
  exits, each of which deserves its own path.
- **Loop until settled**: a retry, a reconciliation, a budget being spent down.

Getting the shape right is most of the work. Once you have it, the diagrams
almost lay themselves out, and the prose has a spine to hang on.

## 3. Mark what the reader asked to see

Whatever the question is really about gets a visible encoding that repeats on
every diagram: model calls, network hops, writes, lock acquisitions, queue
boundaries. Pick one encoding and hold it — a colored border plus a small literal
tag (`LLM`, `SQL`, `~40ms`) beats a legend nobody scrolls back to.

If nobody named a dimension, the reader almost always wants **cost and blocking**:
what is expensive, and what makes them wait.

## 4. Structure as acts, not one mega-diagram

One figure, one claim. Three or four modest figures read better than one that
needs a magnifying glass, and each caption gets to say something specific.

A structure that keeps working:

1. **Act one — the entry paths and where they converge.** The shape.
2. **Act two — the branch that matters.** The gate, its exits, and where they
   rejoin. This is usually the interesting figure.
3. **Act three — the tail.** What the queue does after the user is gone.
4. **An inventory table** of every marked step: what, which module, fires when.
5. **The punchline** (below).

## 5. Earn the page with a punchline

A flow doc that only restates the call graph is a worse version of the code. Every
trace turns up at least one thing the reader could not have assembled themselves —
find it and say it plainly, usually at the end:

- an invariant nobody wrote down ("verification never repairs, it only rejects —
  every clarifying question in the product is a caller translating one rejection")
- work being done twice
- a value being computed from an input that is empty on one of the paths
- a cost that scales with something nobody is watching

If tracing turns up a real bug, say so in a footnote and keep it separate from the
main claim, so the explanation stays an explanation.

## 6. Draw it

Load `artifact-diagramming` for the SVG mechanics and `artifact-design` for the
visual treatment — this skill does not restate them. What it adds:

- **Label every arrow.** `writes`, `0 verified`, `enqueue`, `re-invoke in create
  mode`. An unlabeled arrow means "related somehow", which the prose already said.
- **Orthogonal routing.** Vertical drops and horizontal runs on a shared grid.
  Diagonals through a dense diagram read as noise.
- **Lay out on a real grid** before writing coordinates. Pick column x-centers and
  a row pitch, write them down, then place boxes. Eyeballed offsets are visible.
- **`min-width` on the SVG inside an `overflow-x: auto` wrapper.** Scaling a
  1180-wide diagram into a phone makes 11px labels unreadable; let it scroll.
- Keep a node's label short and put the qualifier in a mono sub-line beneath it.

`references/scaffold.md` has the structural pieces worth reusing — theme tokens
for all three theme states, the SVG class taxonomy, arrow markers. Treat it as
mechanics, not as a look: choose the palette and typefaces for each subject.

## When the ask is "make it faster" or "simplify it"

Same tracing, different output: a **ledger**, not a tour. Read the flow doc's own
advice first — you cannot cut what you have not traced.

- Count in **serial depth** and **total calls**, not invented milliseconds. Serial
  depth is what sets the tail; call count is what sets the bill. Say which is which.
- Draw the difference. Before and after in paired columns, with the removed steps
  struck through *in place* in the before column so the delta is pointable. A list
  of two separate diagrams is not a comparison.
- **Cost every cut honestly.** A cut that loses nothing and a cut that trades
  accuracy for a call are different recommendations, and saying so is what makes
  the page trustworthy. Rank by saving ÷ risk, and mark which ones you would ship
  on assertion versus behind an eval.
- Look hardest for **work done twice** — a result computed, discarded, and
  recomputed — and for **per-item calls that should be one batched call**. Those
  are usually the two biggest wins and the two cheapest to defend.
- Give a ship order. Contained, zero-loss diffs first.

## Companion pages

When a second artifact joins a first (the flow, then the proposal), keep the same
typefaces, tokens, and semantic encoding, and change only what the new subject
demands. They should read as two deliverables from one studio, not two templates.
Reuse the meaning of a color rather than inventing a second vocabulary: if ochre
meant "model call" on page one, it still does on page two.

Publish each as its own artifact — a comparison the user asked for is a new page,
not an edit to the old one — and hand back both links.

## Finally

Say the conclusion in the chat too. The artifact is the reference; the message is
the answer. Three or four sentences naming the shape, the gate, and the punchline,
so someone reading only the terminal still learns the thing.
