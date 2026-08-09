import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import { DOWNLOAD_PATH } from "@/components/DeepLinkLanding";

const getPublicIndexById = vi.fn();

vi.mock("@/services/networks", () => ({
  indexesService: {
    getPublicIndexById: (...args: unknown[]) => getPublicIndexById(...args),
  },
}));

vi.mock("@/lib/logger", () => ({
  log: { page: { from: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) } },
}));

describe("/index/:id public join landing", () => {
  beforeEach(() => {
    getPublicIndexById.mockReset();
    getPublicIndexById.mockResolvedValue({
      id: "net-1",
      title: "Open Lab",
      permissions: { joinPolicy: "anyone" },
      _count: { members: 4 },
    });
  });

  test("previews the network with Index + Hermes joins and text download", async () => {
    const { default: PublicJoinPage } = await import("@/app/index/[indexId]/page");

    render(
      <MemoryRouter initialEntries={["/index/net-1"]}>
        <Routes>
          <Route path="/index/:indexId" element={<PublicJoinPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Open Lab" })).toBeInTheDocument();
    });

    expect(screen.getByText(/^Join$/)).toBeInTheDocument();
    expect(screen.getByText(/4 members/i)).toBeInTheDocument();

    const index = screen.getByRole("link", { name: /join in index/i });
    expect(index).toHaveAttribute("href", "index://index/net-1");

    const hermes = screen.getByRole("link", { name: /join in hermes/i });
    expect(hermes).toHaveAttribute("href", "hermes://index/net-1");

    const download = screen.getByRole("link", { name: /download it now/i });
    expect(download).toHaveAttribute("href", DOWNLOAD_PATH);

    expect(
      screen.queryByRole("button", { name: /sign in|join$/i }),
    ).not.toBeInTheDocument();
  });

  test("rejects private networks", async () => {
    getPublicIndexById.mockResolvedValue({
      id: "net-2",
      title: "Private Club",
      permissions: { joinPolicy: "invite_only" },
    });

    const { default: PublicJoinPage } = await import("@/app/index/[indexId]/page");

    render(
      <MemoryRouter initialEntries={["/index/net-2"]}>
        <Routes>
          <Route path="/index/:indexId" element={<PublicJoinPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/need an invitation/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("link", { name: /join in index/i }),
    ).not.toBeInTheDocument();
  });
});
