# Refactoring patterns — named T3 moves

Catalogue for **step 5 (T3 focused refactors)** of `cleaning-up-codebases`. Use a *named*
pattern instead of ad-hoc restructuring: named moves are reviewable, reversible, and keep a
cleanup honest (less code / clearer code, not just *different* code). Examples are
TypeScript-flavored for this monorepo.

**Before any T3 move:** there must be a test (or you add one) covering the behavior, and you
re-run lint/test/build for the touched package immediately after. If the behavior is
unclear, it's a D1 "should this exist?" question first — don't refactor mystery code.

---

## 1. Extract Function — kill a god-function

Triggered by: cyclomatic ≥11, cognitive >15, or function >~50 lines doing several jobs.

```ts
// BEFORE — one function validating, persisting, and notifying (complexity 15)
async function handleOrder(o: Order) { /* 60 lines of mixed concerns */ }

// AFTER — composition of focused, individually testable steps (each <5 complexity)
async function handleOrder(o: Order) {
  assertValidOrder(o);
  const saved = await persistOrder(o);
  await notifyOrderCreated(saved);
  return saved;
}
```

---

## 2. Guard Clauses — flatten deep nesting

Triggered by: nesting depth ≥4, arrow-shaped code.

```ts
// BEFORE — pyramid
if (user) {
  if (user.active) {
    if (user.verified) return doThing(user);
  }
}
return null;

// AFTER — early returns
if (!user?.active || !user.verified) return null;
return doThing(user);
```

---

## 3. Lookup Table — collapse if/elif chains

Triggered by: 5+ branches selecting a value/handler by a key.

```ts
// BEFORE — branch soup (complexity 7)
if (tier === "gold" && spend > 1000) return 0.2;
if (tier === "gold") return 0.15;
if (tier === "silver") return 0.1;
return 0;

// AFTER — data, not control flow (complexity 2)
const RATES: Record<string, number> = { "gold:high": 0.2, "gold:low": 0.15, "silver": 0.1 };
const key = tier === "gold" ? (spend > 1000 ? "gold:high" : "gold:low") : tier;
return RATES[key] ?? 0;
```

For handler dispatch, map keys → functions instead of a `switch`.

---

## 4. Extract Magic Number / String — single source of truth

Triggered by: D2 repeated-literal scan, or numeric/string literals scattered as thresholds.

```ts
// BEFORE
if (sinceMs > 86_400_000) refresh();        // what is this?

// AFTER
const ONE_DAY_MS = 86_400_000;
if (sinceMs > ONE_DAY_MS) refresh();
```

Promote to a shared `const`/config object only when reused across files — a single-use
local constant is enough (don't over-centralize, that's its own smell).

---

## 5. Collapse Duplication — DRY a copy-pasted block

Triggered by: `jscpd` block >6 lines, or sonarjs duplicate findings. **Only** when the
copies are genuinely the *same* concept — incidental similarity should stay separate (false
DRY couples unrelated code).

```ts
// BEFORE — same mapping in three controllers
const dto = { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };

// AFTER — one mapper, three call sites
export const toUserDto = (row: UserRow): UserDto => ({
  id: row.id, name: row.name, createdAt: row.createdAt.toISOString(),
});
```

---

## 6. Inline Over-Abstraction — undo speculative generality (YAGNI)

Triggered by: D2 single-call-site abstraction, forwarding-only indirection.

```ts
// BEFORE — a "strategy" with exactly one implementation
interface Pricer { price(o: Order): number; }
class DefaultPricer implements Pricer { price(o: Order) { return o.qty * o.unit; } }

// AFTER — just the function
const price = (o: Order) => o.qty * o.unit;
```

A delete is the best refactor: removing the interface, the factory, and the DI wiring is
usually a net negative line count.

---

## 7. Replace Repetitive Field Ops — loop over a field list

Triggered by: 5+ near-identical statements touching different fields of one object.

```ts
// BEFORE — 8 copy-paste lines
cfg.host = subst(cfg.host); cfg.user = subst(cfg.user); /* ... */

// AFTER — data-driven
for (const f of ["host", "user", "pass", "from"] as const) {
  if (cfg[f]) cfg[f] = subst(cfg[f]);
}
```

---

## 8. Extract Type Alias — DRY repeated complex types

Triggered by: the same union/generic annotation repeated across functions/files.

```ts
// BEFORE — repeated 8×
function a(m: "use" | "only" | "refresh" | null) {}

// AFTER — named once
export type CacheMode = "use" | "only" | "refresh" | null;
function a(m: CacheMode) {}
```

In this repo prefer **Drizzle-inferred types** over hand-written ones where a table backs
the shape (`type Row = typeof table.$inferSelect`).

---

## 9. Break Import Cycle — T4 boundary (escalate)

Triggered by: `madge --circular` output. Cycles are structural; do not "quick fix" them.
Standard moves: extract the shared type/interface into a leaf module both sides import,
invert a dependency via an injected interface (the protocol pattern), or split the file that
sits in two layers. This crosses into T4 — confirm direction with the owner and respect
`eslint-plugin-boundaries`.

---

## When NOT to apply a pattern
- The code is **dead** → delete it (D1), don't refactor it.
- The abstraction would be **new** → cleanup removes indirection, it doesn't add it.
- Behavior is unclear and **untested** → write the characterization test first, or escalate.
- The change spans schema/layers → that's **T4**, not T3; follow `release-prod-safety`.
