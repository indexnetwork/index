import { buildFrozenCase } from './hyde.case-builder.js';
import type { HydeEvalCase } from '../hyde.types.js';

interface CredentialSeed {
  id: string;
  source: string;
  profile?: string;
  role: string;
  organization: string;
  requirement: string;
  inventedCredential: string;
  wrongOrganization: string;
  exclusivity: string;
  conflict: string;
}

const SEEDS: readonly CredentialSeed[] = [
  { id: 'robotics-nonprofit-advisor', source: 'Looking for a technical advisor to help an early-stage robotics education nonprofit; practical classroom experience matters, but elite university or venture credentials do not.', profile: 'My day job is enterprise procurement for a Fortune 100 manufacturer.', role: 'technical advisor', organization: 'an early-stage robotics education nonprofit', requirement: 'practical classroom robotics experience', inventedCredential: 'a Carnegie Mellon professorship', wrongOrganization: 'a Series A venture-backed edtech company', exclusivity: 'no elite-school prerequisite', conflict: 'venture-only advisory terms' },
  { id: 'community-clinic-bookkeeper', source: 'A volunteer-run community clinic needs a part-time bookkeeper familiar with charity accounts, independent of its current medical supplier.', role: 'part-time bookkeeper', organization: 'a volunteer-run community clinic', requirement: 'charity-accounting experience', inventedCredential: 'Big Four audit partnership', wrongOrganization: 'a private hospital chain', exclusivity: 'independence from the current medical supplier', conflict: 'employment by that supplier' },
  { id: 'open-source-security-reviewer', source: 'Seeking an independent reviewer for an open-source encryption library; no vendor certification is required and employees of CipherCorp are excluded.', role: 'security reviewer', organization: 'an open-source encryption project', requirement: 'hands-on cryptographic code review', inventedCredential: 'CipherCorp Platinum certification', wrongOrganization: 'CipherCorp’s proprietary product team', exclusivity: 'independence from CipherCorp', conflict: 'current CipherCorp employment' },
  { id: 'tenant-mediator-no-landlord', source: 'A tenant association needs a trained mediator who has not represented the building owner in the past three years.', role: 'trained mediator', organization: 'a tenant association', requirement: 'housing-dispute mediation experience', inventedCredential: 'national bar partnership', wrongOrganization: 'the building owner’s legal team', exclusivity: 'no recent representation of the owner', conflict: 'representation of the owner last year' },
  { id: 'cooperative-board-trainer', source: 'Seeking a governance trainer for a worker cooperative; cooperative experience is required, an MBA is not, and franchise consultants are unsuitable.', role: 'governance trainer', organization: 'a worker cooperative', requirement: 'worker-cooperative governance experience', inventedCredential: 'an Ivy League MBA', wrongOrganization: 'a franchise operator', exclusivity: 'cooperative rather than franchise practice', conflict: 'franchise-only consulting' },
  { id: 'rural-midwife-mentor', source: 'A rural birth center needs a licensed midwife mentor; hospital executive status is irrelevant and candidates cannot recruit for a staffing agency.', role: 'midwife mentor', organization: 'a rural birth center', requirement: 'an active midwifery license and mentoring practice', inventedCredential: 'hospital chief-medical-officer status', wrongOrganization: 'a national hospital staffing agency', exclusivity: 'no staffing-agency recruitment', conflict: 'paid recruiting quotas' },
  { id: 'public-interest-data-counsel', source: 'A civic data nonprofit seeks privacy counsel with public-interest experience and no current clients among the ad-tech firms being investigated.', role: 'privacy counsel', organization: 'a civic data nonprofit', requirement: 'public-interest privacy experience', inventedCredential: 'former federal-judge status', wrongOrganization: 'an ad-tech trade association', exclusivity: 'no current investigated ad-tech clients', conflict: 'retainer from an investigated firm' },
  { id: 'museum-provenance-researcher', source: 'A local museum needs a provenance researcher fluent in Polish; a doctorate is optional, and auction-house employees cannot lead the review.', role: 'provenance researcher', organization: 'a local museum', requirement: 'Polish fluency and provenance research', inventedCredential: 'an Oxford art-history doctorate', wrongOrganization: 'an international auction house', exclusivity: 'independence from auction houses', conflict: 'current auction-house employment' },
  { id: 'mutual-aid-food-safety', source: 'A mutual-aid pantry wants a food-safety trainer with current local certification, not a sales representative for a food distributor.', role: 'food-safety trainer', organization: 'a mutual-aid pantry', requirement: 'current local food-safety certification', inventedCredential: 'Michelin-star chef status', wrongOrganization: 'a national food distributor', exclusivity: 'training without product sales', conflict: 'commissioned distributor sales' },
  { id: 'independent-pension-actuary', source: 'A union pension committee needs a credentialed actuary who has no financial relationship with the employer’s benefits broker.', role: 'pension actuary', organization: 'a union pension committee', requirement: 'recognized actuarial credentials', inventedCredential: 'former central-bank governorship', wrongOrganization: 'the employer’s benefits brokerage', exclusivity: 'financial independence from the broker', conflict: 'broker revenue sharing' },
  { id: 'language-school-safeguarding', source: 'A refugee language school needs a safeguarding lead with youth-work checks; corporate HR certification is not a substitute.', role: 'safeguarding lead', organization: 'a refugee language school', requirement: 'current youth-work safeguarding checks', inventedCredential: 'corporate HR executive certification', wrongOrganization: 'an executive recruitment firm', exclusivity: 'direct safeguarding responsibility', conflict: 'recruitment-only experience' },
  { id: 'citizen-science-ethics', source: 'A citizen-science network seeks an ethics advisor with community research experience, excluding anyone reviewing its grant for the funder.', role: 'research ethics advisor', organization: 'a citizen-science network', requirement: 'community research ethics experience', inventedCredential: 'medical-school dean status', wrongOrganization: 'the grant-making foundation’s review panel', exclusivity: 'no role in the funder’s grant decision', conflict: 'simultaneous grant review authority' },
  { id: 'repair-cafe-electrician', source: 'A repair café needs a licensed electrician willing to teach; manufacturer authorization is unnecessary and warranty-sales agents are excluded.', role: 'electrical safety instructor', organization: 'a volunteer repair café', requirement: 'an electrical license and teaching willingness', inventedCredential: 'exclusive manufacturer authorization', wrongOrganization: 'an appliance warranty company', exclusivity: 'no warranty-product sales', conflict: 'commissioned warranty sales' },
  { id: 'local-news-fact-checker', source: 'An independent local newsroom seeks a fact-checker with election coverage experience who is not employed by a political campaign.', role: 'election fact-checker', organization: 'an independent local newsroom', requirement: 'election reporting and source-verification experience', inventedCredential: 'Pulitzer Prize winner status', wrongOrganization: 'a mayoral campaign', exclusivity: 'no campaign employment', conflict: 'current campaign communications role' },
  { id: 'community-land-surveyor', source: 'A community land trust needs a registered surveyor; luxury-development credentials add no value and bidders tied to the acquiring developer are ineligible.', role: 'registered land surveyor', organization: 'a community land trust', requirement: 'local surveyor registration', inventedCredential: 'luxury-development fellowship', wrongOrganization: 'the acquiring property developer', exclusivity: 'no financial tie to the developer', conflict: 'subcontracting revenue from the developer' },
];

export const CREDENTIAL_ORGANIZATION_EXCLUSIVITY_CASES: HydeEvalCase[] = SEEDS.map((seed) => buildFrozenCase({
  id: `credential-organization-exclusivity/${seed.id}`,
  stratum: 'credential-organization-exclusivity',
  description: `The ${seed.role} must satisfy the stated qualification and ${seed.exclusivity}.`,
  sourceText: seed.source,
  ...(seed.profile ? { profileContext: seed.profile } : {}),
  positives: [
    { corpus: 'premises', text: `I provide ${seed.role} support to ${seed.organization}, with ${seed.requirement} and ${seed.exclusivity}.` },
    { corpus: 'intents', text: `I am available as a ${seed.role} for ${seed.organization}; my relevant qualification is ${seed.requirement}, and I meet ${seed.exclusivity}.` },
  ],
  hardNegatives: [
    { corpus: 'premises', positive: 1, axis: 'invented-credential', rationale: `Keeps provider polarity and ${seed.organization}, but substitutes ${seed.inventedCredential} for the actual requirement and explicitly lacks ${seed.requirement}.`, text: `I provide ${seed.role} support to ${seed.organization} based on ${seed.inventedCredential}; I do not have ${seed.requirement}.` },
    { corpus: 'intents', positive: 2, axis: 'organization-substitution', rationale: `Substitutes ${seed.wrongOrganization} for the named organization type.`, text: `I am available as a ${seed.role} for ${seed.wrongOrganization}, not for ${seed.organization}.` },
    { corpus: 'premises', positive: 1, axis: 'exclusivity-conflict', rationale: `Violates ${seed.exclusivity} through ${seed.conflict}.`, text: `I have ${seed.requirement}, but my work involves ${seed.conflict}, which conflicts with ${seed.exclusivity}.` },
    { corpus: 'intents', positive: 2, axis: 'role-polarity', rationale: 'Keeps the qualification, organization, and independence constraints but reverses provider and seeker.', text: `I represent ${seed.organization} and am seeking a ${seed.role} with ${seed.requirement} and ${seed.exclusivity}; I do not provide that role.` },
  ],
  distractors: [
    { corpus: 'intents', text: `I need general fundraising advice for ${seed.organization}.` },
    { corpus: 'premises', text: `I maintain a directory of people with ${seed.requirement} but do not offer ${seed.role} services.` },
    { corpus: 'intents', text: `I am researching how ${seed.wrongOrganization} hires senior executives.` },
    { corpus: 'premises', text: `I teach an introductory course mentioning ${seed.role} work without holding the relevant qualification.` },
  ],
}));
