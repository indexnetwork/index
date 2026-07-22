import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({ token: mocks.token }),
}));
vi.mock("better-auth/client/plugins", () => ({
  magicLinkClient: () => ({}),
  jwtClient: () => ({}),
}));

import { apiClient } from "@/lib/api";
import { AuthSessionError, clearJwtToken } from "@/lib/auth-client";

describe("authenticated stream token acquisition", () => {
  beforeEach(() => {
    clearJwtToken();
    mocks.token.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("rejects an invalid session without sending the chat request", async () => {
    mocks.token.mockResolvedValue({
      data: null,
      error: { message: "invalid session" },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(apiClient.stream("/chat/web/stream", { message: "kickoff" }))
      .rejects.toBeInstanceOf(AuthSessionError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("sends a valid-session stream with the acquired bearer token", async () => {
    const token = `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
    mocks.token.mockResolvedValue({ data: { token }, error: null });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await expect(apiClient.stream("/chat/web/stream", { message: "kickoff" })).resolves.toBeInstanceOf(Response);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/chat/web/stream"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
      }),
    );
  });

  test("times out stalled token acquisition instead of leaving the send pending", async () => {
    vi.useFakeTimers();
    mocks.token.mockReturnValue(new Promise(() => undefined));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const request = apiClient.stream("/chat/web/stream", { message: "kickoff" });
    const rejection = expect(request).rejects.toBeInstanceOf(AuthSessionError);
    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
