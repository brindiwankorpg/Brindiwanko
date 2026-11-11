/**
 * @file Login page: a message naming a date (end of a ban, stored in UTC) is
 * shown again in the visitor's time zone and regional format. Without
 * JavaScript the server's text stays, with the date in UTC.
 */
import { tDynamic } from '../i18n.js';

for (const message of document.querySelectorAll<HTMLElement>('.form-error[data-key]')) {
  try {
    const params = JSON.parse(message.dataset.params ?? '{}') as Record<string, string | number>;
    if (typeof params.until === 'string') message.textContent = tDynamic(message.dataset.key ?? '', params);
  } catch {
    // The server's text is kept.
  }
}
