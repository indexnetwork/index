import { useTranslation } from "react-i18next";

import { LANGUAGES } from "@/lib/i18n";
import { setShowOriginal, useShowOriginal } from "@/lib/content-translation";

/**
 * Interface language, applied at once (no save). In a language other than English,
 * a second switch shows agent-written text as written instead of translated.
 */
export default function LanguagePicker() {
  const { t, i18n } = useTranslation();
  const showOriginal = useShowOriginal();
  const current = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";

  return (
    <div>
      <label htmlFor="language" className="st-label">{t("language")}</label>
      <div className="st-well">
        <select id="language" value={current} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
          {LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>{lang.label}</option>
          ))}
        </select>
      </div>
      {current !== "en" && (
        <label className="st-note" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <input type="checkbox" checked={!showOriginal} onChange={(e) => setShowOriginal(!e.target.checked)} />
          {t("translate messages from agents and people")}
        </label>
      )}
    </div>
  );
}
