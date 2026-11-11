/**
 * @file Server-side internationalisation.
 *
 * The `i18n` package loads and caches the dictionaries of `locales/` (and reloads
 * them on change during development). The visitor's locale is resolved by
 * `localeMiddleware` in this order:
 *   1. the locale saved in the logged-in account (set by the auth layer on the session),
 *   2. the `lang` cookie set by the language selector,
 *   3. the browser's `Accept-Language` header.
 * Rendering goes through the shared `createTranslator` so that pages and the
 * browser client interpolate strings exactly the same way.
 *
 * Every EJS view receives `t(key, params)`, `locale`, `locales` and
 * `i18nUrl` (the address of the active dictionary, loaded by the browser client).
 */
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { I18n } from 'i18n';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  createTranslator,
  isLocale,
  negotiateLocale,
  type Dictionary,
  type Locale,
} from '../shared/i18n.js';
import { config } from './config.js';
import { SECURE_COOKIES, readCookie } from './http/cookies.js';
import { PATHS } from './paths.js';

/** Shared `i18n` instance holding the dictionaries. */
export const i18n = new I18n({
  locales: [...SUPPORTED_LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  directory: PATHS.locales,
  objectNotation: true,
  // Dictionaries are maintained by hand; never let the library write keys into them.
  updateFiles: false,
  syncFiles: false,
  // Hot-reload dictionaries only under `npm run dev` (the file watcher would keep other processes alive).
  autoReload: config.devReload,
  retryInDefaultLocale: true,
});

/**
 * Returns the dictionary of a locale.
 * @param locale - Supported locale.
 */
export function getDictionary(locale: Locale): Dictionary {
  return i18n.getCatalog(locale) as unknown as Dictionary;
}

/**
 * Builds a translate function for a locale, falling back to English.
 * @param locale - Supported locale.
 */
export function translatorFor(locale: Locale): ReturnType<typeof createTranslator> {
  return createTranslator(getDictionary(locale), getDictionary(DEFAULT_LOCALE));
}

/** Version of each dictionary, by dictionary object: a reloaded catalog (dev mode) is a new object, so it gets a new one. */
const versionCache = new WeakMap<Dictionary, string>();

/**
 * Version of a locale's dictionary: a hash of its content, which changes with any translation.
 * @param locale - Supported locale.
 */
export function dictionaryVersion(locale: Locale): string {
  const dict = getDictionary(locale);
  let version = versionCache.get(dict);
  if (version === undefined) {
    version = createHash('sha256').update(JSON.stringify(dict)).digest('base64url').slice(0, 16);
    versionCache.set(dict, version);
  }
  return version;
}

/**
 * Address of a locale's dictionary for the browser client. Pages give it rather than embedding the
 * dictionary (more than 100 KB, sent uncompressed with every page): versioned by its content, the file
 * is downloaded compressed once, then kept by the browser until a translation changes.
 * @param locale - Supported locale.
 */
export function dictionaryUrl(locale: Locale): string {
  return `/locales/${locale}.json?v=${dictionaryVersion(locale)}`;
}

/**
 * Determines the locale of a request (see file header for precedence).
 * @param req - Incoming request.
 */
export function resolveLocale(req: Request): Locale {
  const accountLocale = req.session?.locale;
  if (isLocale(accountLocale)) return accountLocale;
  const cookie = readCookie(req, LOCALE_COOKIE);
  if (isLocale(cookie)) return cookie;
  return negotiateLocale(req.headers['accept-language']);
}

/**
 * Express middleware exposing the request locale and translation helpers to
 * route handlers (`res.locals.t`) and views.
 */
export function localeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const locale = resolveLocale(req);
  i18n.setLocale(req, locale);
  res.locals.locale = locale;
  res.locals.locales = SUPPORTED_LOCALES;
  res.locals.t = translatorFor(locale);
  res.locals.i18nUrl = dictionaryUrl(locale);
  // The same URL renders different text depending on these inputs.
  res.vary('Accept-Language').vary('Cookie');
  next();
}

/**
 * Sets the language cookie on a response.
 * @param res - Response.
 * @param locale - Chosen locale.
 */
export function setLocaleCookie(res: Response, locale: Locale): void {
  res.cookie(LOCALE_COOKIE, locale, {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: res.app.get(SECURE_COOKIES) === true,
    httpOnly: false,
  });
}
