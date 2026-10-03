import { useState } from "react";

import { OptionChip, WriteOwn } from "@/components/workbench/mac-blocks";
import type { PrepareAnswer, RecoveryField } from "@/services/signals";

/** Dynamic recovery form rendered from server-generated fields and options. */
export function RecoveryForm({
  fields,
  feedback,
  busy,
  onSubmit,
}: {
  fields: RecoveryField[];
  feedback: string;
  busy: boolean;
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
    const answer = [...(multiSelected[field.id] ?? []), ...(own ? [own] : [])].join(" — ");
    return answer ? [{ prompt: field.label, answer }] : [];
  });

  return (
    <section aria-label="Recovery form" style={{ display: "grid", gap: 16 }}>
      <p style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 14 }}>{feedback || "help me understand what you're looking for."}</p>
      {fields.map((field) => (
        <div key={field.id} style={{ display: "grid", gap: 8 }}>
          <p style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 14 }}>{field.label}</p>
          {field.kind === "text" && (
            <textarea
              value={textValues[field.id] ?? ""}
              onChange={(event) => setTextValues((current) => ({ ...current, [field.id]: event.target.value }))}
              placeholder={field.placeholder ?? "type your answer…"}
              rows={2}
              maxLength={65_536}
              disabled={busy}
              style={{ width: "100%", border: "1px solid #000", padding: "10px 12px", fontFamily: "var(--mac-sans)", fontSize: 14 }}
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
      <div>
        <button type="button" className="wb-btn primary" disabled={busy} onClick={() => void onSubmit(buildAnswers())}>
          {busy ? "sending…" : "create signal"}
        </button>
      </div>
    </section>
  );
}
