/**
 * TEMP debugging helper: seed demo pending questions for an intent so the
 * intent detail page (/i/:intentId) has something to render. Not for commit.
 */
import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'node:path';

// Runtime env files live at the repo root (see root .env.example).
dotenv.config({ path: path.resolve(import.meta.dir, '../../..', '.env.development') });

const INTENT_ID = '73bc09da-0bc1-4326-bd69-e83f20ecfbdf';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set');

const sql = postgres(DATABASE_URL);

const [intent] = await sql`
  SELECT id, user_id, summary, payload FROM intents WHERE id = ${INTENT_ID} LIMIT 1
`;

if (!intent) {
  console.error(`Intent ${INTENT_ID} not found`);
  await sql.end();
  process.exit(1);
}

const userId = intent.user_id as string;
console.log(`Intent found. owner userId=${userId}`);
console.log(`summary=${intent.summary ?? intent.payload}`);

const now = new Date().toISOString();

const demoQuestions = [
  {
    title: 'What stage are you looking for?',
    prompt: 'To sharpen this signal, which stage of collaborators are most relevant right now?',
    options: [
      { label: 'Early / pre-seed', description: 'Founders still shaping the idea.' },
      { label: 'Growth', description: 'Teams with traction scaling up.' },
      { label: 'Established', description: 'Mature orgs with a track record.' },
    ],
    multiSelect: false,
  },
  {
    title: 'Which regions matter?',
    prompt: 'Should the network weight any geographies more heavily for this intent?',
    options: [
      { label: 'North America', description: 'US and Canada.' },
      { label: 'Europe', description: 'EU + UK.' },
      { label: 'Remote-first', description: 'Location-agnostic collaborators.' },
    ],
    multiSelect: true,
  },
  {
    title: 'How soon do you want to connect?',
    prompt: 'Urgency helps the agent decide how aggressively to surface overlaps.',
    options: [
      { label: 'This week', description: 'Actively looking now.' },
      { label: 'This month', description: 'Warming up, no rush.' },
      { label: 'Just exploring', description: 'Open-ended, keep an eye out.' },
    ],
    multiSelect: false,
  },
];

const rows = demoQuestions.map((payload, i) => ({
  detection: {
    mode: 'intent',
    sourceType: 'intent',
    sourceId: INTENT_ID,
    triggeredBy: INTENT_ID,
    timestamp: now,
    strategy: 'demo-seed',
  },
  actors: [{ userId, role: 'subject' }],
  payload,
  status: 'pending',
  // No expiry so they linger while debugging.
  expiresAt: null,
  conversationId: null,
}));

for (const r of rows) {
  const [inserted] = await sql`
    INSERT INTO questions (id, detection, actors, payload, status, expires_at, conversation_id)
    VALUES (
      ${crypto.randomUUID()},
      ${sql.json(r.detection)},
      ${sql.json(r.actors)},
      ${sql.json(r.payload)},
      ${r.status},
      ${r.expiresAt},
      ${r.conversationId}
    )
    RETURNING id
  `;
  console.log(`Inserted question ${inserted.id} — "${r.payload.title}"`);
}

await sql.end();
console.log('Done. Reload the intent page.');
