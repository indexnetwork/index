export type SandboxNetworkKey =
  | 'stack'
  | 'latent'
  | 'pixel'
  | 'launch'
  | 'atelier'
  | 'arena'
  | 'syllabus'
  | 'reps'
  | 'tribe'
  | 'bench';

export interface SandboxPersona {
  name: string;
  email: string;
  networkKeys: SandboxNetworkKey[];
  profile: {
    identity: { name: string; bio: string; location: string };
    narrative: { context: string };
    attributes: { interests: string[]; skills: string[] };
  };
  intents: [string, string];
}

interface PersonDefinition {
  name: string;
  role: string;
  location: string;
  bio: string;
  skills: string[];
  interests: string[];
  intents: [string, string];
}

interface PairDefinition {
  networks: SandboxNetworkKey[];
  people: [PersonDefinition, PersonDefinition];
}

const PAIRS: PairDefinition[] = [
  {
    networks: ['latent', 'stack'],
    people: [
      {
        name: 'Nora Kim', role: 'Claims Operations Lead', location: 'Chicago, IL',
        bio: 'Leads automation and process improvement for a mid-sized insurance claims team.',
        skills: ['claims operations', 'workflow design', 'vendor evaluation'], interests: ['document AI', 'responsible automation', 'insurance technology'],
        intents: ['Looking for an applied AI developer to prototype document extraction and topic classification for insurance claims.', 'I can offer insurance-domain expertise and real workflow requirements to an AI product team.'],
      },
      {
        name: 'Maya Patel', role: 'Applied ML Engineer', location: 'Chicago, IL',
        bio: 'Independent machine-learning engineer specializing in document intelligence and human-in-the-loop NLP systems.',
        skills: ['Python', 'NLP', 'document extraction', 'model evaluation'], interests: ['insurance technology', 'knowledge systems', 'practical AI'],
        intents: ['Available to collaborate with operations teams on document extraction, classification, and retrieval prototypes.', 'Seeking a domain partner with messy real-world documents for a six-week applied AI pilot.'],
      },
    ],
  },
  {
    networks: ['reps'],
    people: [
      {
        name: 'Selin Demir', role: 'Product Designer', location: 'Istanbul, Turkey',
        bio: 'Product designer in Istanbul who climbs at an intermediate level and enjoys introducing people to local gyms.',
        skills: ['product design', 'facilitation', 'user research'], interests: ['bouldering', 'outdoor fitness', 'trail running'],
        intents: ['Looking for reliable climbing partners for weekday bouldering sessions and occasional weekend crag trips near Istanbul.', 'Happy to help newer climbers with trip planning and gym orientation.'],
      },
      {
        name: 'Kerem Arslan', role: 'Climbing Coach', location: 'Istanbul, Turkey',
        bio: 'Part-time climbing coach and experienced belayer who organizes small, safety-focused outdoor climbing groups.',
        skills: ['lead belaying', 'route planning', 'climbing coaching'], interests: ['rock climbing', 'bouldering', 'alpine safety'],
        intents: ['Available as a climbing partner for intermediate climbers in Istanbul, especially weekday evenings and Sunday mornings.', 'Seeking two more people for a recurring Istanbul-area climbing group.'],
      },
    ],
  },
  {
    networks: ['launch', 'stack'],
    people: [
      {
        name: 'Amara Okafor', role: 'B2B SaaS Founder', location: 'Austin, TX',
        bio: 'Early-stage founder building scheduling software for independent healthcare practices.',
        skills: ['customer discovery', 'healthcare operations', 'product strategy'], interests: ['vertical SaaS', 'founder communities', 'go-to-market'],
        intents: ['Looking for a fractional growth marketer experienced in taking vertical SaaS products from pilot customers to repeatable acquisition.', 'I can share healthcare-practice customer research with other founders building operational tools.'],
      },
      {
        name: 'Julian Foster', role: 'Fractional Growth Marketer', location: 'Austin, TX',
        bio: 'Fractional growth lead for seed-stage B2B software companies, with a focus on founder-led sales and lifecycle experiments.',
        skills: ['positioning', 'growth experiments', 'lifecycle marketing'], interests: ['vertical SaaS', 'early-stage startups', 'sales systems'],
        intents: ['Open to a fractional engagement with a vertical SaaS founder who has early customer traction and needs a repeatable growth motion.', 'Seeking founders willing to co-publish practical case studies about early go-to-market experiments.'],
      },
    ],
  },
  {
    networks: ['pixel', 'launch'],
    people: [
      {
        name: 'Leo Martins', role: 'Fintech Product Manager', location: 'Lisbon, Portugal',
        bio: 'Product manager improving onboarding and financial-literacy features for a European budgeting app.',
        skills: ['product management', 'consumer fintech', 'experimentation'], interests: ['financial inclusion', 'behavioral design', 'mobile products'],
        intents: ['Seeking a senior UX researcher for a short study on why first-time users abandon budgeting-app onboarding.', 'I can provide product analytics and access to a multilingual consumer research panel.'],
      },
      {
        name: 'Ines Costa', role: 'UX Researcher', location: 'Lisbon, Portugal',
        bio: 'Independent UX researcher running multilingual studies for consumer mobile products across Europe.',
        skills: ['qualitative research', 'usability testing', 'research synthesis'], interests: ['fintech', 'inclusive design', 'consumer behavior'],
        intents: ['Available for a four-week fintech onboarding research project, including Portuguese and English participant interviews.', 'Looking for product teams that will let research findings directly shape their roadmap.'],
      },
    ],
  },
  {
    networks: ['latent', 'syllabus', 'tribe'],
    people: [
      {
        name: 'Priya Nair', role: 'Climate Policy Researcher', location: 'London, UK',
        bio: 'Researcher studying local climate adaptation programs and public-sector funding outcomes.',
        skills: ['policy analysis', 'qualitative research', 'stakeholder interviews'], interests: ['climate adaptation', 'open data', 'local government'],
        intents: ['Looking for a data scientist to analyze a public dataset on municipal heat-adaptation investments and outcomes.', 'I can offer policy context and co-author an open research brief on local climate resilience.'],
      },
      {
        name: 'Daniel Wu', role: 'Civic Data Scientist', location: 'London, UK',
        bio: 'Data scientist working with public and nonprofit datasets, especially geospatial and policy evaluation projects.',
        skills: ['Python', 'geospatial analysis', 'causal inference'], interests: ['climate data', 'public policy', 'open-source research'],
        intents: ['Available to collaborate on a bounded climate-policy analysis using public municipal data.', 'Seeking a policy researcher who can validate assumptions and help communicate findings to local governments.'],
      },
    ],
  },
  {
    networks: ['tribe', 'launch'],
    people: [
      {
        name: 'Aaliyah Johnson', role: 'Community Program Director', location: 'Atlanta, GA',
        bio: 'Runs youth workforce programs at a neighborhood nonprofit and manages a small team of volunteer coordinators.',
        skills: ['community programs', 'volunteer management', 'partnership development'], interests: ['youth employment', 'mutual aid', 'civic participation'],
        intents: ['Looking for an experienced grant writer to help prepare a workforce-development proposal due next quarter.', 'I can connect volunteers with hands-on mentoring opportunities for Atlanta high-school students.'],
      },
      {
        name: 'Marcus Reed', role: 'Nonprofit Grant Consultant', location: 'Atlanta, GA',
        bio: 'Grant consultant who helps small community organizations turn program evidence into clear, fundable proposals.',
        skills: ['grant writing', 'program evaluation', 'budget narratives'], interests: ['workforce development', 'community organizations', 'capacity building'],
        intents: ['Available to support an Atlanta nonprofit with one workforce or education grant application this quarter.', 'Seeking community organizations with measurable program outcomes and a staff owner for the application process.'],
      },
    ],
  },
  {
    networks: ['syllabus'],
    people: [
      {
        name: 'Hana Sato', role: 'High School Physics Teacher', location: 'Seattle, WA',
        bio: 'Public-school physics teacher designing project-based lessons for multilingual classrooms.',
        skills: ['physics education', 'curriculum design', 'classroom facilitation'], interests: ['hands-on learning', 'teacher collaboration', 'science communication'],
        intents: ['Looking for a working engineer to speak with students about real-world renewable-energy systems.', 'I can pilot and provide feedback on open science-education materials.'],
      },
      {
        name: 'Owen Clarke', role: 'Renewable Energy Engineer', location: 'Seattle, WA',
        bio: 'Electrical engineer working on commercial solar and battery projects who volunteers in STEM education.',
        skills: ['solar design', 'battery systems', 'electrical engineering'], interests: ['STEM outreach', 'energy transition', 'hands-on education'],
        intents: ['Available to give classroom talks or practical demonstrations about solar and battery engineering in Seattle.', 'Seeking a teacher partner to adapt an energy-storage demonstration for high-school students.'],
      },
    ],
  },
  {
    networks: ['arena', 'pixel', 'stack'],
    people: [
      {
        name: 'Camille Dubois', role: 'Indie Game Producer', location: 'Montreal, Canada',
        bio: 'Producer coordinating a small narrative game team preparing a polished vertical slice.',
        skills: ['game production', 'scope management', 'narrative design'], interests: ['indie games', 'interactive fiction', 'accessible play'],
        intents: ['Looking for a freelance technical artist who can improve Unity lighting and shader performance for a vertical slice.', 'I can offer production coaching to first-time indie teams struggling with scope.'],
      },
      {
        name: 'Noah Tremblay', role: 'Technical Artist', location: 'Montreal, Canada',
        bio: 'Freelance technical artist bridging art and engineering for stylized Unity projects.',
        skills: ['Unity', 'shaders', 'lighting optimization'], interests: ['indie games', 'procedural art', 'real-time rendering'],
        intents: ['Available for a six-week Unity technical-art contract focused on lighting, shaders, and performance.', 'Seeking a small narrative game with a clear art direction and playable build.'],
      },
    ],
  },
  {
    networks: ['pixel', 'tribe'],
    people: [
      {
        name: 'Fatima El-Sayed', role: 'Refugee Services Coordinator', location: 'Berlin, Germany',
        bio: 'Coordinates employment and language-support programs for newly arrived families.',
        skills: ['program coordination', 'community outreach', 'multilingual facilitation'], interests: ['migration', 'dignified storytelling', 'employment access'],
        intents: ['Seeking a documentary photographer to create consent-led portraits for an annual impact report.', 'I can advise creative teams on ethical, trauma-informed community storytelling.'],
      },
      {
        name: 'Jonas Weber', role: 'Documentary Photographer', location: 'Berlin, Germany',
        bio: 'Documentary photographer focused on migration, labor, and neighborhood life, with a consent-first practice.',
        skills: ['documentary photography', 'portraiture', 'visual editing'], interests: ['social impact', 'oral history', 'ethical media'],
        intents: ['Available for a Berlin nonprofit portrait project with clear consent and participant-review processes.', 'Looking for community partners developing long-form stories about work and belonging.'],
      },
    ],
  },
  {
    networks: ['bench', 'atelier'],
    people: [
      {
        name: 'Mei Lin', role: 'Cafe Owner', location: 'Portland, OR',
        bio: 'Owns a neighborhood cafe and is redesigning its tableware around local, durable materials.',
        skills: ['hospitality operations', 'menu development', 'local sourcing'], interests: ['ceramics', 'coffee culture', 'small business'],
        intents: ['Looking for a local ceramicist to design and produce a small run of durable espresso cups.', 'I can host maker pop-ups and product launches at the cafe.'],
      },
      {
        name: 'Theo Nguyen', role: 'Studio Ceramicist', location: 'Portland, OR',
        bio: 'Ceramicist producing functional stoneware for restaurants and independent retailers.',
        skills: ['wheel throwing', 'glaze formulation', 'small-batch production'], interests: ['functional ceramics', 'hospitality design', 'local manufacturing'],
        intents: ['Taking commissions from Portland cafes for small-batch custom tableware and espresso cups.', 'Seeking a hospitality partner to test a new chip-resistant stoneware body in daily service.'],
      },
    ],
  },
  {
    networks: ['latent', 'syllabus'],
    people: [
      {
        name: 'Layla Haddad', role: 'Public Health Analyst', location: 'Toronto, Canada',
        bio: 'Analyst at a community health organization evaluating access to primary care.',
        skills: ['health analytics', 'survey design', 'program evaluation'], interests: ['health equity', 'data visualization', 'community care'],
        intents: ['Looking for a biostatistician to review an analysis plan for a primary-care access study.', 'I can provide de-identified community health data and domain interpretation for a methods collaboration.'],
      },
      {
        name: 'Dr. Samuel Green', role: 'Biostatistician', location: 'Toronto, Canada',
        bio: 'Independent biostatistician advising health researchers on study design and interpretable analysis.',
        skills: ['biostatistics', 'study design', 'R'], interests: ['health equity', 'reproducible research', 'causal methods'],
        intents: ['Available to review a community-health study design and statistical analysis plan.', 'Seeking applied health partners for publishable work using responsibly governed datasets.'],
      },
    ],
  },
  {
    networks: ['stack', 'syllabus'],
    people: [
      {
        name: 'Elena Petrova', role: 'Security Lead', location: 'Prague, Czechia',
        bio: 'Security lead at a growing software company formalizing its incident-response program.',
        skills: ['application security', 'risk assessment', 'security operations'], interests: ['incident response', 'security culture', 'tabletop exercises'],
        intents: ['Looking for an incident-response facilitator to run a realistic ransomware tabletop exercise.', 'I can share a reusable security readiness checklist with other startup teams.'],
      },
      {
        name: 'Mateo Silva', role: 'Incident Response Consultant', location: 'Prague, Czechia',
        bio: 'Independent consultant designing and facilitating cyber incident simulations for technology companies.',
        skills: ['incident response', 'tabletop facilitation', 'forensic readiness'], interests: ['cyber resilience', 'training', 'organizational learning'],
        intents: ['Available to facilitate a ransomware tabletop exercise for a software company in Europe.', 'Seeking a security team willing to pilot a new cross-functional incident simulation format.'],
      },
    ],
  },
  {
    networks: ['launch', 'latent'],
    people: [
      {
        name: 'Kwame Mensah', role: 'Cooperative Finance Founder', location: 'Accra, Ghana',
        bio: 'Founder building bookkeeping tools for small agricultural cooperatives in West Africa.',
        skills: ['cooperative finance', 'customer research', 'partnerships'], interests: ['financial inclusion', 'agriculture', 'mobile money'],
        intents: ['Looking for a risk-modeling advisor familiar with alternative data and small-business lending.', 'I can provide cooperative-finance domain knowledge and anonymized repayment patterns for model design.'],
      },
      {
        name: 'Zuri Boateng', role: 'Credit Risk Data Scientist', location: 'Accra, Ghana',
        bio: 'Data scientist building explainable credit-risk models for lenders serving informal and small businesses.',
        skills: ['credit risk', 'Python', 'explainable ML'], interests: ['financial inclusion', 'alternative data', 'responsible lending'],
        intents: ['Available to advise a financial-inclusion startup on transparent alternative-data risk modeling.', 'Seeking a founder partner with strong borrower relationships and clear consent practices.'],
      },
    ],
  },
  {
    networks: ['atelier'],
    people: [
      {
        name: 'Ana Torres', role: 'Independent Filmmaker', location: 'Mexico City, Mexico',
        bio: 'Documentary filmmaker finishing a short film about urban water access.',
        skills: ['documentary directing', 'field production', 'story editing'], interests: ['environmental stories', 'Latin American cinema', 'sound design'],
        intents: ['Looking for a sound designer to build the final mix and atmospheric soundscape for a 20-minute documentary.', 'I can collaborate with composers and sound artists on future environmental stories.'],
      },
      {
        name: 'Rafael Mendez', role: 'Film Sound Designer', location: 'Mexico City, Mexico',
        bio: 'Freelance sound designer and re-recording mixer working on documentary and independent film.',
        skills: ['sound editing', 'field recording', 'film mixing'], interests: ['documentary film', 'environmental audio', 'experimental music'],
        intents: ['Available to sound-design and mix a short documentary over the next six weeks.', 'Seeking a filmmaker interested in using original field recordings as a narrative element.'],
      },
    ],
  },
  {
    networks: ['bench', 'launch'],
    people: [
      {
        name: 'Chloe Bennett', role: 'Food Product Founder', location: 'Melbourne, Australia',
        bio: 'Founder developing shelf-stable sauces for independent grocers and specialty food shops.',
        skills: ['recipe development', 'retail operations', 'brand strategy'], interests: ['food manufacturing', 'local retail', 'sustainable packaging'],
        intents: ['Looking for a food scientist to validate shelf-life and small-batch production controls for a new sauce line.', 'I can offer consumer testing and retail feedback to packaging or food-tech collaborators.'],
      },
      {
        name: 'Arjun Rao', role: 'Food Scientist', location: 'Melbourne, Australia',
        bio: 'Food scientist consulting with small brands on formulation, shelf-life, and production readiness.',
        skills: ['food safety', 'shelf-life testing', 'process controls'], interests: ['small food brands', 'fermentation', 'sustainable packaging'],
        intents: ['Available to advise an emerging food brand on shelf-life validation and production controls.', 'Seeking a founder preparing a real product for a small commercial manufacturing run.'],
      },
    ],
  },
  {
    networks: ['stack', 'bench', 'syllabus'],
    people: [
      {
        name: 'Grace Liu', role: 'Robotics Club Coordinator', location: 'San Jose, CA',
        bio: 'Coordinates an after-school robotics program serving middle-school students across three campuses.',
        skills: ['youth programs', 'robotics curriculum', 'volunteer coordination'], interests: ['robotics', 'maker education', 'accessible STEM'],
        intents: ['Looking for a robotics engineer to mentor student teams during a six-week build season.', 'I can help engineers translate technical projects into age-appropriate workshops.'],
      },
      {
        name: 'Victor Chen', role: 'Robotics Engineer', location: 'San Jose, CA',
        bio: 'Controls engineer at a warehouse robotics company who volunteers with youth maker programs.',
        skills: ['robot controls', 'embedded systems', 'technical mentoring'], interests: ['STEM education', 'robot competitions', 'open hardware'],
        intents: ['Available to mentor a middle-school robotics team one evening per week in San Jose.', 'Seeking an educator to help turn a simple sensor project into an open workshop.'],
      },
    ],
  },
  {
    networks: ['stack', 'launch'],
    people: [
      {
        name: 'Sarah Mitchell', role: 'Legal Operations Manager', location: 'New York, NY',
        bio: 'Legal operations manager improving contract intake and knowledge workflows at a technology company.',
        skills: ['legal operations', 'contract workflows', 'change management'], interests: ['legal technology', 'knowledge management', 'document automation'],
        intents: ['Looking for a legal-tech engineer to prototype contract-clause extraction and internal search.', 'I can provide realistic legal workflow requirements and structured feedback on prototypes.'],
      },
      {
        name: 'Idris Campbell', role: 'Legal-Tech Engineer', location: 'New York, NY',
        bio: 'Software engineer building secure document search and extraction tools for legal teams.',
        skills: ['document pipelines', 'semantic search', 'TypeScript'], interests: ['legal technology', 'privacy engineering', 'knowledge systems'],
        intents: ['Available to prototype clause extraction and secure internal search with a legal-operations partner.', 'Seeking a legal team that can define evaluation criteria and test against synthetic contracts.'],
      },
    ],
  },
  {
    networks: ['syllabus', 'latent'],
    people: [
      {
        name: 'Dr. Leila Farouk', role: 'Urban Mobility Researcher', location: 'Paris, France',
        bio: 'Postdoctoral researcher studying how street design affects walking and public-transit access.',
        skills: ['urban research', 'survey methods', 'spatial analysis'], interests: ['walkability', 'public transit', 'open science'],
        intents: ['Looking for a geospatial analyst to reproduce and extend a neighborhood walkability study.', 'I can offer research design, survey data, and co-authorship on an open methods paper.'],
      },
      {
        name: 'Bastien Moreau', role: 'Geospatial Analyst', location: 'Paris, France',
        bio: 'Independent GIS analyst working on mobility, accessibility, and public-space projects.',
        skills: ['PostGIS', 'QGIS', 'spatial statistics'], interests: ['urban mobility', 'open data', 'reproducible maps'],
        intents: ['Available to collaborate on a reproducible walkability analysis using open geospatial data.', 'Seeking an academic partner with a clear research question and publication plan.'],
      },
    ],
  },
  {
    networks: ['reps', 'tribe'],
    people: [
      {
        name: 'Malik Thompson', role: 'Community Fitness Organizer', location: 'Philadelphia, PA',
        bio: 'Organizes free outdoor strength and mobility sessions in neighborhood parks.',
        skills: ['community organizing', 'group fitness', 'event logistics'], interests: ['accessible fitness', 'public space', 'health equity'],
        intents: ['Looking for a certified physical therapist to review an inclusive beginner mobility program.', 'I can organize free community pilot sessions and gather participant feedback.'],
      },
      {
        name: 'Jasmine Lee', role: 'Physical Therapist', location: 'Philadelphia, PA',
        bio: 'Outpatient physical therapist focused on strength, mobility, and making exercise approachable for beginners.',
        skills: ['physical therapy', 'mobility coaching', 'injury prevention'], interests: ['community health', 'inclusive fitness', 'outdoor programs'],
        intents: ['Available to review and co-design a safe beginner mobility curriculum for a community fitness group.', 'Seeking a community partner to host a free injury-prevention workshop.'],
      },
    ],
  },
  {
    networks: ['stack', 'syllabus'],
    people: [
      {
        name: 'Tom Becker', role: 'Open-Source Maintainer', location: 'Amsterdam, Netherlands',
        bio: 'Maintains a popular TypeScript data-validation library and is improving contributor onboarding.',
        skills: ['TypeScript', 'API design', 'open-source governance'], interests: ['developer tools', 'documentation', 'maintainer sustainability'],
        intents: ['Looking for a technical writer to redesign contributor documentation and first-issue pathways.', 'I can mentor developers who want experience maintaining a widely used TypeScript library.'],
      },
      {
        name: 'Nadia Vermeer', role: 'Developer Documentation Writer', location: 'Amsterdam, Netherlands',
        bio: 'Technical writer specializing in developer tools, API references, and contribution guides.',
        skills: ['technical writing', 'information architecture', 'docs testing'], interests: ['open source', 'developer experience', 'inclusive documentation'],
        intents: ['Available to improve contributor documentation for an active open-source developer tool.', 'Seeking a maintainer who can provide user feedback and access to real contributor questions.'],
      },
    ],
  },
  {
    networks: ['tribe', 'launch'],
    people: [
      {
        name: 'Rina Shah', role: 'Tech Community Organizer', location: 'Bengaluru, India',
        bio: 'Organizes small peer-learning events for early-career software developers.',
        skills: ['community events', 'speaker coordination', 'partnerships'], interests: ['developer communities', 'peer learning', 'inclusive events'],
        intents: ['Looking for a venue partner to host a 60-person developer learning event in Bengaluru.', 'I can bring an established attendee community and manage programming and logistics.'],
      },
      {
        name: 'Karthik Iyer', role: 'Coworking Space Manager', location: 'Bengaluru, India',
        bio: 'Runs community programming at an independent coworking space with an event room.',
        skills: ['venue operations', 'event production', 'community partnerships'], interests: ['technology events', 'founder communities', 'professional learning'],
        intents: ['Offering a Bengaluru event space to community organizers running practical technology or founder education.', 'Seeking a reliable programming partner for a monthly evening event series.'],
      },
    ],
  },
  {
    networks: ['bench', 'launch'],
    people: [
      {
        name: 'Emily Carter', role: 'Sustainable Packaging Founder', location: 'Vancouver, Canada',
        bio: 'Founder testing fiber-based packaging for independent personal-care brands.',
        skills: ['materials sourcing', 'product development', 'supplier partnerships'], interests: ['circular economy', 'packaging', 'consumer goods'],
        intents: ['Looking for a materials engineer to evaluate moisture barriers for a compostable packaging prototype.', 'I can provide prototypes, supplier data, and customer requirements for applied materials testing.'],
      },
      {
        name: 'Lucas Pereira', role: 'Materials Engineer', location: 'Vancouver, Canada',
        bio: 'Materials engineer consulting on bio-based coatings and packaging performance.',
        skills: ['polymer testing', 'barrier coatings', 'materials characterization'], interests: ['compostable materials', 'circular design', 'manufacturing'],
        intents: ['Available to evaluate barrier performance and failure modes for an early compostable packaging prototype.', 'Seeking a product founder with physical samples and a clear target specification.'],
      },
    ],
  },
  {
    networks: ['atelier', 'launch'],
    people: [
      {
        name: 'Aisha Bello', role: 'Podcast Producer', location: 'Lagos, Nigeria',
        bio: 'Produces an interview podcast about African technology operators and creative entrepreneurs.',
        skills: ['audio production', 'guest research', 'editorial planning'], interests: ['technology stories', 'entrepreneurship', 'audio journalism'],
        intents: ['Looking for a freelance story editor to shape a six-episode season about climate-tech operators.', 'I can offer production support to researchers who want to turn their work into accessible audio stories.'],
      },
      {
        name: 'Tunde Adebayo', role: 'Story Editor', location: 'Lagos, Nigeria',
        bio: 'Freelance editor helping documentary, podcast, and research teams build clear narrative arcs.',
        skills: ['story editing', 'interview structure', 'script development'], interests: ['climate stories', 'African technology', 'documentary audio'],
        intents: ['Available to story-edit a limited podcast series about climate technology and entrepreneurship.', 'Seeking a producer with recorded interviews and a defined publishing schedule.'],
      },
    ],
  },
  {
    networks: ['syllabus', 'launch'],
    people: [
      {
        name: 'Diego Alvarez', role: 'First-Time Engineering Manager', location: 'Madrid, Spain',
        bio: 'Recently promoted engineering manager leading a distributed team of eight developers.',
        skills: ['software engineering', 'team planning', 'technical leadership'], interests: ['management craft', 'remote teams', 'career development'],
        intents: ['Looking for an experienced engineering leader to mentor me through my first six months as a manager.', 'I can mentor junior backend engineers on system design and code review.'],
      },
      {
        name: 'Carla Romero', role: 'VP of Engineering', location: 'Madrid, Spain',
        bio: 'Experienced engineering executive who advises new managers and scaling product teams.',
        skills: ['engineering leadership', 'manager coaching', 'organizational design'], interests: ['leadership development', 'healthy teams', 'technical strategy'],
        intents: ['Offering monthly mentorship to a first-time engineering manager navigating team leadership and delegation.', 'Seeking experienced individual contributors who can mentor early-career developers in a community program.'],
      },
    ],
  },
  {
    networks: ['syllabus', 'tribe'],
    people: [
      {
        name: 'Yuki Tanaka', role: 'Japanese Language Learner', location: 'Sydney, Australia',
        bio: 'Australian product analyst preparing for a work rotation in Tokyo and studying conversational Japanese.',
        skills: ['product analytics', 'English conversation', 'data visualization'], interests: ['Japanese language', 'travel', 'cross-cultural work'],
        intents: ['Looking for a Japanese-English language exchange partner for weekly video conversations.', 'Offering English conversation practice and help with data-analysis vocabulary.'],
      },
      {
        name: 'Haruto Mori', role: 'English Language Learner', location: 'Tokyo, Japan',
        bio: 'Japanese operations analyst improving spoken English for international project work.',
        skills: ['operations analysis', 'Japanese conversation', 'process improvement'], interests: ['English language', 'international teams', 'Australian culture'],
        intents: ['Seeking a weekly Japanese-English language exchange partner and offering native Japanese conversation practice.', 'Available for structured video calls alternating between English and Japanese.'],
      },
    ],
  },
];

export const SANDBOX_PERSONAS: SandboxPersona[] = PAIRS.flatMap((pair, pairIndex) =>
  pair.people.map((person, sideIndex) => ({
    name: person.name,
    email: `sandbox-person-${String(pairIndex * 2 + sideIndex + 1).padStart(2, '0')}@index-network.test`,
    networkKeys: pair.networks,
    profile: {
      identity: { name: person.name, bio: `${person.role}. ${person.bio}`, location: person.location },
      narrative: { context: person.bio },
      attributes: { skills: person.skills, interests: person.interests },
    },
    intents: person.intents,
  })),
);
