import { useCallback, useRef, useState } from "react";

import { useAuthContext } from "@/contexts/AuthContext";
import { awaitsFirstIntent, onboardingService } from "@/services/onboarding";
import { createFailureReason, intentService, type PrepareAnswer, type RecoveryField } from "@/services/intent-prepare";

export const NEW_INTENT_PROMPT = "what are you looking for right now?";
export const NEW_INTENT_EXAMPLES = [
  "traveling soon, want to meet cool people in ai",
  "building something, want honest feedback on it",
  "raising soon, want to meet investors who get it",
  "hiring soon, want to meet great people early",
  "have an idea, want someone to build it with",
];

export type NewIntentStage = "opening" | "thinking" | "recovery" | "summary" | "retry" | "creating";

/** One finished exchange in the flow: what the agent asked, what the owner said. */
export interface NewIntentTurn {
  id: string;
  prompt: string;
  answer: string;
}

/**
 * The new intent flow from /i/new, run inside the home agent chat: ask what
 * they're after, prepare it (with follow-up questions when the server wants
 * them), then create it. `onCreated` gets the new intent's id, its wording, and what the owner first wrote.
 */
export function useNewIntentFlow(onCreated: (intent: { id: string; text: string; asked: string }) => void) {
  const { user, refetchUser } = useAuthContext();
  const [active, setActive] = useState(false);
  const [stage, setStage] = useState<NewIntentStage>("opening");
  const [turns, setTurns] = useState<NewIntentTurn[]>([]);
  const [payload, setPayload] = useState("");
  const [receipt, setReceipt] = useState("");
  const [feedback, setFeedback] = useState("");
  const [fields, setFields] = useState<RecoveryField[]>([]);
  const askedRef = useRef("");

  const reset = useCallback(() => {
    setStage("opening");
    setTurns([]);
    setPayload("");
    setReceipt("");
    setFeedback("");
    setFields([]);
  }, []);

  const start = useCallback(() => { reset(); setActive(true); }, [reset]);
  const cancel = useCallback(() => { setActive(false); reset(); }, [reset]);

  const create = useCallback(async (description: string, preparationReceipt: string) => {
    if (!description.trim() || !preparationReceipt) return;
    setStage("creating");
    try {
      const created = await intentService.create(description, preparationReceipt);
      // The first intent after the profile review finishes onboarding, as on /i/new.
      if (awaitsFirstIntent(user)) {
        void onboardingService.complete(created.intentId).then(() => refetchUser()).catch(() => {});
      }
      setActive(false);
      reset();
      onCreated({ id: created.intentId, text: description, asked: askedRef.current });
    } catch (error) {
      setReceipt("");
      setFeedback(`that didn't go through. ${createFailureReason(error)}`);
      setStage("summary");
    }
  }, [user, refetchUser, onCreated, reset]);

  const prepare = useCallback(async (text: string, answers: PrepareAnswer[] = [], turn = 1) => {
    setStage("thinking");
    try {
      const result = await intentService.prepare(text, answers, turn);
      setPayload(result.payload);
      if (result.status === "ready") {
        setReceipt(result.preparationReceipt);
        await create(result.payload, result.preparationReceipt);
        return;
      }
      setReceipt("");
      setFeedback(result.feedback);
      setFields(result.recovery);
      setStage(result.recovery.length ? "recovery" : "summary");
    } catch {
      setStage("retry");
    }
  }, [create]);

  /** The owner's answer to "what are you looking for?" (typed or an example). */
  const submitOpening = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text) return;
    askedRef.current = text;
    setTurns([{ id: "intent", prompt: NEW_INTENT_PROMPT, answer: text }]);
    setPayload(text);
    void prepare(text);
  }, [prepare]);

  const submitRecovery = useCallback((answers: PrepareAnswer[]) => {
    if (answers.length) {
      setTurns((current) => [...current, { id: `answers-${current.length}`, prompt: feedback || "a few questions", answer: answers.map((a) => `${a.prompt}: ${a.answer}`).join("\n") }]);
    }
    void prepare(payload, answers, 2);
  }, [prepare, payload, feedback]);

  return {
    active, stage, turns, payload, receipt, feedback, fields,
    start, cancel, setPayload, submitOpening, submitRecovery,
    retry: () => void prepare(payload),
    recheck: () => void prepare(payload),
    create: () => void create(payload, receipt),
  };
}

export type NewIntentFlow = ReturnType<typeof useNewIntentFlow>;
