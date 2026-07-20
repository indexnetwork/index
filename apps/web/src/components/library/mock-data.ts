/**
 * Realistic mock data for the component-library showcase.
 * Shapes mirror the production-derived preview entities (yanki@index.network).
 */
import type { LibraryIntent } from './intent';
import type { LibraryOpportunity } from './opportunity';
import type { LibraryNegotiation } from './negotiation';
import type { LibraryQuestion } from './question';
import type { LibraryPremise } from './premise';

const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(NOW - d * 86400_000).toISOString();

export const mockIntents: LibraryIntent[] = [
  {
    id: '8fca2c45-ed28-40d2-85d6-c6b0cfbf59c5',
    payload:
      'Find a technical co-founder with distributed-systems experience who wants to build intent-centric discovery infrastructure, ideally in Europe.',
    summary: 'Technical co-founder for intent-centric discovery infrastructure',
    status: 'ACTIVE',
    createdAt: daysAgo(6),
    networks: [
      { id: 'net-1', title: 'Index Builders' },
      { id: 'net-2', title: 'Edge Esmeralda' },
    ],
    pendingQuestionCount: 2,
    opportunityCount: 3,
  },
  {
    id: 'f84ebe00-3d50-44ff-bcf5-4da660b1e3c9',
    payload:
      'Connect with researchers publishing on agent negotiation protocols and semantic matching to exchange notes and explore collaboration.',
    summary: 'Researchers in agent negotiation & semantic matching',
    status: 'ACTIVE',
    createdAt: daysAgo(12),
    networks: [{ id: 'net-1', title: 'Index Builders' }],
    pendingQuestionCount: 1,
    opportunityCount: 1,
  },
  {
    id: 'fa85c0f8-a3be-4c67-92ae-9373555dcd1b',
    payload: 'Meet potential design partners for a private, agent-mediated professional network pilot in Q3.',
    summary: 'Design partners for the Q3 private-network pilot',
    status: 'PAUSED',
    createdAt: daysAgo(21),
    networks: [],
    pendingQuestionCount: 1,
    opportunityCount: 0,
  },
];

export const mockOpportunities: LibraryOpportunity[] = [
  {
    opportunityId: 'opp-1',
    status: 'pending',
    userId: 'user-elif',
    name: 'Elif Demir',
    avatar: null,
    headline: 'Built p2p marketplaces at two startups; looking for her next founding problem',
    mainText:
      'Elif spent four years building distributed matching infrastructure and recently left her staff engineer role to found something. Her intents around agent-mediated discovery overlap strongly with your co-founder signal, and she is actively evaluating problems in this space.',
    cta: 'Ask Elif how she thinks about cold-start in two-sided discovery networks.',
    primaryActionLabel: 'Start Chat',
    secondaryActionLabel: 'Skip',
    mutualIntentsLabel: '2 mutual intents',
    narratorChip: {
      name: 'Jonas',
      text: 'Elif was the strongest systems thinker on my team — you two should absolutely talk.',
      avatar: null,
    },
  },
  {
    opportunityId: 'opp-2',
    status: 'negotiating',
    userId: 'user-mateo',
    name: 'Mateo Rossi',
    avatar: null,
    headline: 'Publishes on negotiation protocols for autonomous agents',
    mainText:
      'Mateo’s recent work on commitment strategies in multi-agent negotiation maps directly onto your research-exchange signal. His agent is currently comparing your premises against his collaboration constraints.',
    cta: 'Exchange reading lists on agent negotiation protocols.',
    primaryActionLabel: 'Start Chat',
    secondaryActionLabel: 'Skip',
    mutualIntentsLabel: '1 mutual intent',
  },
  {
    opportunityId: 'opp-3',
    status: 'accepted',
    userId: 'user-sana',
    name: 'Sana Kapoor',
    avatar: null,
    headline: 'Design-lead exploring private professional networks',
    mainText: 'Sana accepted your connection through the Q3 pilot signal.',
    cta: '',
    primaryActionLabel: 'Start Chat',
    secondaryActionLabel: 'Skip',
    mutualIntentsLabel: '1 mutual intent',
  },
];

export const mockNegotiations: LibraryNegotiation[] = [
  {
    id: 'neg-1',
    segments: 2,
    state: 'working',
    statusMessage: 'Comparing collaboration constraints',
    statusTimestamp: hoursAgo(1),
    counterparty: { id: 'user-mateo', name: 'Mateo', avatar: null },
    outcome: null,
    turns: [
      {
        speaker: { id: 'user-mateo', name: 'Mateo', avatar: null },
        action: 'propose',
        reasoning:
          'Mateo is open to a research exchange focused on negotiation protocols, but only if it can lead to a concrete artifact — a joint reading group or a position paper.',
        suggestedRoles: null,
        createdAt: hoursAgo(26),
      },
      {
        speaker: { id: 'user-yanki', name: 'You', avatar: null },
        action: 'counter',
        reasoning:
          'A monthly reading group fits the signal well. Countered with a proposal to start async — shared annotated bibliography first, sync session after two weeks.',
        suggestedRoles: null,
        createdAt: hoursAgo(9),
      },
      {
        speaker: { id: 'user-mateo', name: 'Mateo', avatar: null },
        action: 'counter',
        reasoning:
          'Async-first works, but Mateo wants a cap of six participants and a rotating curator so the group does not stall. Evaluating whether your other research signals align.',
        suggestedRoles: null,
        createdAt: hoursAgo(1),
      },
    ],
    createdAt: hoursAgo(26),
    updatedAt: hoursAgo(1),
  },
  {
    id: 'neg-2',
    segments: 1,
    state: 'completed',
    statusMessage: 'Opportunity created',
    statusTimestamp: daysAgo(2),
    counterparty: { id: 'user-elif', name: 'Elif', avatar: null },
    outcome: { hasOpportunity: true, role: 'peer', turnCount: 2 },
    turns: [
      {
        speaker: { id: 'user-elif', name: 'Elif', avatar: null },
        action: 'accept',
        reasoning:
          'Strong overlap on discovery-infrastructure intents and complementary backgrounds. Elif’s agent accepted an introduction with a suggested first topic: cold-start strategy.',
        suggestedRoles: { ownUser: 'product & protocol', otherUser: 'systems & matching' },
        createdAt: daysAgo(2),
      },
    ],
    createdAt: daysAgo(3),
    updatedAt: daysAgo(2),
  },
];

export const mockQuestions: LibraryQuestion[] = [
  {
    id: 'q-1',
    detection: {
      mode: 'pool_discovery',
      sourceType: 'intent',
      sourceId: '8fca2c45-ed28-40d2-85d6-c6b0cfbf59c5',
      timestamp: hoursAgo(3),
    },
    actors: [{ userId: 'user-yanki', role: 'subject' }],
    payload: {
      title: 'Sharpen your co-founder signal',
      prompt: 'Your co-founder signal is matching two distinct groups. Which matters more right now?',
      multiSelect: false,
      evidence: 'based on 18 people matching this intent',
      options: [
        {
          label: 'Deep systems craft',
          description: 'Prioritize people who have built distributed infrastructure hands-on.',
        },
        {
          label: 'Founder-market urgency',
          description: 'Prioritize people actively looking to found a company in the next 3 months.',
        },
        {
          label: 'Both matter equally',
          description: 'Keep matching both groups and let negotiations arbitrate.',
        },
      ],
    },
    status: 'pending',
    answer: null,
    expiresAt: new Date(NOW + 7 * 86400_000).toISOString(),
    createdAt: hoursAgo(3),
    conversationId: null,
  },
  {
    id: 'q-2',
    detection: {
      mode: 'enrichment',
      sourceType: 'enrichment',
      sourceId: 'enr-1',
      timestamp: daysAgo(1),
    },
    actors: [{ userId: 'user-yanki', role: 'subject' }],
    payload: {
      title: 'About your background',
      prompt: 'Which of these describe how you want to be represented to counterparties?',
      multiSelect: true,
      options: [
        { label: 'Protocol designer', description: 'You design agent-mediated coordination protocols.' },
        { label: 'Founder', description: 'You are building Index Network as your primary venture.' },
        { label: 'Researcher', description: 'You publish and follow academic work in this space.' },
        { label: 'Community builder', description: 'You run or steward networks and communities.' },
      ],
    },
    status: 'pending',
    answer: null,
    expiresAt: new Date(NOW + 6 * 86400_000).toISOString(),
    createdAt: daysAgo(1),
    conversationId: null,
  },
  {
    id: 'q-3',
    detection: {
      mode: 'intent',
      sourceType: 'intent',
      sourceId: '8fca2c45-ed28-40d2-85d6-c6b0cfbf59c5',
      timestamp: daysAgo(2),
    },
    actors: [{ userId: 'user-yanki', role: 'subject' }],
    payload: {
      title: 'Location preference',
      prompt: 'Does remote-first collaboration work for the co-founder search?',
      multiSelect: false,
      evidence: 'based on 18 people matching this intent',
      options: [
        { label: 'Remote works fully', description: 'Timezone overlap is enough; no shared city needed.' },
        { label: 'Prefer same city', description: 'Strong preference for in-person work early on.' },
        { label: 'Either is fine', description: 'Let the person decide; do not filter on location.' },
      ],
    },
    status: 'answered',
    answer: {
      selectedOptions: ['Either is fine'],
      answeredBy: 'user-yanki',
      answeredAt: hoursAgo(5),
    },
    expiresAt: null,
    createdAt: daysAgo(2),
    conversationId: null,
  },
  {
    id: 'q-4',
    detection: {
      mode: 'chat',
      sourceType: 'chat',
      sourceId: 'conv-1',
      timestamp: hoursAgo(20),
    },
    actors: [{ userId: 'user-yanki', role: 'subject' }],
    payload: {
      title: 'Introduction emphasis',
      prompt: 'What should your agent emphasize first when introducing you to researchers?',
      multiSelect: false,
      options: [],
    },
    status: 'answered',
    answer: {
      selectedOptions: [],
      freeText: 'Start from the negotiation-protocol reading list — it signals seriousness.',
      answeredBy: 'user-yanki',
      answeredAt: hoursAgo(18),
    },
    expiresAt: null,
    createdAt: hoursAgo(20),
    conversationId: 'conv-1',
  },
];

export const mockPremises: LibraryPremise[] = [
  {
    id: 'prem-1',
    text: 'Yanki is a founder building Index Network, a private intent-driven discovery protocol, and splits time between protocol design and ecosystem partnerships.',
    summary: 'Founder of Index Network; protocol design + partnerships',
    kind: 'assertive',
    sourceType: 'enrichment',
    confidence: 0.94,
    createdAt: daysAgo(30),
  },
  {
    id: 'prem-2',
    text: 'Currently focused on finding a technical co-founder with distributed-systems depth; evaluating candidates through agent-mediated introductions rather than open outreach.',
    summary: 'Actively searching for a technical co-founder',
    kind: 'contextual',
    sourceType: 'discovery_form',
    confidence: 0.88,
    createdAt: daysAgo(6),
  },
  {
    id: 'prem-3',
    text: 'Reads and cites work on multi-agent negotiation, semantic matching, and privacy-preserving discovery; prefers async written collaboration over calls.',
    summary: null,
    kind: 'assertive',
    sourceType: 'integration',
    confidence: 0.81,
    createdAt: daysAgo(18),
  },
];
