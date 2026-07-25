import { z } from 'zod';

import type { McpResolvedIdentity } from '../shared/schemas/mcp-auth.schema.js';

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
  register_agent: { access: 'agent_admin', reach: 'principal' },
  list_agents: { access: 'agent_admin', reach: 'principal' },
  update_agent: { access: 'agent_admin', reach: 'principal' },
  delete_agent: { access: 'agent_admin', reach: 'principal' },
  grant_agent_permission: { access: 'agent_admin', reach: 'principal' },
  revoke_agent_permission: { access: 'agent_admin', reach: 'principal' },

  // Protocol guidance.
  read_docs: { access: 'informational', reach: 'principal' },

  // Restricted MCP surface still registered by the shared registry. The contact
  // and Gmail-import tools, scrape_url, and the deprecated profile/profile-run
  // aliases are no longer classified here because they are omitted from the MCP
  // registry composition entirely (IND-596/597/598) — an unregistered tool is
  // rejected as unknown before any authorization work. report_agent_activity
  // remains registered on the MCP surface and stays denied via 'removed' until
  // its owning sibling removes its registry exposure.
  report_agent_activity: { access: 'removed', reach: 'principal' },
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

    for (const action of permission.actions) {
      const parsed = McpPermissionActionSchema.safeParse(action);
      if (parsed.success) granted.add(parsed.data);
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
    if (rule.access === 'agent_admin') {
      return toolName === 'list_agents'
        ? { allowed: true, reason: 'agent_self_read', reach: rule.reach }
        : { allowed: false, reason: 'agent_admin_denied', reach: rule.reach };
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
