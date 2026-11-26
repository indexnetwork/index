#!/usr/bin/env bun
/**
 * One-off: ask the model again about every group that holds a single open
 * question, and merge the ones that ask the same fact as another group.
 * Groups made before the model saw their question (Home read it first) are
 * the ones this catches.
 *
 *   bun run maintenance:merge-question-groups -- --dry-run   # log merges, write nothing
 *   bun run maintenance:merge-question-groups                 # merge
 *   bun run maintenance:merge-question-groups -- --user <id>  # one person
 *
 * A real run appends every move to merge-question-groups.<time>.jsonl: the
 * question, the group it left (its whole row) and the group it joined, so
 * any merge can be split back by hand.
 */
import { appendFileSync } from 'node:fs';

import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(import.meta.dir, '../../../..', envFile) });

import { QuestionGroupsDatabaseAdapter } from '../adapters/question-groups.database.adapter';
import { closeDb } from '../lib/drizzle/drizzle';
import { mergeSoloGroups, type MergeStore } from '../lib/personal-agent/group-questions';
import type { GroupState } from '../lib/personal-agent/question-groups';
import { ConversationService, groupingDecide } from '../services/conversation.service';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const only = args.includes('--user') ? args[args.indexOf('--user') + 1] : undefined;

/** The real store for reads; each merge is printed, never written. */
function dryStore(userId: string): MergeStore {
  const store = QuestionGroupsDatabaseAdapter;
  const texts = new Map<string, string>();
  return {
    listOpenQuestions: async (owner) => {
      const open = await store.listOpenQuestions(owner);
      for (const question of open) texts.set(question.questionId, question.text);
      return open;
    },
    listGroups: async (owner, open) => {
      const groups = await store.listGroups(owner, open);
      for (const group of groups) texts.set(group.id, group.leadText ?? '');
      return groups;
    },
    groupedQuestionIds: (ids) => store.groupedQuestionIds(ids),
    createGroup: async () => { throw new Error('a merge never creates a group'); },
    addMember: async () => {},
    show: async (ids) => { if (ids.length) console.log(`  [${userId}] would show ${ids.length} held group(s)`); },
    moveMember: async (questionId, groupId) => {
      console.log(`  [${userId}] "${texts.get(questionId)}"\n      → joins "${texts.get(groupId)}"`);
    },
    deleteGroup: async () => {},
  };
}

/** The real store, with every move and deleted group written to `logPath` first. */
function loggedStore(logPath: string): MergeStore {
  const store = QuestionGroupsDatabaseAdapter;
  const groups = new Map<string, GroupState & { userId: string }>();
  const left = new Map<string, string>();
  return {
    listOpenQuestions: (owner) => store.listOpenQuestions(owner),
    listGroups: async (owner, open) => {
      const read = await store.listGroups(owner, open);
      for (const group of read) {
        groups.set(group.id, { ...group, userId: owner });
        for (const member of group.members) left.set(member.questionId, group.id);
      }
      return read;
    },
    groupedQuestionIds: (ids) => store.groupedQuestionIds(ids),
    createGroup: async () => { throw new Error('a merge never creates a group'); },
    addMember: (groupId, question) => store.addMember(groupId, question),
    show: (ids, at) => store.show(ids, at),
    moveMember: async (questionId, groupId) => {
      const from = groups.get(left.get(questionId) ?? '');
      appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), questionId, from, to: groupId }) + '\n');
      await store.moveMember(questionId, groupId);
    },
    deleteGroup: (groupId) => store.deleteGroup(groupId),
  };
}

async function main() {
  const decide = groupingDecide();
  if (!decide) throw new Error('OPENROUTER_API_KEY is not set: merging needs the decision model.');
  const conversations = new ConversationService();
  const logPath = path.resolve(process.cwd(), `merge-question-groups.${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const users = only ? [only] : await QuestionGroupsDatabaseAdapter.usersWithOpenGroups();
  console.log(`[merge-question-groups] ${users.length} people${dryRun ? ' (dry run)' : ''}`);
  let total = 0;
  for (const userId of users) {
    try {
      const moved = dryRun
        ? await mergeSoloGroups(userId, { store: dryStore(userId), decide, answer: async () => {} })
        : await mergeSoloGroups(userId, {
          store: loggedStore(logPath),
          decide,
          answer: (question, text) => conversations.answerAsOwner(userId, question, text),
        });
      if (moved) console.log(`[merge-question-groups] ${userId}: ${moved} merged`);
      total += moved;
    } catch (error) {
      console.error(`[merge-question-groups] ${userId} failed:`, error instanceof Error ? error.message : error);
    }
  }
  console.log(`[merge-question-groups] done: ${total} question(s) ${dryRun ? 'would move' : 'moved'}.${!dryRun && total ? ` Log: ${logPath}` : ''}`);
  await closeDb();
  process.exit(0);
}

main().catch((error) => {
  console.error('[merge-question-groups] Fatal error:', error);
  process.exit(1);
});
