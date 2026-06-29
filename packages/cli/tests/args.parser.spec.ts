import { describe, it, expect } from "bun:test";

import { parseArgs } from "../src/args.parser";

describe("parseArgs", () => {
  // ── Basic routing ──────────────────────────────────────────────────

  it("returns help for empty args", () => {
    const result = parseArgs([]);
    expect(result.command).toBe("help");
  });

  it("parses '--help' flag", () => {
    const result = parseArgs(["--help"]);
    expect(result.command).toBe("help");
  });

  it("parses '-h' flag", () => {
    const result = parseArgs(["-h"]);
    expect(result.command).toBe("help");
  });

  it("parses 'help' command", () => {
    const result = parseArgs(["help"]);
    expect(result.command).toBe("help");
  });

  it("parses '--version' flag", () => {
    const result = parseArgs(["--version"]);
    expect(result.command).toBe("version");
  });

  it("parses '-v' flag", () => {
    const result = parseArgs(["-v"]);
    expect(result.command).toBe("version");
  });

  it("parses 'login' command", () => {
    const result = parseArgs(["login"]);
    expect(result.command).toBe("login");
  });

  it("parses 'logout' command", () => {
    const result = parseArgs(["logout"]);
    expect(result.command).toBe("logout");
  });

  it("returns unknown for unrecognized command", () => {
    const result = parseArgs(["foobar"]);
    expect(result.command).toBe("unknown");
    expect(result.unknown).toBe("foobar");
  });

  it("treats 'chat' as unknown command", () => {
    const result = parseArgs(["chat"]);
    expect(result.command).toBe("unknown");
    expect(result.unknown).toBe("chat");
  });

  // ── Global flags ───────────────────────────────────────────────────

  it("parses --json flag on contact list", () => {
    const result = parseArgs(["contact", "list", "--json"]);
    expect(result.command).toBe("contact");
    expect(result.json).toBe(true);
  });

  it("parses --json flag on intent list", () => {
    const result = parseArgs(["intent", "list", "--json"]);
    expect(result.command).toBe("intent");
    expect(result.json).toBe(true);
  });

  it("parses --api-url flag", () => {
    const result = parseArgs(["login", "--api-url", "http://example.com"]);
    expect(result.command).toBe("login");
    expect(result.apiUrl).toBe("http://example.com");
  });

  it("parses --app-url flag", () => {
    const result = parseArgs(["login", "--app-url", "http://app.example.com"]);
    expect(result.command).toBe("login");
    expect(result.appUrl).toBe("http://app.example.com");
  });

  it("parses --token flag", () => {
    const result = parseArgs(["login", "--token", "my-token"]);
    expect(result.command).toBe("login");
    expect(result.token).toBe("my-token");
  });

  it("parses -t shorthand for --token", () => {
    const result = parseArgs(["login", "-t", "my-token"]);
    expect(result.command).toBe("login");
    expect(result.token).toBe("my-token");
  });

  // ── Contact commands ───────────────────────────────────────────────

  describe("contact", () => {
    it("parses contact list", () => {
      const result = parseArgs(["contact", "list"]);
      expect(result.command).toBe("contact");
      expect(result.subcommand).toBe("list");
    });

    it("parses contact add with email", () => {
      const result = parseArgs(["contact", "add", "foo@bar.com"]);
      expect(result.command).toBe("contact");
      expect(result.subcommand).toBe("add");
      expect(result.positionals).toEqual(["foo@bar.com"]);
    });

    it("parses contact add with --name", () => {
      const result = parseArgs(["contact", "add", "foo@bar.com", "--name", "John"]);
      expect(result.command).toBe("contact");
      expect(result.subcommand).toBe("add");
      expect(result.positionals).toEqual(["foo@bar.com"]);
      expect(result.name).toBe("John");
    });

    it("parses contact remove", () => {
      const result = parseArgs(["contact", "remove", "foo@bar.com"]);
      expect(result.command).toBe("contact");
      expect(result.subcommand).toBe("remove");
      expect(result.positionals).toEqual(["foo@bar.com"]);
    });

    it("parses contact import --gmail", () => {
      const result = parseArgs(["contact", "import", "--gmail"]);
      expect(result.command).toBe("contact");
      expect(result.subcommand).toBe("import");
      expect(result.gmail).toBe(true);
    });
  });

  // ── Intent commands ────────────────────────────────────────────────

  describe("intent", () => {
    it("parses intent list", () => {
      const result = parseArgs(["intent", "list"]);
      expect(result.command).toBe("intent");
      expect(result.subcommand).toBe("list");
    });

    it("parses intent list --archived", () => {
      const result = parseArgs(["intent", "list", "--archived"]);
      expect(result.command).toBe("intent");
      expect(result.subcommand).toBe("list");
      expect(result.archived).toBe(true);
    });

    it("parses intent show with id", () => {
      const result = parseArgs(["intent", "show", "abc-123"]);
      expect(result.command).toBe("intent");
      expect(result.subcommand).toBe("show");
      expect(result.intentId).toBe("abc-123");
    });

    it("parses intent create with content", () => {
      const result = parseArgs(["intent", "create", "find", "AI", "engineers"]);
      expect(result.command).toBe("intent");
      expect(result.subcommand).toBe("create");
      expect(result.intentContent).toBe("find AI engineers");
    });

    it("parses intent archive with id", () => {
      const result = parseArgs(["intent", "archive", "abc-123"]);
      expect(result.command).toBe("intent");
      expect(result.subcommand).toBe("archive");
      expect(result.intentId).toBe("abc-123");
    });

    it("parses intent update with id and content", () => {
      const result = parseArgs(["intent", "update", "abc-123", "new", "description", "here"]);
      expect(result.command).toBe("intent");
      expect(result.subcommand).toBe("update");
      expect(result.intentId).toBe("abc-123");
      expect(result.intentContent).toBe("new description here");
    });

    it("parses intent link", () => {
      const result = parseArgs(["intent", "link", "intent-id", "network-id"]);
      expect(result.command).toBe("intent");
      expect(result.subcommand).toBe("link");
      expect(result.intentId).toBe("intent-id");
      expect(result.targetId).toBe("network-id");
    });

    it("parses intent unlink", () => {
      const result = parseArgs(["intent", "unlink", "intent-id", "network-id"]);
      expect(result.command).toBe("intent");
      expect(result.subcommand).toBe("unlink");
      expect(result.intentId).toBe("intent-id");
      expect(result.targetId).toBe("network-id");
    });

    it("parses intent links", () => {
      const result = parseArgs(["intent", "links", "intent-id"]);
      expect(result.command).toBe("intent");
      expect(result.subcommand).toBe("links");
      expect(result.intentId).toBe("intent-id");
    });
  });

  // ── Opportunity commands ───────────────────────────────────────────

  describe("opportunity", () => {
    it("parses opportunity list", () => {
      const result = parseArgs(["opportunity", "list"]);
      expect(result.command).toBe("opportunity");
      expect(result.subcommand).toBe("list");
    });

    it("parses opportunity list --status", () => {
      const result = parseArgs(["opportunity", "list", "--status", "pending"]);
      expect(result.command).toBe("opportunity");
      expect(result.subcommand).toBe("list");
      expect(result.status).toBe("pending");
    });

    it("parses opportunity show with id", () => {
      const result = parseArgs(["opportunity", "show", "opp-123"]);
      expect(result.command).toBe("opportunity");
      expect(result.subcommand).toBe("show");
      expect(result.targetId).toBe("opp-123");
    });

    it("parses opportunity accept with id", () => {
      const result = parseArgs(["opportunity", "accept", "opp-123"]);
      expect(result.command).toBe("opportunity");
      expect(result.subcommand).toBe("accept");
      expect(result.targetId).toBe("opp-123");
    });

    it("parses opportunity reject with id", () => {
      const result = parseArgs(["opportunity", "reject", "opp-123"]);
      expect(result.command).toBe("opportunity");
      expect(result.subcommand).toBe("reject");
      expect(result.targetId).toBe("opp-123");
    });

    it("parses opportunity discover with query", () => {
      const result = parseArgs(["opportunity", "discover", "AI", "engineers"]);
      expect(result.command).toBe("opportunity");
      expect(result.subcommand).toBe("discover");
      expect(result.positionals).toContain("AI");
      expect(result.positionals).toContain("engineers");
    });

    it("parses opportunity discover --target", () => {
      const result = parseArgs(["opportunity", "discover", "--target", "user-123", "query"]);
      expect(result.command).toBe("opportunity");
      expect(result.subcommand).toBe("discover");
      expect(result.target).toBe("user-123");
    });

    it("parses opportunity discover --introduce", () => {
      const result = parseArgs(["opportunity", "discover", "--introduce", "user-1", "user-2"]);
      expect(result.command).toBe("opportunity");
      expect(result.subcommand).toBe("discover");
      expect(result.introduce).toBe("user-1");
    });
  });

  // ── Profile commands ───────────────────────────────────────────────

  describe("profile", () => {
    it("parses profile show", () => {
      const result = parseArgs(["profile", "show"]);
      expect(result.command).toBe("profile");
      expect(result.subcommand).toBe("show");
    });

    it("parses profile show with user-id", () => {
      const result = parseArgs(["profile", "show", "user-123"]);
      expect(result.command).toBe("profile");
      expect(result.subcommand).toBe("show");
      expect(result.userId).toBe("user-123");
    });

    it("parses profile sync", () => {
      const result = parseArgs(["profile", "sync"]);
      expect(result.command).toBe("profile");
      expect(result.subcommand).toBe("sync");
    });

    it("parses profile search", () => {
      const result = parseArgs(["profile", "search", "John", "Doe"]);
      expect(result.command).toBe("profile");
      expect(result.subcommand).toBe("search");
      expect(result.positionals).toEqual(["John", "Doe"]);
    });

    it("parses profile create with --linkedin", () => {
      const result = parseArgs(["profile", "create", "--linkedin", "https://linkedin.com/in/foo"]);
      expect(result.command).toBe("profile");
      expect(result.subcommand).toBe("create");
      expect(result.linkedin).toBe("https://linkedin.com/in/foo");
    });

    it("parses profile create with --github", () => {
      const result = parseArgs(["profile", "create", "--github", "https://github.com/foo"]);
      expect(result.command).toBe("profile");
      expect(result.subcommand).toBe("create");
      expect(result.github).toBe("https://github.com/foo");
    });

    it("parses profile create with --twitter", () => {
      const result = parseArgs(["profile", "create", "--twitter", "https://twitter.com/foo"]);
      expect(result.command).toBe("profile");
      expect(result.subcommand).toBe("create");
      expect(result.twitter).toBe("https://twitter.com/foo");
    });

    it("parses profile update with positional text", () => {
      const result = parseArgs(["profile", "update", "add", "Python", "to", "skills"]);
      expect(result.command).toBe("profile");
      expect(result.subcommand).toBe("update");
      expect(result.positionals).toEqual(["add", "Python", "to", "skills"]);
    });

    it("parses profile update with --details", () => {
      const result = parseArgs(["profile", "update", "--details", "new bio text"]);
      expect(result.command).toBe("profile");
      expect(result.subcommand).toBe("update");
      expect(result.details).toBe("new bio text");
    });
  });

  // ── Network commands ───────────────────────────────────────────────

  describe("network", () => {
    it("parses network list", () => {
      const result = parseArgs(["network", "list"]);
      expect(result.command).toBe("network");
      expect(result.subcommand).toBe("list");
    });

    it("parses network create with --prompt", () => {
      const result = parseArgs(["network", "create", "My Network", "--prompt", "AI focus"]);
      expect(result.command).toBe("network");
      expect(result.subcommand).toBe("create");
      expect(result.prompt).toBe("AI focus");
      expect(result.positionals).toContain("My Network");
    });

    it("parses network show with id", () => {
      const result = parseArgs(["network", "show", "net-id"]);
      expect(result.command).toBe("network");
      expect(result.subcommand).toBe("show");
      expect(result.positionals).toContain("net-id");
    });

    it("parses network update with --title", () => {
      const result = parseArgs(["network", "update", "net-id", "--title", "New Title"]);
      expect(result.command).toBe("network");
      expect(result.subcommand).toBe("update");
      expect(result.positionals).toContain("net-id");
      expect(result.title).toBe("New Title");
    });

    it("parses network delete with id", () => {
      const result = parseArgs(["network", "delete", "net-id"]);
      expect(result.command).toBe("network");
      expect(result.subcommand).toBe("delete");
      expect(result.positionals).toContain("net-id");
    });

    it("parses network join with id", () => {
      const result = parseArgs(["network", "join", "net-id"]);
      expect(result.command).toBe("network");
      expect(result.subcommand).toBe("join");
      expect(result.positionals).toContain("net-id");
    });

    it("parses network leave with id", () => {
      const result = parseArgs(["network", "leave", "net-id"]);
      expect(result.command).toBe("network");
      expect(result.subcommand).toBe("leave");
      expect(result.positionals).toContain("net-id");
    });

    it("parses network invite with id", () => {
      const result = parseArgs(["network", "invite", "net-id"]);
      expect(result.command).toBe("network");
      expect(result.subcommand).toBe("invite");
      expect(result.positionals).toContain("net-id");
    });
  });

  // ── Conversation commands ──────────────────────────────────────────

  describe("conversation", () => {
    it("parses conversation with no args as REPL mode", () => {
      const result = parseArgs(["conversation"]);
      expect(result.command).toBe("conversation");
      expect(result.message).toBeUndefined();
      expect(result.subcommand).toBeUndefined();
    });

    it("parses conversation with message as one-shot mode", () => {
      const result = parseArgs(["conversation", "hello", "world"]);
      expect(result.command).toBe("conversation");
      expect(result.message).toBe("hello world");
    });

    it("parses conversation sessions", () => {
      const result = parseArgs(["conversation", "sessions"]);
      expect(result.command).toBe("conversation");
      expect(result.subcommand).toBe("sessions");
    });

    it("parses conversation --session <id>", () => {
      const result = parseArgs(["conversation", "--session", "abc-123"]);
      expect(result.command).toBe("conversation");
      expect(result.sessionId).toBe("abc-123");
    });

    it("parses conversation --session <id> with message", () => {
      const result = parseArgs(["conversation", "--session", "abc-123", "hello"]);
      expect(result.command).toBe("conversation");
      expect(result.sessionId).toBe("abc-123");
      expect(result.message).toBe("hello");
    });

    it("parses conversation --api-url", () => {
      const result = parseArgs(["conversation", "--api-url", "http://localhost:4000"]);
      expect(result.command).toBe("conversation");
      expect(result.apiUrl).toBe("http://localhost:4000");
    });

    it("parses conversation with subcommand", () => {
      const result = parseArgs(["conversation", "with", "user-123"]);
      expect(result.command).toBe("conversation");
      expect(result.subcommand).toBe("with");
      expect(result.positionals).toEqual(["user-123"]);
    });
  });

  // ── Scrape command ─────────────────────────────────────────────────

  describe("scrape", () => {
    it("parses scrape with url", () => {
      const result = parseArgs(["scrape", "https://example.com"]);
      expect(result.command).toBe("scrape");
      expect(result.positionals).toEqual(["https://example.com"]);
    });

    it("parses scrape with --objective", () => {
      const result = parseArgs(["scrape", "https://example.com", "--objective", "extract bio"]);
      expect(result.command).toBe("scrape");
      expect(result.positionals).toEqual(["https://example.com"]);
      expect(result.objective).toBe("extract bio");
    });
  });

  // ── Sync command ───────────────────────────────────────────────────

  describe("sync", () => {
    it("parses sync command", () => {
      const result = parseArgs(["sync"]);
      expect(result.command).toBe("sync");
    });
  });

  // ── Onboarding command ─────────────────────────────────────────────

  describe("onboarding", () => {
    it("parses onboarding complete", () => {
      const result = parseArgs(["onboarding", "complete"]);
      expect(result.command).toBe("onboarding");
      expect(result.subcommand).toBe("complete");
    });

    it("parses onboarding with no subcommand", () => {
      const result = parseArgs(["onboarding"]);
      expect(result.command).toBe("onboarding");
      expect(result.subcommand).toBeUndefined();
    });
  });

  // ── Limit flag ─────────────────────────────────────────────────────

  it("parses --limit flag", () => {
    const result = parseArgs(["intent", "list", "--limit", "5"]);
    expect(result.command).toBe("intent");
    expect(result.limit).toBe(5);
  });
});
