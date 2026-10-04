import { useState } from "react";

import { OptionChip, WriteOwn } from "@/components/workbench/mac-blocks";
import { MyAgentAvatar } from "@/components/workbench/agent-avatar";
import { Btn } from "@/components/workbench/Workbench";
import type { PrepareAnswer, RecoveryField } from "@/services/signals";

/** Dynamic recovery form rendered from server-generated fields and options. */
export function RecoveryForm({
  fields,
  feedback,
  onSubmit,
}: {
  fields: RecoveryField[];
  feedback: string;
  onSubmit: (answers: PrepareAnswer[]) => Promise<void>;
}) {
  const [singleSelected, setSingleSelected] = useState<Record<string, string>>({});
  const [multiSelected, setMultiSelected] = useState<Record<string, string[]>>({});
  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState<Record<string, boolean>>({});

  const toggleMulti = (fieldId: string, label: string) => {
    setMultiSelected((current) => {
      const selected = current[fieldId] ?? [];
      return {
        ...current,
        [fieldId]: selected.includes(label)
          ? selected.filter((item) => item !== label)
          : [...selected, label],
      };
    });
  };

  const buildAnswers = (): PrepareAnswer[] => fields.flatMap((field) => {
    if (field.kind === "text") {
      const answer = textValues[field.id]?.trim();
      return answer ? [{ prompt: field.label, answer }] : [];
    }
    const own = writing[field.id] ? textValues[field.id]?.trim() : "";
    if (field.kind === "single") {
      const answer = own || singleSelected[field.id]?.trim();
      return answer ? [{ prompt: field.label, answer }] : [];
    }
    const answer = [...(multiSelected[field.id] ?? []), ...(own ? [own] : [])].join(", ");
    return answer ? [{ prompt: field.label, answer }] : [];
  });

  return (
    <div className="fade-up" style={{ display: "grid", gap: 16 }}>
      <AgentLine>{feedback || "help me understand what you're looking for."}</AgentLine>
      <div style={{ marginLeft: 42, display: "grid", gap: 18, maxWidth: 620 }}>
        {fields.map((field) => (
          <div key={field.id}>
            <div style={{ fontFamily: "var(--mac-sans)", fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{field.label}</div>
            {field.kind === "text" && (
              <textarea
                value={textValues[field.id] ?? ""}
                onChange={(event) => setTextValues((current) => ({ ...current, [field.id]: event.target.value }))}
                placeholder={field.placeholder ?? "type your answer…"}
                rows={2}
                maxLength={65_536}
                style={{ width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid #000", fontFamily: "var(--mac-sans)", fontSize: 14 }}
              />
            )}
            {(field.kind === "single" || field.kind === "multi") && field.options && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {field.options.map((option) => {
                  const checked = field.kind === "single"
                    ? !writing[field.id] && singleSelected[field.id] === option.label
                    : (multiSelected[field.id] ?? []).includes(option.label);
                  return (
                    <OptionChip
                      key={option.label}
                      label={option.label}
                      selected={checked}
                      onClick={() => {
                        if (field.kind === "single") {
                          setSingleSelected((current) => ({ ...current, [field.id]: checked ? "" : option.label }));
                          setWriting((current) => ({ ...current, [field.id]: false }));
                          setTextValues((current) => ({ ...current, [field.id]: "" }));
                        } else {
                          toggleMulti(field.id, option.label);
                        }
                      }}
                    />
                  );
                })}
                <WriteOwn
                  open={!!writing[field.id]}
                  value={textValues[field.id] ?? ""}
                  onOpen={() => {
                    if (field.kind === "single") setSingleSelected((current) => ({ ...current, [field.id]: "" }));
                    setWriting((current) => ({ ...current, [field.id]: true }));
                  }}
                  onChange={(value) => setTextValues((current) => ({ ...current, [field.id]: value }))}
                  onClose={() => setWriting((current) => ({ ...current, [field.id]: false }))}
                />
              </div>
            )}
          </div>
        ))}
        <div><Btn primary onClick={() => void onSubmit(buildAnswers())}>create signal</Btn></div>
      </div>
    </div>
  );
}

function AgentLine({ children, muted = false }: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <MyAgentAvatar size={30} style={{ marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: 6, color: "#8f8f88", fontFamily: "var(--mac-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>your agent</div>
        <div style={{ maxWidth: "92%", fontFamily: "var(--mac-sans)", fontSize: 14, fontWeight: muted ? 400 : 700, lineHeight: 1.55, color: muted ? "#2a2a2a" : "#111" }}>{children}</div>
      </div>
    </div>
  );
}
