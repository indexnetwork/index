# CLI Contract Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore CLI compatibility with current API/protocol contracts, adopt the network-request, email-invite, and synchronous-enrichment endpoints, and ship a consistent `0.13.2` package.

**Architecture:** Keep the flat CLI structure and retain `ApiClient` as the sole HTTP boundary. Add typed methods only for the touched contracts, return a tagged created/requested result for network creation, and keep command modules responsible for user flow and rendering rather than endpoint payload construction.

**Tech Stack:** Bun, TypeScript, Bun test, native `fetch`, existing CLI output facade, npm platform packages.

## Global Constraints

- Preserve the user-facing `profile`, `intent`, `network`, and `opportunity` command names.
- Preserve session/API-key migration, credential storage, and reauthentication behavior.
- Use canonical `read_user_contexts`, `create_user_context`, and `update_user_context` tool names; no deprecated `*_user_profile` name may remain in CLI source.
- Network-create fallback is permitted only for the specific structured early-access 403.
- Acceptance may carry `acknowledgedUptakeQuestionIds`; rejection must not.
- JSON mode must emit no ANSI or progress output.
- Keep API/protocol code unchanged; this is a CLI-only behavior change.
- Do not refactor SSE parsing, argument parsing, formatters, or split `ApiClient` by domain.
- Set the CLI, runtime, optional platform pins, platform manifests, and applicable locks to exactly `0.13.2`.
- Do not run database-backed tests.

## File Map

- `packages/cli/src/api.client.ts` — typed HTTP/tool methods and early-access fallback.
- `packages/cli/src/types.ts` — network request/invitation and enrichment DTOs.
- `packages/cli/src/network.command.ts` — render created/requested outcomes and direct email invitations.
- `packages/cli/src/profile.command.ts` — canonical context tools and synchronous enrichment flow.
- `packages/cli/src/sync.command.ts` — canonical profile/context read.
- `packages/cli/src/intent.command.ts` — delegate update payload construction to `ApiClient`.
- `packages/cli/src/opportunity.command.ts` — use one REST status transition path.
- `packages/cli/src/main.ts` — derive runtime version from the package manifest.
- `packages/cli/scripts/build.ts` — validate version alignment without rewriting tracked manifests.
- `packages/cli/tests/api.client.spec.ts` — direct request/response contract coverage.
- `packages/cli/tests/network.command.spec.ts` — created/requested and email-invite command behavior.
- `packages/cli/tests/profile.command.spec.ts` — synchronous enrichment client behavior.
- `packages/cli/tests/tool-calls.spec.ts` — canonical tool names and exact mutation payloads.
- `packages/cli/tests/opportunity.command.spec.ts` — REST accept/reject behavior and JSON cleanliness.
- `packages/cli/tests/npm-packages.spec.ts` — runtime/package version equality.
- `packages/cli/tests/build-script.spec.ts` — non-mutating version validation contract.
- `packages/cli/package.json`, `packages/cli/npm/*/package.json`, `packages/cli/bun.lock`, `bun.lock` — `0.13.2` release metadata.
- `packages/cli/README.md`, `docs/specs/cli-reference.md` — current command semantics.

---

### Task 1: Restore Release and Build Integrity

**Files:**
- Modify: `packages/cli/tests/npm-packages.spec.ts`
- Modify: `packages/cli/tests/build-script.spec.ts`
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/scripts/build.ts`
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/npm/linux-x64/package.json`
- Modify: `packages/cli/npm/linux-arm64/package.json`
- Modify: `packages/cli/npm/darwin-x64/package.json`
- Modify: `packages/cli/npm/darwin-arm64/package.json`
- Modify: `packages/cli/bun.lock`
- Modify: `bun.lock`

**Interfaces:**
- Consumes: existing main/platform package manifests and `bun src/main.ts --version` command.
- Produces: runtime version derived from `packages/cli/package.json`; `assertVersionsAligned(): Promise<void>` in the build script; every CLI package surface at `0.13.2`.

- [ ] **Step 1: Replace the source-text runtime assertion with an executable version test**

In `packages/cli/tests/npm-packages.spec.ts`, import `spawnSync` and replace the `main.ts` string check with:

```ts
import { spawnSync } from "node:child_process";

it("reports the main package version at runtime", async () => {
  const pkgPath = join(CLI_ROOT, "package.json");
  const raw = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as { version: string };
  const result = spawnSync("bun", ["src/main.ts", "--version"], {
    cwd: CLI_ROOT,
    encoding: "utf-8",
  });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.trim()).toBe(pkg.version);
});
```

In `packages/cli/tests/build-script.spec.ts`, add an assertion that the build validates rather than rewrites manifests:

```ts
it("validates package versions without rewriting manifests", async () => {
  const source = await readFile(join(CLI_ROOT, "scripts", "build.ts"), "utf-8");
  expect(source).toContain("assertVersionsAligned");
  expect(source).not.toContain("writeFile(");
});
```

- [ ] **Step 2: Run the release-integrity tests and verify red state**

Run:

```bash
cd packages/cli
bun test tests/npm-packages.spec.ts tests/build-script.spec.ts
```

Expected: FAIL because runtime/platform metadata still reports `0.13.0` or `0.13.1`, and `build.ts` still contains `writeFile`-based synchronization.

- [ ] **Step 3: Make `package.json` the runtime version source**

In `packages/cli/src/main.ts`, replace the hard-coded constant with a JSON import:

```ts
import packageJson from "../package.json" with { type: "json" };

const DEFAULT_API_URL = "https://protocol.index.network";
const DEFAULT_APP_URL = "https://index.network";
const VERSION = packageJson.version;
```

Keep the import in the external-import group before local relative imports.

- [ ] **Step 4: Make the build fail on drift instead of repairing tracked manifests**

In `packages/cli/scripts/build.ts`, remove `writeFile` from the filesystem import and replace `syncVersions()` with:

```ts
async function assertVersionsAligned(): Promise<void> {
  const mainPkgPath = join(CLI_ROOT, "package.json");
  const mainPkg = JSON.parse(await readFile(mainPkgPath, "utf-8")) as {
    version: string;
    optionalDependencies?: Record<string, string>;
  };
  const mismatches: string[] = [];

  for (const target of TARGETS) {
    const depName = `@indexnetwork/cli-${target.npmDir}`;
    const pkgPath = join(CLI_ROOT, "npm", target.npmDir, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as { version: string };
    if (pkg.version !== mainPkg.version) {
      mismatches.push(`npm/${target.npmDir}/package.json=${pkg.version}`);
    }
    if (mainPkg.optionalDependencies?.[depName] !== mainPkg.version) {
      mismatches.push(`optionalDependencies.${depName}=${mainPkg.optionalDependencies?.[depName] ?? "missing"}`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `[build] Package versions must match ${mainPkg.version}: ${mismatches.join(", ")}`,
    );
  }
}
```

Call `await assertVersionsAligned()` before `buildJsFallback()`.

- [ ] **Step 5: Align package and lock metadata at `0.13.2`**

Set the main version, four optional dependency pins, and four platform package versions to `0.13.2`. Then regenerate both lock contexts:

```bash
cd packages/cli
bun install --lockfile-only --ignore-scripts
cd ../..
bun install --lockfile-only --ignore-scripts
```

Inspect `packages/cli/bun.lock` and root `bun.lock`; every CLI optional package entry must be `0.13.2`, and unrelated dependency resolution must not change.

- [ ] **Step 6: Run focused release tests and build**

Run:

```bash
cd packages/cli
bun test tests/npm-packages.spec.ts tests/build-script.spec.ts tests/help-output.spec.ts
cd ../..
BEFORE=$(git hash-object packages/cli/package.json packages/cli/npm/*/package.json | sha256sum)
cd packages/cli
bun run build
cd ../..
AFTER=$(git hash-object packages/cli/package.json packages/cli/npm/*/package.json | sha256sum)
test "$BEFORE" = "$AFTER"
```

Expected: all tests PASS, build exits 0, and tracked package-manifest hashes are unchanged by the build.

- [ ] **Step 7: Commit release integrity**

```bash
git add packages/cli/src/main.ts packages/cli/scripts/build.ts packages/cli/tests/npm-packages.spec.ts packages/cli/tests/build-script.spec.ts packages/cli/package.json packages/cli/npm/*/package.json packages/cli/bun.lock bun.lock
git commit -m "fix(cli): align release version metadata"
```

---

### Task 2: Align Network Creation and Invitation

**Files:**
- Modify: `packages/cli/src/types.ts`
- Modify: `packages/cli/src/api.client.ts`
- Modify: `packages/cli/src/network.command.ts`
- Modify: `packages/cli/tests/api.client.spec.ts`
- Modify: `packages/cli/tests/network.command.spec.ts`

**Interfaces:**
- Consumes: `ApiError`, private `post()`, existing `Network` DTO, API early-access error `{ error: string }`.
- Produces:
  - `NetworkRequest`;
  - `NetworkCreateResult = { kind: "created"; network: Network } | { kind: "requested"; request: NetworkRequest }`;
  - `NetworkInvitationResult`;
  - `ApiClient.createNetworkOrRequest(title: string, prompt?: string): Promise<NetworkCreateResult>`;
  - `ApiClient.inviteNetworkMember(networkId: string, email: string, name?: string): Promise<NetworkInvitationResult>`.

- [ ] **Step 1: Add failing ApiClient tests for direct creation and exact fallback**

Replace the existing `createNetwork` tests in `packages/cli/tests/api.client.spec.ts` with tests covering all three branches:

```ts
describe("createNetworkOrRequest", () => {
  it("returns a created result for direct staff creation", async () => {
    mock.on("POST", "/api/networks", () =>
      Response.json({ network: { id: "n1", title: "New Net", joinPolicy: "invite_only" } }),
    );

    await expect(client.createNetworkOrRequest("New Net", "A description")).resolves.toEqual({
      kind: "created",
      network: { id: "n1", title: "New Net", joinPolicy: "invite_only" },
    });
  });

  it("submits a request for the specific early-access 403", async () => {
    let requestBody: Record<string, unknown> = {};
    mock.on("POST", "/api/networks", () =>
      Response.json(
        { error: "Network creation is in early access. Submit a request at POST /network-requests." },
        { status: 403 },
      ),
    );
    mock.on("POST", "/api/network-requests", async (req) => {
      requestBody = await req.json() as Record<string, unknown>;
      return Response.json({
        request: { id: "request-1", title: "New Net", status: "pending", purpose: "A description", submittedAt: "2026-08-07T00:00:00Z" },
      }, { status: 201 });
    });

    const result = await client.createNetworkOrRequest("New Net", "A description");
    expect(requestBody).toEqual({ name: "New Net", purpose: "A description" });
    expect(result.kind).toBe("requested");
  });

  it("does not convert an unrelated 403 into a request", async () => {
    mock.on("POST", "/api/networks", () =>
      Response.json({ error: "Access denied" }, { status: 403 }),
    );

    await expect(client.createNetworkOrRequest("New Net")).rejects.toThrow("Access denied");
  });
});
```

Add a direct invitation test:

```ts
it("invites a member directly by email", async () => {
  let receivedBody: Record<string, unknown> = {};
  mock.on("POST", "/api/networks/n1/members/invite", async (req) => {
    receivedBody = await req.json() as Record<string, unknown>;
    return Response.json({
      user: { id: "u1", email: "alice@test.com" },
      created: true,
      alreadyMember: false,
      agentProvisioned: true,
    }, { status: 201 });
  });

  const result = await client.inviteNetworkMember("n1", "alice@test.com");
  expect(receivedBody).toEqual({ email: "alice@test.com" });
  expect(result.created).toBe(true);
});
```

- [ ] **Step 2: Run ApiClient network tests and verify failure**

Run:

```bash
cd packages/cli
bun test tests/api.client.spec.ts --test-name-pattern "createNetworkOrRequest|invites a member directly"
```

Expected: FAIL because the typed methods and DTOs do not exist.

- [ ] **Step 3: Add network DTOs and typed client methods**

Add to `packages/cli/src/types.ts`:

```ts
export interface NetworkRequest {
  id: string;
  title: string;
  status: string;
  purpose?: string;
  audience?: string;
  expectedSize?: string;
  notes?: string;
  reviewNote?: string;
  submittedAt: string;
}

export type NetworkCreateResult =
  | { kind: "created"; network: Network }
  | { kind: "requested"; request: NetworkRequest };

export interface NetworkInvitationResult {
  user: { id: string; email: string };
  created: boolean;
  alreadyMember: boolean;
  agentProvisioned: boolean;
}
```

Import/re-export these types from `api.client.ts`. Add a module helper and methods:

```ts
function isEarlyAccessNetworkCreationError(error: unknown): error is ApiError {
  if (!(error instanceof ApiError) || error.status !== 403) return false;
  const response = error.response;
  return typeof response === "object"
    && response !== null
    && "error" in response
    && typeof response.error === "string"
    && response.error.startsWith("Network creation is in early access.");
}

async createNetworkOrRequest(title: string, prompt?: string): Promise<NetworkCreateResult> {
  try {
    const res = await this.post("/api/networks", {
      title,
      ...(prompt ? { prompt } : {}),
    });
    const body = await res.json() as { network: Network };
    return { kind: "created", network: body.network };
  } catch (error) {
    if (!isEarlyAccessNetworkCreationError(error)) throw error;
  }

  const res = await this.post("/api/network-requests", {
    name: title,
    ...(prompt ? { purpose: prompt } : {}),
  });
  const body = await res.json() as { request: NetworkRequest };
  return { kind: "requested", request: body.request };
}

async inviteNetworkMember(
  networkId: string,
  email: string,
  name?: string,
): Promise<NetworkInvitationResult> {
  const res = await this.post(`/api/networks/${networkId}/members/invite`, {
    email,
    ...(name ? { name } : {}),
  });
  return await res.json() as NetworkInvitationResult;
}
```

Remove `createNetwork`, `searchUsers`, and `addNetworkMember` plus their now-unused `SearchedUser` and `AddMemberResult` exports after confirming no remaining source caller with `rg`.

- [ ] **Step 4: Run ApiClient network tests and verify green**

Run:

```bash
cd packages/cli
bun test tests/api.client.spec.ts --test-name-pattern "createNetworkOrRequest|invites a member directly"
```

Expected: PASS.

- [ ] **Step 5: Write failing command tests for requested creation and direct invitation**

Update `packages/cli/tests/network.command.spec.ts` so creation captures JSON output and verifies the tagged result. Add a non-staff request test and replace search-then-add invitation tests:

```ts
it("submits a network request for non-staff users", async () => {
  mock.on("POST", "/api/networks", () =>
    Response.json(
      { error: "Network creation is in early access. Submit a request at POST /network-requests." },
      { status: 403 },
    ),
  );
  mock.on("POST", "/api/network-requests", () =>
    Response.json({
      request: { id: "r1", title: "New Net", status: "pending", submittedAt: "2026-08-07T00:00:00Z" },
    }, { status: 201 }),
  );

  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    await handleNetwork(client, "create", ["New Net"], { json: true });
  } finally {
    console.log = original;
  }

  expect(JSON.parse(logs.at(-1) ?? "{}")).toMatchObject({
    kind: "requested",
    request: { id: "r1", status: "pending" },
  });
});

it("invites a user directly by email", async () => {
  let receivedBody: Record<string, unknown> = {};
  mock.on("POST", "/api/networks/n1/members/invite", async (req) => {
    receivedBody = await req.json() as Record<string, unknown>;
    return Response.json({
      user: { id: "u1", email: "alice@test.com" },
      created: false,
      alreadyMember: false,
      agentProvisioned: true,
    });
  });

  await handleNetwork(client, "invite", ["n1", "alice@test.com"], {});
  expect(receivedBody).toEqual({ email: "alice@test.com" });
});
```

- [ ] **Step 6: Run command tests and verify red state**

Run:

```bash
cd packages/cli
bun test tests/network.command.spec.ts
```

Expected: FAIL because `network.command.ts` still expects a `Network` result and performs search-then-add invitation.

- [ ] **Step 7: Render tagged creation and invitation outcomes**

Update `networkCreate` to call `createNetworkOrRequest`. In JSON mode print the tagged result. In terminal mode:

```ts
if (result.kind === "requested") {
  output.success(`Network request submitted: ${result.request.title}`);
  output.dim(`  Status: ${result.request.status}`);
  output.dim(`  Request ID: ${result.request.id}`);
  return;
}

const { network } = result;
output.success(`Network created: ${network.title}`);
```

Update `networkInvite` to call `inviteNetworkMember`. Use exact terminal copy:

```ts
if (result.alreadyMember) {
  output.info(`${result.user.email} is already a network member.`);
  return;
}
output.success(`Invitation sent to ${result.user.email}.`);
if (result.created) output.dim("  Created a pending account for this invitee.");
```

- [ ] **Step 8: Run all network tests and commit**

Run:

```bash
cd packages/cli
bun test tests/api.client.spec.ts tests/network.command.spec.ts tests/tool-calls.spec.ts
```

Expected: PASS after deleting/replacing obsolete search/add assertions.

Commit:

```bash
git add packages/cli/src/types.ts packages/cli/src/api.client.ts packages/cli/src/network.command.ts packages/cli/tests/api.client.spec.ts packages/cli/tests/network.command.spec.ts
git commit -m "fix(cli): follow current network request flows"
```

---

### Task 3: Adopt Canonical Profile Context and Synchronous Enrichment

**Files:**
- Modify: `packages/cli/src/types.ts`
- Modify: `packages/cli/src/api.client.ts`
- Modify: `packages/cli/src/profile.command.ts`
- Modify: `packages/cli/src/sync.command.ts`
- Modify: `packages/cli/tests/profile.command.spec.ts`
- Modify: `packages/cli/tests/tool-calls.spec.ts`

**Interfaces:**
- Consumes: existing `callTool`, private `post`, `ToolResult`, canonical context tool contracts.
- Produces:
  - `EnrichedProfile` and `EnrichmentResult`;
  - `ApiClient.enrichProfile(): Promise<EnrichmentResult>`;
  - `ApiClient.readUserContexts(query?)`, `createUserContext(query)`, and `updateUserContext(query)` returning `ToolResult`.

- [ ] **Step 1: Write failing client and command contract tests**

In `packages/cli/tests/profile.command.spec.ts`, add:

```ts
describe("enrichProfile", () => {
  it("runs synchronous enrichment and returns avatar and socials", async () => {
    mock.on("POST", "/api/enrichment/enrich", () => Response.json({
      enriched: true,
      profile: {
        name: "Alice",
        intro: "Builder",
        location: "Berlin",
        avatar: "avatars/alice.png",
        socials: [{ label: "github", value: "alice" }],
      },
    }));

    const result = await client.enrichProfile();
    expect(result.enriched).toBe(true);
    expect(result.profile.avatar).toBe("avatars/alice.png");
    expect(result.profile.socials).toHaveLength(1);
  });
});
```

In `packages/cli/tests/tool-calls.spec.ts`:

- change search expectation to `read_user_contexts`;
- change create expectation to `create_user_context`;
- change update expectation to `update_user_context`;
- replace both profile-sync tool tests with one REST handler asserting `POST /api/enrichment/enrich` and zero profile tool calls;
- change `index sync` expected tools from `read_user_profiles` to `read_user_contexts`.

Use this profile-sync test body:

```ts
it("sync uses the synchronous enrichment endpoint", async () => {
  let enrichCalls = 0;
  mock.onRest("POST", "/api/enrichment/enrich", () => {
    enrichCalls += 1;
    return Response.json({
      enriched: true,
      profile: { name: "Test", intro: "Engineer", location: null, avatar: null, socials: [] },
    });
  });

  await handleProfile(client, "sync", [], { json: true });

  expect(enrichCalls).toBe(1);
  expect(mock.toolCalls).toHaveLength(0);
});
```

- [ ] **Step 2: Run profile contract tests and verify failure**

Run:

```bash
cd packages/cli
bun test tests/profile.command.spec.ts tests/tool-calls.spec.ts --test-name-pattern "enrichProfile|profile|sync"
```

Expected: FAIL because canonical wrappers and `enrichProfile` do not exist and commands still call deprecated aliases.

- [ ] **Step 3: Add enrichment DTOs and typed context wrappers**

Add to `packages/cli/src/types.ts`:

```ts
export interface EnrichedProfile {
  name: string | null;
  intro: string | null;
  location: string | null;
  avatar: string | null;
  socials: Array<{ label: string; value: string }>;
}

export interface EnrichmentResult {
  enriched: true;
  profile: EnrichedProfile;
}
```

Add to `ApiClient`:

```ts
async enrichProfile(): Promise<EnrichmentResult> {
  const res = await this.post("/api/enrichment/enrich", {});
  return await res.json() as EnrichmentResult;
}

async readUserContexts(
  query: { userId?: string; networkId?: string; query?: string } = {},
): Promise<ToolResult> {
  return this.callTool("read_user_contexts", query);
}

async createUserContext(query: {
  confirm?: boolean;
  linkedinUrl?: string;
  githubUrl?: string;
  twitterUrl?: string;
}): Promise<ToolResult> {
  return this.callTool("create_user_context", query);
}

async updateUserContext(query: { action: string; details?: string }): Promise<ToolResult> {
  return this.callTool("update_user_context", query);
}
```

Import and re-export `EnrichedProfile` and `EnrichmentResult` through `api.client.ts`.

- [ ] **Step 4: Update profile and sync commands**

In `profile.command.ts`:

- search via `client.readUserContexts({ query })`;
- create via `client.createUserContext(query)`;
- update via `client.updateUserContext(query)`;
- sync via `client.enrichProfile()`.

Use exact terminal success behavior:

```ts
const result = await client.enrichProfile();
if (json) {
  console.log(JSON.stringify(result));
  return;
}
output.success("Profile enriched.");
if (result.profile.name) output.dim(`  Name: ${result.profile.name}`);
if (result.profile.location) output.dim(`  Location: ${result.profile.location}`);
output.dim(`  Social links: ${result.profile.socials.length}`);
```

In `sync.command.ts`, replace only the profile fetch with `client.readUserContexts()`; leave other tool calls and snapshot shape unchanged.

- [ ] **Step 5: Run profile tests and assert deprecated names are absent**

Run:

```bash
cd packages/cli
bun test tests/profile.command.spec.ts tests/tool-calls.spec.ts
! rg -n 'read_user_profiles|create_user_profile|update_user_profile' src
```

Expected: tests PASS and `rg` returns no matches.

- [ ] **Step 6: Commit profile compatibility**

```bash
git add packages/cli/src/types.ts packages/cli/src/api.client.ts packages/cli/src/profile.command.ts packages/cli/src/sync.command.ts packages/cli/tests/profile.command.spec.ts packages/cli/tests/tool-calls.spec.ts
git commit -m "fix(cli): use canonical profile enrichment contracts"
```

---

### Task 4: Repair Intent and Opportunity Mutations

**Files:**
- Modify: `packages/cli/src/api.client.ts`
- Modify: `packages/cli/src/intent.command.ts`
- Modify: `packages/cli/src/opportunity.command.ts`
- Modify: `packages/cli/tests/api.client.spec.ts`
- Modify: `packages/cli/tests/tool-calls.spec.ts`
- Modify: `packages/cli/tests/opportunity.command.spec.ts`

**Interfaces:**
- Consumes: `ToolResult`, `OpportunityDetail`, existing 409 uptake advisory handling.
- Produces:
  - `ApiClient.updateIntent(intentId: string, description: string): Promise<ToolResult>`;
  - `ApiClient.updateOpportunityStatus(id: string, status: "accepted" | "rejected", acknowledgedUptakeQuestionIds?: string[]): Promise<Record<string, unknown>>`.

- [ ] **Step 1: Write failing intent and status client tests**

In `packages/cli/tests/api.client.spec.ts`, add:

```ts
describe("updateIntent", () => {
  it("uses the canonical description field", async () => {
    let body: { query?: Record<string, unknown> } = {};
    mock.on("POST", "/api/tools/update_intent", async (req) => {
      body = await req.json() as { query?: Record<string, unknown> };
      return Response.json({ success: true, data: { intentId: "i1" } });
    });

    await client.updateIntent("i1", "Find an AI co-founder");
    expect(body.query).toEqual({ intentId: "i1", description: "Find an AI co-founder" });
  });
});

describe("updateOpportunityStatus", () => {
  it("uses REST for rejection without uptake acknowledgements", async () => {
    let body: Record<string, unknown> = {};
    mock.on("PATCH", "/api/opportunities/o1/status", async (req) => {
      body = await req.json() as Record<string, unknown>;
      return Response.json({ opportunity: { id: "o1", status: "rejected" } });
    });

    await client.updateOpportunityStatus("o1", "rejected");
    expect(body).toEqual({ status: "rejected" });
  });

  it("includes uptake acknowledgements only for acceptance", async () => {
    let body: Record<string, unknown> = {};
    mock.on("PATCH", "/api/opportunities/o1/status", async (req) => {
      body = await req.json() as Record<string, unknown>;
      return Response.json({ opportunity: { id: "o1", status: "accepted" } });
    });

    await client.updateOpportunityStatus("o1", "accepted", ["q1"]);
    expect(body).toEqual({ status: "accepted", acknowledgedUptakeQuestionIds: ["q1"] });
  });
});
```

Update `tool-calls.spec.ts` expectations to `{ intentId, description }` and zero tool calls for rejection.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
cd packages/cli
bun test tests/api.client.spec.ts tests/tool-calls.spec.ts --test-name-pattern "updateIntent|updateOpportunityStatus|intent|opportunity"
```

Expected: FAIL because methods are missing and existing commands still use `newDescription` and `update_opportunity`.

- [ ] **Step 3: Add typed client mutation methods**

Add to `ApiClient`:

```ts
async updateIntent(intentId: string, description: string): Promise<ToolResult> {
  return this.callTool("update_intent", { intentId, description });
}

async updateOpportunityStatus(
  id: string,
  status: "accepted" | "rejected",
  acknowledgedUptakeQuestionIds?: string[],
): Promise<Record<string, unknown>> {
  const res = await this.patch(`/api/opportunities/${id}/status`, {
    status,
    ...(status === "accepted" && acknowledgedUptakeQuestionIds
      ? { acknowledgedUptakeQuestionIds }
      : {}),
  });
  return await res.json() as Record<string, unknown>;
}
```

Remove `acceptOpportunity` after migrating its callers.

- [ ] **Step 4: Route commands through typed methods**

In `intent.command.ts`, replace the raw tool call with:

```ts
const result = await client.updateIntent(options.intentId, options.intentContent);
```

In `opportunity.command.ts`, call `updateOpportunityStatus` for both statuses. Keep the existing `try/catch` and 409 advisory rendering around acceptance. For rejection:

```ts
const result = await client.updateOpportunityStatus(opportunity.id, "rejected");
if (json) {
  console.log(JSON.stringify(result));
  return;
}
output.success("Opportunity rejected.");
```

Do not call `callTool("update_opportunity", ...)` anywhere in CLI source.

- [ ] **Step 5: Run mutation tests and verify green**

Run:

```bash
cd packages/cli
bun test tests/api.client.spec.ts tests/tool-calls.spec.ts tests/opportunity.command.spec.ts tests/intent.command.spec.ts
! rg -n 'newDescription|callTool\("update_opportunity"' src
```

Expected: tests PASS and both prohibited source searches return no matches.

- [ ] **Step 6: Commit mutation repairs**

```bash
git add packages/cli/src/api.client.ts packages/cli/src/intent.command.ts packages/cli/src/opportunity.command.ts packages/cli/tests/api.client.spec.ts packages/cli/tests/tool-calls.spec.ts packages/cli/tests/opportunity.command.spec.ts
git commit -m "fix(cli): align intent and opportunity mutations"
```

---

### Task 5: Update Public CLI Documentation

**Files:**
- Modify: `packages/cli/README.md`
- Modify: `docs/specs/cli-reference.md`
- Test: `packages/cli/tests/help-output.spec.ts`

**Interfaces:**
- Consumes: final command semantics from Tasks 2-4.
- Produces: user and developer documentation that distinguishes network requests from creation, direct email invitations, and synchronous profile enrichment.

- [ ] **Step 1: Update README command descriptions**

In `packages/cli/README.md`:

- document that `index network create` creates directly for staff and otherwise submits an early-access request;
- document that `network invite` accepts any valid email and uses the server invitation flow;
- change `profile sync` copy from asynchronous regeneration to synchronous public enrichment returning current identity/social/avatar data;
- preserve the existing command syntax.

Use explicit wording:

```md
index profile sync                  # Enrich your profile now and return the resolved identity
index network create "My Network"  # Create directly when eligible; otherwise submit an early-access request
index network invite <id> user@email # Invite directly by email
```

- [ ] **Step 2: Update normative CLI reference flows**

In `docs/specs/cli-reference.md`, update the Profile and Network sections:

- Profile sync calls `POST /api/enrichment/enrich` once and returns `{ enriched, profile }`.
- Network create documents the tagged direct-create/request outcomes and exact fallback restriction.
- Network invite documents `POST /api/networks/:id/members/invite` with `{ email }`.
- Intent update names `description`, not `newDescription`.
- Opportunity rejection documents REST `PATCH /api/opportunities/:id/status`, not the direct tool.

- [ ] **Step 3: Run documentation/help checks**

Run:

```bash
cd packages/cli
bun test tests/help-output.spec.ts
cd ../..
rg -n 'newDescription|update_opportunity.*rejected|read_user_profiles|create_user_profile|update_user_profile' packages/cli/README.md docs/specs/cli-reference.md
```

Expected: help test PASS and the stale-contract search returns no matches.

- [ ] **Step 4: Commit documentation**

```bash
git add packages/cli/README.md docs/specs/cli-reference.md
git commit -m "docs(cli): document current backend flows"
```

---

### Task 6: Full Validation

**Files:**
- Inspect: every file changed by Tasks 1-5

**Interfaces:**
- Consumes: completed compatibility implementation and documentation.
- Produces: complete validation evidence for the parent-run whole-branch review.

- [ ] **Step 1: Run static and focused inventory checks**

Run:

```bash
cd packages/cli
bun run lint
! rg -n 'read_user_profiles|create_user_profile|update_user_profile|newDescription|callTool\("update_opportunity"' src
cd ../..
bun run check:subtree-parity
git diff --check origin/dev...HEAD
```

Expected: all commands exit 0.

- [ ] **Step 2: Run the complete CLI suite**

Run:

```bash
cd packages/cli
bun test
```

Expected: 0 failures across all CLI test files.

- [ ] **Step 3: Build all platform artifacts and prove tracked files remain stable**

Capture tracked manifest hashes, build, and compare:

```bash
cd ../..
BEFORE=$(git hash-object packages/cli/package.json packages/cli/npm/*/package.json | sha256sum)
cd packages/cli
bun run build
cd ../..
AFTER=$(git hash-object packages/cli/package.json packages/cli/npm/*/package.json | sha256sum)
test "$BEFORE" = "$AFTER"
git status --short
```

Expected: build exits 0, hashes match, and status shows only intended source/documentation changes or ignored generated binaries.

- [ ] **Step 4: Validate package publication without publishing**

Run:

```bash
cd packages/cli
bun scripts/publish.ts --dry-run
```

Expected: all four platform packages and `@indexnetwork/cli` validate successfully for `0.13.2`; no registry mutation occurs.

- [ ] **Step 5: Record the validation handoff**

Write the exact commands, exit codes, test counts, build result, publish dry-run result, and residual risks to the task report. Do not remove planning artifacts or launch reviewers from the implementation worker.

---

## Parent Closeout After Task 6

After Task 6 passes its task review, the parent orchestrator must:

1. Generate the whole-branch review package and dispatch the required fresh-context final reviewer.
2. Send any Critical/Important findings through one TDD fix worker and one scoped re-review.
3. After the review is clean, remove the completed design and plan artifacts:

```bash
git rm docs/superpowers/specs/2026-08-07-cli-contract-compatibility-design.md
git rm docs/superpowers/plans/2026-08-07-cli-contract-compatibility.md
git commit -m "chore: remove completed CLI planning artifacts"
```

4. Re-run final affected checks after cleanup:

```bash
cd packages/cli
bun run lint
bun test
cd ../..
bun run check:subtree-parity
git diff --check origin/dev...HEAD
git status --short --branch
```

Expected: all checks pass; branch is ahead of `origin/dev`; no unstaged or staged files remain.
