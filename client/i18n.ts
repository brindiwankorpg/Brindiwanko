/**
 * @file Browser-side translations.
 *
 * Pages give the address of the active dictionary in `<script id="i18n-data">`
 * (a file versioned by its content, kept by the browser, and preloaded by the
 * page). This module loads it before any module that imports it runs (top-level
 * `await`), so `t()` works synchronously from the first line of client code. The
 * English dictionary is fetched lazily as a fallback only if a key is missing.
 * `setLocale()` switches language at runtime: it asks the server to remember the
 * choice (cookie + account) and loads the new dictionary.
 *
 * Every interface string of the client must go through `t()`.
 */
import {
  DEFAULT_LOCALE,
  createTranslator,
  isLocale,
  type Dictionary,
  type Locale,
  type TranslationKey,
  type TranslationParams,
} from '../shared/i18n.js';

let currentLocale: Locale = DEFAULT_LOCALE;
let dictionary: Dictionary = {};
let translate = createTranslator(dictionary);
const listeners = new Set<(locale: Locale) => void>();

/** Downloads a dictionary file, trying once more after a network hiccup. */
async function download(url: string): Promise<Dictionary> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as Dictionary;
    } catch (err) {
      if (attempt >= 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/** Loads the dictionary the page names (or, on a page that embeds it, reads it). */
async function loadPageDictionary(): Promise<void> {
  const el = typeof document === 'undefined' ? null : document.getElementById('i18n-data');
  if (!el) return;
  const locale = el.dataset.locale;
  if (isLocale(locale)) currentLocale = locale;
  try {
    dictionary = el.dataset.src ? await download(el.dataset.src) : (JSON.parse(el.textContent || '{}') as Dictionary);
  } catch (err) {
    // The interface then shows its keys rather than nothing at all.
    console.error('[i18n] the dictionary could not be loaded', err);
    dictionary = {};
  }
  translate = createTranslator(dictionary);
}
// Every module that translates waits for the dictionary (it is preloaded by the page, so this is short).
await loadPageDictionary();

/**
 * Translates an interface key.
 * @param key - Dotted translation key (type-checked against `locales/en.json`).
 * @param params - Values for `{{name}}` placeholders.
 * @returns The translated string, or the key itself when missing.
 */
export function t(key: TranslationKey, params?: TranslationParams): string {
  return translate(key, withTerms(params));
}

/** A term of the game (System terms): HP, MP, level, experience. */
export type GameTerm = 'hp' | 'mp' | 'level' | 'xp';

/** Names the game creator gave to the terms, once in game. */
const gameTerms: Partial<Record<GameTerm, string>> = {};

/** Interface words used while the game gives none (pages outside the game, empty terms). */
const TERM_FALLBACK: Record<GameTerm, TranslationKey> = { hp: 'hud.hp', mp: 'hud.mp', level: 'hud.level_term', xp: 'hud.xp' };

/** Sets the terms of the game (sent on entering the world). */
export function setGameTerms(terms: Partial<Record<GameTerm, string>>): void {
  for (const kind of Object.keys(TERM_FALLBACK) as GameTerm[]) gameTerms[kind] = terms[kind]?.trim() || undefined;
}

/** Name of a term shown to the players: the game's own, else the interface translation. */
export function gameTerm(kind: GameTerm): string {
  return gameTerms[kind] ?? translate(TERM_FALLBACK[kind]);
}

/**
 * Every text may name the terms of the game: `{{hpTerm}}`, `{{mpTerm}}`, `{{levelTerm}}`, `{{xpTerm}}`
 * (parameters given by the caller win).
 */
function withTerms(params?: TranslationParams): TranslationParams {
  return { hpTerm: gameTerm('hp'), mpTerm: gameTerm('mp'), levelTerm: gameTerm('level'), xpTerm: gameTerm('xp'), ...params };
}

/**
 * Translates a key that is only known at runtime (e.g. an error key sent by the server).
 * Unknown keys are returned unchanged.
 * @param key - Untrusted key string.
 * @param params - Placeholder values.
 */
export function tDynamic(key: string, params?: TranslationParams): string {
  // The server states the end of a ban or mute in UTC: the player reads it in their own time zone.
  const until = params?.until;
  if (typeof until === 'string' && SERVER_TIME.test(until)) return translate(key as TranslationKey, withTerms({ ...params, until: formatServerTime(until, 'short') })).replace(/ \(UTC\)/g, '');
  return translate(key as TranslationKey, withTerms(params));
}

const SERVER_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;

/**
 * Language tag of dates and times: the visitor's own regional variant of the
 * interface language when the browser lists one (en-GB, en-US, fr-CA...), so
 * each reader gets the day order and the 12- or 24-hour clock of their
 * country; otherwise the interface language itself.
 */
function dateLocale(): string {
  const preferred = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  return preferred.find((tag) => typeof tag === 'string' && tag.toLowerCase().split('-')[0] === currentLocale) ?? currentLocale;
}

/** Hour and minutes in the visitor's format: `09:05` on a 24-hour clock, `9:05 AM` on a 12-hour one. */
function clockText(date: Date): string {
  const locale = dateLocale();
  const twelveHour = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12 === true;
  return date.toLocaleTimeString(locale, { hour: twelveHour ? 'numeric' : '2-digit', minute: '2-digit' });
}

/**
 * Formats a database timestamp (`YYYY-MM-DD HH:MM:SS`, stored in UTC) in the
 * viewer's time zone and regional format, like the chat clock. Anything else
 * is returned unchanged.
 * @param value - Timestamp from the server.
 * @param style - `date`: day only; `short`: day and minutes; `full`: day and seconds.
 */
export function formatServerTime(value: string, style: 'date' | 'short' | 'full' = 'short'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const [y, mo, d, h, mi, se] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  const locale = dateLocale();
  // "medium": the month in letters and the year in full ("7 nov. 2026", "Nov 7, 2026"), never "11/7/26",
  // which a reader cannot tell from the 11th of July.
  return style === 'date' ? date.toLocaleDateString(locale, { dateStyle: 'medium' }) : date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: style === 'full' ? 'medium' : 'short' });
}

/**
 * Time of day of a moment (chat messages), in the visitor's time zone and format.
 * @param date - Moment to show.
 */
export function formatClock(date: Date): string {
  return clockText(date);
}

/**
 * An hour of the day on the hour (`04:00`, or `4:00 AM`), in the visitor's format.
 * @param hour - Hour, 0 to 23.
 */
export function formatHour(hour: number): string {
  return clockText(new Date(2000, 0, 1, hour));
}

/** Returns the active locale. */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Registers a callback run after every language change (to re-render windows).
 * @returns A function that unregisters the callback.
 */
export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function fetchDictionary(locale: Locale): Promise<Dictionary> {
  const response = await fetch(`/locales/${locale}.json`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Cannot load dictionary "${locale}" (${response.status})`);
  return (await response.json()) as Dictionary;
}

/**
 * Switches the interface language without reloading the page.
 * @param locale - New locale.
 */
export async function setLocale(locale: Locale): Promise<void> {
  const [dict, fallback] = await Promise.all([
    fetchDictionary(locale),
    locale === DEFAULT_LOCALE ? Promise.resolve(undefined) : fetchDictionary(DEFAULT_LOCALE),
  ]);
  // Persist the choice server-side (cookie, and account when logged in).
  await fetch(`/lang/${locale}?next=/healthz`, { credentials: 'same-origin', redirect: 'manual' });
  currentLocale = locale;
  dictionary = dict;
  translate = createTranslator(dict, fallback);
  document.documentElement.lang = locale;
  for (const listener of listeners) listener(locale);
}
