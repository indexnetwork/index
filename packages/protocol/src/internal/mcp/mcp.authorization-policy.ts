import { z } from 'zod';

import type { McpResolvedIdentity } from '../../platform/auth/mcp.js';

export const McpToolAccessRuleSchema = z.object({
  access: z.enum([
    'authenticated',
    'human_only',
    'agent_admin',
    'removed',
  ]),
}).strict();

export type McpToolAccessRule = z.infer<typeof McpToolAccessRuleSchema>;

const McpToolAccessRuleMapSchema = z.record(
  z.string().min(1),
  McpToolAccessRuleSchema,
);

export type McpToolAccessRuleMap = ReadonlyMap<string, McpToolAccessRule>;

/** Runtime-validates a complete static MCP tool access matrix. */
export function defineMcpToolAccessRules(
  rules: Readonly<Record<string, McpToolAccessRule>>,
): McpToolAccessRuleMap {
  const parsed = McpToolAccessRuleMapSchema.parse(rules);
  return new Map(Object.entries(parsed));
}

/**
 * Canonical MCP tool authorization matrix.
 *
 * A credential names a user, so an API key reaches the same product surface its
 * owner does. Only two things are walled off from a key: owner verdicts and
 * destructive/administrative levers a leaked key must never pull
 * (`human_only`), and agent administration (`agent_admin`). Tool handlers
 * retain domain ownership, membership, and approval checks.
 */
export const CANONICAL_MCP_TOOL_ACCESS_RULES = defineMcpToolAccessRules({
  // Participant identity.
  research_profile: { access: 'authenticated' },

  // Signals.
  read_intents: { access: 'authenticated' },
  search_intents: { access: 'authenticated' },
  create_intent: { access: 'authenticated' },
  update_intent: { access: 'authenticated' },
  delete_intent: { access: 'authenticated' },
  list_intent_networks: { access: 'authenticated' },
  add_intent_to_network: { access: 'authenticated' },
  remove_intent_from_network: { access: 'authenticated' },

  // Communities.
  read_networks: { access: 'authenticated' },
  read_network_memberships: { access: 'authenticated' },
  create_network: { access: 'authenticated' },
  update_network: { access: 'authenticated' },
  delete_network: { access: 'human_only' },
  create_network_membership: { access: 'authenticated' },
  delete_network_membership: { access: 'authenticated' },

  // Opportunities.
  list_opportunities: { access: 'authenticated' },
  update_opportunity: { access: 'authenticated' },

  // The owner VERDICT tools are `human_only` — exactly the session-authenticated
  // class the IND-593 owner-provenance binding admits; an API-key caller must
  // never gain an owner-verdict lever.
  reject_opportunity: { access: 'human_only' },
  accept_opportunity: { access: 'human_only' },

  // Agent administration. Registering, updating and deleting agents — and
  // choosing the negotiator — are owner actions. `read_own_agent` is the
  // mirror image: it resolves the owner's selected negotiator, which only a
  // running agent needs.
  read_own_agent: { access: 'agent_admin' },
  register_agent: { access: 'agent_admin' },
  list_agents: { access: 'agent_admin' },
  update_agent: { access: 'agent_admin' },
  delete_agent: { access: 'agent_admin' },

  // Protocol guidance.
  read_docs: { access: 'authenticated' },
});

/** Tools visible on the REST Tool API while web/CLI onboarding is incomplete. MCP does not use this allowlist. */
export const ONBOARDING_ALLOWED: ReadonlySet<string> = new Set([
  'register_agent',
  'read_docs',
  'research_profile',
  'read_networks',
  'create_network_membership',
  'create_intent',
]);

/** Agent administration inventory. */
export const MCP_AGENT_ADMIN_TOOLS: ReadonlySet<string> = new Set([
  'read_own_agent',
  'register_agent',
  'list_agents',
  'update_agent',
  'delete_agent',
]);

export const McpPrincipalProfileSchema = z.enum([
  'session_human',
  'api_key',
]);

export type McpPrincipalProfile = z.infer<typeof McpPrincipalProfileSchema>;

export const McpCapabilitySubjectSchema = z.object({
  profile: McpPrincipalProfileSchema,
  userId: z.string().min(1),
}).strict();

export type McpCapabilitySubject = z.infer<typeof McpCapabilitySubjectSchema>;

/**
 * Resolves a request-local, runtime-validated principal profile. The only
 * distinction that survives is how the caller authenticated: a browser session
 * is the owner acting in person, anything else is one of their keys.
 *
 * @param identity - The identity the host's auth resolver produced.
 * @returns The validated capability subject.
 */
export function resolveMcpCapabilitySubject(
  identity: McpResolvedIdentity,
): McpCapabilitySubject {
  return McpCapabilitySubjectSchema.parse({
    profile: identity.isSessionAuth === true ? 'session_human' : 'api_key',
    userId: identity.userId,
  });
}

export const McpCapabilityDecisionReasonSchema = z.enum([
  'session_human',
  'authenticated',
  'agent_self_read',
  'agent_admin_denied',
  'human_read_own_agent_denied',
  'human_only',
  'removed',
  'tool_unclassified',
]);

export type McpCapabilityDecision = {
  allowed: boolean;
  reason: z.infer<typeof McpCapabilityDecisionReasonSchema>;
};

export type McpCapabilityDecisionReason = z.infer<typeof McpCapabilityDecisionReasonSchema>;

/**
 * Safe, host-facing description of a single authorization denial. It carries
 * ONLY the caller profile, the tool, and the policy reason — never a token,
 * API key, bearer credential, raw header, or tool-argument payload. `userId` is
 * an opaque principal identifier, not a secret. Constructed centrally in
 * {@link buildMcpAuthorizationDenialEvent} so no call site can widen it with
 * sensitive fields.
 */
export type McpAuthorizationDenialEvent = {
  /** Which JSON-RPC boundary produced the denial. */
  phase: 'tools/call' | 'tools/list';
  /** The classified tool the caller attempted. */
  toolName: string;
  /** The resolved principal profile (never the credential that produced it). */
  profile: McpPrincipalProfile;
  /** The policy decision reason. */
  reason: McpCapabilityDecisionReason;
  /** Opaque owning-user identifier. */
  userId: string;
};

/**
 * Host-injected authorization observability seam. The protocol emits
 * structured, secret-free denial events at the host boundary; the host decides
 * how to record them. Implementations MUST NOT throw affect the decision — the
 * server calls this defensively and ignores observer failures (fail-closed is
 * preserved regardless).
 */
export interface McpAuthorizationObserver {
  onCapabilityDenied(event: McpAuthorizationDenialEvent): void;
}

/**
 * Builds a safe denial event from a resolved subject and a denial decision.
 * Only whitelisted, non-sensitive fields are copied across; the caller's
 * credentials, headers, and tool arguments are never included.
 *
 * @param input - Boundary phase, tool, resolved subject and denial decision.
 * @returns The secret-free denial event.
 */
export function buildMcpAuthorizationDenialEvent(input: {
  phase: 'tools/call' | 'tools/list';
  toolName: string;
  subject: McpCapabilitySubject;
  decision: McpCapabilityDecision;
}): McpAuthorizationDenialEvent {
  const { phase, toolName, subject, decision } = input;
  return {
    phase,
    toolName,
    profile: subject.profile,
    reason: decision.reason,
    userId: subject.userId,
  };
}

export type McpCapabilityPolicyOptions = {
  /** Complete static rule map; defaults to the canonical production matrix. */
  toolRules?: McpToolAccessRuleMap;
};

/**
 * Reusable MCP capability policy. It stores static rules only; caller-specific
 * subjects and decisions are never retained.
 */
export class McpCapabilityPolicy {
  private readonly toolRules: McpToolAccessRuleMap;

  constructor(options: McpCapabilityPolicyOptions = {}) {
    const parsedRules = McpToolAccessRuleMapSchema.parse(
      Object.fromEntries(options.toolRules ?? CANONICAL_MCP_TOOL_ACCESS_RULES),
    );
    this.toolRules = new Map(Object.entries(parsedRules));
  }

  /**
   * Decides whether a resolved caller may use one classified tool.
   *
   * @param subject - The resolved caller.
   * @param toolName - The tool being attempted.
   * @returns Allow/deny plus the policy reason.
   */
  authorize(subject: McpCapabilitySubject, toolName: string): McpCapabilityDecision {
    const rule = this.toolRules.get(toolName);
    if (!rule) return { allowed: false, reason: 'tool_unclassified' };
    if (rule.access === 'removed') {
      return { allowed: false, reason: 'removed' };
    }

    // Agent administration is split by principal kind and must be decided
    // BEFORE the generic session-human blanket allow below — otherwise a
    // session human would be admitted to read_own_agent (an agent-only tool)
    // by the blanket allow before this rule is ever reached (IND-599).
    if (rule.access === 'agent_admin') {
      if (subject.profile === 'session_human') {
        return toolName === 'read_own_agent'
          ? { allowed: false, reason: 'human_read_own_agent_denied' }
          : { allowed: true, reason: 'session_human' };
      }
      return toolName === 'read_own_agent'
        ? { allowed: true, reason: 'agent_self_read' }
        : { allowed: false, reason: 'agent_admin_denied' };
    }
    if (subject.profile === 'session_human') {
      return { allowed: true, reason: 'session_human' };
    }
    if (rule.access === 'human_only') {
      return { allowed: false, reason: 'human_only' };
    }
    return { allowed: true, reason: 'authenticated' };
  }

  /**
   * Filters a static inventory and returns a fresh, uncached caller list.
   *
   * @param subject - The resolved caller.
   * @param toolNames - Static tool inventory.
   * @returns The tools this caller may use.
   */
  visibleToolNames(subject: McpCapabilitySubject, toolNames: readonly string[]): string[] {
    return toolNames.filter((toolName) => this.authorize(subject, toolName).allowed);
  }

  /** Returns the static classification for inventory tests and host composition. */
  ruleFor(toolName: string): McpToolAccessRule | undefined {
    return this.toolRules.get(toolName);
  }
}

/** Canonical production options explicitly passed by the host composition. */
export const CANONICAL_MCP_CAPABILITY_POLICY_OPTIONS: McpCapabilityPolicyOptions = {
  toolRules: CANONICAL_MCP_TOOL_ACCESS_RULES,
};
