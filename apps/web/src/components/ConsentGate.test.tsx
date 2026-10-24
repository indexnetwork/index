import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refetchUser = vi.fn().mockResolvedValue(undefined);
const auth: { user: unknown; refetchUser: typeof refetchUser; signOut: () => void } = {
  user: null,
  refetchUser,
  signOut: vi.fn(),
};
const post = vi.fn().mockResolvedValue({ success: true });

vi.mock("@/contexts/AuthContext", () => ({ useAuthContext: () => auth }));
vi.mock("@/lib/api", () => ({ apiClient: { post: (...args: unknown[]) => post(...args) } }));

import ConsentGate from "./ConsentGate";

const pending = { networkId: "net-1", networkTitle: "Agent Village", version: "v4" };

describe("ConsentGate", () => {
  beforeEach(() => {
    auth.user = { pendingConsents: [pending] };
    post.mockClear();
    refetchUser.mockClear();
  });

  it("requires both checkboxes and a typed signature before recording consent", async () => {
    render(<ConsentGate><p>the app</p></ConsentGate>);

    expect(screen.getByText(/STUDY00024518/)).toBeTruthy();
    expect(screen.queryByText("the app")).toBeNull();
    const submit = screen.getByRole("button", { name: "I agree" });
    expect(submit).toBeDisabled();

    const policy = screen.getByRole("link", { name: "Privacy Policy" });
    expect(policy).toHaveAttribute("href", "https://index.network/pages/privacy-policy");
    expect(policy).toHaveAttribute("target", "_blank");
    fireEvent.click(screen.getByRole("checkbox", { name: /Index Network/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Signature" }), { target: { value: "Ada Lovelace" } });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "I agree and wish to participate." }));
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    expect(post).toHaveBeenCalledWith("/auth/consent", {
      networkId: "net-1",
      signature: "Ada Lovelace",
      privacyPolicy: true,
      participation: true,
    });
  });

  it("lets members with nothing pending through", () => {
    auth.user = { pendingConsents: [] };
    render(<ConsentGate><p>the app</p></ConsentGate>);
    expect(screen.getByText("the app")).toBeTruthy();
  });
});
