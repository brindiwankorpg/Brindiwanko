/**
 * @file "My account" page and "forgotten password" pages.
 *
 * - `/account` (logged in): the account's details, and three forms that each
 *   ask for the current password: change the password, change the e-mail
 *   address, delete the account (its name typed again). A new password logs
 *   the account out everywhere else; a deleted account leaves the game at
 *   once, with its characters (a guild led by one of them gets a new leader).
 *   The server owner (first account) cannot delete its account.
 * - `/forgot-password`: asks a user name or an e-mail address and sends a link
 *   valid one hour. The answer is the same whether an account exists or not;
 *   requests are limited per address and per account.
 * - `/reset-password?token=…`: sets a new password from that link, then logs
 *   the account out everywhere.
 *
 * Forms are plain HTML posts protected by the CSRF token, like the login page.
 */
import { Router, type Request, type Response } from 'express';
import { DEFAULT_LOCALE, isLocale, type Locale } from '../../shared/i18n.js';
import type { ServerContext } from '../context.js';
import { addressKey } from '../http/address.js';
import { verifyCsrf } from '../http/csrf.js';
import { SlidingWindowLimiter } from '../http/rate-limit.js';
import { SESSION_COOKIE } from '../http/session.js';
import { translatorFor } from '../i18n.js';
import { DEVICE_COOKIE, DEVICE_MAX_AGE_MS } from './device.js';
import { currentAccount, requireAuth } from './middleware.js';
import { RESET_TOKEN_MS } from './service.js';

/** "Forgotten password" requests one address may make per hour. */
export const RESET_REQUESTS_PER_HOUR = 5;
/** New passwords one address may submit per hour from "forgotten password" links. */
export const RESET_ATTEMPTS_PER_HOUR = 20;

/** `Host` header naming this machine (`localhost`, `127.x.x.x`, `[::1]`, with an optional port). */
const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?$/i;

/** Tells whether a `Host` header names this machine. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOST.test(host);
}

/** Messages the account page may show after a change (`?done=`). */
const DONE_KEYS: Record<string, string> = { password: 'account.done.password', email: 'account.done.email' };
/** Messages the login page may show (`?notice=`). */
export const LOGIN_NOTICES: Record<string, string> = { reset: 'account.notice.reset', deleted: 'account.notice.deleted' };

function field(req: Request, name: string): string {
  const value: unknown = (req.body as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : '';
}

/**
 * Creates the router of the account pages.
 * @param ctx - Server context.
 */
export function accountRouter(ctx: ServerContext): Router {
  const router = Router();
  const secure = ctx.config.production;
  const resetRequests = new SlidingWindowLimiter(RESET_REQUESTS_PER_HOUR, 60 * 60 * 1000);
  const resetAttempts = new SlidingWindowLimiter(RESET_ATTEMPTS_PER_HOUR, 60 * 60 * 1000);
  const setDeviceCookie = (res: Response, token: string) => res.cookie(DEVICE_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: DEVICE_MAX_AGE_MS, path: '/' });

  // --- My account ------------------------------------------------------------------

  const renderAccount = (res: Response, status: number, error: { form: string; key: string; params?: Record<string, string | number> } | null, doneKey: string | null = null) => {
    const account = ctx.accounts.findById(currentAccount(res)!.id)!;
    res.status(status).render('account', {
      details: { username: account.username, email: account.email, role: account.role, createdAt: account.createdAt, lastLogin: account.lastLogin },
      isOwner: account.id === ctx.accounts.ownerId(),
      error,
      doneKey,
    });
  };

  router.get('/account', requireAuth, (req, res) => {
    const done = typeof req.query.done === 'string' ? DONE_KEYS[req.query.done] ?? null : null;
    renderAccount(res, 200, null, done);
  });

  router.post('/account/password', requireAuth, verifyCsrf, async (req, res) => {
    const id = currentAccount(res)!.id;
    const result = await ctx.auth.changePassword(id, field(req, 'current'), field(req, 'password'), field(req, 'passwordConfirm'));
    if (!result.ok) {
      renderAccount(res, result.errorKey === 'error.auth.too_many_attempts' ? 429 : 400, { form: 'password', key: result.errorKey, params: result.params });
      return;
    }
    // Whoever knew the old password is logged out everywhere else (other browsers, the game).
    ctx.sessionStore.destroyAccountSessions(id, req.sessionID);
    ctx.world.kickAccount(id, 'error.account.password_changed');
    setDeviceCookie(res, result.deviceToken);
    // A new session id too, as after a login.
    req.session.regenerate((err) => {
      if (err) {
        res.status(500).render('error', { code: 500, messageKey: 'error.http.server' });
        return;
      }
      req.session.accountId = id;
      req.session.locale = result.account.locale;
      req.session.save(() => res.redirect(303, '/account?done=password'));
    });
  });

  router.post('/account/email', requireAuth, verifyCsrf, async (req, res) => {
    const result = await ctx.auth.changeEmail(currentAccount(res)!.id, field(req, 'current'), field(req, 'email'));
    if (!result.ok) {
      renderAccount(res, result.errorKey === 'error.auth.too_many_attempts' ? 429 : 400, { form: 'email', key: result.errorKey, params: result.params });
      return;
    }
    res.redirect(303, '/account?done=email');
  });

  router.post('/account/delete', requireAuth, verifyCsrf, async (req, res) => {
    const id = currentAccount(res)!.id;
    const result = await ctx.auth.checkDeletion(id, field(req, 'current'), field(req, 'confirmName'));
    if (!result.ok) {
      renderAccount(res, result.errorKey === 'error.auth.too_many_attempts' ? 429 : 400, { form: 'delete', key: result.errorKey, params: result.params });
      return;
    }
    deleteAccount(ctx, id);
    console.log(`[brindiwanko] account "${result.account.username}" (#${id}) deleted by its owner`);
    req.session.destroy(() => {
      res.clearCookie(SESSION_COOKIE);
      res.clearCookie(DEVICE_COOKIE, { path: '/' });
      res.redirect(303, '/login?notice=deleted');
    });
  });

  // --- Forgotten password ------------------------------------------------------------

  /**
   * Address of the game used in the links: the public one. Without `PUBLIC_URL`, only a development server
   * reached on this machine may use the address of the request: the `Host` header is chosen by the client,
   * and a link built from it would send the secret token to whatever site the requester named.
   */
  const baseUrl = (req: Request): string | null => {
    if (ctx.config.publicUrl) return ctx.config.publicUrl;
    const host = req.get('host') ?? '';
    return !ctx.config.production && isLoopbackHost(host) ? `${req.protocol}://${host}` : null;
  };
  const available = (req: Request) => ctx.mailer.enabled && baseUrl(req) !== null;

  router.get('/forgot-password', (req, res) => {
    res.render('auth/forgot', { available: available(req), sent: false, errorKey: null, errorParams: {}, values: {} });
  });

  router.post('/forgot-password', verifyCsrf, (req, res) => {
    const identifier = field(req, 'identifier').trim().slice(0, 254);
    const address = addressKey(req.ip ?? 'unknown');
    const wait = resetRequests.retryAfter(address);
    if (wait > 0) {
      res.status(429).render('auth/forgot', { available: available(req), sent: false, errorKey: 'error.account.too_many_resets', errorParams: { minutes: Math.ceil(wait / 60_000) }, values: { identifier } });
      return;
    }
    const base = baseUrl(req);
    if (!ctx.mailer.enabled || base === null) {
      res.status(503).render('auth/forgot', { available: false, sent: false, errorKey: null, errorParams: {}, values: {} });
      return;
    }
    resetRequests.record(address);
    const reset = ctx.auth.createPasswordReset(identifier);
    if (reset) {
      const locale: Locale = isLocale(reset.account.locale) ? reset.account.locale : (res.locals.locale ?? DEFAULT_LOCALE);
      const t = translatorFor(locale);
      const game = ctx.settings.get('gameTitle', 'Brindiwanko');
      const link = `${base}/reset-password?token=${reset.token}`;
      // Sent in the background: the answer comes as fast whether an account exists or not.
      void ctx.mailer
        .send({
          to: reset.account.email,
          subject: t('account.reset_mail.subject', { game }),
          text: t('account.reset_mail.body', { name: reset.account.username, game, link, minutes: RESET_TOKEN_MS / 60_000 }),
        })
        .catch((err: unknown) => console.error('[brindiwanko] the "forgotten password" e-mail could not be sent', err));
    }
    res.render('auth/forgot', { available: true, sent: true, errorKey: null, errorParams: {}, values: {} });
  });

  const tokenOf = (req: Request) => (typeof req.query.token === 'string' ? req.query.token : field(req, 'token')).slice(0, 100);

  router.get('/reset-password', (req, res) => {
    const token = tokenOf(req);
    res.render('auth/reset', { token, valid: ctx.auth.passwordResetAccount(token) !== undefined, errorKey: null, errorParams: {} });
  });

  router.post('/reset-password', verifyCsrf, async (req, res) => {
    const token = tokenOf(req);
    // Each try may hash a password: one client cannot keep the hashing threads busy.
    const address = addressKey(req.ip ?? 'unknown');
    const wait = resetAttempts.retryAfter(address);
    if (wait > 0) {
      res.status(429).render('auth/reset', { token, valid: true, errorKey: 'error.account.too_many_resets', errorParams: { minutes: Math.ceil(wait / 60_000) } });
      return;
    }
    resetAttempts.record(address);
    const result = await ctx.auth.resetPassword(token, field(req, 'password'), field(req, 'passwordConfirm'));
    if (!result.ok) {
      const valid = result.errorKey !== 'error.account.reset_invalid';
      res.status(400).render('auth/reset', { token, valid, errorKey: result.errorKey, errorParams: {} });
      return;
    }
    // Logged out everywhere: whoever had the account (the reason for the reset, maybe) is out.
    ctx.sessionStore.destroyAccountSessions(result.account.id);
    ctx.world.kickAccount(result.account.id, 'error.account.password_changed');
    ctx.editLocks.releaseAll(result.account.id);
    res.redirect(303, '/login?notice=reset');
  });

  return router;
}

/**
 * Deletes an account for good: it leaves the game, its characters leave their
 * guilds (a new leader is chosen), and the account goes with its characters and
 * sessions. The logs keep its number, without its IP addresses.
 */
export function deleteAccount(ctx: ServerContext, accountId: number): void {
  ctx.world.kickAccount(accountId, 'error.account.deleted');
  ctx.editLocks.releaseAll(accountId);
  for (const c of ctx.characters.listByAccount(accountId)) ctx.world.guilds.characterDeleted(c.id, c.name);
  ctx.sessionStore.destroyAccountSessions(accountId);
  ctx.accounts.delete(accountId);
  // The logs keep the account's number for the moderators, but not where it connected from.
  ctx.admin.forgetAddresses(accountId);
}
