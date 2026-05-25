import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";

import {
  profileCard,
  sessionTable,
  intentTable,
  intentCard,
  opportunityTable,
  opportunityCard,
  networkTable,
  networkCard,
  memberTable,
  conversationTable,
  conversationCard,
  messageList,
} from "../src/output/formatters";
import { stripAnsi } from "../src/output/base";
import type { Intent, Opportunity, Conversation, ConversationMessage } from "../src/types";

// ── Helpers ─────────────────────────────────────────────────────────

function captureLogs(fn: () => void): string {
  const chunks: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    chunks.push(args.map(String).join(" "));
  });
  const writeSpy = spyOn(process.stdout, "write").mockImplementation((data: string | Uint8Array) => {
    chunks.push(typeof data === "string" ? data : new TextDecoder().decode(data));
    return true;
  });
  try {
    fn();
  } finally {
    logSpy.mockRestore();
    writeSpy.mockRestore();
  }
  return stripAnsi(chunks.join("\n"));
}

// ── profileCard ─────────────────────────────────────────────────────

describe("profileCard", () => {
  it("renders profile with name and intro", () => {
    const output = captureLogs(() => {
      profileCard({
        id: "u1",
        name: "Alice",
        intro: "Builder of things",
        avatar: null,
        location: "San Francisco",
        socials: { twitter: "@alice" },
        isGhost: false,
        createdAt: "2025-06-15T00:00:00Z",
        updatedAt: null,
      });
    });
    expect(output).toContain("Alice");
    expect(output).toContain("Builder of things");
    expect(output).toContain("San Francisco");
    expect(output).toContain("twitter: @alice");
    expect(output).toContain("Member since");
  });

  it("renders ghost badge", () => {
    const output = captureLogs(() => {
      profileCard({
        id: "u2",
        name: null,
        intro: null,
        avatar: null,
        location: null,
        socials: null,
        isGhost: true,
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: null,
      });
    });
    expect(output).toContain("(unnamed)");
    expect(output).toContain("[ghost]");
  });
});

// ── sessionTable ────────────────────────────────────────────────────

describe("sessionTable", () => {
  it("renders sessions with headers", () => {
    const output = captureLogs(() => {
      sessionTable([
        { id: "s1", title: "First chat", createdAt: "2026-01-01T00:00:00Z" },
        { id: "s2", title: null, createdAt: "2026-01-02T00:00:00Z" },
      ]);
    });
    expect(output).toContain("ID");
    expect(output).toContain("Title");
    expect(output).toContain("First chat");
    expect(output).toContain("(untitled)");
  });

  it("prints empty message for no sessions", () => {
    const output = captureLogs(() => {
      sessionTable([]);
    });
    expect(output).toContain("No chat sessions found");
  });
});

// ── intentTable ─────────────────────────────────────────────────────

describe("intentTable", () => {
  const intents: Intent[] = [
    {
      id: "i1",
      payload: "Find a cofounder",
      summary: "Cofounder search",
      status: "ACTIVE",
      sourceType: "link",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    } as Intent,
  ];

  it("renders intent rows", () => {
    const output = captureLogs(() => {
      intentTable(intents);
    });
    expect(output).toContain("Signal");
    expect(output).toContain("Cofounder search");
    expect(output).toContain("ACTIVE");
  });

  it("prints empty message for no intents", () => {
    const output = captureLogs(() => {
      intentTable([]);
    });
    expect(output).toContain("No signals found");
  });
});

// ── intentCard ──────────────────────────────────────────────────────

describe("intentCard", () => {
  it("renders full intent details", () => {
    const output = captureLogs(() => {
      intentCard({
        id: "i1",
        payload: "I want to find a technical cofounder",
        summary: "Cofounder search",
        status: "ACTIVE",
        sourceType: "link",
        speechActType: "desire",
        intentMode: "seeking",
        confidence: 85,
        semanticEntropy: 0.42,
        isIncognito: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        archivedAt: null,
        indexes: [{ title: "Startup Network", relevancyScore: 0.92 }],
      } as Intent);
    });
    expect(output).toContain("Signal Details");
    expect(output).toContain("i1");
    expect(output).toContain("ACTIVE");
    expect(output).toContain("Cofounder search");
    expect(output).toContain("desire");
    expect(output).toContain("seeking");
    expect(output).toContain("85%");
    expect(output).toContain("0.42");
    expect(output).toContain("Incognito");
    expect(output).toContain("Startup Network");
    expect(output).toContain("0.92");
  });

  it("normalizes 0-1 confidence values to percentages", () => {
    const output = captureLogs(() => {
      intentCard({
        id: "i2",
        payload: "Find design partners",
        summary: "Partner search",
        status: "ACTIVE",
        confidence: 0.72,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        archivedAt: null,
      } as Intent);
    });

    expect(output).toContain("72%");
    expect(output).not.toContain("1%");
  });
});

// ── opportunityTable ────────────────────────────────────────────────

describe("opportunityTable", () => {
  it("renders opportunity rows", () => {
    const output = captureLogs(() => {
      opportunityTable([
        {
          id: "o1",
          status: "pending",
          counterpartName: "Bob",
          interpretation: { category: "collaboration", confidence: 80, reasoning: "" },
          createdAt: "2026-01-01T00:00:00Z",
        } as Opportunity,
      ]);
    });
    expect(output).toContain("Counterparty");
    expect(output).toContain("Bob");
    expect(output).toContain("pending");
    expect(output).toContain("80%");
  });

  it("displays confidence correctly for 0-1 scale values", () => {
    const output = captureLogs(() => {
      opportunityTable([
        {
          id: "o2",
          status: "pending",
          counterpartName: "Alice",
          interpretation: { category: "networking", confidence: 0.72, reasoning: "" },
          createdAt: "2026-01-01T00:00:00Z",
        } as Opportunity,
      ]);
    });
    expect(output).toContain("72%");
    expect(output).not.toContain("0.72%");
  });

  it("extracts counterpart name from actors when counterpartName is missing", () => {
    const output = captureLogs(() => {
      opportunityTable([
        {
          id: "o3",
          status: "pending",
          actors: [
            { userId: "u1", name: "Alice", role: "agent" },
            { userId: "u2", name: "Bob", role: "patient" },
          ],
          interpretation: { category: "collaboration", confidence: 0.9, reasoning: "" },
          createdAt: "2026-01-01T00:00:00Z",
        } as Opportunity,
      ]);
    });
    // Without counterpartName, should not show "Unknown" if actors have names
    expect(output).not.toContain("Unknown");
  });

  it("prints empty message for no opportunities", () => {
    const output = captureLogs(() => {
      opportunityTable([]);
    });
    expect(output).toContain("No opportunities found");
  });
});

// ── opportunityCard ─────────────────────────────────────────────────

describe("opportunityCard", () => {
  it("renders full opportunity card", () => {
    const output = captureLogs(() => {
      opportunityCard({
        id: "o1",
        status: "pending",
        counterpartName: "Bob",
        interpretation: {
          category: "collaboration",
          confidence: 90,
          reasoning: "Both are looking for cofounders",
        },
        presentation: "You and Bob should connect!",
        actors: [
          { userId: "u1", name: "Alice", role: "agent" },
          { userId: "u2", name: "Bob", role: "patient" },
        ],
        createdAt: "2026-01-01T00:00:00Z",
      } as Opportunity);
    });
    expect(output).toContain("Opportunity");
    expect(output).toContain("pending");
    expect(output).toContain("collaboration");
    expect(output).toContain("90%");
    expect(output).toContain("Alice");
    expect(output).toContain("Bob");
    expect(output).toContain("Both are looking for cofounders");
    expect(output).toContain("You and Bob should connect!");
  });

  it("normalizes 0-1 confidence values to percentages", () => {
    const output = captureLogs(() => {
      opportunityCard({
        id: "o2",
        status: "pending",
        counterpartName: "Bob",
        interpretation: {
          category: "collaboration",
          confidence: 0.72,
          reasoning: "Strong overlap",
        },
        createdAt: "2026-01-01T00:00:00Z",
      } as Opportunity);
    });

    expect(output).toContain("72%");
    expect(output).not.toContain("1%");
  });
});

// ── networkTable ────────────────────────────────────────────────────

describe("networkTable", () => {
  it("renders network rows", () => {
    const output = captureLogs(() => {
      networkTable([
        { id: "n1", title: "Builders", memberCount: 12, role: "owner", joinPolicy: "anyone", createdAt: "2026-01-01" },
      ]);
    });
    expect(output).toContain("Title");
    expect(output).toContain("Builders");
    expect(output).toContain("12");
    expect(output).toContain("owner");
    expect(output).toContain("anyone");
  });

  it("prints empty message for no networks", () => {
    const output = captureLogs(() => {
      networkTable([]);
    });
    expect(output).toContain("No networks found");
  });
});

// ── networkCard ─────────────────────────────────────────────────────

describe("networkCard", () => {
  it("renders network detail card", () => {
    const output = captureLogs(() => {
      networkCard({
        id: "n1",
        title: "Builders",
        prompt: "For startup founders",
        joinPolicy: "anyone",
        memberCount: 12,
        owner: { name: "Alice", email: "alice@test.com" },
      });
    });
    expect(output).toContain("Builders");
    expect(output).toContain("For startup founders");
    expect(output).toContain("anyone");
    expect(output).toContain("12");
    expect(output).toContain("Alice");
  });
});

// ── memberTable ─────────────────────────────────────────────────────

describe("memberTable", () => {
  it("renders member rows with role detection", () => {
    const output = captureLogs(() => {
      memberTable([
        { user: { name: "Alice", email: "alice@test.com" }, permissions: ["owner"], createdAt: "2026-01-01" },
        { user: { name: "Bob", email: "bob@test.com" }, permissions: ["member"], createdAt: "2026-01-02" },
      ]);
    });
    expect(output).toContain("Name");
    expect(output).toContain("Alice");
    expect(output).toContain("owner");
    expect(output).toContain("Bob");
    expect(output).toContain("member");
  });

  it("prints empty message for no members", () => {
    const output = captureLogs(() => {
      memberTable([]);
    });
    expect(output).toContain("No members found");
  });
});

// ── conversationTable ───────────────────────────────────────────────

describe("conversationTable", () => {
  const conversations: Conversation[] = [
    {
      id: "c1",
      type: "dm",
      participants: [
        { participantId: "u1", user: { id: "u1", name: "Alice" } },
        { participantId: "u2", user: { id: "u2", name: "Bob" } },
      ],
      createdAt: "2026-01-01T00:00:00Z",
    } as Conversation,
  ];

  it("renders conversation rows", () => {
    const output = captureLogs(() => {
      conversationTable(conversations);
    });
    expect(output).toContain("ID");
    expect(output).toContain("Participants");
    expect(output).toContain("Alice, Bob");
  });

  it("prints empty message for no conversations", () => {
    const output = captureLogs(() => {
      conversationTable([]);
    });
    expect(output).toContain("No conversations found");
  });
});

// ── conversationCard ────────────────────────────────────────────────

describe("conversationCard", () => {
  it("renders conversation summary", () => {
    const output = captureLogs(() => {
      conversationCard({
        id: "dm-1",
        type: "dm",
        participants: [
          { participantId: "u1", user: { id: "u1", name: "Alice" } },
          { participantId: "u2", user: { id: "u2", name: "Bob" } },
        ],
        createdAt: "2026-01-01T00:00:00Z",
      } as Conversation);
    });
    expect(output).toContain("Conversation");
    expect(output).toContain("dm-1");
    expect(output).toContain("Alice, Bob");
  });
});

// ── messageList ─────────────────────────────────────────────────────

describe("messageList", () => {
  const messages: ConversationMessage[] = [
    {
      id: "m1",
      conversationId: "c1",
      senderId: "u1",
      role: "user",
      parts: [{ type: "text", text: "Hello there" }],
      createdAt: "2026-01-01T10:00:00Z",
    },
    {
      id: "m2",
      conversationId: "c1",
      senderId: "u2",
      role: "user",
      parts: [{ type: "text", text: "Hi back!" }],
      createdAt: "2026-01-01T10:01:00Z",
    },
  ];

  it("renders messages with sender and time", () => {
    const output = captureLogs(() => {
      messageList(messages);
    });
    expect(output).toContain("u1");
    expect(output).toContain("Hello there");
    expect(output).toContain("u2");
    expect(output).toContain("Hi back!");
  });

  it("prints empty message for no messages", () => {
    const output = captureLogs(() => {
      messageList([]);
    });
    expect(output).toContain("No messages found");
  });
});
