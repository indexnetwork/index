import { useState } from "react";
import { Loader2, Send } from "lucide-react";

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
    if (field.kind === "single") {
      const answer = singleSelected[field.id]?.trim();
      return answer ? [{ prompt: field.label, answer }] : [];
    }
    const answer = (multiSelected[field.id] ?? []).join(" — ");
    return answer ? [{ prompt: field.label, answer }] : [];
  });

  return (
    <section aria-label="Recovery form" className="mt-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Shape your signal</p>
      {feedback && <p className="mt-3 text-sm text-gray-500">{feedback}</p>}

      <div className="mt-6 space-y-8">
        {fields.map((field) => (
          <div key={field.id}>
            <h3 className="text-sm font-semibold text-[#041729]">{field.label}</h3>

            {field.kind === "text" && (
              <textarea
                value={textValues[field.id] ?? ""}
                onChange={(event) => setTextValues((current) => ({ ...current, [field.id]: event.target.value }))}
                placeholder={field.placeholder ?? "Tell me in your own words"}
                rows={2}
                maxLength={65_536}
                disabled={busy}
                className="mt-3 w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#041729] focus:ring-2 focus:ring-[#041729]/10 disabled:opacity-60"
              />
            )}

            {field.kind === "single" && field.options && (
              <div className="mt-3 grid gap-2">
                {field.options.map((option) => {
                  const checked = singleSelected[field.id] === option.label;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={checked}
                      disabled={busy}
                      onClick={() => setSingleSelected((current) => ({
                        ...current,
                        [field.id]: checked ? "" : option.label,
                      }))}
                      className={`rounded-2xl border px-4 py-3 text-left transition disabled:opacity-60 ${
                        checked
                          ? "border-[#041729] bg-[#041729] text-white"
                          : "border-gray-200 bg-white text-gray-800 hover:border-gray-400"
                      }`}
                    >
                      <span className="block text-sm font-medium">{option.label}</span>
                      {option.description && (
                        <span className={`mt-1 block text-xs ${checked ? "text-gray-200" : "text-gray-500"}`}>
                          {option.description}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {field.kind === "multi" && field.options && (
              <div className="mt-3 flex flex-wrap gap-2">
                {field.options.map((option) => {
                  const checked = (multiSelected[field.id] ?? []).includes(option.label);
                  return (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={checked}
                      disabled={busy}
                      onClick={() => toggleMulti(field.id, option.label)}
                      className={`rounded-full border px-4 py-2 text-sm transition disabled:opacity-60 ${
                        checked
                          ? "border-[#041729] bg-[#041729] text-white"
                          : "border-gray-200 bg-white text-gray-800 hover:border-gray-400"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void onSubmit(buildAnswers())}
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#041729] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0a2d4a] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Send answer
      </button>
    </section>
  );
}
