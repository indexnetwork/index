/**
 * Test-only persona: the full chat toolset with loop behaviors on.
 *
 * The chat runtime has no default persona, but several suites exercise
 * persona-neutral loop machinery (hallucination recovery, debugMeta
 * accumulation, graph streaming) and need *some* persona to inject. This is
 * the neutral one — the unfiltered toolset, a trivial prompt, recovery on —
 * so those suites test the loop rather than any product persona's prompt.
 *
 * `createTools` delegates lazily through the import binding (an arrow wrapper
 * rather than a captured reference) so suites can still swap tool.factory via
 * `mock.module`; a snapshot in the object literal would pin whichever version
 * loaded first.
 */
import { createChatTools } from "../../shared/agent/tool.factory.js";
import type { ChatPersonaConfig } from "../chat.persona.js";

export const FULL_TOOLSET_TEST_PERSONA: ChatPersonaConfig = {
  id: "test-full-toolset",
  buildSystemContent: () => "You are a test agent.",
  createTools: (deps, preResolvedContext) => createChatTools(deps, preResolvedContext),
  loopBehaviors: {
    hallucinationRecovery: true,
  },
};
