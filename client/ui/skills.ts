/**
 * @file Skills window (K): the skills the character knows and the items it
 * can use, each of which can be placed on a hotbar slot (keys 1 to 8, or the
 * skill buttons around the Action button on touch screens): pick a slot from
 * the list, or drag the entry onto the bar. Using a skill
 * only sends a request; the server checks cost, cooldown and targets.
 */
import { HOTBAR_SIZE, type HotbarSlot, type SkillsPayload } from '../../shared/combat.js';
import type { InventoryPayload } from '../../shared/protocol.js';
import { t, gameTerm } from '../i18n.js';
import { el, icon } from './dom.js';
import { makeHotbarDraggable } from './hud.js';
import { GameWindow, type ListItem } from './windows.js';

/** What the window needs from the game. */
export interface SkillsHost {
  skills(): SkillsPayload;
  inventory(): InventoryPayload;
  /** Saves a new hotbar. */
  setHotbar(slots: HotbarSlot[]): void;
  /** Uses a skill now. */
  useSkill(id: number): void;
}

/** Tabs of the window: the class skills, and the items that can be used from the hotbar. */
type SkillsTab = 'skills' | 'items';

/** The skills window. */
export class SkillsWindow extends GameWindow {
  /** Entry waiting for a slot, or null while browsing the list. */
  private placing: { slot: HotbarSlot & object; label: string } | null = null;
  private tab: SkillsTab = 'skills';

  constructor(private readonly host: SkillsHost) {
    super('skills', t('skills.title'), { className: 'skills-window' });
  }

  override onOpen(): void {
    this.setTitle(t('skills.title'));
    this.placing = null;
    this.render();
  }

  /**
   * Opens the slot picker for an entry right away (from the bag: "Put on the hotbar").
   * The window must be open.
   */
  place(slot: HotbarSlot & object, label: string): void {
    this.tab = slot.kind === 'skill' ? 'skills' : 'items';
    this.startPlacing(slot, label);
  }

  /** Refreshes the window if it is open (new skill, inventory change). */
  refresh(): void {
    if (this.manager?.isOpen(this) && !this.placing) this.render();
  }

  override handleInput(input: Parameters<GameWindow['handleInput']>[0]): boolean {
    if (this.placing && input.consume('cancel')) {
      this.placing = null;
      this.render();
      return true;
    }
    // Left / right switch between the two tabs while browsing.
    if (!this.placing && (input.consume('left') || input.consume('right'))) {
      this.tab = this.tab === 'skills' ? 'items' : 'skills';
      this.manager?.audio.play('cursor');
      this.render();
      return true;
    }
    return super.handleInput(input);
  }

  /** The two tabs (class skills, usable items), each with its count. */
  private tabRow(skillCount: number, itemCount: number): HTMLElement {
    const tab = (id: SkillsTab, label: string, count: number) =>
      el('button', {
        className: `bag-tab${this.tab === id ? ' active' : ''}`,
        text: `${label} (${count})`,
        attrs: { type: 'button', role: 'tab', 'aria-selected': String(this.tab === id) },
        on: {
          click: () => {
            this.tab = id;
            this.render();
          },
        },
      });
    return el('div', { className: 'bag-tabs skills-tabs', attrs: { role: 'tablist' } }, [tab('skills', t('skills.tab_skills'), skillCount), tab('items', t('skills.tab_items'), itemCount)]);
  }

  private render(): void {
    const { skills, hotbar } = this.host.skills();
    const slotOf = (kind: 'skill' | 'item', id: number) => hotbar.findIndex((s) => s?.kind === kind && s.id === id);
    const usable = this.host.inventory().entries.filter((e) => e.kind === 'item' && e.usable);
    // Skills and consumables are not mixed: each has its tab.
    const items: ListItem[] = [];
    const slots: (HotbarSlot & object)[] = [];
    if (this.tab === 'skills') {
      for (const s of skills) {
        const slot = slotOf('skill', s.id);
        items.push({
          label: s.name,
          icon: s.icon,
          suffix: `${s.mpCost > 0 ? `${t('skills.mp', { mp: s.mpCost, term: gameTerm('mp') })} · ` : ''}${s.cooldown > 0 ? t('skills.cooldown', { seconds: s.cooldown }) : ''}${slot >= 0 ? ` [${slot + 1}]` : ''}`,
          // The skill type (magic, technique...) heads the description.
          description: [s.typeName ? `[${s.typeName}]` : '', s.description].filter(Boolean).join(' ') || ' ',
          onSelect: () => this.startPlacing({ kind: 'skill', id: s.id }, s.name),
        });
        slots.push({ kind: 'skill', id: s.id });
      }
    } else {
      for (const e of usable) {
        const slot = slotOf('item', e.id);
        items.push({ label: e.name, icon: e.icon, suffix: `×${e.quantity}${slot >= 0 ? ` [${slot + 1}]` : ''}`, description: e.description || ' ', onSelect: () => this.startPlacing({ kind: 'item', id: e.id }, e.name) });
        slots.push({ kind: 'item', id: e.id });
      }
    }
    const tabs = this.tabRow(skills.length, usable.length);
    // Keyboard and mouse help, or touch help once the touch controls are shown (CSS on `body.touch-mode`).
    const hint = el('p', { className: 'hint skills-hint' }, [
      el('span', { className: 'keys-help', text: t('skills.help') }),
      el('span', { className: 'touch-help', text: t('skills.help_touch') }),
    ]);
    if (items.length === 0) {
      this.body.replaceChildren(tabs, el('p', { className: 'bag-empty', text: t(this.tab === 'skills' ? 'skills.none_skills' : 'skills.none_items') }));
      return;
    }
    this.setList(items, this.body, true);
    this.body.querySelectorAll<HTMLElement>('.command-list > li').forEach((node, i) => slots[i] && makeHotbarDraggable(node, slots[i]));
    this.body.prepend(tabs, hint);
  }

  /** Shows the slot picker for an entry. */
  private startPlacing(slot: HotbarSlot & object, label: string): void {
    this.placing = { slot, label };
    const hotbar = this.host.skills().hotbar;
    const names = (s: HotbarSlot) => {
      if (!s) return t('skills.empty_slot');
      if (s.kind === 'skill') return this.host.skills().skills.find((k) => k.id === s.id)?.name ?? '?';
      return this.host.inventory().entries.find((e) => e.kind === 'item' && e.id === s.id)?.name ?? '?';
    };
    const place = (index: number | null) => {
      const next = hotbar.map((s) => (s?.kind === slot.kind && s.id === slot.id ? null : s));
      if (index !== null) next[index] = slot;
      this.host.setHotbar(next);
      this.placing = null;
      this.render();
    };
    const items: ListItem[] = Array.from({ length: HOTBAR_SIZE }, (_, i) => ({ label: `${i + 1} — ${names(hotbar[i] ?? null)}`, onSelect: () => place(i) }));
    items.push({ label: t('skills.remove'), icon: 'close', onSelect: () => place(null) });
    // A skill can also be used from here, without placing it on the bar first.
    if (slot.kind === 'skill') {
      items.unshift({
        label: t('skills.use_now'),
        icon: 'skills',
        onSelect: () => {
          this.placing = null;
          this.close();
          this.host.useSkill(slot.id);
        },
      });
    }
    this.setList(items, this.body);
    this.body.prepend(el('div', { className: 'skills-placing' }, [icon(slot.kind === 'skill' ? 'skills' : 'bag'), el('strong', { text: t('skills.choose_slot', { name: label }) })]));
  }
}
