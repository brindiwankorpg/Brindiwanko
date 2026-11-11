/**
 * @file The live game world: loaded maps, connected players, the server tick.
 *
 * The server is authoritative: clients send intents (step, turn, action) and
 * the world validates each of them against the map rules before applying it.
 * Every map is a socket.io room (`map:<id>`); what happens on a map is sent to
 * that room only. Position changes are collected and flushed to each room at
 * the tick rate (20 Hz) as compact tuples, which keeps traffic low when many
 * players walk around.
 *
 * Hot state (positions, directions, vitals) lives in memory and is written to
 * SQLite in batches: periodically, when a player leaves, and at shutdown.
 * Story progress is written through at once by the progression repository.
 *
 * Movement validation: a step must go to an adjacent passable cell, and steps
 * are rate-limited with a small token bucket (one token per step, refilled
 * slightly faster than the normal walking speed) so that network jitter is
 * tolerated but speed hacks are not. Moves predicted by a client before it
 * learnt of a rejection carry an old movement epoch and are dropped.
 *
 * Events: every player has its own copy of the events of its map, with the
 * page resolved from its own progress (see map-runtime.ts). Event commands
 * run on the server for that player only (events.ts). The world re-resolves
 * pages whenever something they depend on changes and sends the player the
 * events that look different.
 */
import type { Server, Socket } from 'socket.io';
import { Trigger } from '../../shared/events.js';
import { deltaX, deltaY, isValidPosition, loopsHorizontally, loopsVertically } from '../../shared/map.js';
import { isCounter, isDamageFloor, isLadder } from '../../shared/passability.js';
import type {
  AccountRole,
  AnnounceMode,
  ClientToServerEvents,
  EnterWorldPayload,
  InterServerEvents,
  MapPayload,
  RemotePlayer,
  ServerToClientEvents,
  SocketData,
} from '../../shared/protocol.js';
import { DEFAULT_SETTINGS, type DataName, type Direction, type StartPosition } from '../../shared/settings.js';
import type { CharacterAppearance } from '../../shared/art/character.js';
import type { ServerContext } from '../context.js';
import type { Character } from '../db/characters.js';
import type { ItemKind } from '../db/inventory.js';
import type { CharacterProgress, GlobalProgress } from '../db/progression.js';
import type { HotbarSlot } from '../../shared/combat.js';
import type { ShopGood } from '../../shared/character.js';
import type { ParamName } from '../../shared/database.js';
import { AoiGrid } from './aoi-grid.js';
import { CharacterSheet } from './character-sheet.js';
import { SocialService, emptySocial, type PlayerSocial } from './social.js';
import { TradeService } from './trade.js';
import { PartyService } from './party.js';
import { GuildService } from './guild.js';
import { registerModerationCommands } from './moderation-commands.js';
import { InstanceService } from './instances.js';
import { RaidService } from './raids.js';
import { CombatSystem } from './combat.js';
import type { ActiveStates, BattlerStats } from './stats.js';
import { EventRunner } from './events.js';
import { MapRuntime, type EventInstance, type EventSet } from './map-runtime.js';
import { playerInfo } from './player-info.js';
import { QuestService } from './quests.js';

/** Typed server-side socket. */
export type PlayerSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
/** Typed socket.io server. */
export type WorldIo = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** Milliseconds per step at the normal walking speed (4 → 16 frames at 60 fps). */
export const STEP_MS = 1000 / 3.75;
/** Token bucket capacity: steps that may arrive in a burst after network jitter. */
const STEP_BURST = 3;
/** Refill interval: 15 % faster than walking, to absorb timer drift. */
const STEP_REFILL_MS = STEP_MS * 0.85;
/** Server tick rate. */
export const TICK_HZ = 20;
/**
 * Area of interest: a player only receives the movements of the players and
 * monsters within this many cells (larger than any screen).
 */
export const AOI_RADIUS = 24;
/** A loaded map nobody stood on for this long is freed (read again when someone comes). */
const IDLE_MAP_RELEASE_MS = 10 * 60_000;
/** Autosave period. */
const AUTOSAVE_MS = 60_000;

/** A connected player. */
export interface PlayerSession {
  characterId: number;
  accountId: number;
  name: string;
  appearance: CharacterAppearance;
  socket: PlayerSocket;
  mapId: number;
  x: number;
  y: number;
  direction: Direction;
  hp: number;
  mp: number;
  classId: number;
  level: number;
  xp: number;
  /** Running an event (dialogue...): movement is frozen for this player only. */
  busy: boolean;
  stepTokens: number;
  lastRefill: number;
  /** Movement epoch, bumped at each rejection, transfer or forced move. */
  epoch: number;
  /** Time of the last save, for play time accounting. */
  savedAt: number;
  /** Personal story progress. */
  progress: CharacterProgress;
  /** Events of the current map as seen by this player. */
  events: EventSet;
  /** Bumped at every map change: runs started on a previous map stop. */
  mapGen: number;
  /** Instance of an instanced map (0 = the shared world). */
  instance: number;
  /** Combat state (see combat.ts). */
  combat: PlayerCombat;
  /** Parameter points distributed by the player. */
  allocated: Partial<Record<ParamName, number>>;
  /** Window opened by an event (shop, bank): its actions are accepted only while it is open. */
  ui: PlayerUi | null;
  /** Friends, ignore list, chat flood state. */
  social: PlayerSocial;
  /** Guild and rank (null: no guild). */
  guild: { id: number; rank: number } | null;
  /** Chat mute of the account, read from the database once (undefined: not read yet, null: not muted). */
  mute?: { until: string; reason: string } | null;
  /** Hidden from the other players (administrator tool). */
  invisible?: boolean;
  /** An administrator with the map editor open over the game: monsters and other players leave it alone. */
  editing?: boolean;
  /** End of the timer started by an event (ms), while it runs. */
  timerEnd?: number;
  /** Entities (character id for players, negated id for monsters) whose position this client knows, within its area of interest. */
  aoi: Set<number>;
}

/** Shop or bank opened by an event. */
export type PlayerUi = { kind: 'shop'; goods: ShopGood[]; purchaseOnly: boolean } | { kind: 'bank' };

/** Combat state of a player. */
export interface PlayerCombat {
  dead: boolean;
  states: ActiveStates;
  /** Cached battle parameters (null = to compute). */
  stats: BattlerStats | null;
  nextAttackAt: number;
  globalReadyAt: number;
  /** Time each skill is ready again. */
  cooldowns: Map<number, number>;
  hotbar: HotbarSlot[];
  /** Skills learned outside the class (skill books, events), in the order they were learned. */
  learned: number[];
  /** Cells walked since each active state removed by walking was applied. */
  stateSteps: Map<number, number>;
  /** Skills given by traits (equipment, states) when the skill list was last sent. */
  granted: number[];
  /** Last time the player was hurt (regeneration starts a while after). */
  lastHurt: number;
  /** Arrival protection: monsters ignore the player until this time (loading screen), or until it attacks. */
  protectedUntil: number;
  /** Earliest time to tell again that a raid boss waits for more players. */
  bossWaitNoticeAt?: number;
  /** While knocked out: when the player reappears. */
  respawnAt?: number;
}

/** How long a player is left alone by monsters after logging in (the client is still loading). */
export const JOIN_PROTECTION_MS = 8000;
/** Same, after changing map. */
export const TRANSFER_PROTECTION_MS = 3000;

/** Name of the socket.io room of a map (or of one instance of an instanced map). */
export const mapRoom = (mapId: number, instance = 0): string => (instance ? `map:${mapId}:${instance}` : `map:${mapId}`);

/** Tells whether two players are in the same place (same map and same instance). */
export const sameZone = (a: { mapId: number; instance: number }, b: { mapId: number; instance: number }): boolean => a.mapId === b.mapId && a.instance === b.instance;

/** The game world. */
export class World {
  private readonly maps = new Map<number, MapRuntime>();
  /** Loaded maps without players, by when they became empty. */
  private readonly emptyMaps = new Map<number, number>();
  private readonly players = new Map<number, PlayerSession>();
  /** Connected players by zone (room name) and by map, so that "who is here" does not scan every player of the server. */
  private readonly zonePlayers = new Map<string, Set<PlayerSession>>();
  private readonly mapPlayers = new Map<number, Set<PlayerSession>>();
  /** Characters made invisible by an administrator: they stay hidden when they reconnect (until visible again or a restart). */
  private readonly invisibleIds = new Set<number>();
  /** Positions to broadcast at the next tick, per map. */
  private readonly pendingMoves = new Map<string, { mapId: number; instance: number; moves: Map<number, [number, number, number, Direction]> }>();
  private readonly timers: NodeJS.Timeout[] = [];
  /** Event loop lag (how late timers fire), smoothed, in milliseconds. */
  private lag = 0;
  private io: WorldIo | null = null;
  /** Server-wide switches and variables. */
  readonly global: GlobalProgress;
  /** Ids of the switches / variables declared global in the System settings. */
  private globalSwitchIds = new Set<number>();
  private globalVariableIds = new Set<number>();
  private instanceSwitchIds = new Set<number>();
  /** Runs events, move routes and autonomous movements. */
  readonly runner: EventRunner;
  /** Quest rules (objectives, rewards, markers, journal). */
  readonly quests: QuestService;
  /** Monsters and fights. */
  readonly combat: CombatSystem;
  /** Character sheet, equipment, shops and bank. */
  readonly sheet: CharacterSheet;
  /** Chat, friends, emotes. */
  readonly social: SocialService;
  /** Trades between players. */
  readonly trade: TradeService;
  /** Parties. */
  readonly party: PartyService;
  /** Guilds. */
  readonly guilds: GuildService;
  /** Instanced maps. */
  readonly instances: InstanceService;
  /** Raid rewards and loot. */
  readonly raids: RaidService;

  constructor(readonly ctx: ServerContext) {
    this.global = ctx.progression.loadGlobal();
    this.runner = new EventRunner(this);
    this.quests = new QuestService(this);
    this.combat = new CombatSystem(this);
    this.sheet = new CharacterSheet(this);
    this.social = new SocialService(this);
    this.trade = new TradeService(this);
    this.party = new PartyService(this);
    this.guilds = new GuildService(this);
    // Staff commands of the chat (`/kick`, `/mute`, `/ban`...).
    registerModerationCommands(this);
    this.instances = new InstanceService(this);
    this.raids = new RaidService(this);
    this.loadScopes();
    // A failing round is logged and skipped: one bad map or monster must not stop the world.
    const every = (ms: number, name: string, run: () => void) =>
      setInterval(() => {
        try {
          run();
        } catch (err) {
          console.error(`[brindiwanko] ${name} failed`, err);
        }
      }, ms);
    this.timers.push(
      every(AUTOSAVE_MS, 'autosave', () => this.saveAll()),
      every(1000 / TICK_HZ, 'world tick', () => this.tick()),
      every(100, 'event movement', () => this.runner.moveEvents(this.players.values())),
      every(CombatSystem.TICK_MS, 'combat tick', () => this.combat.tick()),
      every(60_000, 'map release', () => this.releaseIdleMaps()),
      this.lagMonitor(),
    );
    for (const t of this.timers) t.unref();
  }

  /** Measures how late a timer of 500 ms fires (the timer is stopped with the world). */
  private lagMonitor(): NodeJS.Timeout {
    let expected = Date.now() + 500;
    return setInterval(() => {
      const now = Date.now();
      this.lag = this.lag * 0.8 + Math.max(0, now - expected) * 0.2;
      expected = now + 500;
    }, 500);
  }

  /** Event loop lag, in milliseconds (administration dashboard). */
  get eventLoopLag(): number {
    return Math.round(this.lag);
  }

  /** Connects the socket.io server used for room broadcasts. */
  attach(io: WorldIo): void {
    this.io = io;
  }

  /** Broadcast target of a map room (`undefined` before the socket server is attached). */
  room(mapId: number, instance = 0) {
    return this.io?.to(mapRoom(mapId, instance));
  }

  /**
   * The players of a zone who see one of some battlers (it is in their area of interest, or it is them), for
   * messages only those can show (combat animations, damage numbers); `undefined` when nobody does.
   * @param ids - Battlers as in the areas of interest: a character id, or a negated monster id.
   */
  seeing(mapId: number, instance: number, ids: readonly number[]) {
    const zone = this.zonePlayers.get(mapRoom(mapId, instance));
    if (!this.io || !zone) return undefined;
    const sockets: string[] = [];
    for (const p of zone) {
      for (const id of ids) {
        if (id === p.characterId || p.aoi.has(id)) {
          sockets.push(p.socket.id);
          break;
        }
      }
    }
    // An empty list of rooms would reach every socket of the server.
    return sockets.length ? this.io.to(sockets) : undefined;
  }

  /** Number of connected players. */
  get playerCount(): number {
    return this.players.size;
  }

  /** Returns the runtime of a map, loading it on first use. */
  mapRuntime(id: number): MapRuntime | undefined {
    let runtime = this.maps.get(id);
    if (!runtime) {
      const map = this.ctx.maps.get(id);
      if (!map) return undefined;
      const tileset = this.ctx.gameData.get('tileset', map.tilesetId);
      runtime = new MapRuntime(id, map, tileset?.flags ?? []);
      this.maps.set(id, runtime);
    }
    return runtime;
  }

  /**
   * Frees the maps nobody stood on for a while, and their parsed content: memory follows the maps in play,
   * not every map visited since the start. An open instance keeps its map.
   */
  releaseIdleMaps(now = Date.now()): void {
    for (const id of [...this.maps.keys()]) {
      if (this.mapPlayers.get(id)?.size || this.instances.list().some((i) => i.mapId === id)) {
        this.emptyMaps.delete(id);
        continue;
      }
      const since = this.emptyMaps.get(id);
      if (since === undefined) this.emptyMaps.set(id, now);
      else if (now - since >= IDLE_MAP_RELEASE_MS) {
        this.maps.delete(id);
        this.emptyMaps.delete(id);
        this.ctx.maps.release(id);
      }
    }
  }

  /** A connected player, by character id. */
  player(characterId: number): PlayerSession | undefined {
    return this.players.get(characterId);
  }

  /** Every connected player. */
  allPlayers(): IterableIterator<PlayerSession> {
    return this.players.values();
  }

  /** Players currently on a map. */
  playersOn(mapId: number, instance?: number): PlayerSession[] {
    // A copy: callers may transfer or remove players while they walk through the list.
    const set = instance === undefined ? this.mapPlayers.get(mapId) : this.zonePlayers.get(mapRoom(mapId, instance));
    return set ? [...set] : [];
  }

  /** Adds a player to the zone indexes (its map and instance must not change until {@link unindex}). */
  private index(p: PlayerSession): void {
    const key = mapRoom(p.mapId, p.instance);
    let zone = this.zonePlayers.get(key);
    if (!zone) this.zonePlayers.set(key, (zone = new Set()));
    zone.add(p);
    let map = this.mapPlayers.get(p.mapId);
    if (!map) this.mapPlayers.set(p.mapId, (map = new Set()));
    map.add(p);
  }

  /** Removes a player from the zone indexes. */
  private unindex(p: PlayerSession): void {
    const key = mapRoom(p.mapId, p.instance);
    const zone = this.zonePlayers.get(key);
    zone?.delete(p);
    if (zone?.size === 0) this.zonePlayers.delete(key);
    const map = this.mapPlayers.get(p.mapId);
    map?.delete(p);
    if (map?.size === 0) this.mapPlayers.delete(p.mapId);
  }

  /** Tells whether a player session is still the live one. */
  isLive(p: PlayerSession): boolean {
    return p.socket.connected && this.players.get(p.characterId) === p;
  }

  private remote(p: PlayerSession): RemotePlayer {
    const guild = this.guilds.tagOf(p);
    return { id: p.characterId, name: p.name, appearance: p.appearance, x: p.x, y: p.y, direction: p.direction, ...(guild ? { guild } : {}) };
  }

  // --- Switches and variables -------------------------------------------------

  /** Reads which switches and variables are global. */
  private loadScopes(): void {
    const ids = (list: DataName[]) => new Set(list.flatMap((d, i) => (d.global ? [i + 1] : [])));
    const switches = this.ctx.settings.get<DataName[]>('switches', DEFAULT_SETTINGS.switches);
    this.globalSwitchIds = ids(switches);
    this.instanceSwitchIds = new Set(switches.flatMap((d, i) => (d.instance ? [i + 1] : [])));
    this.globalVariableIds = ids(this.ctx.settings.get<DataName[]>('variables', DEFAULT_SETTINGS.variables));
  }

  /** The System settings changed (switch scopes...): re-read them and refresh every player's events. */
  systemChanged(): void {
    this.loadScopes();
    for (const p of this.players.values()) this.refreshEvents(p);
    // The skill type names are part of the skills list.
    this.skillsContentChanged();
  }

  /**
   * Copies of a deleted item, weapon or armor were taken from these characters
   * and guilds: the windows of those online are refreshed (bag, bank, equipment, guild bank).
   */
  ownedCopiesRemoved(characterIds: readonly number[], guildIds: readonly number[]): void {
    for (const id of characterIds) {
      const p = this.players.get(id);
      if (!p) continue;
      this.pushInventory(p);
      this.sheet.statsChanged(p);
      if (p.ui?.kind === 'bank') p.socket.emit('bank', this.sheet.bankPayload(p));
    }
    for (const id of guildIds) for (const m of this.guilds.onlineMembers(id)) this.guilds.push(m);
  }

  /**
   * A quest or a skill was deleted (its rows went with it): the players in game forget it too, so that
   * their journal and skills match what is saved.
   */
  recordDeleted(type: 'quest' | 'skill', id: number): void {
    for (const p of this.players.values()) {
      if (type === 'quest' && p.progress.quests.delete(id)) {
        this.quests.push(p);
        this.refreshEvents(p);
      } else if (type === 'skill' && p.combat.learned.includes(id)) {
        p.combat.learned = p.combat.learned.filter((s) => s !== id);
      }
    }
    if (type === 'skill') this.skillsContentChanged();
  }

  /** A class, an equipment or a state was edited: every player in game gets its parameters again. */
  statsContentChanged(): void {
    for (const p of this.players.values()) this.sheet.statsChanged(p);
  }

  /** A skill, a class or the skill types were edited: every player in game gets the new skills list. */
  skillsContentChanged(): void {
    for (const p of this.players.values()) this.combat.pushSkills(p);
  }

  /** Tells whether a switch is global. */
  isGlobalSwitch(id: number): boolean {
    return this.globalSwitchIds.has(id);
  }

  /** Tells whether a variable is global. */
  isGlobalVariable(id: number): boolean {
    return this.globalVariableIds.has(id);
  }

  /** Value of a switch for a player (personal, global, or of its instance). */
  getSwitch(p: PlayerSession, id: number): boolean {
    if (this.instanceSwitchIds.has(id)) return this.instances.of(p)?.switches.has(id) ?? false;
    return this.isGlobalSwitch(id) ? this.global.switches.has(id) : p.progress.switches.has(id);
  }

  /** Value of a variable for a player (personal or global). */
  getVariable(p: PlayerSession, id: number): number {
    return (this.isGlobalVariable(id) ? this.global.variables.get(id) : p.progress.variables.get(id)) ?? 0;
  }

  /** Players whose events must be refreshed once the current atchRefresh ends. */
  private deferredRefresh: Set<PlayerSession> | null = null;

  /**
   * Runs a synchronous block that changes many switches or variables: the events of each player concerned
   * are refreshed once at the end instead of after every change.
   */
  batchRefresh<T>(fn: () => T): T {
    if (this.deferredRefresh) return fn();
    const pending = new Set<PlayerSession>();
    this.deferredRefresh = pending;
    try {
      return fn();
    } finally {
      this.deferredRefresh = null;
      for (const p of pending) this.refreshEvents(p);
    }
  }

  /** Sets a switch; a global one refreshes every player's events. */
  setSwitch(p: PlayerSession, id: number, on: boolean): void {
    if (id < 1 || this.getSwitch(p, id) === on) return;
    if (this.instanceSwitchIds.has(id)) {
      const instance = this.instances.of(p);
      if (!instance) return;
      if (on) instance.switches.add(id);
      else instance.switches.delete(id);
      for (const other of this.instances.players(instance)) this.refreshEvents(other);
      return;
    }
    if (this.isGlobalSwitch(id)) {
      this.ctx.progression.setGlobalSwitch(this.global, id, on);
      for (const other of this.players.values()) this.refreshEvents(other);
    } else {
      this.ctx.progression.setSwitch(p.characterId, p.progress, id, on);
      this.refreshEvents(p);
    }
  }

  /** Sets a variable; a global one refreshes every player's events. */
  setVariable(p: PlayerSession, id: number, value: number): void {
    if (id < 1) return;
    const before = this.getVariable(p, id);
    if (this.isGlobalVariable(id)) {
      this.ctx.progression.setGlobalVariable(this.global, id, value);
      if (this.getVariable(p, id) !== before) for (const other of this.players.values()) this.refreshEvents(other);
    } else {
      this.ctx.progression.setVariable(p.characterId, p.progress, id, value);
      if (this.getVariable(p, id) !== before) this.refreshEvents(p);
    }
  }

  // --- Events of a player -----------------------------------------------------

  /** Builds the player's copies of the events of its map and resolves their pages. */
  private setupEvents(p: PlayerSession, runtime: MapRuntime): void {
    p.mapGen++;
    this.runner.resetMap(p.characterId);
    p.aoi.clear();
    p.events = runtime.instantiate();
    for (const e of p.events.values()) {
      const index = MapRuntime.resolvePage(e, (c) => this.runner.conditionsHold(p, e, c));
      MapRuntime.applyPage(e, index);
    }
    for (const e of p.events.values()) e.marker = this.quests.marker(p, e);
  }

  /**
   * Re-resolves the pages of the player's events, sends the ones that changed,
   * then starts the automatic and parallel events that became active.
   */
  refreshEvents(p: PlayerSession): void {
    if (!this.isLive(p)) return;
    if (this.deferredRefresh) {
      this.deferredRefresh.add(p);
      return;
    }
    // Item and switch objectives depend on what just changed; a quest moving
    // to its next step refreshes the events again by itself.
    if (this.quests.check(p)) return;
    const views = [];
    const removed: number[] = [];
    for (const e of p.events.values()) {
      const index = MapRuntime.resolvePage(e, (c) => this.runner.conditionsHold(p, e, c));
      const pageChanged = index !== e.pageIndex;
      if (pageChanged) MapRuntime.applyPage(e, index);
      const marker = this.quests.marker(p, e);
      if (!pageChanged && marker === e.marker) continue;
      e.marker = marker;
      const view = MapRuntime.view(e);
      if (view) views.push(view);
      else if (pageChanged) removed.push(e.def.id);
    }
    if (views.length || removed.length) p.socket.emit('eventsChanged', { views, removed });
    this.quests.push(p);
    this.runner.startTriggers(p);
  }

  // --- Rooms and entering -----------------------------------------------------

  /** Map description sent to a player entering it. */
  private mapPayload(p: PlayerSession, runtime: MapRuntime): MapPayload {
    const { events: _events, ...mapWithoutEvents } = runtime.map;
    return {
      map: { ...mapWithoutEvents, id: runtime.id },
      tileset: this.ctx.gameData.get('tileset', runtime.map.tilesetId) ?? { id: 0, name: '', mode: 1, tilesetNames: [], flags: [] },
      events: MapRuntime.views(p.events),
      players: this.playersOn(runtime.id, p.instance).filter((o) => o !== p && !o.invisible).map((o) => this.remote(o)),
      monsters: this.combat.views(runtime.id, p.instance),
    };
  }

  /** Places a player in a map room and tells the others. */
  private enterRoom(p: PlayerSession): void {
    void p.socket.join(mapRoom(p.mapId, p.instance));
    if (!p.invisible) p.socket.to(mapRoom(p.mapId, p.instance)).emit('playerJoined', this.remote(p));
  }

  /** Removes a player from its map room and tells the others. */
  private leaveRoom(p: PlayerSession): void {
    this.pendingMoves.get(mapRoom(p.mapId, p.instance))?.moves.delete(p.characterId);
    p.socket.to(mapRoom(p.mapId, p.instance)).emit('playerLeft', { id: p.characterId });
    void p.socket.leave(mapRoom(p.mapId, p.instance));
  }

  /**
   * Puts a character into the world for a socket. An account plays one
   * character at a time: a new connection replaces the one already in the game,
   * whether it is the same character (another tab or device) or another
   * character of the account (the old socket is disconnected).
   * @returns The payload to send to the client, or `null` when no valid map exists.
   */
  join(socket: PlayerSocket, character: Character): EnterWorldPayload | null {
    let replaced = false;
    for (const previous of [...this.players.values()]) {
      if (previous.accountId !== character.accountId || previous.socket.id === socket.id) continue;
      replaced ||= previous.characterId === character.id;
      this.leave(previous.characterId);
      previous.socket.emit('errorMessage', { key: previous.characterId === character.id ? 'error.net.replaced' : 'error.net.other_character', params: { name: character.name } });
      previous.socket.disconnect(true);
    }
    // The session replaced was just saved: go on from its position and vitals, not from the copy read
    // before (up to an autosave old, which would also give back the HP lost since).
    if (replaced) character = this.ctx.characters.findById(character.id) ?? character;
    let { mapId, x, y, direction } = character;
    let runtime = this.mapRuntime(mapId);
    // A deleted map, an invalid saved position or an instanced map (instances do not
    // survive a disconnection) sends the character back to the start.
    if (!runtime || !isValidPosition(runtime.map, x, y) || runtime.map.mmo.instance) {
      ({ mapId, x, y, direction } = this.startPosition(character.classId));
      runtime = this.mapRuntime(mapId);
      if (!runtime || !isValidPosition(runtime.map, x, y)) {
        // The class's own start is gone (map deleted): the System start.
        ({ mapId, x, y, direction } = this.startPosition());
        runtime = this.mapRuntime(mapId);
      }
      if (!runtime) return null;
    }
    // A saved or start position that was walled in by a map edit: use the closest free cell.
    if (!runtime.isStandable(x, y)) ({ x, y } = runtime.nearestStandable(x, y));
    const now = Date.now();
    const p: PlayerSession = {
      characterId: character.id,
      accountId: character.accountId,
      name: character.name,
      appearance: character.appearance,
      socket,
      mapId,
      x,
      y,
      direction,
      hp: character.hp,
      mp: character.mp,
      classId: character.classId,
      level: character.level,
      xp: character.xp,
      busy: false,
      stepTokens: STEP_BURST,
      lastRefill: now,
      epoch: 0,
      savedAt: now,
      progress: this.ctx.progression.load(character.id),
      events: new Map(),
      mapGen: 0,
      instance: 0,
      aoi: new Set(),
      combat: {
        dead: false, states: new Map(), stats: null, nextAttackAt: 0, globalReadyAt: 0, cooldowns: new Map(), hotbar: [],
        learned: this.ctx.progression.learnedSkills(character.id), stateSteps: new Map(), granted: [], lastHurt: 0, protectedUntil: now + JOIN_PROTECTION_MS,
      },
      allocated: this.ctx.progression.allocated(character.id),
      ui: null,
      social: emptySocial(),
      guild: null,
      invisible: this.invisibleIds.has(character.id),
    };
    // Points spent beyond what the level gives now (fewer points per level in the System settings) are taken back.
    this.sheet.fitAllocation(p);
    this.players.set(character.id, p);
    this.index(p);
    this.guilds.playerJoined(p);
    this.party.playerJoined(p);
    this.combat.playerJoined(p);
    // Equipment and points change the maximum vitals given by the class.
    const vitals = this.maxVitals(p);
    p.hp = Math.min(p.hp, vitals.maxHp);
    p.mp = Math.min(p.mp, vitals.maxMp);
    this.setupEvents(p, runtime);
    const terms = this.ctx.settings.get('terms', DEFAULT_SETTINGS.terms);
    const payload: EnterWorldPayload = {
      ...this.mapPayload(p, runtime),
      character: { ...playerInfo(this.ctx, character), mapId, x, y, direction, ...this.maxVitals(p), hp: p.hp, mp: p.mp, guildTag: this.guilds.tagOf(p) },
      role: socket.data.role,
      system: {
        currencyName: this.currencyName(),
        params: terms.params,
        hp: terms.hp,
        mp: terms.mp,
        level: terms.level,
        xp: terms.xp,
        bagSize: this.ctx.settings.get('bagSize', DEFAULT_SETTINGS.bagSize),
        sellRate: this.ctx.settings.get('sellRate', DEFAULT_SETTINGS.sellRate),
        guildCreationCost: this.ctx.settings.get('guildCreationCost', DEFAULT_SETTINGS.guildCreationCost),
      },
    };
    this.enterRoom(p);
    return payload;
  }

  /** Called once the client received `enterWorld`: sends the journal and starts automatic events. */
  afterEnter(p: PlayerSession): void {
    this.quests.pushFull(p);
    this.combat.pushSkills(p);
    this.sheet.push(p);
    this.combat.afterEnter(p);
    this.social.playerJoined(p);
    this.social.pushFriends(p);
    this.guilds.push(p);
    this.guilds.memberPresenceChanged(p);
    this.quests.onMove(p);
    this.runner.startTriggers(p);
  }

  /** Removes a player and saves its state. */
  leave(characterId: number): void {
    const p = this.players.get(characterId);
    if (!p) return;
    this.trade.cancel(p, 'notify.trade_partner_left');
    this.party.playerLeft(p);
    this.combat.playerLeft(p);
    this.leaveRoom(p);
    this.save([p]);
    p.mapGen++;
    this.unindex(p);
    this.players.delete(characterId);
    this.quests.forget(characterId);
    this.social.playerLeft(p);
    this.runner.forget(characterId);
    this.guilds.playerLeft(p);
    this.guilds.memberPresenceChanged(p);
  }

  /** Start position of the System settings. */
  startPosition(classId?: number): StartPosition {
    return classId === undefined ? this.ctx.settings.get<StartPosition>('startPosition', DEFAULT_SETTINGS.startPosition) : this.ctx.characterService.startFor(classId);
  }

  /**
   * Applies a new role to the connected characters of an account, so that it
   * takes effect without logging in again (the web pages and APIs already read
   * the role from the database on every request).
   */
  setAccountRole(accountId: number, role: AccountRole): void {
    for (const p of this.players.values()) {
      if (p.accountId !== accountId) continue;
      p.socket.data.role = role;
      if (role !== 'admin') p.editing = false;
      p.socket.emit('roleChanged', { role });
    }
    if (role !== 'admin') this.ctx.editLocks.releaseAll(accountId);
  }

  /** Disconnects every session of an account (ban, kick, password reset). */
  kickAccount(accountId: number, key: string, params?: Record<string, string | number>): void {
    for (const p of [...this.players.values()]) {
      if (p.accountId !== accountId) continue;
      p.socket.emit('errorMessage', { key, params });
      this.leave(p.characterId);
      p.socket.disconnect(true);
    }
  }

  /**
   * Server announcement for everyone: a system chat line, with a banner at the top of the screen (`banner`),
   * or a window the player closes (`popup`, for a restart about to happen), or nothing more (`chat`).
   */
  announce(text: string, mode: AnnounceMode = 'banner'): void {
    for (const p of this.players.values()) {
      if (!this.isLive(p)) continue;
      // Always written in the chat (it stays readable there); a banner or a window on top of it.
      if (mode === 'banner') p.socket.emit('notify', { key: 'notify.announce', params: { text } });
      else if (mode === 'popup') p.socket.emit('announcement', { text });
      this.social.system(p, 'notify.announce', { text });
    }
  }

  /** Hides a player from the others (or shows it again): it seems to leave the game, or to come back. */
  setInvisible(p: PlayerSession, on: boolean): void {
    if (on) this.invisibleIds.add(p.characterId);
    else this.invisibleIds.delete(p.characterId);
    if (Boolean(p.invisible) === on) return;
    const room = p.socket.to(mapRoom(p.mapId, p.instance));
    if (on) {
      room.emit('playerLeft', { id: p.characterId });
      p.invisible = true;
    } else {
      p.invisible = false;
      room.emit('playerJoined', this.remote(p));
    }
    this.social.visibilityChanged(p);
    this.guilds.memberVisibilityChanged(p);
  }

  /** Maximum HP and MP of a player (class, equipment, points, states). */
  maxVitals(p: PlayerSession): { maxHp: number; maxMp: number } {
    const { params } = this.combat.stats(p);
    return { maxHp: params.mhp, maxMp: params.mmp };
  }

  /** Currency name from the System settings. */
  currencyName(): string {
    return this.ctx.settings.get('currencyName', DEFAULT_SETTINGS.currencyName);
  }

  /** Marks a player as busy (or free) during a non-parallel event and notifies the client. */
  setBusy(p: PlayerSession, busy: boolean): void {
    if (p.busy === busy) return;
    p.busy = busy;
    if (this.isLive(p)) p.socket.emit('busy', busy);
  }

  // --- Movement ---------------------------------------------------------------

  /** Queues a position broadcast for the next tick. */
  queueMove(p: PlayerSession): void {
    if (p.invisible) return;
    const key = mapRoom(p.mapId, p.instance);
    let zone = this.pendingMoves.get(key);
    if (!zone) {
      zone = { mapId: p.mapId, instance: p.instance, moves: new Map() };
      this.pendingMoves.set(key, zone);
    }
    zone.moves.set(p.characterId, [p.characterId, p.x, p.y, p.direction]);
  }

  /** Spatial grids reused by {@link tick}, one pair per map size. */
  private readonly aoiGrids = new Map<string, { players: AoiGrid<PlayerSession>; monsters: AoiGrid<[number, number, number, Direction]> }>();

  /** Server tick: flushes queued position changes to each map room. */
  tick(): void {
    if (!this.io) return;
    const monsterMoves = new Map<string, Set<number>>();
    for (const [mapId, instance, moves] of this.combat.flushMoves()) monsterMoves.set(mapRoom(mapId, instance), new Set(moves.map((m) => m[0])));
    // Each player gets the moves within its area of interest, plus the position of
    // anything that just came into it. Entities are told apart by a number: a
    // character id for players, the negated id for monsters (no string per pair).
    for (const [key, zone] of this.zonePlayers) {
      // The set itself is walked (no copy 20 times a second): nothing below adds or removes players.
      const viewers = zone;
      const first = viewers.values().next().value;
      if (!first) continue;
      const moved = this.pendingMoves.get(key)?.moves;
      const monsters = this.combat.positions(first.mapId, first.instance);
      const movedMonsters = monsterMoves.get(key);
      // Distances go through the edges of a looping map (computed in place: no object per pair).
      const runtime = this.mapRuntime(first.mapId);
      const map = runtime?.map;
      const far = (x: number, y: number, vx: number, vy: number) => {
        const dx = map ? deltaX(map, vx, x) : x - vx;
        if (dx > AOI_RADIUS || dx < -AOI_RADIUS) return true;
        const dy = map ? deltaY(map, vy, y) : y - vy;
        return dy > AOI_RADIUS || dy < -AOI_RADIUS;
      };
      // Each player only looks at the cells around it, not at everything on the map. The grids are
      // reused from one tick to the next (one pair per map size), not allocated again 20 times a second.
      const loopX = !!map && loopsHorizontally(map);
      const loopY = !!map && loopsVertically(map);
      const gridKey = `${map?.width ?? 1}x${map?.height ?? 1}${loopX ? 'x' : ''}${loopY ? 'y' : ''}`;
      let grids = this.aoiGrids.get(gridKey);
      if (!grids) {
        const make = <T>() => new AoiGrid<T>(map?.width ?? 1, map?.height ?? 1, AOI_RADIUS, loopX, loopY);
        grids = { players: make<PlayerSession>(), monsters: make<[number, number, number, Direction]>() };
        this.aoiGrids.set(gridKey, grids);
      }
      const playerGrid = grids.players;
      const monsterGrid = grids.monsters;
      playerGrid.clear();
      monsterGrid.clear();
      for (const o of viewers) if (!o.invisible) playerGrid.add(o.x, o.y, o);
      for (const m of monsters) monsterGrid.add(m[1], m[2], m);
      let living: Set<number> | undefined;
      const alive = (id: number) => (living ??= new Set(monsters.map((m) => m[0]))).has(id);
      const stillHere = (id: number) => {
        const o = this.players.get(id);
        return !!o && zone.has(o) && !o.invisible;
      };
      for (const viewer of viewers) {
        if (!this.isLive(viewer)) continue;
        const vx = viewer.x;
        const vy = viewer.y;
        const known = new Set<number>();
        // How many of those it knew are still in range: when fewer, some went out of it.
        let kept = 0;
        const players: [number, number, number, Direction][] = [];
        for (const cell of playerGrid.near(vx, vy)) {
          for (const o of cell) {
            if (o === viewer || far(o.x, o.y, vx, vy)) continue;
            known.add(o.characterId);
            const knew = viewer.aoi.has(o.characterId);
            if (knew) kept++;
            if (!knew || moved?.has(o.characterId)) players.push([o.characterId, o.x, o.y, o.direction]);
          }
        }
        const mons: [number, number, number, Direction][] = [];
        for (const cell of monsterGrid.near(vx, vy)) {
          for (const m of cell) {
            if (far(m[1], m[2], vx, vy)) continue;
            known.add(-m[0]);
            const knew = viewer.aoi.has(-m[0]);
            if (knew) kept++;
            if (!knew || movedMonsters?.has(m[0])) mons.push(m);
          }
        }
        // Those still on the map but now too far: the client stops showing them where they were last seen
        // (those that left the map or were defeated are removed by their own messages).
        const left = kept < viewer.aoi.size ? [...viewer.aoi].filter((id) => !known.has(id) && (id > 0 ? stillHere(id) : alive(-id))) : [];
        viewer.aoi = known;
        if (players.length) viewer.socket.emit('playersMoved', players);
        if (mons.length) viewer.socket.emit('monstersMoved', mons);
        if (left.length) viewer.socket.emit('outOfSight', left);
      }
      // Do not keep the sessions alive until the next tick.
      playerGrid.clear();
      monsterGrid.clear();
    }
    this.pendingMoves.clear();
  }

  /** Touch-triggered event at a cell for a player (`solid`: same priority as characters). */
  private touchEventAt(p: PlayerSession, x: number, y: number, solid: boolean): EventInstance | undefined {
    return MapRuntime.firstEventAt(p.events, x, y, (e) => {
      const page = MapRuntime.page(e);
      return !!page && (page.priorityType === 1) === solid && (page.trigger === Trigger.PlayerTouch || page.trigger === Trigger.EventTouch);
    });
  }

  /**
   * Handles a step intent.
   * @param epoch - Movement epoch the client predicted this step in.
   * @returns `true` if the step was accepted.
   */
  move(p: PlayerSession, direction: Direction, epoch: number): boolean {
    // Steps predicted before the client learnt of a rejection are dropped silently.
    if (epoch !== p.epoch) return false;
    const runtime = this.mapRuntime(p.mapId);
    const now = Date.now();
    p.stepTokens = Math.min(STEP_BURST, p.stepTokens + (now - p.lastRefill) / STEP_REFILL_MS);
    p.lastRefill = now;
    const reject = () => {
      p.epoch++;
      p.socket.emit('moveRejected', { x: p.x, y: p.y, direction: p.direction, epoch: p.epoch });
      this.queueMove(p);
      return false;
    };
    // A player who may not move (busy, knocked out, paralysed, too fast) does not turn either.
    if (!runtime || p.busy || p.stepTokens < 1 || !this.combat.canMove(p)) return reject();
    // Otherwise it faces where it tried to go, even into a wall.
    p.direction = direction;
    // On a looping map, the step past an edge leads to the opposite edge.
    const next = runtime.next(p.x, p.y, direction);
    if (this.combat.occupied(p.mapId, next.x, next.y, p.instance)) return reject();
    if (!runtime.canStep(p.events, p.x, p.y, direction)) {
      // Walking into a touch-triggered event starts it (doors, traps...).
      const bumped = this.touchEventAt(p, next.x, next.y, true);
      reject();
      if (bumped) void this.runner.run(p, bumped);
      return false;
    }
    p.stepTokens -= 1;
    p.x = next.x;
    p.y = next.y;
    // On a ladder, characters face up (the client shows it the same way).
    if (isLadder(runtime.map, runtime.flags, p.x, p.y)) p.direction = 8;
    this.queueMove(p);
    this.quests.onMove(p);
    this.trade.moved(p);
    this.combat.playerStepped(p, isDamageFloor(runtime.map, runtime.flags, p.x, p.y));
    // Stepping onto a touch-triggered event drawn below/above characters (teleporters...).
    const touched = this.touchEventAt(p, p.x, p.y, false);
    if (touched) void this.runner.run(p, touched);
    return true;
  }

  /** Handles a turn intent. */
  turn(p: PlayerSession, direction: Direction): void {
    if (p.busy || p.direction === direction || p.combat.dead) return;
    p.direction = direction;
    this.queueMove(p);
  }

  /**
   * Handles the Action button: starts the event in front of the player (or
   * under it for events drawn below/above characters). Counters let the
   * player reach the event one cell further. With no event to start, the
   * player attacks in the direction it faces.
   */
  action(p: PlayerSession): void {
    const runtime = this.mapRuntime(p.mapId);
    if (!runtime || p.busy || p.combat.dead) return;
    const here = MapRuntime.firstEventAt(p.events, p.x, p.y, (e) => {
      const page = MapRuntime.page(e);
      return !!page && page.priorityType !== 1 && page.trigger === Trigger.Action;
    });
    if (here) {
      void this.runner.run(p, here);
      return;
    }
    const front = runtime.next(p.x, p.y, p.direction);
    const facing = (x: number, y: number) =>
      MapRuntime.firstEventAt(p.events, x, y, (e) => {
        const page = MapRuntime.page(e);
        return !!page && page.priorityType === 1 && page.trigger <= Trigger.EventTouch;
      });
    let target = facing(front.x, front.y);
    if (!target && isCounter(runtime.map, runtime.flags, front.x, front.y)) {
      const beyond = runtime.next(front.x, front.y, p.direction);
      target = facing(beyond.x, beyond.y);
    }
    if (target) void this.runner.run(p, target);
    else this.combat.attack(p);
  }

  /**
   * Moves a player to another map or position.
   * @param fade - Fade type forwarded to the client (0 black, 1 white, 2 none).
   * @param instance - On an instanced map, that open instance rather than the player's party's (administration
   *   tools joining a player); its entry conditions are not checked.
   * @returns `false` when the destination is invalid.
   */
  transfer(p: PlayerSession, mapId: number, x: number, y: number, direction: Direction | 0, fade = 0, instance?: number): boolean {
    const runtime = this.mapRuntime(mapId);
    if (!runtime || !isValidPosition(runtime.map, x, y)) return false;
    // A destination walled in by a map edit: use the closest free cell.
    if (!runtime.isStandable(x, y)) ({ x, y } = runtime.nearestStandable(x, y));
    // Instanced map: the copy of the player's party (created if needed), if allowed.
    let zone = 0;
    if (runtime.map.mmo.instance) {
      const chosen = instance !== undefined && this.instances.get(instance)?.mapId === mapId ? instance : undefined;
      const entered = chosen ?? (mapId === p.mapId && p.instance ? p.instance : this.instances.enter(p, mapId));
      if (typeof entered === 'string') {
        p.socket.emit('notify', { key: entered });
        return false;
      }
      zone = entered;
    }
    if (mapId !== p.mapId || zone !== p.instance) {
      this.trade.cancel(p);
      // A shop or bank opened on the map left behind closes with it.
      this.sheet.closeWindows(p);
    }
    this.leaveRoom(p);
    this.unindex(p);
    p.instance = zone;
    p.mapId = mapId;
    this.index(p);
    p.x = x;
    p.y = y;
    if (direction) p.direction = direction;
    p.epoch++;
    p.stepTokens = STEP_BURST;
    p.combat.protectedUntil = Math.max(p.combat.protectedUntil, Date.now() + TRANSFER_PROTECTION_MS);
    this.setupEvents(p, runtime);
    p.socket.emit('mapChange', { ...this.mapPayload(p, runtime), x, y, direction: p.direction, epoch: p.epoch, fade });
    this.enterRoom(p);
    this.quests.onMove(p);
    // Automatic events of the new map start once the current run (if any) is over. A failure is logged:
    // thrown from this callback, it would stop the whole server.
    setImmediate(() => {
      try {
        this.runner.startTriggers(p);
      } catch (err) {
        console.error('[brindiwanko] event triggers failed', err);
      }
    });
    return true;
  }

  /**
   * Moves or turns a player on its map by server decision (move routes):
   * the client adopts the new position, the others see a normal move.
   */
  forceMove(p: PlayerSession, x: number, y: number, direction: Direction): void {
    const moved = p.x !== x || p.y !== y;
    p.x = x;
    p.y = y;
    p.direction = direction;
    p.epoch++;
    p.socket.emit('forceMove', { x, y, direction, epoch: p.epoch });
    this.queueMove(p);
    if (moved) this.quests.onMove(p);
  }

  /**
   * Reloads a map after an edit and pushes the new version to the players on it.
   * Players standing outside the new bounds are moved inside; every player
   * receives its position and a new movement epoch with the map, so the client
   * and the server agree on where it stands.
   */
  reloadMap(mapId: number): void {
    this.maps.delete(mapId);
    this.combat.reloadMap(mapId);
    const runtime = this.mapRuntime(mapId);
    if (!runtime) return;
    for (const p of this.playersOn(mapId)) {
      p.x = Math.min(p.x, runtime.map.width - 1);
      p.y = Math.min(p.y, runtime.map.height - 1);
      p.epoch++;
      p.stepTokens = STEP_BURST;
      this.setupEvents(p, runtime);
      // The edit may have walled the cell in (water, wall): move to the closest free one.
      if (!runtime.isStandable(p.x, p.y)) {
        const free = runtime.nearestStandable(p.x, p.y, p.events);
        p.x = free.x;
        p.y = free.y;
      }
      p.socket.emit('mapUpdated', { ...this.mapPayload(p, runtime), x: p.x, y: p.y, direction: p.direction, epoch: p.epoch });
      if (!p.busy) this.runner.startTriggers(p);
    }
  }

  /** Reloads every loaded map drawn with a tileset (its flags or sheets changed). */
  reloadMapsUsingTileset(tilesetId: number): void {
    for (const [id, runtime] of [...this.maps]) if (runtime.map.tilesetId === tilesetId) this.reloadMap(id);
  }

  /** Sends every player of a map to the start position (the map is being deleted). */
  evacuateMap(mapId: number): void {
    const start = this.ctx.settings.get<StartPosition>('startPosition', DEFAULT_SETTINGS.startPosition);
    for (const p of this.playersOn(mapId)) this.transfer(p, start.mapId, start.x, start.y, start.direction);
    this.maps.delete(mapId);
  }

  // --- Inventory and character ------------------------------------------------

  /**
   * Stores changes of a player's state (rewards...) in one transaction. When the database refuses one of
   * them (full disk...), none is kept: the player's state in memory is put back as it was (quests,
   * experience and level, hotbar) and sent again with the bag and the gold.
   * @returns Whether the changes were kept.
   */
  storeTogether(p: PlayerSession, change: () => void): boolean {
    const quests = new Map(p.progress.quests);
    const { xp, level } = p;
    const hotbar = [...p.combat.hotbar];
    try {
      this.ctx.db.transaction(change)();
      return true;
    } catch (err) {
      console.error(`[brindiwanko] changes of character #${p.characterId} could not be stored: none was kept`, err);
      p.progress.quests = quests;
      p.combat.hotbar = hotbar;
      if (p.xp !== xp || p.level !== level) this.runner.setExp(p, xp, false, level);
      this.combat.invalidate(p);
      this.combat.pushSkills(p);
      this.pushInventory(p);
      p.socket.emit('playerUpdate', { gold: this.ctx.inventory.gold(p.characterId) });
      this.quests.pushFull(p);
      this.refreshEvents(p);
      return false;
    }
  }

  /** Sends the player its current inventory. */
  pushInventory(p: PlayerSession): void {
    // Equipment may have changed with the bag.
    this.combat.invalidate(p);
    p.socket.emit('inventory', this.ctx.inventoryService.payload(p.characterId));
  }

  /**
   * Gives (positive) or takes (negative) gold, and tells the player.
   * @returns The new amount.
   */
  changeGold(p: PlayerSession, delta: number): number {
    const gold = this.ctx.inventoryService.changeGold(p.characterId, delta);
    p.socket.emit('playerUpdate', { gold });
    if (delta !== 0) p.socket.emit('notify', { key: delta > 0 ? 'notify.gold_gained' : 'notify.gold_lost', params: { amount: Math.abs(delta), currency: this.currencyName() } });
    this.pushInventory(p);
    return gold;
  }

  /**
   * Gives or takes items, and tells the player what changed. Items given while
   * the bag cannot hold more of them (loot, rewards, chests) go to the
   * personal bank instead of being lost; a key or quest item already at its
   * stack limit is not duplicated into the bank.
   * @returns The signed quantity actually changed in the bag.
   */
  changeItems(p: PlayerSession, kind: ItemKind, id: number, delta: number): number {
    const inventory = this.ctx.inventoryService;
    const changed = inventory.change(p.characterId, kind, id, delta);
    const def = kind === 'item' ? this.ctx.gameData.get('item', id) : kind === 'weapon' ? this.ctx.gameData.get('weapon', id) : this.ctx.gameData.get('armor', id);
    if (delta > 0 && changed < delta && def && !inventory.hasRoomFor(p.characterId, kind, id) && (kind !== 'item' || ('kind' in def && def.kind === 'regular') || this.ctx.inventory.quantity(p.characterId, kind, id) === 0)) {
      const banked = this.ctx.inventory.addToBank(p.characterId, kind, id, delta - changed);
      if (banked > 0) {
        p.socket.emit('notify', { key: 'notify.item_to_bank', params: { name: def.name, count: banked }, icon: def.icon });
        if (p.ui?.kind === 'bank') p.socket.emit('bank', this.sheet.bankPayload(p));
      } else p.socket.emit('notify', { key: 'error.bag.full' });
    }
    if (changed !== 0) {
      p.socket.emit('notify', {
        key: changed > 0 ? 'notify.item_gained' : 'notify.item_lost',
        params: { name: def?.name ?? '?', count: Math.abs(changed) },
        icon: def?.icon,
      });
      this.pushInventory(p);
      // Pages may depend on owning an item.
      this.refreshEvents(p);
    }
    return changed;
  }

  /** Uses an item from the player's bag (effects are computed by the server). */
  useItem(p: PlayerSession, itemId: number): void {
    // A knocked-out player cannot drink anything (the potion would be lost: the vitals are reset on respawn).
    if (p.busy || p.combat.dead) return;
    const result = this.ctx.inventoryService.use(p.characterId, itemId, { hp: p.hp, mp: p.mp, ...this.maxVitals(p) }, (e) => this.combat.effectUseful(p, e));
    if (!result.ok) {
      p.socket.emit('notify', { key: result.errorKey });
      return;
    }
    p.hp = result.hp;
    p.mp = result.mp;
    p.socket.emit('playerUpdate', { hp: p.hp, mp: p.mp });
    // States, experience and common event of the item.
    this.combat.itemEffects(p, this.ctx.gameData.get('item', itemId)?.effects ?? []);
    this.pushInventory(p);
    this.refreshEvents(p);
  }

  // --- Saving -----------------------------------------------------------------

  /** Writes the state of some players to the database in one transaction. */
  private save(list: readonly PlayerSession[]): void {
    if (list.length === 0) return;
    const now = Date.now();
    this.ctx.characters.saveStates(
      list.map((p) => {
        const delta = Math.floor((now - p.savedAt) / 1000);
        p.savedAt += delta * 1000;
        // A knocked-out player is saved as it will reappear (respawn point, full HP and MP).
        const s = p.combat.dead ? this.combat.respawnState(p) : p;
        return [p.characterId, { mapId: s.mapId, x: s.x, y: s.y, direction: s.direction, hp: s.hp, mp: s.mp, playTimeDelta: delta }] as const;
      }),
    );
    // Story progress is changed in memory by the events: it reaches the database here.
    for (const p of list) this.ctx.progression.flush(p.characterId, p.progress);
  }

  /**
   * Writes the position and vitals of one player right now. Used after changes committed at once
   * (trade, quest rewards) so that a crash before the next autosave cannot put the player back
   * where it was while keeping what it received.
   */
  checkpoint(p: PlayerSession): void {
    try {
      this.save([p]);
    } catch (err) {
      console.error(`[brindiwanko] checkpoint of character #${p.characterId} failed`, err);
    }
  }

  /** Saves every connected player (autosave and shutdown). */
  saveAll(): void {
    this.save([...this.players.values()]);
  }

  /** Stops timers and saves everyone. */
  close(): void {
    for (const t of this.timers) clearInterval(t);
    try {
      this.saveAll();
    } finally {
      this.party.close();
      this.instances.close();
    }
  }
}
