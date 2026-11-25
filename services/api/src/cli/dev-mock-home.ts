#!/usr/bin/env bun
/**
 * Dev only: fill one account's Home with realistic mock data, written straight
 * to the database: people with profiles and intents, matches waiting on the
 * owner (pending), matches the agents are still talking about (negotiating),
 * and open questions from the owner's agent.
 *
 *   bun --env-file=../../.env.development src/cli/dev-mock-home.ts <owner-email>
 *   bun --env-file=../../.env.development src/cli/dev-mock-home.ts <owner-email> --reset
 *   bun --env-file=../../.env.development src/cli/dev-mock-home.ts <owner-email> --remove
 *
 * A plain run adds whoever in the list is not in the database yet and leaves the
 * rest alone; `--reset` removes everything and writes it again.
 *
 * Everything it writes is tagged (mock people have `@mock.index.invalid`
 * emails; opportunities and questions carry `mock: 'dev-mock-home'`), so
 * `--remove` takes exactly it back out. The mock people's intents are paused
 * and carry no embedding, so discovery never matches them with anyone else.
 */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

import { pairKeyOf } from '@indexnetwork/protocol';

const TAG = 'dev-mock-home';
const MOCK_DOMAIN = 'mock.index.invalid';
const HOUR = 3_600_000;

interface Person {
  slug: string;
  name: string;
  location: string;
  intro: string;
  intent: string;
  /** Hours ago the agents opened the conversation. */
  openedHoursAgo: number;
  /** Who opened it: the owner's agent or theirs. */
  openedBy: 'owner' | 'them';
  /** The agents' turns, alternating from whoever opened. The last one settles it unless `talking`. */
  turns: string[];
  /** Still negotiating: no agreement yet. */
  talking?: boolean;
}

const PEOPLE: Person[] = [
  {
    slug: 'elif-demir',
    name: 'Elif Demir',
    location: 'Istanbul, Türkiye',
    intro: 'Founder of Kolektif, a six person product studio in Kadıköy. We design wallets and dashboards for crypto teams in Europe. Before that, eight years in banking apps.',
    intent: 'I run a small product studio and want to meet senior product designers who work on crypto or agent products, to compare how we each explain what software is doing on a person\'s behalf.',
    openedHoursAgo: 5,
    openedBy: 'them',
    turns: [
      'Elif runs a product studio in Istanbul that designs wallets and dashboards for crypto teams. She wants to compare notes with designers who work on products that act on a person\'s behalf. Seren designs for a network of personal agents and is travelling to meet people in web3 and product design. I think they would get a lot from an hour together.',
      'That is close to what Seren is looking for. Is Elif expecting a working session or a conversation? Seren is travelling to meet people, not to take on client work.',
      'A conversation. Elif is not looking to hire or to pitch. She would show two flows her studio is unsure about and would like to see how Seren approaches the same problem.',
      'Then I accept. Seren may pass through Istanbul; if not, they can do it on a call.',
    ],
  },
  {
    slug: 'chloe-bernard',
    name: 'Chloé Bernard',
    location: 'Paris, France',
    intro: 'Design lead at a staking provider. I organise the design side room at a yearly Ethereum community conference in Paris and keep a list of designers who are good on stage.',
    intent: 'I am putting together a small dinner in Paris in December for designers working in crypto, and I am looking for eight to ten people who are not the usual faces.',
    openedHoursAgo: 9,
    openedBy: 'them',
    turns: [
      'Chloé is hosting a dinner in Paris on 10 December for ten designers working in crypto and wants people from outside her usual circle. Seren is a product designer travelling in the next few weeks to meet people in web3 and product design. Chloé would like to offer Seren a seat.',
      'Seren would value that kind of room. The route is not fixed yet, so I cannot promise the date. Can Chloé hold the seat for a few days?',
      'She can hold it until 1 December. After that she will offer it to someone else.',
      'That is fair. I accept the introduction, and I will tell Seren about the 1 December deadline.',
    ],
  },
  {
    slug: 'hana-suzuki',
    name: 'Hana Suzuki',
    location: 'Tokyo, Japan',
    intro: 'Product designer at a stablecoin payments company in Tokyo. I write a newsletter in Japanese and English about designing money apps for people who do not care about crypto.',
    intent: 'I will be in Europe for three weeks in December and want to meet product designers working in web3 for interviews for my newsletter, and to make friends in the field.',
    openedHoursAgo: 14,
    openedBy: 'owner',
    turns: [
      'Seren is a product designer travelling over the next two to four weeks and wants to meet people in web3 and product design. Hana designs a stablecoin payments app in Tokyo and will be in Europe for three weeks in December, meeting designers for her newsletter. They are both on the road at the same time for the same reason, so I would like to introduce them.',
      'Hana is interested. She would like to interview Seren for the newsletter as part of it, about designing for personal agents. Would Seren be comfortable being quoted?',
      'Seren is open to an interview as long as she can read her quotes before they are published.',
      'Hana always sends quotes for approval. She accepts. She lands in Berlin on 2 December and goes on to Lisbon and London.',
    ],
  },
  {
    slug: 'rafael-costa',
    name: 'Rafael Costa',
    location: 'São Paulo, Brazil',
    intro: 'Head of product at a crypto exchange app with four million users in Brazil. I started as a designer and still review every onboarding change we ship.',
    intent: 'I am visiting Lisbon and Berlin in early December and want to meet experienced product designers to talk about onboarding for people new to crypto. Happy to share what we learned from our numbers.',
    openedHoursAgo: 19,
    openedBy: 'them',
    turns: [
      'Rafael leads product at a large Brazilian exchange app and is visiting Lisbon and Berlin in the first half of December. He wants to talk with experienced designers about onboarding people who are new to crypto, and he is willing to share real conversion data. Seren is a product designer travelling to meet people in web3 and product design. I propose they meet.',
      'Real numbers from four million users is a strong reason to meet. Is there anything Rafael is hoping for in return?',
      'Only the conversation. He is curious how Seren thinks about showing people what an agent has done for them, because his team is about to add automated buying.',
      'I accept. That is a topic Seren works on every day.',
    ],
  },
  {
    slug: 'ingrid-solberg',
    name: 'Ingrid Solberg',
    location: 'Oslo, Norway',
    intro: 'Independent design researcher. I study how people come to trust, or stop trusting, software that acts for them. Previously research lead at a Nordic bank.',
    intent: 'I am running a research study on trust in AI agents that act for people and I am looking for product designers building such products who would do a 45 minute interview. I share the findings with everyone who takes part.',
    openedHoursAgo: 34,
    openedBy: 'owner',
    turns: [
      'Seren designs a product where personal agents negotiate introductions for people, and wants to meet people in product design while travelling. Ingrid is an independent researcher in Oslo studying how people come to trust software that acts for them, and she is interviewing designers who build it. Seren would learn from her findings and Ingrid would get a designer who lives with the problem.',
      'Ingrid would like to include Seren in the study. The interview is 45 minutes and recorded for her notes only. Is a recorded call acceptable?',
      'Yes, provided the recording is not shared and Seren gets the findings afterwards.',
      'Both are how Ingrid runs the study. She accepts and can do the interview by call or in person in Oslo or Copenhagen.',
    ],
  },
  {
    slug: 'kwame-mensah',
    name: 'Kwame Mensah',
    location: 'Accra, Ghana',
    intro: 'Co-founder and designer of Sika, a savings app built on stablecoins for traders in Ghana and Côte d\'Ivoire. In London for part of each quarter.',
    intent: 'I will be in London from 7 to 18 December and want to meet product designers who have worked on crypto products for people outside the usual tech audience.',
    openedHoursAgo: 47,
    openedBy: 'them',
    turns: [
      'Kwame designs a stablecoin savings app for market traders in Ghana and will be in London from 7 to 18 December. He wants to meet product designers who think about crypto for people outside the tech audience. Seren is a product designer travelling in the next few weeks to meet people in web3 and product design.',
      'Seren would be glad to meet Kwame. London is one of the cities Seren is considering, though it is not confirmed. Would a call work if the dates do not line up?',
      'Yes, although Kwame would prefer in person, since he wants to show the app on the phones his users have.',
      'Understood. I accept, and I will pass on that in person is preferred.',
    ],
  },
  {
    slug: 'lena-fischer',
    name: 'Lena Fischer',
    location: 'Berlin, Germany',
    intro: 'Design lead at a self-custody wallet startup. I run Design in Web3, a monthly meetup in Kreuzberg for people designing crypto products, around 60 people each time.',
    intent: 'I host a monthly meetup in Berlin for designers working on web3 products, and I want to meet product designers passing through the city who would give a ten minute talk or just come along.',
    openedHoursAgo: 30,
    openedBy: 'them',
    turns: [
      'Lena runs a monthly meetup in Berlin for designers working on crypto products, and the next one is on 3 December. Seren is a product designer travelling over the next few weeks and wants to meet people in web3 and product design. If Berlin is on the route, Lena would like to invite Seren to come, and to give a short talk if that appeals.',
      'That fits what Seren is looking for: meeting designers in web3 while travelling. Seren has not fixed the route yet, so I can agree to the introduction but not to the date. Is the invitation still useful if Seren can only make coffee that week and not the meetup itself?',
      'Yes. Lena is happy to meet one to one and introduce Seren to a few of the regulars either way. The meetup is a bonus.',
      'Then I accept. I will leave the timing for the two of them to settle.',
    ],
  },
  {
    slug: 'mateo-alvarez',
    name: 'Mateo Álvarez',
    location: 'Lisbon, Portugal',
    intro: 'Co-founder of Tally Club, an onchain loyalty app for independent cafés and shops. Ex-product at a payments company. Based in Lisbon and around the web3 scene here most weeks.',
    intent: 'We are redesigning onboarding for a consumer crypto app and I want honest feedback from experienced product designers. In return I can introduce people to founders and designers in Lisbon.',
    openedHoursAgo: 22,
    openedBy: 'owner',
    turns: [
      'Seren is a product designer travelling in the next two to four weeks and wants to meet people in web3 and product design. Mateo is rebuilding onboarding for a consumer crypto app in Lisbon and asked for feedback from experienced designers. I would like to propose they meet: Seren gets a way into the Lisbon scene, Mateo gets a designer\'s eyes on the flow.',
      'Mateo would welcome that. One thing to check: he is looking for a real critique session, about an hour with the prototype, not only a social coffee. Is Seren open to that?',
      'Seren is travelling to meet people, not to take on work, but an hour looking at a prototype in exchange for introductions is a fair trade and the kind of conversation Seren enjoys. I can agree to that.',
      'Good. Mateo accepts, and he will bring the prototype and a list of people worth meeting in Lisbon.',
    ],
  },
  {
    slug: 'priya-raman',
    name: 'Priya Raman',
    location: 'London, United Kingdom',
    intro: 'Staff product designer at a fintech, previously design systems at a bank. I write about design systems and run a small monthly critique circle for senior designers in London.',
    intent: 'I run a critique circle for senior product designers in London and I am looking for two or three new people who design complex products and would bring real work to review.',
    openedHoursAgo: 15,
    openedBy: 'them',
    turns: [
      'Priya runs a small critique circle for senior product designers in London and has room for a guest at the session on 9 December. Seren is a product designer who will be travelling then and wants to meet people in product design. Priya would like to invite Seren as a guest, with the option of bringing something to review.',
      'Seren would value that. A room of senior designers is a better way to meet people than a large event. I accept on Seren\'s behalf, with the date depending on whether London is on the route.',
    ],
  },
  {
    slug: 'jonas-lindqvist',
    name: 'Jonas Lindqvist',
    location: 'Stockholm, Sweden',
    intro: 'Designer at a governance tooling company for DAOs. I think a lot about how people delegate decisions to software, and lately to agents. Speaking at a conference in Lisbon in December.',
    intent: 'I am designing interfaces where people hand decisions to agents, and I want to compare notes with other designers working on agent or protocol UX. I will be in Lisbon from 4 to 8 December.',
    openedHoursAgo: 9,
    openedBy: 'owner',
    turns: [
      'Seren designs product for a network where personal agents negotiate introductions, and is travelling over the next few weeks to meet people in web3 and product design. Jonas designs delegation interfaces for DAOs and will be in Lisbon from 4 to 8 December. They are working on the same question from two sides: how much a person should see of what their agent does. I propose they meet.',
      'Jonas is interested for exactly that reason. He would prefer a longer conversation over a quick hello, ideally a walk or a lunch during the conference. Would Seren be in Lisbon in that window?',
      'Seren has not confirmed dates, so I cannot promise Lisbon. If the dates miss, would a call still be worth it to Jonas?',
      'Yes, a call works as a fallback. Jonas accepts.',
    ],
  },
  {
    slug: 'amara-okafor',
    name: 'Amara Okafor',
    location: 'Lagos, Nigeria',
    intro: 'Founder of Studio Ìmọ̀, a design collective building products for African crypto startups. Splitting time between Lagos and London. Curating the design track at a web3 conference in February.',
    intent: 'I am putting together the design track for a web3 conference in February and I want to meet product designers with a point of view on agents and onboarding who could join a panel.',
    openedHoursAgo: 6,
    openedBy: 'them',
    turns: [
      'Amara is curating the design track for a web3 conference in February and is looking for product designers with a clear view on agents and onboarding. Seren designs for a network of personal agents and wants to meet people in web3 and product design. Amara would like to talk with Seren about joining a panel, and will be in London for the first two weeks of December.',
      'Seren is looking to meet people in this space, and a panel invitation is a good reason for a conversation. I accept the introduction. Whether Seren joins the panel is for Seren to decide after they talk.',
    ],
  },
  {
    slug: 'sofia-marchetti',
    name: 'Sofia Marchetti',
    location: 'Milan, Italy',
    intro: 'Design researcher at a hardware wallet company. I spend most of my time watching people set up a wallet for the first time and writing down where they give up.',
    intent: 'I have a year of research on how first-time users fail at wallet setup, and I want to trade notes with product designers who have run onboarding research of their own.',
    openedHoursAgo: 3,
    openedBy: 'owner',
    turns: [
      'Seren is a product designer who works on onboarding and wants to meet people in web3 and product design while travelling. Sofia has a year of research on where first-time users give up during wallet setup and wants to trade notes with designers who have done onboarding research. I propose an introduction so they can compare what they have each seen.',
      'Sofia would like that. She can share her findings deck if Seren is willing to walk through how they approach onboarding and what has worked.',
      'Seren is happy to walk through it. Agreed.',
    ],
  },
  {
    slug: 'daniel-cho',
    name: 'Daniel Cho',
    location: 'Seoul, South Korea',
    intro: 'Product designer at a crypto exchange, working on the mobile trading experience. Organiser of a designers-in-crypto group chat with about 400 members across Asia.',
    intent: 'I organise a community of designers working in crypto across Asia and I want to connect with designers in Europe and the US to swap guest sessions between our groups.',
    openedHoursAgo: 2,
    openedBy: 'them',
    talking: true,
    turns: [
      'Daniel organises a community of about 400 designers working in crypto across Asia and wants to swap guest sessions with designers elsewhere. Seren is a product designer looking to meet people in web3 and product design. Daniel would like to invite Seren to do a remote guest session, since he is not travelling this quarter.',
      'Seren\'s stated goal is to meet people while travelling over the next few weeks, which reads as in person. I need to check whether a remote session is something Seren wants before I agree. I have asked.',
    ],
  },
  {
    slug: 'noor-haddad',
    name: 'Noor Haddad',
    location: 'Dubai, United Arab Emirates',
    intro: 'Head of design at a stablecoin payments startup. Previously led design for a remittance app used in eleven countries. Hiring designers and always curious how other teams work.',
    intent: 'I lead design at a payments startup and I want to meet senior product designers who have worked on agent or crypto products, to compare how our teams are set up and possibly to hire.',
    openedHoursAgo: 1,
    openedBy: 'owner',
    talking: true,
    turns: [
      'Seren is a product designer travelling in the next two to four weeks and wants to meet people in web3 and product design. Noor leads design at a stablecoin payments startup and wants to compare notes with senior designers on agent and crypto products. I propose they meet.',
      'Noor is interested, with one clarification. Part of her reason for these conversations is hiring. Is Seren open to a conversation that may turn to a role, or strictly peer networking?',
    ],
  },
];

interface Question {
  text: string;
  options: string[];
  hoursAgo: number;
  /** A question about one match: the person it concerns. Otherwise it is about the intent. */
  about?: string;
}

/** Links on each mock profile: [label, value]. Made up, so they may lead nowhere or to someone unrelated. */
const SOCIALS: Record<string, Array<[string, string]>> = {
  'elif-demir': [['twitter', 'elifdemir_ux'], ['linkedin', 'elif-demir-kolektif'], ['custom', 'kolektif.studio']],
  'chloe-bernard': [['twitter', 'chloebernard_d'], ['linkedin', 'chloe-bernard-design']],
  'hana-suzuki': [['twitter', 'hanasuzuki_pd'], ['custom', 'moneyfornormalpeople.news']],
  'rafael-costa': [['linkedin', 'rafael-costa-produto'], ['twitter', 'rafacosta_prod']],
  'ingrid-solberg': [['linkedin', 'ingrid-solberg-research'], ['custom', 'ingridsolberg.no']],
  'kwame-mensah': [['twitter', 'kwame_builds'], ['linkedin', 'kwame-mensah-sika'], ['custom', 'sika.app']],
  'lena-fischer': [['twitter', 'lenafischer_dsgn'], ['telegram', 'lenafischer'], ['custom', 'designinweb3.berlin']],
  'mateo-alvarez': [['twitter', 'mateoalvarez_pt'], ['github', 'mateo-alvarez'], ['custom', 'tallyclub.xyz']],
  'priya-raman': [['linkedin', 'priya-raman-design'], ['custom', 'priyaraman.design']],
  'jonas-lindqvist': [['twitter', 'jonaslindqvist'], ['github', 'jlindqvist']],
  'amara-okafor': [['twitter', 'amaraokafor_'], ['linkedin', 'amara-okafor-design']],
  'sofia-marchetti': [['linkedin', 'sofia-marchetti-research'], ['twitter', 'sofiamarchetti_r']],
  'daniel-cho': [['twitter', 'danielcho_design'], ['linkedin', 'daniel-cho-seoul']],
  'noor-haddad': [['linkedin', 'noor-haddad-product'], ['twitter', 'noorhaddad_']],
};

const QUESTIONS: Question[] = [
  {
    text: 'Which cities will you be in over the next two to four weeks? Several people I am talking to want to meet in person.',
    options: ['Berlin', 'Lisbon', 'London', 'Not decided yet'],
    hoursAgo: 8,
  },
  {
    text: 'Daniel Cho is not travelling this quarter and is offering a remote guest session with his designers community in Asia. Do you want remote conversations too, or only people you can meet in person?',
    options: ['Remote is fine too', 'In person only'],
    hoursAgo: 2,
    about: 'daniel-cho',
  },
  {
    text: 'Noor Haddad is hiring, and a conversation with her may turn to a role. Are you open to that, or do you want peer conversations only?',
    options: ['Open to hearing about roles', 'Peer conversations only'],
    hoursAgo: 1,
    about: 'noor-haddad',
  },
];

const [ownerEmail, flag] = process.argv.slice(2);
if (!ownerEmail || !process.env.DATABASE_URL) {
  console.error('usage: bun --env-file=../../.env.development src/cli/dev-mock-home.ts <owner-email> [--reset | --remove]');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run with NODE_ENV=production.');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

async function remove(tx: postgres.TransactionSql): Promise<void> {
  const questionIds = (await tx`SELECT id FROM messages WHERE metadata->>'mock' = ${TAG}`).map((row) => row.id as string);
  if (questionIds.length) {
    await tx`DELETE FROM question_groups WHERE id IN (SELECT group_id FROM question_group_members WHERE question_id IN ${tx(questionIds)})`;
    await tx`DELETE FROM messages WHERE id IN ${tx(questionIds)}`;
  }
  // Events, negotiations and their turns go with the opportunity.
  const opportunities = await tx`DELETE FROM opportunities WHERE metadata->>'mock' = ${TAG} RETURNING id`;
  const mock = tx`SELECT id FROM users WHERE email LIKE ${`%@${MOCK_DOMAIN}`}`;
  await tx`DELETE FROM intents WHERE user_id IN (${mock})`;
  await tx`DELETE FROM network_members WHERE user_id IN (${mock})`;
  // Chats the owner opened with mock people by accepting them.
  await tx`DELETE FROM conversations WHERE id IN (
    SELECT conversation_id FROM conversation_participants WHERE participant_id IN (${mock}))`;
  await tx`DELETE FROM networks WHERE metadata->>'mock' = ${TAG}`;
  const users = await tx`DELETE FROM users WHERE email LIKE ${`%@${MOCK_DOMAIN}`} RETURNING id`;
  console.log(`removed ${users.length} people, ${opportunities.length} matches, ${questionIds.length} questions.`);
}

try {
  await sql.begin(async (tx) => {
    const [owner] = await tx`SELECT id, name FROM users WHERE email = ${ownerEmail} AND deleted_at IS NULL`;
    if (!owner) throw new Error(`no account with email ${ownerEmail}.`);
    const ownerId = owner.id as string;

    // --remove takes everything out; --reset does that and writes it again. A plain
    // run only adds people who are not there yet, so matches the owner has already
    // accepted, and the chats opened with them, stay as they are.
    if (flag === '--remove' || flag === '--reset') await remove(tx);
    if (flag === '--remove') return;
    const existing = new Set((await tx`SELECT email FROM users WHERE email LIKE ${`%@${MOCK_DOMAIN}`}`).map((row) => row.email as string));
    const people = PEOPLE.filter((person) => !existing.has(`${person.slug}@${MOCK_DOMAIN}`));
    const firstRun = existing.size === 0;

    const [intent] = await tx`
      SELECT i.id, n.network_id FROM intents i JOIN intent_networks n ON n.intent_id = i.id
      WHERE i.user_id = ${ownerId} AND i.archived_at IS NULL AND i.status = 'active'
      ORDER BY i.created_at LIMIT 1`;
    if (!intent) throw new Error('the owner needs one active intent in a network first.');
    const ownerIntentId = intent.id as string;
    const networkId = intent.network_id as string;
    const [dm] = await tx`SELECT id FROM conversations WHERE dm_pair = ${`agent-dm:${ownerId}`}`;
    if (!dm) throw new Error('the owner has no agent conversation yet: open Home once, then run this again.');

    // The home list only shows a match when each person is still a member of the
    // network their seat is anchored on. Mock people get a network of their own,
    // so they never appear in a real network's member list.
    const [mockNetwork] = await tx`SELECT id FROM networks WHERE metadata->>'mock' = ${TAG}`;
    const mockNetworkId = (mockNetwork?.id as string | undefined) ?? randomUUID();
    if (!mockNetwork) await tx`INSERT INTO networks (id, title, metadata) VALUES (${mockNetworkId}, 'Mock people (dev)', ${tx.json({ mock: TAG })})`;

    const now = Date.now();
    const matchBySlug = new Map<string, { userId: string; name: string; opportunityId: string; negotiationId: string }>();

    for (const person of people) {
      const userId = randomUUID();
      const intentId = randomUUID();
      const opportunityId = randomUUID();
      const negotiationId = randomUUID();
      const joined = new Date(now - (person.openedHoursAgo + 24 * 40) * HOUR);
      const opened = new Date(now - person.openedHoursAgo * HOUR);
      const onboarding = { profileConfirmedAt: joined.toISOString(), completedAt: joined.toISOString(), currentStep: 'complete' };

      await tx`INSERT INTO users (id, email, email_verified, name, intro, location, onboarding, created_at, updated_at)
        VALUES (${userId}, ${`${person.slug}@${MOCK_DOMAIN}`}, true, ${person.name}, ${person.intro}, ${person.location}, ${tx.json(onboarding)}, ${joined}, ${joined})`;
      // Paused, discovered, no embedding: nobody else's agent ever finds it.
      await tx`INSERT INTO intents (id, payload, user_id, status, first_discovery_succeeded_at, created_at, updated_at)
        VALUES (${intentId}, ${person.intent}, ${userId}, 'paused', ${joined}, ${joined}, ${joined})`;
      await tx`INSERT INTO network_members (network_id, user_id, created_at, updated_at) VALUES (${mockNetworkId}, ${userId}, ${joined}, ${joined})`;

      const ownerSeat = { userId: ownerId, intentId: ownerIntentId, networkId };
      const theirSeat = { userId, intentId, networkId: mockNetworkId };
      const [initiator, responder] = person.openedBy === 'owner' ? [ownerSeat, theirSeat] : [theirSeat, ownerSeat];
      // Turns land a few minutes apart, as agents answer each other.
      const turnAt = (index: number) => new Date(opened.getTime() + (index + 1) * 4 * 60_000);
      const settled = person.talking ? null : turnAt(person.turns.length - 1);
      const lastSeat = person.turns.length % 2 === 1 ? initiator : responder;
      const awaiting = person.talking ? (lastSeat === initiator ? responder : initiator).userId : null;

      await tx`INSERT INTO opportunities (id, detection, actors, interpretation, context, confidence, status, created_at, updated_at, metadata)
        VALUES (${opportunityId},
          ${tx.json({ source: 'personal_agent', createdBy: initiator.userId, timestamp: opened.toISOString(), triggeredBy: initiator.intentId })},
          ${tx.json([
            { role: 'party', intent: initiator.intentId, userId: initiator.userId, networkId: initiator.networkId },
            { role: 'party', intent: responder.intentId, userId: responder.userId, networkId: responder.networkId },
          ])},
          ${tx.json({
            intents: [{ type: 'intent_match', detail: 'Match explainer', weight: 1 }],
            category: 'collaboration',
            reasoning: "Created by the owner's personal agent after an on-demand search, so it carries no compatibility score.",
            confidence: 1,
          })},
          ${tx.json({ networkId })}, 1, ${person.talking ? 'negotiating' : 'pending'}, ${opened}, ${settled ?? turnAt(person.turns.length - 1)},
          ${tx.json({ evidence: [], mock: TAG })})`;
      await tx`INSERT INTO opportunity_events (id, opportunity_id, type, at) VALUES (${randomUUID()}, ${opportunityId}, 'opened', ${opened})`;
      if (settled) await tx`INSERT INTO opportunity_events (id, opportunity_id, type, at) VALUES (${randomUUID()}, ${opportunityId}, 'agreed', ${settled})`;

      await tx`INSERT INTO negotiations (id, pair_key, opportunity_id, initiator_user_id, initiator_intent_id, responder_user_id, responder_intent_id, awaiting_user_id, outcome, settled_at, created_at, updated_at)
        VALUES (${negotiationId}, ${pairKeyOf(networkId, initiator.intentId, responder.intentId)}, ${opportunityId},
          ${initiator.userId}, ${initiator.intentId}, ${responder.userId}, ${responder.intentId},
          ${awaiting}, ${settled ? 'agreed' : null}, ${settled}, ${opened}, ${turnAt(person.turns.length - 1)})`;
      for (const [index, message] of person.turns.entries()) {
        const seat = index % 2 === 0 ? initiator : responder;
        const last = index === person.turns.length - 1;
        const action = index === 0 ? 'propose' : last && !person.talking ? 'accept' : 'counter';
        await tx`INSERT INTO negotiation_turns (id, negotiation_id, turn_index, seat_user_id, action, message, created_at)
          VALUES (${randomUUID()}, ${negotiationId}, ${index}, ${seat.userId}, ${action}, ${message}, ${turnAt(index)})`;
      }
      matchBySlug.set(person.slug, { userId, name: person.name, opportunityId, negotiationId });
    }

    // Questions are about the first set of people, so they are written once.
    for (const question of firstRun ? QUESTIONS : []) {
      const questionId = randomUUID();
      const match = question.about ? matchBySlug.get(question.about) : undefined;
      const metadata = {
        intentId: ownerIntentId,
        mock: TAG,
        principalMessage: {
          kind: 'question',
          scope: match ? 'match' : 'intent',
          stalls: match ? [match.negotiationId] : [],
          matches: match ? [{ counterparty: { id: match.userId, name: match.name }, opportunityId: match.opportunityId }] : [],
          options: question.options,
          questionId,
        },
      };
      await tx`INSERT INTO messages (id, conversation_id, sender_id, role, parts, metadata, created_at)
        VALUES (${questionId}, ${dm.id}, 'system-agent', 'agent', ${tx.json([{ kind: 'text', text: question.text }])}, ${tx.json(metadata)}, ${new Date(now - question.hoursAgo * HOUR)})`;
    }

    // Links are written on every run, so people added by an earlier run get them too.
    const mockUsers = await tx`SELECT id, email FROM users WHERE email LIKE ${`%@${MOCK_DOMAIN}`}`;
    for (const user of mockUsers) {
      const links = SOCIALS[(user.email as string).split('@')[0]] ?? [];
      await tx`DELETE FROM user_socials WHERE user_id = ${user.id}`;
      for (const [label, value] of links) {
        await tx`INSERT INTO user_socials (id, user_id, label, value) VALUES (${randomUUID()}, ${user.id}, ${label}, ${value})`;
      }
    }

    const pending = people.filter((person) => !person.talking).length;
    console.log(`added for ${owner.name}: ${people.length} people, ${pending} matches waiting, ${people.length - pending} still talking, ${firstRun ? QUESTIONS.length : 0} questions.`);
  });
} finally {
  await sql.end();
}
