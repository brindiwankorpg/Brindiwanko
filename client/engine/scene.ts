/**
 * @file The map scene: tile renderer, characters (player and events), camera
 * and drawing order.
 *
 * Draw order: parallax background, lower tiles, characters sorted by their vertical
 * position ("below characters" events first, "above" events last), upper
 * (star) tiles, then effects (balloons, animations); the player names overlay
 * is handled by the UI.
 * The camera follows the player and stops at the map edges; maps smaller than
 * the screen are centred.
 *
 * Looping maps: on an axis that loops the camera does not stop at the edges;
 * the tiles are drawn again past them (as many copies as the screen needs)
 * and every character, effect and marker is drawn at the copy of its position
 * closest to the camera, so what lies beyond an edge is seen before crossing it.
 */
import { drawCharacterBlock, type CharacterAppearance } from '../../shared/art/character.js';
import { Priority, Trigger, type EventView } from '../../shared/events.js';
import { deltaX, deltaY, isValidPosition, loopsHorizontally, loopsVertically, stepCell, wrapCell } from '../../shared/map.js';
import { canMove, isBush, isCounter, isLadder } from '../../shared/passability.js';
import type { ActionView, DamageView, MonsterView } from '../../shared/combat.js';
import type { ClientMap, RemotePlayer } from '../../shared/protocol.js';
import type { TilesetData } from '../../shared/database.js';
import type { Direction } from '../../shared/settings.js';
import { TILESET_SHEETS, type TilesetSheet } from '../../shared/tiles.js';
import { rasterize } from '../art/render.js';
import { animationTicks, drawAnimation } from './animation.js';
import type { AssetStore, Bitmap } from './assets.js';
import { MapCharacter, sheetFlags } from './character.js';
import { MARKER_SIZE, markerImage } from './markers.js';
import { TilemapRenderer } from './tilemap.js';

/** An event on the scene. */
export interface SceneEvent {
  view: EventView;
  character: MapCharacter;
}

/** Another player on the scene. */
export interface SceneRemote {
  info: RemotePlayer;
  character: MapCharacter;
}

/** A monster on the scene. */
export interface SceneMonster {
  view: MonsterView;
  character: MapCharacter;
  hp: number;
  maxHp: number;
  /** Frames left of the hurt blink. */
  hurt: number;
  /** Frames left of the death fade (the monster is gone when it reaches 0). */
  dying: number;
}

/** Something effects can be drawn on: a character, or a fixed cell. */
export type Anchor = { realX: number; realY: number; renderX?: (alpha?: number) => number; renderY?: (alpha?: number) => number };

const anchorX = (a: Anchor, alpha: number): number => (a.renderX ? a.renderX(alpha) : a.realX);
const anchorY = (a: Anchor, alpha: number): number => (a.renderY ? a.renderY(alpha) : a.realY);

/** A floating number (damage, healing, miss). */
interface Popup {
  anchor: Anchor;
  text: string;
  color: string;
  big: boolean;
  age: number;
}

/** Frames a floating number stays. */
const POPUP_FRAMES = 50;
/** Frames of the death fade of a monster. */
const DYING_FRAMES = 24;

/** A balloon or animation playing over a character (`target`: 0 = the player, an event id, or -1 for other anchors). */
interface SceneEffect {
  target: number;
  /** What the effect follows (resolved from `target` when absent). */
  anchor?: Anchor;
  /** Frames elapsed. */
  age: number;
  /** Total duration in frames. */
  duration: number;
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, age: number) => void;
}

/** Balloon sheet layout: 8 frames of 48 px per row, one row per balloon. */
const BALLOON_SIZE = 48;
const BALLOON_FRAMES = 8;
const BALLOON_FRAME_TIME = 8;
const BALLOON_HOLD = 12;

/** Whole numbers from `from` to `to` (inclusive). */
const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/** Generated sprite sheets, shared between scenes and keyed by appearance. */
const spriteCache = new Map<string, HTMLCanvasElement>();
/** Budget for cached RGBA pixels; sprites still used by a scene keep their own reference. */
const SPRITE_CACHE_BYTES = 16 * 1024 * 1024;
let spriteCacheBytes = 0;

/**
 * Returns the sprite sheet of an appearance, keeping recently used sheets in a bounded cache.
 * @param appearance - Character appearance.
 * @param tileSize - Tile size in pixels.
 */
export function appearanceSheet(appearance: CharacterAppearance, tileSize: number): HTMLCanvasElement {
  const key = `${tileSize}:${JSON.stringify(appearance)}`;
  const cached = spriteCache.get(key);
  if (cached) {
    // Map insertion order tracks recency, so the first entry is the next to evict.
    spriteCache.delete(key);
    spriteCache.set(key, cached);
    return cached;
  }
  const sheet = rasterize(drawCharacterBlock(appearance), tileSize / 16);
  const bytes = sheet.width * sheet.height * 4;
  if (bytes > SPRITE_CACHE_BYTES) return sheet;
  while (spriteCacheBytes + bytes > SPRITE_CACHE_BYTES) {
    const oldest = spriteCache.keys().next().value!;
    const evicted = spriteCache.get(oldest)!;
    spriteCacheBytes -= evicted.width * evicted.height * 4;
    spriteCache.delete(oldest);
  }
  spriteCache.set(key, sheet);
  spriteCacheBytes += bytes;
  return sheet;
}

/** A character to draw in a frame, with what its place in the drawing order needs. */
interface DrawEntry {
  c: MapCharacter;
  layer: number;
  monster: SceneMonster | undefined;
  sortY: number;
  /** The local player (drawn last on its row: never hidden by another player on its cell). */
  player: boolean;
  /** Copy of a looping map it is drawn on. */
  shiftX: number;
  shiftY: number;
}

/** Drawing order: priority layer, then row, then the local player last. */
const byDrawOrder = (a: DrawEntry, b: DrawEntry): number => a.layer - b.layer || a.sortY - b.sortY || Number(a.player) - Number(b.player);

/** Everything drawn for the current map. */
export class MapScene {
  readonly renderer: TilemapRenderer;
  readonly player = new MapCharacter();
  readonly events = new Map<number, SceneEvent>();
  readonly remotes = new Map<number, SceneRemote>();
  readonly monsters = new Map<number, SceneMonster>();
  /**
   * Players and monsters out of the server's area of interest: their last position is out of date, so
   * they are set aside (not drawn, not in the way) until the server sends where they are again.
   */
  private readonly unseenRemotes = new Map<number, SceneRemote>();
  private readonly unseenMonsters = new Map<number, SceneMonster>();
  private popups: Popup[] = [];
  /** Camera top-left, in map pixels. */
  cameraX = 0;
  cameraY = 0;
  /**
   * Height (in map pixels) of the interface covering the bottom of the screen (hotbar, menu bar):
   * the camera may go past the bottom edge of the map by that much, so the last rows stay visible.
   */
  bottomInset = 0;
  private shadow: Bitmap | null = null;
  private balloons: Bitmap | null = null;
  private effects: SceneEffect[] = [];
  /** Background image drawn behind the tiles (transparent cells show it). */
  private parallax: Bitmap | null = null;
  /** Auto-scroll offset of the parallax, in pixels. */
  private parallaxScrollX = 0;
  private parallaxScrollY = 0;
  private prevParallaxScrollX = 0;
  private prevParallaxScrollY = 0;
  /** Scrolling of the parallax (from the map, or changed by an event). */
  private parallaxLoop = { x: false, y: false, sx: 0, sy: 0 };
  /**
   * Camera moved away from the player by the "scroll map" command (map pixels),
   * its target and its speed (pixels per frame). It comes back once the player walks.
   */
  private scroll = { x: 0, y: 0, prevX: 0, prevY: 0, tx: 0, ty: 0, speed: 0 };
  private viewW = 0;
  private viewH = 0;
  /** The player's own sprite is hidden (transparency command of an event). */
  playerHidden = false;

  private constructor(
    private readonly assets: AssetStore,
    readonly map: ClientMap,
    readonly tileset: TilesetData,
    sheets: Partial<Record<TilesetSheet, Bitmap>>,
    readonly tileSize: number,
  ) {
    this.renderer = new TilemapRenderer(map, tileset.flags, sheets, tileSize);
    this.loopX = loopsHorizontally(map);
    this.loopY = loopsVertically(map);
    this.prepare(this.player);
  }

  /** The map loops horizontally / vertically. */
  readonly loopX: boolean;
  readonly loopY: boolean;

  /** Gives a character the looping sizes of the map. */
  private prepare(c: MapCharacter): MapCharacter {
    c.loopW = this.loopX ? this.map.width : 0;
    c.loopH = this.loopY ? this.map.height : 0;
    return c;
  }

  /**
   * Moves a character to a cell given by the server: a step to a neighbouring
   * cell (across the edge of a looping map too) is animated, anything else snaps.
   */
  moveCharacter(c: MapCharacter, x: number, y: number): void {
    if (c.x === x && c.y === y) return;
    // Finish the previous step first so that steps never blend diagonally.
    c.realX = c.x;
    c.realY = c.y;
    c.prevX = c.x;
    c.prevY = c.y;
    if (Math.abs(deltaX(this.map, c.x, x)) + Math.abs(deltaY(this.map, c.y, y)) === 1) c.stepTo(x, y);
    else c.locate(x, y);
  }

  /** Shortest offset between two cells (through the edges of a looping map). */
  delta(fromX: number, fromY: number, toX: number, toY: number): { dx: number; dy: number } {
    return { dx: deltaX(this.map, fromX, toX), dy: deltaY(this.map, fromY, toY) };
  }

  /**
   * Offset (in map pixels) of the copy of a position closest to the camera, on
   * a looping map; 0 on an axis that does not loop.
   */
  wrapShift(realX: number, realY: number): { x: number; y: number } {
    return { x: this.wrapShiftX(realX), y: this.wrapShiftY(realY) };
  }

  /** Horizontal part of {@link wrapShift}. */
  private wrapShiftX(realX: number): number {
    if (!this.loopX) return 0;
    const T = this.tileSize;
    const mapW = this.map.width * T;
    return Math.round((this.cameraX + this.viewW / 2 - (realX * T + T / 2)) / mapW) * mapW;
  }

  /** Vertical part of {@link wrapShift}. */
  private wrapShiftY(realY: number): number {
    if (!this.loopY) return 0;
    const T = this.tileSize;
    const mapH = this.map.height * T;
    return Math.round((this.cameraY + this.viewH / 2 - (realY * T + T / 2)) / mapH) * mapH;
  }

  /** Offsets of the copies of the map the screen shows (one, unless the map loops). */
  private mapCopies(ox: number, oy: number): { x: number; y: number }[] {
    const mapW = this.map.width * this.tileSize;
    const mapH = this.map.height * this.tileSize;
    const xs = this.loopX ? range(Math.floor(ox / mapW), Math.floor((ox + this.viewW) / mapW)).map((k) => k * mapW) : [0];
    const ys = this.loopY ? range(Math.floor(oy / mapH), Math.floor((oy + this.viewH) / mapH)).map((k) => k * mapH) : [0];
    return ys.flatMap((y) => xs.map((x) => ({ x, y })));
  }

  /**
   * Loads every image a map needs and builds the scene.
   * @param assets - Asset store.
   * @param map - Map payload.
   * @param tileset - Tileset of the map.
   * @param events - Event views.
   * @param appearance - Player appearance (its sheet is generated locally).
   * @param tileSize - Tile size in pixels.
   */
  static async load(
    assets: AssetStore,
    map: ClientMap,
    tileset: TilesetData,
    events: EventView[],
    appearance: CharacterAppearance,
    tileSize: number,
  ): Promise<MapScene> {
    const sheets: Partial<Record<TilesetSheet, Bitmap>> = {};
    await Promise.all(
      TILESET_SHEETS.map(async (slot, i) => {
        const name = tileset.tilesetNames[i];
        if (!name) return;
        const image = await assets.image('tilesets', name);
        if (image) sheets[slot] = image;
      }),
    );
    const scene = new MapScene(assets, map, tileset, sheets, tileSize);
    scene.shadow = await assets.image('system', 'Shadow1');
    scene.balloons = await assets.image('system', 'Balloon');
    if (map.parallaxName && map.parallaxShow) scene.parallax = await assets.image('parallaxes', map.parallaxName);
    scene.parallaxLoop = { x: map.parallaxLoopX, y: map.parallaxLoopY, sx: map.parallaxSx, sy: map.parallaxSy };
    scene.setPlayerAppearance(appearance);
    await Promise.all(events.map((e) => scene.addEvent(e)));
    // The chunks around the player are built when it is placed (`enterScene`), the rest when they come into view.
    return scene;
  }

  /** Builds the player's sprite from its appearance (generated in the browser). */
  setPlayerAppearance(appearance: CharacterAppearance): void {
    this.player.sprite = { image: appearanceSheet(appearance, this.tileSize), single: true, object: false, index: 0 };
  }

  /** Adds (or refreshes) another player. */
  addRemote(info: RemotePlayer): void {
    this.unseenRemotes.delete(info.id);
    const character = this.remotes.get(info.id)?.character ?? this.prepare(new MapCharacter());
    character.locate(info.x, info.y);
    character.direction = info.direction;
    character.sprite = { image: appearanceSheet(info.appearance, this.tileSize), single: true, object: false, index: 0 };
    this.remotes.set(info.id, { info, character });
  }

  /** Removes another player. */
  removeRemote(id: number): void {
    this.remotes.delete(id);
    this.unseenRemotes.delete(id);
  }

  /** Removes every other player and monster (the map is entered again). */
  clearOthers(): void {
    for (const list of [this.remotes, this.monsters, this.unseenRemotes, this.unseenMonsters]) list.clear();
  }

  /**
   * Sets aside players and monsters the server no longer sends the positions of (out of its area of
   * interest). Ids as in the position messages: a character id, or a negated monster id.
   */
  outOfSight(ids: readonly number[]): void {
    for (const id of ids) {
      if (id > 0) moveEntry(this.remotes, this.unseenRemotes, id);
      // A defeated monster finishes fading out where it fell.
      else if (!this.monsters.get(-id)?.dying) moveEntry(this.monsters, this.unseenMonsters, -id);
    }
  }

  /** Adds (or refreshes) a monster. */
  async addMonster(view: MonsterView): Promise<void> {
    this.unseenMonsters.delete(view.id);
    const character = this.prepare(new MapCharacter());
    character.locate(view.x, view.y);
    character.direction = view.direction;
    character.moveSpeed = view.moveSpeed;
    character.stepAnime = true;
    this.monsters.set(view.id, { view, character, hp: view.hp, maxHp: view.maxHp, hurt: 0, dying: 0 });
    const image = view.characterName ? await this.assets.image('characters', view.characterName) : null;
    if (image && this.monsters.get(view.id)?.character === character) character.sprite = { image, ...sheetFlags(view.characterName), index: view.characterIndex };
  }

  /** Moves or turns a monster (one-cell steps are interpolated). */
  moveMonster(id: number, x: number, y: number, direction: Direction): void {
    const m = this.monsters.get(id) ?? moveEntry(this.unseenMonsters, this.monsters, id);
    if (!m || m.dying) return;
    const c = m.character;
    c.direction = direction;
    this.moveCharacter(c, x, y);
  }

  /** Removes a monster, fading it out when it was defeated. */
  removeMonster(id: number, died: boolean): void {
    this.unseenMonsters.delete(id);
    const m = this.monsters.get(id);
    if (!m) return;
    if (died) m.dying = DYING_FRAMES;
    else this.monsters.delete(id);
  }

  /**
   * Character of a combat actor.
   * @param selfId - Character id of the local player.
   */
  combatant(actor: { kind: 'player' | 'monster'; id: number }, selfId: number): MapCharacter | undefined {
    if (actor.kind === 'monster') return this.monsters.get(actor.id)?.character;
    return actor.id === selfId ? this.player : this.remotes.get(actor.id)?.character;
  }

  /**
   * Shows the result of a hit as a floating number (and updates the monster's bar).
   * @param popup - `false` only updates the bar (floating numbers turned off in the options).
   */
  showDamage(anchor: Anchor, view: DamageView, popup = true): void {
    if (view.target.kind === 'monster') {
      const m = this.monsters.get(view.target.id) ?? this.unseenMonsters.get(view.target.id);
      if (m) {
        m.hp = view.hp;
        m.maxHp = view.maxHp;
        if (view.kind === 'hp_damage') m.hurt = 12;
      }
    }
    if (!popup) return;
    const text = view.kind === 'miss' ? 'Miss' : `${view.kind.endsWith('recover') ? '+' : ''}${view.amount}`;
    const color = view.kind === 'miss' ? '#d8d8d8' : view.kind === 'hp_recover' ? '#7dff8a' : view.kind === 'mp_recover' ? '#7fc4ff' : view.kind === 'mp_damage' ? '#c690ff' : view.target.kind === 'player' ? '#ff6a5a' : '#ffffff';
    this.popups.push({ anchor: { realX: anchor.realX, realY: anchor.realY }, text: view.critical ? `${text}!` : text, color: view.critical ? '#ffd23a' : color, big: view.critical, age: 0 });
  }

  /**
   * Marks an area of the ground about to be hit by a boss: a red square of
   * cells that fills up until the blow.
   */
  showTelegraph(x: number, y: number, radius: number, ms: number): void {
    const T = this.tileSize;
    const duration = Math.max(6, Math.round((ms / 1000) * 60));
    this.effects.push({
      target: -1,
      anchor: { realX: x, realY: y },
      age: 0,
      duration,
      draw: (ctx, _x, _y, age) => {
        const t = age / duration;
        const size = (radius * 2 + 1) * T;
        const left = (x - radius) * T;
        const top = (y - radius) * T;
        ctx.save();
        ctx.fillStyle = `rgba(220, 30, 30, ${0.15 + 0.25 * t})`;
        ctx.fillRect(left, top, size, size);
        ctx.strokeStyle = `rgba(255, 90, 60, ${0.6 + 0.4 * Math.sin(age / 3)})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(left + 1.5, top + 1.5, size - 3, size - 3);
        // The inner square grows until the blow.
        const inner = size * t;
        ctx.fillStyle = 'rgba(255, 60, 40, 0.35)';
        ctx.fillRect(left + (size - inner) / 2, top + (size - inner) / 2, inner, inner);
        ctx.restore();
      },
    });
  }

  /**
   * Plays the visual of an attack or skill: a slash in front of melee
   * attackers, a projectile flying to the first target cell for ranged ones.
   */
  showAction(user: MapCharacter, action: ActionView): void {
    const T = this.tileSize;
    const target = action.targets[0];
    if (action.range > 1 && target) {
      const from = { x: user.realX, y: user.realY };
      const dist = Math.max(1, Math.abs(target.x - user.x) + Math.abs(target.y - user.y));
      const duration = Math.min(30, 4 + dist * 3);
      this.effects.push({
        target: -1,
        anchor: { realX: target.x, realY: target.y },
        age: 0,
        duration,
        draw: (ctx, _x, _y, age) => {
          const t = age / duration;
          const px = (from.x + (target.x - from.x) * t) * T + T / 2;
          const py = (from.y + (target.y - from.y) * t) * T + T / 2;
          ctx.save();
          ctx.fillStyle = action.skillId ? '#ffe38a' : '#f4f1e6';
          ctx.shadowColor = action.skillId ? '#ff9a2a' : '#ffffff';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(px, py, action.skillId ? 7 : 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        },
      });
      return;
    }
    const angle = { 2: Math.PI / 2, 4: Math.PI, 6: 0, 8: -Math.PI / 2 }[action.direction];
    this.effects.push({
      target: -1,
      anchor: user,
      age: 0,
      duration: 12,
      draw: (ctx, x, y, age) => {
        const cx = x + Math.cos(angle) * T * 0.55;
        const cy = y + T * 0.95 + Math.sin(angle) * T * 0.55;
        const t = age / 12;
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = action.skillId ? '#ffd35a' : '#ffffff';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx, cy, T * 0.45, angle - 1.1 + t * 0.9, angle + 0.1 + t * 0.9);
        ctx.stroke();
        ctx.restore();
      },
    });
  }

  /**
   * Applies a position update of another player. One-cell steps are
   * interpolated; anything else (teleport, lag spike) snaps.
   */
  moveRemote(id: number, x: number, y: number, direction: Direction): void {
    const remote = this.remotes.get(id) ?? moveEntry(this.unseenRemotes, this.remotes, id);
    if (!remote) return;
    const c = remote.character;
    c.direction = direction;
    remote.info = { ...remote.info, x, y, direction };
    this.moveCharacter(c, x, y);
  }

  /** Adds or replaces an event. */
  async addEvent(view: EventView): Promise<void> {
    const character = this.events.get(view.id)?.character ?? this.prepare(new MapCharacter());
    character.locate(view.x, view.y);
    this.applyView(character, view);
    this.events.set(view.id, { view, character });
    const name = view.image.characterName;
    if (name && view.image.tileId === 0) {
      const image = await this.assets.image('characters', name);
      if (image) character.sprite = { image, ...sheetFlags(name), index: view.image.characterIndex };
    }
  }

  /** Removes an event (no page applies to the player any more). */
  removeEvent(id: number): void {
    this.events.delete(id);
  }

  /**
   * Updates an event from a new view (move route setting, page change). Its
   * current position is kept when the view only differs by settings.
   */
  async updateEvent(view: EventView): Promise<void> {
    const existing = this.events.get(view.id);
    if (!existing) {
      await this.addEvent(view);
      return;
    }
    const c = existing.character;
    const sameImage = existing.view.image.characterName === view.image.characterName && existing.view.image.characterIndex === view.image.characterIndex && existing.view.image.tileId === view.image.tileId;
    if (c.x !== view.x || c.y !== view.y) c.locate(view.x, view.y);
    this.applyView(c, view);
    existing.view = view;
    if (sameImage) return;
    c.sprite = null;
    const name = view.image.characterName;
    if (name && view.image.tileId === 0) {
      const image = await this.assets.image('characters', name);
      if (image && this.events.get(view.id)?.view === view) c.sprite = { image, ...sheetFlags(name), index: view.image.characterIndex };
    }
  }

  /** Character of an effect target (0 = the player). */
  private targetCharacter(target: number): MapCharacter | undefined {
    return target === 0 ? this.player : this.events.get(target)?.character;
  }

  /** What an effect is drawn on. */
  private effectAnchor(e: SceneEffect): Anchor | undefined {
    return e.anchor ?? this.targetCharacter(e.target);
  }

  /**
   * Shows an emotion balloon over a character.
   * @param target - 0 for the player, otherwise an event id.
   * @param balloon - Balloon number (1 = exclamation...).
   */
  showBalloon(target: number, balloon: number, anchor?: Anchor): void {
    const sheet = this.balloons;
    if (!sheet) return;
    const row = Math.min(balloon, sheet.height / BALLOON_SIZE) - 1;
    this.effects = this.effects.filter((e) => (anchor ? e.anchor !== anchor : e.target !== target) || e.duration !== BALLOON_FRAMES * BALLOON_FRAME_TIME + BALLOON_HOLD);
    this.effects.push({
      target,
      anchor,
      age: 0,
      duration: BALLOON_FRAMES * BALLOON_FRAME_TIME + BALLOON_HOLD,
      draw: (ctx, x, y, age) => {
        const frame = Math.min(BALLOON_FRAMES - 1, Math.floor(age / BALLOON_FRAME_TIME));
        ctx.drawImage(sheet, frame * BALLOON_SIZE, row * BALLOON_SIZE, BALLOON_SIZE, BALLOON_SIZE, Math.round(x - BALLOON_SIZE / 2), Math.round(y - BALLOON_SIZE), BALLOON_SIZE, BALLOON_SIZE);
      },
    });
  }

  /**
   * Plays an animation over a character: frames of the animation sheet (a
   * row of square frames), or a generated sparkle when there is no sheet.
   */
  showAnimation(target: number, sheet: Bitmap | null, frameCount: number, frameSize: number, fps: number, anchor?: Anchor): void {
    const duration = animationTicks(frameCount, fps);
    const T = this.tileSize;
    this.effects.push({
      target,
      anchor,
      age: 0,
      duration,
      draw: (ctx, x, y, age) => drawAnimation(ctx, sheet, frameCount, frameSize, x, y + T * 0.85, T, age / duration),
    });
  }

  private applyView(c: MapCharacter, view: EventView): void {
    c.direction = view.image.direction;
    c.pattern = view.image.pattern;
    c.tileId = view.image.tileId;
    c.walkAnime = view.walkAnime;
    c.stepAnime = view.stepAnime;
    c.directionFix = view.directionFix;
    c.moveSpeed = view.moveSpeed;
  }

  /**
   * Tells whether a solid event (same priority as characters) stands on a cell.
   * @param withSprite - Only events drawn with a character sprite.
   */
  solidEventAt(x: number, y: number, withSprite = false): boolean {
    for (const { view, character } of this.events.values()) {
      if (character.x !== x || character.y !== y || view.priorityType !== Priority.Same) continue;
      if (!withSprite || (character.sprite && character.tileId === 0)) return true;
    }
    return false;
  }

  /** Tells whether a solid event occupies a cell. */
  isBlockedByEvent(x: number, y: number): boolean {
    for (const { view, character } of this.events.values()) {
      if (character.x === x && character.y === y && view.priorityType === Priority.Same && !view.through) return true;
    }
    return false;
  }

  /** Client-side prediction of a step (the server has the final word). */
  canStep(x: number, y: number, d: Direction): boolean {
    if (!canMove(this.map, this.tileset.flags, x, y, d)) return false;
    const next = stepCell(this.map, x, y, d);
    return !this.isBlockedByEvent(next.x, next.y) && !this.monsterAt(next.x, next.y);
  }

  /** Tells whether a step is stopped only by a solid event (the server decides whether it is touch-triggered). */
  bumpsEvent(x: number, y: number, d: Direction): boolean {
    if (!canMove(this.map, this.tileset.flags, x, y, d)) return false;
    const next = stepCell(this.map, x, y, d);
    return this.isBlockedByEvent(next.x, next.y);
  }

  /** Tells whether a living monster stands on a cell. */
  monsterAt(x: number, y: number): boolean {
    for (const m of this.monsters.values()) if (!m.dying && m.character.x === x && m.character.y === y) return true;
    return false;
  }

  /** Tells whether the Action button can start an event under or in front of the player (including across a counter). */
  hasActionEvent(): boolean {
    const px = this.player.x;
    const py = this.player.y;
    const dir = this.player.direction;
    for (const { view, character } of this.events.values()) {
      if (character.x === px && character.y === py && view.priorityType !== Priority.Same && view.trigger === Trigger.Action) return true;
    }
    const facing = (x: number, y: number) => {
      for (const { view, character } of this.events.values()) {
        if (character.x === x && character.y === y && view.priorityType === Priority.Same && view.trigger <= Trigger.EventTouch) return true;
      }
      return false;
    };
    const front = stepCell(this.map, px, py, dir);
    if (facing(front.x, front.y)) return true;
    if (isCounter(this.map, this.tileset.flags, front.x, front.y)) {
      const beyond = stepCell(this.map, front.x, front.y, dir);
      if (facing(beyond.x, beyond.y)) return true;
    }
    return false;
  }

  /** Advances one frame. */
  update(): void {
    this.renderer.animationCount++;
    // Looping parallaxes scroll by themselves (sx/sy are in 1/2 pixel per frame units).
    this.prevParallaxScrollX = this.parallaxScrollX;
    this.prevParallaxScrollY = this.parallaxScrollY;
    if (this.parallaxLoop.x) this.parallaxScrollX += this.parallaxLoop.sx / 2;
    if (this.parallaxLoop.y) this.parallaxScrollY += this.parallaxLoop.sy / 2;
    this.updateScroll();
    const flags = this.tileset.flags;
    const others = [...this.events.values(), ...this.remotes.values(), ...this.monsters.values()].map((e) => e.character);
    for (const c of [this.player, ...others]) {
      c.update();
      c.bush = !c.isMoving() && isBush(this.map, flags, c.x, c.y);
      // On a ladder, characters face up (as the server has it).
      if (isLadder(this.map, flags, c.x, c.y)) c.direction = 8;
    }
    for (const [id, m] of this.monsters) {
      if (m.hurt > 0) m.hurt--;
      if (m.dying > 0 && --m.dying === 0) this.monsters.delete(id);
    }
    for (const e of this.effects) e.age++;
    this.effects = this.effects.filter((e) => e.age < e.duration && this.effectAnchor(e));
    for (const p of this.popups) p.age++;
    this.popups = this.popups.filter((p) => p.age < POPUP_FRAMES);
    this.updateCamera();
  }

  /**
   * Moves the camera away from the player ("scroll map" command).
   * @param distance - Cells.
   * @param speed - 1–6, like a character's walking speed.
   */
  scrollMap(direction: Direction, distance: number, speed: number): void {
    const T = this.tileSize;
    this.scroll.tx += (direction === 4 ? -1 : direction === 6 ? 1 : 0) * distance * T;
    this.scroll.ty += (direction === 8 ? -1 : direction === 2 ? 1 : 0) * distance * T;
    this.scroll.speed = (2 ** speed / 256) * T;
  }

  private updateScroll(): void {
    const sc = this.scroll;
    sc.prevX = sc.x;
    sc.prevY = sc.y;
    // Walking brings the camera back on the player.
    if (this.player.isMoving() && (sc.tx || sc.ty)) {
      sc.tx = 0;
      sc.ty = 0;
      sc.speed = Math.max(sc.speed, (16 / 256) * this.tileSize * 2);
    }
    const toward = (v: number, t: number) => (v < t ? Math.min(t, v + sc.speed) : Math.max(t, v - sc.speed));
    sc.x = toward(sc.x, sc.tx);
    sc.y = toward(sc.y, sc.ty);
  }

  /** Replaces the background (event command); an empty name removes it. */
  async setParallax(name: string, loopX: boolean, loopY: boolean, sx: number, sy: number): Promise<void> {
    this.parallaxLoop = { x: loopX, y: loopY, sx, sy };
    this.parallaxScrollX = 0;
    this.parallaxScrollY = 0;
    this.prevParallaxScrollX = 0;
    this.prevParallaxScrollY = 0;
    this.parallax = name ? await this.assets.image('parallaxes', name) : null;
  }

  /** Sets the viewport size in CSS pixels (before zoom). */
  resize(width: number, height: number): void {
    this.viewW = width;
    this.viewH = height;
    this.updateCamera();
  }

  private updateCamera(alpha = 1): void {
    const T = this.tileSize;
    const mapW = this.map.width * T;
    const mapH = this.map.height * T;
    const scrollX = this.scroll.prevX + (this.scroll.x - this.scroll.prevX) * alpha;
    const scrollY = this.scroll.prevY + (this.scroll.y - this.scroll.prevY) * alpha;
    const cx = this.player.renderX(alpha) * T + T / 2 - this.viewW / 2 + scrollX;
    const cy = this.player.renderY(alpha) * T + T / 2 - this.viewH / 2 + scrollY;
    // A looping axis has no edge: the camera simply follows the player.
    this.cameraX = this.loopX ? cx : mapW <= this.viewW ? (mapW - this.viewW) / 2 : Math.min(Math.max(cx, 0), mapW - this.viewW);
    // Past the bottom edge by the height of the interface, so the player never walks under it.
    const maxY = mapH - this.viewH + this.bottomInset;
    this.cameraY = this.loopY ? cy : maxY <= 0 ? Math.max((mapH - this.viewH) / 2, maxY) : Math.min(Math.max(cy, 0), maxY);
  }

  /** Converts a viewport point (CSS pixels, before zoom) to a map cell, or `null` outside. */
  cellAt(px: number, py: number): { x: number; y: number } | null {
    const cell = wrapCell(this.map, Math.floor((px + this.cameraX) / this.tileSize), Math.floor((py + this.cameraY) / this.tileSize));
    return isValidPosition(this.map, cell.x, cell.y) ? cell : null;
  }

  /**
   * Draws the scene.
   * @param ctx - Context already scaled so that one unit = one CSS pixel at zoom 1.
   * @param alpha - Sub-frame interpolation factor (0..1) between the previous and current 60 Hz ticks.
   */
  render(ctx: CanvasRenderingContext2D, alpha = 1): void {
    this.updateCamera(alpha);
    const T = this.tileSize;
    // Snap the camera to whole DEVICE pixels (not CSS pixels): with a zoom or a
    // screen scale such as 125 %, a CSS-pixel offset lands between device
    // pixels and the edges of the cached map chunks show thin dark seams.
    const scale = ctx.getTransform().a || 1;
    const ox = Math.round(this.cameraX * scale) / scale;
    const oy = Math.round(this.cameraY * scale) / scale;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    if (this.parallax) this.drawParallax(ctx, ox, oy, alpha);
    ctx.save();
    ctx.translate(-ox, -oy);
    const copies = this.mapCopies(ox, oy);
    for (const copy of copies) {
      ctx.save();
      ctx.translate(copy.x, copy.y);
      this.renderer.drawLower(ctx, ox - copy.x, oy - copy.y, this.viewW, this.viewH);
      ctx.restore();
    }
    const drawTile = (id: number, dx: number, dy: number) => this.renderer.drawTile(ctx, id, dx, dy, this.renderer.animationFrame);
    // Characters in view only (culled before sorting), each sort key computed once; the list and its
    // entries are reused from one frame to the next.
    const list = this.drawList;
    list.length = 0;
    this.drawUsed = 0;
    if (!this.playerHidden) this.queueDraw(this.player, 1, undefined, alpha, ox, oy);
    for (const { view, character } of this.events.values()) this.queueDraw(character, view.priorityType, undefined, alpha, ox, oy);
    for (const { character } of this.remotes.values()) this.queueDraw(character, 1, undefined, alpha, ox, oy);
    for (const m of this.monsters.values()) this.queueDraw(m.character, 1, m, alpha, ox, oy);
    list.sort(byDrawOrder);
    for (const { c, monster, shiftX, shiftY } of list) {
      ctx.save();
      ctx.translate(shiftX, shiftY);
      if (monster && (monster.dying || monster.hurt)) {
        ctx.save();
        // Hurt monsters blink; defeated ones fade out while rising a little.
        ctx.globalAlpha = monster.dying ? monster.dying / DYING_FRAMES : monster.hurt % 4 < 2 ? 0.45 : 1;
        if (monster.dying) ctx.translate(0, -(DYING_FRAMES - monster.dying));
        c.draw(ctx, T, this.shadow, drawTile, alpha);
        ctx.restore();
      } else {
        c.draw(ctx, T, this.shadow, drawTile, alpha);
      }
      ctx.restore();
    }
    for (const copy of copies) {
      ctx.save();
      ctx.translate(copy.x, copy.y);
      this.renderer.drawUpper(ctx, ox - copy.x, oy - copy.y, this.viewW, this.viewH);
      ctx.restore();
    }
    this.drawMonsterBars(ctx, alpha);
    this.drawMarkers(ctx, alpha);
    for (const effect of this.effects) {
      const c = this.effectAnchor(effect);
      if (!c) continue;
      const rx = anchorX(c, alpha);
      const ry = anchorY(c, alpha);
      const shift = this.wrapShift(rx, ry);
      effect.draw(ctx, rx * T + T / 2 + shift.x, ry * T - T * 0.45 + shift.y, effect.age);
    }
    this.drawPopups(ctx, alpha);
    ctx.restore();
  }

  /** Characters to draw this frame, in drawing order once sorted. */
  private readonly drawList: DrawEntry[] = [];
  /** Entries kept for reuse, and how many of them this frame took. */
  private readonly drawPool: DrawEntry[] = [];
  private drawUsed = 0;

  /** Adds a character to this frame's drawing list, unless it is far outside the view. */
  private queueDraw(c: MapCharacter, layer: number, monster: SceneMonster | undefined, alpha: number, ox: number, oy: number): void {
    const T = this.tileSize;
    const rx = c.renderX(alpha);
    const ry = c.renderY(alpha);
    const shiftX = this.wrapShiftX(rx);
    const shiftY = this.wrapShiftY(ry);
    const left = rx * T + shiftX;
    const top = ry * T + shiftY;
    if (left + 2 * T < ox || left - T > ox + this.viewW || top + T < oy || top - 2 * T > oy + this.viewH) return;
    let entry = this.drawPool[this.drawUsed];
    if (!entry) {
      entry = { c, layer, monster, sortY: 0, player: false, shiftX: 0, shiftY: 0 };
      this.drawPool.push(entry);
    }
    this.drawUsed++;
    entry.c = c;
    entry.layer = layer;
    entry.monster = monster;
    entry.sortY = c.sortY(alpha);
    entry.player = c === this.player;
    entry.shiftX = shiftX;
    entry.shiftY = shiftY;
    this.drawList.push(entry);
  }

  /** HP bars above hurt monsters. */
  private drawMonsterBars(ctx: CanvasRenderingContext2D, alpha = 1): void {
    const T = this.tileSize;
    for (const m of this.monsters.values()) {
      if (m.dying || m.hp >= m.maxHp) continue;
      const w = Math.round(T * 0.75);
      const rx = m.character.renderX(alpha);
      const ry = m.character.renderY(alpha);
      const shift = this.wrapShift(rx, ry);
      const x = Math.round(rx * T + (T - w) / 2 + shift.x);
      const y = Math.round(ry * T - T * 0.25 + shift.y);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(x - 1, y - 1, w + 2, 6);
      const rate = Math.max(0, m.hp / Math.max(1, m.maxHp));
      ctx.fillStyle = rate > 0.5 ? '#5ad65a' : rate > 0.25 ? '#e6c12e' : '#e0463a';
      ctx.fillRect(x, y, Math.round(w * rate), 4);
    }
  }

  /** Floating numbers, rising and fading. */
  private drawPopups(ctx: CanvasRenderingContext2D, alpha = 1): void {
    const T = this.tileSize;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    for (const p of this.popups) {
      const t = p.age / POPUP_FRAMES;
      // A quick bounce, then a slow rise.
      const rise = p.age < 8 ? Math.sin((p.age / 8) * Math.PI) * 10 : (p.age - 8) * 0.5;
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.font = `800 ${p.big ? 22 : 16}px "Segoe UI", system-ui, sans-serif`;
      const rx = anchorX(p.anchor, alpha);
      const ry = anchorY(p.anchor, alpha);
      const shift = this.wrapShift(rx, ry);
      const x = rx * T + T / 2 + shift.x;
      const y = ry * T - T * 0.1 - rise + shift.y;
      ctx.strokeText(p.text, x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, x, y);
    }
    ctx.restore();
  }

  /** Quest markers above events ("!" / "?"), bobbing gently; hidden while a balloon plays. */
  private drawMarkers(ctx: CanvasRenderingContext2D, alpha = 1): void {
    const T = this.tileSize;
    const bob = Math.round(Math.sin(performance.now() / 260) * 2);
    for (const { view, character } of this.events.values()) {
      const image = view.marker ? markerImage(view.marker) : null;
      if (!image || this.effects.some((e) => e.target === view.id)) continue;
      const rx = character.renderX(alpha);
      const ry = character.renderY(alpha);
      const shift = this.wrapShift(rx, ry);
      const x = Math.round(rx * T + T / 2 - MARKER_SIZE / 2 + shift.x);
      const y = Math.round(ry * T - T * 0.55 - MARKER_SIZE + bob + shift.y);
      ctx.drawImage(image, x, y, MARKER_SIZE, MARKER_SIZE);
    }
  }

  /** Tiles the parallax image; it follows the camera at half speed for a sense of depth. */
  private drawParallax(ctx: CanvasRenderingContext2D, ox: number, oy: number, alpha = 1): void {
    const img = this.parallax!;
    const w = img.width;
    const h = img.height;
    const scrollX = this.prevParallaxScrollX + (this.parallaxScrollX - this.prevParallaxScrollX) * alpha;
    const scrollY = this.prevParallaxScrollY + (this.parallaxScrollY - this.prevParallaxScrollY) * alpha;
    const px = (((ox / 2 - scrollX) % w) + w) % w;
    const py = (((oy / 2 - scrollY) % h) + h) % h;
    for (let y = -py; y < this.viewH; y += h) for (let x = -px; x < this.viewW; x += w) ctx.drawImage(img, Math.round(x), Math.round(y));
  }

  /** Screen position (CSS pixels) of a character's head, for names and bubbles. */
  headPosition(c: MapCharacter, alpha = 1): { x: number; y: number } {
    const T = this.tileSize;
    const rx = c.renderX(alpha);
    const ry = c.renderY(alpha);
    const shift = this.wrapShift(rx, ry);
    return { x: rx * T + T / 2 - this.cameraX + shift.x, y: ry * T - T * 0.9 - this.cameraY + shift.y };
  }
}

/** Moves an entry from one map to another; returns it (`undefined` when absent). */
function moveEntry<T>(from: Map<number, T>, to: Map<number, T>, id: number): T | undefined {
  const entry = from.get(id);
  if (entry === undefined) return undefined;
  from.delete(id);
  to.set(id, entry);
  return entry;
}
