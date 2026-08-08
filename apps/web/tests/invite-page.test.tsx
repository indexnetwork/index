import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import { DOWNLOAD_PATH } from "@/components/DeepLinkLanding";

const getIndexByShareCode = vi.fn();

vi.mock("@/services/networks", () => ({
  indexesService: {
    getIndexByShareCode: (...args: unknown[]) => getIndexByShareCode(...args),
  },
}));

vi.mock("@/lib/logger", () => ({
  log: { page: { from: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) } },
}));

describe("/l/:code invite landing", () => {
  beforeEach(() => {
    getIndexByShareCode.mockReset();
    getIndexByShareCode.mockResolvedValue({
      id: "net-1",
      title: "Test",
      permissions: { joinPolicy: "invite_only" },
      _count: { members: 2 },
    });
  });

  test("previews the network with Index + Hermes accepts and text download", async () => {
    const { default: InvitationPage } = await import("@/app/l/[code]/page");

    render(
      <MemoryRouter initialEntries={["/l/abc123"]}>
        <Routes>
          <Route path="/l/:code" element={<InvitationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Test" })).toBeInTheDocument();
    });

    expect(screen.getByText(/You're invited to/i)).toBeInTheDocument();
    expect(screen.getByText(/2 members/i)).toBeInTheDocument();

    const index = screen.getByRole("link", { name: /accept invite in index/i });
    expect(index).toHaveAttribute("href", "index://l/abc123");

    const hermes = screen.getByRole("link", { name: /accept invite in hermes/i });
    expect(hermes).toHaveAttribute("href", "hermes://l/abc123");

    const download = screen.getByRole("link", { name: /download it now/i });
    expect(download).toHaveAttribute("href", DOWNLOAD_PATH);
    expect(screen.getByText(/Don't have the app\?/i)).toBeInTheDocument();

    expect(
      screen.queryByRole("button", { name: /sign in|accept invitation|join/i }),
    ).not.toBeInTheDocument();
  });

  test("rejects public networks as non-invites", async () => {
    getIndexByShareCode.mockResolvedValue({
      id: "net-2",
      title: "Open Club",
      permissions: { joinPolicy: "anyone" },
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
      expect(screen.getByText(/No invitation found/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("link", { name: /accept invite in index/i }),
    ).not.toBeInTheDocument();
  });
});
