/**
 * Component-library showcase. Renders every entity (premise, intent,
 * opportunity, negotiation, question) in its three density variants:
 *   1 · Full-width card  — primary surface (Signals page)
 *   2 · Sidebar card     — contextual rail (intent page)
 *   3 · In-chat chip     — compact clickable reference inside chat text
 *
 * Rendered statically to library-showcase.html by scripts/render-library-showcase.tsx.
 */
import type { ReactNode } from 'react';

import { IntentCard, IntentChip, IntentSidebarCard } from './intent';
import { OpportunityCard, OpportunityChip, OpportunitySidebarCard } from './opportunity';
import { NegotiationCard, NegotiationChip, NegotiationSidebarCard } from './negotiation';
import { QuestionCard, QuestionInChat, QuestionSidebarCard } from './question';
import { PremiseCard, PremiseChip, PremiseSidebarCard } from './premise';
import { mockIntents, mockNegotiations, mockOpportunities, mockPremises, mockQuestions } from './mock-data';

function SectionHeader({ index, title, description }: { index: string; title: string; description: string }) {
  return (
    <div className="border-b border-gray-200 pb-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400 font-ibm-plex-mono">{index}</p>
      <h2 className="mt-1 text-xl font-bold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </div>
  );
}

function VariantLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-gray-400 font-ibm-plex-mono">{children}</p>
  );
}

/** Mock right-rail frame so sidebar variants render at their real width. */
function SidebarFrame({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-[340px] rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
      <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-gray-400 font-ibm-plex-mono">Right rail · 340px</p>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

/** Mock chat thread so in-chat chips render in their real inline context. */
function ChatFrame({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-[520px] rounded-lg border border-dashed border-gray-300 bg-[#F8F8F8] p-4">
      <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-gray-400 font-ibm-plex-mono">In-chat · inline</p>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

/** Renders a chip inside a representative sentence to show inline behavior. */
function ChipSentence({ before, chip, after }: { before: string; chip: ReactNode; after?: string }) {
  return (
    <p className="rounded-lg border border-gray-200 bg-white p-3 text-sm leading-loose text-gray-800">
      {before} {chip}
      {after ? ` ${after}` : ''}
    </p>
  );
}

export function ShowcasePage() {
  // No-op handlers so action buttons, hover states, and clickable affordances
  // render in the static showcase. Real surfaces wire these to services.
  const noop = () => {};
  const [signal, researchSignal, pausedSignal] = mockIntents;
  const [pendingOpp, negotiatingOpp, acceptedOpp] = mockOpportunities;
  const [activeNeg, completedNeg] = mockNegotiations;
  const [poolQuestion, enrichmentQuestion, answeredQuestion, freeTextQuestion] = mockQuestions;
  const [founderPremise, searchPremise, readingPremise] = mockPremises;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-12">
        <p className="text-[11px] uppercase tracking-[0.2em] text-[#4091BB] font-ibm-plex-mono">Index Network · Design System</p>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">Entity Component Library</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-gray-600">
          Five domain entities, each in three densities. From 1 → 3 each variant shows less: full-width cards for
          primary surfaces, sidebar cards for contextual rails, and compact clickable chips for in-chat references.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-gray-500 font-ibm-plex-mono">
          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">IBM Plex Mono · meta</span>
          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">Public Sans · body</span>
          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">#041729 · primary</span>
          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">#4091BB · accent</span>
          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">pulsing · live</span>
        </div>
      </header>

      <div className="space-y-16">
        {/* ── Intent ─────────────────────────────────────────────── */}
        <section className="space-y-6">
          <SectionHeader
            index="01 · Intent"
            title="Signals"
            description="What a member wants to find. Active signals pulse live and carry the questions-to-answer badge."
          />
          <div>
            <VariantLabel>1 · Full width — Signals page</VariantLabel>
            <div className="space-y-3">
              <IntentCard intent={signal} onOpen={noop} onTogglePause={noop} />
              <IntentCard intent={pausedSignal} onOpen={noop} onTogglePause={noop} />
            </div>
          </div>
          <div>
            <VariantLabel>2 · Sidebar — intent page rail</VariantLabel>
            <SidebarFrame>
              <IntentSidebarCard intent={signal} onOpen={noop} />
              <IntentSidebarCard intent={researchSignal} onOpen={noop} />
            </SidebarFrame>
          </div>
          <div>
            <VariantLabel>3 · In-chat chip</VariantLabel>
            <ChatFrame>
              <ChipSentence
                before="Your signal"
                chip={<IntentChip intent={signal} onOpen={noop} />}
                after="has 2 questions waiting — answering them sharpens the next discovery run."
              />
            </ChatFrame>
          </div>
        </section>

        {/* ── Opportunity ────────────────────────────────────────── */}
        <section className="space-y-6">
          <SectionHeader
            index="02 · Opportunity"
            title="Opportunities"
            description="A potential connection surfaced by discovery. Borders key to lifecycle status; the narrator chip carries human introductions."
          />
          <div>
            <VariantLabel>1 · Full width — Signals page / discovery feed</VariantLabel>
            <div className="space-y-3">
              <OpportunityCard opportunity={pendingOpp} onPrimaryAction={noop} onSecondaryAction={noop} onOpenProfile={noop} />
              <OpportunityCard opportunity={acceptedOpp} onOpenProfile={noop} />
            </div>
          </div>
          <div>
            <VariantLabel>2 · Sidebar — intent page Radar rail</VariantLabel>
            <SidebarFrame>
              <OpportunitySidebarCard opportunity={pendingOpp} onPrimaryAction={noop} onOpenProfile={noop} />
              <OpportunitySidebarCard opportunity={negotiatingOpp} onPrimaryAction={noop} onOpenProfile={noop} />
            </SidebarFrame>
          </div>
          <div>
            <VariantLabel>3 · In-chat chip</VariantLabel>
            <ChatFrame>
              <ChipSentence
                before="While you were away, your agent found"
                chip={<OpportunityChip opportunity={pendingOpp} onOpenProfile={noop} />}
                after="— want me to open the introduction?"
              />
              <ChipSentence before="You connected with" chip={<OpportunityChip opportunity={acceptedOpp} onOpenProfile={noop} />} after="last week." />
            </ChatFrame>
          </div>
        </section>

        {/* ── Negotiation ────────────────────────────────────────── */}
        <section className="space-y-6">
          <SectionHeader
            index="03 · Negotiation"
            title="Negotiations"
            description="Agent-to-agent turns that arbitrate whether an opportunity should exist. Action labels carry semantic colors."
          />
          <div>
            <VariantLabel>1 · Full width — negotiations surface</VariantLabel>
            <div className="space-y-3">
              <NegotiationCard negotiation={activeNeg} onOpen={noop} />
              <NegotiationCard negotiation={completedNeg} onOpen={noop} />
            </div>
          </div>
          <div>
            <VariantLabel>2 · Sidebar — intent page rail</VariantLabel>
            <SidebarFrame>
              <NegotiationSidebarCard negotiation={activeNeg} onOpen={noop} />
            </SidebarFrame>
          </div>
          <div>
            <VariantLabel>3 · In-chat chip</VariantLabel>
            <ChatFrame>
              <ChipSentence
                before="The negotiation with"
                chip={<NegotiationChip negotiation={activeNeg} onOpen={noop} />}
                after="moved forward — their agent countered your reading-group proposal."
              />
            </ChatFrame>
          </div>
        </section>

        {/* ── Question ───────────────────────────────────────────── */}
        <section className="space-y-6">
          <SectionHeader
            index="04 · Question"
            title="Questions"
            description="Short interviews that sharpen intents and premises. Two states — unanswered (interactive lettered options) and answered (locked selection). In-chat renders the actual question, not a chip."
          />
          <div>
            <VariantLabel>1 · Full width — interview surface</VariantLabel>
            <div className="space-y-3">
              <QuestionCard question={poolQuestion} onAnswer={noop} onDismiss={noop} />
              <QuestionCard question={answeredQuestion} />
            </div>
          </div>
          <div>
            <VariantLabel>2 · Sidebar — intent page rail</VariantLabel>
            <SidebarFrame>
              <QuestionSidebarCard question={poolQuestion} onOpen={noop} />
              <QuestionSidebarCard question={answeredQuestion} />
            </SidebarFrame>
          </div>
          <div>
            <VariantLabel>3 · In-chat — compact interview</VariantLabel>
            <ChatFrame>
              <p className="rounded-lg border border-gray-200 bg-white p-3 text-sm leading-relaxed text-gray-800">
                Before I introduce you to researchers, I&rsquo;d like to sharpen how you&rsquo;re represented to them:
              </p>
              <QuestionInChat question={enrichmentQuestion} onAnswer={noop} onDismiss={noop} />
              <QuestionInChat question={freeTextQuestion} />
            </ChatFrame>
          </div>
        </section>

        {/* ── Premise ────────────────────────────────────────────── */}
        <section className="space-y-6">
          <SectionHeader
            index="05 · Premise"
            title="Premises"
            description="The atomic beliefs the protocol holds about a member — what agents reason over. Cards expose provenance: kind, source, confidence."
          />
          <div>
            <VariantLabel>1 · Full width — premises surface</VariantLabel>
            <div className="space-y-3">
              <PremiseCard premise={founderPremise} />
              <PremiseCard premise={searchPremise} />
            </div>
          </div>
          <div>
            <VariantLabel>2 · Sidebar — network overview rail</VariantLabel>
            <SidebarFrame>
              <PremiseSidebarCard premise={searchPremise} onOpen={noop} />
              <PremiseSidebarCard premise={readingPremise} onOpen={noop} />
            </SidebarFrame>
          </div>
          <div>
            <VariantLabel>3 · In-chat chip</VariantLabel>
            <ChatFrame>
              <ChipSentence
                before="I matched you because"
                chip={<PremiseChip premise={searchPremise} onOpen={noop} />}
                after="— is that still accurate?"
              />
            </ChatFrame>
          </div>
        </section>
      </div>

      <footer className="mt-16 border-t border-gray-200 pt-6 text-[11px] text-gray-400 font-ibm-plex-mono">
        Generated from apps/web/src/components/library · variants: full → sidebar → chip · mock data only
      </footer>
    </div>
  );
}

export default ShowcasePage;
