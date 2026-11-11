/**
 * @file Menu bar of the editor (File, Edit, Mode, Draw...), in the manner of
 * desktop editors: a click on a title opens its menu, moving over the other
 * titles while a menu is open switches to them, and a click outside or Escape
 * closes it. Items are built again each time a menu opens, so their state
 * (disabled, checked) is always the current one.
 *
 * Keyboard, while a menu is open: up and down move between items, left and
 * right between menus, Enter or Space runs the item, Escape closes.
 */
import { el } from '../ui/dom.js';

/** One command of a menu. */
export interface MenuItem {
  label: string;
  /** Keys shown on the right (for information: the editor handles the keys itself). */
  shortcut?: string;
  /** The command opens a window: "…" follows the label. */
  dialog?: boolean;
  enabled?: () => boolean;
  /** Option shown with a check mark when on. */
  checked?: () => boolean;
  /** With `checked`: one choice among several (dot instead of check mark). */
  radio?: boolean;
  run: () => void;
}

/** An item, or a separating line. */
export type MenuEntry = MenuItem | 'separator';

/** A menu: its title and its entries. */
export interface Menu {
  label: string;
  items: () => MenuEntry[];
}

/** The menu bar. */
export class MenuBar {
  readonly element: HTMLDivElement;
  private readonly titles: HTMLButtonElement[];
  private current: { index: number; panel: HTMLDivElement } | null = null;
  /** A press outside closes the menu and goes no further (it does not paint on the map behind). */
  private readonly onPointerDown = (e: PointerEvent) => {
    if (this.element.contains(e.target as Node)) return;
    e.stopPropagation();
    this.close();
  };
  private readonly onKeyDown = (e: KeyboardEvent) => this.onKey(e);

  /**
   * @param menus - Menus, in display order.
   * @param trailing - Elements shown at the right end of the bar (title, close button).
   */
  constructor(private readonly menus: Menu[], trailing: HTMLElement[] = []) {
    this.titles = menus.map((menu, index) =>
      el('button', {
        className: 'mbar-title',
        text: menu.label,
        attrs: { type: 'button', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
        on: {
          click: () => (this.current?.index === index ? this.close() : this.open(index)),
          pointerenter: () => {
            if (this.current && this.current.index !== index) this.open(index);
          },
        },
      }),
    );
    // The titles sit in their own strip: on a narrow screen it scrolls sideways while the title and the
    // close button at the right end stay visible.
    this.element = el('div', { className: 'editor-menubar', attrs: { role: 'menubar' } }, [
      el('div', { className: 'mbar-menus' }, this.titles),
      el('div', { className: 'mbar-fill' }),
      ...trailing,
    ]);
  }

  /** Tells whether a menu is open (the editor's shortcuts then wait). */
  get isOpen(): boolean {
    return this.current !== null;
  }

  /**
   * Opens a menu.
   * @param index - Menu.
   * @param focusFirst - Puts the focus on its first item (keyboard use).
   */
  open(index: number, focusFirst = false): void {
    const wasOpen = this.current !== null;
    this.close(false);
    const title = this.titles[index]!;
    const rows = this.menus[index]!.items().map((entry) => (entry === 'separator' ? el('div', { className: 'mbar-separator', attrs: { role: 'separator' } }) : this.row(entry)));
    const panel = el('div', { className: 'mbar-panel', attrs: { role: 'menu', 'aria-label': this.menus[index]!.label } }, rows);
    this.element.append(panel);
    // Under its title, wherever the strip of titles is scrolled, and never past the right edge.
    const bar = this.element.getBoundingClientRect();
    const left = title.getBoundingClientRect().left - bar.left;
    panel.style.left = `${Math.max(0, Math.min(left, this.element.clientWidth - panel.offsetWidth))}px`;
    title.classList.add('open');
    title.setAttribute('aria-expanded', 'true');
    this.current = { index, panel };
    if (!wasOpen) {
      document.addEventListener('pointerdown', this.onPointerDown, true);
      document.addEventListener('keydown', this.onKeyDown, true);
    }
    if (focusFirst) this.items()[0]?.focus();
  }

  /**
   * Closes the open menu.
   * @param detach - Also stops listening to the document (nothing is open any more).
   */
  close(detach = true): void {
    if (this.current) {
      this.current.panel.remove();
      const title = this.titles[this.current.index]!;
      title.classList.remove('open');
      title.setAttribute('aria-expanded', 'false');
      this.current = null;
    }
    if (detach) {
      document.removeEventListener('pointerdown', this.onPointerDown, true);
      document.removeEventListener('keydown', this.onKeyDown, true);
    }
  }

  private row(item: MenuItem): HTMLButtonElement {
    const checked = item.checked?.() ?? false;
    const role = item.checked ? (item.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem';
    const row = el('button', { className: 'mbar-item', attrs: { type: 'button', role } }, [
      el('span', { className: 'mbar-check', text: checked ? (item.radio ? '●' : '✓') : '' }),
      el('span', { className: 'mbar-label', text: item.dialog ? `${item.label}…` : item.label }),
      el('span', { className: 'mbar-shortcut', text: item.shortcut ?? '' }),
    ]);
    if (item.checked) row.setAttribute('aria-checked', String(checked));
    row.disabled = item.enabled ? !item.enabled() : false;
    row.addEventListener('click', () => {
      this.close();
      item.run();
    });
    row.addEventListener('pointerenter', () => {
      if (!row.disabled) row.focus({ preventScroll: true });
    });
    return row;
  }

  /** Enabled items of the open menu. */
  private items(): HTMLButtonElement[] {
    return this.current ? [...this.current.panel.querySelectorAll<HTMLButtonElement>('.mbar-item:not(:disabled)')] : [];
  }

  private onKey(e: KeyboardEvent): void {
    const current = this.current;
    if (!current) return;
    const items = this.items();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (delta: number) => items[(at + delta + items.length) % items.length]?.focus();
    const handled = (() => {
      switch (e.key) {
        case 'Escape':
          this.titles[current.index]!.focus();
          this.close();
          return true;
        case 'ArrowDown':
          move(at < 0 ? 0 : 1);
          return true;
        case 'ArrowUp':
          move(at < 0 ? 0 : -1);
          return true;
        case 'ArrowRight':
        case 'ArrowLeft': {
          const next = (current.index + (e.key === 'ArrowRight' ? 1 : -1) + this.menus.length) % this.menus.length;
          this.open(next, true);
          return true;
        }
        case 'Enter':
        case ' ':
          if (at < 0) return false;
          items[at]!.click();
          return true;
        case 'Tab':
          this.close();
          return false;
        default:
          // Other keys do nothing while a menu is open (no tool changes behind it).
          return !e.ctrlKey && !e.metaKey;
      }
    })();
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
}
