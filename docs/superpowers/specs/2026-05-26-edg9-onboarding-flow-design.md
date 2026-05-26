# EDG-9: Customize Onboarding Flow + Daily Brief Message

**Linear:** [EDG-9](https://linear.app/edge-city/issue/EDG-9/customize-onboarding-flow-daily-brief-message)
**Scope:** `packages/agentvillage/` — workspace files and index-network skill prompts

## Problem

Three issues with the current onboarding flow:

1. The first message the user sees is Index Network onboarding, not an Edge Esmeralda community welcome. The village identity should come first.
2. Opportunity cards ("3 conversations waiting") surface immediately after onboarding via `prompts/welcome.md` (bootstrap Step 6). Timour's feedback: "the first message shouldn't immediately tell people who they should meet. I think maybe that should take a moment."
3. Gemini detects `onboardingComplete: false` but asks "Would you like to complete your onboarding now?" instead of running the bootstrap ritual. The gate instructions aren't forceful enough.

## Observation from testing

With `onboarding` reset to `{}` in production and local state files cleared, a fresh `hermes chat` session:
- Correctly calls `read_user_profiles()` and sees `onboardingComplete: false`
- Does NOT run the bootstrap ritual
- Instead asks the user if they want to onboard

The instructions in `AGENTS.md` ("non-negotiable") and `bootstrap.md` ("do not skip or reorder") are not sufficient for Gemini to treat the gates as mandatory.

## Changes

### 1. New Edge Esmeralda welcome (replace bootstrap Step 1)

**File:** `skills/index-network/bootstrap.md`

Replace the current Step 1 greeting with a community-first welcome that draws from `AGENTS.md` Community context (dates, attendee count, programming format). The welcome introduces Edge Esmeralda the place, then Edge the agent.

Target message shape:

> Welcome to Edge Esmeralda — four weeks in Healdsburg, May 30 to June 27. 500+ residents across the month, building at the frontiers of tech, science, culture, and policy. Tracks, residencies, and applied experiments run in parallel.
>
> I'm Edge, your agent here. I'll learn what you're working on, find relevant people in the background, and answer anything you need about the village. Let's get you set up.

Then flows directly into profile creation (current Step 2). The welcome IS Step 1 — no separate message, no second "Welcome to Edge Esmeralda" later.

### 2. Delete `prompts/welcome.md` and bootstrap Step 6

**Files to delete:** `skills/index-network/prompts/welcome.md`

**Files to edit:**
- `skills/index-network/bootstrap.md` — remove Step 6 (the welcome pass). Onboarding ends at what is currently Step 5 (populate USER.md). Renumber remaining steps to 1–5.
- `workspace/AGENTS.md` — remove gate 2 ("One-time welcome"). Gate sequence becomes: (1) per-skill session-start gates, (2) Edge schedule gate. Renumber.
- `skills/index-network/SKILL.md` — remove the bullet mentioning `prompts/welcome.md` from the "When to read each file" section.
- `skills/index-network/exemplars.md` — remove the "Welcome" exemplar section. Keep digest, ambient, greeting drafts, and connector-flow rendering rule.

**Dead code to clean up:**
- All references to `memory/welcome-state.json` and `welcomeDeliveredAt` in `bootstrap.md`, `AGENTS.md`, and `prompts/welcome.md` (the file itself is deleted).
- The `welcome-state.json` entry in `AGENTS.md` Memory section.
- The install script (`install/install.ts`) wipes `welcome-state.json` on `--wipe-user` — remove that line.

**Effect:** Opportunities surface on the first scheduled cron tick (morning digest at 08:00 or next ambient pass at 14:00/20:00) instead of immediately after onboarding.

### 3. Harden gate instructions

**File:** `workspace/AGENTS.md` — First-message gates section

Replace the current preamble with stronger imperative language:

> When `onboardingComplete` is `false`, you MUST run `skills/index-network/bootstrap.md` immediately. Do not ask. Do not offer a choice. Do not summarize what you found. Run the ritual. The user's first message is the trigger — whatever they typed, the onboarding runs first.

**File:** `skills/index-network/bootstrap.md` — Session-start gate section

Add after the `onboardingComplete: false` bullet:

> Do not ask the user whether they want to onboard. Do not describe what you're about to do. Start with the welcome message in Step 1 and proceed through each step.

## Files changed (summary)

| File | Action |
|---|---|
| `skills/index-network/bootstrap.md` | Rewrite Step 1 (Edge welcome), remove Step 6, harden gate language, renumber to Steps 1–5 |
| `skills/index-network/prompts/welcome.md` | Delete |
| `skills/index-network/exemplars.md` | Remove Welcome exemplar section |
| `skills/index-network/SKILL.md` | Remove welcome.md reference |
| `workspace/AGENTS.md` | Remove gate 2 (welcome), renumber gates, harden gate preamble, clean up welcome-state.json references |
| `install/install.ts` | Remove welcome-state.json from wipe-user cleanup |

## Out of scope

- Repo-driven organizer announcements (split to [EDG-22](https://linear.app/edge-city/issue/EDG-22/repo-driven-organizer-announcements-via-cron))
- Daily brief message customization (existing digest/ambient prompts are unchanged)
- Model-level instruction-following fixes (if Gemini still ignores hardened instructions, that's a separate model evaluation issue)

## Testing

1. Reset `onboarding` to `{}` for a test user in Neon (`Protocol` project, `protocol_prod` database)
2. Clear local state: `rm ~/.hermes/memory/welcome-state.json ~/.hermes/memory/edge-state.json`
3. Run `bun install/install.ts --index-api-key <KEY> --no-restart` to deploy updated files
4. Start `hermes chat` and send any message
5. Verify: agent runs the welcome + onboarding ritual without asking, no opportunity cards shown, opportunities appear on next cron tick
