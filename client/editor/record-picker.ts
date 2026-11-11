/**
 * @file Record picker of the database editor: a button showing the chosen
 * record (icon, number, name) that opens a list of the records, for the
 * references to records that have an icon (skills, items, weapons, armors,
 * states, classes, quests). The value stays the record id.
 *
 * The list is searched by name or number when it is long, and used with the
 * keyboard (arrows, Home / End, Enter, Escape) as well as the mouse. An id
 * matching no record (deleted since) is shown as a warning. A preview beside
 * the list may show the entry under the cursor (animations play there).
 */
import { t } from '../i18n.js';
import { el, icon } from '../ui/dom.js';

/** A record that can be picked. */
export interface PickerEntry {
  id: number;
  name: string;
  icon?: number;
}

/** Preview beside the list, showing the entry under the cursor. */
export interface PickerPreview {
  element: HTMLElement;
  /** Shows an entry (0 = the "no record" entry). */
  show(id: number): void;
}

/** From this many entries, the list has a search field. */
const SEARCH_FROM = 8;

/**
 * Creates a record picker.
 * @param entries - Records offered, in order.
 * @param initial - Id chosen at first (0 = none when `none` is given).
 * @param onPick - Called with the id picked.
 * @param none - Label of the "no record" entry (id 0), when the field allows it.
 * @param preview - Builds the preview shown beside the list each time it opens.
 */
export function recordPicker(entries: PickerEntry[], initial: number, onPick: (id: number) => void, none?: string, preview?: () => PickerPreview): HTMLElement {
  const options: PickerEntry[] = none === undefined ? entries : [{ id: 0, name: none }, ...entries];
  let value = initial;
  const button = el('button', { className: 'rp-button', attrs: { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' } });

  /** Icon, number and name of an entry (a warning for an id matching nothing). */
  const line = (entry: PickerEntry | undefined, id: number): Node[] => {
    if (!entry) return [el('span', { className: 'rp-icon rp-warn', text: '⚠' }), el('span', { className: 'rp-text', text: t('db.picker.missing', { id }) })];
    if (none !== undefined && entry.id === 0) return [el('span', { className: 'rp-icon' }), el('span', { className: 'rp-text rp-none', text: entry.name })];
    return [el('span', { className: 'rp-icon' }, [icon(entry.icon ?? 0)]), el('span', { className: 'rp-id', text: String(entry.id).padStart(3, '0') }), el('span', { className: 'rp-text', text: entry.name })];
  };
  const show = () => {
    const entry = options.find((e) => e.id === value);
    button.classList.toggle('missing', !entry);
    button.title = entry ? entry.name : '';
    button.replaceChildren(...line(entry, value), el('span', { className: 'rp-caret', text: '▾', attrs: { 'aria-hidden': 'true' } }));
  };
  show();

  let close: ((focus?: boolean) => void) | null = null;

  const open = () => {
    const search = el('input', { className: 'rp-search', attrs: { type: 'search', placeholder: t('db.picker.search'), 'aria-label': t('db.picker.search') } });
    const list = el('ul', { className: 'rp-list', attrs: { role: 'listbox' } });
    const stage = preview?.();
    const main = [...(options.length >= SEARCH_FROM ? [search] : []), list];
    const popup = stage
      ? el('div', { className: 'rp-popup rp-with-preview', attrs: { tabindex: '-1' } }, [el('div', { className: 'rp-main' }, main), el('div', { className: 'rp-preview' }, [stage.element])])
      : el('div', { className: 'rp-popup', attrs: { tabindex: '-1' } }, main);
    let shown: PickerEntry[] = [];
    let active = Math.max(0, options.findIndex((e) => e.id === value));

    const mark = () => {
      [...list.children].forEach((item, i) => item.classList.toggle('active', i === active));
      list.children[active]?.scrollIntoView({ block: 'nearest' });
      const entry = shown[active];
      if (entry) stage?.show(entry.id);
    };
    const render = () => {
      const query = search.value.trim().toLowerCase().replace(/^#/, '');
      shown = options.filter((e) => !query || e.name.toLowerCase().includes(query) || String(e.id) === query);
      active = Math.min(Math.max(0, active), Math.max(0, shown.length - 1));
      list.replaceChildren(
        ...shown.map((entry, i) => {
          const item = el('li', { className: `rp-option${entry.id === value ? ' selected' : ''}`, attrs: { role: 'option', 'aria-selected': String(entry.id === value) } }, line(entry, entry.id));
          // The focus stays in the search field (or the list) while clicking.
          item.addEventListener('pointerdown', (e) => e.preventDefault());
          item.addEventListener('click', () => pick(entry.id));
          item.addEventListener('pointermove', () => {
            if (active === i) return;
            active = i;
            mark();
          });
          return item;
        }),
      );
      if (shown.length === 0) list.append(el('li', { className: 'rp-empty', text: t('db.picker.no_match') }));
      mark();
    };
    const pick = (id: number) => {
      value = id;
      show();
      close?.();
      onPick(id);
    };

    popup.addEventListener('keydown', (e) => {
      const page = Math.max(1, Math.floor(list.clientHeight / 28));
      const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, Home: -Infinity, End: Infinity };
      if (e.key in moves) {
        // Home / End move the caret of the search field, unless it is empty.
        if ((e.key === 'Home' || e.key === 'End') && search.value !== '') return;
        e.preventDefault();
        active = Math.min(shown.length - 1, Math.max(0, active + moves[e.key]!));
        mark();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const entry = shown[active];
        if (entry) pick(entry.id);
      } else if (e.key === 'Escape') {
        // Only the list closes, not the database window underneath.
        e.preventDefault();
        e.stopPropagation();
        close?.();
      } else if (e.key === 'Tab') close?.(false);
    });
    search.addEventListener('input', () => {
      active = 0;
      render();
    });

    // Placed over everything (the form scrolls and would cut it), under or above the button.
    const place = () => {
      const r = button.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      const up = below < 220 && r.top > below;
      popup.style.minWidth = `${Math.max(220, r.width) + (stage ? stage.element.offsetWidth + 12 : 0)}px`;
      popup.style.maxHeight = `${Math.min(340, (up ? r.top : below) - 10)}px`;
      popup.style.top = up ? '' : `${r.bottom + 2}px`;
      popup.style.bottom = up ? `${window.innerHeight - r.top + 2}px` : '';
      popup.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - popup.offsetWidth - 4))}px`;
    };
    const outside = (e: Event) => {
      const target = e.target as Node;
      if (!popup.contains(target) && !button.contains(target)) close?.(false);
    };
    const scrolled = (e: Event) => {
      if (!popup.contains(e.target as Node)) close?.(false);
    };
    const resized = () => close?.(false);

    (button.closest('.modal-backdrop') ?? document.body).append(popup);
    render();
    place();
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', resized);
    (options.length >= SEARCH_FROM ? search : popup).focus();

    close = (focus = true) => {
      close = null;
      popup.remove();
      button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', resized);
      if (focus && button.isConnected) button.focus();
    };
  };

  button.addEventListener('click', () => (close ? close() : open()));
  button.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (!close) open();
  });
  return el('div', { className: 'rp' }, [button]);
}
