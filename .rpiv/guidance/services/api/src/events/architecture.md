# Backend Events

## Responsibility
In-process lifecycle hook layer. Events decouple post-persistence producers from downstream queues/services without introducing a broker abstraction.

## Dependencies
- **TypeScript object hooks**: mutable callback registries with no-op/null defaults.
- **Injected handler factories**: question-answer reactions depend on supplied functions, not direct DB/queue imports.

## Consumers
- **`main.ts`**: assigns hook implementations.
- **Services/adapters/queues**: emit lifecycle events after state changes.

## Module Structure
```
events/
├── *.event.ts                  # one exported hook object per domain lifecycle
├── handlers/                   # event reaction dispatchers/factories
├── tests/                      # event contract specs
└── handlers/tests/             # handler/factory tests
```

## Mutable Hook Contract
```ts
export const IntentEvents = {
  onCreated: (_: { intentId: string; userId: string }) => {},
  onUpdated: (_: { intentId: string; userId: string }) => {},
  onArchived: (_: { intentId: string; userId: string }) => {},
};

// main.ts wires side effects once.
IntentEvents.onCreated = ({ intentId, userId }) => {
  void intentQueue.addGenerateHydeJob({ intentId, userId });
};
```

## Injected Reaction Handler
```ts
export interface AnswerDeps {
  createPremiseFromAnswer(input: AnswerPayload): Promise<void>;
  enqueueIntentRefinement(input: AnswerPayload): Promise<void>;
}

export async function handleQuestionAnswered(payload: AnswerPayload, deps: AnswerDeps) {
  try {
    if (payload.mode === 'profile') await deps.createPremiseFromAnswer(payload);
    if (payload.mode === 'intent') await deps.enqueueIntentRefinement(payload);
  } catch (error) {
    log.warn('question answer reaction failed', { error });
  }
}
```

## Boundary Rules
- Events are process-local hooks, not durable queues.
- Emit after persistence succeeds.
- Handler modules should use dependency interfaces/factories rather than importing adapters or queues directly.

<important if="you are adding a lifecycle event">
1. Add `<domain>.event.ts` with a no-op hook object or nullable hook if absence is meaningful.
2. Emit from the producer after the DB state change.
3. Wire side effects in `main.ts`.
4. Add tests for default no-op behavior and wired behavior.
</important>
