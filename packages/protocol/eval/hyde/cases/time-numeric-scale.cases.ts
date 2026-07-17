import { buildFrozenCase } from './hyde.case-builder.js';
import type { HydeEvalCase } from '../hyde.types.js';

interface TimeScaleSeed {
  id: string;
  source: string;
  profile?: string;
  activity: string;
  timing: string;
  wrongTiming: string;
  scale: string;
  wrongScale: string;
  unit: string;
}

const SEEDS: readonly TimeScaleSeed[] = [
  { id: 'portugal-september-packaging', source: 'Seeking a manufacturing partner for biodegradable food packaging in Portugal; the 8,000-unit pilot must start in September.', profile: 'I split my time between Madrid and London and previously scaled a million-unit plastics line.', activity: 'manufacture biodegradable food packaging in Portugal', timing: 'September', wrongTiming: 'January 2027', scale: '8,000 units', wrongScale: 'one million units', unit: 'pilot run' },
  { id: 'december-200-wool-blankets', source: 'A shelter needs 200 washable wool blankets delivered to Dundee by 10 December, not after New Year.', activity: 'supply washable wool blankets to Dundee', timing: 'by 10 December', wrongTiming: 'after New Year', scale: '200 blankets', wrongScale: '2,000 blankets', unit: 'shelter delivery' },
  { id: 'six-week-25-person-trial', source: 'Looking for a clinic to run a six-week physiotherapy pilot with exactly 25 participants beginning in May.', activity: 'run a physiotherapy pilot', timing: 'for six weeks beginning in May', wrongTiming: 'for six months beginning in November', scale: '25 participants', wrongScale: '250 participants', unit: 'clinical pilot' },
  { id: 'weekly-40-crates-produce', source: 'Our school cooperative needs 40 crates of produce every Monday during the 12-week autumn term.', activity: 'deliver produce to a school cooperative', timing: 'every Monday for the 12-week autumn term', wrongTiming: 'once at the end of the school year', scale: '40 crates per delivery', wrongScale: '400 crates per delivery', unit: 'produce schedule' },
  { id: 'three-night-60-bed-retreat', source: 'Seeking a rural venue for a three-night retreat in March with 60 beds; a day venue will not work.', activity: 'host a residential rural retreat', timing: 'for three nights in March', wrongTiming: 'for one day in July', scale: '60 beds', wrongScale: '600 beds', unit: 'retreat booking' },
  { id: '48-hour-12-sample-sequencing', source: 'Need a lab that can sequence 12 urgent soil samples within 48 hours of receipt.', activity: 'sequence urgent soil samples', timing: 'within 48 hours of receipt', wrongTiming: 'within six weeks', scale: '12 samples', wrongScale: '1,200 samples', unit: 'lab batch' },
  { id: 'june-500-copy-zine', source: 'A youth collective wants 500 risograph copies of its zine printed during the first week of June.', activity: 'risograph-print a youth zine', timing: 'during the first week of June', wrongTiming: 'in late September', scale: '500 copies', wrongScale: '50,000 copies', unit: 'print run' },
  { id: 'quarterly-18-home-audits', source: 'We need an auditor for 18 homes per quarter, starting Q2; this is not a daily high-volume contract.', activity: 'perform residential energy audits', timing: 'quarterly starting Q2', wrongTiming: 'daily starting next year', scale: '18 homes per quarter', wrongScale: '180 homes per day', unit: 'audit program' },
  { id: 'november-3-tonne-olive-press', source: 'A growers group needs access to an olive press for a three-tonne batch in the second half of November.', activity: 'press a growers group’s olives', timing: 'in the second half of November', wrongTiming: 'during the July harvest', scale: 'three tonnes', wrongScale: '300 tonnes', unit: 'pressing batch' },
  { id: '90-minute-8-interpreters', source: 'Seeking eight interpreters for a 90-minute online assembly at 14:00 UTC on 22 April.', activity: 'interpret an online assembly', timing: 'for 90 minutes at 14:00 UTC on 22 April', wrongTiming: 'for a full day on 23 April', scale: 'eight interpreters', wrongScale: '80 interpreters', unit: 'assembly assignment' },
  { id: 'monthly-120-water-tests', source: 'A watershed council needs 120 water tests each month from July through October.', activity: 'process watershed water tests', timing: 'monthly from July through October', wrongTiming: 'once in December', scale: '120 tests per month', wrongScale: '12,000 tests per month', unit: 'testing cycle' },
  { id: '72-hour-35-bike-repair', source: 'Need a mobile mechanic to repair 35 donated bicycles over one weekend, with completion inside 72 hours.', activity: 'repair donated bicycles', timing: 'over one weekend within 72 hours', wrongTiming: 'over the next 12 months', scale: '35 bicycles', wrongScale: '3,500 bicycles', unit: 'repair sprint' },
  { id: 'february-15-hectare-survey', source: 'Seeking an ecologist to survey a 15-hectare wetland before nesting season, no later than 20 February.', activity: 'survey a wetland before nesting season', timing: 'no later than 20 February', wrongTiming: 'in mid-June', scale: '15 hectares', wrongScale: '1,500 hectares', unit: 'field survey' },
  { id: 'biweekly-300-meal-kitchen', source: 'A mutual-aid kitchen needs capacity for 300 meals every other Thursday for the next four months.', activity: 'prepare meals for a mutual-aid kitchen', timing: 'every other Thursday for four months', wrongTiming: 'once per year', scale: '300 meals per service', wrongScale: '30,000 meals per service', unit: 'meal service' },
  { id: 'august-6-sensor-prototype', source: 'Looking for a workshop to assemble six river-sensor prototypes between 5 and 16 August.', activity: 'assemble river-sensor prototypes', timing: 'between 5 and 16 August', wrongTiming: 'after 1 December', scale: 'six prototypes', wrongScale: '6,000 production units', unit: 'prototype batch' },
];

export const TIME_NUMERIC_SCALE_CASES: HydeEvalCase[] = SEEDS.map((seed) => buildFrozenCase({
  id: `time-numeric-scale/${seed.id}`,
  stratum: 'time-numeric-scale',
  description: `The ${seed.unit} must preserve both ${seed.timing} and ${seed.scale}.`,
  sourceText: seed.source,
  ...(seed.profile ? { profileContext: seed.profile } : {}),
  positives: [
    { corpus: 'intents', text: `We can ${seed.activity} as a ${seed.scale} ${seed.unit} ${seed.timing}.` },
    { corpus: 'premises', text: `I have confirmed capacity for ${seed.scale} and can ${seed.activity} ${seed.timing}.` },
  ],
  hardNegatives: [
    { corpus: 'intents', positive: 1, axis: 'time-substitution', rationale: `Changes the explicit timing to ${seed.wrongTiming}.`, text: `We can ${seed.activity} as a ${seed.scale} ${seed.unit} ${seed.wrongTiming}.` },
    { corpus: 'premises', positive: 2, axis: 'numeric-scale-substitution', rationale: `Changes the explicit scale to ${seed.wrongScale}.`, text: `I have capacity for ${seed.wrongScale} and can ${seed.activity} ${seed.timing}.` },
    { corpus: 'intents', positive: 1, axis: 'time-window-uncertainty', rationale: 'Keeps the exact scale but cannot satisfy the bounded timing.', text: `We can ${seed.activity} at ${seed.scale}, but only ${seed.wrongTiming}, not ${seed.timing}.` },
    { corpus: 'premises', positive: 2, axis: 'minimum-scale', rationale: 'Keeps the exact timing but requires the substituted scale.', text: `I can ${seed.activity} ${seed.timing}, but my minimum capacity is ${seed.wrongScale}, not ${seed.scale}.` },
  ],
  distractors: [
    { corpus: 'premises', text: `I provide planning software for organizations that ${seed.activity}.` },
    { corpus: 'intents', text: `I am collecting market prices for a future ${seed.unit} with no fixed date.` },
    { corpus: 'premises', text: `Our warehouse can store ${seed.scale} but cannot ${seed.activity}.` },
    { corpus: 'intents', text: `I need financing for ${seed.wrongScale}, unrelated to the requested ${seed.unit}.` },
  ],
}));
