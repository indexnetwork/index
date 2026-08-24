---
title: "Networks"
type: domain
tags: [networks, communities, permissions, auto-assign]
created: 2026-03-26
updated: 2026-05-24
---

# Networks

A network is a context for discovery — a community, group, or scope within which intents are shared and opportunities are found. Networks are the privacy boundary of the system: users choose which networks to share their intents in, and discovery happens within and across those boundaries according to access rules.

The many-to-many relationship between intents and networks is fundamental. A single intent can be shared in multiple contexts: a global collaboration network, a private company workspace, a community hub, or a direct one-on-one share — each governed by its own privacy and access controls.

---

## What a Network Represents

A network can represent:
- A professional community ("AI Research Network")
- A company workspace ("Acme Corp Internal")
- A project team ("DeFi Protocol Builders")
- A topical interest group ("Climate Tech")
- A time-bound event ("Edge Esmeralda 2026")

Each network has:
- **Title**: Human-readable name
- **Prompt**: A natural-language description of the network's purpose. This is used by AI agents to evaluate whether intents belong in this network.
- **Metadata**: Freeform JSONB properties — no required fields.
- **Image URL**: Optional visual identifier
- **Permissions**: Access and join policy configuration

---

## Join Policies

Networks have configurable join policies:

- **invite_only** (default): New members can only be added by existing members with appropriate permissions. An invitation link with a unique code can be generated to allow controlled access.
- **anyone**: Anyone can join the network without approval.

---

## Permissions Model

Network membership is tracked in the `network_members` table with a composite primary key of (networkId, userId). Each membership carries a permissions array and optional configuration.

### Permission levels

| Permission | Capabilities |
|---|---|
| **owner** | Full access: manage members, settings, read/write intents. Cannot be removed except by self. |
| **member** | Standard access: read/write intents within the network. |

Ownership is determined through the `network_members` table's `permissions` array containing `'owner'`, not through a denormalized column on the network itself.

### Member prompts and auto-assignment

Each member can customize their relationship with a network:

- **Member prompt**: A personal description of what they want to share in this network. For example, a network's prompt might be "AI/ML collaborators" while a member's prompt says "Specifically seeking PyTorch experts". The member prompt adds specificity that the Intent Indexer agent uses when evaluating intent-network fit.

- **Auto-assign** (`autoAssign: boolean`): When enabled, new intents from this user are automatically evaluated against this network and assigned if they qualify. When disabled, assignment requires explicit action.

---

## Intent-Network Junction

The `intent_networks` table tracks which intents belong to which networks, with a composite primary key of (intentId, networkId). Each row can carry a `relevancyScore` (0.0-1.0) that measures how well the intent fits the network's purpose.

This score is used during opportunity discovery to break ties when a candidate appears across multiple shared networks. The network with the highest relevancy score to the trigger intent is preferred. Networks without prompts default to a relevancy score of 1.0.

---

## Network-Scoped Discovery

Opportunities can be discovered within the scope of a single network. When discovery is network-scoped, only members of that network are considered as candidates, and the network's prompt provides additional context for evaluation.

This enables focused discovery within communities: a new member joining a network triggers discovery only against other members of that same network, and results are contextualized by the network's stated purpose.

An opportunity's relationship to a network is recorded per-actor: each entry in the `opportunities.actors` JSONB array carries the `networkId` where that user was matched. Read-time scope filters (e.g. listing or acting on opportunities under a network-scoped agent) require the *requesting user's own* actor entry to be anchored on the bound network — a counterpart's presence on the network is not enough, because mixed-network introducer flows can place actors of a single opportunity on different networks. The `opportunity.context.networkId` field is a denormalization for legacy callers and is not consulted by scope checks.

---

## Network Integrations

Networks can be connected to external services (Slack channels, Notion workspaces, Gmail) through the `network_integrations` table. Each integration links a network to a connected account and toolkit identifier. Intents generated from integration sync are tagged with `sourceType: 'integration'` and the corresponding `sourceId`.

Linking a user's Composio connection (**gmail** / **slack**) to a network enables contact import into that network. Link records are owner-managed via `POST/DELETE /api/integrations/:toolkit/link`.

---

## Domain Events

Network membership changes emit events:
- **onMemberAdded**: Fired when a new member joins a network. Can trigger discovery for the new member against existing members.
