/**
 * @file Declares the fields stored in Express `res.locals`.
 * Express exposes them as `res.locals.<field>`; this augmentation types them.
 */
import type { PublicAccount } from '../auth/middleware.js';
import type { Locale, TranslationKey, TranslationParams } from '../../shared/i18n.js';

declare global {
  namespace Express {
    interface Locals {
      /** Account currently logged in, if any. */
      account?: PublicAccount;
      /** Active interface language. */
      locale?: Locale;
      /** List of all supported locales. */
      locales?: readonly Locale[];
      /** Translation helper function for the active locale. */
      t?: (key: TranslationKey, params?: TranslationParams) => string;
      /** Address of the active dictionary (versioned by its content), loaded by the browser client. */
      i18nUrl?: string;
      /** Public address of the game (`PUBLIC_URL`), empty when unknown. */
      publicUrl?: string;
      /** Configured game title. */
      gameTitle?: string;
      /** Current request path. */
      currentPath?: string;
      /** Anonymous CSRF token cached for the response. */
      anonymousCsrf?: string;
      /** Function generating or returning the CSRF token for forms. */
      csrfToken?: () => string;
    }
  }
}
