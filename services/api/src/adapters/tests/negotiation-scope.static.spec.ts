import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

/**
 * A negotiation's state must never be read from the whole conversation.
 *
 * Two agents share one DM permanently, so it accumulates every negotiation the
 * pair has run. Any turn count, floor check or "preceding turn" derived from
 * `conversation_id` silently mixes matches together. That is subtle to spot in
 * review — the queries look ordinary — and the failures are severe and quiet:
 * a CAS armed with a match-scoped count can never satisfy a conversation-wide
 * comparison, so parked turns strand and timeouts never fire.
 *
 * This freezes the audit. Negotiation-state reads go through
 * `selectNegotiationTurnHistoryInTransaction`; the only methods permitted to
 * select messages by conversation are the genuinely conversation-level ones
 * below. Adding a method here should be a deliberate act.
 */

const adapterSource = readFileSync(
  new URL('../conversation.database.adapter.ts', import.meta.url),
  'utf8',
);

/** Methods whose subject genuinely IS the conversation, not one negotiation. */
const CONVERSATION_SCOPED_BY_DESIGN = new Set([
  // The context read: the pair's whole shared DM, labelled per match downstream.
  'getMessagesForConversation',
  // Chat sessions are not negotiations.
  'getChatSessionDetail',
  'getChatSessionMessages',
  // The scope helper's own documented fallback for tasks with no opportunity.
  'selectNegotiationTurnHistoryInTransaction',
]);

/** Control-flow keywords that look like declarations to a source-level scan. */
const NOT_DECLARATIONS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'await']);

/** Enclosing top-level function/method name for a source offset. */
function enclosingMethod(source: string, offset: number): string | null {
  const declarations = [...source.matchAll(
    /\n(?:async function |function | {2}(?:private |public )?(?:async )?)([A-Za-z0-9_]+)\s*[(<]/g,
  )].filter((declaration) => !NOT_DECLARATIONS.has(declaration[1]));
  let name: string | null = null;
  for (const declaration of declarations) {
    if (declaration.index! < offset) name = declaration[1];
    else break;
  }
  return name;
}

describe('negotiation state is never read from the whole conversation', () => {
  it('only conversation-level methods select messages by conversationId', () => {
    const offenders = [...adapterSource.matchAll(
      /from\(schema\.messages\)\s*\n?\s*\.where\(eq\(schema\.messages\.conversationId/g,
    )]
      .map((match) => enclosingMethod(adapterSource, match.index!))
      .filter((method): method is string => method !== null)
      .filter((method) => !CONVERSATION_SCOPED_BY_DESIGN.has(method));

    expect(offenders).toEqual([]);
  });

  it('every turn-count CAS resolves its history through the scoped helper', () => {
    // Each method comparing against an armed turn count must derive that count
    // the same way the arming side did — via the helper, never a raw select.
    const casMethods = new Set(
      [...adapterSource.matchAll(/input\.(?:turnNumber|expectedTurnCount)/g)]
        .map((match) => enclosingMethod(adapterSource, match.index!))
        .filter((method): method is string => method !== null),
    );

    const helperUsers = new Set(
      [...adapterSource.matchAll(/selectNegotiationTurnHistoryInTransaction\(tx/g)]
        .map((match) => enclosingMethod(adapterSource, match.index!))
        .filter((method): method is string => method !== null),
    );

    expect(casMethods.size).toBeGreaterThan(0);
    const unscoped = [...casMethods].filter((method) => !helperUsers.has(method));
    expect(unscoped).toEqual([]);
  });
});
