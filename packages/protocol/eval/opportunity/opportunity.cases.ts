import type { OpportunityCase } from "./opportunity.types.js";

/**
 * Opportunity-card eval golden corpus (starter set).
 *
 * Exercises `OpportunityPresenter.present`: the user-facing card (headline,
 * personalized summary, suggested action, intro greeting). Every case asserts the
 * always-on guarantees by default \u2014 second-person voice, no UUID/label leakage,
 * and a clean greeting \u2014 plus judged grounding / framing / tone where relevant.
 *
 * `viewerRole` drives framing: a `party`/`patient` viewer is one side of the
 * match; an `introducer` is connecting two OTHER people. Grow by appending cases.
 */
export const CASES: OpportunityCase[] = [
  {
    id: "viewer_voice/founder-investor",
    rule: "viewer_voice",
    tier: 1,
    description: "Party viewer (founder) shown an aligned investor \u2014 card speaks to the viewer.",
    human: {
      scenario: "a founder raising a seed round, shown an investor who backs climate hardware at exactly their stage.",
      expectation: "write the card directly to the founder (\u201cyou\u201d), explaining why this investor is worth meeting.",
    },
    input: {
      viewerContext: "Ava is a climate-hardware founder raising a $2M seed round for a direct-air-capture startup. She wants investors who understand deep tech and hardware timelines.",
      otherPartyContext: "Ben is an early-stage investor who writes first checks into climate hardware and deep tech, typically at seed.",
      matchReasoning: "Both are anchored on climate hardware; the founder is raising seed and the investor writes seed checks in exactly this space.",
      category: "funding",
      confidence: 0.86,
      signalsSummary: "Shared focus on climate hardware; complementary fundraising stage.",
      indexName: "Climate Builders",
      viewerRole: "party",
    },
    expect: {
      mustReference: "the viewer is a climate-hardware founder raising a seed round, and the other person is a seed-stage climate-hardware investor",
    },
  },
  {
    id: "no_leakage/identifiers-in-context",
    rule: "no_leakage",
    tier: 2,
    description: "Raw UUID + internal label in the context must never reach the card.",
    human: {
      scenario: "match context that accidentally includes a raw database id and an internal label (\u201cthe source user\u201d).",
      expectation: "write a clean card with no database ids or internal jargon \u2014 just plain, human copy.",
    },
    input: {
      viewerContext: "A product designer focused on design systems and accessibility.",
      otherPartyContext: "A frontend engineer who needs design-system help.",
      matchReasoning: "The source user (userId 5f0a2c14-6b3e-4f9a-8c21-9d7e1b2a4c6f) overlaps with the candidate on design systems.",
      category: "collaboration",
      confidence: 0.78,
      signalsSummary: "intentId a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d: shared design-system focus.",
      indexName: "Design Guild",
      viewerRole: "party",
    },
    expect: {},
  },
  {
    id: "greeting/plain-prose",
    rule: "greeting",
    tier: 1,
    description: "Greeting is plain first-person prose \u2014 no markdown, no 'Hey Name,' prefix.",
    human: {
      scenario: "a complementary match between a designer and an engineer, where the card also drafts an intro message.",
      expectation: "draft a short, natural opener the viewer could send \u2014 plain text, no formatting, no \u201cHey Sam,\u201d header.",
    },
    input: {
      viewerContext: "Sam is a brand designer who loves working with early-stage founders on visual identity.",
      otherPartyContext: "Priya is a solo technical founder who just launched and needs help with brand and identity.",
      matchReasoning: "Sam offers exactly the brand/identity help Priya is looking for.",
      category: "collaboration",
      confidence: 0.82,
      signalsSummary: "Complementary: designer offering, founder needing brand work.",
      indexName: "Founders & Makers",
      viewerRole: "party",
    },
    expect: { greetingClean: true },
  },
  {
    id: "grounding/specific-intents",
    rule: "grounding",
    tier: 2,
    description: "Summary must reflect the viewer's specific intents without inventing facts.",
    human: {
      scenario: "a researcher whose stated goals are very specific (finding a co-author on a protein-folding paper).",
      expectation: "explain the match using their actual goal, not vague or made-up reasons.",
    },
    input: {
      viewerContext: "Dr. Lin is a computational biologist looking for a co-author with wet-lab experience to validate a protein-folding model before submitting to a journal.",
      otherPartyContext: "Marco runs a wet lab and has validated structural-biology models for several published papers.",
      matchReasoning: "The viewer needs wet-lab validation for a protein-folding model; the other party runs a wet lab with exactly that track record.",
      category: "research",
      confidence: 0.84,
      signalsSummary: "Complementary: needs wet-lab validation / offers wet-lab validation.",
      indexName: "Bio Researchers",
      viewerRole: "patient",
    },
    expect: {
      mustReference: "the viewer needs wet-lab validation for a protein-folding model and the other person runs a wet lab that does exactly that",
      toneCriteria: "The copy should be specific and compelling, not generic filler like 'a promising connection'.",
    },
  },
  {
    id: "introducer_role/connecting-two-others",
    rule: "introducer_role",
    tier: 2,
    description: "Introducer viewer: frame as connecting two OTHER people, not the viewer's own needs.",
    human: {
      scenario: "a community host who is connecting two other members \u2014 they are the matchmaker, not a party to the match.",
      expectation: "frame the card as \u201cyou're connecting X and Y because\u2026\u201d and never reference the host's own goals.",
    },
    input: {
      viewerContext: "Jordan hosts the community and frequently introduces members. Jordan is not part of this match.",
      otherPartyContext: "Connecting two members: Lea (a grant-writer for climate nonprofits) and Tom (a climate nonprofit founder seeking grant help).",
      matchReasoning: "Lea writes climate grants; Tom needs grant help for his nonprofit. Jordan saw the fit and wants to connect them.",
      category: "introduction",
      confidence: 0.8,
      signalsSummary: "Grant-writer and grant-seeker in the climate-nonprofit space.",
      indexName: "Climate Builders",
      viewerRole: "introducer",
    },
    expect: {
      framingCriteria: "The card must frame the viewer as connecting Lea and Tom (the matchmaker), explaining why those two should meet \u2014 NOT describing the viewer's own intents or needs.",
    },
  },
  {
    id: "introducer_role/explicit-introduction",
    rule: "introducer_role",
    tier: 2,
    description: "Introduction-originated card must acknowledge the human introducer.",
    human: {
      scenario: "a connection that a real person (Maya) deliberately set up, rather than an automatic match.",
      expectation: "acknowledge that Maya made the introduction and treat it as a personal recommendation.",
    },
    input: {
      viewerContext: "You are a product manager exploring a move into developer tools.",
      otherPartyContext: "Noah leads developer experience at a fast-growing dev-tools company.",
      matchReasoning: "Maya knows both and thinks the viewer's PM background fits Noah's team and interests.",
      category: "introduction",
      confidence: 0.75,
      signalsSummary: "Personal introduction; overlapping interest in developer tools.",
      indexName: "Dev Tools Circle",
      viewerRole: "party",
      isIntroduction: true,
      introducerName: "Maya",
    },
    expect: {
      framingCriteria: "The card must acknowledge that Maya personally made this introduction (e.g. 'Maya thinks you should meet Noah'), treating it as a recommendation rather than an automatic system match.",
    },
  },
  {
    id: "tone/compelling-not-analytical",
    rule: "tone",
    tier: 1,
    description: "Copy is warm and compelling, not a dry third-party analysis.",
    human: {
      scenario: "a strong mutual match between two people building in the same niche.",
      expectation: "make the card feel personal and inviting, not like a clinical report about two strangers.",
    },
    input: {
      viewerContext: "Rae builds open-source developer tooling and cares a lot about contributor experience.",
      otherPartyContext: "Kai maintains a popular OSS framework and writes about sustainable maintainership.",
      matchReasoning: "Both care deeply about open-source contributor and maintainer experience.",
      category: "peer",
      confidence: 0.83,
      signalsSummary: "Shared focus on OSS contributor / maintainer experience.",
      indexName: "Open Source Collective",
      viewerRole: "party",
    },
    expect: {
      toneCriteria: "The copy must read as warm, personal, and compelling (addressed to the viewer), not as a detached third-party analysis of two users.",
    },
  },
  {
    id: "viewer_voice/patient-role",
    rule: "viewer_voice",
    tier: 1,
    description: "Patient viewer is addressed directly about why the match helps them.",
    human: {
      scenario: "someone who has been looking for a specific kind of mentor, now shown a strong match.",
      expectation: "speak to them directly about why this person can help with what they asked for.",
    },
    input: {
      viewerContext: "Tariq is a junior data scientist looking for a mentor experienced in deploying ML models to production.",
      otherPartyContext: "Sofia is a staff ML engineer who has shipped many production ML systems and enjoys mentoring.",
      matchReasoning: "Tariq wants production-ML mentorship; Sofia is an experienced production-ML engineer who mentors.",
      category: "mentorship",
      confidence: 0.85,
      signalsSummary: "Mentee seeking production-ML mentorship / mentor offering it.",
      indexName: "ML Practitioners",
      viewerRole: "patient",
    },
    expect: {
      mustReference: "the viewer wants a mentor for deploying ML to production and the other person is an experienced production-ML engineer who mentors",
    },
  },
];
