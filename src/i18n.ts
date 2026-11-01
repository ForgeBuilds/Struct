import { useMemo, useSyncExternalStore } from "react";
import { GENERATED_TRANSLATIONS } from "./generatedTranslations";

export type LocaleCode = "en" | "hi" | "zh" | "es" | "fr" | "de" | "ja" | "ko" | "pt" | "ru";

let activeLanguage = "English";
const languageListeners = new Set<() => void>();
const languageChannel =
  typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("neo.ui-language");

function notifyLanguageChange(language: string): void {
  if (activeLanguage === language) {
    applyLanguageMetadata(language);
    return;
  }
  activeLanguage = language;
  applyLanguageMetadata(language);
  languageListeners.forEach((listener) => listener());
}

function applyLanguageMetadata(language: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = getLanguageLocale(language);
  document.documentElement.dir = "ltr";
}

languageChannel?.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (typeof event.data === "string") notifyLanguageChange(event.data);
});

export function setActiveLanguage(language: string | null | undefined): void {
  const nextLanguage = language ?? "English";
  if (activeLanguage === nextLanguage) return;
  notifyLanguageChange(nextLanguage);
  languageChannel?.postMessage(nextLanguage);
}

export function getActiveLanguage(): string {
  return activeLanguage;
}

function subscribeToLanguage(listener: () => void): () => void {
  languageListeners.add(listener);
  return () => languageListeners.delete(listener);
}

const noopSubscribe = () => () => {};

import locale_en from "./locales/en.json";
import locale_hi from "./locales/hi.json";
import locale_zh from "./locales/zh.json";
import locale_es from "./locales/es.json";
import locale_fr from "./locales/fr.json";
import locale_de from "./locales/de.json";
import locale_ja from "./locales/ja.json";
import locale_ko from "./locales/ko.json";
import locale_pt from "./locales/pt.json";
import locale_ru from "./locales/ru.json";

/** Reviewed locale resources; generated translations fill missing keys. */
export const UI_TRANSLATIONS: Record<LocaleCode, Record<string, string>> = {
  en: locale_en,
  hi: locale_hi,
  zh: locale_zh,
  es: locale_es,
  fr: locale_fr,
  de: locale_de,
  ja: locale_ja,
  ko: locale_ko,
  pt: locale_pt,
  ru: locale_ru,
 };

export function getLanguageLocale(language?: string | null): LocaleCode {
  switch (language) {
    case "हिंदी":
      return "hi";
    case "中文":
      return "zh";
    case "Español":
      return "es";
    case "Français":
      return "fr";
    case "Deutsch":
      return "de";
    case "日本語":
      return "ja";
    case "한국어":
      return "ko";
    case "Português":
      return "pt";
    case "Русский":
      return "ru";
    case "English":
    default:
      return "en";
  }
}

export function translate(key: string, language?: string | null, vars?: Record<string, string | number>): string {
  const locale = getLanguageLocale(language);
  const value =
    UI_TRANSLATIONS[locale][key] ??
    GENERATED_TRANSLATIONS[locale]?.[key] ??
    UI_TRANSLATIONS.en[key] ??
    key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export function useTranslation(enabled = true) {
  const language = useSyncExternalStore(
    enabled ? subscribeToLanguage : noopSubscribe,
    enabled ? getActiveLanguage : () => "English",
    () => "English"
  );
  return useMemo(
    () => ({
      language,
      locale: getLanguageLocale(language),
      t: (key: string, vars?: Record<string, string | number>) => translate(key, language, vars),
    }),
    [language]
  );
}
