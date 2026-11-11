/**
 * @file Device cookies, so that nobody can lock a player out of its account.
 *
 * A browser where an account logged in successfully receives a signed token
 * naming that account. Failed attempts made with a valid token only lock that
 * browser, while attempts without it (any other client, from any address)
 * share one lock per account. A stranger guessing a password therefore cannot
 * lock the owner out of the browser it usually plays from, and still cannot
 * keep guessing. (Design: OWASP, "Slow Down Online Guessing Attacks with
 * Device Cookies".)
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Name of the device cookie. */
export const DEVICE_COOKIE = 'brindiwanko.device';

/** Lifetime of a device cookie (renewed at each login). */
export const DEVICE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/** Short digest of the password hash: a token stops being valid as soon as the password changes. */
const passwordTag = (passwordHash: string): string => createHmac('sha256', 'device-password').update(passwordHash).digest('base64url').slice(0, 16);

const sign = (secret: string, login: string, nonce: string, passwordHash: string): string =>
  createHmac('sha256', secret).update(`${login}\n${nonce}\n${passwordTag(passwordHash)}`).digest('base64url');

/**
 * Creates the device token of an account.
 * @param secret - Server secret signing the tokens.
 * @param username - Account name (compared without case).
 * @param passwordHash - Current password hash of the account (a password change invalidates the token).
 */
export function createDeviceToken(secret: string, username: string, passwordHash = ''): string {
  const nonce = randomBytes(16).toString('base64url');
  return `${nonce}.${sign(secret, username.toLowerCase(), nonce, passwordHash)}`;
}

/**
 * Checks a device token against an account.
 * @param token - Cookie value (untrusted).
 * @param username - Account the login attempt is for.
 * @param passwordHash - Current password hash of that account.
 * @returns The token's nonce, which identifies the device, or `null` when the token is missing, forged or for another account.
 */
export function verifyDeviceToken(secret: string, token: string | undefined, username: string, passwordHash = ''): string | null {
  if (!token || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [nonce, mac] = parts as [string, string];
  const expected = Buffer.from(sign(secret, username.toLowerCase(), nonce, passwordHash));
  const given = Buffer.from(mac);
  return given.length === expected.length && timingSafeEqual(given, expected) ? nonce : null;
}
