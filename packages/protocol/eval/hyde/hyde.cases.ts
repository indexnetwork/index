import type { HydeEvalCase } from './hyde.types.js';

/**
 * These are retrieval drift probes, not ordinary matching examples. Each corpus
 * keeps the domain close while changing a source-grounded role, entity, location,
 * time, or commercial constraint that unconstrained generation can invent.
 */
export const HYDE_CASES: HydeEvalCase[] = [
  {
    id: 'profile-boundary/nairobi-solar-grants',
    description: 'Profile context must not move a Nairobi grant search toward an unrelated location or financing model.',
    sourceText: 'I am building open-source software for community-owned solar microgrids in Nairobi and seeking grant funders.',
    profileContext: 'I previously led oncology commercialization at HelixNova in Boston.',
    expectedTargetId: 'nairobi-solar-grantmaker',
    candidates: [
      {
        id: 'nairobi-solar-grantmaker',
        role: 'target',
        corpus: 'premises',
        text: 'I run a grant program in Nairobi that funds open-source tools for community-owned solar microgrids.',
      },
      {
        id: 'boston-grid-equity-fund',
        role: 'trap',
        corpus: 'premises',
        text: 'I am a Boston climate-tech venture investor taking equity stakes in proprietary utility-scale grid software.',
      },
      {
        id: 'nairobi-solar-engineer',
        role: 'distractor',
        corpus: 'intents',
        text: 'I am a Nairobi solar engineer seeking paid implementation work on commercial microgrid projects.',
      },
      {
        id: 'kenya-carbon-lender',
        role: 'distractor',
        corpus: 'premises',
        text: 'I provide debt financing for carbon-credit projects across Kenya, focused on repayment-backed installations.',
      },
    ],
  },
  {
    id: 'constraint-drift/robotics-nonprofit-advisor',
    description: 'Generation must not invent elite credentials, named universities, or venture requirements for a generic advisor need.',
    sourceText: 'Looking for a technical advisor to help an early-stage robotics education nonprofit.',
    profileContext: 'My day job is enterprise procurement for a Fortune 100 manufacturer.',
    expectedTargetId: 'nonprofit-robotics-advisor',
    candidates: [
      {
        id: 'nonprofit-robotics-advisor',
        role: 'target',
        corpus: 'premises',
        text: 'I advise early-stage nonprofit teams on robotics education programs, technical architecture, and safe classroom deployment.',
      },
      {
        id: 'credentialed-edtech-advisor',
        role: 'trap',
        corpus: 'premises',
        text: 'I am a Carnegie Mellon robotics professor who advises venture-backed edtech companies after their Series A.',
      },
      {
        id: 'robotics-teacher-seeking-advisor',
        role: 'distractor',
        corpus: 'intents',
        text: 'I teach a school robotics club and am looking for an experienced technical advisor for my own curriculum.',
      },
      {
        id: 'robotics-hardware-sales',
        role: 'distractor',
        corpus: 'intents',
        text: 'I want to sell classroom robotics kits to education nonprofits through annual procurement contracts.',
      },
    ],
  },
  {
    id: 'location-time-drift/portugal-packaging-pilot',
    description: 'Explicit Portugal and September constraints should survive reciprocal generation without invented scale or dates.',
    sourceText: 'Seeking a manufacturing partner for biodegradable food packaging in Portugal; the pilot must start in September.',
    profileContext: 'I split my time between Madrid and London and previously scaled a million-unit plastics line.',
    expectedTargetId: 'portugal-september-manufacturer',
    candidates: [
      {
        id: 'portugal-september-manufacturer',
        role: 'target',
        corpus: 'intents',
        text: 'We manufacture biodegradable food packaging in Portugal and can begin a pilot production run in September.',
      },
      {
        id: 'spain-million-unit-2027',
        role: 'trap',
        corpus: 'intents',
        text: 'Our Spanish packaging plant accepts only one-million-unit orders and is booking biodegradable production for 2027.',
      },
      {
        id: 'portugal-packaging-investor',
        role: 'distractor',
        corpus: 'premises',
        text: 'I invest in sustainable packaging companies in Portugal but do not operate manufacturing facilities.',
      },
      {
        id: 'portugal-plastics-manufacturer',
        role: 'distractor',
        corpus: 'intents',
        text: 'We manufacture conventional plastic food containers in Portugal and are not equipped for biodegradable materials.',
      },
    ],
  },
];
