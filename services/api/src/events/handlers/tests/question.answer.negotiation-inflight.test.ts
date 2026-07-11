import { describe, it, expect, mock, beforeEach } from "bun:test";
import { resumeInflightNegotiationFactory, type InflightResumeDeps } from "../question.answer.negotiation-inflight";

/**
 * IND-401 — negotiation_inflight answer → resume path.
 *
 * Pins:
 * - answer stored first, always (even when no paused task exists),
 * - paused (input_required) task: timer cancelled → task closed → resume
 *   enqueued, in that order,
 * - no task / non-paused task: answer stored, nothing else touched,
 * - timer-cancel failure is non-fatal (task still closed, resume still runs).
 */

function makeDeps(overrides?: Partial<InflightResumeDeps>): InflightResumeDeps {
  return {
    storeNegotiationContext: mock(async () => {}),
    getNegotiationTaskForOpportunity: mock(async () => ({ id: "task-1", state: "input_required" })),
    cancelAskUserExpiry: mock(async () => {}),
    closeTask: mock(async () => {}),
    enqueueResume: mock(async () => {}),
    ...overrides,
  };
}

const input = {
  userId: "u-1",
  opportunityId: "opp-1",
  questionId: "q-1",
  selectedOptions: ["Yes, share it"],
  freeText: "but only the range",
};

describe("resumeInflightNegotiationFactory", () => {
  let deps: InflightResumeDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("stores the answer, cancels the timer, closes the paused task, and enqueues the resume", async () => {
    const calls: string[] = [];
    deps = makeDeps({
      storeNegotiationContext: mock(async () => { calls.push("store"); }),
      cancelAskUserExpiry: mock(async () => { calls.push("cancel"); }),
      closeTask: mock(async () => { calls.push("close"); }),
      enqueueResume: mock(async () => { calls.push("resume"); }),
    });
    const resume = resumeInflightNegotiationFactory(deps);
    await resume(input);

    expect(deps.storeNegotiationContext).toHaveBeenCalledWith(input);
    expect(deps.cancelAskUserExpiry).toHaveBeenCalledWith("task-1");
    expect(deps.closeTask).toHaveBeenCalledWith("task-1", "ask_user_answered");
    expect(deps.enqueueResume).toHaveBeenCalledWith("opp-1", "u-1");
    expect(calls).toEqual(["store", "cancel", "close", "resume"]);
  });

  it("stores the answer but skips the resume when no task exists", async () => {
    deps = makeDeps({ getNegotiationTaskForOpportunity: mock(async () => null) });
    const resume = resumeInflightNegotiationFactory(deps);
    await resume(input);

    expect(deps.storeNegotiationContext).toHaveBeenCalledTimes(1);
    expect(deps.cancelAskUserExpiry).not.toHaveBeenCalled();
    expect(deps.closeTask).not.toHaveBeenCalled();
    expect(deps.enqueueResume).not.toHaveBeenCalled();
  });

  it("stores the answer but skips the resume when the task is not paused (expiry already resumed it)", async () => {
    deps = makeDeps({ getNegotiationTaskForOpportunity: mock(async () => ({ id: "task-1", state: "canceled" })) });
    const resume = resumeInflightNegotiationFactory(deps);
    await resume(input);

    expect(deps.storeNegotiationContext).toHaveBeenCalledTimes(1);
    expect(deps.closeTask).not.toHaveBeenCalled();
    expect(deps.enqueueResume).not.toHaveBeenCalled();
  });

  it("a timer-cancel failure is non-fatal: task still closed, resume still enqueued", async () => {
    deps = makeDeps({ cancelAskUserExpiry: mock(async () => { throw new Error("redis down"); }) });
    const resume = resumeInflightNegotiationFactory(deps);
    await resume(input);

    expect(deps.closeTask).toHaveBeenCalledWith("task-1", "ask_user_answered");
    expect(deps.enqueueResume).toHaveBeenCalledWith("opp-1", "u-1");
  });
});
