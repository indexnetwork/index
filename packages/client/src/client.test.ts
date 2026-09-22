import { afterEach, expect, test } from "bun:test";

import { ApiError, IndexClient, wakesHost, type ConnectedEvent, type ConversationMessage, type UserEvent } from "./client.ts";

const savedKey = process.env.INDEX_API_KEY;
const savedUrl = process.env.INDEX_API_URL;
const savedAgentId = process.env.INDEX_AGENT_ID;

afterEach(() => {
  process.env.INDEX_API_KEY = savedKey;
  process.env.INDEX_API_URL = savedUrl;
  process.env.INDEX_AGENT_ID = savedAgentId;
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

test("sendPrincipal refuses without agentId and fences the write", async () => {
  let path = "";
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      path = new URL(req.url).pathname + new URL(req.url).search;
      return Response.json({ ok: true });
    },
  });
  const bare = new IndexClient({ baseUrl: `http://127.0.0.1:${server.port}`, apiKey: "k" });
  expect(bare.sendPrincipal("i1", [])).rejects.toThrow("INDEX_AGENT_ID is required");
  const client = new IndexClient({
    baseUrl: `http://127.0.0.1:${server.port}`, apiKey: "k", agentId: "e1",
  });
  await client.sendPrincipal("i1", []);
  expect(path).toBe("/api/conversations/agent/h2a?agentId=e1");
  server.stop(true);
});

test("discover posts the query and returns the counterparties as ranked", async () => {
  let seen: { path: string; body: unknown } | undefined;
  const counterparty = {
    intentId: "i2", userId: "u2", name: "Ada", statement: "Looking for a co-founder",
    networkId: "n1", score: 0.42,
  };
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      seen = { path: new URL(req.url).pathname, body: await req.json() };
      return Response.json({ counterparties: [counterparty] });
    },
  });
  const client = new IndexClient({ baseUrl: `http://127.0.0.1:${server.port}`, apiKey: "k" });
  expect(await client.discover("i1", "biotech founders in Lisbon")).toEqual([counterparty]);
  expect(seen).toEqual({ path: "/api/intents/i1/discover", body: { query: "biotech founders in Lisbon" } });
  server.stop(true);
});

test("createOpportunities posts the picks and returns the opportunities", async () => {
  let seen: { path: string; body: unknown } | undefined;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      seen = { path: new URL(req.url).pathname, body: await req.json() };
      return Response.json({ opportunities: [{ opportunityId: "o1" }] });
    },
  });
  const client = new IndexClient({ baseUrl: `http://127.0.0.1:${server.port}`, apiKey: "k" });
  const picks = [{ intentId: "i2", networkId: "n1" }];
  expect(await client.createOpportunities("i1", picks)).toEqual([{ opportunityId: "o1" }]);
  expect(seen).toEqual({ path: "/api/intents/i1/opportunities", body: { counterparties: picks } });
  server.stop(true);
});

test("wakesHost is true only for turn and principal.input", () => {
  const turn = { type: "negotiation.turn" as const, id: "2", title: "", body: "", data: { opportunityId: "o", intentId: "i", turnIndex: 1 } };
  const input = { type: "principal.input" as const, id: "3", title: "", body: "", data: { intentId: "i", questionId: null, text: "ok" } };
  const other = { type: "opportunity.new" as const, id: "4", title: "", body: "" };
  expect([wakesHost(turn), wakesHost(input), wakesHost(other)]).toEqual([true, true, false]);
});

test("events delivers the handshake and known types, ignores unknown types", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
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
  const got: (UserEvent | ConnectedEvent)["type"][] = [];
  const stop = new IndexClient({ baseUrl: `http://127.0.0.1:${server.port}`, apiKey: "k" })
    .events((event) => { got.push(event.type); });
  await Bun.sleep(50);
  stop();
  expect(got).toEqual(["connected", "opportunity.new"]);
  server.stop(true);
});

test("reconnect announces the handshake and replays unseen user messages", async () => {
  let streams = 0;
  const historical = message("old", "user");
  const next = message("new", "user");
  const agentRow = message("agent-1", "agent");
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
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
  const got: (UserEvent | ConnectedEvent)[] = [];
  const stop = new IndexClient({ baseUrl: `http://127.0.0.1:${server.port}`, apiKey: "k" })
    .events((event) => { got.push(event); });
  await Bun.sleep(1600);
  stop();
  server.stop(true);
  const types = got.map((event) => event.type);
  expect(types.filter((type) => type === "connected").length >= 2).toBe(true);
  expect(got.some((event) => event.type === "message" && event.message.id === "old")).toBe(false);
  expect(got.some((event) => event.type === "message" && event.message.id === "agent-1")).toBe(false);
  expect(got.some((event) => event.type === "message" && event.message.id === "new")).toBe(true);
});
