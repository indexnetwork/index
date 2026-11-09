import { useState, type ReactNode } from "react";

import { NEW_INTENT_EXAMPLES, NEW_INTENT_PROMPT, type NewIntentFlow } from "@/components/intents-home/useNewIntentFlow";
import { MyAgentAvatar } from "@/components/workbench/agent-avatar";
import type { PrepareAnswer, RecoveryField } from "@/services/intent-prepare";

function AgentSays({ children }: { children: ReactNode }) {
  return (
    <div className="pl-agent-line">
      <MyAgentAvatar size={22} />
      <div className="pl-agent-bubble">{children}</div>
    </div>
  );
}

function YouSaid({ children }: { children: ReactNode }) {
  return (
    <div className="pl-agent-line mine">
      <div className="pl-agent-bubble mine">{children}</div>
    </div>
  );
}

/**
 * The new intent flow drawn as chat lines in the agent panel. The opening
 * answer comes from the panel's own composer; follow-up questions and the
 * final wording are answered here.
 */
export default function NewIntentSteps({ flow }: { flow: NewIntentFlow }) {
  return (
    <div className="pl-ni" aria-label="new intent">
      <div className="pl-ni-head">
        <span>NEW INTENT</span>
        <button type="button" className="pl-ni-cancel" onClick={flow.cancel} disabled={flow.stage === "creating"}>cancel</button>
      </div>
      {flow.turns.map((turn) => (
        <div key={turn.id} className="pl-ni-turn">
          <AgentSays>{turn.prompt}</AgentSays>
          <YouSaid>{turn.answer}</YouSaid>
        </div>
      ))}

      {flow.stage === "opening" ? (
        <>
          <AgentSays>{NEW_INTENT_PROMPT} write it below, or start from one of these.</AgentSays>
          <div className="pl-agent-suggest">
            {NEW_INTENT_EXAMPLES.map((text) => (
              <button key={text} type="button" onClick={() => flow.submitOpening(text)}>{text}</button>
            ))}
          </div>
        </>
      ) : flow.stage === "thinking" ? (
        <AgentSays><span className="pl-dim">reading that<span className="pl-blink">_</span></span></AgentSays>
      ) : flow.stage === "creating" ? (
        <AgentSays><span className="pl-dim">setting it up<span className="pl-blink">_</span></span></AgentSays>
      ) : flow.stage === "retry" ? (
        <AgentSays>
          couldn&apos;t reach your agent.
          <div className="pl-ni-actions"><button type="button" className="go" onClick={flow.retry}>try again</button></div>
        </AgentSays>
      ) : flow.stage === "recovery" ? (
        <Recovery fields={flow.fields} feedback={flow.feedback} onSubmit={flow.submitRecovery} />
      ) : (
        <AgentSays>
          {flow.receipt ? "here's your intent. change anything you like, then create it." : flow.feedback || "here's your intent."}
          <textarea
            className="pl-ni-text"
            aria-label="Intent description"
            value={flow.payload}
            rows={4}
            maxLength={65_536}
            onChange={(event) => flow.setPayload(event.target.value)}
          />
          <div className="pl-ni-actions">
            {flow.receipt ? (
              <button type="button" className="go" disabled={!flow.payload.trim()} onClick={flow.create}>create this intent</button>
            ) : (
              <button type="button" className="go" disabled={!flow.payload.trim()} onClick={flow.recheck}>check intent</button>
            )}
          </div>
        </AgentSays>
      )}
    </div>
  );
}

/** The server's follow-up questions: pick options or write your own, then send them. */
function Recovery({ fields, feedback, onSubmit }: { fields: RecoveryField[]; feedback: string; onSubmit: (answers: PrepareAnswer[]) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [own, setOwn] = useState<Record<string, string>>({});

  const toggle = (field: RecoveryField, label: string) => setPicked((current) => {
    const now = current[field.id] ?? [];
    const next = now.includes(label) ? now.filter((x) => x !== label) : field.kind === "single" ? [label] : [...now, label];
    return { ...current, [field.id]: next };
  });

  const answers = (): PrepareAnswer[] => fields.flatMap((field) => {
    const written = own[field.id]?.trim() ?? "";
    const chosen = field.kind === "single" && written ? [] : picked[field.id] ?? [];
    const answer = [...chosen, ...(written ? [written] : [])].join(", ");
    return answer ? [{ prompt: field.label, answer }] : [];
  });

  return (
    <AgentSays>
      {feedback || "help me understand what you're looking for."}
      <div className="pl-ni-fields">
        {fields.map((field) => (
          <div key={field.id} className="pl-ni-field">
            <div className="pl-ni-label">{field.label}</div>
            {field.options?.length ? (
              <div className="pl-agent-suggest">
                {field.options.map((option) => {
                  const on = (picked[field.id] ?? []).includes(option.label) && !(field.kind === "single" && own[field.id]?.trim());
                  return (
                    <button key={option.label} type="button" className={on ? "on" : undefined} aria-pressed={on} onClick={() => toggle(field, option.label)}>
                      {on ? "✓ " : ""}{option.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <input
              className="pl-ni-own"
              value={own[field.id] ?? ""}
              maxLength={65_536}
              onChange={(event) => setOwn((current) => ({ ...current, [field.id]: event.target.value }))}
              placeholder={field.kind === "text" ? field.placeholder ?? "type your answer…" : "or write your own…"}
            />
          </div>
        ))}
      </div>
      <div className="pl-ni-actions">
        <button type="button" className="go" onClick={() => onSubmit(answers())}>create intent</button>
      </div>
    </AgentSays>
  );
}
