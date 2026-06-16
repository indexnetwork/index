import type { ProfileCase } from "./profile.types.js";

/**
 * Profile eval golden corpus (starter set).
 *
 * Exercises `ProfileGenerator.invoke`: structured-profile extraction from raw
 * data, location inference, skills/interests capture, the PII-redaction privacy
 * guarantee, and update-request handling. Tier 1 = surgical, Tier 2 = realistic
 * messy input. `noPII` defaults on for every case — privacy is always asserted.
 *
 * Grow by appending cases. Re-run with `--update-baseline` after an intentional
 * change.
 */
export const CASES: ProfileCase[] = [
  {
    id: "extraction/clean-bio",
    rule: "extraction",
    tier: 1,
    description: "Clean bio → name, location, skills, and interests extracted.",
    input:
      "Ada Lovelace is a mathematician and writer based in London, UK. She works on analytical engines, and is skilled in mathematics, logic, and technical writing. She is interested in computing and poetry.",
    expect: {
      expectNameContains: "Ada",
      expectLocationContains: "London",
      minSkills: 2,
      minInterests: 1,
      mustHaveSkills: ["mathematics"],
    },
  },
  {
    id: "extraction/scraped-blob",
    rule: "extraction",
    tier: 2,
    description: "Messy scraped LinkedIn-style blob → coherent structured profile.",
    input:
      "PROFILE | Priya Nair · Senior Backend Engineer @ Stripe · San Francisco Bay Area · 9 yrs · Go, Kubernetes, distributed systems, PostgreSQL · ex-Google · open source maintainer · talks about: payments infra, reliability",
    expect: {
      expectNameContains: "Priya",
      expectLocationContains: "San Francisco",
      minSkills: 3,
      mustHaveSkills: ["Go", "Kubernetes"],
    },
  },
  {
    id: "location/explicit-city",
    rule: "location",
    tier: 1,
    description: "Explicit city is captured in identity.location.",
    input:
      "Lars Berg, product designer. Based in Berlin, Germany. Skilled in UX design, Figma, and design systems. Interested in typography.",
    expect: { expectLocationContains: "Berlin", expectNameContains: "Lars" },
  },
  {
    id: "privacy/email-and-phone",
    rule: "privacy",
    tier: 1,
    description: "Email and phone in raw data must NOT appear in any public field.",
    input:
      "John Park — senior backend engineer at Acme. Contact: john.park@acme.com, +1 415-555-0199. Based in Austin, TX. Skilled in Go and Postgres. Interested in databases.",
    expect: {
      expectNameContains: "John",
      expectLocationContains: "Austin",
      mustHaveSkills: ["Go"],
      // noPII defaults on — the email and phone must be redacted.
    },
  },
  {
    id: "privacy/contact-heavy",
    rule: "privacy",
    tier: 2,
    description: "Contact-identifier-heavy input still yields a PII-free public profile.",
    input:
      "Maria Gomez, growth marketer. Reach me at maria.gomez@gmail.com or (212) 555-0143. Office: 500 5th Ave, New York. Skilled in SEO, content strategy, and analytics. Loves running.",
    expect: { expectNameContains: "Maria", expectLocationContains: "New York", minSkills: 2 },
  },
  {
    id: "skills_interests/multi-skill",
    rule: "skills_interests",
    tier: 1,
    description: "A skill-dense bio yields multiple distinct skills and interests.",
    input:
      "Sam Okafor — full-stack engineer. Works with TypeScript, React, Node.js, Postgres, and AWS. Interested in developer tooling, open source, and climbing.",
    expect: {
      expectNameContains: "Sam",
      minSkills: 4,
      minInterests: 2,
      mustHaveSkills: ["TypeScript", "React"],
      mustHaveInterests: ["open source"],
    },
  },
  {
    id: "update/add-and-remove",
    rule: "update",
    tier: 2,
    description: "Existing profile + request: apply the change, preserve the rest.",
    input: `EXISTING PROFILE:
{
  "identity": { "name": "Dana Lee", "bio": "Backend engineer focused on payments.", "location": "Toronto, Canada" },
  "narrative": { "context": "Dana is a backend engineer working on payments infrastructure." },
  "attributes": { "interests": ["fintech", "poetry"], "skills": ["Java", "Spring"] }
}

USER REQUEST: Add Rust to my skills and remove poetry from my interests.`,
    expect: {
      expectNameContains: "Dana",
      expectLocationContains: "Toronto",
      mustApply: "Rust is present in skills and poetry is no longer in interests",
      mustPreserve: "the name Dana Lee, the Toronto location, and the existing Java/Spring skills",
    },
  },
  {
    id: "privacy/no-contact-clean",
    rule: "privacy",
    tier: 1,
    description: "Already-clean input stays clean (privacy never introduces false positives).",
    input:
      "Wei Chen, research scientist in computational biology at a university lab in Boston. Skilled in Python, genomics, and statistics. Interested in protein folding.",
    expect: { expectNameContains: "Wei", expectLocationContains: "Boston", minSkills: 2 },
  },
];
