import { useContext, useState, type ReactNode } from "react";

import { OpenAgentLines } from "@/components/intents-home/openAgentLines";
import { NEW_INTENT_EXAMPLES, NEW_INTENT_PROMPT, type NewIntentFlow } from "@/components/intents-home/useNewIntentFlow";
import { MyAgentAvatar } from "@/components/workbench/agent-avatar";
import type { PrepareAnswer, RecoveryField } from "@/services/intent-prepare";

/** My line in the flow: a bubble in Home's chat, open on the new intent page. */
export function AgentSays({ children }: { children: ReactNode }) {
  const open = useContext(OpenAgentLines);
  return (
    <div className={`pl-agent-line${open ? " pl-agent-open" : ""}`}>
      <MyAgentAvatar size={open ? 36 : 22} />
      <div className="pl-agent-bubble">
        {open && <div className="pl-open-who">your agent</div>}
        {children}
      </div>
    </div>
  );
}

export function YouSaid({ children }: { children: ReactNode }) {
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
export function Recovery({ fields, feedback, onSubmit }: { fields: RecoveryField[]; feedback: string; onSubmit: (answers: PrepareAnswer[]) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [own, setOwn] = useState<Record<string, string>>({});
  // "something else" picked: its line counts toward the answer.
  const [writing, setWriting] = useState<Record<string, boolean>>({});

  const toggle = (field: RecoveryField, label: string) => {
    setPicked((current) => {
      const now = current[field.id] ?? [];
      const next = now.includes(label) ? now.filter((x) => x !== label) : field.kind === "single" ? [label] : [...now, label];
      return { ...current, [field.id]: next };
    });
    if (field.kind === "single") setWriting((current) => ({ ...current, [field.id]: false }));
  };
  const toggleOwn = (field: RecoveryField) => {
    const next = field.kind === "single" ? true : !writing[field.id];
    setWriting((current) => ({ ...current, [field.id]: next }));
    if (field.kind === "single") setPicked((current) => ({ ...current, [field.id]: [] }));
  };

  const answers = (): PrepareAnswer[] => fields.flatMap((field) => {
    const hasOptions = !!field.options?.length;
    const written = !hasOptions || writing[field.id] ? own[field.id]?.trim() ?? "" : "";
    const chosen = field.kind === "single" && written ? [] : picked[field.id] ?? [];
    const answer = [...chosen, ...(written ? [written] : [])].join(", ");
    return answer ? [{ prompt: field.label, answer }] : [];
  });

  return (
    <AgentSays>
      {feedback || "help me understand what you're looking for."}
      <div className="pl-ni-fields">
        {fields.map((field) => {
          const type = field.kind === "single" ? "radio" : "checkbox";
          const hasOptions = !!field.options?.length;
          return (
            <div key={field.id} className="pl-ni-field">
              <div className="pl-ni-label">{field.label}</div>
              {/* Answers as on Home's questions: radios for one answer, checkboxes for several; the last one is a line to write in. */}
              <div className="pl-q-options">
                {field.options?.map((option) => (
                  <label key={option.label}>
                    <input type={type} name={`ni-${field.id}`} checked={(picked[field.id] ?? []).includes(option.label)} onChange={() => toggle(field, option.label)} /> {option.label}
                  </label>
                ))}
                {hasOptions ? (
                  // "something else" is the field itself: a line on the last option, picked as you type.
                  <label className="pl-ni-else">
                    <input type={type} name={`ni-${field.id}`} checked={!!writing[field.id]} onChange={() => toggleOwn(field)} aria-label="something else" />
                    <input
                      type="text"
                      value={own[field.id] ?? ""}
                      maxLength={65_536}
                      onFocus={() => { if (field.kind === "single" && !writing[field.id]) toggleOwn(field); }}
                      onChange={(event) => {
                        const value = event.target.value;
                        setOwn((current) => ({ ...current, [field.id]: value }));
                        if (value.trim() && !writing[field.id]) toggleOwn(field);
                      }}
                      placeholder="something else"
                      aria-label={`${field.label}: something else`}
                    />
                  </label>
                ) : (
                  <input
                    type="text"
                    value={own[field.id] ?? ""}
                    maxLength={65_536}
                    onChange={(event) => setOwn((current) => ({ ...current, [field.id]: event.target.value }))}
                    placeholder={field.placeholder ?? "type your answer"}
                    aria-label={field.label}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="pl-ni-actions">
        <button type="button" className="go" onClick={() => onSubmit(answers())}>create intent</button>
      </div>
    </AgentSays>
  );
}
