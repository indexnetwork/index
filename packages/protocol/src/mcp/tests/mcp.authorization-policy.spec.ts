import { describe, expect, test } from 'bun:test';

import type { McpResolvedIdentity } from '../../shared/schemas/mcp-auth.schema.js';
import type { McpPolicyAgentSnapshot } from '../mcp.authorization-policy.js';
import { CANONICAL_MCP_TOOL_ACCESS_RULES, MCP_PERMISSION_ACTIONS, McpCapabilityPolicy, defineMcpToolAccessRules, defineMcpToolPermissionMap, projectStoredPermissionActions, resolveMcpCapabilitySubject } from '../mcp.authorization-policy.js';

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
      isOnboarding: false,
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

  test('onboarding humans receive only the onboarding inventory', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ isSessionAuth: true }),
      isOnboarding: true,
    });

    expect(subject.profile).toBe('onboarding_human');
    expect(policy.visibleToolNames(subject, [
      'register_agent',
      'read_networks',
      'create_intent',
      'update_agent',
      'discover_opportunities',
    ])).toEqual([
      'register_agent',
      'read_networks',
      'create_intent',
    ]);
  });

  test('only explicitly enrollment-capable unregistered keys can register', () => {
    const enrollmentSubject = resolveMcpCapabilitySubject({
      identity: identity({ enrollmentCapable: true }),
      isOnboarding: false,
    });
    const ordinaryKeySubject = resolveMcpCapabilitySubject({
      identity: identity(),
      isOnboarding: false,
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
      isOnboarding: false,
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
    expect(policy.visibleToolNames(subject, [
      'register_agent',
      'list_agents',
      'update_agent',
      'delete_agent',
      'grant_agent_permission',
      'revoke_agent_permission',
      'read_intents',
      'create_intent',
    ])).toEqual(['list_agents', 'read_intents', 'create_intent']);
  });

  test('network agents honor only matching-scope or global permission rows', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID, networkScopeId: NETWORK_ID }),
      isOnboarding: false,
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
      isOnboarding: false,
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
    expect(policy.visibleToolNames(subject, [
      'list_agents',
      'read_docs',
      'confirm_opportunity_delivery',
      'discover_opportunities',
    ])).toEqual([
      'list_agents',
      'read_docs',
      'confirm_opportunity_delivery',
      'discover_opportunities',
    ]);
  });

  test('registered personal agents remain ordinary principals unless designated for delivery', () => {
    const subject = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID }),
      isOnboarding: false,
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
    expect(policy.authorize(subject, 'discover_opportunities').allowed).toBe(true);
    expect(policy.authorize(subject, 'confirm_opportunity_delivery').allowed).toBe(false);
  });

  test('missing, inactive, and mismatched agents fail closed', () => {
    const baseIdentity = identity({ agentId: AGENT_ID });
    const subjects = [
      resolveMcpCapabilitySubject({
        identity: baseIdentity,
        isOnboarding: false,
        agent: null,
      }),
      resolveMcpCapabilitySubject({
        identity: baseIdentity,
        isOnboarding: false,
        agent: agentSnapshot({ status: 'inactive' }),
      }),
      resolveMcpCapabilitySubject({
        identity: baseIdentity,
        isOnboarding: false,
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
        isOnboarding: false,
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
      isOnboarding: false,
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
      isOnboarding: false,
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
      isOnboarding: false,
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
      isOnboarding: false,
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
      isOnboarding: false,
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
      isOnboarding: false,
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
      isOnboarding: false,
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
      isOnboarding: false,
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
    expect(policy.authorize(subject, 'read_user_contexts').allowed).toBe(true);
    // manage:contacts projected to nothing — no contact-era capability leaks.
  });

  test('preserves owner/network scope matching for legacy rows (no scope widening)', () => {
    // A legacy manage:profile grant scoped to another network must NOT apply to
    // an agent bound to network-1 — scope matching runs before projection.
    const wrongNetwork = resolveMcpCapabilitySubject({
      identity: identity({ agentId: AGENT_ID, networkScopeId: NETWORK_ID }),
      isOnboarding: false,
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
      isOnboarding: false,
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
      isOnboarding: false,
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
