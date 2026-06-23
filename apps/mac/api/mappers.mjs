/**
 * Pure response mappers for the macOS/iOS prototypes.
 *
 * These functions translate services/api response envelopes into the current
 * `window.HALO_DATA`-style view models, but this file deliberately has no
 * dependency on the app bundles and no side effects.
 */

const DEFAULT_EVENT = {
  name: 'index',
  venue: 'the network',
  neighborhood: 'agents talking to agents',
  date: 'live · always on',
  doors: '',
  attending: 0,
  arrived: 0,
};

/**
 * Build the current prototype's EVENT summary from API data.
 * @param {Object} input
 * @param {Array<Object>} [input.networks]
 * @param {Object} [input.user]
 */
export function mapEventSummary(input = {}) {
  const networks = Array.isArray(input.networks) ? input.networks : [];
  const nonPersonal = networks.filter((network) => network && network.isPersonal !== true);
  const selected = nonPersonal[0] || networks[0];
  const memberCount = networks.reduce((sum, network) => {
    const count = network && network._count && typeof network._count.members === 'number'
      ? network._count.members
      : 0;
    return sum + count;
  }, 0);

  return {
    ...DEFAULT_EVENT,
    name: selected?.title || DEFAULT_EVENT.name,
    venue: selected?.type === 'event' ? 'event index' : DEFAULT_EVENT.venue,
    neighborhood: selected?.prompt || DEFAULT_EVENT.neighborhood,
    doors: networks.length ? `${networks.length} indexes joined` : DEFAULT_EVENT.doors,
    attending: memberCount,
  };
}

/**
 * Convert API intents to the current mac signal rows.
 * @param {Array<Object>} intents
 * @param {Array<Object>} [questions]
 */
export function mapIntents(intents = [], questions = []) {
  const questionCounts = countQuestionsBySource(questions);
  return intents.map((intent) => mapIntent(intent, questionCounts.get(intent.id) || 0));
}

/**
 * Convert one API intent to a mac signal row.
 * @param {Object} intent
 * @param {number} [questionCount]
 */
export function mapIntent(intent, questionCount = 0) {
  const networkTitles = Array.isArray(intent.networks)
    ? intent.networks.map((network) => network.networkTitle).filter(Boolean)
    : [];

  return {
    id: intent.id,
    title: intent.summary || intent.payload || 'untitled signal',
    edges: networkTitles.join(' · '),
    offLimits: '',
    shape: 'warm',
    status: intent.archivedAt ? 'paused' : 'active',
    pipeline: { warm: 0, considering: 0, negotiating: 0 },
    lastSignal: intent.updatedAt ? `updated ${relativeAge(intent.updatedAt)}` : '',
    age: intent.createdAt ? `running ${relativeAge(intent.createdAt)}` : '',
    matches: 0,
    connected: 0,
    inConversations: 0,
    questions: questionCount,
    inbound: [],
    source: intent,
  };
}

/**
 * Convert home-view opportunity sections to the current people card shape.
 * @param {Array<Object>} sections
 */
export function mapPeopleFromHomeSections(sections = []) {
  return sections.flatMap((section) => {
    const items = Array.isArray(section.items) ? section.items : [];
    return items.map((item) => mapPersonFromHomeCard(item, section));
  });
}

/**
 * Convert a presenter card from GET /opportunities/home into a mac person card.
 * @param {Object} card
 * @param {Object} [section]
 */
export function mapPersonFromHomeCard(card, section = {}) {
  return {
    id: card.opportunityId || card.userId,
    name: card.name || 'unknown',
    blurb: card.headline || card.mainText || '',
    location: section.title || '',
    arrived: 0,
    distance: card.mutualIntentsLabel || '',
    mutuals: 0,
    signals: compact([section.title, card.mutualIntentsLabel]),
    overlap: compact([card.headline]),
    score: null,
    status: mapOpportunityStatusToPrototype(card.status),
    pitchFromAgent: card.narratorChip?.text || card.mainText || '',
    introVia: card.narratorChip?.name || card.cta || '',
    source: card,
  };
}

/**
 * Convert list/detail opportunities to the current people card shape.
 * @param {Array<Object>} opportunities
 */
export function mapPeopleFromOpportunities(opportunities = []) {
  return opportunities.map((opportunity) => ({
    id: opportunity.id,
    name: opportunity.counterpartName || opportunity.presentation?.title || 'unknown',
    blurb: opportunity.interpretation?.summary || opportunity.presentation?.description || '',
    location: opportunity.index?.title || '',
    arrived: 0,
    distance: opportunity.updatedAt ? `updated ${relativeAge(opportunity.updatedAt)}` : '',
    mutuals: 0,
    signals: compact([opportunity.category, opportunity.index?.title]),
    overlap: compact([opportunity.interpretation?.summary]),
    score: typeof opportunity.confidence === 'number' ? opportunity.confidence : null,
    status: mapOpportunityStatusToPrototype(opportunity.status),
    pitchFromAgent: opportunity.interpretation?.reasoning || opportunity.presentation?.callToAction || '',
    introVia: opportunity.introducedBy?.name || '',
    hidden: opportunity.status === 'latent',
    source: opportunity,
  }));
}

/**
 * Convert API pending questions into the current clarifier shape.
 * @param {Array<Object>} questions
 */
export function mapClarifiers(questions = []) {
  return questions.map(mapClarifier);
}

/**
 * Convert one API question into a current clarifier shape.
 * @param {Object} question
 */
export function mapClarifier(question) {
  const options = Array.isArray(question.payload?.options) ? question.payload.options : [];
  return {
    id: question.id,
    source: question.detection?.mode || 'agent',
    effect: 'neutral',
    sourceMeta: question.detection || {},
    text: question.payload?.prompt || question.payload?.title || '',
    chips: options.map((option) => option.label).filter(Boolean),
    triggersHint: question.payload?.multiSelect ? 'choose all that apply' : '',
    apiQuestion: question,
  };
}

/**
 * Compose a HALO_DATA-like snapshot without mutating window.HALO_DATA.
 * @param {Object} input
 * @param {Object} [input.user]
 * @param {Array<Object>} [input.networks]
 * @param {Array<Object>} [input.intents]
 * @param {Array<Object>} [input.questions]
 * @param {Array<Object>} [input.homeSections]
 * @param {Array<Object>} [input.opportunities]
 */
export function mapHaloSnapshot(input = {}) {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  const homeSections = Array.isArray(input.homeSections) ? input.homeSections : [];
  const opportunityRows = Array.isArray(input.opportunities) ? input.opportunities : [];
  const people = homeSections.length
    ? mapPeopleFromHomeSections(homeSections)
    : mapPeopleFromOpportunities(opportunityRows);

  return {
    EVENT: mapEventSummary({ networks: input.networks, user: input.user }),
    INTENTS: mapIntents(input.intents || [], questions),
    PEOPLE: people.filter((person) => !person.hidden),
    POOL: people.filter((person) => person.hidden),
    CLARIFIERS: mapClarifiers(questions),
    FIELD_EVENTS: [],
    AMBIENT_NOTES: [],
  };
}

/**
 * @param {string | undefined} status
 */
export function mapOpportunityStatusToPrototype(status) {
  switch (status) {
    case 'accepted':
      return 'accepted';
    case 'pending':
    case 'draft':
      return 'ready';
    case 'negotiating':
    case 'stalled':
      return 'negotiating';
    case 'rejected':
      return 'passed';
    case 'expired':
      return 'expired';
    case 'latent':
    default:
      return 'considering';
  }
}

/**
 * @param {Array<Object>} questions
 * @returns {Map<string, number>}
 */
function countQuestionsBySource(questions) {
  const counts = new Map();
  for (const question of questions) {
    const sourceId = question?.detection?.sourceId;
    if (!sourceId) continue;
    counts.set(sourceId, (counts.get(sourceId) || 0) + 1);
  }
  return counts;
}

/**
 * @param {Array<unknown>} values
 * @returns {Array<string>}
 */
function compact(values) {
  return values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
}

/**
 * @param {string | Date} isoDate
 */
function relativeAge(isoDate) {
  const time = new Date(isoDate).getTime();
  if (Number.isNaN(time)) return '';
  const diffMs = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
