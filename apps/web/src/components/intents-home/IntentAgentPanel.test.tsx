import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import IntentAgentPanel from "./IntentAgentPanel";
import { DiscoveryTrace } from "@/components/chat/agent-chat-blocks";

const api = vi.hoisted(() => ({ getMessages: vi.fn(), sendMessage: vi.fn(), sendAnswers: vi.fn() }));
const subscribe = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock("@/contexts/APIContext", () => ({ useConversations: () => api }));
vi.mock("@/contexts/ConversationContext", () => ({ useConversation: () => ({ subscribeConversationMessage: subscribe, isConnected: true }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuthContext: () => ({ user: { id: "owner", name: "Owner" } }) }));

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  api.getMessages.mockResolvedValue({ conversationId: "agent-conversation", messages: [], agent: { status: "hosted", questions: [] } });
  api.sendMessage.mockResolvedValue({ id: "sent", role: "user", parts: [{ kind: "text", text: "Hello" }], createdAt: "2026-10-27T12:00:00Z", metadata: { intentId: "intent-1" } });
  api.sendAnswers.mockResolvedValue([]);
});

describe("original chat inside the redesigned intent panel", () => {
  it("sends with Enter, preserves Shift+Enter, and keeps the original chat renderer", async () => {
    render(<IntentAgentPanel intentId="intent-1" paused={false} onSelectMatch={vi.fn()} />);
    await screen.findByText(/ask about your matches/);
    expect(screen.getByTestId("intent-negotiator-chat")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Message your agent" });
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(api.sendMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith(expect.any(String), [{ kind: "text", text: "Hello" }], { metadata: { intentId: "intent-1" } }));
  });

  it("submits selected and custom question answers together", async () => {
    api.getMessages.mockResolvedValue({ conversationId: "agent-conversation", messages: [], agent: { status: "hosted", questions: [
      { id: "q1", question: "Which day?", options: ["Tuesday", "Wednesday"] },
      { id: "q2", question: "Which place?", options: [] },
    ] } });
    render(<IntentAgentPanel intentId="intent-1" paused={false} onSelectMatch={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tuesday" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Write your own answer" }), { target: { value: "The park" } });
    fireEvent.click(screen.getByRole("button", { name: "send 2 answers" }));
    await waitFor(() => expect(api.sendAnswers).toHaveBeenCalledWith("intent-1", [
      { questionId: "q1", text: "Tuesday" }, { questionId: "q2", text: "The park" },
    ]));
  });

  it("lets the reader collapse and reopen discovery queries", () => {
    render(<DiscoveryTrace queries={["design collaborators"]} discovered={2} reached={1} />);
    const toggle = screen.getByRole("button", { name: "Ran 1 query" });
    expect(screen.getByText("design collaborators")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("design collaborators")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText("design collaborators")).toBeInTheDocument();
  });
});
