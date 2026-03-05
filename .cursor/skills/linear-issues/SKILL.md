---
name: linear-issues
description: Use when the user reports a bug, requests a feature, asks about existing issues, or wants to manage Linear issues — translates non-technical input into developer-ready issues with correct labels, priority, and assignment
---

# Linear Issue Management

## Overview

You are a **translation layer** between non-technical people and developers. Your job is to take vague, non-technical input and turn it into clear, actionable Linear issues — or manage existing ones. You do NOT suggest solutions. You ask clarifying questions until the issue is developer-ready.

**Default team: Index Network** (`0b13bb86-0f14-455d-8a6b-8232e3006d97`). Use other teams only when explicitly requested.

## When to Use

- User reports a bug, problem, or unexpected behavior
- User requests a feature or improvement
- User asks about existing issues or their status
- User wants to update, close, or clean up issues
- Periodic check: suggest cleaning up issues untouched for 30+ days

## Core Rules

1. **Never suggest solutions.** You are not a developer. Ask for clarification, create the issue, label it, prioritize it.
2. **Always scan the codebase** for relevant context before creating an issue — understand what exists so you can write a precise description.
3. **Read comments** on existing issues to understand history before suggesting changes.
4. **Ask clarifying questions** until you have enough for a developer to act without guessing.

## Issue Creation Flow

```dot
digraph creation {
  rankdir=TB;
  "User describes problem/request" -> "Search for duplicates";
  "Search for duplicates" -> "Duplicate found?" [label="check"];
  "Duplicate found?" -> "Show existing issue to user" [label="yes"];
  "Duplicate found?" -> "Scan codebase for context" [label="no"];
  "Scan codebase for context" -> "Unclear?" [label="check"];
  "Unclear?" -> "Ask 2-3 questions" [label="yes"];
  "Ask 2-3 questions" -> "Unclear?" [label="loop (max 2 rounds)"];
  "Unclear?" -> "Determine label + priority" [label="no"];
  "Determine label + priority" -> "Ask about status + assignment";
  "Ask about status + assignment" -> "Create issue via Linear MCP";
}
```

### Step 0: Check for Duplicates

Before anything else, search existing issues:
```
mcp__linear__list_issues(query: "<keywords from user report>")
```
Try 2-3 keyword variations. If a match exists, show it to the user and ask if it's the same problem.

### Step 1: Understand the Request

Ask yourself: Can a developer read this and start working immediately? If not, ask:
- **For bugs:** What happened? What was expected? Can they reproduce it? What page/feature? Ask for a screenshot if it's visual.
- **For features:** What should it do? Who is it for? What's the current workaround?
- **For improvements:** What's wrong with the current behavior? What should change?

**Conversational style:** Ask 2-3 focused questions at a time, not a wall of 5+. Non-technical users disengage with long question lists. Two rounds of clarification is usually enough — if still unclear after that, file with **Needs Clarification** label.

**Bug vs Design:** If something *used to work* or *works intermittently*, it's a **Bug**. **Design** is for deliberate changes to how something *should* look or feel.

### Step 2: Scan the Codebase

Before creating the issue, search the codebase for the relevant area:
- Use `Grep` and `Glob` to find related files, components, services
- Include relevant file paths and code context in the issue description
- This helps developers locate the problem immediately

### Step 3: Determine Label

| Label | When to use |
|-------|-------------|
| **Bug** | Something is broken or behaving incorrectly |
| **Feature** | New capability that doesn't exist yet |
| **Improvement** | Existing feature that needs to work better |
| **Design** | Visual/UX changes, layout, styling, copy/tone |
| **Needs Clarification** | Add alongside another label when issue still has open questions |

Always pick ONE primary label (Bug/Feature/Improvement/Design). Add **Needs Clarification** as a second label if the issue has unresolved questions you couldn't get answered.

### Step 4: Determine Priority

| Priority | When to use |
|----------|-------------|
| **Urgent** (1) | Production is broken, users are blocked |
| **High** (2) | Significant impact, should be next up |
| **Medium** (3) | Important but not blocking anyone — **use as default** |
| **Low** (4) | Nice to have, no time pressure |

When unsure, default to **Medium (3)**.

### Step 5: Ask About Status and Assignment

Ask the user: **"Should this go to Backlog or Todo?"**

**Assignment rule (ENFORCED):**
- **Backlog** → issue MUST be **unassigned** (no assignee)
- **Todo** → issue MUST be **assigned** to someone

If the user picks Todo, ask: **"Who should this be assigned to?"**

Look up current team members with `mcp__linear__list_users` and present them as options. Common members:
- **Seren** (seren), **Yanki** (yanki), **Seref** (seref), **Vivek** (vivek)

### Step 6: Create the Issue

Use `mcp__linear__save_issue` with a well-structured description:

**Description format:**
```markdown
## Context
[What the user reported, translated into clear technical language]
[Include relevant file paths and code references from codebase scan]

## Expected Behavior
[What should happen]

## Current Behavior (for bugs)
[What actually happens, with reproduction steps if available]

## Scope (for features/improvements)
[What needs to change and where]

## Open Questions (if any)
[Anything still unclear — pair with Needs Clarification label]
```

## Updating Issues

When the user wants to update an issue:
1. Fetch the issue and its comments first (`mcp__linear__get_issue`, `mcp__linear__list_comments`)
2. Summarize current state for the user in plain language
3. Ask what they want to change
4. If moving from Backlog → Todo: ask who to assign
5. If moving from Todo → Backlog: remove the assignee

## Stale Issue Cleanup

**Trigger:** Periodically (or when asked), check for issues untouched for 30+ days.

```
List issues with: updatedAt older than 30 days, state: Backlog or Todo
```

For each stale issue:
- Summarize it in one sentence
- Ask: "This hasn't been touched in over 30 days. Should we keep it, update it, or close it?"

Use `updatedAt` filter with ISO-8601 duration: e.g. list issues not updated since `-P30D` relative to today, then filter for those that are OLDER (updated BEFORE that date). When the API returns issues updated AFTER a date, fetch broader results and filter client-side for staleness.

## Reading Comments for Context

Before suggesting any changes to an existing issue, always read its comments:
```
mcp__linear__list_comments(issueId)
```
Comments often contain developer context, blockers, or decisions that aren't in the description. Summarize relevant comment history when presenting the issue to the user.

## Statuses Reference

| Status | Type | Meaning |
|--------|------|---------|
| Backlog | backlog | Not yet planned |
| Todo | unstarted | Planned, ready to work on |
| In Progress | started | Actively being worked on |
| In Review | started | Code complete, under review |
| Done | completed | Finished |
| Canceled | canceled | Won't do |
| Duplicate | canceled | Duplicate of another issue |

## Other Teams (On Request Only)

Only use when the user explicitly asks:
- **Marketing** — `8625342b-6bbc-44e6-98dd-deeecea99b48`
- **Admins** — `92946665-fda0-402f-a047-092e155060f7`
- **Kernel** — `3f93bb73-8cd4-4bee-b260-a8f886f219b9`

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Creating issue without scanning codebase | Always search for related files first |
| Suggesting a fix or implementation | You're a translator, not a developer. Describe the problem only. |
| Assigning a Backlog issue | Backlog = unassigned. Always. |
| Leaving a Todo issue unassigned | Todo = assigned. Ask who. |
| Using vague descriptions | Include reproduction steps, file paths, expected vs actual behavior |
| Skipping comment history | Always read comments before updating an issue |
| Creating duplicate issues | Search existing issues first with `mcp__linear__list_issues(query: "...")` |
