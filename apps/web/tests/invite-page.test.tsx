import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import { DOWNLOAD_PATH } from "@/components/DeepLinkLanding";

const getIndexByShareCode = vi.fn();
const acceptInvitation = vi.fn();
const navigate = vi.fn();

vi.mock("@/services/networks", () => ({
  indexesService: {
    getIndexByShareCode: (...args: unknown[]) => getIndexByShareCode(...args),
  },
  useNetworkService: () => ({
    acceptInvitation: (...args: unknown[]) => acceptInvitation(...args),
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuthContext: () => ({
    isAuthenticated: mockIsAuthenticated,
    isReady: mockIsReady,
  }),
}));

vi.mock("@/lib/logger", () => ({
  log: { page: { from: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) } },
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock("@/components/AuthForm", () => ({
  default: ({ onAuthenticated }: { onAuthenticated?: () => void }) => (
    <button type="button" onClick={() => onAuthenticated?.()}>
      Sign in
    </button>
  ),
}));

let mockIsAuthenticated = false;
let mockIsReady = true;

describe("/l/:code invite landing", () => {
  beforeEach(() => {
    getIndexByShareCode.mockReset();
    acceptInvitation.mockReset();
    navigate.mockReset();
    mockIsAuthenticated = false;
    mockIsReady = true;
    getIndexByShareCode.mockResolvedValue({
      id: "net-1",
      title: "Edge City",
      permissions: { joinPolicy: "invite_only" },
      _count: { members: 2 },
    });
    acceptInvitation.mockResolvedValue({
      network: { id: "net-1", title: "Edge City" },
      membership: { id: "mem-1" },
    });
  });

  test("shows preview and login form when logged out", async () => {
    const { default: InvitationPage } = await import("@/app/l/[code]/page");

    render(
      <MemoryRouter initialEntries={["/l/abc123"]}>
        <Routes>
          <Route path="/l/:code" element={<InvitationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Edge City" })).toBeInTheDocument();
    });

    expect(screen.getByText(/You're invited to/i)).toBeInTheDocument();
    expect(screen.getByText(/2 members/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();

    expect(
      screen.queryByRole("link", { name: /join using index/i }),
    ).not.toBeInTheDocument();
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  test("accepts the invite and redirects when already authenticated", async () => {
    mockIsAuthenticated = true;
    const { default: InvitationPage } = await import("@/app/l/[code]/page");

    render(
      <MemoryRouter initialEntries={["/l/abc123"]}>
        <Routes>
          <Route path="/l/:code" element={<InvitationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(acceptInvitation).toHaveBeenCalledWith("abc123");
    });

    expect(navigate).toHaveBeenCalledWith(DOWNLOAD_PATH, { replace: true });
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  test("accepts after inline sign-in", async () => {
    const { default: InvitationPage } = await import("@/app/l/[code]/page");

    render(
      <MemoryRouter initialEntries={["/l/abc123"]}>
        <Routes>
          <Route path="/l/:code" element={<InvitationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    });

    screen.getByRole("button", { name: "Sign in" }).click();

    await waitFor(() => {
      expect(acceptInvitation).toHaveBeenCalledWith("abc123");
    });

    expect(navigate).toHaveBeenCalledWith(DOWNLOAD_PATH, { replace: true });
  });

  test("accepts public networks via share code", async () => {
    mockIsAuthenticated = true;
    getIndexByShareCode.mockResolvedValue({
      id: "net-2",
      title: "Open Club",
      permissions: { joinPolicy: "anyone" },
      _count: { members: 5 },
    });

    const { default: InvitationPage } = await import("@/app/l/[code]/page");

    render(
      <MemoryRouter initialEntries={["/l/public-code"]}>
        <Routes>
          <Route path="/l/:code" element={<InvitationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Open Club" })).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(acceptInvitation).toHaveBeenCalledWith("public-code");
    });

    expect(navigate).toHaveBeenCalledWith(DOWNLOAD_PATH, { replace: true });
  });
});
