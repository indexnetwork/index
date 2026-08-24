/**
 * Curated sandbox population for `protocol_sandbox`.
 *
 * Every person is authored inside a scenario: two people designed to match each
 * other (an ask and an offer that line up), optionally joined by a third who is
 * a plausible adjacent match rather than a designed one, so evaluation has a
 * non-trivial decision to make. Premises are first-person, checkable facts —
 * under the checklist protocol they ARE the client's record, so each person
 * deliberately leaves some obvious dimension unsettled (budget, timeline,
 * remote/in-person, …) for the question flow to ask about.
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
  premises: string[];
  intents: string[];
}

interface PersonDefinition {
  name: string;
  role: string;
  location: string;
  bio: string;
  skills: string[];
  interests: string[];
  premises: string[];
  intents: string[];
  /** Defaults to the next `sandbox-person-NN@index-network.test` address. */
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
        premises: [
          'I lead a 40-person claims operations team at a mid-sized property and casualty insurer in Chicago.',
          'Our team processes roughly 6,000 claim documents a month, most of them scanned PDFs and emailed attachments.',
          'I have sign-off on pilots under $25k without going to procurement.',
          'Any pilot must run on de-identified documents; no live claimant data leaves our environment.',
          'I have evaluated two document-AI vendors this year and both failed on handwritten adjuster notes.',
        ],
        intents: [
          'Looking for an applied AI developer to prototype document extraction and topic classification for insurance claims.',
          'I can offer insurance-domain expertise and real workflow requirements to an AI product team.',
          'Seeking peers in claims or underwriting operations to compare notes on rolling out automation responsibly.',
          'Open to speaking at an insurance-technology meetup about what document AI gets wrong in practice.',
        ],
      },
      {
        name: 'Maya Patel', role: 'Applied ML Engineer', location: 'Chicago, IL',
        bio: 'Independent machine-learning engineer specializing in document intelligence and human-in-the-loop NLP systems.',
        skills: ['Python', 'NLP', 'document extraction', 'model evaluation'], interests: ['insurance technology', 'knowledge systems', 'practical AI'],
        premises: [
          'I have worked independently for three years after five years on a document-understanding team at a large fintech.',
          'I take one applied pilot at a time, typically six to eight weeks, and scope it to a measurable extraction target.',
          'I am comfortable working inside a client environment and have done SOC 2-aligned engagements before.',
          'My day rate is fixed and I do not do equity-only work.',
          'I prefer domains with messy real documents over clean benchmark data.',
          'I can start a new engagement in about three weeks.',
        ],
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
        premises: [
          'I manage a 15-person prior-authorization intake team for a three-hospital health system.',
          'Our intake is fax-heavy; about 70% of requests still arrive as faxed forms.',
          'Anything touching patient data needs a HIPAA business associate agreement before a pilot can start.',
          'I have no dedicated budget yet and would need to make an internal case with early results.',
          'I am exploring, not buying — I want to understand what is feasible before committing.',
        ],
        intents: [
          'Exploring document-automation options for faxed prior-authorization forms and want to talk with practitioners who have done it.',
          'I can describe real healthcare intake workflows to people building document tools.',
          'Looking for other healthcare operations managers to compare automation experiences.',
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
        premises: [
          'I have been climbing for four years and boulder comfortably at V4 indoors.',
          'I live on the European side of Istanbul and climb at gyms in Beşiktaş and Kadıköy.',
          'I can climb Tuesday and Thursday evenings and most Sunday mornings.',
          'I have lead-climbed outdoors twice and want to do more of it with someone experienced.',
          'I own my own shoes and harness but no rope or quickdraws.',
        ],
        intents: [
          'Looking for reliable climbing partners for weekday bouldering sessions and occasional weekend crag trips near Istanbul.',
          'Happy to help newer climbers with trip planning and gym orientation.',
          'Want to find someone who can teach me to lead-belay safely outdoors.',
        ],
      },
      {
        name: 'Kerem Arslan', role: 'Climbing Coach', location: 'Istanbul, Turkey',
        bio: 'Part-time climbing coach and experienced belayer who organizes small, safety-focused outdoor climbing groups.',
        skills: ['lead belaying', 'route planning', 'climbing coaching'], interests: ['rock climbing', 'bouldering', 'alpine safety'],
        premises: [
          'I have climbed for twelve years and coached part-time for five.',
          'I hold a national sport-climbing instructor certification.',
          'I run outdoor trips to Ballıkayalar and Datça a few times a season, usually groups of four to six.',
          'I am free weekday evenings after 7pm and Sunday mornings.',
          'I do not charge friends for partner sessions; coaching is a separate paid thing.',
          'I have a car and a full rope rack.',
        ],
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
        premises: [
          'I started bouldering six months ago and climb around V1 to V2.',
          'I live in Ankara and visit Istanbul roughly once a month for family.',
          'I can climb weekends only during the semester.',
          'I have never climbed outdoors and do not own any gear beyond rental shoes.',
        ],
        intents: [
          'Looking for beginner-friendly climbing partners in Ankara for weekend gym sessions.',
          'Would love to join a guided outdoor climbing day somewhere in Turkey when I am ready.',
          'Open to climbing in Istanbul on the weekends I am in town.',
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
        premises: [
          'I founded the company 18 months ago; we are two co-founders and one contract engineer.',
          'We have eleven paying practices at around $300 a month each and about four months of runway left.',
          'We raised a $400k pre-seed from angels last year and are not raising again until we have a repeatable acquisition channel.',
          'All of our customers so far came from my professional network and referrals.',
          'I can pay a fractional marketer a monthly retainer but cannot offer a full-time salary.',
        ],
        intents: [
          'Looking for a fractional growth marketer experienced in taking vertical SaaS products from pilot customers to repeatable acquisition.',
          'I can share healthcare-practice customer research with other founders building operational tools.',
          'Seeking other vertical SaaS founders at a similar stage for a monthly accountability call.',
          'Open to meeting angels who focus on healthcare operations software.',
        ],
      },
      {
        name: 'Julian Foster', role: 'Fractional Growth Marketer', location: 'Austin, TX',
        bio: 'Fractional growth lead for seed-stage B2B software companies, with a focus on founder-led sales and lifecycle experiments.',
        skills: ['positioning', 'growth experiments', 'lifecycle marketing'], interests: ['vertical SaaS', 'early-stage startups', 'sales systems'],
        premises: [
          'I was head of growth at two seed-stage B2B companies before going fractional three years ago.',
          'I take on at most three clients at a time, and one slot opens next month.',
          'I work on a monthly retainer with a three-month minimum.',
          'I only take clients who already have at least a handful of paying customers.',
          'I have worked with healthcare and legal vertical SaaS specifically.',
          'I am based in Austin and prefer clients I can meet in person once a month.',
        ],
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
        premises: [
          'We are pre-launch with a waitlist of about 2,000 gig workers gathered through TikTok.',
          'I am a solo founder working with two contract developers.',
          'We have not raised money; I am funding the company from savings.',
          'I need someone who understands consumer app launches, not B2B sales.',
        ],
        intents: [
          'Looking for a growth marketer who has launched a consumer fintech app and can help plan our first 90 days.',
          'Seeking other solo founders in Texas building consumer products.',
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
        premises: [
          'I own onboarding for a budgeting app with around 200k monthly active users across Portugal, Spain, and Italy.',
          'Our day-seven retention for first-time users dropped from 34% to 27% over the last two quarters.',
          'I have a research budget of about €8k for this quarter.',
          'Our users speak Portuguese, Spanish, or Italian; most of our past research was English-only.',
          'I need findings by the end of next quarter to influence the roadmap.',
          'We have a recruited consumer panel of about 400 opted-in users.',
        ],
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
        premises: [
          'I have run independent UX research for six years, mostly for consumer mobile apps.',
          'I conduct interviews in Portuguese, Spanish, and English myself and subcontract Italian.',
          'A typical four-week study for me runs twelve to sixteen interviews plus a synthesis workshop.',
          'I can start within two weeks.',
          'I have done three fintech onboarding studies in the last two years.',
        ],
        intents: [
          'Available for a four-week fintech onboarding research project, including Portuguese and English participant interviews.',
          'Looking for product teams that will let research findings directly shape their roadmap.',
          'Seeking a research partner who covers French and German for larger European studies.',
          'Interested in teaching a short workshop on interview synthesis for product teams.',
        ],
      },
      {
        name: 'Duarte Ferreira', role: 'Enterprise UX Researcher', location: 'Porto, Portugal',
        bio: 'UX researcher focused on B2B enterprise software and internal tools, occasionally available for consumer work.',
        skills: ['contextual inquiry', 'enterprise UX', 'workshop facilitation'], interests: ['B2B software', 'service design', 'research operations'],
        premises: [
          'Most of my work is contextual inquiry inside large enterprises; I have done one consumer study in five years.',
          'I work in Portuguese and English only.',
          'I am fully booked for the next six weeks.',
          'I prefer long engagements of three months or more.',
        ],
        intents: [
          'Available later this year for UX research engagements with B2B software teams in Portugal.',
          'Looking for other researchers to share a research-ops toolkit with.',
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
        premises: [
          'I am a senior researcher at a London think tank focused on local government and climate adaptation.',
          'I have assembled a public dataset covering heat-adaptation spending across 120 UK councils from 2018 to 2024.',
          'I want to publish an open research brief by early next year.',
          'I have no budget for a contractor; this would be a co-authored collaboration.',
          'I can interview council officers to validate any quantitative findings.',
        ],
        intents: [
          'Looking for a data scientist to analyze a public dataset on municipal heat-adaptation investments and outcomes.',
          'I can offer policy context and co-author an open research brief on local climate resilience.',
          'Seeking council officers willing to be interviewed about how adaptation funding decisions are made.',
        ],
      },
      {
        name: 'Daniel Wu', role: 'Civic Data Scientist', location: 'London, UK',
        bio: 'Data scientist working with public and nonprofit datasets, especially geospatial and policy evaluation projects.',
        skills: ['Python', 'geospatial analysis', 'causal inference'], interests: ['climate data', 'public policy', 'open-source research'],
        premises: [
          'I work four days a week for a civic-tech nonprofit and keep Fridays for pro-bono or co-authored projects.',
          'I have published two peer-reviewed policy evaluation papers using council-level data.',
          'I work in Python and publish all of my analysis code openly.',
          'I can commit about a day a week for three months to a bounded analysis.',
          'I am most useful when someone else owns the policy framing and I own the methods.',
        ],
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
        premises: [
          'I am freelance and write for national outlets on climate and local government.',
          'I have obtained council flood-defence spending data through freedom-of-information requests but cannot analyze it properly myself.',
          'My story deadline is in about six weeks.',
          'I can credit a collaborator by name but cannot pay much.',
        ],
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
        premises: [
          'I direct programs at a neighborhood nonprofit with an annual budget around $900k.',
          'We run a youth workforce program that served 140 high-school students last year.',
          'We are applying for a federal workforce-development grant with a deadline at the end of next quarter.',
          'We have two years of outcome data: completion rates, job placements, and six-month follow-ups.',
          'I can pay a grant consultant a flat fee from a capacity-building grant we already hold.',
          'I will be the staff owner of the application and can give it about five hours a week.',
        ],
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
        premises: [
          'I have written grants for community organizations for nine years, with a focus on workforce and education funders.',
          'I have won federal Department of Labor grants for three Atlanta organizations.',
          'I work on a flat fee per application and do not take success-based fees.',
          'I can take on one more application this quarter.',
          'I only work with organizations that have a named staff owner and at least one year of outcome data.',
        ],
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
        premises: [
          'Our arts center has a budget of about $250k and two full-time staff.',
          'We have never applied for a national arts-agency grant; so far all funding has been local.',
          'Our deadline is in four months.',
          'We can pay a modest fee but would prefer a mentor-style arrangement.',
        ],
        intents: [
          'Looking for a grant writer who knows arts funders to guide our first national application.',
          'Seeking other small arts organizations in the Southeast to share funder intelligence.',
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
        premises: [
          'I teach physics to about 150 students a year across five sections at a public high school in south Seattle.',
          'Roughly a third of my students are multilingual learners.',
          'Our energy unit runs every spring and I can schedule a guest speaker with three weeks notice.',
          'Guest speakers need a background check through the district, which takes about two weeks.',
          'I have no budget for speaker fees.',
        ],
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
        premises: [
          'I design commercial solar and battery-storage installations for an engineering firm in Seattle.',
          'I have given classroom talks at four schools over the last two years.',
          'I can take a weekday morning or afternoon off about once a month for outreach.',
          'I have a tabletop battery-storage demo kit that I built myself.',
          'I have already completed a school-district volunteer background check this year.',
        ],
        intents: [
          'Available to give classroom talks or practical demonstrations about solar and battery engineering in Seattle.',
          'Seeking a teacher partner to adapt an energy-storage demonstration for high-school students.',
          'Looking for other engineers who do STEM outreach to share demo materials.',
          'Interested in mentoring a student capstone project on home solar design.',
        ],
      },
      {
        name: 'Gwen Harper', role: 'Wind Turbine Technician', location: 'Tacoma, WA',
        bio: 'Field technician servicing wind turbines who would like to tell students about skilled trades in renewables.',
        skills: ['turbine maintenance', 'electrical troubleshooting', 'safety training'], interests: ['skilled trades', 'renewable energy', 'mentoring'],
        premises: [
          'I service wind turbines across Washington and Oregon and am on the road three weeks out of four.',
          'I can only commit to outreach on weekends or during my off-rotation week.',
          'I have never spoken to a classroom before.',
          'I care most about students learning that renewables have trades careers, not just engineering ones.',
        ],
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
        premises: [
          'I produce a five-person indie team building a narrative adventure in Unity.',
          'We are preparing a vertical slice for publisher pitches in about three months.',
          'Our lighting and shader performance is the biggest gap between our build and our art target.',
          'We have a contracting budget of roughly CAD 15k for the slice.',
          'The team works remotely with a weekly in-person day in Montreal.',
        ],
        intents: [
          'Looking for a freelance technical artist who can improve Unity lighting and shader performance for a vertical slice.',
          'I can offer production coaching to first-time indie teams struggling with scope.',
          'Seeking publishers or funds interested in narrative-driven indie games.',
          'Looking for a narrative designer to review our branching dialogue structure.',
        ],
      },
      {
        name: 'Noah Tremblay', role: 'Technical Artist', location: 'Montreal, Canada',
        bio: 'Freelance technical artist bridging art and engineering for stylized Unity projects.',
        skills: ['Unity', 'shaders', 'lighting optimization'], interests: ['indie games', 'procedural art', 'real-time rendering'],
        premises: [
          'I have shipped three Unity titles as a technical artist, two of them stylized indie games.',
          'I work freelance and am available for a six-week contract starting next month.',
          'I specialize in URP shaders and lighting optimization for mid-range hardware.',
          'I need a playable build and a defined art direction before I quote.',
          'I live in Montreal and can come in one day a week.',
        ],
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
        premises: [
          'I work exclusively in Unreal Engine and have not used Unity in a production setting.',
          'I am available for contracts of four to eight weeks.',
          'I work remotely from Quebec City.',
          'My strongest work is stylized particle and material effects.',
        ],
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
        premises: [
          'I coordinate programs at a Berlin nonprofit supporting about 300 newly arrived families a year.',
          'Our annual impact report goes to print in four months and needs fifteen to twenty portraits.',
          'Every participant photographed must give informed consent and review their image before publication.',
          'We can pay a modest project fee from our communications budget.',
          'Shoots would take place at our centre in Neukölln during program hours.',
          'I speak Arabic, German, and English and can interpret during sessions.',
        ],
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
        premises: [
          'I have photographed for Berlin nonprofits and two national newspapers over eight years.',
          'I use a written consent and image-review process on every community project.',
          'I can take on a portrait project over the next two months.',
          'I reduce my rate for nonprofits but do not work unpaid.',
          'I speak German and English only and appreciate an interpreter on site.',
        ],
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
        premises: [
          'I have owned a 30-seat neighborhood cafe in southeast Portland for six years.',
          'I want to replace our espresso cups with a locally made set of about 60 cups and saucers.',
          'Cups must survive a commercial dishwasher and daily drops; we break about five a month now.',
          'I have set aside roughly $2,500 for the first run.',
          'I would like the new set in place before our anniversary event in the autumn.',
        ],
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
        premises: [
          'I run a one-person studio in Portland and have supplied four restaurants with tableware.',
          'I can produce about 80 cups a month alongside my other work.',
          'I have a new stoneware body I believe is significantly more chip-resistant and want to prove it in daily service.',
          'My per-cup price for commissions is in the $25 to $40 range depending on glaze.',
          'I need six to eight weeks from approved sample to delivery.',
        ],
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
        premises: [
          'I run a 90-seat restaurant in Seattle and want to replace all of our plates and bowls next year.',
          'The order would be around 600 pieces, which most single-person studios cannot produce.',
          'I have a budget of about $20k for the full set.',
          'I have not decided between a single maker and a small manufacturer.',
        ],
        intents: [
          'Looking for Pacific Northwest ceramicists or small manufacturers who can produce a 600-piece restaurant tableware set.',
          'Seeking other restaurant owners who have commissioned local tableware.',
          'Open to a small pilot run of plates before committing to a full order.',
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
        premises: [
          'I am the only analyst at a community health centre serving about 12,000 patients in east Toronto.',
          'I have a draft analysis plan for a study on primary-care access and wait times across our three sites.',
          'The data is de-identified and covered by our existing research ethics approval.',
          'I need the plan reviewed before our data pull in six weeks.',
          'I have no consulting budget; I can offer co-authorship on the resulting report.',
        ],
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
        premises: [
          'I left a university biostatistics department two years ago and now consult independently.',
          'I review two or three analysis plans a month, some pro bono for community organizations.',
          'I work in R and insist on reproducible, scripted analyses.',
          'I am interested in work that can be published, ideally with co-authorship.',
          'I can turn around a plan review within two weeks.',
        ],
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
        premises: [
          'I lead a three-person security team at a 180-person B2B software company in Prague.',
          'We have an incident-response plan on paper but have never exercised it.',
          'I want to run a ransomware tabletop with engineering, legal, and leadership before the end of the quarter.',
          'I have budget for an external facilitator for a one-day exercise.',
          'Most of our leadership team is in Prague; engineering is split between Prague and Brno.',
        ],
        intents: [
          'Looking for an incident-response facilitator to run a realistic ransomware tabletop exercise.',
          'I can share a reusable security readiness checklist with other startup teams.',
          'Seeking other security leads at mid-sized European software companies for a peer group.',
        ],
      },
      {
        name: 'Mateo Silva', role: 'Incident Response Consultant', location: 'Prague, Czechia',
        bio: 'Independent consultant designing and facilitating cyber incident simulations for technology companies.',
        skills: ['incident response', 'tabletop facilitation', 'forensic readiness'], interests: ['cyber resilience', 'training', 'organizational learning'],
        premises: [
          'I spent seven years on an incident-response team before going independent three years ago.',
          'I have facilitated around 40 tabletop exercises, mostly for software companies in central Europe.',
          'I am developing a new cross-functional format that includes legal and communications roles.',
          'I can run an exercise with about four weeks of lead time.',
          'I facilitate in English, Spanish, and Czech.',
        ],
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
        premises: [
          'I am CTO of a 25-person payments startup in Vienna.',
          'We need a penetration test and security audit before a partner bank will integrate with us.',
          'The bank expects a report within three months.',
          'We have a budget for an external assessment but have never commissioned one.',
        ],
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
        premises: [
          'I founded a bookkeeping platform used by 35 agricultural cooperatives in Ghana.',
          'We hold two years of anonymized repayment and savings data for about 4,000 cooperative members.',
          'All members have consented to their anonymized data being used for product development.',
          'We are pre-seed and I cannot pay a market consulting rate, but I can offer an advisor equity grant.',
          'I want to launch a small-loan product for cooperatives within a year.',
        ],
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
        premises: [
          'I have built credit-risk models for two microfinance lenders and a mobile-money provider.',
          'I work full-time for a lender and advise startups on the side, a few hours a week.',
          'I will only work with data where borrower consent is clearly documented.',
          'I prefer advisory equity or a modest retainer over one-off payments.',
          'I specialize in explainable models that a loan officer can understand.',
        ],
        intents: [
          'Available to advise a financial-inclusion startup on transparent alternative-data risk modeling.',
          'Seeking a founder partner with strong borrower relationships and clear consent practices.',
          'Looking for other African data scientists working on credit to share methods.',
        ],
      },
      {
        name: 'Wanjiru Kamau', role: 'Microfinance Operations Head', location: 'Nairobi, Kenya',
        bio: 'Runs operations for a microfinance lender and wants better collections analytics.',
        skills: ['lending operations', 'collections', 'branch management'], interests: ['financial inclusion', 'analytics', 'East African fintech'],
        premises: [
          'I head operations for a microfinance lender with 20,000 active borrowers across Kenya.',
          'Our collections process is manual and we want to prioritize follow-ups with data.',
          'We have a small budget for a consultant but no in-house data scientist.',
          'Our data is in a core banking system that exports to spreadsheets only.',
        ],
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
        premises: [
          'I am finishing a 20-minute documentary about water access in Iztapalapa; picture lock is in three weeks.',
          'I have a festival submission deadline in ten weeks.',
          'The film was funded by a small arts grant and I have about MXN 40,000 left for post-production sound.',
          'The existing field audio is rough and was recorded on a camera mic.',
          'I work in Spanish and English.',
        ],
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
        premises: [
          'I have mixed about 30 short documentaries and four features over ten years.',
          'I have a small mixing studio in Colonia Roma.',
          'I can take a short film over the next six weeks.',
          'I often offer reduced rates for grant-funded documentaries if I get a credit and festival access.',
          'I keep an archive of original Mexico City field recordings I like to use as narrative elements.',
        ],
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
        premises: [
          'I make three sauces in a shared commercial kitchen and sell them through eight Melbourne grocers.',
          'I want to move to a co-packer and need validated shelf-life and process controls first.',
          'I have a budget of around AUD 6,000 for food-science consulting.',
          'My target is a twelve-month ambient shelf life.',
          'I want to be production-ready within four months.',
        ],
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
        premises: [
          'I worked in quality assurance at a large food manufacturer for eight years before consulting.',
          'I advise four or five small brands a year on shelf-life and process validation.',
          'I partner with an accredited lab in Melbourne for challenge testing.',
          'A typical shelf-life validation engagement takes three to four months including lab time.',
          'I only take on products that are headed for a real commercial production run.',
        ],
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
        premises: [
          'I coordinate robotics clubs at three middle schools with about 60 students in total.',
          'Our build season runs six weeks in the spring with sessions on Tuesday and Thursday afternoons.',
          'Mentors need a district volunteer clearance, which I can process in about ten days.',
          'We have kits and tools but lack mentors with real controls or embedded experience.',
          'Mentoring is unpaid; we can cover mileage.',
        ],
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
        premises: [
          'I have worked as a controls engineer on warehouse robots for six years.',
          'I mentored a high-school robotics team for two seasons before moving to San Jose.',
          'I can give one weekday evening a week during a build season, plus occasional Saturdays.',
          'I have a simple sensor-and-motor project I would like to turn into an open workshop.',
          'I already hold a current school volunteer clearance from a neighboring district.',
        ],
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
        premises: [
          'I manage legal operations for a 600-person technology company with a twelve-lawyer legal team.',
          'We review about 200 commercial contracts a month and have no searchable clause library.',
          'I can run a prototype on a synthetic contract set I have already prepared.',
          'Any tool touching real contracts must pass our security review, which takes six to eight weeks.',
          'I have a small innovation budget for this year that I have not allocated.',
        ],
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
        premises: [
          'I spent four years building document tooling at a legal-tech company before going independent.',
          'I build in TypeScript and prefer self-hosted deployments for legal clients.',
          'I can run a four-week prototype against synthetic contracts before any security review.',
          'I am looking for design partners rather than one-off contracts.',
          'I am based in New York and can work on site part of the week.',
        ],
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
        premises: [
          'I am a postdoctoral researcher in urban studies at a Paris university.',
          'I have survey data from 1,200 residents across eight Paris neighborhoods on walking habits.',
          'I want to reproduce a published walkability index and extend it with my survey data.',
          'I aim to submit a methods paper within nine months.',
          'I have a small research budget that can cover data costs but not a salary.',
        ],
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
        premises: [
          'I have worked as a freelance GIS analyst for seven years, mostly for municipalities and research groups.',
          'I work entirely with open data and open-source tools and publish reproducible pipelines.',
          'I can give about two days a week to a research collaboration for the next few months.',
          'I want academic co-authorship; it matters more to me than a fee for this kind of work.',
          'I have built walkability and accessibility indices for two French cities.',
        ],
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
        premises: [
          'I run free outdoor fitness sessions in two West Philadelphia parks every Saturday morning.',
          'Sessions draw 20 to 40 people, many of them over 50 and new to exercise.',
          'I have a draft eight-week beginner mobility program that I want a professional to review.',
          'I am a certified group fitness instructor but not a clinician.',
          'Everything we do is free and volunteer-run.',
        ],
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
        premises: [
          'I have practiced outpatient physical therapy in Philadelphia for eight years.',
          'I can volunteer a few hours a month for community programs.',
          'I have reviewed exercise curricula for two community centers before.',
          'I am free most Saturday mornings.',
          'I would like to run a free injury-prevention workshop once a quarter.',
        ],
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
        premises: [
          'I maintain a TypeScript validation library with about 2 million weekly downloads.',
          'I receive roughly 30 new issues a week and about 40% of them are documentation confusion.',
          'The project has a small sponsorship income that can fund a documentation contract.',
          'I can give a writer access to contributor analytics, Discord questions, and the issue tracker.',
          'I want the new contributor docs live before our next major release in about four months.',
        ],
        intents: [
          'Looking for a technical writer to redesign contributor documentation and first-issue pathways.',
          'I can mentor developers who want experience maintaining a widely used TypeScript library.',
          'Seeking other maintainers to compare sponsorship and sustainability approaches.',
        ],
      },
      {
        name: 'Nadia Vermeer', role: 'Developer Documentation Writer', location: 'Amsterdam, Netherlands',
        bio: 'Technical writer specializing in developer tools, API references, and contribution guides.',
        skills: ['technical writing', 'information architecture', 'docs testing'], interests: ['open source', 'developer experience', 'inclusive documentation'],
        premises: [
          'I have written developer documentation for six years, including contributor guides for two open-source projects.',
          'I can take on one documentation project at a time, typically six to ten weeks.',
          'I test every guide by following it on a clean machine before publishing.',
          'I charge a project fee and offer a discount for sponsorship-funded open-source work.',
          'I need access to real contributor questions to write well.',
        ],
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
        premises: [
          'I work full-time in developer relations and contribute to open source a few hours a week.',
          'I write tutorials and conference talks, not reference documentation.',
          'I can only commit to unpaid spare-time contributions.',
          'I have used the major TypeScript validation libraries in production.',
        ],
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
        premises: [
          'I organize a peer-learning community of about 1,500 early-career developers in Bengaluru.',
          'We run an evening event every month that draws 50 to 70 people.',
          'Our current venue is closing and we need a new one within two months.',
          'Events are free for attendees and I cover costs through small sponsorships.',
          'We need a room for 60 with a projector, ideally in Indiranagar or Koramangala.',
        ],
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
        premises: [
          'I manage an independent coworking space in Indiranagar with an 80-seat event room.',
          'The event room is free on weekday evenings and I can offer it at no cost to community organizers.',
          'I want a reliable monthly event series that brings developers and founders into the space.',
          'We provide AV, seating, and basic refreshments.',
          'Events must end by 9:30pm.',
        ],
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
        premises: [
          'I have a fiber-based compostable jar prototype and three personal-care brands waiting to trial it.',
          'The prototype fails on moisture barrier after about three weeks with water-based creams.',
          'I have physical samples and supplier data sheets ready to share.',
          'I have a testing budget of around CAD 10k for this phase.',
          'I want a go or no-go decision on the current design within three months.',
        ],
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
        premises: [
          'I have a PhD in polymer science and consult on bio-based packaging materials.',
          'I have access to a university lab for barrier and permeability testing.',
          'I need physical samples and a target specification before I can scope an evaluation.',
          'A typical evaluation takes six to eight weeks.',
          'I work with early-stage founders at a reduced rate when the work is publishable.',
        ],
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
        premises: [
          'I produce an interview podcast with about 15,000 listeners per episode.',
          'I have recorded twelve interviews for a six-episode season about climate-tech operators.',
          'The season launches in three months on a fixed schedule already announced to sponsors.',
          'I have a small editorial budget from a sponsor for a story editor.',
          'I work from Lagos and collaborate remotely.',
        ],
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
        premises: [
          'I have story-edited four podcast seasons and two documentary films.',
          'I can take a limited series if the interviews are already recorded and the schedule is fixed.',
          'I charge per episode and can start within two weeks.',
          'I work remotely and review rough cuts asynchronously.',
          'I am most interested in climate and technology stories from African contexts.',
        ],
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
        premises: [
          'I was promoted to engineering manager three months ago and lead eight developers across Spain and Portugal.',
          'I have never managed people before and my company has no formal manager training.',
          'I struggle most with delegation and with running useful one-on-ones.',
          'I can meet a mentor for an hour every two weeks.',
          'My company would reimburse a mentorship fee up to a modest amount.',
        ],
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
        premises: [
          'I have led engineering organizations of up to 120 people over fifteen years.',
          'I mentor two or three new managers at a time, usually for six months each.',
          'I have one mentoring slot opening next month.',
          'I mentor for free but ask mentees to commit to every session and come prepared.',
          'I prefer monthly in-person sessions in Madrid with a short check-in in between.',
        ],
        intents: [
          'Offering monthly mentorship to a first-time engineering manager navigating team leadership and delegation.',
          'Seeking experienced individual contributors who can mentor early-career developers in a community program.',
          'Looking for other engineering executives in Spain for a quarterly dinner.',
        ],
      },
      {
        name: 'Marta Vidal', role: 'Staff Engineer', location: 'Barcelona, Spain',
        bio: 'Senior backend engineer deciding whether to move into management.',
        skills: ['distributed systems', 'Go', 'technical mentoring'], interests: ['career paths', 'engineering leadership', 'mentoring'],
        premises: [
          'I am a staff engineer at a 300-person company and have been offered a team-lead role.',
          'I have not decided whether I want to manage at all.',
          'I would like to talk to people who made the switch and people who chose not to.',
          'I can do video calls; I am rarely in Madrid.',
        ],
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
        premises: [
          'I move to Tokyo for a one-year work rotation in five months.',
          'My Japanese is around JLPT N4: I can hold simple conversations but struggle with workplace language.',
          'I can do a weekly one-hour video call on weekday evenings Sydney time.',
          'I am a native English speaker and work as a product analyst.',
          'I would rather exchange than pay for lessons.',
        ],
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
        premises: [
          'I work as an operations analyst in Tokyo and join weekly calls with colleagues in Sydney and Singapore.',
          'My English reading is strong but I freeze in spoken meetings.',
          'I am free on weekday evenings after 8pm Tokyo time.',
          'I am a native Japanese speaker and happy to explain workplace Japanese.',
          'I want a structured exchange where each call alternates languages.',
        ],
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
        premises: [
          'I own a twelve-room guesthouse in Alfama that I bought four years ago.',
          'I am renovating all twelve rooms and the breakfast room, and want to close for the work in the low season.',
          'My renovation budget is around €180,000 including furniture.',
          'I want the design to use Portuguese makers and materials wherever possible.',
          'I have a builder already; I need the design and specification work.',
        ],
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
        premises: [
          'I have designed nine small hotels and guesthouses in Portugal over the last decade.',
          'I work with a network of Portuguese makers for furniture, tiles, and lighting.',
          'I can take on one new project starting in about two months.',
          'I charge a percentage of the construction budget and need the budget agreed before I start.',
          'I travel to Lisbon regularly and can attend site meetings fortnightly.',
        ],
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
        premises: [
          'I have sung professionally in New Orleans for eight years.',
          'I hold a monthly Thursday-night residency and occasional private events.',
          'My regular pianist is moving away next month.',
          'The residency pays each musician a flat fee per night plus tips.',
          'I rehearse once a week on Monday afternoons.',
          'My book is mostly standards with some original songs and a few Brazilian tunes.',
        ],
        intents: [
          'Looking for a jazz pianist in New Orleans for a monthly residency and occasional private events.',
          'Seeking a drummer and bassist to fill out a working trio.',
          'Open to co-writing with a songwriter who works in jazz or Brazilian idioms.',
        ],
      },
      {
        name: 'Andre Baptiste', role: 'Jazz Pianist', location: 'New Orleans, LA',
        bio: 'Pianist recently relocated to New Orleans, looking for regular gigs and a working band.',
        skills: ['jazz piano', 'accompaniment', 'sight-reading'], interests: ['jazz standards', 'gospel', 'Brazilian music'],
        premises: [
          'I moved to New Orleans three months ago after ten years playing in Chicago.',
          'I accompany vocalists comfortably and read charts well.',
          'I am available most evenings and can rehearse weekday afternoons.',
          'I play an electric stage piano and can bring it to gigs.',
          'I want regular work rather than one-off gigs.',
        ],
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
        premises: [
          'I work a day job and play drums on weekends.',
          'I can drive to New Orleans for Friday or Saturday gigs but not weeknights.',
          'I own a full kit and a van.',
          'I have played in a few jazz and funk bands in Baton Rouge over fifteen years.',
        ],
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
        premises: [
          'I have ridden gravel for three years and average about 25 km/h on mixed terrain.',
          'I am training for a 200-kilometre gravel event in four months.',
          'I can ride Saturday and Sunday mornings and one weekday evening.',
          'I have never followed a structured training plan.',
          'I live in Girona and ride from the city centre.',
        ],
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
        premises: [
          'I am a certified cycling coach and have coached amateurs for six years.',
          'I lead a Saturday morning gravel group of six to ten riders from Girona.',
          'The group ride is free; individual training plans are paid.',
          'I have coached about a dozen riders through their first 200 km events.',
          'I ride at an endurance pace on group days and do not drop people.',
        ],
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
        premises: [
          'I have run for two years and finished three half marathons around 1:55.',
          'I am registered for a marathon in five months and want to finish under four hours.',
          'I do my long run on Sunday mornings, currently up to 22 km.',
          'I live in Somerville and usually run along the Charles.',
          'I train alone and find long runs mentally hard.',
        ],
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
        premises: [
          'I captain a free community running club with about 80 members in Cambridge and Somerville.',
          'We run a Sunday long run with pace groups from 5:00 to 7:00 per km.',
          'We have a volunteer-led sixteen-week marathon program starting next month.',
          'Membership is free; we ask people to volunteer at one event a year.',
          'I have run eleven marathons and coach informally.',
        ],
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
        premises: [
          'I am in the second year of a PhD on machine translation for Scottish Gaelic and Irish.',
          'My supervisor is a phonetician and cannot advise on modern MT methods.',
          'I have assembled a parallel corpus of about 400,000 sentence pairs.',
          'I need to submit my first paper within six months to stay on track.',
          'I am based in Edinburgh and can meet in person.',
        ],
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
        premises: [
          'I work on multilingual translation models at an industrial research lab in Edinburgh.',
          'I completed my own PhD on low-resource MT six years ago.',
          'I can mentor one student informally with a meeting every few weeks.',
          'My employer allows academic collaboration as long as results are published openly.',
          'I am especially interested in languages with under a million speakers.',
        ],
        intents: [
          'Offering informal mentorship to a PhD student working on low-resource machine translation.',
          'Seeking academic collaborators on evaluation methods for low-resource languages.',
          'Looking for a co-organizer for a small Edinburgh NLP reading group.',
        ],
      },
      {
        name: 'Callum Reid', role: 'MSc Student', location: 'Glasgow, UK',
        bio: 'Masters student looking for a thesis topic and supervisor in applied NLP.',
        skills: ['Python', 'statistics', 'web scraping'], interests: ['NLP', 'sports analytics', 'data journalism'],
        premises: [
          'I am halfway through an MSc in data science in Glasgow.',
          'I need a thesis topic and an external co-supervisor within two months.',
          'I have done coursework in NLP but no research.',
          'I am interested in applied projects more than theory.',
        ],
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
        premises: [
          'I grew up on a vineyard and worked in vineyard management for nine years before starting the company.',
          'We have a working sensor prototype on breadboards and three vineyards signed up for a pilot.',
          'I have raised $250k from friends and family.',
          'I need firmware that runs for a season on a battery and reports over LoRa.',
          'I want sensors in the ground before next growing season, which is about five months away.',
        ],
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
        premises: [
          'I have built firmware for low-power environmental sensors for eight years.',
          'I have shipped two LoRaWAN products that run a year on a single battery.',
          'I contract on a day rate and can start a new project next month.',
          'I prefer projects where I also help design the hardware around the firmware.',
          'I am an hour from Napa and can visit field sites.',
        ],
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
        premises: [
          'I have a finished picture-book manuscript of about 800 words based on an Irish folk tale.',
          'I want to submit an illustrated sample package to publishers within four months.',
          'I can pay for sample illustrations upfront but not for a full book.',
          'I have published two short stories for adults but nothing for children yet.',
          'I live in Dublin and would like to meet in person occasionally.',
        ],
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
        premises: [
          'I have illustrated two picture books for an Irish publisher.',
          'I take on one or two sample-spread projects a year alongside my other work.',
          'I charge per spread for samples and negotiate a book fee separately if the project is picked up.',
          'I can turn around three sample spreads in about six weeks.',
          'I work from Galway and travel to Dublin monthly.',
        ],
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
        premises: [
          'I learned to cook from my grandmother and have cooked for family events for thirty years.',
          'I want to teach small classes of six to eight people on weekends.',
          'I do not have a kitchen suitable for teaching.',
          'I speak Spanish and basic English.',
          'I would like to start within two months.',
        ],
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
        premises: [
          'I run a community kitchen with a twelve-station teaching space in central Oaxaca.',
          'The kitchen is free on Saturday and Sunday mornings.',
          'We take a percentage of class fees instead of charging rent.',
          'I speak Spanish and English and often host visiting groups.',
          'I want more classes led by local home cooks rather than restaurant chefs.',
        ],
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
        premises: [
          'I coordinate a volunteer rooftop garden on a six-storey building in Crown Heights.',
          'The building board has approved two beehives in principle, pending a plan from an experienced beekeeper.',
          'We have a small budget from a community garden grant for hive equipment.',
          'About fifteen volunteers help in the garden; none has kept bees.',
          'The roof is accessible by stairs only.',
        ],
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
        premises: [
          'I have kept bees for nine years and currently manage hives on four rooftops in Queens and Brooklyn.',
          'I am registered as a beekeeper with the city.',
          'I can mentor a new rooftop site with monthly visits through the season.',
          'I ask sites to cover equipment and a small stipend for my time.',
          'I prefer sites with a committed group of volunteers rather than a single person.',
        ],
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
        premises: [
          'My daughter is sixteen and sits IGCSE mathematics next June.',
          'She is currently working at around a grade C and we want a B or better.',
          'We live in Kilimani and would prefer in-person sessions, though online is possible.',
          'We can do two sessions a week after school or on Saturday mornings.',
          'We have a monthly budget for tutoring that we have already set aside.',
        ],
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
        premises: [
          'I teach mathematics at a secondary school in Nairobi and have tutored IGCSE students for seven years.',
          'I have two tutoring slots free on weekday evenings and one on Saturday mornings.',
          'I tutor in person in Kilimani, Lavington, and Westlands, or online.',
          'I charge per session and offer a small discount for groups of two or three.',
          'Most of my students improve by at least one grade over a year.',
        ],
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
        premises: [
          'I founded the company a year ago; the CLI has about 8,000 GitHub stars and 1,200 weekly active users.',
          'We are three engineers and nobody has design experience.',
          'We are building a web dashboard and need a product designer who understands developers.',
          'I can offer a founding-team equity grant plus a salary below market.',
          'We raised a small pre-seed and have about fourteen months of runway.',
          'The team is in Berlin three days a week.',
        ],
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
        premises: [
          'I have designed developer-facing products for five years, including a CI dashboard and an API console.',
          'I want to join an early-stage team as the first designer rather than a large company.',
          'I am willing to take a lower salary for meaningful equity.',
          'I would relocate to Berlin or commute weekly.',
          'I can start in two months after finishing my current contract.',
        ],
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
        premises: [
          'I run a university esports society with about 200 members.',
          'Our Valorant team plays in a national university league with matches on Wednesday evenings.',
          'The team practices twice a week and has no coach.',
          'The society has a small budget and could pay a coach a modest monthly fee.',
          'The season starts in six weeks.',
        ],
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
        premises: [
          'I played Valorant semi-professionally for two years and reached Immortal rank.',
          'I retired from competing a year ago and now work in IT support.',
          'I can coach remotely on weekday evenings and review VODs on weekends.',
          'I have never coached a team formally but have mentored younger players.',
          'I would coach for a small fee or for free if the team is serious.',
        ],
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
        premises: [
          'I have a cooperative card game prototype for two to four players that plays in about 45 minutes.',
          'It has been through about 30 playtests with friends and needs blind playtesting with strangers.',
          'I plan to pitch it to publishers at a convention in five months.',
          'I can bring multiple prototype copies and run sessions myself.',
          'I am available most evenings.',
        ],
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
        premises: [
          'I own a board game cafe in Nørrebro with a library of about 600 games.',
          'We host a prototype playtest night on the first Tuesday of every month with 20 to 30 attendees.',
          'Designers get a table for free; we ask them to buy a drink.',
          'I have hosted playtests for four designers who went on to publish.',
          'I would like to add a second monthly playtest night if there is demand.',
        ],
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
        premises: [
          'I am a partner at a €25M fund that invests only in games and interactive entertainment.',
          'I write first cheques of €150k to €400k at pre-seed.',
          'I do not need a playable build; I need a team that has shipped something before and a clear narrative-design thesis.',
          'I invest across Europe and take most meetings in Berlin or on video.',
          'I want to meet founders months before they raise so the first conversation is not a pitch.',
        ],
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
        premises: [
          'I was COO of a mobile games studio for seven years before it was acquired.',
          'I angel invest $25k to $100k per company and have made nine investments.',
          'I only invest once there is a playable build and at least some retention data, however small.',
          'I usually decide within three weeks of a first meeting.',
          'I invest globally but prefer teams I can meet in Istanbul or somewhere in Europe.',
          'I like to stay hands-on with operations advice after investing.',
        ],
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
        premises: [
          'I am a principal at a £60M seed fund focused on AI-native content and creative tools.',
          'We lead seed rounds of £1M to £3M and want to own a meaningful stake.',
          'I expect a clear view of traction, how much is being raised, and what the round buys before a first partner meeting.',
          'I look at narrative engines, production pipelines, and tooling for studios rather than individual games.',
          'I run diligence over about six weeks.',
        ],
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
        premises: [
          'I co-founded the studio four months ago with a writer and an engineer; all three of us shipped a previous indie game together.',
          'We are building a detective game where suspects are LLM-driven characters with consistent memories.',
          'We have a design document and an internal dialogue prototype but no playable build yet.',
          'We plan to raise a pre-seed of around €500k in about six months.',
          'We are based in Stockholm and would consider relocating part of the team.',
        ],
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
        premises: [
          'Our studio of nine people has a playable LLM-powered interactive fiction game in closed beta.',
          'We have 3,000 beta players and day-30 retention of 18%.',
          'We are raising a $2M seed round and have about $600k in soft commitments.',
          'We want to close the round within four months.',
          'We are based in Seoul and open to investors anywhere.',
        ],
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
  // Deliberately one shared market: every profile, premise, and signal below
  // belongs to Launch. This makes a reset behave like a small but coherent
  // startup network rather than several disconnected topic islands.
  networks: ['launch'],
  people: [
    {
      name: 'Maya Chen', role: 'Technical Co-founder', location: 'New York, NY',
      bio: 'Technical co-founder of a developer-tools startup building observability software for AI agents.',
      skills: ['product engineering', 'AI infrastructure', 'developer tools'], interests: ['B2B SaaS', 'agent reliability', 'seed-stage startups'],
      premises: [
        'I co-founded a two-person developer-tools company building observability software for production AI agents.',
        'We have six design partners and are converting the first two to paid annual contracts.',
        'Our product runs in customer cloud environments, so enterprise security and reliability are important to us.',
        'We are preparing a $1.5m seed round to hire two engineers and turn design-partner usage into repeatable revenue.',
      ],
      intents: [
        'Looking for a seed investor who understands developer tools and enterprise AI infrastructure.',
        'Seeking a founding backend engineer with distributed systems experience to build reliable AI-agent observability.',
        'Looking to compare early enterprise design-partner contracts with other technical founders.',
      ],
    },
    {
      name: 'Daniel Ruiz', role: 'Founding Engineer', location: 'Brooklyn, NY',
      bio: 'Backend and infrastructure engineer who has built multi-tenant data platforms at two B2B SaaS startups.',
      skills: ['distributed systems', 'TypeScript', 'Postgres', 'cloud infrastructure'], interests: ['developer tools', 'early-stage teams', 'data systems'],
      premises: [
        'I have spent seven years building event pipelines, API platforms, and observability systems for B2B software companies.',
        'I left my last Series B company recently and am looking for a hands-on founding-engineer role rather than another large-company position.',
        'I can work from New York or remotely and care most about technical ownership, a clear customer problem, and a meaningful equity stake.',
        'I have worked with production LLM applications but want to join a company where the AI component solves an operational problem rather than being a feature demo.',
      ],
      intents: [
        'Looking for a founding-engineer role at a developer-tools or AI-infrastructure startup with real design partners.',
        'Open to advising technical founders on event pipelines, multi-tenant architecture, and early reliability trade-offs.',
      ],
    },
    {
      name: 'Aisha Okafor', role: 'Seed Investor', location: 'New York, NY',
      bio: 'Partner at an early-stage fund investing in developer tools, data infrastructure, and enterprise software.',
      skills: ['seed investing', 'enterprise GTM', 'fundraising'], interests: ['developer tools', 'AI infrastructure', 'B2B SaaS'],
      premises: [
        'I invest $500k to $1.5m checks at pre-seed and seed in companies selling technical products to enterprises.',
        'I have led investments in observability, data tooling, and security startups, and I spend time with founders before a formal process when the customer signal is credible.',
        'I look for founders who can explain a narrow initial buyer, a painful workflow, and what has changed after design-partner usage.',
        'I do not invest in consumer apps or companies whose only differentiation is access to a foundation model.',
      ],
      intents: [
        'Looking to meet technical founders raising pre-seed or seed rounds for developer tools, data infrastructure, or enterprise AI software.',
        'Seeking other investors and operators to share diligence on the AI-agent infrastructure market.',
      ],
    },
    {
      name: 'Sofia Martinez', role: 'SaaS Founder', location: 'Austin, TX',
      bio: 'Founder of a workflow-automation company for independent healthcare practices.',
      skills: ['customer discovery', 'healthcare operations', 'B2B product'], interests: ['vertical SaaS', 'enterprise sales', 'founder communities'],
      premises: [
        'I run a three-person company with fourteen paying healthcare-practice customers and a repeatable referral channel.',
        'We are profitable on services but need to make the software product more self-serve before we can scale sales.',
        'I am considering a small seed round but want an investor who will pressure-test the timing rather than push us to raise prematurely.',
        'I can offer candid customer-access and healthcare-workflow knowledge to founders building operational software.',
      ],
      intents: [
        'Seeking a seed investor experienced with vertical SaaS and healthcare operations software to discuss whether we are ready to raise.',
        'Looking for founders who have moved from services-assisted onboarding to a scalable B2B SaaS product motion.',
      ],
    },
    {
      name: 'Ethan Brooks', role: 'Product-Led Growth Advisor', location: 'San Francisco, CA',
      bio: 'Former product leader who now advises seed-stage B2B founders on activation, onboarding, and early go-to-market systems.',
      skills: ['product strategy', 'activation', 'B2B growth'], interests: ['developer tools', 'vertical SaaS', 'founder coaching'],
      premises: [
        'I led product at two B2B SaaS companies from seed through Series B and now take two advisory engagements per quarter.',
        'I help founders turn qualitative design-partner feedback into onboarding experiments and an initial customer-success motion.',
        'I work for a cash retainer with an optional small advisory-equity component; I do not replace a full-time growth leader.',
        'I am most useful once a company has active users and a specific activation or retention bottleneck to investigate.',
      ],
      intents: [
        'Open to advising seed-stage B2B SaaS and developer-tools founders who need to improve design-partner activation and onboarding.',
        'Looking to compare early enterprise GTM playbooks with founders and investors working in technical B2B markets.',
      ],
    },
  ],
};

function buildPersonas(scenarios: ScenarioDefinition[], emailPrefix: string): SandboxPersona[] {
  let personCounter = 0;
  return scenarios.flatMap((scenario) =>
    scenario.people.map((person) => {
      personCounter += 1;
      return {
        name: person.name,
        email: person.email ?? `${emailPrefix}-${String(personCounter).padStart(2, '0')}@index-network.test`,
        ...(person.fixedIds ? { fixedIds: person.fixedIds } : {}),
        networkKeys: scenario.networks,
        profile: {
          identity: { name: person.name, bio: `${person.role}. ${person.bio}`, location: person.location },
          narrative: { context: person.bio },
          attributes: { skills: person.skills, interests: person.interests },
        },
        premises: person.premises,
        intents: person.intents,
      };
    }),
  );
}

/** The full curated population. */
export const SANDBOX_PERSONAS: SandboxPersona[] = buildPersonas(SCENARIOS, 'sandbox-person');

/**
 * Five people in one shared startup network. Every intent belongs to Launch,
 * producing a connected founder / investor / technical-builder negotiation
 * pool rather than isolated category fixtures.
 */
export const SANDBOX_MINIMAL_PERSONAS: SandboxPersona[] = buildPersonas([MINIMAL_SCENARIO], 'sandbox-minimal');
