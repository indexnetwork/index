import { useTranslation } from "react-i18next";

import { setShowOriginal, useShowOriginal, type ContentTranslation } from "@/lib/content-translation";

/**
 * A small "translated · show original" note under translated content. Renders nothing
 * in English. The switch is global: it flips every translated text in the app.
 */
export default function TranslatedMark({ state, className }: { state: ContentTranslation; className?: string }) {
  const { t } = useTranslation();
  const showOriginal = useShowOriginal();
  if (!state.active) return null;
  if (!state.translated && !showOriginal) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={() => setShowOriginal(!showOriginal)}
      style={{ background: "none", border: 0, padding: 0, font: "inherit", fontSize: 11, color: "var(--wb-muted, #8a8578)", cursor: "pointer" }}
    >
      {showOriginal ? t("show translation") : `${t("translated")} · ${t("show original")}`}
    </button>
  );
}
