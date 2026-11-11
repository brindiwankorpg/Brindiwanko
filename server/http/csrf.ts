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
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { SECURE_COOKIES, readCookie } from './cookies.js';
import './session-data.js';

/** Cookie holding the token of visitors who are not logged in. */
export const CSRF_COOKIE = 'brindiwanko.csrf';

/** Shape of a token (24 random bytes in base64url). */
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const newToken = (): string => randomBytes(24).toString('base64url');

/** Tells whether the request belongs to a logged-in session. */
const loggedIn = (req: Request): boolean => req.session?.accountId !== undefined;

/**
 * Returns the request's CSRF token, creating it if needed: in the session for
 * logged-in visitors, in a cookie for the others.
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
  const current = readCookie(req, CSRF_COOKIE);
  const token = current && TOKEN.test(current) ? current : newToken();
  if (token !== current) res.cookie(CSRF_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.app.get(SECURE_COOKIES) === true, path: '/' });
  res.locals.anonymousCsrf = token;
  return token;
}

/** Token the request must send back (`undefined` when none was given out). */
function expectedToken(req: Request): string | undefined {
  return loggedIn(req) ? req.session.csrfToken : readCookie(req, CSRF_COOKIE);
}

/** Constant-time comparison of a sent token with the expected one. */
function matches(sent: unknown, expected: string | undefined): boolean {
  return (
    typeof expected === 'string' &&
    TOKEN.test(expected) &&
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
  if (matches((req.body as Record<string, unknown> | undefined)?._csrf, expectedToken(req))) {
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
