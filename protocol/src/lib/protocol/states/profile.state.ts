import { Annotation } from "@langchain/langgraph";
import { ProfileDocument } from "../agents/profile.generator";
import type { DebugMetaAgent } from '../../../types/chat-streaming.types';

/**
 * The Graph State for Profile Generation.
 */
export const ProfileGraphState = Annotation.Root({
  // --- Inputs (Required at start) ---
  /**
   * The User ID to link the profile to.
   */
  userId: Annotation<string>,

  // --- Control Fields (Operation Mode) ---

  /**
   * Operation mode controls graph flow:
   * - 'query': Fast path - only retrieve existing profile (no generation)
   * - 'write': Full pipeline - generate/update profile and hyde as needed
   * - 'generate': Auto-generate profile from user table data via Parallels searchUser API
   */
  operationMode: Annotation<'query' | 'write' | 'generate'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'write',
  }),

  /**
   * Flag to force profile regeneration even if profile exists.
   * When true with new input, the graph will re-generate and update the profile.
   */
  forceUpdate: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  // --- Intermediate State ---

  /**
   * Pre-fetched enrichment content (e.g. from Parallels search in the queue handler).
   * When provided, autoGenerateNode skips its own search and uses this directly.
   */
  enrichmentInput: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  /**
   * Pre-populated profile from external enrichment (e.g. Parallel Chat API).
   * When provided, the graph skips profile generation and only runs embedding + HyDE.
   */
  prePopulatedProfile: Annotation<{
    identity: { name: string; bio: string; location: string };
    narrative: { context: string };
    attributes: { skills: string[]; interests: string[] };
  } | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  /**
   * Internal objective constructed from user data.
   */
  objective: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  /**
   * Raw input data (either provided or scraped).
   */
  input: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  /**
   * The generated or loaded profile document.
   * Includes embedding from DB. Profile HyDE is stored in hyde_documents.
   */
  profile: Annotation<ProfileDocument | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  /**
   * Flags to track what needs to be generated.
   */
  needsProfileGeneration: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  needsProfileEmbedding: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  needsHydeGeneration: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  needsHydeEmbedding: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  /**
   * Flag indicating that user information is insufficient for accurate profile generation.
   * When true, the graph should request additional information from the user.
   */
  needsUserInfo: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  /**
   * List of missing user information fields.
   * Used to construct a helpful clarification message.
   */
  missingUserInfo: Annotation<string[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  // --- Output ---

  /**
   * The generated HyDE description string from the HydeGenerator.
   */
  hydeDescription: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  /**
   * Error message if any step fails (non-fatal).
   */
  error: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  // --- Operation Tracking (for transparency) ---

  /**
   * Tracks which operations were actually performed during this graph execution.
   * Used to provide explicit feedback to the user about what happened.
   */
  operationsPerformed: Annotation<{
    scraped?: boolean;
    generatedProfile?: boolean;
    embeddedProfile?: boolean;
    generatedHyde?: boolean;
    embeddedHyde?: boolean;
  }>({
    reducer: (curr, next) => ({ ...curr, ...next }),
    default: () => ({}),
  }),

  /** Timing records for each agent invocation within this graph run. */
  agentTimings: Annotation<DebugMetaAgent[]>({
    reducer: (acc, val) => [...acc, ...val],
    default: () => [],
  }),

  /**
   * Output for query mode: structured result for the tool to read.
   */
  readResult: Annotation<{
    hasProfile: boolean;
    profile?: {
      id?: string;
      name: string;
      bio: string;
      location: string;
      skills: string[];
      interests: string[];
    };
    message?: string;
  } | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),
});
