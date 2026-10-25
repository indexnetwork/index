import { useState } from "react";

import { OptionChip, WriteOwn } from "@/components/workbench/mac-blocks";
import { Btn } from "@/components/workbench/Workbench";
import type { PrepareAnswer, RecoveryField } from "@/services/intent-prepare";

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
      <div style={{ display: "grid", gap: 18, maxWidth: 620 }}>
        {fields.map((field) => (
          <div key={field.id}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{field.label}</div>
            {field.kind === "text" && (
              <textarea
                value={textValues[field.id] ?? ""}
                onChange={(event) => setTextValues((current) => ({ ...current, [field.id]: event.target.value }))}
                placeholder={field.placeholder ?? "type your answer…"}
                rows={2}
                maxLength={65_536}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", border: "1px solid var(--wb-control)", borderRadius: 3, fontFamily: "var(--wb-code)", fontSize: 12.5, lineHeight: 1.6 }}
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
        <div><Btn primary onClick={() => void onSubmit(buildAnswers())}>create intent</Btn></div>
      </div>
    </div>
  );
}

function AgentLine({ children, muted = false }: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    // The agent column's message: caps meta line, then a grey monospace block.
    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 620 }}>
      <div style={{ fontFamily: "var(--wb-code)", fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.08em" }}>YOUR AGENT</div>
      <div style={{ background: "var(--wb-selected)", padding: "10px 12px", fontFamily: "var(--wb-code)", fontSize: 12.5, lineHeight: 1.6, color: muted ? "var(--ink-2)" : "var(--ink)" }}>{children}</div>
    </div>
  );
}
