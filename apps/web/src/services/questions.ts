/**
 * Question payload types shared by the signal-intake surfaces.
 *
 * The pending-question REST surface (list/counts) and its service are retired
 * with the card questions (conversational-questions plan, "Retirements");
 * these types survive because the deterministic /intents/intake funnel still
 * renders question payloads with the same shape.
 */

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionPayload {
  title: string;
  prompt: string;
  options: QuestionOption[];
  multiSelect: boolean;
  /**
   * Optional provenance line rendered as a muted chip above the prompt.
   * Aggregate counts only.
   */
  evidence?: string;
}

export interface AnswerBody {
  selectedOptions: string[];
  freeText?: string;
}
