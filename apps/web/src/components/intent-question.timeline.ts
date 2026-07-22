import type { AnsweredThreadEntry } from "@/components/InjectedQuestions/AnsweredQuestionLog";
import type { PendingQuestion } from "@/services/questions";

interface IntentTimelineMessage {
  id: string;
  role: "user" | "assistant";
  timestamp: Date;
}

export type IntentQuestionTimelineItem<TMessage extends IntentTimelineMessage> =
  | { type: "message"; message: TMessage }
  | { type: "answered"; entry: AnsweredThreadEntry };

export interface IntentQuestionTimeline<TMessage extends IntentTimelineMessage> {
  items: Array<IntentQuestionTimelineItem<TMessage>>;
  answeredByMessageId: Map<string, AnsweredThreadEntry[]>;
  pendingByMessageId: Map<string, PendingQuestion[]>;
  trailingPending: PendingQuestion[];
}

function timestampMs(value: Date | string | undefined): number | null {
  if (!value) return null;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function answeredTimestamp(entry: AnsweredThreadEntry): number | null {
  return timestampMs(entry.answeredAt)
    ?? timestampMs(entry.detectedAt)
    ?? timestampMs(entry.createdAt);
}

function pendingTimestamp(question: PendingQuestion): number | null {
  return timestampMs(question.detection?.timestamp) ?? timestampMs(question.createdAt);
}

function compareTimestamped<T>(
  left: T,
  right: T,
  getTimestamp: (value: T) => number | null,
  getId: (value: T) => string,
): number {
  const leftTimestamp = getTimestamp(left);
  const rightTimestamp = getTimestamp(right);
  if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }
  if (leftTimestamp === null && rightTimestamp !== null) return 1;
  if (leftTimestamp !== null && rightTimestamp === null) return -1;
  return getId(left).localeCompare(getId(right));
}

/**
 * Builds the intent-page Personal Agent timeline without mutating question data.
 * Exact assistant-message anchors win. Unanchored answered exchanges use their
 * authoritative timestamps, while pending questions stay at the current end.
 */
export function buildIntentQuestionTimeline<TMessage extends IntentTimelineMessage>(
  messages: TMessage[],
  pending: PendingQuestion[],
  answered: AnsweredThreadEntry[],
): IntentQuestionTimeline<TMessage> {
  const assistantMessageIds = new Set(
    messages.filter((message) => message.role === "assistant").map((message) => message.id),
  );
  const answeredByMessageId = new Map<string, AnsweredThreadEntry[]>();
  const pendingByMessageId = new Map<string, PendingQuestion[]>();
  const unanchoredAnswered: AnsweredThreadEntry[] = [];
  const trailingPending: PendingQuestion[] = [];

  for (const entry of answered) {
    if (entry.messageId && assistantMessageIds.has(entry.messageId)) {
      answeredByMessageId.set(entry.messageId, [
        ...(answeredByMessageId.get(entry.messageId) ?? []),
        entry,
      ]);
    } else {
      unanchoredAnswered.push(entry);
    }
  }

  for (const question of pending) {
    const messageId = question.detection?.messageId;
    if (messageId && assistantMessageIds.has(messageId)) {
      pendingByMessageId.set(messageId, [
        ...(pendingByMessageId.get(messageId) ?? []),
        question,
      ]);
    } else {
      trailingPending.push(question);
    }
  }

  for (const entries of answeredByMessageId.values()) {
    entries.sort((left, right) => compareTimestamped(left, right, answeredTimestamp, (entry) => entry.id));
  }
  for (const questions of pendingByMessageId.values()) {
    questions.sort((left, right) => compareTimestamped(left, right, pendingTimestamp, (question) => question.id));
  }
  trailingPending.sort((left, right) => compareTimestamped(left, right, pendingTimestamp, (question) => question.id));

  const items: Array<IntentQuestionTimelineItem<TMessage> & { timestamp: number | null; sequence: number }> = [
    ...messages.map((message, sequence) => ({
      type: "message" as const,
      message,
      timestamp: timestampMs(message.timestamp),
      sequence,
    })),
    ...unanchoredAnswered.map((entry, sequence) => ({
      type: "answered" as const,
      entry,
      timestamp: answeredTimestamp(entry),
      sequence: messages.length + sequence,
    })),
  ];

  items.sort((left, right) => {
    if (left.timestamp !== null && right.timestamp !== null && left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }
    if (left.timestamp === null && right.timestamp !== null) return 1;
    if (left.timestamp !== null && right.timestamp === null) return -1;
    if (left.type !== right.type) return left.type === "message" ? -1 : 1;
    if (left.sequence !== right.sequence) return left.sequence - right.sequence;
    const leftId = left.type === "message" ? left.message.id : left.entry.id;
    const rightId = right.type === "message" ? right.message.id : right.entry.id;
    return leftId.localeCompare(rightId);
  });

  return {
    items: items.map(({ timestamp: _timestamp, sequence: _sequence, ...item }) => item),
    answeredByMessageId,
    pendingByMessageId,
    trailingPending,
  };
}
