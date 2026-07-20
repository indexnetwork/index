/**
 * Entity component library — barrel export.
 * Each entity ships three density variants: *Card (full width),
 * *SidebarCard (contextual rail), and *Chip (compact in-chat reference).
 */
export * from './shared';
export { IntentCard, IntentSidebarCard, IntentChip, type LibraryIntent } from './intent';
export { OpportunityCard, OpportunitySidebarCard, OpportunityChip, type LibraryOpportunity } from './opportunity';
export { NegotiationCard, NegotiationSidebarCard, NegotiationChip, type LibraryNegotiation } from './negotiation';
export { QuestionCard, QuestionSidebarCard, QuestionInChat, type LibraryQuestion } from './question';
export { PremiseCard, PremiseSidebarCard, PremiseChip, type LibraryPremise } from './premise';
