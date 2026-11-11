/**
 * @file Status and equipment windows.
 *
 * - Status (C): portrait, gauges, experience to the next level, the eight
 *   parameters with the part given by the equipment and the distributed
 *   points, and "+" buttons while points are left to distribute.
 * - Equipment: the five slots with the character drawn in its outfit; choosing
 *   a slot lists the items of the bag it can wear there, with the change of
 *   each parameter, and a choice to empty the slot.
 *
 * Both display the `sheet` sent by the server; actions are requests.
 */
import { drawCharacterFrame } from '../../shared/art/character.js';
import { drawFace } from '../../shared/art/face.js';
import { POINT_GAIN, type SheetPayload } from '../../shared/character.js';
import { EQUIP_SLOTS, PARAMS, type EquipSlot, type ParamName, type ParamValues } from '../../shared/database.js';
import type { IconName } from '../../shared/icons.js';
import type { InventoryEntry, InventoryPayload, PlayerCharacterInfo } from '../../shared/protocol.js';
import { rasterize } from '../art/render.js';
import { t, tDynamic, gameTerm } from '../i18n.js';
import { Gauge, el, icon } from './dom.js';
import { GameWindow, type ListItem } from './windows.js';

/** What the windows need from the game. */
export interface SheetHost {
  player(): PlayerCharacterInfo;
  sheet(): SheetPayload | null;
  inventory(): InventoryPayload;
  paramName(param: string): string;
  allocate(param: ParamName): void;
  equip(slot: EquipSlot, id: number): void;
  /** Opens the equipment window (from the character window). */
  openEquipment(): void;
}

const zero = (): ParamValues => ({ mhp: 0, mmp: 0, atk: 0, def: 0, mat: 0, mdf: 0, agi: 0, luk: 0 });

/** Icon of each equipment slot (an empty slot shows what goes there). */
export const SLOT_ICONS: Record<EquipSlot, IconName> = { weapon: 'sword', shield: 'shield', head: 'helmet', body: 'armor', accessory: 'ring' };

/** Character status. */
export class StatusWindow extends GameWindow {
  /**
   * Points chosen but not sent yet: they are only spent once confirmed, so a slip of the finger costs nothing.
   * Reset when the window opens or the server sends another sheet.
   */
  private pending = zero();

  constructor(private readonly host: SheetHost) {
    super('status', t('menu.status'), { className: 'status-window' });
  }

  /**
   * Refreshes the window if open. The draft is kept (HP and MP change all the time), unless it no longer
   * fits the points left (spent elsewhere, another session).
   */
  refresh(): void {
    if (!this.manager?.isOpen(this)) return;
    if (this.pendingCount() > (this.host.sheet()?.freePoints ?? 0)) this.pending = zero();
    this.render();
  }

  override onOpen(): void {
    this.pending = zero();
    this.render();
  }

  /** Points of the draft. */
  private pendingCount(): number {
    return PARAMS.reduce((sum, p) => sum + this.pending[p], 0);
  }

  /** Sends the draft: one request per point, the server checks each one. */
  private confirmPoints(): void {
    for (const p of PARAMS) for (let i = 0; i < this.pending[p]; i++) this.host.allocate(p);
    this.pending = zero();
    this.manager?.audio.play('ok');
  }

  private render(): void {
    this.setTitle(t('menu.status'));
    const c = this.host.player();
    const sheet = this.host.sheet();
    const face = rasterize(drawFace(c.appearance), 2);
    face.className = 'menu-face';
    const hp = new Gauge(gameTerm('hp'), 'hp');
    const mp = new Gauge(gameTerm('mp'), 'mp');
    const xp = new Gauge(gameTerm('xp'), 'xp');
    hp.set(c.hp, c.maxHp);
    mp.set(c.mp, c.maxMp);
    const floor = c.xpFloor ?? 0;
    const next = c.xpNext ?? 0;
    if (next > floor) xp.set(c.xp - floor, next - floor, false);
    else xp.set(1, 1, false);
    const header = el('div', { className: 'character-card-menu' }, [
      face,
      el('div', { className: 'character-card-info' }, [
        el('div', { className: 'card-name', text: c.name }),
        el('div', { className: 'card-class', text: `${c.className} — ${t('hud.level', { level: c.level })}` }),
        hp.element,
        mp.element,
        xp.element,
        el('div', { className: 'status-xp', text: next > floor ? t('status.to_next', { xp: next - c.xp, level: c.level + 1 }) : t('status.max_level') }),
      ]),
    ]);
    const rows: HTMLElement[] = [];
    const draft = this.pendingCount();
    const left = sheet ? sheet.freePoints - draft : 0;
    if (sheet) {
      const equipBonus = zero();
      for (const e of Object.values(sheet.equipment)) if (e) for (const p of PARAMS) equipBonus[p] += e.params[p];
      for (const p of PARAMS) {
        const points = (sheet.allocated[p] ?? 0) * POINT_GAIN[p];
        const extra = [equipBonus[p] ? t('status.from_equipment', { value: signed(equipBonus[p]) }) : '', points ? t('status.from_points', { value: signed(points) }) : ''].filter(Boolean).join(' ');
        const gain = this.pending[p] * POINT_GAIN[p];
        // What one point gives, and what the parameter does in a fight, in the tooltip of its name.
        const help = `${tDynamic(`status.param_help.${p}`)} ${t('status.point_gain', { value: POINT_GAIN[p], param: this.host.paramName(p) })}`;
        const controls = sheet.freePoints > 0
          ? el('span', { className: 'status-alloc' }, [
              el('button', { className: 'button small status-minus', text: '−', title: t('status.remove_point'), attrs: { type: 'button', 'aria-label': `${t('status.remove_point')} — ${this.host.paramName(p)}`, ...(this.pending[p] > 0 ? {} : { disabled: '' }) }, on: { click: () => this.change(p, -1) } }),
              el('button', { className: 'button small status-plus', text: `+${POINT_GAIN[p]}`, title: t('status.add_point'), attrs: { type: 'button', 'aria-label': `${t('status.add_point')} — ${this.host.paramName(p)}`, ...(left > 0 ? {} : { disabled: '' }) }, on: { click: () => this.change(p, 1) } }),
            ])
          : null;
        rows.push(el('div', { className: 'status-param', title: help }, [
          el('span', { className: 'status-name', text: this.host.paramName(p) }),
          el('strong', { text: String(sheet.params[p]) }),
          gain ? el('span', { className: 'better', text: `→ ${sheet.params[p] + gain}` }) : el('span', { className: 'status-extra', text: extra }),
          controls,
        ]));
      }
    }
    const pointsBar = sheet && sheet.freePoints > 0
      ? el('div', { className: 'status-points' }, [
          el('span', { text: t('status.free_points', { points: left }) }),
          el('button', { className: 'button small primary', text: t('status.confirm_points', { count: draft }), attrs: { type: 'button', ...(draft > 0 ? {} : { disabled: '' }) }, on: { click: () => this.confirmPoints() } }),
          el('button', { className: 'button small', text: t('common.cancel'), attrs: { type: 'button', ...(draft > 0 ? {} : { disabled: '' }) }, on: { click: () => this.change(null, 0) } }),
        ])
      : el('span');
    this.body.replaceChildren(
      header,
      pointsBar,
      sheet && sheet.freePoints > 0 ? el('p', { className: 'hint', text: t('status.points_help') }) : el('span'),
      el('div', { className: 'status-params' }, rows),
      el('div', { className: 'status-footer' }, [
        el('p', { className: 'status-gold' }, [icon('gold'), el('span', { text: String(c.gold) })]),
        el('button', { className: 'button small', attrs: { type: 'button' }, on: { click: () => this.host.openEquipment() } }, [icon('armor'), el('span', { text: t('status.open_equipment') })]),
      ]),
    );
  }

  /** Changes the draft of a parameter (`null`: clears the whole draft). */
  private change(p: ParamName | null, step: number): void {
    const sheet = this.host.sheet();
    if (!sheet) return;
    if (p === null) this.pending = zero();
    else if (step > 0 && this.pendingCount() < sheet.freePoints) this.pending[p]++;
    else if (step < 0 && this.pending[p] > 0) this.pending[p]--;
    this.manager?.audio.play('cursor');
    this.render();
  }
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

/** Equipment by slot. */
export class EquipmentWindow extends GameWindow {
  private slot: EquipSlot | null = null;
  private readonly preview = el('div', { className: 'equip-preview' });
  private readonly listArea = el('div', { className: 'equip-list' });

  constructor(private readonly host: SheetHost) {
    super('equipment', t('equip.title'), { className: 'equipment-window' });
    this.body.append(el('div', { className: 'equip-layout' }, [this.listArea, this.preview]));
  }

  refresh(): void {
    if (this.manager?.isOpen(this)) this.render();
  }

  override onOpen(): void {
    this.setTitle(t('equip.title'));
    this.slot = null;
    this.render();
  }

  override handleInput(input: Parameters<GameWindow['handleInput']>[0]): boolean {
    if (this.slot && input.consume('cancel')) {
      this.slot = null;
      this.render();
      return true;
    }
    return super.handleInput(input);
  }

  /** Items of the bag wearable in a slot by this class. */
  private candidates(slot: EquipSlot, sheet: SheetPayload): InventoryEntry[] {
    return this.host.inventory().entries.filter((e) => {
      if (e.slot !== slot || e.kind === 'item') return false;
      const allowed = e.kind === 'weapon' ? sheet.allowedWeaponTypes : sheet.allowedArmorTypes;
      return allowed.length === 0 || allowed.includes(e.equipType ?? 0);
    });
  }

  private render(): void {
    const sheet = this.host.sheet();
    if (!sheet) return;
    if (!this.slot) {
      const items: ListItem[] = EQUIP_SLOTS.map((slot) => {
        const e = sheet.equipment[slot];
        return {
          label: t('equip.slot_line', { slot: tDynamic(`equip.slot.${slot}`), item: e ? e.name : t('equip.none') }),
          icon: e ? e.icon : SLOT_ICONS[slot],
          onSelect: () => {
            this.slot = slot;
            this.render();
          },
          onFocus: () => this.showPreview(sheet, null),
        };
      });
      this.setList(items, this.listArea, true);
      return;
    }
    const slot = this.slot;
    const current = sheet.equipment[slot];
    const items: ListItem[] = this.candidates(slot, sheet).map((e) => ({
      label: e.name,
      icon: e.icon,
      suffix: e.quantity > 1 ? `×${e.quantity}` : '',
      onSelect: () => {
        this.host.equip(slot, e.id);
        this.slot = null;
      },
      onFocus: () => this.showPreview(sheet, diff(e.params ?? zero(), current?.params ?? zero())),
    }));
    if (current) {
      items.push({
        label: t('equip.remove'),
        icon: 'close',
        onSelect: () => {
          this.host.equip(slot, 0);
          this.slot = null;
        },
        onFocus: () => this.showPreview(sheet, diff(zero(), current.params)),
      });
    }
    if (items.length === 0) {
      this.listArea.replaceChildren(el('p', { className: 'bag-empty', text: t('equip.nothing') }));
      this.showPreview(sheet, null);
      return;
    }
    this.setList(items, this.listArea);
    this.listArea.prepend(el('div', { className: 'equip-slot-title', text: tDynamic(`equip.slot.${slot}`) }));
  }

  /** The character drawn in its outfit and its parameters (with the change of the highlighted item). */
  private showPreview(sheet: SheetPayload, change: ParamValues | null): void {
    const sprite = rasterize(drawCharacterFrame(this.host.player().appearance, 'down', 1), 3);
    sprite.className = 'equip-sprite';
    const rows = PARAMS.map((p) => {
      const delta = change?.[p] ?? 0;
      return el('div', { className: 'equip-param' }, [
        el('span', { text: this.host.paramName(p) }),
        el('strong', { text: String(sheet.params[p]) }),
        // The new value and the difference: "→ 34 (+6)".
        delta ? el('span', { className: delta > 0 ? 'better' : 'worse', text: `→ ${sheet.params[p] + delta} (${signed(delta)})` }) : el('span'),
      ]);
    });
    this.preview.replaceChildren(sprite, el('div', { className: 'equip-params' }, rows));
  }
}

/** Parameter changes when replacing `before` with `after`. */
function diff(after: ParamValues, before: ParamValues): ParamValues {
  const out = zero();
  for (const p of PARAMS) out[p] = after[p] - before[p];
  return out;
}
