# Run an autonomous Index negotiation

The standalone terminal host in `agent-negotiation.ts` injects real Index REST
tools into two separate `@indexnetwork/agent` sessions. The API and agent library
are unchanged. This is a controlled, single-negotiation host, not an API-hosted
runner: no A2A, SSE watcher, background scheduling, DMs, or restart recovery.

## Who decides what

Each personal agent receives its own principal's identity, intent, instructions,
and private conversation history. It sees the counterparty only through the
shared Index negotiation. Neither model receives an API key, the other
principal's instructions, or their private answers.

The host follows Index's `awaitingUserId`, runs that agent, and records the
agent's chosen turn **without an approval prompt**. The prompts—not a scripted
negotiation or a host decision tree—tell agents to:

- Pursue the principal's actual intent within their authority, not agreement
  for its own sake. Do not substitute an introductory call unless authorized.
- Act autonomously when the known preferences and authority are sufficient.
- Ask their principal one focused question when a missing personal fact,
  preference, or authorization materially changes the next decision or response.
  An intent is a goal, not evidence of experience or availability. Do not invent
  facts, evade material incoming questions, or ask an intake checklist.
- Negotiate unknown counterparty terms with the other agent rather than ask
  their own principal to guess them.
- Accept only an understood standing offer; counter or decline when appropriate.
  A commitment to meet does not mean a meeting has been scheduled.

Human participation is limited to answering an agent's principal question.
The host does not write offers, choose an outcome, or decide when a substantive
question is needed. Prompt adherence is model behavior, not a permissions
sandbox: only use principals and credentials whose autonomous participation you
are authorized to run.

## Before running

- Start the local Index API; the frontend is an optional observer.
- Select an existing open negotiation using its **opportunity ID**, not its
  negotiation ID. This command does not create or reset negotiations.
- Obtain separate Index API keys for both principals. This local host holds
  both keys but binds each agent's tools to only its own key and the selected
  opportunity. Do not run another writer for either seat concurrently.
- Supply `OPENROUTER_API_KEY` in the terminal environment.
- Put each principal's actual preferences and limits in a separate local text
  file outside Git. Do not write a desired proposal, scripted question, or
  predetermined outcome. The host reads each principal's intent from Index.

Example instructions for a disposable collaboration fixture:

```text
Explore whether this collaboration is a fit for my stated intent.
You may discuss possible terms, but do not commit me to paid or unpaid work,
delivery dates, or exclusivity without my authorization.
```

Use only permissions and preferences the principal actually supplied. These
instructions deliberately leave room for a genuine question; they do not
require one. If a principal has already authorized a specific next step, include
that rather than making the agent ask for the same permission again.

## Run both sides

From the repository root or task worktree:

```bash
export INDEX_API_URL=http://localhost:3001
# Enter keys without echoing them or placing them in shell history.
read -rs INDEX_API_KEY; export INDEX_API_KEY; echo
read -rs INDEX_COUNTERPARTY_API_KEY; export INDEX_COUNTERPARTY_API_KEY; echo
# OPENROUTER_API_KEY must also be set; it is a different credential.
bun run agent:negotiate <opportunity-id> /tmp/alice-instructions.txt /tmp/bob-instructions.txt
```

The first file belongs to `INDEX_API_KEY`'s owner; the second belongs to
`INDEX_COUNTERPARTY_API_KEY`'s owner. The command checks that these are the two
distinct seats. Either seat may be awaiting: Index, not argument order, chooses
who runs first. This replaces the earlier single-owner, approved-turn command.

On `ask_user`, the terminal shows **which principal** should answer. Supply only
that principal's answer. The agent resumes its private conversation and decides
what to do next; the host does not turn the answer into an offer. An empty
answer stops without fabricating a reply. Without an interactive terminal, the
host prints the question and stops unanswered. A question never becomes an
Index negotiation turn by itself.

After an acknowledged turn, the other agent runs automatically if Index is
still open. The session stops on settlement, an unanswered question, a failed
or uncertain write, an agent making no progress, the agent's step limit, or a
fixed 12-turn session ceiling. Reaching a ceiling does **not** mean agreement
or decline. There is at most one POST attempt per agent turn and no automatic
POST retry. Index continues to enforce turn order and settlement.

The terminal prints each acknowledged turn and a fresh server transcript at the
end. A model saying “done” is not evidence of submission. After a timeout, the
server may have committed the turn: inspect the fresh transcript before
restarting. The host deliberately does not continue after an uncertain write.

Private questions, answers, and model histories remain in memory only for this
process. Put lasting preferences from answers into that principal's instructions
file before restarting. Do not mix the two files. The shared turn log stays in
Index and is read afresh. This command does not create keys, reset databases,
resume discovery, or connect principal questions to DMs.

## Verification

```bash
bun run agent:negotiate --help
bunx tsc --noEmit --strict --skipLibCheck --target ES2022 \
  --module Preserve --moduleResolution bundler --types bun,node \
  scripts/agent-negotiation.ts
cd packages/agent && bun run check
```
