import db from '../lib/drizzle/drizzle';

import { QuestionerAdapter } from './questioner.adapter';

/** Shared production adapter; services and queues inject substitutes in tests. */
export const questionerAdapter = new QuestionerAdapter(db);
