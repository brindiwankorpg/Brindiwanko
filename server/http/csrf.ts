/**
 * @file Anti-CSRF protection for HTML forms (synchronizer token pattern).
 *
 * Each logged-in session holds a random token; views embed it in a hidden
 * `_csrf` field and every state-changing form POST must send it back.
 * Visitors who are not logged in (login and registration forms) get their
 * token in a cookie of their own instead, checked against the form field
 * ("double submit"): showing these forms then stores nothing on the server,
 * so a flood of anonymous visits cannot fill the session table.
 * `SameSite=Lax` cookies already block most cross-site posts; the token covers
 * older browsers and same-site subdomain attacks.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { SECURE_COOKIES, readCookie } from './cookies.js';
import './session-data.js';

/** Cookie holding the signed token of visitors who are not logged in (plain HTTP / dev). */
export const CSRF_COOKIE = 'brindiwanko.csrf';
/** Host-locked cookie name used over HTTPS (production) to prevent subdomain cookie-tossing. */
export const HOST_CSRF_COOKIE = '__Host-brindiwanko.csrf';
/** Express app setting key holding the HMAC secret for anonymous CSRF cookies. */
export const CSRF_SECRET = 'csrfSecret';

/** Fallback secret if an Express app is created without setting `CSRF_SECRET`. */
const FALLBACK_SECRET = randomBytes(32).toString('base64url');

/** Shape of a session token (24 random bytes in base64url). */
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
/** Shape of a signed anonymous token (`<32-char nonce>.<43-char HMAC-SHA256>`). */
const SIGNED_TOKEN = /^([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/;
const newToken = (): string => randomBytes(24).toString('base64url');

/** Tells whether the request belongs to a logged-in session. */
const loggedIn = (req: Request): boolean => req.session?.accountId !== undefined;

/** Cookie name for anonymous CSRF tokens (`__Host-` over HTTPS). */
export function csrfCookieName(req: Request): string {
  return req.app.get(SECURE_COOKIES) === true ? HOST_CSRF_COOKIE : CSRF_COOKIE;
}

function csrfSecret(req: Request): string {
  const configured = req.app.get(CSRF_SECRET);
  return typeof configured === 'string' && configured.length > 0 ? configured : FALLBACK_SECRET;
}

function signAnonymous(nonce: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(nonce).digest('base64url');
  return `${nonce}.${sig}`;
}

function isValidAnonymous(token: string | undefined, secret: string): token is string {
  if (!token) return false;
  const match = SIGNED_TOKEN.exec(token);
  if (!match) return false;
  const expected = createHmac('sha256', secret).update(match[1]!).digest('base64url');
  const got = match[2]!;
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** Clears the anonymous CSRF cookie once an authenticated session takes over. */
export function clearAnonymousCsrfCookie(req: Request, res: Response): void {
  const secure = req.app.get(SECURE_COOKIES) === true;
  res.clearCookie(csrfCookieName(req), { path: '/', httpOnly: true, sameSite: 'lax', secure });
}

/**
 * Returns the request's CSRF token, creating it if needed: in the session for
 * logged-in visitors, in a signed cookie for the others.
 * @param req - Request.
 * @param res - Response (receives the cookie of a new anonymous token).
 */
export function csrfToken(req: Request, res: Response): string {
  if (loggedIn(req)) {
    req.session.csrfToken ??= newToken();
    return req.session.csrfToken;
  }
  const cached = res.locals.anonymousCsrf;
  if (cached) return cached;
  const name = csrfCookieName(req);
  const secret = csrfSecret(req);
  const current = readCookie(req, name);
  const token = isValidAnonymous(current, secret) ? current : signAnonymous(newToken(), secret);
  if (token !== current) res.cookie(name, token, { httpOnly: true, sameSite: 'lax', secure: req.app.get(SECURE_COOKIES) === true, path: '/' });
  res.locals.anonymousCsrf = token;
  return token;
}

/** Token the request must send back (`undefined` when none was given out or signature is invalid). */
function expectedToken(req: Request): string | undefined {
  if (loggedIn(req)) return req.session.csrfToken;
  const raw = readCookie(req, csrfCookieName(req));
  return isValidAnonymous(raw, csrfSecret(req)) ? raw : undefined;
}

/** Constant-time comparison of a sent token with the expected one. */
function matches(sent: unknown, expected: string | undefined, signed = false): boolean {
  const pattern = signed ? SIGNED_TOKEN : TOKEN;
  return (
    typeof expected === 'string' &&
    pattern.test(expected) &&
    typeof sent === 'string' &&
    sent.length === expected.length &&
    timingSafeEqual(Buffer.from(sent), Buffer.from(expected))
  );
}

/**
 * Middleware exposing `csrfToken` to views (lazily created on first use).
 */
export function exposeCsrf(req: Request, res: Response, next: NextFunction): void {
  res.locals.csrfToken = () => csrfToken(req, res);
  next();
}

/**
 * Middleware rejecting POST requests whose `_csrf` field does not match the expected token.
 */
export function verifyCsrf(req: Request, res: Response, next: NextFunction): void {
  if (matches((req.body as Record<string, unknown> | undefined)?._csrf, expectedToken(req), !loggedIn(req))) {
    next();
    return;
  }
  res.status(403).render('error', { code: 403, messageKey: 'error.http.csrf' });
}

/**
 * Middleware protecting JSON APIs: the page sends the session's CSRF token in
 * the `X-CSRF-Token` header (a cross-site form cannot set custom headers).
 * Safe methods (GET, HEAD) are not checked.
 */
export function verifyCsrfHeader(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }
  if (loggedIn(req) && matches(req.get('x-csrf-token'), req.session.csrfToken)) {
    next();
    return;
  }
  res.status(403).json({ error: 'error.http.csrf' });
}

/**
 * Middleware accepting either the form `_csrf` field or the `X-CSRF-Token` header
 * (for endpoints called by both HTML forms and same-origin `fetch`).
 */
export function verifyCsrfAny(req: Request, res: Response, next: NextFunction): void {
  const sent = (req.body as Record<string, unknown> | undefined)?._csrf ?? req.get('x-csrf-token');
  if (matches(sent, expectedToken(req), !loggedIn(req))) {
    next();
    return;
  }
  res.status(403).render('error', { code: 403, messageKey: 'error.http.csrf' });
}
