import { buildFrozenCase } from './hyde.case-builder.js';
import type { HydeEvalCase } from '../hyde.types.js';

interface ProfileSeed {
  id: string;
  source: string;
  profile: string;
  request: string;
  place: string;
  arrangement: string;
  profilePlace: string;
  profileDomain: string;
  adjacent: string;
}

const SEEDS: readonly ProfileSeed[] = [
  {
    id: 'nairobi-solar-grants',
    source: 'I am building open-source software for community-owned solar microgrids in Nairobi and seeking grant funders.',
    profile: 'I previously led oncology commercialization at HelixNova in Boston.',
    request: 'grant funding for open-source community-owned solar microgrid software', place: 'Nairobi', arrangement: 'non-dilutive grants', profilePlace: 'Boston', profileDomain: 'oncology commercialization', adjacent: 'commercial solar installation',
  },
  {
    id: 'osaka-eldercare-volunteers',
    source: 'Our Osaka neighborhood association needs Japanese-speaking volunteers to teach seniors how to use telehealth portals.',
    profile: 'I spent six years selling cybersecurity software to banks in Singapore.',
    request: 'Japanese-language volunteer instruction for seniors using telehealth portals', place: 'Osaka', arrangement: 'unpaid neighborhood sessions', profilePlace: 'Singapore', profileDomain: 'banking cybersecurity sales', adjacent: 'hospital IT procurement',
  },
  {
    id: 'bogota-cacao-cooperative',
    source: 'Seeking a fair-trade distributor for a women-owned cacao cooperative outside Bogotá, with no exclusivity requirement.',
    profile: 'My prior startup imported luxury wine into Miami under exclusive regional contracts.',
    request: 'fair-trade distribution for a women-owned cacao cooperative', place: 'Bogotá', arrangement: 'non-exclusive distribution', profilePlace: 'Miami', profileDomain: 'luxury wine importing', adjacent: 'commodity cocoa brokerage',
  },
  {
    id: 'helsinki-deaf-theatre',
    source: 'Looking for a Finnish Sign Language dramaturg to advise a community theatre production in Helsinki.',
    profile: 'I formerly produced English-language television commercials in Los Angeles.',
    request: 'Finnish Sign Language dramaturgy for a community theatre production', place: 'Helsinki', arrangement: 'short advisory engagement', profilePlace: 'Los Angeles', profileDomain: 'television advertising', adjacent: 'general theatre lighting',
  },
  {
    id: 'kampala-water-repair',
    source: 'A Kampala water committee needs a local trainer for hand-pump maintenance using repairable, non-proprietary parts.',
    profile: 'I worked on cloud infrastructure partnerships for a proprietary hardware vendor in Berlin.',
    request: 'local hand-pump maintenance training using repairable non-proprietary parts', place: 'Kampala', arrangement: 'community-owned training', profilePlace: 'Berlin', profileDomain: 'proprietary cloud hardware', adjacent: 'industrial water consulting',
  },
  {
    id: 'montreal-indigenous-archives',
    source: 'Seeking a Montréal archivist experienced in Indigenous data sovereignty for a community-controlled oral-history collection.',
    profile: 'I previously managed a public stock-photo library in Toronto.',
    request: 'Indigenous data-sovereignty archival support for a community-controlled oral-history collection', place: 'Montréal', arrangement: 'community governance', profilePlace: 'Toronto', profileDomain: 'commercial stock photography', adjacent: 'museum digitization',
  },
  {
    id: 'thessaloniki-refugee-kitchen',
    source: 'Our refugee-run kitchen in Thessaloniki needs a pro bono food-safety mentor who speaks Arabic or Greek.',
    profile: 'I used to operate a premium restaurant franchise in Dubai.',
    request: 'Arabic- or Greek-speaking food-safety mentoring for a refugee-run kitchen', place: 'Thessaloniki', arrangement: 'pro bono mentoring', profilePlace: 'Dubai', profileDomain: 'premium restaurant franchising', adjacent: 'commercial catering supply',
  },
  {
    id: 'chiang-mai-seed-library',
    source: 'Looking for an open-pollinated seed curator to help a farmer-run seed library near Chiang Mai.',
    profile: 'My career has focused on patented crop genetics for a multinational in St. Louis.',
    request: 'open-pollinated seed curation for a farmer-run seed library', place: 'Chiang Mai', arrangement: 'farmer-controlled commons', profilePlace: 'St. Louis', profileDomain: 'patented crop genetics', adjacent: 'agricultural input sales',
  },
  {
    id: 'reykjavik-youth-radio',
    source: 'A youth-run Reykjavík radio collective seeks an Icelandic audio engineer for monthly volunteer clinics.',
    profile: 'I produced daily finance podcasts for a paid subscription network in New York.',
    request: 'Icelandic audio-engineering clinics for a youth-run radio collective', place: 'Reykjavík', arrangement: 'monthly volunteering', profilePlace: 'New York', profileDomain: 'subscription finance podcasting', adjacent: 'broadcast equipment rental',
  },
  {
    id: 'cebu-coral-mapping',
    source: 'Seeking a Cebu-based marine scientist to validate community coral maps, with all data remaining openly licensed.',
    profile: 'I previously built proprietary shipping analytics in Rotterdam.',
    request: 'marine-science validation of openly licensed community coral maps', place: 'Cebu', arrangement: 'open-data collaboration', profilePlace: 'Rotterdam', profileDomain: 'proprietary shipping analytics', adjacent: 'commercial dive tourism',
  },
  {
    id: 'detroit-tenant-energy',
    source: 'A Detroit tenant union needs an independent energy auditor who will not market retrofit products.',
    profile: 'I led enterprise sales for a heat-pump manufacturer in Austin.',
    request: 'independent energy auditing for a tenant union', place: 'Detroit', arrangement: 'no product sales', profilePlace: 'Austin', profileDomain: 'heat-pump enterprise sales', adjacent: 'residential retrofit installation',
  },
  {
    id: 'tbilisi-disability-maps',
    source: 'Looking for a Georgian accessibility researcher to audit wheelchair routes in Tbilisi with local disability groups.',
    profile: 'I once designed luxury travel itineraries for Paris hotels.',
    request: 'Georgian-language wheelchair-route research with disability groups', place: 'Tbilisi', arrangement: 'participatory accessibility audit', profilePlace: 'Paris', profileDomain: 'luxury travel planning', adjacent: 'tourist wayfinding',
  },
  {
    id: 'suva-cyclone-radio',
    source: 'Seeking a Fiji-based radio technician to train village operators on repairable cyclone-warning transmitters.',
    profile: 'My background is in satellite television licensing in Sydney.',
    request: 'training village operators to repair cyclone-warning radio transmitters', place: 'Suva', arrangement: 'local repair capacity', profilePlace: 'Sydney', profileDomain: 'satellite television licensing', adjacent: 'consumer electronics retail',
  },
  {
    id: 'brno-open-mobility',
    source: 'A Brno civic group needs a transport modeller to publish an open analysis of safe night-bus routes.',
    profile: 'I previously optimized private ride-hailing fleets in San Francisco.',
    request: 'open transport modelling for safe night-bus routes', place: 'Brno', arrangement: 'publicly licensed analysis', profilePlace: 'San Francisco', profileDomain: 'private ride-hailing optimization', adjacent: 'traffic sensor sales',
  },
  {
    id: 'marrakesh-artisan-catalogue',
    source: 'Seeking a Darija-speaking photographer in Marrakesh for a cooperative-owned artisan catalogue with shared copyrights.',
    profile: 'I formerly shot exclusive fashion campaigns for a Milan agency.',
    request: 'Darija-language photography for a cooperative-owned artisan catalogue', place: 'Marrakesh', arrangement: 'shared copyrights', profilePlace: 'Milan', profileDomain: 'exclusive fashion campaigns', adjacent: 'tourism photography',
  },
];

export const PROFILE_CONTEXT_CONTAMINATION_CASES: HydeEvalCase[] = SEEDS.map((seed) => buildFrozenCase({
  id: `profile-context-contamination/${seed.id}`,
  stratum: 'profile-context-contamination',
  description: `Profile history must not contaminate the explicit ${seed.place} request.`,
  sourceText: seed.source,
  profileContext: seed.profile,
  positives: [
    { corpus: 'premises', text: `I can provide ${seed.request} in ${seed.place} through ${seed.arrangement}.` },
    { corpus: 'intents', text: `I am available in ${seed.place} to support ${seed.request}, and I accept ${seed.arrangement}.` },
  ],
  hardNegatives: [
    { corpus: 'premises', positive: 1, axis: 'profile-location', rationale: `Substitutes ${seed.profilePlace} from profile context for ${seed.place}.`, text: `I can provide ${seed.request} in ${seed.profilePlace} through ${seed.arrangement}.` },
    { corpus: 'intents', positive: 1, axis: 'profile-domain', rationale: `Replaces the source task with ${seed.profileDomain} from profile context.`, text: `I work in ${seed.place} and can advise on ${seed.profileDomain} through ${seed.arrangement}.` },
    { corpus: 'premises', positive: 2, axis: 'commercial-model', rationale: `Violates the requested arrangement while retaining topical language.`, text: `I offer ${seed.request} in ${seed.place}, but only as a commercial exclusive engagement rather than ${seed.arrangement}.` },
    { corpus: 'intents', positive: 2, axis: 'role-polarity', rationale: 'Keeps the grounded task, place, and arrangement but reverses provider and seeker.', text: `I am in ${seed.place} seeking someone else to provide ${seed.request} through ${seed.arrangement}; I do not provide it.` },
  ],
  distractors: [
    { corpus: 'intents', text: `I am looking to purchase services for ${seed.adjacent} in ${seed.place}.` },
    { corpus: 'premises', text: `My organization studies ${seed.adjacent} globally but has no activity in ${seed.place}.` },
    { corpus: 'intents', text: `I need introductions to investors interested in ${seed.profileDomain}.` },
    { corpus: 'premises', text: `I publish general research about ${seed.request} but do not provide operational support.` },
  ],
}));
