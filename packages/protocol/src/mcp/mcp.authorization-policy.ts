import { z } from 'zod';

import type { McpResolvedIdentity } from '../shared/schemas/mcp-auth.schema.js';
import { McpActivityCallerSchema } from '../shared/agent/activity-projection.js';
import type { McpActivityCaller } from '../shared/agent/activity-projection.js';

/** Canonical MCP permission actions. */
export const MCP_PERMISSION_ACTIONS = [
  'manage:identity',
  'manage:premises',
  'manage:intents',
  'manage:networks',
  'manage:opportunities',
  'manage:negotiations',
] as const;

export const McpPermissionActionSchema = z.enum(MCP_PERMISSION_ACTIONS);
export type McpPermissionAction = z.infer<typeof McpPermissionActionSchema>;

export const McpToolPermissionRequirementSchema = z.object({
  action: McpPermissionActionSchema,
  /**
   * Capability reach only. Entity ownership, membership, approval, and exact
   * scope checks remain in the capability handler.
   */
  reach: z.enum(['principal', 'network']).default('principal'),
}).strict();

export type McpToolPermissionRequirement = z.infer<typeof McpToolPermissionRequirementSchema>;

const McpToolPermissionMapSchema = z.record(
  z.string().min(1),
  McpToolPermissionRequirementSchema,
);

export type McpToolPermissionMap = ReadonlyMap<string, McpToolPermissionRequirement>;

/**
 * Runtime-validates a capability-owned tool-to-permission mapping.
 */
export function defineMcpToolPermissionMap(
  mapping: Readonly<Record<string, McpToolPermissionRequirement>>,
): McpToolPermissionMap {
  const parsed = McpToolPermissionMapSchema.parse(mapping);
  return new Map(Object.entries(parsed));
}

export const McpToolAccessRuleSchema = z.object({
  access: z.enum([
    'permission',
    'authenticated',
    'human_only',
    'agent_admin',
    'informational',
    'delivery_only',
    'removed',
  ]),
  actions: z.array(McpPermissionActionSchema).optional(),
  reach: z.enum(['principal', 'network']),
}).strict().superRefine((rule, ctx) => {
  if (rule.access === 'permission' && (!rule.actions || rule.actions.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['actions'],
      message: 'Permission rules require at least one action.',
    });
  }
  if (rule.access !== 'permission' && rule.actions !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['actions'],
      message: 'Only permission rules may declare actions.',
    });
  }
});

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
 * Every tool registered by `createToolRegistry` is classified. Tool handlers
 * retain domain ownership, membership, exact-scope, and approval checks.
 */
export const CANONICAL_MCP_TOOL_ACCESS_RULES = defineMcpToolAccessRules({
  // Participant identity/context.
  read_user_contexts: { access: 'permission', actions: ['manage:identity'], reach: 'principal' },
  preview_user_context: { access: 'permission', actions: ['manage:identity'], reach: 'principal' },
  confirm_user_context: { access: 'permission', actions: ['manage:identity'], reach: 'principal' },
  create_user_context: { access: 'permission', actions: ['manage:identity'], reach: 'principal' },
  update_user_context: { access: 'permission', actions: ['manage:identity'], reach: 'principal' },
  get_enrichment_run: { access: 'permission', actions: ['manage:identity'], reach: 'principal' },
  cancel_enrichment_run: { access: 'permission', actions: ['manage:identity'], reach: 'principal' },
  record_onboarding_privacy_consent: { access: 'human_only', reach: 'principal' },
  complete_onboarding: { access: 'human_only', reach: 'principal' },

  // Premises are meta-network; a network-scoped agent retains principal reach.
  read_premises: { access: 'permission', actions: ['manage:premises'], reach: 'principal' },
  create_premise: { access: 'permission', actions: ['manage:premises'], reach: 'principal' },
  update_premise: { access: 'permission', actions: ['manage:premises'], reach: 'principal' },
  retract_premise: { access: 'permission', actions: ['manage:premises'], reach: 'principal' },

  // Signals.
  read_intents: { access: 'authenticated', reach: 'network' },
  search_intents: { access: 'authenticated', reach: 'network' },
  create_intent: { access: 'permission', actions: ['manage:intents'], reach: 'network' },
  update_intent: { access: 'permission', actions: ['manage:intents'], reach: 'network' },
  delete_intent: { access: 'permission', actions: ['manage:intents'], reach: 'network' },
  read_intent_indexes: { access: 'authenticated', reach: 'network' },
  create_intent_index: { access: 'permission', actions: ['manage:intents'], reach: 'network' },
  delete_intent_index: { access: 'permission', actions: ['manage:intents'], reach: 'network' },

  // Question tools inherit the exact affected object's permission in-handler.
  read_pending_questions: {
    access: 'permission',
    actions: [
      'manage:identity',
      'manage:premises',
      'manage:intents',
      'manage:opportunities',
      'manage:negotiations',
    ],
    reach: 'principal',
  },
  answer_pending_question: {
    access: 'permission',
    actions: [
      'manage:identity',
      'manage:premises',
      'manage:intents',
      'manage:opportunities',
      'manage:negotiations',
    ],
    reach: 'principal',
  },

  // Communities.
  read_networks: { access: 'authenticated', reach: 'network' },
  read_network_memberships: { access: 'authenticated', reach: 'network' },
  create_network: { access: 'permission', actions: ['manage:networks'], reach: 'network' },
  update_network: { access: 'permission', actions: ['manage:networks'], reach: 'network' },
  delete_network: { access: 'human_only', reach: 'network' },
  create_network_membership: { access: 'permission', actions: ['manage:networks'], reach: 'network' },
  delete_network_membership: { access: 'permission', actions: ['manage:networks'], reach: 'network' },

  // Opportunities and delivery.
  list_opportunities: { access: 'authenticated', reach: 'network' },
  discover_opportunities: { access: 'permission', actions: ['manage:opportunities'], reach: 'network' },
  get_discovery_run: { access: 'permission', actions: ['manage:opportunities'], reach: 'network' },
  cancel_discovery_run: { access: 'permission', actions: ['manage:opportunities'], reach: 'network' },
  update_opportunity: { access: 'permission', actions: ['manage:opportunities'], reach: 'network' },
  confirm_opportunity_delivery: { access: 'delivery_only', reach: 'network' },

  // A2A negotiations.
  list_negotiations: { access: 'permission', actions: ['manage:negotiations'], reach: 'network' },
  get_negotiation: { access: 'permission', actions: ['manage:negotiations'], reach: 'network' },
  respond_to_negotiation: { access: 'permission', actions: ['manage:negotiations'], reach: 'network' },

  // H2A chat history.
  list_conversations: { access: 'human_only', reach: 'principal' },
  get_conversation: { access: 'human_only', reach: 'principal' },

  // Agent administration.
  read_own_agent: { access: 'agent_admin', reach: 'principal' },
  register_agent: { access: 'agent_admin', reach: 'principal' },
  list_agents: { access: 'agent_admin', reach: 'principal' },
  update_agent: { access: 'agent_admin', reach: 'principal' },
  delete_agent: { access: 'agent_admin', reach: 'principal' },
  grant_agent_permission: { access: 'agent_admin', reach: 'principal' },
  revoke_agent_permission: { access: 'agent_admin', reach: 'principal' },

  // Protocol guidance.
  read_docs: { access: 'informational', reach: 'principal' },

  // Aggregate activity reporting. Any activity-domain permission admits the
  // call; the handler then projects each domain by the caller's exact grants
  // via the centralized activity projection, and a network agent's
  // network-bound aggregates are narrowed to its bound community at the
  // query/adapter layer.
  read_activity_summary: {
    access: 'permission',
    actions: [
      'manage:identity',
      'manage:premises',
      'manage:intents',
      'manage:opportunities',
      'manage:negotiations',
    ],
    reach: 'principal',
  },

  // Restricted MCP surface still registered by the shared registry. The contact
  // and Gmail-import tools, scrape_url, the deprecated profile/profile-run
  // aliases, and the retired report_agent_activity name are no longer
  // classified here because they are omitted from the MCP registry composition
  // entirely (IND-596/597/598/605) — an unregistered tool is rejected as
  // unknown before any authorization work. read_activity_summary (above) is
  // the only public activity-reporting name; no legacy alias is retained.
});

/** Tools visible while a session-authenticated human completes onboarding. */
export const ONBOARDING_ALLOWED: ReadonlySet<string> = new Set([
  'register_agent',
  'read_docs',
  'record_onboarding_privacy_consent',
  'preview_user_context',
  'get_enrichment_run',
  'cancel_enrichment_run',
  'confirm_user_context',
  'create_user_context',
  'read_user_contexts',
  'complete_onboarding',
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
  'grant_agent_permission',
  'revoke_agent_permission',
]);

/** Informational inventory retained as a convenience export. */
export const MCP_INFORMATIONAL_TOOLS: ReadonlySet<string> = new Set([
  'read_docs',
]);

const McpPolicyAgentPermissionSchema = z.object({
  agentId: z.string().min(1),
  userId: z.string().min(1),
  scope: z.enum(['global', 'node', 'network']),
  scopeId: z.string().min(1).nullable(),
  actions: z.array(z.string()),
}).strict();

export const McpPolicyAgentSnapshotSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  type: z.enum(['personal', 'external', 'system']),
  status: z.enum(['active', 'inactive']),
  permissions: z.array(McpPolicyAgentPermissionSchema),
}).strict();

export type McpPolicyAgentSnapshot = z.infer<typeof McpPolicyAgentSnapshotSchema>;

export const McpPrincipalProfileSchema = z.enum([
  'session_human',
  'onboarding_human',
  'enrollment_key',
  'unregistered_key',
  'registered_global_agent',
  'registered_network_agent',
  'delivery_agent',
  'invalid_agent',
]);

export type McpPrincipalProfile = z.infer<typeof McpPrincipalProfileSchema>;

export const McpCapabilitySubjectSchema = z.object({
  profile: McpPrincipalProfileSchema,
  userId: z.string().min(1),
  agentId: z.string().min(1).optional(),
  agentType: z.enum(['personal', 'external', 'system']).optional(),
  isOnboarding: z.boolean(),
  networkScopeId: z.string().min(1).nullable(),
  permissions: z.array(McpPermissionActionSchema),
}).strict();

export type McpCapabilitySubject = z.infer<typeof McpCapabilitySubjectSchema>;

export type ResolveMcpCapabilitySubjectInput = {
  identity: McpResolvedIdentity;
  isOnboarding: boolean;
  agent?: McpPolicyAgentSnapshot | null;
};

/**
 * Retired durable grant actions and the canonical capabilities each projects to
 * at the permission-loading boundary. TEMPORARY rolling-data compatibility
 * (IND-607): while a mixed-version fleet is live, old replicas (current `dev`)
 * still WRITE `manage:profile` / `manage:contacts` rows AFTER the pre-deploy
 * `0109` migration runs, and un-migrated rows may also remain. The new runtime
 * must therefore interpret these residual STORED rows so no agent loses access
 * during the rolling window and none is over-authorized:
 *
 *   - `manage:profile`  -> `manage:identity` + `manage:premises`
 *   - `manage:contacts` -> (no capability)
 *
 * This is NOT a public alias: the legacy names are never accepted as INPUT
 * (grant validation and tool schemas are canonical-only) and never surfaced in
 * documentation or `tools/list`. They are tolerated ONLY as pre-existing stored
 * data, and only until the post-drain final sweep sets `retired_remaining = 0`
 * and the compatibility-removal gate is met (see the IND-609 rollout doc).
 */
const LEGACY_STORED_ACTION_PROJECTION: Readonly<Record<string, readonly McpPermissionAction[]>> = {
  'manage:profile': ['manage:identity', 'manage:premises'],
  'manage:contacts': [],
};

/**
 * Central capability-loading interpretation of a stored permission row's raw
 * actions. Canonical actions pass through; retired actions project per
 * {@link LEGACY_STORED_ACTION_PROJECTION}; every unknown action fails closed
 * (ignored). Owner/scope matching is applied by the caller BEFORE this runs, so
 * this function never widens the scope a grant applies to.
 */
export function projectStoredPermissionActions(
  actions: readonly string[],
): McpPermissionAction[] {
  const granted = new Set<McpPermissionAction>();
  for (const action of actions) {
    const projected = LEGACY_STORED_ACTION_PROJECTION[action];
    if (projected !== undefined) {
      for (const capability of projected) granted.add(capability);
      continue;
    }
    const parsed = McpPermissionActionSchema.safeParse(action);
    if (parsed.success) granted.add(parsed.data);
    // Unknown actions are ignored — fail closed.
  }
  return [...granted];
}

function resolveAgentPermissions(
  identity: McpResolvedIdentity,
  agent: McpPolicyAgentSnapshot,
): McpPermissionAction[] {
  const granted = new Set<McpPermissionAction>();
  for (const permission of agent.permissions) {
    if (permission.agentId !== identity.agentId || permission.userId !== identity.userId) continue;

    const scopeApplies =
      permission.scope === 'global' ||
      (
        permission.scope === 'network' &&
        identity.networkScopeId !== null &&
        identity.networkScopeId !== undefined &&
        permission.scopeId === identity.networkScopeId
      );
    if (!scopeApplies) continue;

    // Canonical-only going forward, plus temporary interpretation of residual
    // legacy stored rows during the mixed-version rolling window.
    for (const action of projectStoredPermissionActions(permission.actions)) {
      granted.add(action);
    }
  }
  return [...granted];
}

/**
 * Resolves a request-local, runtime-validated principal profile.
 */
export function resolveMcpCapabilitySubject(
  input: ResolveMcpCapabilitySubjectInput,
): McpCapabilitySubject {
  const { identity, isOnboarding } = input;

  if (identity.isSessionAuth === true) {
    return McpCapabilitySubjectSchema.parse({
      profile: isOnboarding ? 'onboarding_human' : 'session_human',
      userId: identity.userId,
      isOnboarding,
      networkScopeId: null,
      permissions: [],
    });
  }

  if (!identity.agentId) {
    return McpCapabilitySubjectSchema.parse({
      profile: identity.enrollmentCapable === true ? 'enrollment_key' : 'unregistered_key',
      userId: identity.userId,
      isOnboarding,
      networkScopeId: null,
      permissions: [],
    });
  }

  const parsedAgent = McpPolicyAgentSnapshotSchema.safeParse(input.agent);
  if (
    !parsedAgent.success ||
    parsedAgent.data.id !== identity.agentId ||
    parsedAgent.data.ownerId !== identity.userId ||
    parsedAgent.data.status !== 'active'
  ) {
    return McpCapabilitySubjectSchema.parse({
      profile: 'invalid_agent',
      userId: identity.userId,
      agentId: identity.agentId,
      isOnboarding,
      networkScopeId: identity.networkScopeId ?? null,
      permissions: [],
    });
  }

  const agent = parsedAgent.data;
  const profile: McpPrincipalProfile = identity.isDeliveryAgent === true
    ? 'delivery_agent'
    : identity.networkScopeId
      ? 'registered_network_agent'
      : 'registered_global_agent';

  return McpCapabilitySubjectSchema.parse({
    profile,
    userId: identity.userId,
    agentId: identity.agentId,
    agentType: agent.type,
    isOnboarding,
    networkScopeId: identity.networkScopeId ?? null,
    permissions: resolveAgentPermissions(identity, agent),
  });
}

/**
 * Maps a resolved capability subject to the typed caller context consumed by
 * the centralized activity-summary projection. Session and onboarding humans
 * own the summarized data and receive the full owner view; every other
 * profile is projected as an agent bounded by its granted permissions and
 * (for network agents) its bound community.
 */
export function resolveMcpActivityCaller(subject: McpCapabilitySubject): McpActivityCaller {
  const isHuman = subject.profile === 'session_human' || subject.profile === 'onboarding_human';
  return McpActivityCallerSchema.parse({
    kind: isHuman ? 'human' : 'agent',
    permissions: isHuman ? [] : subject.permissions,
    networkScopeId: isHuman ? null : subject.networkScopeId,
  });
}

export const McpCapabilityDecisionReasonSchema = z.enum([
  'session_human',
  'onboarding',
  'enrollment',
  'authenticated',
  'agent_self_read',
  'informational',
  'permission_granted',
  'delivery',
  'onboarding_required',
  'enrollment_required',
  'unregistered_principal',
  'invalid_agent',
  'agent_admin_denied',
  'human_read_own_agent_denied',
  'human_only',
  'permission_missing',
  'delivery_required',
  'removed',
  'tool_unclassified',
]);

export type McpCapabilityDecision = {
  allowed: boolean;
  reason: z.infer<typeof McpCapabilityDecisionReasonSchema>;
  reach?: 'principal' | 'network';
  requiredPermissions?: McpPermissionAction[];
};

export type McpCapabilityDecisionReason = z.infer<typeof McpCapabilityDecisionReasonSchema>;

/**
 * Safe, host-facing description of a single authorization denial. It carries
 * ONLY the caller profile, the tool, and the policy reason/reach — never a
 * token, API key, bearer credential, raw header, or tool-argument payload.
 * `userId`/`agentId`/`networkScopeId` are opaque principal identifiers, not
 * secrets. Constructed centrally in {@link buildMcpAuthorizationDenialEvent}
 * so no call site can widen it with sensitive fields.
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
  /** Capability reach of the tool rule, when the rule was found. */
  reach?: 'principal' | 'network';
  /** The any-of permissions the tool required, when applicable. */
  requiredPermissions?: McpPermissionAction[];
  /** Opaque owning-user identifier. */
  userId: string;
  /** Opaque agent identifier, present only for agent principals. */
  agentId?: string;
  /** Bound network scope for network agents; null otherwise. */
  networkScopeId: string | null;
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
 * granted permissions, credentials, headers, and tool arguments are never
 * included.
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
    ...(decision.reach ? { reach: decision.reach } : {}),
    ...(decision.requiredPermissions && decision.requiredPermissions.length > 0
      ? { requiredPermissions: [...decision.requiredPermissions] }
      : {}),
    userId: subject.userId,
    ...(subject.agentId ? { agentId: subject.agentId } : {}),
    networkScopeId: subject.networkScopeId,
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
   */
  authorize(subject: McpCapabilitySubject, toolName: string): McpCapabilityDecision {
    const rule = this.toolRules.get(toolName);
    if (!rule) return { allowed: false, reason: 'tool_unclassified' };
    if (rule.access === 'removed') {
      return { allowed: false, reason: 'removed', reach: rule.reach };
    }
    if (subject.profile === 'invalid_agent') {
      return { allowed: false, reason: 'invalid_agent', reach: rule.reach };
    }
    if (subject.profile === 'unregistered_key') {
      return { allowed: false, reason: 'unregistered_principal', reach: rule.reach };
    }
    if (subject.profile === 'enrollment_key') {
      return toolName === 'register_agent'
        ? { allowed: true, reason: 'enrollment', reach: rule.reach }
        : { allowed: false, reason: 'enrollment_required', reach: rule.reach };
    }
    if (subject.isOnboarding && !ONBOARDING_ALLOWED.has(toolName)) {
      return { allowed: false, reason: 'onboarding_required', reach: rule.reach };
    }
    if (rule.access === 'delivery_only') {
      return subject.profile === 'delivery_agent'
        ? { allowed: true, reason: 'delivery', reach: rule.reach }
        : { allowed: false, reason: 'delivery_required', reach: rule.reach };
    }
    // Agent administration is split by principal kind and must be decided
    // BEFORE the generic session-human blanket allow below — otherwise a
    // session human would be admitted to read_own_agent (an agent-only tool)
    // by the blanket allow before this rule is ever reached (IND-599).
    if (rule.access === 'agent_admin') {
      // read_own_agent is the ONLY agent_admin tool available to a registered
      // active agent, and it returns that agent's own record (no target). Every
      // other agent_admin tool is an owner/admin action reserved for humans.
      if (
        subject.profile === 'registered_global_agent' ||
        subject.profile === 'registered_network_agent' ||
        subject.profile === 'delivery_agent'
      ) {
        return toolName === 'read_own_agent'
          ? { allowed: true, reason: 'agent_self_read', reach: rule.reach }
          : { allowed: false, reason: 'agent_admin_denied', reach: rule.reach };
      }
      // Session/onboarding humans get every agent_admin tool EXCEPT
      // read_own_agent, which is reserved for agent principals.
      if (subject.profile === 'session_human' || subject.profile === 'onboarding_human') {
        return toolName === 'read_own_agent'
          ? { allowed: false, reason: 'human_read_own_agent_denied', reach: rule.reach }
          : {
              allowed: true,
              reason: subject.profile === 'onboarding_human' ? 'onboarding' : 'session_human',
              reach: rule.reach,
            };
      }
      // Every other profile (enrollment/unregistered/invalid) is handled above
      // and never reaches here; fail closed for completeness.
      return { allowed: false, reason: 'agent_admin_denied', reach: rule.reach };
    }
    if (subject.profile === 'session_human' || subject.profile === 'onboarding_human') {
      return {
        allowed: true,
        reason: subject.profile === 'onboarding_human' ? 'onboarding' : 'session_human',
        reach: rule.reach,
      };
    }
    if (rule.access === 'human_only') {
      return { allowed: false, reason: 'human_only', reach: rule.reach };
    }
    if (rule.access === 'informational') {
      return { allowed: true, reason: 'informational', reach: rule.reach };
    }
    if (rule.access === 'authenticated') {
      return { allowed: true, reason: 'authenticated', reach: rule.reach };
    }

    const requiredPermissions = rule.actions ?? [];
    return requiredPermissions.some((action) => subject.permissions.includes(action))
      ? {
          allowed: true,
          reason: 'permission_granted',
          reach: rule.reach,
          requiredPermissions,
        }
      : {
          allowed: false,
          reason: 'permission_missing',
          reach: rule.reach,
          requiredPermissions,
        };
  }

  /**
   * Filters a static inventory and returns a fresh, uncached caller list.
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
