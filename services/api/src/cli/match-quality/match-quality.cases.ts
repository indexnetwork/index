/**
 * The historical match-quality roster: documented pairs, each seen from just
 * before they were introduced, inside a small synthetic same-era community.
 *
 * Only `profile` and `signal` ever reach Index or the agent. Everything else
 * (titles, dates, sources, rationales) is for the human reading the report.
 * Members carry no names: the seed calls them "Member A", "Member B", ...
 *
 * Freezing: once every signal passed normal admission, the agent-visible
 * inputs and labels were fingerprinted into {@link FROZEN_FINGERPRINT}. A run
 * refuses fixtures that no longer match it. Never edit a frozen case because
 * of its score; a deliberate roster change re-runs admission and re-freezes.
 *
 * Admission history (2026-10-04): the first pass admitted 33 of 35. The
 * tennis-2012 positive and junior-club signals were refused as non-actionable
 * (they described an offer without asking for anyone), so both were reworded
 * as requests with the same facts and conflict. All 35 were then admitted and
 * the roster was frozen before any discovery run.
 *
 * Removed: Chávez→Huerta (1955 organizing). After Huerta's March 2026
 * allegation that Chávez raped her, the owner chose on 2026-10-04 to drop the
 * case rather than keep it as a positive.
 */
import { createHash } from 'node:crypto';

/** What a member is to the principal's request, fixed before any scoring. */
export type MemberRole = 'principal' | 'positive' | 'hard_negative' | 'easy_negative';

/** One member of a case's community. */
export interface CaseMember {
  /** Stable fixture key, unique within the case. */
  key: string;
  role: MemberRole;
  /** Confirmed profile facts, as the member's own agent would read them. */
  profile: { intro: string; location: string; timezone: string };
  /** The member's signal, submitted through normal admission. */
  signal: string;
  /** Human-only. Why this member is labelled as it is. */
  rationale: string;
  /** Hard negatives only: the words in `signal` that rule out the principal's request. */
  conflictClause?: string;
}

/** One documented introduction, reconstructed from before it happened. */
export interface MatchCase {
  id: string;
  /** Human-only: who, and the domain and year. */
  title: string;
  /** The last day before the introduction, ISO date. The wake runs on this date. */
  cutoff: string;
  /** Human-only: the earliest date the introduction could have happened, and the account. */
  introduction: { earliest: string; account: string };
  /** Human-only. */
  sources: { title: string; url: string; supports: string }[];
  /** Names and later achievements that must not appear in anything the agent sees. Case-sensitive whole words. */
  forbiddenTerms: string[];
  /** Words the principal's signal must not use, because they would ask for what only hindsight knew. */
  hindsightTerms: string[];
  members: CaseMember[];
}

/** Terms no case may expose: later achievements and identifying institutions. */
export const GLOBAL_FORBIDDEN_TERMS = [
  'Apple', 'Beatles', 'Quarrymen', 'Google', 'BackRub', 'PageRank', 'Nobel', 'COVID',
  'Moderna', 'BioNTech', 'Pfizer', 'Wimbledon', 'Roland', 'French Open', 'Grand Slam',
];

export const CASES: MatchCase[] = [
  {
    id: 'electronics-1971',
    title: 'Jobs → Wozniak (1971 electronics)',
    cutoff: '1970-12-01',
    introduction: {
      earliest: '1971-01-01',
      account: 'Bill Fernandez introduced the high-school student Jobs to his neighbour Wozniak in 1971 because both liked electronics and pranks.',
    },
    sources: [
      {
        title: 'Three Minutes With Steve Wozniak (ABC News / PC World, 2007)',
        url: 'https://abcnews.go.com/Technology/PCWorld/story?id=3396207',
        supports: 'Wozniak: "We first met in 1971 during my college years, while he was in high school ... he likes electronics, and he also plays pranks."',
      },
      {
        title: 'Steve Wozniak (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/Steve_Wozniak',
        supports: 'Re-enrolled at De Anza College before transferring to Berkeley in 1971; introduced to Jobs by Fernandez.',
      },
      {
        title: 'Bill Fernandez (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/Bill_Fernandez',
        supports: 'Fernandez introduced fellow Homestead High student Jobs to Wozniak; built the Cream Soda Computer with Wozniak in 1971.',
      },
    ],
    forbiddenTerms: ['Steve', 'Jobs', 'Wozniak', 'Woz', 'Fernandez', 'Homestead', 'Hewlett', 'Packard'],
    hindsightTerms: ['computer company', 'business partner', 'cofounder', 'co-founder'],
    members: [
      {
        key: 'principal',
        role: 'principal',
        profile: {
          intro: 'High-school student in Los Altos. Builds electronics kits and amplifiers, buys parts at surplus stores, and goes to an electronics company\'s after-school club for students.',
          location: 'Los Altos, California',
          timezone: 'America/Los_Angeles',
        },
        signal: 'I want to meet an older electronics hobbyist near Cupertino or Sunnyvale who designs their own digital circuits, so I can learn from them and build electronics projects together in person after school and on weekends.',
        rationale: 'Jobs at fifteen: a high-school electronics enthusiast looking for someone more skilled to build with.',
      },
      {
        key: 'positive',
        role: 'positive',
        profile: {
          intro: 'Engineering student at a community college in Cupertino. Designs computer logic on paper for fun, builds digital circuits and ham radio gear, and enjoys electronic pranks.',
          location: 'Sunnyvale, California',
          timezone: 'America/Los_Angeles',
        },
        signal: 'Looking for electronics enthusiasts around Sunnyvale and Cupertino, high-school age is fine, who want to design and build digital-logic gadgets together in a garage on weekends.',
        rationale: 'Wozniak before the introduction: an older student who designed digital logic and built projects with a younger neighbour. He became exactly the in-person build partner the principal asked for.',
      },
      {
        key: 'repair-only',
        role: 'hard_negative',
        profile: {
          intro: 'Retired radio engineer in Cupertino who repairs televisions and radios for a fee.',
          location: 'Cupertino, California',
          timezone: 'America/Los_Angeles',
        },
        signal: 'Offering paid television and radio repair in Cupertino; I only take repair work and do not teach students or join hobby projects.',
        conflictClause: 'do not teach students or join hobby projects',
        rationale: 'Local and skilled in electronics, but refuses the teaching and joint projects the principal wants.',
      },
      {
        key: 'hiring-senior',
        role: 'hard_negative',
        profile: {
          intro: 'Engineering manager at a semiconductor firm in Mountain View.',
          location: 'Mountain View, California',
          timezone: 'America/Los_Angeles',
        },
        signal: 'Hiring an experienced circuit designer with an engineering degree for a full-time role in Mountain View; students and hobbyists will not be considered.',
        conflictClause: 'students and hobbyists will not be considered',
        rationale: 'Digital circuit design nearby, but excludes students and wants an employee, not a collaborator.',
      },
      {
        key: 'mail-only',
        role: 'hard_negative',
        profile: {
          intro: 'Digital-logic hobbyist and computer operator in Boston.',
          location: 'Boston, Massachusetts',
          timezone: 'America/New_York',
        },
        signal: 'Seeking fellow digital-logic hobbyists to trade circuit schematics by mail; I live in Boston and cannot meet in person.',
        conflictClause: 'I live in Boston and cannot meet in person',
        rationale: 'The same hobby, but cannot build together in person near Cupertino.',
      },
      {
        key: 'bakery',
        role: 'easy_negative',
        profile: {
          intro: 'Owns a bakery in Mountain View.',
          location: 'Mountain View, California',
          timezone: 'America/Los_Angeles',
        },
        signal: 'Looking for an early-morning delivery driver with a van for weekday bread routes in Mountain View starting this spring.',
        rationale: 'Unrelated: bread delivery.',
      },
      {
        key: 'folk-duo',
        role: 'easy_negative',
        profile: {
          intro: 'Folk guitarist who plays coffeehouses in Palo Alto.',
          location: 'Palo Alto, California',
          timezone: 'America/Los_Angeles',
        },
        signal: 'Looking for a singer to perform Saturday-night folk sets with me at Palo Alto coffeehouses this season.',
        rationale: 'Unrelated: folk music.',
      },
    ],
  },
  {
    id: 'skiffle-1957',
    title: 'Lennon → McCartney (1957 music)',
    cutoff: '1957-07-05',
    introduction: {
      earliest: '1957-07-06',
      account: 'Ivan Vaughan introduced McCartney to Lennon at the St Peter\'s Church fête in Woolton on 6 July 1957, after Lennon\'s skiffle group played.',
    },
    sources: [
      {
        title: '6 July 1957: John Lennon meets Paul McCartney (The Beatles Bible)',
        url: 'https://www.beatlesbible.com/1957/07/06/john-lennon-meets-paul-mccartney/',
        supports: 'Date and place of the introduction; McCartney tuned a guitar and played "Twenty Flight Rock" with the words.',
      },
      {
        title: 'When Paul McCartney met John Lennon (National Museums Liverpool)',
        url: 'https://www.liverpoolmuseums.org.uk/stories/when-paul-mccartney-met-john-lennon',
        supports: 'The Woolton fête meeting and the skiffle group Lennon led.',
      },
      {
        title: 'Paul McCartney (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/Paul_McCartney',
        supports: 'McCartney\'s left-handed guitar playing and age at the meeting.',
      },
    ],
    forbiddenTerms: ['John', 'Lennon', 'Paul', 'McCartney', 'Ivan', 'Vaughan', 'Julia', 'Peter\'s'],
    hindsightTerms: ['songwriting partner', 'record deal', 'famous'],
    members: [
      {
        key: 'principal',
        role: 'principal',
        profile: {
          intro: 'Sixteen-year-old grammar-school pupil in Woolton, Liverpool. Sings and plays rhythm guitar with banjo chords, and leads a schoolfriends\' skiffle group that plays parties and church fêtes.',
          location: 'Woolton, Liverpool, England',
          timezone: 'Europe/London',
        },
        signal: 'Looking for a teenage guitarist in south Liverpool who knows proper guitar chords and tuning and remembers the words to rock \'n\' roll songs, to join my skiffle group for rehearsals and local fête and party bookings this summer.',
        rationale: 'Lennon before the fête: leading a skiffle group that lacked proper guitar chords, tuning and lyrics.',
      },
      {
        key: 'positive',
        role: 'positive',
        profile: {
          intro: 'Fifteen-year-old grammar-school pupil in Allerton, Liverpool. Plays guitar left-handed, knows standard tuning and plenty of chords, plays some piano, and knows many American rock \'n\' roll songs by heart.',
          location: 'Allerton, Liverpool, England',
          timezone: 'Europe/London',
        },
        signal: 'I want to join a skiffle or rock \'n\' roll group in south Liverpool as a guitarist and singer, rehearsing after school and playing local dances and parties.',
        rationale: 'McCartney before the fête: a local teenage guitarist who could tune, knew the chords and the words, and joined the group within weeks.',
      },
      {
        key: 'dance-band',
        role: 'hard_negative',
        profile: {
          intro: 'Professional dance-band guitarist in Liverpool who reads music.',
          location: 'Liverpool, England',
          timezone: 'Europe/London',
        },
        signal: 'Seeking a paid guitar seat in a Liverpool ballroom dance orchestra; I read sheet music and will not play with amateur skiffle groups.',
        conflictClause: 'will not play with amateur skiffle groups',
        rationale: 'A skilled local guitarist who refuses amateur skiffle groups.',
      },
      {
        key: 'london-only',
        role: 'hard_negative',
        profile: {
          intro: 'Skiffle guitarist who plays the coffee bars of Soho, London.',
          location: 'London, England',
          timezone: 'Europe/London',
        },
        signal: 'Looking for a washboard player to join my skiffle act in Soho coffee bars; I perform only in London and cannot travel to Liverpool.',
        conflictClause: 'I perform only in London and cannot travel to Liverpool',
        rationale: 'Skiffle, but cannot rehearse or play in Liverpool.',
      },
      {
        key: 'lessons-only',
        role: 'hard_negative',
        profile: {
          intro: 'Classical guitar teacher in Liverpool.',
          location: 'Liverpool, England',
          timezone: 'Europe/London',
        },
        signal: 'Offering paid classical guitar lessons to adults in Liverpool city centre; I do not join bands or play rock \'n\' roll.',
        conflictClause: 'I do not join bands or play rock \'n\' roll',
        rationale: 'Local guitar expertise, but will not join a group or play its music.',
      },
      {
        key: 'football',
        role: 'easy_negative',
        profile: {
          intro: 'Secretary of an amateur football club in Liverpool.',
          location: 'Liverpool, England',
          timezone: 'Europe/London',
        },
        signal: 'Looking for a goalkeeper for our amateur football side\'s Saturday league matches in Liverpool this autumn.',
        rationale: 'Unrelated: football.',
      },
      {
        key: 'grocer',
        role: 'easy_negative',
        profile: {
          intro: 'Runs a grocer\'s shop in Woolton.',
          location: 'Woolton, Liverpool, England',
          timezone: 'Europe/London',
        },
        signal: 'Looking for a delivery boy with a bicycle for Saturday grocery rounds in Woolton.',
        rationale: 'Unrelated: grocery deliveries.',
      },
    ],
  },
  {
    id: 'web-research-1995',
    title: 'Page → Brin (1995 computing research)',
    cutoff: '1995-03-01',
    introduction: {
      earliest: '1995-03-15',
      account: 'Brin, a Stanford PhD student, was assigned to show the admitted student Page around campus in 1995 (History of Google: summer 1995). Admitted-student visits begin in spring, so the earliest date is set to mid-March.',
    },
    sources: [
      {
        title: 'Our story (Google)',
        url: 'https://about.google/our-story/',
        supports: '"The Google story begins in 1995 at Stanford University. Larry Page was considering Stanford for grad school and Sergey Brin, a student there, was assigned to show him around."',
      },
      {
        title: 'History of Google (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/History_of_Google',
        supports: 'They first met in summer 1995 when Brin volunteered to show potential new students around campus and San Francisco.',
      },
      {
        title: 'Sergey Brin\'s Stanford home page (InfoLab)',
        url: 'http://infolab.stanford.edu/~sergey/',
        supports: 'Brin\'s research on data mining and large document collections at Stanford.',
      },
    ],
    forbiddenTerms: ['Larry', 'Page', 'Sergey', 'Brin', 'Winograd', 'Ullman', 'MIDAS'],
    hindsightTerms: ['search engine', 'startup', 'link analysis', 'backlinks'],
    members: [
      {
        key: 'principal',
        role: 'principal',
        profile: {
          intro: 'Computer engineering graduate of a Midwestern university, admitted to a computer science PhD program in California. Interested in human-computer interaction, information retrieval and the World Wide Web.',
          location: 'Ann Arbor, Michigan',
          timezone: 'America/Detroit',
        },
        signal: 'I\'ve been admitted to Stanford\'s computer science PhD program and am visiting this spring; I\'d like a current Stanford CS PhD student to show me around and talk candidly about research groups working on the Web and large information systems.',
        rationale: 'Page in early 1995: an admitted student deciding on Stanford, interested in the Web.',
      },
      {
        key: 'positive',
        role: 'positive',
        profile: {
          intro: 'Second-year computer science PhD student at Stanford on a graduate fellowship, working on data mining and searching large text collections.',
          location: 'Stanford, California',
          timezone: 'America/Los_Angeles',
        },
        signal: 'Second-year Stanford CS PhD student volunteering to show admitted PhD students around campus and San Francisco during their visits, and happy to talk about data mining and database research groups.',
        rationale: 'Brin in 1995: the current student who volunteered to show admitted students around and worked on large text collections.',
      },
      {
        key: 'postdoc-only',
        role: 'hard_negative',
        profile: {
          intro: 'Database professor at Stanford.',
          location: 'Stanford, California',
          timezone: 'America/Los_Angeles',
        },
        signal: 'Recruiting a postdoctoral researcher with a completed PhD in query optimization for my Stanford database group; I am not meeting prospective or admitted students this spring.',
        conflictClause: 'I am not meeting prospective or admitted students this spring',
        rationale: 'Stanford database research, but explicitly not meeting admitted students.',
      },
      {
        key: 'mit-only',
        role: 'hard_negative',
        profile: {
          intro: 'Computer science PhD student at MIT working on information retrieval.',
          location: 'Cambridge, Massachusetts',
          timezone: 'America/New_York',
        },
        signal: 'Looking for information retrieval research collaborators in Cambridge, Massachusetts; I am not at Stanford and cannot host campus visits there.',
        conflictClause: 'I am not at Stanford and cannot host campus visits there',
        rationale: 'A PhD student in the right field, but not at Stanford.',
      },
      {
        key: 'recruiter',
        role: 'hard_negative',
        profile: {
          intro: 'Technical recruiter at a Silicon Valley software company.',
          location: 'Sunnyvale, California',
          timezone: 'America/Los_Angeles',
        },
        signal: 'Hiring web developers for full-time jobs in Sunnyvale starting immediately; not interested in academic research or anyone starting a PhD.',
        conflictClause: 'not interested in academic research or anyone starting a PhD',
        rationale: 'Web work nearby, but rules out academic research and incoming PhD students.',
      },
      {
        key: 'bike-shop',
        role: 'easy_negative',
        profile: {
          intro: 'Owns a bicycle shop in Palo Alto.',
          location: 'Palo Alto, California',
          timezone: 'America/Los_Angeles',
        },
        signal: 'Looking for a weekend mechanic to tune road bikes at my Palo Alto shop this spring.',
        rationale: 'Unrelated: bicycle repair.',
      },
      {
        key: 'choir',
        role: 'easy_negative',
        profile: {
          intro: 'Director of a community choir in Menlo Park.',
          location: 'Menlo Park, California',
          timezone: 'America/Los_Angeles',
        },
        signal: 'Looking for tenors to join our Menlo Park community choir for a summer concert.',
        rationale: 'Unrelated: choral singing.',
      },
    ],
  },
  {
    id: 'mrna-1997',
    title: 'Karikó → Weissman (late-1990s biomedical research)',
    cutoff: '1996-12-01',
    introduction: {
      earliest: '1997-01-01',
      account: 'Weissman joined Penn in 1997 to work on an HIV vaccine; he met Karikó at a shared photocopier, and she offered to make mRNA for his dendritic-cell work.',
    },
    sources: [
      {
        title: 'Press release: The Nobel Prize in Physiology or Medicine 2023 (NobelPrize.org)',
        url: 'https://www.nobelprize.org/prizes/medicine/2023/press-release/',
        supports: 'Karikó\'s in vitro transcribed mRNA work and her collaboration with the immunologist Weissman on dendritic cells.',
      },
      {
        title: 'Advanced information: The Nobel Prize in Physiology or Medicine 2023 (NobelPrize.org)',
        url: 'https://www.nobelprize.org/prizes/medicine/2023/advanced-information/',
        supports: 'Weissman joined the University of Pennsylvania in 1997 and teamed up with Karikó.',
      },
      {
        title: 'Katalin Karikó (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/Katalin_Karik%C3%B3',
        supports: 'Karikó\'s research-faculty position in neurosurgery, her 1995 demotion and her lack of grant funding.',
      },
    ],
    forbiddenTerms: ['Katalin', 'Kati', 'Karikó', 'Kariko', 'Drew', 'Weissman', 'Fauci', 'Penn'],
    hindsightTerms: ['pseudouridine', 'modified nucleoside', 'lipid nanoparticle', 'pandemic'],
    members: [
      {
        key: 'principal',
        role: 'principal',
        profile: {
          intro: 'Biochemist and research faculty member in a neurosurgery department at a Philadelphia medical school. Makes messenger RNA by in vitro transcription and studies using it to produce therapeutic proteins in cells; grant funding is scarce.',
          location: 'Philadelphia, Pennsylvania',
          timezone: 'America/New_York',
        },
        signal: 'I make in-vitro-transcribed messenger RNA and want an immunologist or physician-scientist at my Philadelphia medical school to collaborate on testing that mRNA in immune cells, ideally with funding for the shared experiments.',
        rationale: 'Karikó in 1996: an mRNA biochemist without funding, needing an immunology collaborator at her institution.',
      },
      {
        key: 'positive',
        role: 'positive',
        profile: {
          intro: 'Physician-scientist (MD, PhD) in infectious diseases finishing an HIV immunology fellowship at a federal research institute; studies dendritic cells and how they start immune responses.',
          location: 'Bethesda, Maryland (moving to Philadelphia)',
          timezone: 'America/New_York',
        },
        signal: 'Starting my own HIV vaccine lab at a Philadelphia medical school in the new year; looking for collaborators there with new ways to get vaccine antigens made inside dendritic cells.',
        rationale: 'Weissman before joining Penn: an immunologist starting a funded dendritic-cell vaccine lab who needed a way to express antigens in those cells, which in vitro transcribed mRNA provides.',
      },
      {
        key: 'peptide-only',
        role: 'hard_negative',
        profile: {
          intro: 'Immunologist in Philadelphia who studies dendritic cells.',
          location: 'Philadelphia, Pennsylvania',
          timezone: 'America/New_York',
        },
        signal: 'Seeking a peptide chemist in Philadelphia for a protein-subunit vaccine project with dendritic cells; our lab will not use RNA or DNA methods.',
        conflictClause: 'our lab will not use RNA or DNA methods',
        rationale: 'Dendritic-cell vaccine immunology in Philadelphia, but refuses RNA methods.',
      },
      {
        key: 'san-diego',
        role: 'hard_negative',
        profile: {
          intro: 'RNA biochemist in San Diego studying ribozyme structure.',
          location: 'San Diego, California',
          timezone: 'America/Los_Angeles',
        },
        signal: 'Looking for ribozyme structure collaborators in San Diego; I only work with local labs and cannot take on Philadelphia projects.',
        conflictClause: 'I only work with local labs and cannot take on Philadelphia projects',
        rationale: 'RNA biochemistry, but neither immunology nor Philadelphia.',
      },
      {
        key: 'trial-coordinator',
        role: 'hard_negative',
        profile: {
          intro: 'Clinical research coordinator at a Philadelphia hospital.',
          location: 'Philadelphia, Pennsylvania',
          timezone: 'America/New_York',
        },
        signal: 'Recruiting adult volunteers in Philadelphia for an approved hepatitis B vaccine trial; I am not looking for laboratory research collaborators.',
        conflictClause: 'I am not looking for laboratory research collaborators',
        rationale: 'Vaccines in Philadelphia, but rules out laboratory collaboration.',
      },
      {
        key: 'restaurant',
        role: 'easy_negative',
        profile: {
          intro: 'Owns a restaurant in Philadelphia.',
          location: 'Philadelphia, Pennsylvania',
          timezone: 'America/New_York',
        },
        signal: 'Hiring a pastry chef for weekend brunch service at my Philadelphia restaurant.',
        rationale: 'Unrelated: restaurant hiring.',
      },
      {
        key: 'astronomy',
        role: 'easy_negative',
        profile: {
          intro: 'Amateur astronomer in Delaware County, Pennsylvania.',
          location: 'Media, Pennsylvania',
          timezone: 'America/New_York',
        },
        signal: 'Looking for company at monthly dark-sky observing nights in Delaware County, Pennsylvania.',
        rationale: 'Unrelated: amateur astronomy.',
      },
    ],
  },
  {
    id: 'tennis-2012',
    title: 'Williams → Mouratoglou (2012 tennis practice facilities and hitting partners)',
    cutoff: '2012-05-29',
    introduction: {
      earliest: '2012-05-30',
      account: 'After her first-round loss at Roland-Garros on 29 May 2012, Williams stayed at her Paris apartment and asked Mouratoglou whether she could train at his academy nearby. The coaching relationship came later; the request was for a place to practise.',
    },
    sources: [
      {
        title: 'One day, one epic match: Razzano - Williams, 1st round 2012 (Roland-Garros)',
        url: 'https://www.rolandgarros.com/en-us/article/rg-archives-epic-match-razzano-williams-2012-first-round',
        supports: '"She stayed at her apartment in Paris and approached French coach Patrick Mouratoglou to ask if she could train at his academy nearby."',
      },
      {
        title: 'Mouratoglou: The man behind Serena\'s latest surge (USA Today, 2013)',
        url: 'https://www.usatoday.com/story/sports/tennis/2013/09/02/us-open-2013-serena-williams-patrick-mouratoglou-partnership/2755659/',
        supports: '"She needed a place to practice and reached out to Mouratoglou."',
      },
      {
        title: 'Patrick Mouratoglou (Wikipedia)',
        url: 'https://en.wikipedia.org/wiki/Patrick_Mouratoglou',
        supports: 'His academy near Paris (founded 1996, moved to Biot in 2016) trained touring professionals; he coached Williams from 2012.',
      },
    ],
    forbiddenTerms: ['Serena', 'Williams', 'Venus', 'Patrick', 'Mouratoglou', 'Razzano'],
    hindsightTerms: ['coach', 'coaching', 'long-term'],
    members: [
      {
        key: 'principal',
        role: 'principal',
        profile: {
          intro: 'Professional tennis player on the women\'s tour, ranked in the top ten, with an apartment in Paris.',
          location: 'Paris, France',
          timezone: 'Europe/Paris',
        },
        signal: 'I\'m a touring tennis pro staying in Paris after an early loss at a clay-court event; I need a private practice court and strong hitting partners near Paris for daily sessions over the next two weeks before the grass season.',
        rationale: 'Williams on 29 May 2012: a short-notice practice request, not a search for a coach.',
      },
      {
        key: 'positive',
        role: 'positive',
        profile: {
          intro: 'Founder and head coach of a high-performance tennis academy outside Paris with indoor and outdoor courts; trains juniors and touring professionals.',
          location: 'Paris region, France',
          timezone: 'Europe/Paris',
        },
        signal: 'Looking for touring professionals who want private courts and high-level hitting partners at my tennis academy outside Paris for short training blocks between tournaments, available at short notice.',
        rationale: 'Mouratoglou\'s academy near Paris: where Williams asked to train, with courts and players to practise with.',
      },
      {
        key: 'junior-club',
        role: 'hard_negative',
        profile: {
          intro: 'Membership secretary at a tennis club in Paris.',
          location: 'Paris, France',
          timezone: 'Europe/Paris',
        },
        signal: 'Looking for junior players aged 8 to 16 to join our Paris tennis club for the September season; we do not rent courts to visitors or host professional players.',
        conflictClause: 'we do not rent courts to visitors or host professional players',
        rationale: 'Tennis courts in Paris, but closed to visiting professionals.',
      },
      {
        key: 'florida-hitter',
        role: 'hard_negative',
        profile: {
          intro: 'Former college player who works as a hitting partner for touring professionals, based in Miami.',
          location: 'Miami, Florida',
          timezone: 'America/New_York',
        },
        signal: 'Available as a hitting partner for touring pros in Miami throughout June; I am not travelling to Europe this summer.',
        conflictClause: 'I am not travelling to Europe this summer',
        rationale: 'The right service, but not in Paris during those two weeks.',
      },
      {
        key: 'long-term-coach',
        role: 'hard_negative',
        profile: {
          intro: 'Tennis coach near Paris with experience on the women\'s tour.',
          location: 'Paris region, France',
          timezone: 'Europe/Paris',
        },
        signal: 'Seeking a full-time, multi-year coaching contract with a touring professional; I am not available for short-term court bookings or hitting sessions.',
        conflictClause: 'I am not available for short-term court bookings or hitting sessions',
        rationale: 'The hindsight match: a long-term coach near Paris, which the request did not ask for, and who rules out short-term practice.',
      },
      {
        key: 'bakery',
        role: 'easy_negative',
        profile: {
          intro: 'Owns a bakery in Paris.',
          location: 'Paris, France',
          timezone: 'Europe/Paris',
        },
        signal: 'Hiring a weekend delivery cyclist for my Paris bakery during June.',
        rationale: 'Unrelated: bakery deliveries.',
      },
      {
        key: 'restorer',
        role: 'easy_negative',
        profile: {
          intro: 'Antique furniture restorer in Versailles.',
          location: 'Versailles, France',
          timezone: 'Europe/Paris',
        },
        signal: 'Looking for a workshop assistant to help restore antique furniture in Versailles.',
        rationale: 'Unrelated: furniture restoration.',
      },
    ],
  },
];

/**
 * The fingerprint of everything that was frozen after admission passed: each
 * case's id, cutoff, and every member's key, role, profile and signal.
 * Human-only notes are left out so a source can be corrected without a re-freeze.
 */
export const FROZEN_FINGERPRINT = '2d9f3594cb4bfbe8adcbce5316a72898c8096bc467e57957d9e5b576858b3316';

/** @returns The SHA-256 of the agent-visible inputs and labels of `cases`. */
export function fixtureFingerprint(cases: MatchCase[] = CASES): string {
  const frozen = cases.map((matchCase) => ({
    id: matchCase.id,
    cutoff: matchCase.cutoff,
    members: matchCase.members.map(({ key, role, profile, signal }) => ({ key, role, profile, signal })),
  }));
  return createHash('sha256').update(JSON.stringify(frozen)).digest('hex');
}

/** @returns The display name the seed gives the member at `index`: "Member A", "Member B", ... */
export function memberName(index: number): string {
  return `Member ${String.fromCharCode(65 + index)}`;
}
