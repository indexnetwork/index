import { buildFrozenCase } from './hyde.case-builder.js';
import type { HydeEvalCase } from '../hyde.types.js';

interface EntityLocationSeed {
  id: string;
  source: string;
  entity: string;
  substituteEntity: string;
  location: string;
  substituteLocation: string;
  activity: string;
  adjacent: string;
}

const SEEDS: readonly EntityLocationSeed[] = [
  { id: 'porto-lusofoods-packaging', source: 'LusoFoods needs a compostable tray manufacturer within Portugal for its Porto meal pilot.', entity: 'LusoFoods', substituteEntity: 'IberiaFresh', location: 'Portugal', substituteLocation: 'Spain', activity: 'manufacture compostable trays for a Porto meal pilot', adjacent: 'recycle cardboard cartons' },
  { id: 'kyoto-aoba-museum', source: 'The Aoba Museum in Kyoto seeks a conservator for its specific collection of Meiji-era paper maps.', entity: 'Aoba Museum', substituteEntity: 'Mori Art Center', location: 'Kyoto', substituteLocation: 'Tokyo', activity: 'conserve a collection of Meiji-era paper maps', adjacent: 'digitize contemporary paintings' },
  { id: 'accra-nsawam-clinic', source: 'Nsawam Community Clinic needs an Accra-region cold-chain courier for weekly vaccine deliveries.', entity: 'Nsawam Community Clinic', substituteEntity: 'Korle Bu Teaching Hospital', location: 'the Accra region', substituteLocation: 'Kumasi', activity: 'provide weekly vaccine cold-chain deliveries', adjacent: 'ship ambient-temperature medical supplies' },
  { id: 'tallinn-koducoop-audit', source: 'KoduCoop is looking for an Estonian auditor to review its Tallinn cooperative-housing accounts.', entity: 'KoduCoop', substituteEntity: 'BalticHomes PLC', location: 'Estonia', substituteLocation: 'Latvia', activity: 'audit Tallinn cooperative-housing accounts', adjacent: 'value commercial property portfolios' },
  { id: 'quito-condor-school', source: 'Cóndor School in Quito needs an Ecuadorian printer for 2,000 Quechua literacy workbooks.', entity: 'Cóndor School', substituteEntity: 'Andes Language Institute', location: 'Ecuador', substituteLocation: 'Peru', activity: 'print Quechua literacy workbooks', adjacent: 'publish Spanish university textbooks' },
  { id: 'jakarta-ciliwung-lab', source: 'Ciliwung Lab seeks a Jakarta hydrologist to calibrate sensors along its named river-monitoring sites.', entity: 'Ciliwung Lab', substituteEntity: 'Mekong Water Forum', location: 'Jakarta', substituteLocation: 'Bangkok', activity: 'calibrate sensors at Ciliwung river-monitoring sites', adjacent: 'design municipal wastewater plants' },
  { id: 'belfast-linen-guild', source: 'Belfast Linen Guild needs a Northern Ireland dyer for a documented flax heritage project.', entity: 'Belfast Linen Guild', substituteEntity: 'Dublin Textile Council', location: 'Northern Ireland', substituteLocation: 'the Republic of Ireland', activity: 'dye flax for a documented linen heritage project', adjacent: 'source synthetic fashion fabrics' },
  { id: 'la-paz-inti-transit', source: 'Inti Transit Collective seeks a La Paz mechanic certified for its existing electric minibus model.', entity: 'Inti Transit Collective', substituteEntity: 'Altiplano Logistics', location: 'La Paz', substituteLocation: 'Santa Cruz', activity: 'service the collective’s existing electric minibus model', adjacent: 'repair diesel freight trucks' },
  { id: 'ljubljana-sava-library', source: 'Sava Library needs a Slovenian cataloguer for its Ljubljana collection of local samizdat journals.', entity: 'Sava Library', substituteEntity: 'Danube Archive', location: 'Slovenia', substituteLocation: 'Croatia', activity: 'catalogue local samizdat journals', adjacent: 'sell rare international books' },
  { id: 'darwin-mirri-rangers', source: 'Mirri Rangers seek a Darwin-based drone trainer for their named Indigenous fire-stewardship team.', entity: 'Mirri Rangers', substituteEntity: 'Top End Surveying Ltd', location: 'Darwin', substituteLocation: 'Perth', activity: 'train the Indigenous fire-stewardship team on drones', adjacent: 'conduct mining exploration surveys' },
  { id: 'sarajevo-most-youth', source: 'Most Youth Center needs a Sarajevo trauma-informed facilitator for its Bosnian peer-support program.', entity: 'Most Youth Center', substituteEntity: 'Bridge International Academy', location: 'Sarajevo', substituteLocation: 'Belgrade', activity: 'facilitate a Bosnian peer-support program', adjacent: 'deliver corporate leadership coaching' },
  { id: 'trondheim-fjord-watch', source: 'Fjord Watch Trondheim seeks a Norwegian lab to test water from its Trondheimsfjord sampling stations.', entity: 'Fjord Watch Trondheim', substituteEntity: 'Oslo Harbor Alliance', location: 'Norway', substituteLocation: 'Sweden', activity: 'test water from Trondheimsfjord sampling stations', adjacent: 'certify drinking-water equipment' },
  { id: 'antananarivo-voa-rice', source: 'VOA Rice Cooperative needs a Malagasy agronomist near Antananarivo for its named rain-fed plots.', entity: 'VOA Rice Cooperative', substituteEntity: 'Indian Ocean Grain Exporters', location: 'Antananarivo', substituteLocation: 'Mahajanga', activity: 'advise rain-fed cooperative rice plots', adjacent: 'broker irrigated rice exports' },
  { id: 'edmonton-northstar-shelter', source: 'Northstar Shelter seeks an Edmonton electrician for upgrades at its Jasper Avenue facility only.', entity: 'Northstar Shelter', substituteEntity: 'Prairie Housing Foundation', location: 'Edmonton', substituteLocation: 'Calgary', activity: 'upgrade electrical systems at the Jasper Avenue shelter', adjacent: 'wire new luxury apartments' },
  { id: 'busan-haedong-fishers', source: 'Haedong Fishers Association needs a Busan refrigeration engineer for its cooperative auction hall.', entity: 'Haedong Fishers Association', substituteEntity: 'Seoul Seafood Markets', location: 'Busan', substituteLocation: 'Incheon', activity: 'repair refrigeration in the cooperative auction hall', adjacent: 'install restaurant display freezers' },
];

export const ENTITY_LOCATION_SUBSTITUTION_CASES: HydeEvalCase[] = SEEDS.map((seed) => buildFrozenCase({
  id: `entity-location-substitution/${seed.id}`,
  stratum: 'entity-location-substitution',
  description: `The named entity ${seed.entity} and location ${seed.location} must remain jointly grounded.`,
  sourceText: seed.source,
  positives: [
    { corpus: 'intents', text: `We can work with ${seed.entity} in ${seed.location} to ${seed.activity}.` },
    { corpus: 'premises', text: `My current practice covers ${seed.location}, and I am equipped to ${seed.activity} specifically for ${seed.entity}.` },
  ],
  hardNegatives: [
    { corpus: 'intents', positive: 1, axis: 'entity-substitution', rationale: `Substitutes ${seed.substituteEntity} for the named entity.`, text: `We can work with ${seed.substituteEntity} in ${seed.location} to ${seed.activity}.` },
    { corpus: 'premises', positive: 2, axis: 'location-substitution', rationale: `Substitutes ${seed.substituteLocation} for the required location.`, text: `My practice covers ${seed.substituteLocation}, where I can ${seed.activity} for ${seed.entity}.` },
    { corpus: 'intents', positive: 1, axis: 'role-polarity', rationale: 'Keeps both grounded anchors but changes the provider into another seeker.', text: `We represent ${seed.entity} in ${seed.location} and are seeking someone else to ${seed.activity}; we cannot provide that work.` },
    { corpus: 'premises', positive: 2, axis: 'named-project-substitution', rationale: 'Offers an adjacent activity but not the named project.', text: `I operate in ${seed.location} and can help ${seed.entity} to ${seed.adjacent}, not to ${seed.activity}.` },
  ],
  distractors: [
    { corpus: 'premises', text: `I write research about organizations like ${seed.entity} but provide no project services.` },
    { corpus: 'intents', text: `I am seeking funding for ${seed.adjacent} in ${seed.location}.` },
    { corpus: 'premises', text: `Our directory lists vendors across ${seed.substituteLocation} without verifying availability.` },
    { corpus: 'intents', text: `I want introductions to the leadership of ${seed.substituteEntity} for an unrelated partnership.` },
  ],
}));
