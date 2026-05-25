import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { parseArgs } from "../src/args.parser";
import * as output from "../src/output";
import type { Intent } from "../src/api.client";

describe("parseArgs — intent command", () => {
  it("parses 'intent list'", () => {
    const result = parseArgs(["intent", "list"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("list");
  });

  it("parses 'intent list --archived'", () => {
    const result = parseArgs(["intent", "list", "--archived"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("list");
    expect(result.archived).toBe(true);
  });

  it("parses 'intent list --limit 5'", () => {
    const result = parseArgs(["intent", "list", "--limit", "5"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("list");
    expect(result.limit).toBe(5);
  });

  it("parses 'intent show <id>'", () => {
    const result = parseArgs(["intent", "show", "abc-123"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("show");
    expect(result.intentId).toBe("abc-123");
  });

  it("parses 'intent create <content>'", () => {
    const result = parseArgs(["intent", "create", "Looking for a co-founder"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("create");
    expect(result.intentContent).toBe("Looking for a co-founder");
  });

  it("parses 'intent create' with multi-word content", () => {
    const result = parseArgs(["intent", "create", "Looking", "for", "a", "co-founder"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("create");
    expect(result.intentContent).toBe("Looking for a co-founder");
  });

  it("parses 'intent archive <id>'", () => {
    const result = parseArgs(["intent", "archive", "abc-123"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("archive");
    expect(result.intentId).toBe("abc-123");
  });

  it("parses 'intent' with no subcommand as intent help", () => {
    const result = parseArgs(["intent"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBeUndefined();
  });

  it("parses 'intent list --limit 10 --archived'", () => {
    const result = parseArgs(["intent", "list", "--limit", "10", "--archived"]);
    expect(result.command).toBe("intent");
    expect(result.subcommand).toBe("list");
    expect(result.limit).toBe(10);
    expect(result.archived).toBe(true);
  });
});

describe("output — intentTable", () => {
  let logged: string[];
  const origLog = console.log;

  beforeEach(() => {
    logged = [];
    console.log = (...args: unknown[]) => logged.push(args.join(" "));
  });

  afterEach(() => {
    console.log = origLog;
  });

  it("renders a table with intent rows", () => {
    const intents: Intent[] = [
      {
        id: "i1",
        payload: "Looking for a technical co-founder with React experience",
        summary: "Co-founder search",
        status: "ACTIVE",
        sourceType: "discovery_form",
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z",
        archivedAt: null,
      },
    ];

    output.intentTable(intents);

    const joined = logged.join("\n");
    expect(joined).toContain("Signal");
    expect(joined).toContain("Status");
    expect(joined).toContain("ACTIVE");
    expect(joined).toContain("discovery_form");
  });

  it("shows empty message when no intents", () => {
    output.intentTable([]);
    const joined = logged.join("\n");
    expect(joined).toContain("No signals found");
  });
});

describe("output — intentCard", () => {
  let logged: string[];
  const origLog = console.log;

  beforeEach(() => {
    logged = [];
    console.log = (...args: unknown[]) => logged.push(args.join(" "));
  });

  afterEach(() => {
    console.log = origLog;
  });

  it("renders a detail card with intent fields", () => {
    const intent: Intent = {
      id: "i1",
      payload: "Looking for a technical co-founder",
      summary: "Co-founder search",
      status: "ACTIVE",
      sourceType: "discovery_form",
      intentMode: "ATTRIBUTIVE",
      speechActType: "DIRECTIVE",
      createdAt: "2026-03-01T00:00:00Z",
      updatedAt: "2026-03-01T00:00:00Z",
      archivedAt: null,
    };

    output.intentCard(intent);

    const joined = logged.join("\n");
    expect(joined).toContain("Signal Details");
    expect(joined).toContain("Looking for a technical co-founder");
    expect(joined).toContain("ACTIVE");
    expect(joined).toContain("DIRECTIVE");
  });
});
