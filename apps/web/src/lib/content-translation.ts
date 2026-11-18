import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { apiUrl } from "./api";
import { getJwtToken } from "./auth-client";
import i18n, { type LanguageCode } from "./i18n";

/**
 * Translation of agent-written content (messages, briefs, questions, cards) for display.
 *
 * What is stored, and what agents write, stays in English. When the interface language
 * is not English, text shown through `useContentTranslation` is sent to `POST /api/translate`
 * and replaced on screen. Requests made in the same tick are sent together, and every
 * result is kept for the session, so the same text is only fetched once.
 */

const BATCH_MAX_TEXTS = 40;
const BATCH_MAX_CHARS = 15_000;
const SHOW_ORIGINAL_KEY = "index.showOriginal";

type Target = Exclude<LanguageCode, "en">;

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
let queue: { key: string; text: string; target: Target; resolve: (value: string) => void }[] = [];
let scheduled = false;

const cacheKey = (target: Target, text: string) => `${target}\u0000${text}`;

async function sendBatch(batch: typeof queue) {
  const target = batch[0]!.target;
  try {
    const token = await getJwtToken();
    const response = await fetch(apiUrl("/api/translate"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ target, texts: batch.map((item) => item.text) }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { translations } = (await response.json()) as { translations: string[] };
    batch.forEach((item, i) => {
      const value = typeof translations[i] === "string" ? translations[i]! : item.text;
      cache.set(item.key, value);
      item.resolve(value);
    });
  } catch {
    // Show the original rather than nothing; a later render can try again.
    batch.forEach((item) => item.resolve(item.text));
  } finally {
    batch.forEach((item) => inflight.delete(item.key));
  }
}

function flush() {
  scheduled = false;
  const pending = queue;
  queue = [];
  const byTarget = new Map<Target, typeof queue>();
  for (const item of pending) byTarget.set(item.target, [...(byTarget.get(item.target) ?? []), item]);
  for (const items of byTarget.values()) {
    let batch: typeof queue = [];
    let chars = 0;
    for (const item of items) {
      if (batch.length && (batch.length >= BATCH_MAX_TEXTS || chars + item.text.length > BATCH_MAX_CHARS)) {
        void sendBatch(batch);
        batch = [];
        chars = 0;
      }
      batch.push(item);
      chars += item.text.length;
    }
    if (batch.length) void sendBatch(batch);
  }
}

/** Translate one string, batched with everything else asked for in this tick. */
export function translateContent(text: string, target: Target): Promise<string> {
  const key = cacheKey(target, text);
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = new Promise<string>((resolve) => {
    queue.push({ key, text, target, resolve });
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  });
  inflight.set(key, promise);
  return promise;
}

/* "Show original" is one switch for the whole app, kept across reloads. */
const listeners = new Set<() => void>();
function readShowOriginal() {
  try {
    return localStorage.getItem(SHOW_ORIGINAL_KEY) === "1";
  } catch {
    return false;
  }
}
let showOriginal = readShowOriginal();
export function setShowOriginal(value: boolean) {
  showOriginal = value;
  try {
    localStorage.setItem(SHOW_ORIGINAL_KEY, value ? "1" : "0");
  } catch {
    // Private mode: keep it for this session only.
  }
  listeners.forEach((listener) => listener());
}
export function useShowOriginal(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => showOriginal,
    () => false,
  );
}

export interface ContentTranslation {
  /** What to render: the translation when there is one, otherwise the original. */
  text: string;
  /** True while the translation is being fetched. */
  pending: boolean;
  /** True when `text` is a translation. */
  translated: boolean;
  /** True when the viewer's language is not English, so a toggle makes sense. */
  active: boolean;
}

/**
 * The text to show for a piece of agent-written content in the viewer's language.
 * In English, or with "Show original" on, it returns the text unchanged.
 */
export function useContentTranslation(text: string | null | undefined): ContentTranslation {
  const { i18n: instance } = useTranslation();
  const language = (instance.resolvedLanguage ?? i18n.resolvedLanguage) === "zh-CN" ? "zh-CN" : "en";
  const original = useShowOriginal();
  const source = text ?? "";
  const target: Target | null = language === "en" || !source.trim() ? null : language;
  const key = target ? cacheKey(target, source) : null;
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!target || !key || original || cache.has(key)) return;
    let alive = true;
    void translateContent(source, target).then(() => {
      if (alive) setVersion((v) => v + 1);
    });
    return () => {
      alive = false;
    };
  }, [key, original, source, target]);

  if (!target || !key) return { text: source, pending: false, translated: false, active: false };
  if (original) return { text: source, pending: false, translated: false, active: true };
  const hit = cache.get(key);
  if (hit !== undefined) return { text: hit, pending: false, translated: hit !== source, active: true };
  return { text: source, pending: true, translated: false, active: true };
}
