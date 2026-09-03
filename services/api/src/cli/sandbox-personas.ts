/**
 * Curated sandbox population for `protocol_sandbox`.
 *
 * Every person is authored inside a scenario: two people designed to match each
 * other (an ask and an offer that line up), optionally joined by a third who is
 * a plausible adjacent match rather than a designed one, so evaluation has a
 * non-trivial decision to make. Each person deliberately leaves some obvious
 * dimension unsettled (budget, timeline, remote/in-person, …) for the question
 * flow to ask about.
 *
 * Every email lives on a `.test` domain (RFC 2606): no address under it can
 * ever be a deliverable mailbox, so no real user can collide with a persona.
 */
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

/** Shared password for every seed persona's email/password credential. Test-only. */
export const SANDBOX_SEED_PASSWORD = 'sandbox-sandbox';

export interface SandboxPersonaFixedIds {
  userId: string;
  /** Intent ids by intent index; intents beyond this list get derived fixture ids. */
  intentIds: string[];
}

export interface SandboxPersona {
  name: string;
  email: string;
  /** Present only for personas whose ids are referenced by docs and prior test threads. */
  fixedIds?: SandboxPersonaFixedIds;
  networkKeys: SandboxNetworkKey[];
  profile: {
    identity: { name: string; bio: string; location: string };
    narrative: { context: string };
    attributes: { interests: string[]; skills: string[] };
  };
  intents: string[];
}

interface PersonDefinition {
  name: string;
  role: string;
  location: string;
  bio: string;
  skills: string[];
  interests: string[];
  intents: string[];
  /** Defaults to a readable, name-based `@sandbox.test` address. */
  email?: string;
  fixedIds?: SandboxPersonaFixedIds;
}

interface ScenarioDefinition {
  networks: SandboxNetworkKey[];
  /** Two designed counterparts first; any further entries are adjacent, not designed, matches. */
  people: PersonDefinition[];
}

const SCENARIOS: ScenarioDefinition[] = [
  {
    networks: ['latent', 'stack'],
    people: [
      {
        name: 'Nora Kim', role: 'Claims Operations Lead', location: 'Chicago, IL',
        bio: 'Leads automation and process improvement for a mid-sized insurance claims team.',
        skills: ['claims operations', 'workflow design', 'vendor evaluation'], interests: ['document AI', 'responsible automation', 'insurance technology'],
        intents: [
          'Looking for an applied AI developer to prototype document extraction and topic classification for insurance claims.',
          'I can offer insurance-domain expertise and real workflow requirements to an AI product team.',
          'Seeking peers in claims, underwriting, or healthcare-operations roles to compare notes on rolling out document automation responsibly.',
          'Open to speaking at an insurance-technology meetup about what document AI gets wrong in practice.',
        ],
      },
      {
        name: 'Maya Patel', role: 'Applied ML Engineer', location: 'Chicago, IL',
        bio: 'Independent machine-learning engineer specializing in document intelligence and human-in-the-loop NLP systems.',
        skills: ['Python', 'NLP', 'document extraction', 'model evaluation'], interests: ['insurance technology', 'knowledge systems', 'practical AI'],
        intents: [
          'Available to collaborate with operations teams on document extraction, classification, and retrieval prototypes.',
          'Seeking a domain partner with messy real-world documents for a six-week applied AI pilot.',
          'Looking for other independent ML practitioners in Chicago to share contracts and cover for each other.',
          'Interested in co-writing a practical guide on evaluating document-AI vendors.',
        ],
      },
      {
        name: 'Rosa Delgado', role: 'Prior-Authorization Operations Manager', location: 'Milwaukee, WI',
        bio: 'Runs prior-authorization intake for a regional health system and is exploring document automation.',
        skills: ['healthcare operations', 'intake workflows', 'process metrics'], interests: ['document AI', 'healthcare administration', 'staff wellbeing'],
        intents: [
          'Exploring document-automation options for faxed prior-authorization forms and want to talk with practitioners who have done it.',
          'I can describe real healthcare intake workflows to people building document tools.',
          'Looking for other insurance or healthcare operations managers rolling out document automation, to compare what actually worked.',
        ],
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
        intents: [
          'Looking for reliable climbing partners for weekday bouldering sessions and occasional weekend crag trips near Istanbul.',
          'Happy to show beginner climbers around Istanbul gyms on weekends, including ones just visiting town.',
          'Want to find someone who can teach me to lead-belay safely outdoors.',
        ],
      },
      {
        name: 'Kerem Arslan', role: 'Climbing Coach', location: 'Istanbul, Turkey',
        bio: 'Part-time climbing coach and experienced belayer who organizes small, safety-focused outdoor climbing groups.',
        skills: ['lead belaying', 'route planning', 'climbing coaching'], interests: ['rock climbing', 'bouldering', 'alpine safety'],
        intents: [
          'Available as a climbing partner for intermediate climbers in Istanbul, especially weekday evenings and Sunday mornings.',
          'Seeking two more people for a recurring Istanbul-area climbing group.',
          'Offering outdoor lead-belay instruction to gym climbers who want to transition to the crag.',
          'Looking for other certified instructors to share trip logistics and safety practices.',
        ],
      },
      {
        name: 'Ege Yılmaz', role: 'Graduate Student', location: 'Ankara, Turkey',
        bio: 'Beginner boulderer in Ankara who started six months ago and wants regular partners.',
        skills: ['mechanical engineering', 'CAD', 'patience'], interests: ['bouldering', 'hiking', 'board games'],
        intents: [
          'Looking for beginner-friendly climbing partners in Ankara for weekend gym sessions.',
          'Would love to join a guided outdoor climbing day somewhere in Turkey when I am ready.',
          'Looking for an Istanbul local to climb with and show me around a gym on the weekends I am in town for family.',
        ],
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
        intents: [
          'Looking for a fractional growth marketer experienced in taking vertical SaaS products from pilot customers to repeatable acquisition.',
          'I can share healthcare-practice customer research with other founders building operational tools.',
          'Seeking other early-stage Texas founders, not just vertical SaaS, for a monthly accountability call about runway and traction pressure.',
          'Open to meeting angels who focus on healthcare operations software.',
        ],
      },
      {
        name: 'Julian Foster', role: 'Fractional Growth Marketer', location: 'Austin, TX',
        bio: 'Fractional growth lead for seed-stage B2B software companies, with a focus on founder-led sales and lifecycle experiments.',
        skills: ['positioning', 'growth experiments', 'lifecycle marketing'], interests: ['vertical SaaS', 'early-stage startups', 'sales systems'],
        intents: [
          'Open to a fractional engagement with a vertical SaaS founder who has early customer traction and needs a repeatable growth motion.',
          'Seeking founders willing to co-publish practical case studies about early go-to-market experiments.',
          'Looking for a fractional sales leader to refer clients to when the problem is sales rather than marketing.',
        ],
      },
      {
        name: 'Pilar Santos', role: 'Consumer Fintech Founder', location: 'Dallas, TX',
        bio: 'Founder of a consumer savings app for gig workers, pre-launch, looking for early growth help.',
        skills: ['product management', 'financial products', 'community building'], interests: ['consumer fintech', 'gig economy', 'growth'],
        intents: [
          'Looking for a growth marketer who has launched a consumer fintech app and can help plan our first 90 days.',
          'Seeking other solo founders in Texas building consumer products.',
          'Looking for other early-stage Texas founders, any vertical, for a monthly accountability call on runway and fundraising decisions.',
          'Open to a cofounder conversation with someone who has consumer growth experience.',
        ],
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
        intents: [
          'Seeking a senior UX researcher for a short study on why first-time users abandon budgeting-app onboarding.',
          'I can provide product analytics and access to a multilingual consumer research panel.',
          'Looking for product managers at other consumer fintechs to compare onboarding benchmarks.',
        ],
      },
      {
        name: 'Ines Costa', role: 'UX Researcher', location: 'Lisbon, Portugal',
        bio: 'Independent UX researcher running multilingual studies for consumer mobile products across Europe.',
        skills: ['qualitative research', 'usability testing', 'research synthesis'], interests: ['fintech', 'inclusive design', 'consumer behavior'],
        intents: [
          'Available for a four-week fintech onboarding research project, including Portuguese and English participant interviews.',
          'Looking for product teams that will let research findings directly shape their roadmap.',
          'Seeking a research partner who covers French and German for larger European studies.',
          'Looking for other UX researchers in Portugal to trade research-ops tooling and interview-logistics tips.',
          'Interested in teaching a short workshop on interview synthesis for product teams.',
        ],
      },
      {
        name: 'Duarte Ferreira', role: 'Enterprise UX Researcher', location: 'Porto, Portugal',
        bio: 'UX researcher focused on B2B enterprise software and internal tools, occasionally available for consumer work.',
        skills: ['contextual inquiry', 'enterprise UX', 'workshop facilitation'], interests: ['B2B software', 'service design', 'research operations'],
        intents: [
          'Available later this year for UX research engagements with B2B software teams in Portugal.',
          'Looking for other UX researchers in Portugal to share a research-ops toolkit and interview-logistics tips with.',
          'Open to occasional consumer research if the timeline is flexible.',
        ],
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
        intents: [
          'Looking for a data scientist to analyze a public dataset on municipal heat-adaptation investments and outcomes.',
          'I can offer policy context and co-author an open research brief on local climate resilience.',
          'Seeking council officers willing to be interviewed about how adaptation funding decisions are made.',
          'Open to being quoted by journalists writing about local government funding gaps in climate adaptation.',
        ],
      },
      {
        name: 'Daniel Wu', role: 'Civic Data Scientist', location: 'London, UK',
        bio: 'Data scientist working with public and nonprofit datasets, especially geospatial and policy evaluation projects.',
        skills: ['Python', 'geospatial analysis', 'causal inference'], interests: ['climate data', 'public policy', 'open-source research'],
        intents: [
          'Available to collaborate on a bounded climate-policy analysis using public municipal data.',
          'Seeking a policy researcher who can validate assumptions and help communicate findings to local governments.',
          'Looking for civic data practitioners to start a small London reading group on causal inference.',
          'Open to mentoring an early-career analyst on geospatial methods.',
        ],
      },
      {
        name: 'Harriet Osei', role: 'Environmental Journalist', location: 'Manchester, UK',
        bio: 'Freelance environmental journalist working on a story about flood insurance withdrawal in northern England.',
        skills: ['investigative reporting', 'FOI requests', 'data journalism basics'], interests: ['climate adaptation', 'insurance', 'local news'],
        intents: [
          'Looking for someone with data skills to help me analyze council flood-defence spending for a news story.',
          'Seeking climate-adaptation researchers willing to be quoted on local government funding gaps.',
          'Open to collaborating with researchers who want their work to reach a general audience.',
        ],
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
        intents: [
          'Looking for an experienced grant writer to help prepare a workforce-development proposal due next quarter.',
          'I can connect volunteers with hands-on mentoring opportunities for Atlanta high-school students.',
          'Seeking employer partners in Atlanta willing to host paid summer placements for students.',
        ],
      },
      {
        name: 'Marcus Reed', role: 'Nonprofit Grant Consultant', location: 'Atlanta, GA',
        bio: 'Grant consultant who helps small community organizations turn program evidence into clear, fundable proposals.',
        skills: ['grant writing', 'program evaluation', 'budget narratives'], interests: ['workforce development', 'community organizations', 'capacity building'],
        intents: [
          'Available to support an Atlanta nonprofit with one workforce or education grant application this quarter.',
          'Seeking community organizations with measurable program outcomes and a staff owner for the application process.',
          'Looking for a program evaluator to partner with on outcome-measurement projects.',
          'Offering a free monthly office hour for small nonprofits with grant questions.',
        ],
      },
      {
        name: 'Beatrice Hall', role: 'Arts Nonprofit Director', location: 'Birmingham, AL',
        bio: 'Executive director of a small community arts center preparing its first national arts-agency grant application.',
        skills: ['arts administration', 'community events', 'board relations'], interests: ['public art', 'arts funding', 'youth programs'],
        intents: [
          'Looking for a grant writer who knows arts funders to guide our first national application.',
          'Seeking other small arts organizations in the Southeast to share funder intelligence.',
          'Would value a free office-hour conversation with an experienced grant consultant before committing to paid help.',
          'Offering our gallery space for community meetings and workshops.',
        ],
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
        intents: [
          'Looking for a working engineer to speak with students about real-world renewable-energy systems.',
          'I can pilot and provide feedback on open science-education materials.',
          'Seeking other physics teachers to co-develop project-based energy labs.',
        ],
      },
      {
        name: 'Owen Clarke', role: 'Renewable Energy Engineer', location: 'Seattle, WA',
        bio: 'Electrical engineer working on commercial solar and battery projects who volunteers in STEM education.',
        skills: ['solar design', 'battery systems', 'electrical engineering'], interests: ['STEM outreach', 'energy transition', 'hands-on education'],
        intents: [
          'Available to give classroom talks or practical demonstrations about solar and battery engineering in Seattle.',
          'Seeking a teacher partner to adapt an energy-storage demonstration for high-school students.',
          'Looking for other engineers who do STEM outreach to share demo materials.',
          'Willing to help another Washington-state trades or engineering volunteer prepare their first classroom talk.',
          'Interested in mentoring a student capstone project on home solar design.',
        ],
      },
      {
        name: 'Gwen Harper', role: 'Wind Turbine Technician', location: 'Tacoma, WA',
        bio: 'Field technician servicing wind turbines who would like to tell students about skilled trades in renewables.',
        skills: ['turbine maintenance', 'electrical troubleshooting', 'safety training'], interests: ['skilled trades', 'renewable energy', 'mentoring'],
        intents: [
          'Open to speaking with students about careers in wind-turbine maintenance when my schedule allows.',
          'Looking for someone experienced in school outreach to help me prepare a first talk.',
          'Seeking other trades workers interested in STEM outreach.',
        ],
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
        intents: [
          'Looking for a freelance technical artist who can improve Unity lighting and shader performance for a vertical slice.',
          'I can offer production coaching to first-time indie teams struggling with scope.',
          'Seeking publishers or funds interested in narrative-driven indie games.',
          'Looking for a narrative designer to review our branching dialogue structure.',
          'Open to a Unreal-background VFX artist willing to ramp up on Unity for stylized particle and material polish on our slice.',
        ],
      },
      {
        name: 'Noah Tremblay', role: 'Technical Artist', location: 'Montreal, Canada',
        bio: 'Freelance technical artist bridging art and engineering for stylized Unity projects.',
        skills: ['Unity', 'shaders', 'lighting optimization'], interests: ['indie games', 'procedural art', 'real-time rendering'],
        intents: [
          'Available for a six-week Unity technical-art contract focused on lighting, shaders, and performance.',
          'Seeking a small narrative game with a clear art direction and playable build.',
          'Looking for other technical artists to share shader experiments with.',
        ],
      },
      {
        name: 'Sophie Gagnon', role: 'Real-Time VFX Artist', location: 'Quebec City, Canada',
        bio: 'Freelance VFX artist working in Unreal Engine, available for short contracts.',
        skills: ['Unreal Engine', 'Niagara VFX', 'materials'], interests: ['indie games', 'visual effects', 'stylized rendering'],
        intents: [
          'Available for short Unreal Engine VFX and material contracts with indie studios.',
          'Seeking small teams building stylized games who need visual effects polish.',
          'Open to learning Unity on a project if the team can support the ramp-up.',
        ],
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
        intents: [
          'Seeking a documentary photographer to create consent-led portraits for an annual impact report.',
          'I can advise creative teams on ethical, trauma-informed community storytelling.',
          'Looking for Berlin employers open to hiring program participants into entry-level roles.',
        ],
      },
      {
        name: 'Jonas Weber', role: 'Documentary Photographer', location: 'Berlin, Germany',
        bio: 'Documentary photographer focused on migration, labor, and neighborhood life, with a consent-first practice.',
        skills: ['documentary photography', 'portraiture', 'visual editing'], interests: ['social impact', 'oral history', 'ethical media'],
        intents: [
          'Available for a Berlin nonprofit portrait project with clear consent and participant-review processes.',
          'Looking for community partners developing long-form stories about work and belonging.',
          'Seeking an oral historian to collaborate on an exhibition about neighborhood labor.',
          'Offering a portfolio review for early-career documentary photographers.',
        ],
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
        intents: [
          'Looking for a local ceramicist to design and produce a small run of durable espresso cups.',
          'I can host maker pop-ups and product launches at the cafe.',
          'Seeking a local roaster interested in a collaborative seasonal blend.',
        ],
      },
      {
        name: 'Theo Nguyen', role: 'Studio Ceramicist', location: 'Portland, OR',
        bio: 'Ceramicist producing functional stoneware for restaurants and independent retailers.',
        skills: ['wheel throwing', 'glaze formulation', 'small-batch production'], interests: ['functional ceramics', 'hospitality design', 'local manufacturing'],
        intents: [
          'Taking commissions from Portland cafes for small-batch custom tableware and espresso cups.',
          'Seeking a hospitality partner to test a new chip-resistant stoneware body in daily service.',
          'Looking for a shared kiln arrangement with another studio potter.',
          'Interested in teaching a weekend wheel-throwing workshop.',
        ],
      },
      {
        name: 'Rachel Adler', role: 'Restaurant Owner', location: 'Seattle, WA',
        bio: 'Owner of a 90-seat restaurant planning a full tableware refresh next year.',
        skills: ['restaurant management', 'sourcing', 'menu design'], interests: ['ceramics', 'local makers', 'Pacific Northwest food'],
        intents: [
          'Looking for Pacific Northwest ceramicists or small manufacturers who can produce a 600-piece restaurant tableware set.',
          'Seeking other restaurant owners who have commissioned local tableware.',
          'Open to a small pilot run of plates before committing to a full order.',
          'Looking for a Portland or Seattle-area ceramicist willing to test a new chip-resistant stoneware body with a small pilot batch in daily restaurant service.',
        ],
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
        intents: [
          'Looking for a biostatistician to review an analysis plan for a primary-care access study.',
          'I can provide de-identified community health data and domain interpretation for a methods collaboration.',
          'Seeking other community-health analysts to form a small peer-review circle.',
        ],
      },
      {
        name: 'Dr. Samuel Green', role: 'Biostatistician', location: 'Toronto, Canada',
        bio: 'Independent biostatistician advising health researchers on study design and interpretable analysis.',
        skills: ['biostatistics', 'study design', 'R'], interests: ['health equity', 'reproducible research', 'causal methods'],
        intents: [
          'Available to review a community-health study design and statistical analysis plan.',
          'Seeking applied health partners for publishable work using responsibly governed datasets.',
          'Looking for a co-instructor for a short course on causal methods for health analysts.',
          'Open to advising a graduate student on a thesis analysis.',
        ],
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
        intents: [
          'Looking for an incident-response facilitator to run a realistic ransomware tabletop exercise.',
          'I can share a reusable security readiness checklist with other startup teams building a security function from scratch.',
          'Seeking other security leads at mid-sized European software companies for a peer group.',
        ],
      },
      {
        name: 'Mateo Silva', role: 'Incident Response Consultant', location: 'Prague, Czechia',
        bio: 'Independent consultant designing and facilitating cyber incident simulations for technology companies.',
        skills: ['incident response', 'tabletop facilitation', 'forensic readiness'], interests: ['cyber resilience', 'training', 'organizational learning'],
        intents: [
          'Available to facilitate a ransomware tabletop exercise for a software company in Europe.',
          'Seeking a security team willing to pilot a new cross-functional incident simulation format.',
          'Looking for a forensics specialist to partner with on readiness assessments.',
        ],
      },
      {
        name: 'Viktor Horváth', role: 'Fintech CTO', location: 'Vienna, Austria',
        bio: 'CTO of a payments startup preparing for its first external security assessment.',
        skills: ['engineering leadership', 'payments infrastructure', 'compliance'], interests: ['application security', 'fintech regulation', 'team building'],
        intents: [
          'Looking for a penetration-testing firm or consultant experienced with payments startups.',
          'Seeking other fintech CTOs who have been through bank partner security reviews.',
          'Open to advice on building a security function from scratch.',
        ],
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
        intents: [
          'Looking for a risk-modeling advisor familiar with alternative data and small-business lending.',
          'I can provide cooperative-finance domain knowledge and anonymized repayment patterns for model design.',
          'Seeking lenders or impact funds interested in financing agricultural cooperatives in Ghana.',
          'Looking for other West African fintech founders for a monthly founders call.',
        ],
      },
      {
        name: 'Zuri Boateng', role: 'Credit Risk Data Scientist', location: 'Accra, Ghana',
        bio: 'Data scientist building explainable credit-risk models for lenders serving informal and small businesses.',
        skills: ['credit risk', 'Python', 'explainable ML'], interests: ['financial inclusion', 'alternative data', 'responsible lending'],
        intents: [
          'Available to advise a financial-inclusion startup or lender on transparent alternative-data risk and collections models a loan officer can actually understand.',
          'Seeking a founder or lending-operations partner with strong borrower relationships and clear consent practices.',
          'Looking for other African data scientists working on credit to share methods.',
        ],
      },
      {
        name: 'Wanjiru Kamau', role: 'Microfinance Operations Head', location: 'Nairobi, Kenya',
        bio: 'Runs operations for a microfinance lender and wants better collections analytics.',
        skills: ['lending operations', 'collections', 'branch management'], interests: ['financial inclusion', 'analytics', 'East African fintech'],
        intents: [
          'Looking for a data scientist to build a simple collections-prioritization model for a microfinance lender.',
          'Seeking other microfinance operators in East Africa to compare collections practices.',
          'Open to partnering with a fintech on a digital repayment channel.',
        ],
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
        intents: [
          'Looking for a sound designer to build the final mix and atmospheric soundscape for a 20-minute documentary.',
          'I can collaborate with composers and sound artists on future environmental stories.',
          'Seeking documentary filmmakers in Mexico City for a monthly rough-cut feedback circle.',
        ],
      },
      {
        name: 'Rafael Mendez', role: 'Film Sound Designer', location: 'Mexico City, Mexico',
        bio: 'Freelance sound designer and re-recording mixer working on documentary and independent film.',
        skills: ['sound editing', 'field recording', 'film mixing'], interests: ['documentary film', 'environmental audio', 'experimental music'],
        intents: [
          'Available to sound-design and mix a short documentary over the next six weeks.',
          'Seeking a filmmaker interested in using original field recordings as a narrative element.',
          'Looking for a composer to collaborate with on documentary scores.',
          'Offering studio time to emerging sound designers one evening a week.',
        ],
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
        intents: [
          'Looking for a food scientist to validate shelf-life and small-batch production controls for a new sauce line.',
          'I can offer consumer testing and retail feedback to packaging or food-tech collaborators.',
          'Seeking introductions to Victorian co-packers who take small runs.',
          'Looking for other food founders in Melbourne to share a commercial kitchen lease.',
        ],
      },
      {
        name: 'Arjun Rao', role: 'Food Scientist', location: 'Melbourne, Australia',
        bio: 'Food scientist consulting with small brands on formulation, shelf-life, and production readiness.',
        skills: ['food safety', 'shelf-life testing', 'process controls'], interests: ['small food brands', 'fermentation', 'sustainable packaging'],
        intents: [
          'Available to advise an emerging food brand on shelf-life validation and production controls.',
          'Seeking a founder preparing a real product for a small commercial manufacturing run.',
          'Looking for a packaging specialist to refer clients to.',
        ],
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
        intents: [
          'Looking for a robotics engineer to mentor student teams during a six-week build season.',
          'I can help engineers translate technical projects into age-appropriate workshops.',
          'Seeking donated or discounted microcontroller kits for three school clubs.',
        ],
      },
      {
        name: 'Victor Chen', role: 'Robotics Engineer', location: 'San Jose, CA',
        bio: 'Controls engineer at a warehouse robotics company who volunteers with youth maker programs.',
        skills: ['robot controls', 'embedded systems', 'technical mentoring'], interests: ['STEM education', 'robot competitions', 'open hardware'],
        intents: [
          'Available to mentor a middle-school robotics team one evening per week in San Jose.',
          'Seeking an educator to help turn a simple sensor project into an open workshop.',
          'Looking for other engineers to co-run a weekend robotics workshop.',
        ],
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
        intents: [
          'Looking for a legal-tech engineer to prototype contract-clause extraction and internal search.',
          'I can provide realistic legal workflow requirements and structured feedback on prototypes.',
          'Seeking legal operations peers to benchmark contract turnaround times.',
          'Open to piloting early legal-tech products in exchange for honest feedback.',
        ],
      },
      {
        name: 'Idris Campbell', role: 'Legal-Tech Engineer', location: 'New York, NY',
        bio: 'Software engineer building secure document search and extraction tools for legal teams.',
        skills: ['document pipelines', 'semantic search', 'TypeScript'], interests: ['legal technology', 'privacy engineering', 'knowledge systems'],
        intents: [
          'Available to prototype clause extraction and secure internal search with a legal-operations partner.',
          'Seeking a legal team that can define evaluation criteria and test against synthetic contracts.',
          'Looking for a privacy engineer to review my deployment architecture.',
        ],
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
        intents: [
          'Looking for a geospatial analyst to reproduce and extend a neighborhood walkability study.',
          'I can offer research design, survey data, and co-authorship on an open methods paper.',
          'Seeking urban researchers in Europe to form a walkability methods working group.',
        ],
      },
      {
        name: 'Bastien Moreau', role: 'Geospatial Analyst', location: 'Paris, France',
        bio: 'Independent GIS analyst working on mobility, accessibility, and public-space projects.',
        skills: ['PostGIS', 'QGIS', 'spatial statistics'], interests: ['urban mobility', 'open data', 'reproducible maps'],
        intents: [
          'Available to collaborate on a reproducible walkability analysis using open geospatial data.',
          'Seeking an academic partner with a clear research question and publication plan.',
          'Looking for municipalities that want an open accessibility audit of their street network.',
          'Offering a QGIS workshop for urban researchers.',
        ],
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
        intents: [
          'Looking for a certified physical therapist to review an inclusive beginner mobility program.',
          'I can organize free community pilot sessions and gather participant feedback.',
          'Seeking volunteers to help run Saturday sessions.',
          'Looking for a local clinic to partner with on a health-screening day.',
        ],
      },
      {
        name: 'Jasmine Lee', role: 'Physical Therapist', location: 'Philadelphia, PA',
        bio: 'Outpatient physical therapist focused on strength, mobility, and making exercise approachable for beginners.',
        skills: ['physical therapy', 'mobility coaching', 'injury prevention'], interests: ['community health', 'inclusive fitness', 'outdoor programs'],
        intents: [
          'Available to review and co-design a safe beginner mobility curriculum for a community fitness group.',
          'Seeking a community partner to host a free injury-prevention workshop.',
          'Looking for other clinicians interested in community fitness programs.',
        ],
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
        intents: [
          'Looking for a technical writer to redesign contributor documentation and first-issue pathways.',
          'I can mentor developers who want experience maintaining a widely used TypeScript library.',
          'Open to a volunteer contributor writing tutorials and example content alongside our paid docs contract.',
          'Seeking other maintainers to compare sponsorship and sustainability approaches.',
        ],
      },
      {
        name: 'Nadia Vermeer', role: 'Developer Documentation Writer', location: 'Amsterdam, Netherlands',
        bio: 'Technical writer specializing in developer tools, API references, and contribution guides.',
        skills: ['technical writing', 'information architecture', 'docs testing'], interests: ['open source', 'developer experience', 'inclusive documentation'],
        intents: [
          'Available to improve contributor documentation for an active open-source developer tool.',
          'Seeking a maintainer who can provide user feedback and access to real contributor questions.',
          'Looking for other documentation writers in the Netherlands for a quarterly meetup.',
          'Interested in co-authoring a guide on documentation testing.',
        ],
      },
      {
        name: 'Sven de Jong', role: 'Developer Advocate', location: 'Rotterdam, Netherlands',
        bio: 'Developer advocate at a cloud company who writes open-source tutorials in his spare time.',
        skills: ['developer relations', 'tutorial writing', 'public speaking'], interests: ['open source', 'TypeScript', 'community'],
        intents: [
          'Looking for an open-source TypeScript project that wants tutorials and example content written by a contributor.',
          'Seeking maintainers to interview for a talk on contributor onboarding.',
          'Open to speaking at developer meetups in the Netherlands.',
        ],
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
        intents: [
          'Looking for a venue partner to host a 60-person developer learning event in Bengaluru.',
          'I can bring an established attendee community and manage programming and logistics.',
          'Seeking experienced developers to give practical talks to early-career engineers.',
        ],
      },
      {
        name: 'Karthik Iyer', role: 'Coworking Space Manager', location: 'Bengaluru, India',
        bio: 'Runs community programming at an independent coworking space with an event room.',
        skills: ['venue operations', 'event production', 'community partnerships'], interests: ['technology events', 'founder communities', 'professional learning'],
        intents: [
          'Offering a Bengaluru event space to community organizers running practical technology or founder education.',
          'Seeking a reliable programming partner for a monthly evening event series.',
          'Looking for founders interested in a small resident-founder program.',
          'Open to hosting weekend workshops for a modest fee.',
        ],
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
        intents: [
          'Looking for a materials engineer to evaluate moisture barriers for a compostable packaging prototype.',
          'I can provide prototypes, supplier data, and customer requirements for applied materials testing.',
          'Seeking personal-care brands willing to trial compostable packaging.',
          'Looking for other hardware founders in Vancouver to share prototyping resources.',
        ],
      },
      {
        name: 'Lucas Pereira', role: 'Materials Engineer', location: 'Vancouver, Canada',
        bio: 'Materials engineer consulting on bio-based coatings and packaging performance.',
        skills: ['polymer testing', 'barrier coatings', 'materials characterization'], interests: ['compostable materials', 'circular design', 'manufacturing'],
        intents: [
          'Available to evaluate barrier performance and failure modes for an early compostable packaging prototype.',
          'Seeking a product founder with physical samples and a clear target specification.',
          'Looking for a coatings supplier interested in joint testing of bio-based barriers.',
        ],
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
        intents: [
          'Looking for a freelance story editor to shape a six-episode season about climate-tech operators.',
          'I can offer production support to researchers who want to turn their work into accessible audio stories.',
          'Seeking sponsors interested in African technology audiences.',
        ],
      },
      {
        name: 'Tunde Adebayo', role: 'Story Editor', location: 'Lagos, Nigeria',
        bio: 'Freelance editor helping documentary, podcast, and research teams build clear narrative arcs.',
        skills: ['story editing', 'interview structure', 'script development'], interests: ['climate stories', 'African technology', 'documentary audio'],
        intents: [
          'Available to story-edit a limited podcast series about climate technology and entrepreneurship.',
          'Seeking a producer with recorded interviews and a defined publishing schedule.',
          'Looking for documentary filmmakers in West Africa who need story structure help.',
          'Open to teaching a short course on interview structure.',
        ],
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
        intents: [
          'Looking for an experienced engineering leader to mentor me through my first six months as a manager.',
          'I can mentor junior backend engineers on system design and code review.',
          'Seeking other first-time managers for a peer support group.',
        ],
      },
      {
        name: 'Carla Romero', role: 'VP of Engineering', location: 'Madrid, Spain',
        bio: 'Experienced engineering executive who advises new managers and scaling product teams.',
        skills: ['engineering leadership', 'manager coaching', 'organizational design'], interests: ['leadership development', 'healthy teams', 'technical strategy'],
        intents: [
          'Offering monthly mentorship to a first-time engineering manager navigating team leadership and delegation.',
          'Seeking experienced individual contributors who can mentor early-career developers in a community program.',
          'Open to a few informal video conversations with senior ICs elsewhere in Spain who are weighing whether to move into management.',
          'Looking for other engineering executives in Spain for a quarterly dinner.',
        ],
      },
      {
        name: 'Marta Vidal', role: 'Staff Engineer', location: 'Barcelona, Spain',
        bio: 'Senior backend engineer deciding whether to move into management.',
        skills: ['distributed systems', 'Go', 'technical mentoring'], interests: ['career paths', 'engineering leadership', 'mentoring'],
        intents: [
          'Looking for experienced engineering leaders willing to have a few conversations about whether to move into management.',
          'Offering to mentor early-career backend engineers on distributed systems.',
          'Seeking other senior engineers weighing the same decision.',
        ],
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
        intents: [
          'Looking for a Japanese-English language exchange partner for weekly video conversations.',
          'Offering English conversation practice and help with data-analysis vocabulary.',
          'Seeking people who have done a Tokyo work rotation for practical advice.',
        ],
      },
      {
        name: 'Haruto Mori', role: 'English Language Learner', location: 'Tokyo, Japan',
        bio: 'Japanese operations analyst improving spoken English for international project work.',
        skills: ['operations analysis', 'Japanese conversation', 'process improvement'], interests: ['English language', 'international teams', 'Australian culture'],
        intents: [
          'Seeking a weekly Japanese-English language exchange partner and offering native Japanese conversation practice.',
          'Available for structured video calls alternating between English and Japanese.',
          'Looking for tips from non-native speakers who got comfortable in English-language meetings.',
        ],
      },
    ],
  },
  {
    networks: ['pixel', 'launch'],
    people: [
      {
        name: 'Sofia Almeida', role: 'Boutique Hotel Owner', location: 'Lisbon, Portugal',
        bio: 'Owner of a twelve-room guesthouse in Alfama planning a full interior renovation.',
        skills: ['hospitality', 'small-business finance', 'guest experience'], interests: ['interior design', 'Portuguese craft', 'slow travel'],
        intents: [
          'Looking for an interior architect with hospitality experience to design a twelve-room guesthouse renovation.',
          'Seeking Portuguese furniture and ceramics makers to supply a boutique hotel.',
          'Open to advice from other small hotel owners who have renovated while trading.',
        ],
      },
      {
        name: 'Miguel Rocha', role: 'Interior Architect', location: 'Porto, Portugal',
        bio: 'Interior architect specializing in small hotels and restaurants across Portugal.',
        skills: ['interior architecture', 'hospitality design', 'furniture specification'], interests: ['Portuguese craft', 'adaptive reuse', 'materials'],
        intents: [
          'Available to design a small hotel or guesthouse renovation in Portugal with a strong local-craft direction.',
          'Seeking hospitality owners who want to work with Portuguese makers rather than catalogue furniture.',
          'Looking for a lighting designer to partner with on hospitality projects.',
          'Interested in a collaboration with a tile maker on a limited pattern series.',
        ],
      },
    ],
  },
  {
    networks: ['atelier'],
    people: [
      {
        name: 'Celeste Robinson', role: 'Jazz Vocalist', location: 'New Orleans, LA',
        bio: 'Jazz vocalist with a monthly residency at a Frenchmen Street club, building a steady trio.',
        skills: ['jazz vocals', 'bandleading', 'arranging'], interests: ['jazz standards', 'Brazilian music', 'songwriting'],
        intents: [
          'Looking for a jazz pianist in New Orleans for a monthly residency and occasional private events.',
          'Seeking a drummer and bassist to fill out a working trio, and open to a weekend-only drummer for private events even if they cannot make the Thursday residency.',
          'Open to co-writing with a songwriter who works in jazz or Brazilian idioms.',
        ],
      },
      {
        name: 'Andre Baptiste', role: 'Jazz Pianist', location: 'New Orleans, LA',
        bio: 'Pianist recently relocated to New Orleans, looking for regular gigs and a working band.',
        skills: ['jazz piano', 'accompaniment', 'sight-reading'], interests: ['jazz standards', 'gospel', 'Brazilian music'],
        intents: [
          'Seeking a vocalist or bandleader in New Orleans with regular gigs who needs a pianist.',
          'Available for accompaniment work, residencies, and private events.',
          'Looking for a jam session to meet other musicians in town.',
          'Interested in learning more Brazilian repertoire with someone who knows it well.',
        ],
      },
      {
        name: 'Louis Fontenot', role: 'Drummer', location: 'Baton Rouge, LA',
        bio: 'Weekend drummer with a day job, available for gigs in Baton Rouge and occasionally New Orleans.',
        skills: ['jazz drums', 'brushes', 'funk'], interests: ['jazz', 'second line', 'recording'],
        intents: [
          'Available as a drummer for weekend gigs in Baton Rouge and New Orleans.',
          'Looking for a jazz group that rehearses on weekends.',
          'Open to recording sessions.',
        ],
      },
    ],
  },
  {
    networks: ['reps'],
    people: [
      {
        name: 'Clara Vives', role: 'Gravel Cyclist', location: 'Girona, Spain',
        bio: 'Amateur gravel cyclist training for a 200-kilometre event and looking for structured company.',
        skills: ['endurance riding', 'bike maintenance', 'route planning'], interests: ['gravel cycling', 'bikepacking', 'nutrition'],
        intents: [
          'Looking for gravel riding partners in Girona for weekend long rides at a steady endurance pace.',
          'Seeking a coach or experienced rider to help me structure training for a 200 km event.',
          'Open to a multi-day bikepacking trip in Catalonia later this year.',
        ],
      },
      {
        name: 'Pau Serra', role: 'Cycling Coach', location: 'Girona, Spain',
        bio: 'Coach running small structured group rides and training plans for amateur endurance cyclists.',
        skills: ['cycling coaching', 'training periodization', 'group ride leadership'], interests: ['gravel', 'endurance events', 'sports science'],
        intents: [
          'Offering structured Saturday gravel group rides from Girona for amateur endurance riders.',
          'Available to coach a rider preparing for a first long gravel event.',
          'Looking for a sports nutritionist to run a workshop for my group.',
          'Seeking a second ride leader to help with larger groups.',
        ],
      },
    ],
  },
  {
    networks: ['reps', 'tribe'],
    people: [
      {
        name: 'Jordan Blake', role: 'First-Time Marathoner', location: 'Boston, MA',
        bio: 'Software developer training for a first marathon and looking for long-run company.',
        skills: ['software development', 'consistency', 'spreadsheets'], interests: ['running', 'podcasts', 'city exploration'],
        intents: [
          'Looking for a running partner or small group for Sunday long runs around Boston at roughly 5:30 per km.',
          'Seeking advice from runners who finished a first marathon under four hours.',
          'Open to joining a running club with a structured marathon program.',
        ],
      },
      {
        name: 'Kemi Adeyemi', role: 'Running Club Captain', location: 'Cambridge, MA',
        bio: 'Captain of a community running club with a Sunday long-run group and a volunteer coaching team.',
        skills: ['running coaching', 'group leadership', 'event organizing'], interests: ['marathons', 'inclusive running', 'community'],
        intents: [
          'Welcoming new runners to a Sunday long-run group with pace groups in Cambridge and Somerville.',
          'Looking for experienced runners to volunteer as pace leaders.',
          'Seeking a physiotherapist to give a talk on injury prevention to club members.',
          'Open to partnering with local businesses on a community race.',
        ],
      },
    ],
  },
  {
    networks: ['latent', 'syllabus'],
    people: [
      {
        name: 'Ailsa Ferguson', role: 'PhD Student in Computational Linguistics', location: 'Edinburgh, UK',
        bio: 'Second-year PhD student working on machine translation for low-resource Celtic languages.',
        skills: ['NLP', 'Python', 'Scottish Gaelic'], interests: ['low-resource languages', 'machine translation', 'language revitalization'],
        intents: [
          'Looking for an NLP researcher experienced in low-resource machine translation to informally mentor my PhD work.',
          'Seeking collaborators interested in Celtic language technology.',
          'Offering help with Gaelic language data to researchers who need it.',
        ],
      },
      {
        name: 'Dr. Ravi Menon', role: 'NLP Researcher', location: 'Edinburgh, UK',
        bio: 'Research scientist at an industrial NLP lab in Edinburgh working on multilingual models.',
        skills: ['multilingual NLP', 'machine translation', 'model evaluation'], interests: ['low-resource languages', 'mentoring', 'open science'],
        intents: [
          'Offering informal mentorship to a PhD student working on low-resource machine translation.',
          'Seeking academic collaborators on evaluation methods for low-resource languages.',
          'Separately from my one PhD mentoring slot, I have a bounded evaluation project a masters student could contribute to over a few months.',
          'Looking for a co-organizer for a small Edinburgh NLP reading group.',
        ],
      },
      {
        name: 'Callum Reid', role: 'MSc Student', location: 'Glasgow, UK',
        bio: 'Masters student looking for a thesis topic and supervisor in applied NLP.',
        skills: ['Python', 'statistics', 'web scraping'], interests: ['NLP', 'sports analytics', 'data journalism'],
        intents: [
          'Looking for an external co-supervisor for an applied NLP masters thesis.',
          'Seeking project ideas where a masters student could contribute real value over four months.',
          'Open to research assistant work alongside my studies.',
        ],
      },
    ],
  },
  {
    networks: ['stack', 'launch', 'bench'],
    people: [
      {
        name: 'Vanessa Hart', role: 'Agtech Hardware Founder', location: 'Napa, CA',
        bio: 'Founder building a low-cost soil-moisture sensor network for small vineyards.',
        skills: ['viticulture', 'product management', 'customer development'], interests: ['agtech', 'hardware', 'water conservation'],
        intents: [
          'Looking for an embedded firmware engineer to take a soil-moisture sensor from breadboard prototype to a field-ready pilot.',
          'Seeking other agtech founders to share hardware pilot lessons.',
          'Open to meeting angels who invest in agricultural hardware.',
          'Looking for a contract manufacturer experienced with small outdoor sensor runs.',
        ],
      },
      {
        name: 'Raj Krishnan', role: 'Embedded Firmware Contractor', location: 'Sacramento, CA',
        bio: 'Independent firmware engineer specializing in low-power sensors and LoRa networks.',
        skills: ['embedded C', 'low-power design', 'LoRaWAN'], interests: ['agriculture', 'environmental sensing', 'open hardware'],
        intents: [
          'Available to bring a low-power LoRa sensor from prototype to field pilot as a firmware contractor.',
          'Seeking hardware founders who need someone to own firmware end to end.',
          'Looking for an electronics engineer to partner with on sensor designs.',
        ],
      },
    ],
  },
  {
    networks: ['atelier'],
    people: [
      {
        name: 'Niamh Brennan', role: "Children's Book Author", location: 'Dublin, Ireland',
        bio: 'Author with a finished picture-book manuscript seeking an illustrator before submitting to publishers.',
        skills: ['writing for children', 'storytelling', 'school visits'], interests: ['picture books', 'Irish folklore', 'literacy'],
        intents: [
          'Looking for an illustrator to create sample spreads for a picture-book submission to publishers.',
          'Seeking other children’s writers in Ireland to form a critique group.',
          'Open to advice from authors who have worked with publishers on picture books.',
        ],
      },
      {
        name: 'Oisín Kelly', role: 'Illustrator', location: 'Galway, Ireland',
        bio: 'Illustrator working in watercolor and ink, with two published picture books.',
        skills: ['watercolor', 'character design', 'book illustration'], interests: ['picture books', 'folklore', 'printmaking'],
        intents: [
          'Available to illustrate sample spreads for a picture-book submission package.',
          'Seeking authors with a finished manuscript rooted in folklore or nature.',
          'Looking for a printmaker to collaborate on a limited-edition folklore series.',
          'Open to teaching a watercolor workshop in Galway.',
        ],
      },
    ],
  },
  {
    networks: ['bench', 'tribe'],
    people: [
      {
        name: 'Lucía Hernández', role: 'Home Cook and Teacher', location: 'Oaxaca, Mexico',
        bio: 'Home cook who wants to teach regional Oaxacan cooking classes and needs a kitchen and co-host.',
        skills: ['Oaxacan cooking', 'teaching', 'market sourcing'], interests: ['regional cuisine', 'food heritage', 'community'],
        intents: [
          'Looking for a community kitchen or venue in Oaxaca to host weekend cooking classes.',
          'Seeking a co-host who can handle bookings and English-speaking guests.',
          'Open to teaching at food festivals or community events.',
        ],
      },
      {
        name: 'Mateo Cruz', role: 'Community Kitchen Manager', location: 'Oaxaca, Mexico',
        bio: 'Manages a community kitchen that hosts workshops and wants more regional cooking programming.',
        skills: ['kitchen operations', 'event programming', 'bilingual hosting'], interests: ['food heritage', 'community programs', 'tourism'],
        intents: [
          'Offering a teaching kitchen in Oaxaca to local cooks who want to run weekend classes.',
          'Seeking home cooks with deep regional knowledge to lead small-group classes.',
          'Looking for a photographer to document our programs.',
          'Open to partnering with tour operators who bring small food-focused groups.',
        ],
      },
    ],
  },
  {
    networks: ['tribe', 'bench'],
    people: [
      {
        name: 'Dana Feldman', role: 'Rooftop Garden Organizer', location: 'Brooklyn, NY',
        bio: 'Organizes a volunteer rooftop garden on an apartment building and wants to add beehives.',
        skills: ['community organizing', 'vegetable gardening', 'grant applications'], interests: ['urban agriculture', 'pollinators', 'neighbors'],
        intents: [
          'Looking for an experienced urban beekeeper to set up and mentor us on two rooftop hives.',
          'Seeking other rooftop and community gardens in Brooklyn to trade seedlings and advice.',
          'Open to hosting a workshop on pollinators for neighbors.',
        ],
      },
      {
        name: 'Samir Haddad', role: 'Urban Beekeeper', location: 'Queens, NY',
        bio: 'Hobbyist-turned-mentor beekeeper managing hives on several New York rooftops.',
        skills: ['beekeeping', 'hive inspection', 'teaching'], interests: ['pollinators', 'urban ecology', 'honey'],
        intents: [
          'Available to set up and mentor new rooftop beehives in Brooklyn and Queens.',
          'Seeking community gardens with board approval and volunteers ready to learn beekeeping.',
          'Looking for other beekeepers to share an extractor and a honey-harvest day.',
          'Open to giving pollinator talks at schools and community centers.',
        ],
      },
    ],
  },
  {
    networks: ['syllabus'],
    people: [
      {
        name: 'Grace Mwangi', role: 'Parent', location: 'Nairobi, Kenya',
        bio: 'Parent of a sixteen-year-old preparing for IGCSE mathematics and looking for a tutor.',
        skills: ['accounting', 'organization', 'patience'], interests: ['education', 'parenting', 'gardening'],
        intents: [
          'Looking for an experienced IGCSE mathematics tutor in Nairobi for twice-weekly sessions.',
          'Seeking other parents of IGCSE students to share study resources.',
          'Open to a small group tutoring arrangement with one or two other students.',
        ],
      },
      {
        name: 'Peter Otieno', role: 'Mathematics Tutor', location: 'Nairobi, Kenya',
        bio: 'Secondary mathematics teacher who tutors IGCSE and A-level students in the evenings.',
        skills: ['mathematics teaching', 'exam preparation', 'patient explanation'], interests: ['education', 'chess', 'football'],
        intents: [
          'Available to tutor IGCSE and A-level mathematics students in Nairobi in person or online.',
          'Seeking one or two more students for a small Saturday morning group.',
          'Looking for other tutors to share past-paper resources.',
          'Interested in running a free exam-technique session at a community centre.',
        ],
      },
    ],
  },
  {
    networks: ['stack', 'pixel', 'launch'],
    people: [
      {
        name: 'Felix Brandt', role: 'Developer Tools Founder', location: 'Berlin, Germany',
        bio: 'Founder of an open-source CLI for managing local development environments, looking for a founding designer.',
        skills: ['systems programming', 'developer experience', 'open source'], interests: ['developer tools', 'CLI design', 'startups'],
        intents: [
          'Looking for a founding product designer who has designed developer tools and wants equity in an early-stage company.',
          'Seeking design feedback on a CLI and dashboard from experienced developer-tool designers.',
          'Open to meeting seed investors who back developer-tools companies.',
        ],
      },
      {
        name: 'Lena Hoffmann', role: 'Product Designer', location: 'Hamburg, Germany',
        bio: 'Product designer who has spent five years designing developer tools and infrastructure products.',
        skills: ['product design', 'design systems', 'developer experience research'], interests: ['developer tools', 'early-stage startups', 'typography'],
        intents: [
          'Looking to join an early-stage developer-tools startup as founding designer.',
          'Seeking founders who want design involved in product decisions, not just visuals.',
          'Offering a design review to open-source developer tools.',
          'Looking for other designers working on developer tools to compare notes.',
        ],
      },
    ],
  },
  {
    networks: ['arena'],
    people: [
      {
        name: 'Ethan Walsh', role: 'University Esports President', location: 'Manchester, UK',
        bio: 'President of a university esports society looking for a coach for its competitive Valorant team.',
        skills: ['event organizing', 'team management', 'streaming'], interests: ['esports', 'Valorant', 'community'],
        intents: [
          'Looking for a Valorant coach to work with a university team for one competitive season.',
          'Seeking experienced players to run a strategy workshop for our members.',
          'Open to partnering with other university esports societies for scrims.',
        ],
      },
      {
        name: 'Aaron Mistry', role: 'Former Semi-Pro Valorant Player', location: 'Leeds, UK',
        bio: 'Former semi-professional Valorant player now working in IT who wants to coach.',
        skills: ['Valorant strategy', 'VOD review', 'communication'], interests: ['esports', 'coaching', 'game design'],
        intents: [
          'Offering to coach a competitive amateur or university Valorant team remotely.',
          'Seeking experienced esports coaches for advice on structuring practice.',
          'Looking for a team to scrim with.',
        ],
      },
    ],
  },
  {
    networks: ['arena', 'bench'],
    people: [
      {
        name: 'Freja Lund', role: 'Tabletop Game Designer', location: 'Copenhagen, Denmark',
        bio: 'Designer of a cooperative card game looking for regular playtesters before pitching to publishers.',
        skills: ['game design', 'prototyping', 'graphic layout'], interests: ['board games', 'cooperative play', 'print-and-play'],
        intents: [
          'Looking for a venue and regular playtesters in Copenhagen for a cooperative card game prototype.',
          'Seeking other tabletop designers for feedback exchange.',
          'Open to a co-designer with publishing experience.',
        ],
      },
      {
        name: 'Mikkel Sørensen', role: 'Board Game Cafe Owner', location: 'Copenhagen, Denmark',
        bio: 'Owner of a board game cafe that hosts a monthly prototype playtest night.',
        skills: ['hospitality', 'event hosting', 'game curation'], interests: ['board games', 'designer community', 'local business'],
        intents: [
          'Offering free tables at a monthly prototype playtest night in Copenhagen to tabletop designers.',
          'Seeking designers with prototypes ready for blind playtesting.',
          'Looking for a co-host to help run a second playtest night.',
          'Open to hosting small game-design talks.',
        ],
      },
    ],
  },
  {
    networks: ['arena', 'latent', 'launch'],
    people: [
      {
        name: 'Mira Kovač', role: 'Games Investor', location: 'Berlin, Germany',
        email: 'mira.kovac@sandbox.test',
        fixedIds: { userId: 'f1000000-0000-4000-8000-000000000001', intentIds: ['f2000000-0000-4000-8000-000000000001'] },
        bio: 'Partner at a small fund backing pre-seed studios using generative AI for narrative and dialogue systems. Writes first cheques.',
        skills: ['pre-seed investing', 'game production', 'narrative design'], interests: ['generative AI', 'narrative games', 'European studios'],
        intents: [
          'Looking to back pre-seed game studios using large language models for narrative and dialogue — I write first cheques and want to meet founders before they raise.',
          'Seeking co-investors who focus on European games studios at pre-seed.',
          'Open to speaking with narrative designers about how generative dialogue changes production.',
        ],
      },
      {
        name: 'Deniz Arslan', role: 'Angel Investor', location: 'Istanbul, Turkey',
        email: 'deniz.arslan@sandbox.test',
        fixedIds: { userId: 'f1000000-0000-4000-8000-000000000002', intentIds: ['f2000000-0000-4000-8000-000000000002'] },
        bio: 'Former game studio COO, now angel investing in interactive entertainment and LLM tooling. Prefers companies with a playable build.',
        skills: ['studio operations', 'angel investing', 'live operations'], interests: ['interactive entertainment', 'LLM tooling', 'retention'],
        intents: [
          'Angel investing in interactive entertainment teams applying LLMs to storytelling; I only come in once there is a playable build and some retention signal.',
          'Offering studio-operations advice to early game teams, whether or not I invest.',
          'Looking for other operators-turned-angels in games to syndicate with.',
        ],
      },
      {
        name: 'Ruth Langley', role: 'Seed Fund Principal', location: 'London, UK',
        email: 'ruth.langley@sandbox.test',
        fixedIds: { userId: 'f1000000-0000-4000-8000-000000000003', intentIds: ['f2000000-0000-4000-8000-000000000003'] },
        bio: 'Principal at a seed fund investing in AI-native content tools, from narrative engines to production pipelines.',
        skills: ['seed investing', 'market analysis', 'due diligence'], interests: ['AI-native content tools', 'creative software', 'games'],
        intents: [
          'Seed-stage investor in AI-native narrative tooling for games; I lead rounds and expect a clear view of traction and how much is being raised.',
          'Seeking studio founders willing to share how they evaluate AI production tools, for market research.',
          'Looking for technical advisors who can diligence narrative-engine architectures.',
        ],
      },
      {
        name: 'Tobias Lindqvist', role: 'Game Studio Founder', location: 'Stockholm, Sweden',
        bio: 'Founder of a new studio building a detective game with LLM-driven dialogue, before a first raise.',
        skills: ['game design', 'Unity', 'narrative systems'], interests: ['narrative games', 'generative dialogue', 'indie studios'],
        intents: [
          'Looking to meet pre-seed investors who back narrative game studios using generative AI, ahead of our raise.',
          'Seeking a narrative designer who has worked with LLM-driven characters.',
          'Open to advice from studios that have shipped games with generative dialogue.',
        ],
      },
      {
        name: 'Hye-jin Park', role: 'Studio CEO', location: 'Seoul, South Korea',
        bio: 'CEO of a small studio with a playable LLM-powered story game in closed beta, raising a seed round.',
        skills: ['studio leadership', 'live operations', 'fundraising'], interests: ['interactive fiction', 'LLM games', 'retention'],
        intents: [
          'Raising a $2M seed round for an LLM-powered interactive fiction studio with a playable build and retention data.',
          'Looking for angels with studio operations experience to join the round.',
          'Seeking narrative-tooling companies to partner with on authoring tools.',
          'Open to advice on live operations for generative story games.',
        ],
      },
    ],
  },
];

const MINIMAL_SCENARIO: ScenarioDefinition = {
  // Deliberately one shared market: every profile and signal below
  // belongs to Launch. This makes a reset behave like a small but coherent
  // startup network rather than several disconnected topic islands.
  networks: ['launch'],
  people: [
    {
      name: 'Maya Chen', role: 'Technical Co-founder', location: 'New York, NY',
      email: 'maya.chen@sandbox.test',
      bio: 'Technical co-founder of a developer-tools startup building observability software for AI agents.',
      skills: ['product engineering', 'AI infrastructure', 'developer tools'], interests: ['B2B SaaS', 'agent reliability', 'seed-stage startups'],
      intents: [
        'Looking for a seed investor who understands developer tools and enterprise AI infrastructure.',
        'Seeking a founding backend engineer with distributed systems experience to build reliable AI-agent observability.',
        'Looking to compare early enterprise design-partner contracts with other technical founders.',
      ],
    },
    {
      name: 'Daniel Ruiz', role: 'Founding Engineer', location: 'Brooklyn, NY',
      email: 'daniel.ruiz@sandbox.test',
      bio: 'Backend and infrastructure engineer who has built multi-tenant data platforms at two B2B SaaS startups.',
      skills: ['distributed systems', 'TypeScript', 'Postgres', 'cloud infrastructure'], interests: ['developer tools', 'early-stage teams', 'data systems'],
      intents: [
        'Looking for a founding-engineer role at a developer-tools or AI-infrastructure startup with real design partners.',
        'Open to advising technical founders on event pipelines, multi-tenant architecture, and early reliability trade-offs.',
      ],
    },
    {
      name: 'Aisha Okafor', role: 'Seed Investor', location: 'New York, NY',
      email: 'aisha.okafor@sandbox.test',
      bio: 'Partner at an early-stage fund investing in developer tools, data infrastructure, and enterprise software.',
      skills: ['seed investing', 'enterprise GTM', 'fundraising'], interests: ['developer tools', 'AI infrastructure', 'B2B SaaS'],
      intents: [
        'Looking to meet technical founders raising pre-seed or seed rounds for developer tools, data infrastructure, or enterprise AI software.',
        'Seeking other investors and operators to share diligence on the AI-agent infrastructure market.',
      ],
    },
    {
      name: 'Sofia Martinez', role: 'SaaS Founder', location: 'Austin, TX',
      email: 'sofia.martinez@sandbox.test',
      bio: 'Founder of a workflow-automation company for independent healthcare practices.',
      skills: ['customer discovery', 'healthcare operations', 'B2B product'], interests: ['vertical SaaS', 'enterprise sales', 'founder communities'],
      intents: [
        'Seeking a seed investor experienced with vertical SaaS and healthcare operations software to discuss whether we are ready to raise.',
        'Looking for founders who have moved from services-assisted onboarding to a scalable B2B SaaS product motion.',
      ],
    },
    {
      name: 'Ethan Brooks', role: 'Product-Led Growth Advisor', location: 'San Francisco, CA',
      email: 'ethan.brooks@sandbox.test',
      bio: 'Former product leader who now advises seed-stage B2B founders on activation, onboarding, and early go-to-market systems.',
      skills: ['product strategy', 'activation', 'B2B growth'], interests: ['developer tools', 'vertical SaaS', 'founder coaching'],
      intents: [
        'Open to advising seed-stage B2B SaaS and developer-tools founders who need to improve design-partner activation and onboarding.',
        'Looking to compare early enterprise GTM playbooks with founders and investors working in technical B2B markets.',
      ],
    },
  ],
};

function emailForName(name: string): string {
  return `${name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ø/g, 'o')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '')}@sandbox.test`;
}

function buildPersonas(scenarios: ScenarioDefinition[]): SandboxPersona[] {
  return scenarios.flatMap((scenario) =>
    scenario.people.map((person) => {
      return {
        name: person.name,
        email: person.email ?? emailForName(person.name),
        ...(person.fixedIds ? { fixedIds: person.fixedIds } : {}),
        networkKeys: scenario.networks,
        profile: {
          identity: { name: person.name, bio: `${person.role}. ${person.bio}`, location: person.location },
          narrative: { context: person.bio },
          attributes: { skills: person.skills, interests: person.interests },
        },
        intents: person.intents,
      };
    }),
  );
}

/** The full curated population. */
export const SANDBOX_PERSONAS: SandboxPersona[] = buildPersonas(SCENARIOS);

/**
 * Five people in one shared startup network. Every intent belongs to Launch,
 * producing a connected founder / investor / technical-builder negotiation
 * pool rather than isolated category fixtures.
 */
export const SANDBOX_MINIMAL_PERSONAS: SandboxPersona[] = buildPersonas([MINIMAL_SCENARIO]);

/**
 * Stable people and signals used by the paid, live capability E2E suites.
 * They intentionally use email plus intent position: fixture ids are derived
 * by the seeder and should remain an implementation detail of the fixture.
 */
export const SANDBOX_E2E_CASES = {
  mayaDaniel: {
    source: { email: 'maya.chen@sandbox.test', intentIndex: 1 },
    candidate: { email: 'daniel.ruiz@sandbox.test', intentIndex: 0 },
  },
  mayaAisha: {
    source: { email: 'aisha.okafor@sandbox.test', intentIndex: 0 },
    candidate: { email: 'maya.chen@sandbox.test', intentIndex: 0 },
  },
  mayaSofia: {
    source: { email: 'maya.chen@sandbox.test', intentIndex: 1 },
    candidate: { email: 'sofia.martinez@sandbox.test', intentIndex: 0 },
  },
} as const;

/**
 * A bounded market for live provider tests: the five designated Launch people
 * plus these sixteen already-authored personas from the full curated
 * population (still exported/named "twenty" — the count drifted by one
 * pair in exchange for content relevance, see below).
 */
// Every name here is plausibly launch-adjacent by content, not just by an
// authored network tag — a prior version included a nonprofit-grant-writing
// trio that shared the 'launch' tag but had nothing to do with a dev-tools
// startup, an "obvious non-fit" rather than a real judgment call. It also
// included three trios with no shared network with the core five or each
// other at all, which thinned matches across the whole population.
const SANDBOX_TWENTY_AUTHORED_NAMES = [
  'Amara Okafor', 'Julian Foster', 'Pilar Santos', 'Leo Martins', 'Ines Costa',
  'Duarte Ferreira', 'Sarah Mitchell', 'Idris Campbell', 'Vanessa Hart',
  'Raj Krishnan', 'Diego Alvarez', 'Carla Romero', 'Marta Vidal', 'Kwame Mensah',
  'Zuri Boateng', 'Wanjiru Kamau',
] as const;

export const SANDBOX_TWENTY_PERSONAS: SandboxPersona[] = [
  ...SANDBOX_MINIMAL_PERSONAS,
  ...SANDBOX_PERSONAS
    .filter((persona) => SANDBOX_TWENTY_AUTHORED_NAMES.includes(persona.name as typeof SANDBOX_TWENTY_AUTHORED_NAMES[number]))
    // One shared network for the whole playground population: candidacy comes
    // from being in the same network, so everyone is a candidate for everyone.
    // Whether they actually match is left to real discovery and negotiation
    // (semantic fit, then agent judgment) — not artificial network segregation.
    .map((persona) => ({ ...persona, networkKeys: ['launch'] as SandboxNetworkKey[] })),
];
