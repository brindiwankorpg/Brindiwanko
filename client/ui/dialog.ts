/**
 * @file In-game confirmation and input dialogs, drawn with the window skin.
 * They replace the browser's `confirm()` and `prompt()` in the game and the
 * editor: keys pressed inside never reach the game (movement, shortcuts).
 */
import { t } from '../i18n.js';
import { el } from './dom.js';

/** Options of a confirmation dialog. */
export interface ConfirmOptions {
  title: string;
  message: string;
  /** Label of the confirm button (defaults to "OK"). */
  ok?: string;
  /** Red confirm button, for destructive actions. */
  danger?: boolean;
  /** Information only: no Cancel button. */
  hideCancel?: boolean;
}

/** Options of an input dialog. */
export interface PromptOptions extends ConfirmOptions {
  value?: string;
  /** Number input with these bounds instead of a text input. */
  number?: { min: number; max: number };
  maxLength?: number;
}

/**
 * Opens a skinned dialog and resolves with the confirm callback's result, or
 * `null` when cancelled (Cancel, Escape or a click outside).
 * @param accept - Tells whether the value may be confirmed; otherwise the field is marked invalid and the dialog stays open.
 */
function openDialog<T>(options: ConfirmOptions, extra: HTMLElement | null, read: () => T, accept?: () => boolean): Promise<T | null> {
  return new Promise((resolve) => {
    const finish = (value: T | null) => {
      backdrop.remove();
      previous?.focus();
      resolve(value);
    };
    const previous = document.activeElement as HTMLElement | null;
    const ok = el('button', {
      className: `button${options.danger ? ' danger' : ' primary'}`,
      text: options.ok ?? t('dialog.ok'),
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (accept && !accept()) {
            extra?.setAttribute('aria-invalid', 'true');
            extra?.focus();
            return;
          }
          finish(read());
        },
      },
    });
    const cancel = el('button', { className: 'button', text: t('common.cancel'), attrs: { type: 'button' }, on: { click: () => finish(null) } });
    const dialog = el('div', { className: 'skin-window modal game-dialog', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title } }, [
      el('div', { className: 'modal-title', text: options.title }),
      el('div', { className: 'modal-body' }, [el('p', { className: 'game-dialog-message', text: options.message }), ...(extra ? [extra] : [])]),
      el('div', { className: 'modal-buttons' }, options.hideCancel ? [ok] : [cancel, ok]),
    ]);
    const backdrop = el('div', { className: 'modal-backdrop game-dialog-backdrop' }, [dialog]);
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) finish(null);
    });
    // Keys stay inside the dialog: the game and the editor listen on `window`.
    for (const type of ['keydown', 'keyup'] as const) backdrop.addEventListener(type, (e) => e.stopPropagation());
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') finish(null);
      else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
        e.preventDefault();
        ok.click();
      }
    });
    document.body.append(backdrop);
    if (extra instanceof HTMLInputElement) {
      extra.focus();
      extra.select();
    } else (options.danger ? cancel : ok).focus();
  });
}

/** Asks the player to confirm an action; resolves with `true` when confirmed. */
export async function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return (await openDialog(options, null, () => true)) === true;
}

/**
 * Asks to confirm an action that has an option (a check box, ticked at first); resolves with the
 * option's state when confirmed, `null` when cancelled.
 */
export function confirmWithOption(options: ConfirmOptions, option: string): Promise<boolean | null> {
  const box = el('input', { attrs: { type: 'checkbox' } });
  box.checked = true;
  return openDialog(options, el('label', { className: 'game-dialog-option' }, [box, el('span', { text: option })]), () => box.checked);
}

/** Shows a message with an OK button. */
export async function noticeDialog(options: { title: string; message: string }): Promise<void> {
  await openDialog({ ...options, hideCancel: true }, null, () => true);
}

/** Asks the player for a text (or a number); resolves with `null` when cancelled. */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  const input = el('input', {
    className: 'game-dialog-input',
    attrs: options.number
      ? { type: 'number', min: String(options.number.min), max: String(options.number.max), step: '1' }
      : { type: 'text', ...(options.maxLength ? { maxlength: String(options.maxLength) } : {}) },
  });
  input.value = options.value ?? '';
  // A number outside the bounds (or not a whole number) is refused on the spot, rather than closing the dialog for nothing.
  const bounds = options.number;
  const inRange = () => input.value.trim() !== '' && Number.isInteger(Number(input.value)) && Number(input.value) >= bounds!.min && Number(input.value) <= bounds!.max;
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  return openDialog(options, input, () => input.value, bounds ? inRange : undefined);
}
