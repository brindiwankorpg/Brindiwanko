/**
 * @file Bag window: the inventory as a grid of stacks (icon and quantity),
 * with category tabs (items, weapons, armors, key items), a sort order, a
 * details panel (description, parameters of equipment, resale price) and the
 * actions of the selected entry: use, equip, throw away, link in the chat
 * (usable items can also be dragged onto the hotbar). Every action only
 * sends a request; the server applies it and answers with the new state.
 *
 * Keyboard: arrows move in the grid, Action opens the actions of the entry,
 * Q / E (physical keys) switch tabs.
 */
import { PARAMS } from '../../shared/database.js';
import type { InventoryEntry, InventoryPayload } from '../../shared/protocol.js';
import { t, tDynamic } from '../i18n.js';
import { confirmDialog, promptDialog } from './dialog.js';
import { el, icon } from './dom.js';
import { makeHotbarDraggable } from './hud.js';
import { GameWindow } from './windows.js';

type Category = 'item' | 'weapon' | 'armor' | 'key';
type Sort = 'default' | 'name' | 'quantity';

const CATEGORIES: Category[] = ['item', 'weapon', 'armor', 'key'];
const SORTS: Sort[] = ['default', 'name', 'quantity'];
/** Cells per row of the grid. */
const COLUMNS = 8;

/** Which category tab an entry belongs to. */
function categoryOf(e: InventoryEntry): Category {
  if (e.kind !== 'item') return e.kind;
  return e.category === 'regular' ? 'item' : 'key';
}

/** What the bag asks the game to do. */
export interface BagActions {
  use(itemId: number): void;
  equip(entry: InventoryEntry): void;
  discard(entry: InventoryEntry, quantity: number): void;
  currencyName(): string;
  /** Parameter names (System terms). */
  paramName(param: string): string;
  /** Resale rate in percent (known once a shop was opened; 50 by default). */
  sellRate(): number;
  /** Size of the bag (System settings), for the slot counter. */
  bagSize(): number;
  /** Writes an item link (`[Name]`) in the chat input. */
  linkInChat(name: string): void;
  /** Opens the shortcut picker for a usable item (hotbar slots 1 to 8). */
  placeOnHotbar(entry: InventoryEntry): void;
}

/** The bag window. */
export class BagWindow extends GameWindow {
  private category: Category = 'item';
  private sort: Sort = 'default';
  private inventory: InventoryPayload = { gold: 0, entries: [] };
  private cell = 0;
  private readonly tabs = el('div', { className: 'bag-tabs', attrs: { role: 'tablist' } });
  private readonly grid = el('div', { className: 'bag-grid', attrs: { role: 'grid' } });
  private readonly details = el('div', { className: 'bag-details' });
  private readonly footer = el('div', { className: 'bag-footer' });

  constructor(private readonly actions: BagActions) {
    super('bag', t('bag.title'), { className: 'bag-window' });
    this.body.append(this.tabs, this.grid, this.details, this.footer);
    try {
      const saved = localStorage.getItem('brindiwanko.bag.sort') as Sort | null;
      if (saved && SORTS.includes(saved)) this.sort = saved;
    } catch {
      // Default order.
    }
    window.addEventListener('keydown', (e) => {
      if (!this.manager?.isOpen(this) || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      // Typing in the chat (or any field) must not change the tab.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'KeyQ' || e.code === 'KeyE') this.switchCategory(e.code === 'KeyE' ? 1 : -1);
    });
  }

  /** Replaces the inventory shown (refreshes the window if open). */
  setInventory(inventory: InventoryPayload): void {
    this.inventory = inventory;
    if (this.manager?.isOpen(this)) this.render();
  }

  override onOpen(): void {
    this.setTitle(t('bag.title'));
    this.render();
  }

  private switchCategory(step: number): void {
    this.category = CATEGORIES[(CATEGORIES.indexOf(this.category) + step + CATEGORIES.length) % CATEGORIES.length]!;
    this.cell = 0;
    this.manager?.audio.play('cursor');
    this.render();
  }

  /** Entries of the current tab in the chosen order. */
  private entries(): InventoryEntry[] {
    const list = this.inventory.entries.filter((e) => categoryOf(e) === this.category);
    if (this.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (this.sort === 'quantity') list.sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
    return list;
  }

  /** Arrows move in the grid; Action shows the actions of the entry. */
  override handleInput(input: Parameters<GameWindow['handleInput']>[0]): boolean {
    if (input.consume('cancel')) {
      if (this.details.querySelector('.bag-actions.open')) {
        this.render();
        return true;
      }
      this.manager?.audio.play('cancel');
      this.close();
      return true;
    }
    const count = this.entries().length;
    const move = input.consume('right') ? 1 : input.consume('left') ? -1 : input.consume('down') ? COLUMNS : input.consume('up') ? -COLUMNS : 0;
    if (move && count > 0) {
      this.cell = Math.max(0, Math.min(count - 1, this.cell + move));
      this.manager?.audio.play('cursor');
      this.render();
      return true;
    }
    if (input.consume('action')) {
      const entry = this.entries()[this.cell];
      if (entry) this.showActions(entry);
    }
    return true;
  }

  private render(): void {
    this.tabs.replaceChildren(
      ...CATEGORIES.map((c) =>
        el('button', {
          className: `bag-tab${c === this.category ? ' active' : ''}`,
          text: tDynamic(`bag.category.${c}`),
          attrs: { type: 'button', role: 'tab', 'aria-selected': String(c === this.category) },
          on: {
            click: () => {
              this.category = c;
              this.cell = 0;
              this.render();
            },
          },
        }),
      ),
    );
    const entries = this.entries();
    this.cell = Math.min(this.cell, Math.max(0, entries.length - 1));
    const cells = entries.map((e, i) =>
      el(
        'button',
        {
          className: `bag-cell${i === this.cell ? ' selected' : ''}`,
          title: e.name,
          attrs: { type: 'button', role: 'gridcell', 'aria-label': `${e.name} ×${e.quantity}` },
          on: {
            click: () => {
              if (this.cell === i) this.showActions(e);
              else {
                this.cell = i;
                this.render();
              }
            },
            dblclick: () => this.primary(e),
          },
        },
        [icon(e.icon), e.quantity > 1 ? el('span', { className: 'bag-qty', text: String(e.quantity) }) : null],
      ),
    );
    // Usable items can be dragged onto the hotbar.
    entries.forEach((e, i) => e.kind === 'item' && e.usable && makeHotbarDraggable(cells[i]!, { kind: 'item', id: e.id }));
    // Empty cells complete the last row so the grid keeps its shape.
    const filler = Math.max(COLUMNS * 3, Math.ceil(entries.length / COLUMNS) * COLUMNS) - entries.length;
    this.grid.replaceChildren(...cells, ...Array.from({ length: filler }, () => el('span', { className: 'bag-cell empty' })));
    const selected = entries[this.cell];
    // The actions of the selected entry are always shown under its description: nothing to guess.
    this.details.replaceChildren(...(selected ? [...this.describe(selected), this.actionRow(selected)] : [el('p', { className: 'bag-empty', text: t('bag.empty') })]));
    // The order is a plain list: every choice is visible at once.
    const sortSelect = el('select', { attrs: { 'aria-label': t('bag.sort_label') } }, SORTS.map((s) => el('option', { text: tDynamic(`bag.sort_${s}`), attrs: { value: s } })));
    sortSelect.value = this.sort;
    sortSelect.addEventListener('change', () => {
      const value = sortSelect.value as Sort;
      if (!SORTS.includes(value)) return;
      this.sort = value;
      try {
        localStorage.setItem('brindiwanko.bag.sort', this.sort);
      } catch {
        // Not remembered.
      }
      this.render();
    });
    const used = this.inventory.entries.length;
    const size = Math.max(1, this.actions.bagSize());
    const fill = Math.min(1, used / size);
    const gauge = el('span', { className: `bag-fill${fill >= 1 ? ' full' : fill >= 0.8 ? ' nearly' : ''}`, attrs: { role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(size), 'aria-valuenow': String(used), 'aria-label': t('bag.slots', { used, size }) } }, [
      el('span', { className: 'bag-fill-bar' }),
    ]);
    (gauge.firstElementChild as HTMLElement).style.width = `${Math.round(fill * 100)}%`;
    this.footer.replaceChildren(
      el('label', { className: 'bag-sort' }, [el('span', { text: t('bag.sort_label') }), sortSelect]),
      el('span', { className: 'bag-slots' }, [gauge, el('span', { text: t('bag.slots', { used, size }) })]),
      el('span', { className: 'bag-gold' }, [icon('gold'), el('span', { text: `${this.inventory.gold} ${this.actions.currencyName()}` })]),
    );
  }

  /** Details of an entry: description, parameters, resale price. */
  private describe(e: InventoryEntry): HTMLElement[] {
    const out: HTMLElement[] = [el('div', { className: 'bag-details-title' }, [icon(e.icon), el('strong', { text: e.name }), el('span', { text: `×${e.quantity}` })])];
    if (e.description) out.push(el('p', { text: e.description }));
    if (e.params) {
      const bonuses = PARAMS.filter((p) => e.params![p] !== 0).map((p) => `${this.actions.paramName(p)} ${e.params![p] > 0 ? '+' : ''}${e.params![p]}`);
      if (bonuses.length) out.push(el('p', { className: 'bag-params', text: bonuses.join(' · ') }));
    }
    if (e.price > 0) out.push(el('p', { className: 'bag-price', text: t('bag.sell_price', { price: Math.floor((e.price * this.actions.sellRate()) / 100), currency: this.actions.currencyName() }) }));
    return out;
  }

  /** Default action of a double click: use or equip. */
  private primary(e: InventoryEntry): void {
    if (e.kind === 'item' && e.usable) this.actions.use(e.id);
    else if (e.kind !== 'item') this.actions.equip(e);
  }

  /** Buttons of the possible actions on an entry (shown under its description). */
  private actionRow(e: InventoryEntry): HTMLElement {
    const buttons: HTMLElement[] = [];
    const add = (label: string, iconName: Parameters<typeof icon>[0], run: () => void, danger = false) =>
      buttons.push(el('button', { className: `button small${danger ? ' danger' : ''}`, attrs: { type: 'button' }, on: { click: run } }, [icon(iconName), el('span', { text: label })]));
    if (e.kind === 'item' && e.usable) add(t('bag.use'), 'heart', () => this.actions.use(e.id));
    if (e.kind !== 'item') add(t('bag.equip'), e.kind === 'weapon' ? 'sword' : 'armor', () => this.actions.equip(e));
    if (e.kind === 'item' && e.usable) add(t('bag.hotbar'), 'skills', () => this.actions.placeOnHotbar(e));
    if (e.kind !== 'item' || e.category === 'regular') {
      add(t('bag.discard'), 'cross', async () => {
        const title = t('bag.discard');
        const typed = e.quantity > 1 ? await promptDialog({ title, message: t('bag.discard_how_many', { name: e.name, max: e.quantity }), value: '1', number: { min: 1, max: e.quantity } }) : '1';
        const count = Math.min(Number(typed), e.quantity);
        if (typed === null || !Number.isInteger(count) || count <= 0) return;
        if (await confirmDialog({ title, message: t('bag.discard_confirm', { name: e.name, count }), ok: title, danger: true })) this.actions.discard(e, count);
      }, true);
    }
    add(t('bag.link'), 'chat', () => this.actions.linkInChat(e.name));
    return el('div', { className: 'bag-actions' }, buttons);
  }

  /** Puts the keyboard focus on the actions of an entry (Action key, or a click on the selected cell). */
  private showActions(e: InventoryEntry): void {
    if (this.entries()[this.cell] !== e) this.render();
    const row = this.details.querySelector<HTMLElement>('.bag-actions');
    if (!row) return;
    row.classList.add('open');
    this.manager?.audio.play('ok');
    row.querySelector<HTMLButtonElement>('button')?.focus();
  }
}
