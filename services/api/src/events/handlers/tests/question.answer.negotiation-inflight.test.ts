import { describe, it, expect, mock, beforeEach } from "bun:test";
import { resumeInflightNegotiationFactory, type InflightResumeDeps } from "../question.answer.negotiation-inflight";

function makeDeps(overrides?: Partial<InflightResumeDeps>): InflightResumeDeps {
  return {
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
  settlementId: 'negotiation-question-settlement-v1-task-exact',
  recipientIntentId: 'intent-1',
  networkId: 'network-1',
};

describe("resumeInflightNegotiationFactory", () => {
  let deps: InflightResumeDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("enqueues only the exact DB-claimed settlement and leaves recovery armed", async () => {
    const resume = resumeInflightNegotiationFactory(deps);
    await resume(input);

    expect(deps.enqueueResume).toHaveBeenCalledWith({
      opportunityId: 'opp-1',
      userId: 'u-1',
      taskId: 'task-exact',
      settlementId: 'negotiation-question-settlement-v1-task-exact',
      recipientIntentId: 'intent-1',
      networkId: 'network-1',
    });
  });

  it("surfaces a first enqueue failure so answer retry can reconcile", async () => {
    deps = makeDeps({ enqueueResume: mock(async () => { throw new Error("redis down"); }) });
    await expect(resumeInflightNegotiationFactory(deps)(input)).rejects.toThrow('redis down');
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
