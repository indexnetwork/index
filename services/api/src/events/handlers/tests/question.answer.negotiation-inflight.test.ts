import { describe, it, expect, mock, beforeEach } from "bun:test";
import { resumeInflightNegotiationFactory, type InflightResumeDeps } from "../question.answer.negotiation-inflight";

function makeDeps(overrides?: Partial<InflightResumeDeps>): InflightResumeDeps {
  return {
    cancelAskUserExpiry: mock(async () => {}),
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
  taskId: "task-exact",
};

describe("resumeInflightNegotiationFactory", () => {
  let deps: InflightResumeDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("cancels and resumes only the exact DB-claimed task", async () => {
    const resume = resumeInflightNegotiationFactory(deps);
    await resume(input);

    expect(deps.cancelAskUserExpiry).toHaveBeenCalledWith("task-exact");
    expect(deps.enqueueResume).toHaveBeenCalledWith("opp-1", "u-1");
  });

  it("a timer-cancel failure is non-fatal after the DB task claim", async () => {
    deps = makeDeps({ cancelAskUserExpiry: mock(async () => { throw new Error("redis down"); }) });
    await resumeInflightNegotiationFactory(deps)(input);
    expect(deps.enqueueResume).toHaveBeenCalledWith("opp-1", "u-1");
  });

  it("records an optional private disclosure rule without affecting resume", async () => {
    const recordDisclosureRule = mock(async () => {});
    deps = makeDeps({ recordDisclosureRule });
    await resumeInflightNegotiationFactory(deps)(input);
    expect(recordDisclosureRule).toHaveBeenCalledWith(input);
    expect(deps.enqueueResume).toHaveBeenCalledTimes(1);
  });

  it("a rejecting disclosure-rule hook never affects continuation", async () => {
    deps = makeDeps({ recordDisclosureRule: mock(async () => { throw new Error("memory write failed"); }) });
    await resumeInflightNegotiationFactory(deps)(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.enqueueResume).toHaveBeenCalledTimes(1);
  });
});
