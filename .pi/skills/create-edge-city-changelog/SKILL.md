---
name: create-edge-city-changelog
description: Draft the next Agent Village / Edge City Telegram changelog from the last message the user sent and its date/range. Use when the user provides the latest Telegram changelog and wants changes after it detected under packages/edge-city and rewritten as a concise channel-ready update.
---

# Edge City Telegram Changelog

Use this workflow to produce the next Telegram-channel changelog for Agent Village / Edge City.

## Input

The user should provide:

- the latest changelog message they sent to Telegram, including its date or date range;
- optionally the new target date. If omitted, use the current date from system context.

Treat the latest message as the **style anchor** and the date/range as the **lower bound** for change detection.

## Goal

Return one polished Telegram-ready changelog that:

1. covers meaningful changes after the previous changelog's end date and up to the target date;
2. focuses on user-visible value, not commit mechanics;
3. is honest when the day was mostly QA, reliability, or behind-the-scenes work;
4. matches the prior message's tone, structure, emoji density, and level of detail.

## Workflow

### 1. Parse the window

- Extract the previous changelog's end date from the user's message.
  - Example: `June 12–13` means the prior window ends on June 13.
- Determine the new target date from the user's request or system date.
- Search for changes strictly after the previous end date, unless the user asks for a different window.

### 2. Collect evidence

Inspect the Edge City subtree and submodules:

```bash
git status --short

git log --since='<YYYY-MM-DD 00:00>' --date=iso \
  --pretty=format:'%h %ad %s' -- packages/edge-city

for d in \
  packages/edge-city/agentvillage \
  packages/edge-city/agentvillage-controlplane \
  packages/edge-city/agentvillage-landing; do
  echo "--- $d ---"
  git -C "$d" log --since='<YYYY-MM-DD 00:00>' --date=iso \
    --pretty=format:'%h %ad %s' -30
  git -C "$d" status --short
done
```

If the parent repo only has submodule pointer bumps, inspect the submodule commits with `git -C <submodule> show --stat <hash>`.

Also check for same-day audit/research artifacts when the changelog is for operational quality work:

```bash
find .rpiv/artifacts -type f -iname '*digest*' -o -iname '*edge*' | sort
```

Read any directly relevant artifact before summarizing it.

### 3. Classify changes

Group evidence into audience-friendly buckets, commonly:

- `📬 Daily brief` — digest, questions, reminders, links, delivery reliability;
- `📢 Community announcements` — broadcasts, targeted sends, admin announcement tooling;
- `🛠 Behind the scenes` — QA, privacy checks, pacing, operational fixes;
- `🏡 Village experience` — landing/setup/admin UX changes.

Prefer benefits over implementation details. Translate:

- cron/rate-limit changes → smoother, more reliable delivery;
- MCP headers/connect-link fixes → links open in the right place;
- targeted send APIs/admin UI → relevant announcements, less noise;
- audit results → privacy/link/quality checks passed;
- failing or incomplete work → do not present as shipped.

### 4. Draft the message

Format rules:

- Start with `What's New in Agent Village — <Month Day>` or preserve the user's prior title style.
- Keep it short enough for Telegram: usually 2–4 sections, 1–4 bullets/paragraphs each.
- Avoid commit hashes, PR numbers, file names, and internal service names unless the user asks.
- Do not mention exact private emails, UUIDs, raw tenant counts, or sensitive audit details.
- If there were no new user-facing features, say so plainly and frame the update around quality/reliability.
- Do not claim something was sent, deployed, or fixed unless the evidence supports it.

### 5. Final response

Return only the draft message by default, inside a fenced `text` block.

If the user asks to copy it, write the exact draft to macOS clipboard with:

```bash
cat <<'EOF' | pbcopy
<draft>
EOF
```

Then confirm briefly.

## Quality checklist

Before responding, verify:

- [ ] The date window is correct.
- [ ] Every claim traces to a commit, submodule commit, local artifact, or explicit user-provided fact.
- [ ] The tone matches the prior Telegram message.
- [ ] No private identifiers or sensitive operational details are exposed.
- [ ] The draft is channel-ready without extra commentary.
