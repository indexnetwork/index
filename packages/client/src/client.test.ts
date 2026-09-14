import { afterEach, expect, test } from "bun:test";

import { ApiError, IndexClient, wakesHost, type ConversationMessage, type UserEvent } from "./client.ts";

const savedKey = process.env.INDEX_API_KEY;
const savedUrl = process.env.INDEX_API_URL;
const savedExecutor = process.env.INDEX_EXECUTOR_ID;

afterEach(() => {
  process.env.INDEX_API_KEY = savedKey;
  process.env.INDEX_API_URL = savedUrl;
  process.env.INDEX_EXECUTOR_ID = savedExecutor;
});

function sse(chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function message(id: string, role: "user" | "agent"): ConversationMessage {
  return {
    id, conversationId: "c1", senderId: role === "user" ? "u1" : "agent",
    role, parts: [{ kind: "text", text: id }], createdAt: "2026-01-01T00:00:00.000Z",
  };
}

test("construct throws without a key and every request sends x-api-key only", async () => {
  delete process.env.INDEX_API_KEY;
  delete process.env.INDEX_API_URL;
  expect(() => new IndexClient()).toThrow("INDEX_API_KEY is required");

  let seen = "";
  let auth = "";
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      seen = req.headers.get("x-api-key") ?? "";
      auth = req.headers.get("authorization") ?? "";
      expect(req.url.endsWith("/")).toBe(false);
      return Response.json({ user: { id: "u1", name: "Ada" } });
    },
  });
  const client = new IndexClient({ baseUrl: `http://127.0.0.1:${server.port}/`, apiKey: "k" });
  await client.me();
  expect([seen, auth]).toEqual(["k", ""]);
  server.stop(true);
});

test("me is memoized on the same instance", async () => {
  let hits = 0;
  const server = Bun.serve({
    port: 0,
    fetch() {
      hits += 1;
      return Response.json({
        user: {
          id: "u1",
          name: null,
          intro: "Builder",
          location: "Brooklyn",
          timezone: "Europe/Istanbul",
          onboarding: { profileConfirmedAt: "2026-08-13T16:25:06.126Z" },
        },
      });
    },
  });
  const client = new IndexClient({ baseUrl: `http://127.0.0.1:${server.port}`, apiKey: "k" });
  const expected = { id: "u1", name: null, intro: "Builder", location: "Brooklyn", timezone: "Europe/Istanbul", profileConfirmed: true };
  expect(await client.me()).toEqual(expected);
  expect(await client.me()).toEqual(expected);
  expect(hits).toBe(1);
  server.stop(true);
});

test("non-2xx is ApiError; 401 mentions minting; non-JSON 200 is not ApiError", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/api/auth/me") return Response.json({ error: "nope" }, { status: 401 });
      if (path === "/api/negotiations") return new Response("plain", { headers: { "Content-Type": "text/plain" } });
      return new Response("x", { status: 500 });
    },
  });
  const client = new IndexClient({ baseUrl: `http://127.0.0.1:${server.port}`, apiKey: "k" });
  try {
    await client.me();
    throw new Error("expected");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).error).toBe("nope");
    expect((error as ApiError).message).toContain("Mint a new credential");
  }
  try {
    await client.listNegotiations();
    throw new Error("expected");
  } catch (error) {
    expect(error instanceof ApiError).toBe(false);
  }
  server.stop(true);
});

test("sendPrincipal refuses without executorId and fences the write", async () => {
  let path = "";
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      path = new URL(req.url).pathname + new URL(req.url).search;
      return Response.json({ ok: true });
    },
  });
  const bare = new IndexClient({ baseUrl: `http://127.0.0.1:${server.port}`, apiKey: "k" });
  expect(bare.sendPrincipal("i1", [])).rejects.toThrow("INDEX_EXECUTOR_ID is required");
  const client = new IndexClient({
    baseUrl: `http://127.0.0.1:${server.port}`, apiKey: "k", executorId: "e1",
  });
  await client.sendPrincipal("i1", []);
  expect(path).toBe("/api/conversations/agent/h2a?executorId=e1");
  server.stop(true);
});

test("wakesHost is true only for opened, turn, and principal.input", () => {
  const opened = { type: "negotiation.opened" as const, id: "1", title: "", body: "", data: { intentId: "i", count: 1 } };
  const turn = { type: "negotiation.turn" as const, id: "2", title: "", body: "", data: { opportunityId: "o", intentId: "i", turnIndex: 1 } };
  const input = { type: "principal.input" as const, id: "3", title: "", body: "", data: { intentId: "i", questionId: null, text: "ok" } };
  const other = { type: "opportunity.new" as const, id: "4", title: "", body: "" };
  expect([wakesHost(opened), wakesHost(turn), wakesHost(input), wakesHost(other)]).toEqual([true, true, true, false]);
});

test("events delivers known types, ignores handshake and unknown types", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/api/negotiations") return Response.json({ negotiations: [] });
      if (path === "/api/conversations/agent/messages") return Response.json({ conversationId: "c1", messages: [] });
      return sse([
        `data: ${JSON.stringify({ type: "connected" })}\n\n`,
        `: keepalive\n\n`,
        `data: ${JSON.stringify({ type: "opportunity.new", id: "n1", title: "t", body: "b" })}\n\n`,
        `data: ${JSON.stringify({ type: "nope" })}\n\n`,
        `data: not-json\n\n`,
      ]);
    },
  });
  const got: UserEvent["type"][] = [];
  const stop = new IndexClient({ baseUrl: `http://127.0.0.1:${server.port}`, apiKey: "k" })
    .events((event) => { got.push(event.type); });
  await Bun.sleep(50);
  stop();
  expect(got).toEqual(["opportunity.new"]);
  server.stop(true);
});

test("reconnect catch-up lists open seats and replays unseen user messages", async () => {
  let streams = 0;
  let listHits = 0;
  const historical = message("old", "user");
  const next = message("new", "user");
  const agentRow = message("agent-1", "agent");
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/api/negotiations") {
        listHits += 1;
        return Response.json({ negotiations: [{ intentId: "i1" }] });
      }
      if (path === "/api/conversations/agent/messages") {
        return Response.json({
          conversationId: "c1",
          messages: streams <= 1 ? [historical, agentRow] : [historical, agentRow, next],
        });
      }
      streams += 1;
      if (streams === 1) {
        return sse([`data: ${JSON.stringify({ type: "connected" })}\n\n`]);
      }
      return sse([`data: ${JSON.stringify({ type: "connected" })}\n\n`]);
    },
  });
  const got: UserEvent[] = [];
  const stop = new IndexClient({ baseUrl: `http://127.0.0.1:${server.port}`, apiKey: "k" })
    .events((event) => { got.push(event); });
  await Bun.sleep(1600);
  stop();
  server.stop(true);
  const types = got.map((event) => event.type);
  expect(listHits >= 2).toBe(true);
  expect(types.includes("negotiation.opened")).toBe(true);
  expect(got.some((event) => event.type === "message" && event.message.id === "old")).toBe(false);
  expect(got.some((event) => event.type === "message" && event.message.id === "agent-1")).toBe(false);
  expect(got.some((event) => event.type === "message" && event.message.id === "new")).toBe(true);
});
