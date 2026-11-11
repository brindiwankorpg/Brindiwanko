/**
 * @file Heads-up display: player frame (portrait, name, level, HP/MP/XP),
 * target frame, map name banner, minimap, shortcut bar, menu bar (with
 * notification badges) and notifications.
 *
 * The HUD stays light so the world keeps most of the screen. Buttons of
 * features that are not available yet are shown disabled with a tooltip; the
 * administration button exists only for administrators (and every
 * administrative action is checked again by the server).
 */
import { drawFace } from '../../shared/art/face.js';
import type { HotbarSlot } from '../../shared/combat.js';
import type { IconName } from '../../shared/icons.js';
import { tileAt } from '../../shared/map.js';
import { isPassable } from '../../shared/passability.js';
import type { PlayerCharacterInfo } from '../../shared/protocol.js';
import type { PartyView } from '../../shared/guild.js';
import { isTileA1, isTileA3, isTileA4 } from '../../shared/tiles.js';
import { rasterize } from '../art/render.js';
import type { MapScene } from '../engine/scene.js';
import { t, gameTerm } from '../i18n.js';
import type { TranslationKey } from '../../shared/i18n.js';
import { Gauge, el, icon, localized } from './dom.js';

/** A menu bar button. */
export interface MenuButton {
  id: string;
  icon: IconName;
  labelKey: TranslationKey;
  shortcut?: string;
  enabled: boolean;
  onClick?: () => void;
}

/** What the target frame shows (monster or player selected). */
export interface TargetInfo {
  name: string;
  /** Second line (guild tag...). */
  sub: string;
  hp?: number;
  maxHp?: number;
}

/** What a hotbar slot shows. */
export interface HotbarEntry {
  icon: number;
  label: string;
  /** Quantity (items). */
  count?: number;
  /** Not usable now (not enough MP, none left...). */
  disabled?: boolean;
}

/** Drag-and-drop data type of a skill or item dragged to the hotbar. */
export const HOTBAR_DRAG_TYPE = 'application/x-brindiwanko-hotbar';

/** What was dropped on a hotbar slot: a skill or item, or another slot. */
export type HotbarDrop = { slot: HotbarSlot & object } | { from: number };

/**
 * Makes an element draggable to the hotbar.
 * @param slot - Skill or item it places.
 */
export function makeHotbarDraggable(node: HTMLElement, slot: HotbarSlot & object): void {
  node.draggable = true;
  node.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData(HOTBAR_DRAG_TYPE, JSON.stringify({ slot }));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  });
}

/** Reads hotbar drop data (never trusted beyond its shape: the server checks the slot). */
function readDrop(e: DragEvent): HotbarDrop | null {
  try {
    const v = JSON.parse(e.dataTransfer?.getData(HOTBAR_DRAG_TYPE) || 'null') as Record<string, unknown> | null;
    if (v && typeof v.from === 'number') return { from: v.from };
    const slot = v?.slot as Record<string, unknown> | undefined;
    if (slot && (slot.kind === 'skill' || slot.kind === 'item') && typeof slot.id === 'number') return { slot: { kind: slot.kind, id: slot.id } };
  } catch {
    // Not ours.
  }
  return null;
}

/** Longest game term shown whole on a gauge of the player frame. */
const MAX_GAUGE_LABEL = 5;

/** Terrain colours of the minimap (red, green, blue). */
const MINIMAP_COLORS = {
  grass: [0x5f, 0x9e, 0x4a],
  wall: [0x2f, 0x3f, 0x2a],
  shallow: [0x6a, 0x8a, 0xd0],
  water: [0x3a, 0x6a, 0xc8],
  roof: [0xa0, 0x4a, 0x3a],
  cliff: [0x4a, 0x3a, 0x2a],
  path: [0xb0, 0x9a, 0x6a],
} as const satisfies Record<string, readonly [number, number, number]>;

/** The whole HUD. */
export class Hud {
  readonly element: HTMLDivElement;
  private readonly face: HTMLCanvasElement;
  /** Appearance drawn in the portrait (to skip drawing the same one again). */
  private faceLook = '';
  private readonly nameEl: HTMLSpanElement;
  private readonly levelEl: HTMLSpanElement;
  private readonly hp = new Gauge('', 'hp');
  private readonly mp = new Gauge('', 'mp');
  private readonly xp = new Gauge('', 'xp');
  private readonly statesEl = el('div', { className: 'hud-states' });
  private readonly partyEl = el('div', { className: 'hud-party' });
  private readonly banner: HTMLDivElement;
  private readonly mapLabel: HTMLDivElement;
  private readonly minimap: HTMLCanvasElement;
  private minimapBase: HTMLCanvasElement | null = null;
  private readonly toasts: HTMLDivElement;
  /** Shown as long as the connection to the server is lost (a toast would vanish during a long outage). */
  private readonly connectionLost = localized(el('div', { className: 'skin-window toast connection-lost', attrs: { role: 'status', hidden: '' } }), { text: 'game.reconnecting' });
  private readonly menuBar: HTMLDivElement;
  private readonly hotbar: HTMLDivElement;
  /** Cooldown bars of the hotbar slots, in order. */
  private hotbarCooldowns: HTMLElement[] = [];
  private menuButtons: MenuButton[] = [];
  private readonly badges = new Set<string>();
  private bannerTimer: number | undefined;
  private readonly targetEl: HTMLDivElement;
  private readonly targetName = el('div', { className: 'hud-target-name' });
  private readonly targetSub = el('div', { className: 'hud-target-sub' });
  private readonly targetHp = new Gauge('', 'hp');
  private targetKey = '';

  constructor(layer: HTMLElement, onMinimapClick: () => void) {
    this.face = el('canvas', { className: 'hud-face' });
    this.nameEl = el('span', { className: 'hud-name' });
    this.levelEl = el('span', { className: 'hud-level' });
    const frame = el('div', { className: 'skin-window hud-player' }, [
      this.face,
      el('div', { className: 'hud-player-info' }, [
        el('div', { className: 'hud-name-row' }, [this.nameEl, this.levelEl]),
        this.hp.element,
        this.mp.element,
        this.xp.element,
        this.statesEl,
      ]),
    ]);
    this.banner = el('div', { className: 'map-banner' });
    this.mapLabel = el('div', { className: 'map-label' });
    this.minimap = localized(el('canvas', {
      className: 'skin-window minimap',
      attrs: { role: 'button' },
      on: { click: onMinimapClick },
    }), { title: 'hud.minimap', label: 'hud.minimap' });
    this.toasts = el('div', { className: 'toasts', attrs: { 'aria-live': 'polite' } }, [this.connectionLost]);
    this.hotbar = localized(el('div', { className: 'hotbar' }), { label: 'hud.shortcuts' });
    this.setHotbar(Array.from({ length: 8 }, () => null), () => undefined);
    this.menuBar = el('div', { className: 'menu-bar', attrs: { role: 'toolbar' } });
    this.targetEl = el('div', { className: 'skin-window hud-target', attrs: { hidden: '' } }, [this.targetName, this.targetSub, this.targetHp.element]);
    this.element = el('div', { className: 'hud' }, [
      el('div', { className: 'hud-left' }, [frame, this.partyEl]),
      el('div', { className: 'hud-top-right' }, [this.minimap, this.mapLabel]),
      this.targetEl,
      this.banner,
      this.toasts,
      this.hotbar,
      this.menuBar,
    ]);
    layer.append(this.element);
    this.refreshLabels();
  }

  /**
   * Fills the hotbar.
   * @param onUse - Called with the slot index when a slot is clicked.
   * @param onDrop - Called when something is dropped on a slot (`index`), or
   *   when a slot is dragged out of the bar (`index` = -1, `drop.from` = the slot).
   */
  setHotbar(entries: (HotbarEntry | null)[], onUse: (index: number) => void, onDrop?: (index: number, drop: HotbarDrop) => void): void {
    this.hotbarCooldowns = [];
    this.hotbar.replaceChildren(
      ...entries.map((entry, i) => {
        const cooldown = el('span', { className: 'hotbar-cooldown' });
        this.hotbarCooldowns.push(cooldown);
        const slot = el(
          'button',
          {
            className: `hotbar-slot${entry ? '' : ' empty'}${entry?.disabled ? ' disabled' : ''}`,
            title: entry ? `${entry.label} (${i + 1})` : t('hud.hotbar_empty'),
            attrs: { type: 'button' },
            on: { click: () => entry && onUse(i) },
          },
          [
            entry ? icon(entry.icon) : null,
            el('span', { className: 'hotbar-key', text: String(i + 1) }),
            entry?.count !== undefined ? el('span', { className: 'hotbar-count', text: String(entry.count) }) : null,
            cooldown,
          ],
        );
        if (!entry) localized(slot, { title: 'hud.hotbar_empty' });
        if (onDrop) {
          if (entry) {
            slot.draggable = true;
            slot.addEventListener('dragstart', (e) => {
              e.dataTransfer?.setData(HOTBAR_DRAG_TYPE, JSON.stringify({ from: i }));
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            });
            // Dropped outside any slot: the slot is emptied.
            slot.addEventListener('dragend', (e) => {
              if (e.dataTransfer?.dropEffect === 'none') onDrop(-1, { from: i });
            });
          }
          slot.addEventListener('dragover', (e) => {
            if (!e.dataTransfer?.types.includes(HOTBAR_DRAG_TYPE)) return;
            e.preventDefault();
            slot.classList.add('drop-target');
          });
          slot.addEventListener('dragleave', () => slot.classList.remove('drop-target'));
          slot.addEventListener('drop', (e) => {
            slot.classList.remove('drop-target');
            const drop = readDrop(e);
            if (!drop) return;
            e.preventDefault();
            onDrop(i, drop);
          });
        }
        return slot;
      }),
    );
  }

  /** Shows the remaining cooldown of each slot (0 = ready, 1 = just used). */
  setHotbarCooldowns(fractions: number[]): void {
    // Called every frame: the bars are kept from their creation, not looked up in the page again.
    this.hotbarCooldowns.forEach((node, i) => {
      const f = fractions[i] ?? 0;
      const value = f > 0 ? `${Math.round(f * 100)}%` : '0%';
      if (node.style.height !== value) node.style.height = value;
    });
  }

  /**
   * Party frames under the player frame: the other members with their HP and
   * MP, the leader crowned, members on another map greyed out.
   */
  setParty(view: PartyView | null, selfId: number): void {
    const others = view?.members.filter((m) => m.id !== selfId) ?? [];
    this.partyEl.replaceChildren(
      ...others.map((m) => {
        const hp = new Gauge('', 'hp');
        const mp = new Gauge('', 'mp');
        hp.set(m.hp, m.maxHp, false);
        mp.set(m.mp, m.maxMp, false);
        return el('div', { className: `skin-window party-frame${m.near && m.online ? '' : ' far'}` }, [
          el('div', { className: 'party-frame-name', text: `${m.id === view!.leader ? '♛ ' : ''}${m.name} · ${m.online ? m.level : t('friends.offline')}` }),
          hp.element,
          mp.element,
        ]);
      }),
    );
  }

  /** Adds an element under the minimap (quest tracker). */
  addSidePanel(node: HTMLElement): void {
    this.element.querySelector('.hud-top-right')?.append(node);
  }

  /** Re-applies translated labels (after a language switch). */
  refreshLabels(): void {
    this.hp.setLabel(gameTerm('hp'));
    this.mp.setLabel(gameTerm('mp'));
    // A long name ("Expérience") would be cut on small screens: the gauge shows the short interface word.
    const xp = gameTerm('xp');
    this.xp.setLabel(xp.length > MAX_GAUGE_LABEL ? t('hud.xp') : xp, xp);
    this.minimap.title = t('hud.minimap');
    this.setMenu(this.menuButtons);
  }

  /** Updates the player frame. */
  setPlayer(c: PlayerCharacterInfo): void {
    // Called on every vitals update: the portrait is drawn again only when the appearance changed.
    const look = JSON.stringify(c.appearance);
    if (look !== this.faceLook) {
      this.faceLook = look;
      const portrait = rasterize(drawFace(c.appearance), 2);
      this.face.width = portrait.width;
      this.face.height = portrait.height;
      const ctx = this.face.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(portrait, 0, 0);
    }
    this.nameEl.textContent = c.name;
    this.levelEl.textContent = t('hud.level', { level: c.level });
    this.hp.set(c.hp, c.maxHp);
    this.mp.set(c.mp, c.maxMp);
    // Progress within the current level (full at the maximum level).
    const floor = c.xpFloor ?? 0;
    const next = c.xpNext ?? 0;
    if (next > floor) this.xp.set(c.xp - floor, next - floor, false);
    else this.xp.set(1, 1, false);
    this.statesEl.replaceChildren(...(c.states ?? []).map((i) => icon(i)));
  }

  /** Shows the selected target (`null` hides the frame). Cheap to call every frame. */
  setTarget(target: TargetInfo | null): void {
    const key = target ? `${target.name}|${target.sub}|${target.hp}|${target.maxHp}` : '';
    if (key === this.targetKey) return;
    this.targetKey = key;
    this.targetEl.hidden = !target;
    if (!target) return;
    this.targetName.textContent = target.name;
    this.targetSub.textContent = target.sub;
    this.targetSub.hidden = !target.sub;
    this.targetHp.element.hidden = target.hp === undefined;
    if (target.hp !== undefined) this.targetHp.set(target.hp, target.maxHp ?? target.hp);
  }

  /** Shows or hides the notification badge of a menu bar button. */
  setBadge(id: string, on: boolean): void {
    if (on) this.badges.add(id);
    else this.badges.delete(id);
    this.menuBar.querySelector(`[data-id="${id}"]`)?.classList.toggle('badge', on);
  }

  /** Shows the map name in a fading banner, then keeps it discreetly under the minimap. */
  showMapName(name: string): void {
    this.mapLabel.textContent = name;
    if (!name) return;
    this.banner.textContent = name;
    this.banner.classList.remove('visible');
    void this.banner.offsetWidth; // restart the CSS transition
    this.banner.classList.add('visible');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('visible'), 2600);
  }

  /** Shows or hides the "connection lost, reconnecting" notice, which stays until the connection is back. */
  setConnectionLost(lost: boolean): void {
    this.connectionLost.hidden = !lost;
  }

  /** Displays a short notification at the top of the screen. */
  notify(text: string, iconName?: IconName | number): void {
    const toast = el('div', { className: 'skin-window toast' }, [iconName !== undefined ? icon(iconName) : null, el('span', { text })]);
    this.toasts.append(toast);
    window.setTimeout(() => toast.classList.add('leaving'), 3200);
    window.setTimeout(() => toast.remove(), 3700);
  }

  /** Builds the menu bar. */
  setMenu(buttons: MenuButton[]): void {
    this.menuButtons = buttons;
    this.menuBar.replaceChildren(
      ...buttons.map((b) => {
        const label = t(b.labelKey);
        const title = b.enabled ? (b.shortcut ? `${label} (${b.shortcut})` : label) : `${label} — ${t('ui.coming_soon')}`;
        return el(
          'button',
          {
            className: `menu-button${b.id === 'admin' ? ' admin' : ''}${this.badges.has(b.id) ? ' badge' : ''}`,
            title,
            attrs: { type: 'button', 'aria-label': title, 'data-id': b.id, ...(b.enabled ? {} : { disabled: '' }) },
            on: { click: () => b.enabled && b.onClick?.() },
          },
          [icon(b.icon), el('span', { className: 'menu-button-label', text: label })],
        );
      }),
    );
  }

  /** Prepares the minimap background for a map (terrain colours). */
  setMinimapMap(scene: MapScene): void {
    const { map, tileset } = scene;
    const base = document.createElement('canvas');
    base.width = map.width;
    base.height = map.height;
    const ctx = base.getContext('2d')!;
    // One pixel per cell, written into a buffer and put once (not one rectangle per cell).
    const image = ctx.createImageData(map.width, map.height);
    const pixels = image.data;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const ground = tileAt(map, x, y, 0);
        const overlay = tileAt(map, x, y, 1);
        const passable = [2, 4, 6, 8].some((d) => isPassable(map, tileset.flags, x, y, d));
        let color: readonly [number, number, number] = passable ? MINIMAP_COLORS.grass : MINIMAP_COLORS.wall;
        if (isTileA1(ground)) color = passable ? MINIMAP_COLORS.shallow : MINIMAP_COLORS.water;
        else if (isTileA3(ground)) color = MINIMAP_COLORS.roof;
        else if (isTileA4(ground)) color = MINIMAP_COLORS.cliff;
        else if (passable && overlay) color = MINIMAP_COLORS.path;
        const i = (y * map.width + x) * 4;
        pixels[i] = color[0];
        pixels[i + 1] = color[1];
        pixels[i + 2] = color[2];
        pixels[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    this.minimapBase = base;
  }

  /** Redraws the minimap with the player and characters. */
  drawMinimap(scene: MapScene, alpha = 1): void {
    const base = this.minimapBase;
    if (!base) return;
    const cell = Math.max(2, Math.floor(Math.min(160 / base.width, 120 / base.height)));
    const w = base.width * cell;
    const h = base.height * cell;
    if (this.minimap.width !== w || this.minimap.height !== h) {
      this.minimap.width = w;
      this.minimap.height = h;
    }
    const ctx = this.minimap.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0, w, h);
    ctx.fillStyle = '#ffe070';
    for (const { character } of scene.events.values()) {
      if (character.sprite) ctx.fillRect(character.renderX(alpha) * cell, character.renderY(alpha) * cell, cell, cell);
    }
    const px = scene.player.renderX(alpha) * cell;
    const py = scene.player.renderY(alpha) * cell;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px - 1, py - 1, cell + 2, cell + 2);
    ctx.fillStyle = '#ff4040';
    ctx.fillRect(px, py, cell, cell);
  }

  /** Dims the HUD while a dialogue is open. */
  setDimmed(dimmed: boolean): void {
    this.element.classList.toggle('dimmed', dimmed);
  }

  /**
   * Big map rendering for the map window.
   * @param marks - Characters of the map (drawn in yellow, like on the minimap).
   */
  bigMap(player?: { x: number; y: number }, marks: { x: number; y: number }[] = []): HTMLCanvasElement | null {
    if (!this.minimapBase) return null;
    const scale = Math.max(4, Math.floor(Math.min(560 / this.minimapBase.width, 420 / this.minimapBase.height)));
    const c = document.createElement('canvas');
    c.width = this.minimapBase.width * scale;
    c.height = this.minimapBase.height * scale;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.minimapBase, 0, 0, c.width, c.height);
    ctx.fillStyle = '#ffe070';
    for (const m of marks) ctx.fillRect(m.x * scale + 1, m.y * scale + 1, Math.max(1, scale - 2), Math.max(1, scale - 2));
    // Where the player stands, like on the minimap.
    if (player) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(player.x * scale - 2, player.y * scale - 2, scale + 4, scale + 4);
      ctx.fillStyle = '#ff4040';
      ctx.fillRect(player.x * scale, player.y * scale, scale, scale);
    }
    return c;
  }
}
