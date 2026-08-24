import { describe, expect, test } from 'bun:test';

import type { McpResolvedIdentity } from '../../../platform/auth/mcp.js';
import type { McpPolicyAgentSnapshot } from '../mcp.authorization-policy.js';
import { CANONICAL_MCP_TOOL_ACCESS_RULES, HERMES_AGENT_MCP_TOOL_PERMISSIONS, MCP_PERMISSION_ACTIONS, McpCapabilityPolicy, defineMcpToolAccessRules, defineMcpToolPermissionMap, projectStoredPermissionActions, resolveMcpCapabilitySubject } from '../mcp.authorization-policy.js';

const USER_ID = 'user-1';
const AGENT_ID = 'agent-1';
const NETWORK_ID = 'network-1';

function identity(overrides: Partial<McpResolvedIdentity> = {}): McpResolvedIdentity {
  return {
    userId: USER_ID,
    ...overrides,
  };
}

function agentSnapshot(overrides: Partial<McpPolicyAgentSnapshot> = {}): McpPolicyAgentSnapshot {
  return {
    id: AGENT_ID,
    ownerId: USER_ID,
    type: 'external',
    status: 'active',
    permissions: [],
    ...overrides,
  };
}

const policy = new McpCapabilityPolicy();

describe('MCP capability policy principal inventory', () => {
  test('session humans receive classified tools and agent administration, but not removed/unknown tools', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ isSessionAuth: true }),
    });

    expect(subject.profile).toBe('session_human');
    expect(policy.visibleToolNames(subject, [
      'register_agent',
      'list_agents',
      'update_agent',
      'create_intent',
      'confirm_opportunity_delivery',
      'scrape_url',
      'unknown_future_tool',
    ])).toEqual([
      'register_agent',
      'list_agents',
      'update_agent',
      'create_intent',
    ]);
  });

  test('session humans keep the full inventory regardless of web onboarding state', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ isSessionAuth: true }),
    });

    expect(subject.profile).toBe('session_human');
    expect(policy.visibleToolNames(subject, [
      'register_agent',
      'read_networks',
      'create_intent',
      'update_agent',
      'list_opportunities',
    ])).toEqual([
      'register_agent',
      'read_networks',
      'create_intent',
      'update_agent',
      'list_opportunities',
    ]);
  });

  test('only explicitly enrollment-capable unregistered keys can register', () => {
    const enrollmentSubject = resolveMcpCapabilitySubject({
      identity: identity({ enrollmentCapable: true }),
    });
    const ordinaryKeySubject = resolveMcpCapabilitySubject({
      identity: identity(),
    });

    expect(enrollmentSubject.profile).toBe('enrollment_key');
    expect(policy.visibleToolNames(enrollmentSubject, [
      'register_agent',
      'read_docs',
      'create_intent',
    ])).toEqual(['register_agent']);
    expect(ordinaryKeySubject.profile).toBe('unregistered_key');
    expect(policy.visibleToolNames(ordinaryKeySubject, [
      'register_agent',
      'read_docs',
      'create_intent',
    ])).toEqual([]);
  });

  test('registered agents are self-read-only on the administration surface', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID }),
      agent: agentSnapshot({
        permissions: [{
          agentId: AGENT_ID,
          userId: USER_ID,
          scope: 'global',
          scopeId: null,
          actions: ['manage:intents'],
        }],
      }),
    });

    expect(subject.profile).toBe('registered_global_agent');
    // IND-599: a registered agent is self-read-only on the admin surface — it
    // sees read_own_agent (its OWN record), never list_agents or any mutation.
    expect(policy.visibleToolNames(subject, [
      'read_own_agent',
      'register_agent',
      'list_agents',
      'update_agent',
      'delete_agent',
      'grant_agent_permission',
      'revoke_agent_permission',
      'read_intents',
      'create_intent',
    ])).toEqual(['read_own_agent', 'read_intents', 'create_intent']);
  });

  test('network agents honor only matching-scope or global permission rows', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID, networkScopeId: NETWORK_ID }),
      agent: agentSnapshot({
        permissions: [
          {
            agentId: AGENT_ID,
            userId: USER_ID,
            scope: 'network',
            scopeId: NETWORK_ID,
            actions: ['manage:intents'],
          },
          {
            agentId: AGENT_ID,
            userId: USER_ID,
            scope: 'network',
            scopeId: 'another-network',
            actions: ['manage:opportunities'],
          },
          {
            agentId: AGENT_ID,
            userId: USER_ID,
            scope: 'global',
            scopeId: null,
            actions: ['manage:negotiations'],
          },
        ],
      }),
    });

    expect(subject.profile).toBe('registered_network_agent');
    expect(subject.networkScopeId).toBe(NETWORK_ID);
    expect(subject.permissions).toEqual([
      'manage:intents',
      'manage:negotiations',
    ]);
    expect(policy.visibleToolNames(subject, [
      'create_intent',
      'discover_opportunities',
      'respond_to_negotiation',
    ])).toEqual([
      'create_intent',
      'respond_to_negotiation',
    ]);
  });

  test('designated delivery agents add delivery confirmation without losing ordinary permissions', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID, isDeliveryAgent: true }),
      agent: agentSnapshot({
        type: 'personal',
        permissions: [{
          agentId: AGENT_ID,
          userId: USER_ID,
          scope: 'global',
          scopeId: null,
          actions: ['manage:opportunities'],
        }],
      }),
    });

    expect(subject.profile).toBe('delivery_agent');
    // IND-599: a delivery agent is still a registered agent principal — its
    // agent-admin surface is read_own_agent only (not list_agents).
    expect(policy.visibleToolNames(subject, [
      'read_own_agent',
      'read_docs',
      'confirm_opportunity_delivery',
      'discover_opportunities',
    ])).toEqual([
      'read_own_agent',
      'read_docs',
      'confirm_opportunity_delivery',
    ]);
  });

  test('registered personal agents remain ordinary principals unless designated for delivery', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID }),
      agent: agentSnapshot({
        type: 'personal',
        permissions: [{
          agentId: AGENT_ID,
          userId: USER_ID,
          scope: 'global',
          scopeId: null,
          actions: ['manage:opportunities'],
        }],
      }),
    });

    expect(subject.profile).toBe('registered_global_agent');
    expect(subject.agentType).toBe('personal');
    expect(policy.authorize(subject, 'discover_opportunities')).toEqual({
      allowed: false,
      reason: 'tool_unclassified',
    });
    expect(policy.authorize(subject, 'confirm_opportunity_delivery').allowed).toBe(false);
  });

  test('direct discovery names are unclassified and denied', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ isSessionAuth: true }),
    });

    for (const toolName of ['discover_opportunities', 'get_discovery_run', 'cancel_discovery_run', 'complete_onboarding']) {
      expect(CANONICAL_MCP_TOOL_ACCESS_RULES.get(toolName)).toBeUndefined();
      expect(policy.authorize(subject, toolName)).toEqual({
        allowed: false,
        reason: 'tool_unclassified',
      });
    }
  });

  test('missing, inactive, and mismatched agents fail closed', () => {
    const baseIdentity = identity({ agentId: AGENT_ID });
    const subjects = [
      resolveMcpCapabilitySubject({
        identity: baseIdentity,
        agent: null,
      }),
      resolveMcpCapabilitySubject({
        identity: baseIdentity,
        agent: agentSnapshot({ status: 'inactive' }),
      }),
      resolveMcpCapabilitySubject({
        identity: baseIdentity,
        agent: agentSnapshot({ ownerId: 'other-user' }),
      }),
    ];

    for (const subject of subjects) {
      expect(subject.profile).toBe('invalid_agent');
      expect(policy.visibleToolNames(subject, [
        'list_agents',
        'read_docs',
        'create_intent',
      ])).toEqual([]);
    }
  });
});

describe('dedicated Hermes agent MCP profile', () => {
  const exactToolMapping = {
    research_profile: 'manage:identity',
    read_intents: 'manage:intents',
    search_intents: 'manage:intents',
    create_intent: 'manage:intents',
    update_intent: 'manage:intents',
    read_intent_indexes: 'manage:intents',
    create_intent_index: 'manage:intents',
    list_negotiations: 'manage:negotiations',
    get_negotiation: 'manage:negotiations',
    respond_to_negotiation: 'manage:negotiations',
    read_networks: 'manage:networks',
    read_network_memberships: 'manage:networks',
    create_network: 'manage:networks',
    update_network: 'manage:networks',
    create_network_membership: 'manage:networks',
    list_opportunities: 'manage:opportunities',
    update_opportunity: 'manage:opportunities',
    confirm_opportunity_delivery: 'manage:opportunities',
    read_premises: 'manage:premises',
    create_premise: 'manage:premises',
    update_premise: 'manage:premises',
    retract_premise: 'manage:premises',
    read_activity_summary: 'manage:identity',
    read_docs: 'manage:identity',
  } as const;

  test('freezes one canonical action for every exposed Hermes MCP tool', () => {
    expect(Object.fromEntries(
      [...HERMES_AGENT_MCP_TOOL_PERMISSIONS].map(([toolName, requirement]) => [toolName, requirement.action]),
    )).toEqual(exactToolMapping);
    for (const requirement of HERMES_AGENT_MCP_TOOL_PERMISSIONS.values()) {
      expect(MCP_PERMISSION_ACTIONS).toContain(requirement.action);
    }
  });

  test('allows only the exact mapped inventory and defaults unknown, human, deletion, permission, and admin tools to deny', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID, isHermesAgent: true }),
      agent: agentSnapshot({
        permissions: [{
          agentId: AGENT_ID,
          userId: USER_ID,
          scope: 'global',
          scopeId: null,
          actions: [...MCP_PERMISSION_ACTIONS],
        }],
      }),
    });

    expect(subject.profile).toBe('hermes_agent');
    expect(policy.visibleToolNames(subject, [
      ...Object.keys(exactToolMapping),
      'register_agent',
      'list_agents',
      'grant_agent_permission',
      'delete_intent',
      'delete_intent_index',
      'delete_network',
      'delete_network_membership',
      'list_conversations',
      'get_conversation',
      'unknown_future_tool',
      'read_user_profiles',
      'add_contact',
    ])).toEqual(Object.keys(exactToolMapping));
  });

  test('requires the mapped canonical action independently instead of inheriting authenticated access', () => {
    for (const [toolName, requirement] of HERMES_AGENT_MCP_TOOL_PERMISSIONS) {
      const allowed = resolveMcpCapabilitySubject({
        identity: identity({ agentId: AGENT_ID, isHermesAgent: true }),
        agent: agentSnapshot({
          permissions: [{
            agentId: AGENT_ID,
            userId: USER_ID,
            scope: 'global',
            scopeId: null,
            actions: [requirement.action],
          }],
        }),
      });
      expect(policy.authorize(allowed, toolName)).toEqual({
        allowed: true,
        reason: 'permission_granted',
        reach: requirement.reach,
        requiredPermissions: [requirement.action],
      });

      const denied = resolveMcpCapabilitySubject({
        identity: identity({ agentId: AGENT_ID, isHermesAgent: true }),
        agent: agentSnapshot({ permissions: [] }),
      });
      expect(policy.authorize(denied, toolName)).toEqual({
        allowed: false,
        reason: 'permission_missing',
        reach: requirement.reach,
        requiredPermissions: [requirement.action],
      });
    }
  });
});

describe('MCP capability permission extension point', () => {
  test('exposes exactly the six canonical actions', () => {
    expect(MCP_PERMISSION_ACTIONS).toEqual([
      'manage:identity',
      'manage:premises',
      'manage:intents',
      'manage:networks',
      'manage:opportunities',
      'manage:negotiations',
    ]);
  });

  test('maps every canonical action independently and denies unknown tools', () => {
    for (const action of MCP_PERMISSION_ACTIONS) {
      const toolName = `tool_for_${action}`;
      const mappedPolicy = new McpCapabilityPolicy({
        toolRules: defineMcpToolAccessRules({
          [toolName]: { access: 'permission', actions: [action], reach: 'principal' },
        }),
      });
      const subject = resolveMcpCapabilitySubject({
        identity: identity({ agentId: AGENT_ID }),
        agent: agentSnapshot({
          permissions: [{
            agentId: AGENT_ID,
            userId: USER_ID,
            scope: 'global',
            scopeId: null,
            actions: [action],
          }],
        }),
      });

      expect(mappedPolicy.authorize(subject, toolName)).toMatchObject({
        allowed: true,
        requiredPermissions: [action],
      });
      expect(mappedPolicy.authorize(subject, 'unknown_tool')).toEqual({
        allowed: false,
        reason: 'tool_unclassified',
      });
    }
  });

  test('runtime validation rejects unknown permission actions and malformed reach', () => {
    expect(() => defineMcpToolPermissionMap({
      bad: { action: 'manage:contacts', reach: 'principal' },
    } as never)).toThrow();
    expect(() => defineMcpToolPermissionMap({
      bad: { action: 'manage:intents', reach: 'global' },
    } as never)).toThrow();
  });

  test('canonical reach keeps premises meta-network and marks network-bound tools', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID, networkScopeId: NETWORK_ID }),
      agent: agentSnapshot({
        permissions: [{
          agentId: AGENT_ID,
          userId: USER_ID,
          scope: 'network',
          scopeId: NETWORK_ID,
          actions: ['manage:premises', 'manage:intents'],
        }],
      }),
    });

    expect(policy.authorize(subject, 'read_premises')).toMatchObject({
      allowed: true,
      reach: 'principal',
    });
    expect(policy.authorize(subject, 'create_intent')).toMatchObject({
      allowed: true,
      reach: 'network',
    });
  });

  test('read_activity_summary is the classified canonical activity tool; report_agent_activity is unknown', () => {
    // read_activity_summary is gated by any-of domain permissions; the handler
    // projects each domain by the caller's exact grants. report_agent_activity
    // retains no classification and no registration — a forged tools/call fails
    // as an unknown tool before database or graph work.
    expect(CANONICAL_MCP_TOOL_ACCESS_RULES.get('read_activity_summary')).toEqual({
      access: 'permission',
      actions: [
        'manage:identity',
        'manage:premises',
        'manage:intents',
        'manage:opportunities',
        'manage:negotiations',
      ],
      reach: 'principal',
    });
    expect(CANONICAL_MCP_TOOL_ACCESS_RULES.get('report_agent_activity')).toBeUndefined();

    const sessionHuman = resolveMcpCapabilitySubject({
      identity: identity({ isSessionAuth: true }),
    });
    expect(policy.authorize(sessionHuman, 'read_activity_summary').allowed).toBe(true);
    expect(policy.authorize(sessionHuman, 'report_agent_activity')).toEqual({
      allowed: false,
      reason: 'tool_unclassified',
    });
  });

  test('read_activity_summary admits agents with any activity-domain permission and denies the rest', () => {
    const intentsAgent = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID }),
      agent: agentSnapshot({
        permissions: [{
          agentId: AGENT_ID,
          userId: USER_ID,
          scope: 'global',
          scopeId: null,
          actions: ['manage:intents'],
        }],
      }),
    });
    expect(policy.authorize(intentsAgent, 'read_activity_summary')).toMatchObject({
      allowed: true,
      reason: 'permission_granted',
    });

    const networksOnlyAgent = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID }),
      agent: agentSnapshot({
        permissions: [{
          agentId: AGENT_ID,
          userId: USER_ID,
          scope: 'global',
          scopeId: null,
          actions: ['manage:networks'],
        }],
      }),
    });
    expect(policy.authorize(networksOnlyAgent, 'read_activity_summary')).toMatchObject({
      allowed: false,
      reason: 'permission_missing',
    });
  });

  test('contact/Gmail, scrape_url, and deprecated profile aliases are unclassified and denied', () => {
    // These surfaces are omitted from the MCP registry composition entirely
    // (IND-596/597/598), so they carry no access rule and resolve to the
    // fail-closed 'tool_unclassified' denial for even the broadest caller.
    const sessionHuman = resolveMcpCapabilitySubject({
      identity: identity({ isSessionAuth: true }),
    });
    for (const toolName of [
      'add_contact',
      'import_contacts',
      'import_gmail_contacts',
      'list_contacts',
      'remove_contact',
      'search_contacts',
      'scrape_url',
      'read_user_profiles',
      'create_user_profile',
      'update_user_profile',
      'confirm_user_profile',
      'preview_user_profile',
      'get_profile_run',
      'cancel_profile_run',
    ]) {
      expect(CANONICAL_MCP_TOOL_ACCESS_RULES.get(toolName)).toBeUndefined();
      expect(policy.authorize(sessionHuman, toolName)).toEqual({
        allowed: false,
        reason: 'tool_unclassified',
      });
    }
  });

  test('permission snapshots remain stable until a new subject is resolved', () => {
    const snapshot = agentSnapshot({ permissions: [] });
    const resolvedBeforeGrant = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID }),
      agent: snapshot,
    });

    snapshot.permissions.push({
      agentId: AGENT_ID,
      userId: USER_ID,
      scope: 'global',
      scopeId: null,
      actions: ['manage:intents'],
    });

    expect(policy.authorize(resolvedBeforeGrant, 'create_intent').allowed).toBe(false);

    const resolvedAfterRefresh = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID }),
      agent: snapshot,
    });
    expect(policy.authorize(resolvedAfterRefresh, 'create_intent').allowed).toBe(true);
  });
});

describe('rolling-data legacy permission projection (IND-607)', () => {
  test('projects a stored manage:profile row to manage:identity + manage:premises', () => {
    expect(projectStoredPermissionActions(['manage:profile'])).toEqual([
      'manage:identity',
      'manage:premises',
    ]);
  });

  test('projects a stored manage:contacts row to no capability', () => {
    expect(projectStoredPermissionActions(['manage:contacts'])).toEqual([]);
    expect(projectStoredPermissionActions(['manage:intents', 'manage:contacts'])).toEqual([
      'manage:intents',
    ]);
  });

  test('passes canonical actions through unchanged and de-duplicates the profile overlap', () => {
    expect(projectStoredPermissionActions(['manage:intents', 'manage:negotiations'])).toEqual([
      'manage:intents',
      'manage:negotiations',
    ]);
    expect(projectStoredPermissionActions(['manage:identity', 'manage:profile'])).toEqual([
      'manage:identity',
      'manage:premises',
    ]);
  });

  test('ignores unknown actions (fail closed)', () => {
    expect(projectStoredPermissionActions(['manage:profile', 'manage:bogus', 'manage:contacts'])).toEqual([
      'manage:identity',
      'manage:premises',
    ]);
    expect(projectStoredPermissionActions(['totally:unknown'])).toEqual([]);
  });

  test('a residual legacy manage:profile row still grants identity + premises capabilities at the loading boundary', () => {
    // No access loss during the rolling window: an un-migrated (or old-replica
    // re-written) manage:profile grant is interpreted at capability-load time.
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID }),
      agent: agentSnapshot({
        permissions: [{
          agentId: AGENT_ID,
          userId: USER_ID,
          scope: 'global',
          scopeId: null,
          actions: ['manage:profile', 'manage:contacts'],
        }],
      }),
    });

    expect(subject.permissions).toEqual(['manage:identity', 'manage:premises']);
    expect(policy.authorize(subject, 'read_premises').allowed).toBe(true);
    expect(policy.authorize(subject, 'research_profile').allowed).toBe(true);
    // manage:contacts projected to nothing — no contact-era capability leaks.
  });

  test('preserves owner/network scope matching for legacy rows (no scope widening)', () => {
    // A legacy manage:profile grant scoped to another network must NOT apply to
    // an agent bound to network-1 — scope matching runs before projection.
    const wrongNetwork = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID, networkScopeId: NETWORK_ID }),
      agent: agentSnapshot({
        permissions: [{
          agentId: AGENT_ID,
          userId: USER_ID,
          scope: 'network',
          scopeId: 'another-network',
          actions: ['manage:profile'],
        }],
      }),
    });
    expect(wrongNetwork.permissions).toEqual([]);

    // The same legacy grant scoped to the bound network DOES project.
    const boundNetwork = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID, networkScopeId: NETWORK_ID }),
      agent: agentSnapshot({
        permissions: [{
          agentId: AGENT_ID,
          userId: USER_ID,
          scope: 'network',
          scopeId: NETWORK_ID,
          actions: ['manage:profile'],
        }],
      }),
    });
    expect(boundNetwork.permissions).toEqual(['manage:identity', 'manage:premises']);
  });

  test('a canonical-only row is unchanged by the projection', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID }),
      agent: agentSnapshot({
        permissions: [{
          agentId: AGENT_ID,
          userId: USER_ID,
          scope: 'global',
          scopeId: null,
          actions: ['manage:identity', 'manage:premises', 'manage:intents'],
        }],
      }),
    });
    expect(subject.permissions).toEqual(['manage:identity', 'manage:premises', 'manage:intents']);
  });
});

// Helper: a global agent holding exactly the given canonical actions.
function globalAgentSubject(actions: string[]) {
  return resolveMcpCapabilitySubject({
    identity: identity({ agentId: AGENT_ID }),
    agent: agentSnapshot({
      permissions: [{
        agentId: AGENT_ID,
        userId: USER_ID,
        scope: 'global',
        scopeId: null,
        actions,
      }],
    }),
  });
}

describe('agent administration policy (IND-599)', () => {
  test('registered agent sees/calls only read_own_agent (agent_self_read), never list_agents or mutations', () => {
    // Agents receive read_own_agent (their own record) but not list_agents (admin view)
    // and cannot mutate any admin settings.
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID }),
      agent: agentSnapshot({
        permissions: [{
          agentId: AGENT_ID,
          userId: USER_ID,
          scope: 'global',
          scopeId: null,
          actions: ['manage:intents'],
        }],
      }),
    });

    expect(subject.profile).toBe('registered_global_agent');
    // Agent can read its own record with agent_self_read reason.
    const decision = policy.authorize(subject, 'read_own_agent');
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('agent_self_read');
    // All other agent admin tools denied for agents.
    expect(policy.visibleToolNames(subject, [
      'read_own_agent',
      'register_agent',
      'list_agents',
      'update_agent',
      'delete_agent',
      'grant_agent_permission',
      'revoke_agent_permission',
    ])).toEqual(['read_own_agent']);
    // Verify each admin tool is explicitly denied for agents.
    for (const tool of ['register_agent', 'list_agents', 'update_agent', 'delete_agent', 'grant_agent_permission', 'revoke_agent_permission']) {
      expect(policy.authorize(subject, tool)).toMatchObject({ allowed: false, reason: 'agent_admin_denied' });
    }
  });

  test('session human sees all agent admin tools except read_own_agent, which is agent-only', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ isSessionAuth: true }),
    });

    expect(subject.profile).toBe('session_human');
    // Session humans receive full agent administration mutations but NOT read_own_agent.
    const adminTools = [
      'register_agent',
      'list_agents',
      'update_agent',
      'delete_agent',
      'grant_agent_permission',
      'revoke_agent_permission',
    ];
    expect(policy.visibleToolNames(subject, ['read_own_agent', ...adminTools])).toEqual(adminTools);
    // Humans get all admin tools but not read_own_agent.
    for (const tool of adminTools) {
      expect(policy.authorize(subject, tool).allowed).toBe(true);
    }
    // read_own_agent explicitly denied for humans (agent-only).
    expect(policy.authorize(subject, 'read_own_agent')).toMatchObject({ allowed: false, reason: 'human_read_own_agent_denied' });
  });

  test('enrollment-capable key receives only register_agent, denies all admin mutations', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ enrollmentCapable: true }),
    });

    expect(subject.profile).toBe('enrollment_key');
    expect(policy.visibleToolNames(subject, [
      'register_agent',
      'list_agents',
      'update_agent',
      'delete_agent',
      'grant_agent_permission',
      'revoke_agent_permission',
    ])).toEqual(['register_agent']);
  });

  test('enrollment key is register_agent-only across the ENTIRE canonical matrix — every domain tool is denied', () => {
    // Whole-registry proof (not just the agent-admin subset): iterate every
    // classified tool in the canonical production matrix and require that an
    // enrollment-capable unregistered key sees and may call ONLY register_agent.
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ enrollmentCapable: true }),
    });
    expect(subject.profile).toBe('enrollment_key');

    const allToolNames = [...CANONICAL_MCP_TOOL_ACCESS_RULES.keys()];
    expect(allToolNames.length).toBeGreaterThan(30);
    expect(policy.visibleToolNames(subject, allToolNames)).toEqual(['register_agent']);
    for (const toolName of allToolNames) {
      if (toolName === 'register_agent') {
        expect(policy.authorize(subject, toolName)).toMatchObject({ allowed: true, reason: 'enrollment' });
        continue;
      }
      expect(policy.authorize(subject, toolName), `${toolName} must be enrollment_required`)
        .toMatchObject({ allowed: false, reason: 'enrollment_required' });
    }
  });

  test('plain unregistered key fails closed across the ENTIRE canonical matrix', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity(),
    });
    expect(subject.profile).toBe('unregistered_key');

    const allToolNames = [...CANONICAL_MCP_TOOL_ACCESS_RULES.keys()];
    expect(policy.visibleToolNames(subject, allToolNames)).toEqual([]);
    for (const toolName of allToolNames) {
      expect(policy.authorize(subject, toolName), `${toolName} must be unregistered_principal`)
        .toMatchObject({ allowed: false, reason: 'unregistered_principal' });
    }
  });

  test('plain unregistered key fails closed on all admin tools', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity(),
    });

    expect(subject.profile).toBe('unregistered_key');
    expect(policy.visibleToolNames(subject, [
      'register_agent',
      'list_agents',
      'update_agent',
      'delete_agent',
      'grant_agent_permission',
      'revoke_agent_permission',
    ])).toEqual([]);
  });

  test('invalid/inactive/mismatched agent denies all admin tools', () => {
    const baseIdentity = identity({ agentId: AGENT_ID });
    const subjects = [
      resolveMcpCapabilitySubject({
        identity: baseIdentity,
        agent: null,
      }),
      resolveMcpCapabilitySubject({
        identity: baseIdentity,
        agent: agentSnapshot({ status: 'inactive' }),
      }),
      resolveMcpCapabilitySubject({
        identity: baseIdentity,
        agent: agentSnapshot({ ownerId: 'other-user' }),
      }),
    ];

    for (const subject of subjects) {
      expect(subject.profile).toBe('invalid_agent');
      expect(policy.visibleToolNames(subject, [
        'register_agent',
        'list_agents',
        'update_agent',
        'delete_agent',
        'grant_agent_permission',
        'revoke_agent_permission',
      ])).toEqual([]);
    }
  });
});

describe('signals read/write split (IND-588)', () => {
  const SIGNAL_READ_TOOLS = ['read_intents', 'search_intents', 'read_intent_indexes'] as const;
  const SIGNAL_WRITE_TOOLS = [
    'create_intent',
    'update_intent',
    'delete_intent',
    'create_intent_index',
    'delete_intent_index',
  ] as const;

  test('read tools are authenticated and write/community-assignment tools require manage:intents', () => {
    for (const tool of SIGNAL_READ_TOOLS) {
      expect(CANONICAL_MCP_TOOL_ACCESS_RULES.get(tool)).toEqual({ access: 'authenticated', reach: 'network' });
    }
    for (const tool of SIGNAL_WRITE_TOOLS) {
      expect(CANONICAL_MCP_TOOL_ACCESS_RULES.get(tool)).toEqual({
        access: 'permission',
        actions: ['manage:intents'],
        reach: 'network',
      });
    }
  });

  test('an authenticated agent without manage:intents may read every signal tool but mutate none', () => {
    const agent = globalAgentSubject(['manage:opportunities']);
    for (const tool of SIGNAL_READ_TOOLS) {
      expect(policy.authorize(agent, tool), tool).toMatchObject({ allowed: true, reason: 'authenticated' });
    }
    for (const tool of SIGNAL_WRITE_TOOLS) {
      expect(policy.authorize(agent, tool), tool).toMatchObject({ allowed: false, reason: 'permission_missing' });
    }
    expect(policy.visibleToolNames(agent, [...SIGNAL_READ_TOOLS, ...SIGNAL_WRITE_TOOLS])).toEqual([...SIGNAL_READ_TOOLS]);
  });

  test('a manage:intents agent may read and mutate every signal tool, all at network reach', () => {
    const agent = globalAgentSubject(['manage:intents']);
    for (const tool of [...SIGNAL_READ_TOOLS, ...SIGNAL_WRITE_TOOLS]) {
      expect(policy.authorize(agent, tool), tool).toMatchObject({ allowed: true, reach: 'network' });
    }
  });
});

describe('MCP question flow (answer lane + owner verdicts)', () => {
  const sessionHuman = () => resolveMcpCapabilitySubject({
    identity: identity({ isSessionAuth: true }),
  });

  test('answer_pending_question is the recipient principal lane: humans and manage:negotiations agents', () => {
    expect(CANONICAL_MCP_TOOL_ACCESS_RULES.get('answer_pending_question')).toEqual({
      access: 'permission',
      actions: ['manage:negotiations'],
      reach: 'principal',
    });

    expect(policy.authorize(sessionHuman(), 'answer_pending_question')).toMatchObject({
      allowed: true,
      reason: 'session_human',
    });
    expect(policy.authorize(globalAgentSubject(['manage:negotiations']), 'answer_pending_question')).toMatchObject({
      allowed: true,
      reason: 'permission_granted',
    });
    expect(policy.authorize(globalAgentSubject(['manage:intents']), 'answer_pending_question')).toMatchObject({
      allowed: false,
      reason: 'permission_missing',
    });
  });

  test('owner verdicts are human_only: exactly the class the IND-593 provenance binding admits', () => {
    for (const tool of ['reject_opportunity', 'accept_opportunity'] as const) {
      expect(CANONICAL_MCP_TOOL_ACCESS_RULES.get(tool)).toEqual({ access: 'human_only', reach: 'network' });
      expect(policy.authorize(sessionHuman(), tool)).toMatchObject({ allowed: true, reason: 'session_human' });
      // Every agent principal class is refused — including one holding every
      // canonical permission: no grant releases an owner verdict.
      expect(policy.authorize(globalAgentSubject([...MCP_PERMISSION_ACTIONS]), tool)).toMatchObject({
        allowed: false,
        reason: 'human_only',
      });
    }
  });

  test('Hermes negotiator credentials fail closed as unclassified on all three question-flow tools', () => {
    const hermes = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID, isHermesAgent: true }),
      agent: agentSnapshot({
        permissions: [{
          agentId: AGENT_ID,
          userId: USER_ID,
          scope: 'global',
          scopeId: null,
          actions: [...MCP_PERMISSION_ACTIONS],
        }],
      }),
    });
    for (const tool of ['answer_pending_question', 'reject_opportunity', 'accept_opportunity']) {
      expect(HERMES_AGENT_MCP_TOOL_PERMISSIONS.get(tool)).toBeUndefined();
      expect(policy.authorize(hermes, tool)).toEqual({ allowed: false, reason: 'tool_unclassified' });
    }
  });
});
