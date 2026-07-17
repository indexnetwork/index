import { buildFrozenCase } from './hyde.case-builder.js';
import type { HydeEvalCase } from '../hyde.types.js';

interface RoleSeed {
  id: string;
  source: string;
  sourceRole: string;
  counterpartRole: string;
  exchange: string;
  constraint: string;
  adjacentRole: string;
}

const SEEDS: readonly RoleSeed[] = [
  { id: 'buyer-of-reclaimed-timber', source: 'I want to buy reclaimed oak beams for a community hall and need a supplier, not another buyer.', sourceRole: 'buyer', counterpartRole: 'supplier', exchange: 'sell reclaimed oak beams for a community hall', constraint: 'verified reclaimed stock', adjacentRole: 'timber appraiser' },
  { id: 'mentor-seeking-apprentice', source: 'I am an experienced bicycle mechanic offering a free apprenticeship and looking for a committed learner.', sourceRole: 'mentor', counterpartRole: 'apprentice', exchange: 'learn bicycle repair through a free apprenticeship', constraint: 'commitment to attend weekly', adjacentRole: 'bike-shop customer' },
  { id: 'venue-offering-rehearsal-space', source: 'Our church can offer its hall free on Tuesday evenings to a neighborhood choir that needs rehearsal space.', sourceRole: 'venue provider', counterpartRole: 'choir seeking space', exchange: 'use a free hall for Tuesday-evening rehearsals', constraint: 'neighborhood choir use', adjacentRole: 'event caterer' },
  { id: 'translator-needs-manuscript', source: 'I translate Swahili literature pro bono and am looking for a rights-holder with an unpublished manuscript.', sourceRole: 'translator offering service', counterpartRole: 'manuscript rights-holder', exchange: 'provide an unpublished Swahili manuscript for pro bono translation', constraint: 'authority to grant translation rights', adjacentRole: 'literary critic' },
  { id: 'farm-seeking-compost', source: 'Our urban farm needs to receive clean food-waste compost from a local producer; we are not offering waste collection.', sourceRole: 'compost recipient', counterpartRole: 'compost producer', exchange: 'supply clean food-waste compost to an urban farm', constraint: 'contaminant-tested compost', adjacentRole: 'waste-hauling consultant' },
  { id: 'data-owner-offering-dataset', source: 'I maintain an anonymized bird-migration dataset and want a university lab to analyze it under an open license.', sourceRole: 'dataset owner', counterpartRole: 'research lab', exchange: 'analyze an anonymized bird-migration dataset', constraint: 'openly licensed results', adjacentRole: 'data storage vendor' },
  { id: 'investor-seeking-borrower', source: 'Our community fund can provide patient debt and seeks a worker-owned bakery that needs financing.', sourceRole: 'lender', counterpartRole: 'worker-owned borrower', exchange: 'borrow patient debt for a worker-owned bakery', constraint: 'worker ownership', adjacentRole: 'commercial loan broker' },
  { id: 'researcher-recruiting-participants', source: 'I am recruiting caregivers for paid interviews about dementia services; I am not seeking another researcher.', sourceRole: 'researcher', counterpartRole: 'caregiver participant', exchange: 'participate in paid dementia-service interviews', constraint: 'first-hand caregiving experience', adjacentRole: 'clinical recruiter' },
  { id: 'tool-library-donating-drills', source: 'A tool library is giving away 20 refurbished drills to mutual-aid groups that will lend them out.', sourceRole: 'equipment donor', counterpartRole: 'mutual-aid recipient', exchange: 'receive refurbished drills for community lending', constraint: 'noncommercial tool lending', adjacentRole: 'repair technician' },
  { id: 'festival-booking-musician', source: 'Our festival wants to hire a Roma brass ensemble for a paid performance; booking agents without a performing group are not enough.', sourceRole: 'event buyer', counterpartRole: 'performing ensemble', exchange: 'perform Roma brass music at a paid festival booking', constraint: 'an available performing group', adjacentRole: 'music journalist' },
  { id: 'developer-offering-code-review', source: 'I can volunteer two hours of accessibility code review and seek a small nonprofit with a live web application.', sourceRole: 'volunteer reviewer', counterpartRole: 'nonprofit receiving review', exchange: 'receive accessibility code review for a live web application', constraint: 'a small nonprofit project', adjacentRole: 'hosting provider' },
  { id: 'school-selling-surplus-desks', source: 'A school is selling 30 surplus desks at cost and needs a community center able to collect them.', sourceRole: 'seller', counterpartRole: 'collecting buyer', exchange: 'buy and collect 30 surplus school desks at cost', constraint: 'community-center use', adjacentRole: 'furniture mover' },
  { id: 'host-family-seeking-student', source: 'We can host one exchange student for August and are looking for a placement organization needing a host family.', sourceRole: 'host family', counterpartRole: 'placement organization', exchange: 'place one exchange student with an August host family', constraint: 'formal safeguarding support', adjacentRole: 'travel insurer' },
  { id: 'beekeeper-needs-land', source: 'I manage ten beehives and need a pesticide-free landowner willing to host them; I am not renting land to others.', sourceRole: 'beekeeper seeking site', counterpartRole: 'land host', exchange: 'host ten managed beehives on pesticide-free land', constraint: 'no pesticide use', adjacentRole: 'honey retailer' },
  { id: 'clinic-offering-vaccination', source: 'Our mobile clinic offers free vaccinations and seeks shelters that need an on-site vaccination day.', sourceRole: 'health-service provider', counterpartRole: 'shelter receiving service', exchange: 'host an on-site free vaccination day', constraint: 'access for shelter residents', adjacentRole: 'medical equipment supplier' },
];

export const ROLE_POLARITY_CONTROLS_CASES: HydeEvalCase[] = SEEDS.map((seed) => buildFrozenCase({
  id: `role-polarity-controls/${seed.id}`,
  stratum: 'role-polarity-controls',
  description: `Retrieval must find the reciprocal ${seed.counterpartRole}, not another ${seed.sourceRole}.`,
  sourceText: seed.source,
  positives: [
    { corpus: 'intents', text: `As a ${seed.counterpartRole}, I can ${seed.exchange} while meeting ${seed.constraint}.` },
    { corpus: 'premises', text: `My current role is ${seed.counterpartRole}; I am ready to ${seed.exchange}, with ${seed.constraint}.` },
  ],
  hardNegatives: [
    { corpus: 'intents', positive: 1, axis: 'same-role-polarity', rationale: `Duplicates the source-side ${seed.sourceRole} instead of supplying the reciprocal role.`, text: `I am also a ${seed.sourceRole} looking for a ${seed.counterpartRole} who can ${seed.exchange}.` },
    { corpus: 'premises', positive: 2, axis: 'reciprocal-role-reversal', rationale: `Explicitly refuses the required ${seed.counterpartRole} role.`, text: `I work as a ${seed.sourceRole}, not as a ${seed.counterpartRole}, and need someone else to ${seed.exchange}.` },
    { corpus: 'intents', positive: 1, axis: 'transaction-direction', rationale: 'Uses the same object and action but reverses who gives and receives.', text: `Seeking another ${seed.sourceRole}; I cannot ${seed.exchange} and instead want to receive that offer.` },
    { corpus: 'premises', positive: 2, axis: 'counterpart-constraint', rationale: `Keeps the reciprocal ${seed.counterpartRole} role but violates ${seed.constraint}.`, text: `I am a ${seed.counterpartRole} ready to ${seed.exchange}, but I explicitly cannot meet ${seed.constraint}.` },
  ],
  distractors: [
    { corpus: 'premises', text: `I am a ${seed.adjacentRole} writing about this sector without joining the exchange.` },
    { corpus: 'intents', text: `I need a grant to study how ${seed.sourceRole}s and ${seed.counterpartRole}s collaborate.` },
    { corpus: 'premises', text: `My directory lists possible ${seed.counterpartRole}s but does not verify ${seed.constraint}.` },
    { corpus: 'intents', text: `I want unrelated marketing support for my work as a ${seed.adjacentRole}.` },
  ],
}));
