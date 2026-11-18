/// <reference types="vite/client" />
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

/**
 * Interface translations.
 *
 * Keys are the English text itself, so English needs no resource file: a missing key
 * falls back to the key. Each area of the app keeps its Chinese strings in its own
 * file under `src/locales/zh-CN/`, merged here into one namespace.
 *
 * Agent-written content is not translated here; see `lib/content-translation.ts`.
 */

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zh-CN", label: "简体中文" },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export const LANGUAGE_STORAGE_KEY = "index.language";

const zhFiles = import.meta.glob<{ default: Record<string, string> }>("../locales/zh-CN/*.json", { eager: true });
const zhCN = Object.assign({}, ...Object.values(zhFiles).map((file) => file.default)) as Record<string, string>;

/** Any Chinese browser locale maps to Simplified Chinese; everything else to English. */
function normalizeLanguage(lng: string): string {
  const lower = lng.toLowerCase();
  if (lower.startsWith("zh")) return "zh-CN";
  return "en";
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { "zh-CN": { translation: zhCN } },
    fallbackLng: "en",
    supportedLngs: ["en", "zh-CN"],
    keySeparator: false,
    nsSeparator: false,
    returnEmptyString: false,
    interpolation: { escapeValue: false },
    detection: {
      order: ["querystring", "localStorage", "navigator"],
      lookupQuerystring: "lang",
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
      convertDetectedLanguage: normalizeLanguage,
    },
    react: { useSuspense: false },
  });

function syncDocumentLanguage(lng: string) {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
}
syncDocumentLanguage(i18n.resolvedLanguage ?? "en");
i18n.on("languageChanged", syncDocumentLanguage);

/** The interface language actually in use. */
export function currentLanguage(): LanguageCode {
  return i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en";
}

export default i18n;
