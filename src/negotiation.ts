import type { Negotiator } from "./negotiator.ts";
import type { NegotiationMessage, NegotiationParty } from "./types.ts";

export interface Participant {
  party: NegotiationParty;
  negotiator: Negotiator;
}

export interface TranscriptEntry {
  speaker: number;
  content: string;
}

export interface NegotiationOptions {
  /** Total messages to exchange before giving up. Default 10. */
  maxTurns?: number;
  /** Called after each message; return true to end the negotiation. */
  stopWhen?: (entry: TranscriptEntry, transcript: TranscriptEntry[]) => boolean;
}

function historyFor(
  speaker: number,
  transcript: TranscriptEntry[],
): NegotiationMessage[] {
  return transcript.map((entry) => ({
    role: entry.speaker === speaker ? "outgoing" : "incoming",
    content: entry.content,
  }));
}

export async function runNegotiation(
  participants: [Participant, Participant],
  options: NegotiationOptions = {},
): Promise<TranscriptEntry[]> {
  const maxTurns = options.maxTurns ?? 10;
  const transcript: TranscriptEntry[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const speaker = turn % 2;
    const participant = speaker === 0 ? participants[0] : participants[1];

    const reply = await participant.negotiator.respond({
      party: participant.party,
      history: historyFor(speaker, transcript),
    });

    const entry: TranscriptEntry = { speaker, content: reply };
    transcript.push(entry);

    if (options.stopWhen?.(entry, transcript)) {
      break;
    }
  }

  return transcript;
}
