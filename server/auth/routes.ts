/**
 * @file Registration, login and logout pages.
 *
 * Forms are plain HTML posts (they work without JavaScript). On success the
 * session id is regenerated before storing the account id, which prevents
 * session fixation, and the browser receives the account's device cookie
 * (see `device.ts`). Errors re-render the form with a translation key and the
 * previously typed values (never the password). The number of accounts one
 * address may create per hour is limited (`REGISTRATIONS_PER_HOUR`), and so is
 * the number of "name taken" / "address taken" answers (they would otherwise
 * tell anyone which e-mail addresses have an account). IPv6 clients are counted
 * by their /64 block.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { DEFAULT_LOCALE, isLocale, type Locale } from '../../shared/i18n.js';
import type { ServerContext } from '../context.js';
import type { Account } from '../db/accounts.js';
import { readCookie, safeRedirectPath } from '../http/cookies.js';
import { addressKey } from '../http/address.js';
import { CSRF_COOKIE, verifyCsrf } from '../http/csrf.js';
import { SlidingWindowLimiter } from '../http/rate-limit.js';
import { SESSION_COOKIE } from '../http/session.js';
import { setLocaleCookie } from '../i18n.js';
import { DEVICE_COOKIE, DEVICE_MAX_AGE_MS } from './device.js';
import { LOGIN_NOTICES } from './account-routes.js';
import { currentAccount } from './middleware.js';

/** Where players land after logging in. */
export const AFTER_LOGIN_PATH = '/characters';

/** "Name taken" / "address taken" answers one address may receive per hour. */
export const TAKEN_ANSWERS_PER_HOUR = 20;

function field(req: Request, name: string): string {
  const value: unknown = (req.body as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : '';
}

/**
 * Opens an authenticated session for an account (with a fresh session id).
 * @param deviceToken - Device cookie of the account for this browser.
 * @param secure - Cookies only over HTTPS (production).
 */
function startSession(req: Request, res: Response, account: Account, next: string, deviceToken: string, secure: boolean): void {
  req.session.regenerate((err) => {
    if (err) {
      res.status(500).render('error', { code: 500, messageKey: 'error.http.server' });
      return;
    }
    req.session.accountId = account.id;
    req.session.locale = account.locale;
    if (isLocale(account.locale)) setLocaleCookie(res, account.locale);
    res.cookie(DEVICE_COOKIE, deviceToken, { httpOnly: true, sameSite: 'lax', secure, maxAge: DEVICE_MAX_AGE_MS, path: '/' });
    // The anonymous form token is not needed any more: the session has its own.
    res.clearCookie(CSRF_COOKIE, { path: '/' });
    req.session.save(() => res.redirect(303, next));
  });
}

/**
 * Creates the router of authentication pages.
 * @param ctx - Server context.
 */
export function authRouter(ctx: ServerContext): Router {
  const router = Router();
  const secure = ctx.config.production;
  // In production the cookies are `Secure`: over plain HTTP (a proxy not trusted, or none) the session
  // cookie would never be stored and the visitor would loop on the login page, after the setup code
  // was already spent. Refuse with a clear message before anything is created.
  const requireHttps = (req: Request, res: Response, next: NextFunction): void => {
    if (secure && !req.secure) {
      res.status(400).render('error', { code: 400, messageKey: 'error.http.insecure' });
      return;
    }
    next();
  };
  // Wrong setup codes (needed for the first account only) are limited too, whatever their length.
  const setupFailures = new SlidingWindowLimiter(10, 15 * 60 * 1000);
  const registrations = new SlidingWindowLimiter(ctx.config.registrationsPerHour, 60 * 60 * 1000);
  // "Name taken" and "address taken" answers tell whether an account exists: without a limit, the form
  // would let anyone test a list of e-mail addresses. A person choosing a name rarely needs more than a few.
  const takenAnswers = new SlidingWindowLimiter(TAKEN_ANSWERS_PER_HOUR, 60 * 60 * 1000);
  /** Addresses with a registration being processed. */
  const registering = new Set<string>();
  const renderRegister = (res: Response, status: number, errorKey: string | null, values: Record<string, string>, errorParams: Record<string, string | number> = {}) =>
    res.status(status).render('auth/register', { errorKey, errorParams, values, isFirstAccount: ctx.accounts.count() === 0, needsSetupCode: ctx.auth.needsSetupCode() });

  router.get('/login', (req, res) => {
    if (currentAccount(res)) {
      res.redirect(303, AFTER_LOGIN_PATH);
      return;
    }
    const noticeKey = typeof req.query.notice === 'string' ? (LOGIN_NOTICES[req.query.notice] ?? null) : null;
    res.render('auth/login', { errorKey: null, errorParams: {}, values: {}, next: safeRedirectPath(req.query.next, ''), noticeKey });
  });

  router.post('/login', requireHttps, verifyCsrf, async (req, res) => {
    const username = field(req, 'username');
    const next = safeRedirectPath(field(req, 'next'), AFTER_LOGIN_PATH);
    const result = await ctx.auth.login(username, field(req, 'password'), req.ip ?? 'unknown', readCookie(req, DEVICE_COOKIE));
    if (!result.ok) {
      res.status(result.errorKey === 'error.auth.too_many_attempts' ? 429 : 401).render('auth/login', {
        errorKey: result.errorKey,
        errorParams: result.params ?? {},
        values: { username },
        next,
        noticeKey: null,
      });
      return;
    }
    startSession(req, res, result.account, next, result.deviceToken, secure);
  });

  router.get('/register', (_req, res) => {
    if (currentAccount(res)) {
      res.redirect(303, AFTER_LOGIN_PATH);
      return;
    }
    renderRegister(res, 200, null, {});
  });

  router.post('/register', requireHttps, verifyCsrf, async (req, res) => {
    const values = { username: field(req, 'username'), email: field(req, 'email') };
    // An IPv6 client is counted by its /64 block (see `address.ts`).
    const address = addressKey(req.ip ?? 'unknown');
    const created = registrations.retryAfter(address);
    const failed = Math.max(setupFailures.retryAfter(address), takenAnswers.retryAfter(address));
    // One registration at a time per address: parallel requests would all pass the limits above before
    // the first one (hashing its password) is recorded.
    if (created > 0 || failed > 0 || registering.has(address)) {
      const key = created >= failed ? 'error.auth.too_many_registrations' : 'error.auth.too_many_register_attempts';
      renderRegister(res, 429, key, values, { minutes: Math.max(1, Math.ceil(Math.max(created, failed) / 60_000)) });
      return;
    }
    const locale = res.locals.locale ?? DEFAULT_LOCALE;
    registering.add(address);
    let result: Awaited<ReturnType<typeof ctx.auth.register>>;
    try {
      result = await ctx.auth.register(
        { ...values, password: field(req, 'password'), passwordConfirm: field(req, 'passwordConfirm') },
        locale,
        field(req, 'setupCode'),
      );
    } finally {
      registering.delete(address);
    }
    if (!result.ok) {
      if (result.errorKey === 'error.auth.setup_code') setupFailures.record(address);
      if (result.errorKey === 'error.auth.username_taken' || result.errorKey === 'error.auth.email_taken') takenAnswers.record(address);
      renderRegister(res, 400, result.errorKey, values);
      return;
    }
    registrations.record(address);
    if (result.account.role === 'admin') console.log(`[brindiwanko] first account "${result.account.username}" registered as admin`);
    startSession(req, res, result.account, AFTER_LOGIN_PATH, result.deviceToken, secure);
  });

  router.post('/logout', verifyCsrf, (req, res) => {
    // Logging out also closes the game connection and the editor locks of the account (other tabs included).
    const account = currentAccount(res);
    if (account) {
      ctx.world.kickAccount(account.id, 'error.auth.not_authenticated');
      ctx.editLocks.releaseAll(account.id);
    }
    req.session.destroy(() => {
      res.clearCookie(SESSION_COOKIE);
      res.redirect(303, '/');
    });
  });

  return router;
}
