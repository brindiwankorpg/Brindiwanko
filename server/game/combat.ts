/**
 * @file Real-time combat on the map, in the style of classic online action
 * games: players attack in the direction they face, use skills with a cost
 * and a cooldown, and monsters shared by every player of the map move and
 * fight under server control.
 *
 * Monsters: each map lists spawns (enemy, count, region). The monsters of a
 * map exist while players are on it (they are created on the first visit and
 * dropped a while after the last player left). Their AI runs on the server
 * tick: wandering near home, aggro (aggressive and coward enemies attack on
 * sight, passive ones when hit), chase, flight when hurt (coward), return home
 * when led too far (full heal), reappearance after their respawn delay.
 *
 * Every number is computed here: damage formulas from the database (parsed,
 * never evaluated as code), elements, critical hits, hit and evasion rates,
 * states (duration, HP/MP per second, restrictions, removal on damage).
 * Clients receive the results (floating numbers, animations, monster
 * positions) and send only intents.
 *
 * Rewards are personal: every player who hurt a monster receives its
 * experience and gold and rolls its drops for itself. On PvP maps players can
 * also hit each other (no rewards). A player at 0 HP reappears after a few
 * seconds at its respawn point with full HP and MP.
 */
import { COMBAT, HOTBAR_SIZE, type ActionView, type CombatActor, type DamageView, type HotbarSlot, type MonsterView, type SkillsPayload, type SkillView, type Spawn } from '../../shared/combat.js';
import type { Damage, Effect, EnemyAction, EnemyData, RaidData, Scope, SkillData, StateData } from '../../shared/database.js';
import { evalFormula } from '../../shared/formula.js';
import { REGION_LAYER, deltaX, deltaY, isValidPosition, stepCell, tileAt, wrapCell, type LoopMap, type MapData } from '../../shared/map.js';
import { canMove, isPassable } from '../../shared/passability.js';
import { DEFAULT_SETTINGS, type Direction, type StartPosition } from '../../shared/settings.js';
import { Priority } from '../../shared/events.js';
import { stepMs } from './events.js';
import { attackElement, elementRate, enemyStats, playerStats, stateRate, traitRate, traitSum, type ActiveStates, type BattlerStats } from './stats.js';
import { mapRoom, sameZone, type PlayerSession, type World } from './world.js';

/** A map, or one instance of an instanced map. */
/** HP lost at each step on a damage floor. */
const FLOOR_DAMAGE = 10;
type Zone = { mapId: number; instance: number };

/** AI and state timers. */
const AI_TICK_MS = 100;
/** Monsters of a map without players are dropped after this delay. */
const IDLE_MAP_MS = 120_000;
/** Minimum time between two skills of a player. */
const GLOBAL_COOLDOWN_MS = 400;
/** Drops rarer than this (percent) are logged. */
const RARE_DROP_CHANCE = 10;
/** Out of combat for this long, players regenerate. */
const REGEN_DELAY_MS = 8000;
/** Players this close (cells) read the message of a skill in their chat. */
const SKILL_MESSAGE_RADIUS = 10;
/** How long the fight state of a player who left is kept for its return (page reload, dropped connection). */
const CARRY_COMBAT_MS = 10 * 60 * 1000;

/** Fight state of a player who left, found again when it comes back. */
interface CarriedCombat {
  until: number;
  cooldowns: [number, number][];
  globalReadyAt: number;
  states: [number, number][];
  stateSteps: [number, number][];
  lastHurt: number;
  /** When the player reappears, if it left while knocked out (0 otherwise). */
  respawnAt: number;
}

const DIRS: Direction[] = [2, 4, 6, 8];
/** A battler as the areas of interest know it: a character id, or a negated monster id. */
const aoiId = (a: CombatActor): number => (a.kind === 'player' ? a.id : -a.id);
const reverse = (d: Direction): Direction => (10 - d) as Direction;

/** Direction from one cell towards another (largest axis first; through the edges of a looping map). */
function towards(map: LoopMap, fromX: number, fromY: number, toX: number, toY: number): Direction {
  const dx = deltaX(map, fromX, toX);
  const dy = deltaY(map, fromY, toY);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 6 : 4;
  return dy > 0 ? 2 : dy < 0 ? 8 : dx > 0 ? 6 : 4;
}

/** Distance in cells (largest axis; through the edges of a looping map). */
const distance = (map: LoopMap, ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(deltaX(map, bx, ax)), Math.abs(deltaY(map, by, ay)));

/** A monster on a map. */
export interface Monster {
  id: number;
  def: EnemyData;
  spawn: number;
  x: number;
  y: number;
  direction: Direction;
  hp: number;
  mp: number;
  homeX: number;
  homeY: number;
  mode: 'idle' | 'chase' | 'flee' | 'return';
  /** Character chased. */
  targetId: number;
  nextMoveAt: number;
  nextActionAt: number;
  modeUntil: number;
  states: ActiveStates;
  /** Damage dealt by each character (rewards). */
  damage: Map<number, number>;
  dead: boolean;
  respawnAt: number;
  /** Called by a boss: removed for good when defeated. */
  summoned?: boolean;
  /** Boss that called it (its adds leave when it starts the fight over). */
  summoner?: number;
  /** Boss in its enraged phase. */
  enraged?: boolean;
  /** Boss phases already started, and when each repeating mechanic fires next. */
  phases?: Map<number, number>;
  /** Cell under which the occupancy index of its map holds it (unset: not in it). */
  cell?: number;
}

/** Combat state of one map. */
class MapCombat {
  readonly monsters = new Map<number, Monster>();
  /**
   * Living monster standing on each cell (`y * width + x`): telling whether a cell is taken does not walk
   * through every monster of the map. Two living monsters never share a cell (each move checks it first).
   */
  private readonly occupancy = new Map<number, Monster>();
  /** Cells blocked by solid events (monsters do not walk on them). */
  readonly blocked = new Set<number>();
  /** Candidate cells of each spawn. */
  readonly cells: number[][] = [];
  /** Positions changed since the last broadcast. */
  readonly moves = new Map<number, [number, number, number, Direction]>();
  emptySince = 0;

  constructor(readonly mapId: number, readonly instance: number, readonly map: MapData, readonly flags: readonly number[], readonly spawns: Spawn[]) {
    for (const e of map.events) {
      const page = e?.pages[0];
      if (e && page && page.priorityType === Priority.Same && !page.through) this.blocked.add(e.y * map.width + e.x);
    }
    for (const s of spawns) {
      const list: number[] = [];
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (s.region > 0 && tileAt(map, x, y, REGION_LAYER) !== s.region) continue;
          if (!DIRS.some((d) => isPassable(map, flags, x, y, d)) || this.blocked.has(y * map.width + x)) continue;
          list.push(y * map.width + x);
        }
      }
      this.cells.push(list);
    }
  }

  /** Puts a living monster on a cell (its position and the occupancy index). */
  place(m: Monster, x: number, y: number): void {
    this.unplace(m);
    m.x = x;
    m.y = y;
    if (m.dead) return;
    m.cell = y * this.map.width + x;
    this.occupancy.set(m.cell, m);
  }

  /** Takes a monster out of the occupancy index (defeated, or removed from the map). */
  unplace(m: Monster): void {
    if (m.cell === undefined) return;
    if (this.occupancy.get(m.cell) === m) this.occupancy.delete(m.cell);
    m.cell = undefined;
  }

  /** Tells whether a living monster stands on a cell. */
  occupied(x: number, y: number): boolean {
    const m = this.occupancy.get(y * this.map.width + x);
    return !!m && !m.dead && m.x === x && m.y === y;
  }

  /** Removes a monster from the map. */
  remove(m: Monster): void {
    this.unplace(m);
    this.monsters.delete(m.id);
    this.moves.delete(m.id);
  }
}

/** A battler taking part in an action. */
type Combatant = { kind: 'player'; p: PlayerSession } | { kind: 'monster'; m: Monster; map: MapCombat };

/** Combat for the whole world. */
export class CombatSystem {
  /** Combat state of each zone (map, or instance of an instanced map), by room name. */
  private readonly maps = new Map<string, MapCombat>();
  /** Fight state of the players who left recently, by character. */
  private readonly carried = new Map<number, CarriedCombat>();
  private nextMonsterId = 1;
  private lastSecond = Date.now();

  constructor(private readonly world: World) {}

  private get ctx() {
    return this.world.ctx;
  }

  // --- Maps and monsters ------------------------------------------------------

  /** Combat state of a map, created (with its monsters) on first use. */
  private mapCombat(mapId: number, instance = 0): MapCombat | undefined {
    const key = mapRoom(mapId, instance);
    let mc = this.maps.get(key);
    if (!mc) {
      const runtime = this.world.mapRuntime(mapId);
      if (!runtime) return undefined;
      mc = new MapCombat(mapId, instance, runtime.map, runtime.flags, runtime.map.mmo.spawns ?? []);
      this.maps.set(key, mc);
      mc.spawns.forEach((s, i) => {
        const def = this.ctx.gameData.get('enemy', s.enemyId);
        if (def) for (let n = 0; n < s.count; n++) this.spawnMonster(mc!, def, i, false);
      });
    }
    return mc;
  }

  /** Places a new monster of a spawn on a free cell (or retries later when none is free). */
  private spawnMonster(mc: MapCombat, def: EnemyData, spawn: number, announce: boolean, reuse?: Monster): void {
    const cells = mc.cells[spawn] ?? [];
    const w = mc.map.width;
    let cell = -1;
    for (let tries = 0; tries < 20 && cells.length > 0; tries++) {
      const c = cells[Math.floor(Math.random() * cells.length)]!;
      if (!this.occupied(mc.mapId, c % w, Math.floor(c / w), mc.instance)) {
        cell = c;
        break;
      }
    }
    const now = Date.now();
    if (cell < 0) {
      if (reuse) reuse.respawnAt = now + 5000;
      return;
    }
    const stats = enemyStats(this.ctx, def, new Map());
    const m: Monster = reuse ?? {
      id: this.nextMonsterId++, def, spawn, x: 0, y: 0, direction: 2, hp: 0, mp: 0, homeX: 0, homeY: 0,
      mode: 'idle', targetId: 0, nextMoveAt: 0, nextActionAt: 0, modeUntil: 0, states: new Map(), damage: new Map(), dead: false, respawnAt: 0,
    };
    Object.assign(m, {
      def, homeX: cell % w, homeY: Math.floor(cell / w), direction: DIRS[Math.floor(Math.random() * 4)]!,
      hp: stats.params.mhp, mp: stats.params.mmp, mode: 'idle', targetId: 0, nextMoveAt: now + 500 + Math.random() * 2000, nextActionAt: now + 1000, dead: false,
    });
    mc.place(m, cell % w, Math.floor(cell / w));
    m.states.clear();
    m.damage.clear();
    mc.monsters.set(m.id, m);
    if (announce) this.world.room(mc.mapId, mc.instance)?.emit('monsterSpawned', this.view(m));
  }

  /** View of a monster for clients. */
  private view(m: Monster): MonsterView {
    return {
      id: m.id, enemyId: m.def.id, name: m.def.name, characterName: m.def.characterName, characterIndex: m.def.characterIndex,
      x: m.x, y: m.y, direction: m.direction, hp: m.hp, maxHp: this.monsterStats(m).params.mhp, moveSpeed: m.def.moveSpeed,
    };
  }

  /** Monsters of a map as sent to a player entering it. */
  views(mapId: number, instance = 0): MonsterView[] {
    const mc = this.mapCombat(mapId, instance);
    if (!mc) return [];
    const now = Date.now();
    // Monsters whose respawn timer ended while the map was empty come back before the snapshot is sent.
    for (const m of mc.monsters.values()) {
      if (m.dead && now >= m.respawnAt) this.respawn(mc, m);
    }
    return [...mc.monsters.values()].filter((m) => !m.dead).map((m) => this.view(m));
  }

  /** A defeated monster comes back with its enemy's current record (gone for good if the enemy was deleted). */
  private respawn(mc: MapCombat, m: Monster): void {
    const def = this.ctx.gameData.get('enemy', m.def.id);
    if (def) this.spawnMonster(mc, def, m.spawn, true, m);
    else mc.remove(m);
  }

  /**
   * Enemies were edited, deleted or imported in the database: the monsters on the maps take their
   * new record at once (keeping the same share of their HP), and those of a deleted enemy leave.
   */
  enemiesChanged(): void {
    const changed = new Map<number, EnemyData | null>();
    for (const mc of this.maps.values()) {
      for (const m of [...mc.monsters.values()]) {
        let def = changed.get(m.def.id);
        if (def === undefined) {
          const current = this.ctx.gameData.get('enemy', m.def.id);
          def = !current ? null : JSON.stringify(current) === JSON.stringify(m.def) ? m.def : current;
          changed.set(m.def.id, def);
        }
        if (def === m.def) continue;
        if (!def) {
          mc.remove(m);
          if (!m.dead) this.world.room(mc.mapId, mc.instance)?.emit('monsterRemoved', { id: m.id, died: false });
          continue;
        }
        const before = this.monsterStats(m).params;
        m.def = def;
        if (m.dead) continue;
        const after = this.monsterStats(m).params;
        m.hp = Math.max(1, Math.min(after.mhp, Math.round((m.hp / Math.max(1, before.mhp)) * after.mhp)));
        m.mp = Math.min(after.mmp, m.mp);
        // The same id sent again replaces the monster on the screens (name, sprite, HP bar, speed).
        this.world.room(mc.mapId, mc.instance)?.emit('monsterSpawned', this.view(m));
      }
    }
  }

  /** The map was edited: its monsters are recreated from the new spawns. */
  reloadMap(mapId: number): void {
    for (const [key, mc] of this.maps) if (mc.mapId === mapId) this.maps.delete(key);
  }

  /** Drops the combat state of an instance (the instance was closed). */
  dropZone(mapId: number, instance: number): void {
    this.maps.delete(mapRoom(mapId, instance));
  }

  /** Tells whether a living monster stands on a cell. */
  occupied(mapId: number, x: number, y: number, instance = 0): boolean {
    return this.maps.get(mapRoom(mapId, instance))?.occupied(x, y) ?? false;
  }

  /** Monster by id on a map. */
  monster(mapId: number, id: number, instance = 0): Monster | undefined {
    return this.maps.get(mapRoom(mapId, instance))?.monsters.get(id);
  }

  private monsterStats(m: Monster): BattlerStats {
    const stats = enemyStats(this.ctx, m.def, m.states);
    if (m.enraged) stats.params = { ...stats.params, atk: Math.floor(stats.params.atk * 1.5), mat: Math.floor(stats.params.mat * 1.5) };
    return stats;
  }

  // --- Bosses -------------------------------------------------------------------------

  /** Raid whose boss this monster is, in an instance of the raid's map. */
  private raidOf(mc: MapCombat, m: Monster) {
    if (!mc.instance) return undefined;
    const raid = this.world.instances.raidOn(mc.mapId);
    return raid && raid.bossEnemyId === m.def.id ? raid : undefined;
  }

  /**
   * A raid boss cannot be hurt while fewer players than the raid's minimum are in its instance: the raid is
   * played by that many players, not by one who entered alone. The player trying is told (every few seconds).
   */
  private bossWaiting(mc: MapCombat, m: Monster, p: PlayerSession): boolean {
    const raid = this.raidOf(mc, m);
    if (!raid || this.world.playersOn(mc.mapId, mc.instance).length >= raid.minPlayers) return false;
    const now = Date.now();
    if (now >= (p.combat.bossWaitNoticeAt ?? 0)) {
      p.combat.bossWaitNoticeAt = now + 5000;
      p.socket.emit('notify', { key: 'notify.boss_waiting', params: { name: m.def.name, count: raid.minPlayers } });
    }
    return true;
  }

  /** Phases of a fighting boss: adds, marked zones, enrage. */
  private bossTick(mc: MapCombat, m: Monster, now: number): void {
    const raid = this.raidOf(mc, m);
    if (!raid) return;
    const hpRate = (m.hp / Math.max(1, this.monsterStats(m).params.mhp)) * 100;
    m.phases ??= new Map();
    raid.phases.forEach((phase, index) => {
      if (hpRate >= phase.hpBelow) return;
      const next = m.phases!.get(index);
      if (next === undefined) {
        // The phase starts.
        m.phases!.set(index, phase.interval > 0 ? now + phase.interval * 1000 : Number.MAX_SAFE_INTEGER);
        if (phase.mechanic === 'enrage') {
          m.enraged = true;
          for (const p of this.world.playersOn(mc.mapId, mc.instance)) p.socket.emit('notify', { key: 'notify.boss_enraged', params: { name: m.def.name } });
        } else this.bossMechanic(mc, m, phase);
      } else if (now >= next && phase.mechanic !== 'enrage') {
        m.phases!.set(index, now + Math.max(1, phase.interval) * 1000);
        this.bossMechanic(mc, m, phase);
      }
    });
  }

  private bossMechanic(mc: MapCombat, m: Monster, phase: RaidData['phases'][number]): void {
    if (phase.mechanic === 'adds') {
      const def = this.ctx.gameData.get('enemy', phase.enemyId);
      if (!def) return;
      for (let i = 0; i < phase.count; i++) {
        const add = this.summon(mc, def, m.x, m.y);
        if (add) add.summoner = m.id;
      }
      for (const p of this.world.playersOn(mc.mapId, mc.instance)) p.socket.emit('notify', { key: 'notify.boss_adds', params: { name: m.def.name } });
    } else if (phase.mechanic === 'zone') {
      const players = this.world.playersOn(mc.mapId, mc.instance).filter((p) => !p.combat.dead && !p.invisible && !this.protectedFromMonsters(p));
      const target = players[Math.floor(Math.random() * players.length)];
      if (target) this.strike(mc, target.x, target.y, phase.radius, phase.damage);
    }
  }

  /** Removes the adds a boss called (it was defeated, or it starts the fight over). */
  private dismissAdds(mc: MapCombat, boss: Monster): void {
    for (const add of mc.monsters.values()) {
      if (add.summoner !== boss.id) continue;
      mc.remove(add);
      this.world.room(mc.mapId, mc.instance)?.emit('monsterRemoved', { id: add.id, died: false });
    }
  }

  /** A monster called by a boss (or by an event), on a free cell near a point. */
  private summon(mc: MapCombat, def: EnemyData, x: number, y: number): Monster | undefined {
    for (let r = 1; r <= 3; r++) {
      for (let tries = 0; tries < 8; tries++) {
        const cx = x + Math.floor(Math.random() * (2 * r + 1)) - r;
        const cy = y + Math.floor(Math.random() * (2 * r + 1)) - r;
        if (cx < 0 || cy < 0 || cx >= mc.map.width || cy >= mc.map.height) continue;
        if (!DIRS.some((d) => isPassable(mc.map, mc.flags, cx, cy, d)) || mc.blocked.has(cy * mc.map.width + cx) || mc.occupied(cx, cy)) continue;
        if (this.world.playersOn(mc.mapId, mc.instance).some((p) => p.x === cx && p.y === cy)) continue;
        const stats = enemyStats(this.ctx, def, new Map());
        const add: Monster = {
          id: this.nextMonsterId++, def, spawn: -1, x: cx, y: cy, direction: 2, hp: stats.params.mhp, mp: stats.params.mmp, homeX: cx, homeY: cy,
          mode: 'idle', targetId: 0, nextMoveAt: Date.now() + 500, nextActionAt: Date.now() + 1000, modeUntil: 0, states: new Map(), damage: new Map(), dead: false, respawnAt: 0, summoned: true,
        };
        mc.place(add, cx, cy);
        mc.monsters.set(add.id, add);
        this.world.room(mc.mapId, mc.instance)?.emit('monsterSpawned', this.view(add));
        return add;
      }
    }
    return undefined;
  }

  /**
   * Event command "Battle": an enemy appears next to the player, in their zone,
   * and attacks them at once; it is removed for good when defeated.
   * @returns `false` when the enemy does not exist or no cell is free nearby.
   */
  ambush(p: PlayerSession, enemyId: number): boolean {
    const def = this.ctx.gameData.get('enemy', enemyId);
    const mc = def ? this.mapCombat(p.mapId, p.instance) : undefined;
    const m = def && mc ? this.summon(mc, def, p.x, p.y) : undefined;
    if (!m) return false;
    // The fight is wanted by the event: the arrival protection (login, new map) would make the enemy give up at once.
    p.combat.protectedUntil = 0;
    m.mode = 'chase';
    m.targetId = p.characterId;
    return true;
  }

  /** Marks an area, then hits the players still inside it. */
  private strike(mc: MapCombat, x: number, y: number, radius: number, damage: number): void {
    const ms = 1500;
    this.world.room(mc.mapId, mc.instance)?.emit('telegraph', { x, y, radius, ms });
    const timer = setTimeout(() => {
      // A failure is logged, like a failing round of the world: thrown from a timer, it would stop the whole server.
      try {
        if (this.maps.get(mapRoom(mc.mapId, mc.instance)) !== mc) return;
        const views: DamageView[] = [];
        for (const p of this.world.playersOn(mc.mapId, mc.instance)) {
          // Like the monsters' own attacks: nothing for a player still loading the map, nor for an invisible one.
          if (p.combat.dead || p.invisible || this.protectedFromMonsters(p) || distance(mc.map, p.x, p.y, x, y) > radius) continue;
          const target: Combatant = { kind: 'player', p };
          this.applyVitals(target, 'hp_damage', damage, null);
          views.push({ target: this.actor(target), amount: damage, kind: 'hp_damage', critical: false, hp: p.hp, maxHp: this.stats(p).params.mhp });
        }
        this.broadcastDamage(mc, views);
      } catch (err) {
        console.error('[brindiwanko] telegraphed strike failed', err);
      }
    }, ms);
    timer.unref();
  }

  // --- Players ------------------------------------------------------------------

  /** Battle parameters of a player (cached until equipment, level or states change). */
  stats(p: PlayerSession): BattlerStats {
    p.combat.stats ??= playerStats(this.ctx, p.characterId, p.classId, p.level, p.combat.states, p.allocated);
    return p.combat.stats;
  }

  /** Equipment, level or states changed: parameters are computed again. */
  invalidate(p: PlayerSession): void {
    p.combat.stats = null;
    // Skills given by traits (a staff that teaches a spell while it is held) come and go with them.
    const granted = this.grantedSkills(p);
    if (granted.join() !== p.combat.granted.join()) {
      p.combat.granted = granted;
      this.pushSkills(p);
    }
  }

  /** Skills given by the traits of the class, the equipment and the states of a player. */
  private grantedSkills(p: PlayerSession): number[] {
    return this.stats(p).traits.filter((t) => t.kind === 'add_skill').map((t) => Number(t.target)).filter((id) => id > 0);
  }

  /** Tells whether a player may move (alive, no movement restriction). */
  canMove(p: PlayerSession): boolean {
    return !p.combat.dead && !this.restricted(p.combat.states, 'move');
  }

  private restricted(states: ActiveStates, what: 'move' | 'act'): boolean {
    for (const id of states.keys()) {
      const r = this.ctx.gameData.get('state', id)?.restriction ?? 'none';
      if (r === 'cannot_both' || r === (what === 'move' ? 'cannot_move' : 'cannot_act')) return true;
    }
    return false;
  }

  /** Skills a player knows (learnt from its class up to its level). */
  knownSkills(p: PlayerSession): SkillData[] {
    const cls = this.ctx.gameData.get('class', p.classId);
    // Skills of the class up to the level, those learned elsewhere (skill books, events), then those given by traits.
    const ids = [...new Set([...(cls?.learnings ?? []).filter((l) => l.level <= p.level).map((l) => l.skillId), ...p.combat.learned, ...this.grantedSkills(p)])];
    return ids.map((id) => this.ctx.gameData.get('skill', id)).filter((s): s is SkillData => s !== undefined);
  }

  /**
   * Teaches a skill to a player for good (stored with the character), unless already known.
   * @returns Whether the skill is new.
   */
  learnSkill(p: PlayerSession, skillId: number): boolean {
    const skill = this.ctx.gameData.get('skill', skillId);
    if (!skill || this.knownSkills(p).some((s) => s.id === skillId)) return false;
    this.ctx.progression.learnSkill(p.characterId, skillId);
    p.combat.learned.push(skillId);
    if (this.announceSkill(p, skill)) this.ctx.progression.setHotbar(p.characterId, p.combat.hotbar);
    this.pushSkills(p);
    return true;
  }

  /** Tells a player a skill is new, and places it on a free slot of the hotbar; tells whether the hotbar changed. */
  private announceSkill(p: PlayerSession, skill: SkillData): boolean {
    p.socket.emit('notify', { key: 'notify.skill_learned', params: { name: skill.name }, icon: skill.icon });
    const free = p.combat.hotbar.findIndex((s) => s === null);
    if (free < 0 || p.combat.hotbar.some((s) => s?.kind === 'skill' && s.id === skill.id)) return false;
    p.combat.hotbar[free] = { kind: 'skill', id: skill.id };
    return true;
  }

  /** Skills, hotbar and running cooldowns of a player. */
  skillsPayload(p: PlayerSession): SkillsPayload {
    const now = Date.now();
    const types = this.ctx.settings.get('skillTypes', DEFAULT_SETTINGS.skillTypes);
    const skills: SkillView[] = this.knownSkills(p).map((s) => ({
      id: s.id, name: s.name, description: s.description, icon: s.icon, typeName: s.skillType > 0 ? (types[s.skillType] ?? '') : '', mpCost: s.mpCost, cooldown: s.cooldown, range: s.range,
    }));
    const cooldowns: Record<number, number> = {};
    for (const [id, readyAt] of p.combat.cooldowns) if (readyAt > now) cooldowns[id] = readyAt - now;
    return { skills, hotbar: p.combat.hotbar, cooldowns };
  }

  /** Sends the skills payload. */
  pushSkills(p: PlayerSession): void {
    if (this.world.isLive(p)) p.socket.emit('skills', this.skillsPayload(p));
  }

  /** A player entered the world: hotbar loaded (filled with known skills when empty). */
  playerJoined(p: PlayerSession): void {
    p.combat.hotbar = this.ctx.progression.hotbar(p.characterId);
    if (p.combat.hotbar.every((s) => s === null)) {
      this.knownSkills(p).slice(0, HOTBAR_SIZE).forEach((s, i) => (p.combat.hotbar[i] = { kind: 'skill', id: s.id }));
    }
    // Back from a page reload or a dropped connection: the fight goes on where it was.
    const now = Date.now();
    const carried = this.carried.get(p.characterId);
    this.carried.delete(p.characterId);
    if (!carried || carried.until <= now) return;
    const c = p.combat;
    c.cooldowns = new Map(carried.cooldowns.filter(([, at]) => at > now));
    c.globalReadyAt = carried.globalReadyAt;
    c.states = new Map(carried.states.filter(([, until]) => until > now));
    c.stateSteps = new Map(carried.stateSteps.filter(([id]) => c.states.has(id)));
    c.lastHurt = carried.lastHurt;
    // The arrival protection is for the loading screen of a new session, not a way out of a fight: any of it
    // would make the monsters chasing the player give up and go home to heal.
    if (now - carried.lastHurt < REGEN_DELAY_MS) c.protectedUntil = 0;
    if (carried.respawnAt > now) {
      c.dead = true;
      c.respawnAt = carried.respawnAt;
    }
  }

  /** The client of a player who just joined is ready: it learns the fight state carried over from its last session. */
  afterEnter(p: PlayerSession): void {
    const now = Date.now();
    for (const [skillId, at] of p.combat.cooldowns) if (at > now) p.socket.emit('cooldown', { skillId, ms: at - now });
    if (p.combat.states.size) this.statesChanged({ kind: 'player', p });
    if (p.combat.dead) {
      // Knocked out before leaving: still down (the save already put it at its respawn point), for the time left.
      const ms = Math.max(0, (p.combat.respawnAt ?? now) - now);
      p.hp = 0;
      p.socket.emit('playerUpdate', { hp: 0 });
      p.socket.emit('playerDied', { seconds: Math.ceil(ms / 1000) });
      this.scheduleRespawn(p, ms);
    }
  }

  /** A player leaves the game: its fight state is kept a while for a quick return. */
  playerLeft(p: PlayerSession): void {
    const now = Date.now();
    const c = p.combat;
    for (const [id, entry] of this.carried) if (entry.until <= now) this.carried.delete(id);
    const cooldowns = [...c.cooldowns].filter(([, at]) => at > now);
    const states = [...c.states].filter(([, until]) => until > now);
    const respawnAt = c.dead ? (c.respawnAt ?? now) : 0;
    if (!cooldowns.length && !states.length && respawnAt <= now && now - c.lastHurt >= REGEN_DELAY_MS && c.globalReadyAt <= now) return;
    this.carried.set(p.characterId, { until: now + CARRY_COMBAT_MS, cooldowns, globalReadyAt: c.globalReadyAt, states, stateSteps: [...c.stateSteps], lastHurt: c.lastHurt, respawnAt });
  }

  /** Stores a new hotbar sent by the player. */
  setHotbar(p: PlayerSession, slots: HotbarSlot[]): void {
    this.ctx.progression.setHotbar(p.characterId, slots);
    p.combat.hotbar = this.ctx.progression.hotbar(p.characterId);
  }

  /** The player's level changed: new skills are announced and placed on the hotbar. */
  levelChanged(p: PlayerSession, before: number): void {
    this.invalidate(p);
    if (p.level <= before) return;
    const cls = this.ctx.gameData.get('class', p.classId);
    const learnt = (cls?.learnings ?? []).filter((l) => l.level > before && l.level <= p.level);
    let changed = false;
    for (const l of learnt) {
      const skill = this.ctx.gameData.get('skill', l.skillId);
      if (skill) changed = this.announceSkill(p, skill) || changed;
    }
    if (changed) this.ctx.progression.setHotbar(p.characterId, p.combat.hotbar);
    this.pushSkills(p);
  }

  // --- Combatants -----------------------------------------------------------------

  private actor(c: Combatant): CombatActor {
    return c.kind === 'player' ? { kind: 'player', id: c.p.characterId } : { kind: 'monster', id: c.m.id };
  }

  private statsOf(c: Combatant): BattlerStats {
    return c.kind === 'player' ? this.stats(c.p) : this.monsterStats(c.m);
  }

  private statesOf(c: Combatant): ActiveStates {
    return c.kind === 'player' ? c.p.combat.states : c.m.states;
  }

  private position(c: Combatant): { x: number; y: number; direction: Direction } {
    return c.kind === 'player' ? c.p : c.m;
  }

  private vitals(c: Combatant): { hp: number; mp: number; level: number } {
    return c.kind === 'player' ? { hp: c.p.hp, mp: c.p.mp, level: c.p.level } : { hp: c.m.hp, mp: c.m.mp, level: 1 };
  }

  /** Values a damage formula reads about a battler. */
  private formulaView(c: Combatant): Record<string, number> {
    return { ...this.statsOf(c).params, ...this.vitals(c) };
  }

  private alive(c: Combatant): boolean {
    return c.kind === 'player' ? !c.p.combat.dead && this.world.isLive(c.p) : !c.m.dead;
  }

  /**
   * Hostile battlers standing on a cell, as seen by an attacker: for a player,
   * the monsters (and the other players on PvP maps); for a monster, the
   * players only (monsters never hurt each other). Invisible players are not
   * there for anybody.
   */
  private targetsAt(mc: MapCombat, user: Combatant, x: number, y: number): Combatant[] {
    const out: Combatant[] = [];
    if (user.kind === 'player') for (const m of mc.monsters.values()) if (!m.dead && m.mode !== 'return' && m.x === x && m.y === y && !this.bossWaiting(mc, m, user.p)) out.push({ kind: 'monster', m, map: mc });
    if (user.kind === 'player' ? mc.map.mmo.pvp : true) {
      for (const p of this.world.playersOn(mc.mapId, mc.instance)) {
        if (p.x !== x || p.y !== y || p.combat.dead || p.invisible || p.editing || (user.kind === 'player' && user.p === p)) continue;
        // On a PvP map, party members and guild mates are allies (as for heals): attacks pass them by.
        if (user.kind === 'player' && this.isAlly(mc, user.p, p)) continue;
        out.push({ kind: 'player', p });
      }
    }
    return out;
  }

  /**
   * Next cell an attack reaches from a cell towards `d`, or `null` when it is stopped. Attacks travel like
   * a character walks: walls, cliffs, water and solid events stop them (otherwise a ranged attacker could
   * hit, from a spot it cannot be reached on, monsters unable to come back at it).
   */
  private lineStep(mc: MapCombat, x: number, y: number, d: Direction): { x: number; y: number } | null {
    if (!canMove(mc.map, mc.flags, x, y, d)) return null;
    const next = stepCell(mc.map, x, y, d);
    return mc.blocked.has(next.y * mc.map.width + next.x) ? null : next;
  }

  /** Whether an attack from a cell towards `d` reaches `steps` cells away. */
  private lineClear(mc: MapCombat, x: number, y: number, d: Direction, steps: number): boolean {
    let at: { x: number; y: number } | null = { x, y };
    for (let i = 0; i < steps && at; i++) at = this.lineStep(mc, at.x, at.y, d);
    return at !== null;
  }

  /** First hostile target on the line the user faces, within `range` cells. */
  private firstInLine(mc: MapCombat, user: Combatant, range: number): { target: Combatant | null; cell: { x: number; y: number } } {
    const pos = this.position(user);
    // Without a free cell ahead (a wall), the attack stays on the user's own cell: an area centred on the
    // wall would reach what stands behind it.
    let cell = { x: pos.x, y: pos.y };
    let at = { x: pos.x, y: pos.y };
    for (let i = 1; i <= Math.max(1, range); i++) {
      const next = this.lineStep(mc, at.x, at.y, pos.direction);
      if (!next) break;
      at = next;
      const { x, y } = at;
      cell = { x, y };
      const found = this.targetsAt(mc, user, x, y);
      if (found.length) return { target: found[0]!, cell };
    }
    return { target: null, cell };
  }

  // --- Damage -----------------------------------------------------------------

  /**
   * Computes and applies one hit.
   * @param normalAttack - Uses the attack element and critical rate of the user.
   */
  private hit(user: Combatant, target: Combatant, damage: Damage, normalAttack: boolean): DamageView | null {
    if (damage.type === 'none' || !this.alive(target)) return null;
    const a = this.statsOf(user);
    const b = this.statsOf(target);
    const hostile = damage.type === 'hp_damage' || damage.type === 'mp_damage';
    const maxHp = b.params.mhp;
    if (hostile) {
      const hitRate = COMBAT.hitRate + traitSum(a.traits, 'hit_rate');
      const evasion = COMBAT.evasionRate + traitSum(b.traits, 'evasion') + Math.max(0, (b.params.agi - a.params.agi) / 1000);
      if (Math.random() > hitRate || Math.random() < evasion) {
        return { target: this.actor(target), amount: 0, kind: 'miss', critical: false, hp: this.vitals(target).hp, maxHp };
      }
    }
    let value = evalFormula(damage.formula, this.formulaView(user), this.formulaView(target), (id) => (user.kind === 'player' ? this.world.getVariable(user.p, id) : 0));
    const element = normalAttack ? attackElement(a.traits) : damage.element;
    value *= elementRate(b.traits, element);
    if (damage.variance > 0) value *= 1 + ((Math.random() * 2 - 1) * damage.variance) / 100;
    let critical = false;
    if (hostile && (normalAttack || damage.critical)) {
      const rate = COMBAT.criticalRate + traitSum(a.traits, 'critical') + Math.max(0, (a.params.luk - b.params.luk) / 1000);
      critical = Math.random() < rate;
      if (critical) value *= COMBAT.criticalMultiplier;
    }
    const amount = Math.max(0, Math.round(value));
    this.applyVitals(target, damage.type, amount, user);
    return { target: this.actor(target), amount, kind: damage.type, critical, hp: this.vitals(target).hp, maxHp };
  }

  /** Changes HP / MP of a combatant, handling death and damage-removed states. */
  private applyVitals(target: Combatant, kind: Damage['type'], amount: number, source: Combatant | null): void {
    const max = this.statsOf(target).params;
    const sign = kind === 'hp_damage' || kind === 'mp_damage' ? -1 : 1;
    const hpKind = kind === 'hp_damage' || kind === 'hp_recover';
    if (target.kind === 'player') {
      const p = target.p;
      // Monsters (area attacks included) cannot hurt a player who is still loading the map.
      if (sign < 0 && source?.kind === 'monster' && this.protectedFromMonsters(p)) return;
      if (hpKind) p.hp = Math.max(0, Math.min(max.mhp, p.hp + sign * amount));
      else p.mp = Math.max(0, Math.min(max.mmp, p.mp + sign * amount));
      p.socket.emit('playerUpdate', { hp: p.hp, mp: p.mp });
      if (sign < 0) {
        p.combat.lastHurt = Date.now();
        this.removeOnDamage(target);
      }
      if (p.hp <= 0) this.playerDies(p);
    } else {
      const m = target.m;
      if (hpKind) m.hp = Math.max(0, Math.min(max.mhp, m.hp + sign * amount));
      else m.mp = Math.max(0, Math.min(max.mmp, m.mp + sign * amount));
      if (sign < 0 && source?.kind === 'player') {
        m.damage.set(source.p.characterId, (m.damage.get(source.p.characterId) ?? 0) + amount);
        // Any monster hit turns on its attacker (passive ones included), unless it is walking back to its spawn.
        if (m.mode !== 'flee' && m.mode !== 'return') {
          m.mode = 'chase';
          m.targetId = source.p.characterId;
        }
        this.removeOnDamage(target);
      }
      if (m.hp <= 0) this.monsterDies(target.map, m);
    }
  }

  private removeOnDamage(c: Combatant): void {
    const states = this.statesOf(c);
    const ended: number[] = [];
    for (const id of [...states.keys()]) {
      const state = this.ctx.gameData.get('state', id);
      if (state?.removeOnDamage && Math.random() * 100 < state.removeOnDamageChance) {
        states.delete(id);
        ended.push(id);
      }
    }
    this.statesEnded(c, ended);
  }

  /**
   * Puts a state on a combatant, for a duration drawn between its minimum and its maximum, with its
   * message and its animation.
   */
  private addState(user: Combatant, target: Combatant, state: StateData, now: number): void {
    const longest = Math.max(state.duration, state.durationMax);
    const seconds = state.duration > 0 ? state.duration + Math.random() * (longest - state.duration) : 0;
    this.statesOf(target).set(state.id, seconds > 0 ? now + seconds * 1000 : Infinity);
    // Applied again, a state removed after some steps counts them from zero.
    if (target.kind === 'player') target.p.combat.stateSteps.delete(state.id);
    this.statesChanged(target);
    if (target.kind === 'player' && state.message) target.p.socket.emit('notify', { key: 'notify.state_added', params: { name: target.p.name, message: state.message }, icon: state.icon });
    const animation = this.animation(state.animationId);
    if (animation) {
      const zone = target.kind === 'player' ? target.p : target.map;
      this.announce(zone, { actor: this.actor(user), direction: this.position(user).direction, skillId: 0, range: 0, targets: [this.position(target)], animation }, [target]);
    }
  }

  /** States that ended on a combatant (removed or expired): icons and parameters refreshed, end messages shown to a player. */
  private statesEnded(c: Combatant, ids: number[]): void {
    if (ids.length === 0) return;
    this.statesChanged(c);
    if (c.kind !== 'player') return;
    for (const id of ids) {
      c.p.combat.stateSteps.delete(id);
      const state = this.ctx.gameData.get('state', id);
      if (state?.endMessage) c.p.socket.emit('notify', { key: 'notify.state_removed', params: { name: c.p.name, message: state.endMessage }, icon: state.icon });
    }
  }

  /** A player walked one cell: states removed after some steps count it. */
  playerStepped(p: PlayerSession, onDamageFloor = false): void {
    // A damage floor (tileset flag) hurts at each step, but never knocks out.
    if (onDamageFloor && !p.combat.dead && p.hp > 1) {
      const c: Combatant = { kind: 'player', p };
      const amount = Math.min(FLOOR_DAMAGE, p.hp - 1);
      this.applyVitals(c, 'hp_damage', amount, null);
      this.broadcastDamage(p, [{ target: this.actor(c), amount, kind: 'hp_damage', critical: false, hp: p.hp, maxHp: this.statsOf(c).params.mhp }]);
    }
    const ended: number[] = [];
    for (const id of p.combat.states.keys()) {
      const steps = this.ctx.gameData.get('state', id)?.removeAfterSteps ?? 0;
      if (steps <= 0) continue;
      const walked = (p.combat.stateSteps.get(id) ?? 0) + 1;
      if (walked >= steps) ended.push(id);
      else p.combat.stateSteps.set(id, walked);
    }
    for (const id of ended) p.combat.states.delete(id);
    this.statesEnded({ kind: 'player', p }, ended);
  }

  /** Applies the effects of a skill or item to a target. */
  private applyEffects(user: Combatant, target: Combatant, effects: Effect[]): DamageView[] {
    const views: DamageView[] = [];
    const now = Date.now();
    const maxHp = () => this.statsOf(target).params.mhp;
    for (const e of effects) {
      if (!this.alive(target)) break;
      const states = this.statesOf(target);
      if (e.kind === 'add_state') {
        const state = this.ctx.gameData.get('state', e.value);
        if (!state || Math.random() * 100 >= e.percent * stateRate(this.statsOf(target).traits, state.id)) continue;
        this.addState(user, target, state, now);
      } else if (e.kind === 'remove_state') {
        // A chance of 0 comes from records saved before removals had one: it means "always".
        if (!states.has(e.value) || Math.random() * 100 >= (e.percent || 100)) continue;
        states.delete(e.value);
        this.statesEnded(target, [e.value]);
      } else if (e.kind === 'learn_skill' && target.kind === 'player') {
        this.learnSkill(target.p, e.value);
      } else if (e.kind === 'recover_hp' || e.kind === 'recover_mp') {
        const params = this.statsOf(target).params;
        const amount = e.value + Math.floor(((e.kind === 'recover_hp' ? params.mhp : params.mmp) * e.percent) / 100);
        const kind = e.kind === 'recover_hp' ? 'hp_recover' : 'mp_recover';
        this.applyVitals(target, kind, amount, user);
        views.push({ target: this.actor(target), amount, kind, critical: false, hp: this.vitals(target).hp, maxHp: maxHp() });
      } else if (e.kind === 'gain_xp' && target.kind === 'player') {
        this.world.runner.setExp(target.p, target.p.xp + e.value, true);
      } else if (e.kind === 'common_event' && target.kind === 'player') {
        const list = this.ctx.gameData.get('commonEvent', e.value)?.list;
        if (list && !target.p.busy) void this.world.runner.runCommonList(target.p, list, e.value);
      }
    }
    return views;
  }

  /**
   * Effects of an item used from the bag on its user, other than HP and MP (computed with the
   * inventory): states added or cured, experience, common event.
   */
  itemEffects(p: PlayerSession, effects: Effect[]): void {
    const self: Combatant = { kind: 'player', p };
    const others = effects.filter((e) => e.kind !== 'recover_hp' && e.kind !== 'recover_mp');
    if (others.length) this.applyEffects(self, self, others);
  }

  /**
   * Tells whether an effect other than HP and MP would change something for a player now (a cure needs
   * the state, a skill book a skill not known yet).
   */
  effectUseful(p: PlayerSession, e: Effect): boolean {
    if (e.kind === 'remove_state') return p.combat.states.has(e.value);
    if (e.kind === 'learn_skill') return this.ctx.gameData.get('skill', e.value) !== undefined && !this.knownSkills(p).some((s) => s.id === e.value);
    return true;
  }

  /** States of a combatant changed (parameters, HUD icons, highest priority first). */
  private statesChanged(c: Combatant): void {
    if (c.kind !== 'player') return;
    this.invalidate(c.p);
    const states = [...c.p.combat.states.keys()].map((id) => this.ctx.gameData.get('state', id));
    const icons = states.sort((a, b) => (b?.priority ?? 0) - (a?.priority ?? 0)).map((s) => s?.icon ?? 0);
    c.p.socket.emit('playerUpdate', { states: icons });
  }

  // --- Actions --------------------------------------------------------------------

  /**
   * Sends an action (animation) to the players who see its user or one of the battlers it involves (their
   * area of interest), not to the whole map.
   */
  private announce(zone: Zone, action: ActionView, involved: readonly Combatant[]): void {
    const ids = [aoiId(action.actor)];
    for (const c of involved) ids.push(aoiId(this.actor(c)));
    // Targets may be battlers: only their coordinates are sent.
    this.world.seeing(zone.mapId, zone.instance, ids)?.emit('combatAction', { ...action, targets: action.targets.map(({ x, y }) => ({ x, y })) });
  }

  /** Sends damage numbers to the players who see one of the battlers hit (or the one who hit them). */
  private broadcastDamage(zone: Zone, views: DamageView[], source?: Combatant): void {
    if (!views.length) return;
    const ids = views.map((v) => aoiId(v.target));
    if (source) ids.push(aoiId(this.actor(source)));
    this.world.seeing(zone.mapId, zone.instance, ids)?.emit('damage', views);
  }

  private animation(id: number): ActionView['animation'] {
    const a = id > 0 ? this.ctx.gameData.get('animation', id) : undefined;
    return a ? { sheet: a.sheet, frameCount: a.frameCount, frameSize: a.frameSize, fps: a.fps, sound: a.sound } : null;
  }

  /** Can a player act now (alive, not in a dialogue, not restricted)? */
  private ready(p: PlayerSession): boolean {
    return this.world.isLive(p) && !p.busy && !p.combat.dead && !this.restricted(p.combat.states, 'act');
  }

  /** Normal attack of a player in the direction it faces. */
  attack(p: PlayerSession): void {
    const now = Date.now();
    if (!this.ready(p) || now < p.combat.nextAttackAt) return;
    const mc = this.mapCombat(p.mapId, p.instance);
    if (!mc) return;
    p.combat.protectedUntil = 0;
    const user: Combatant = { kind: 'player', p };
    const stats = this.stats(p);
    p.combat.nextAttackAt = now + Math.max(350, COMBAT.attackDelay * (1 - Math.min(0.4, stats.params.agi / 300)));
    const { target, cell } = this.firstInLine(mc, user, stats.attackRange);
    this.announce(mc, { actor: this.actor(user), direction: p.direction, skillId: 0, range: stats.attackRange, targets: [target ? this.position(target) : cell], animation: this.animation(stats.attackAnimation) }, target ? [target] : []);
    if (!target) return;
    const view = this.hit(user, target, { type: 'hp_damage', formula: COMBAT.attackFormula, element: 0, variance: 20, critical: true }, true);
    if (view) this.broadcastDamage(mc, [view], user);
    if (view && view.kind !== 'miss') this.attackStates(user, target);
  }

  /** States carried by the normal attacks of a combatant (a poisoned dagger), each with its chance. */
  private attackStates(user: Combatant, target: Combatant): void {
    const now = Date.now();
    for (const t of this.statsOf(user).traits) {
      if (t.kind !== 'attack_state' || !this.alive(target)) continue;
      const state = this.ctx.gameData.get('state', Number(t.target));
      if (state && Math.random() * 100 < t.value * stateRate(this.statsOf(target).traits, state.id)) this.addState(user, target, state, now);
    }
  }

  /** Uses a skill from the hotbar or the skill list. */
  useSkill(p: PlayerSession, skillId: number): void {
    const now = Date.now();
    if (!this.ready(p)) return;
    const skill = this.knownSkills(p).find((s) => s.id === skillId);
    if (!skill) return;
    if (now < p.combat.globalReadyAt) return;
    const readyAt = p.combat.cooldowns.get(skillId) ?? 0;
    if (now < readyAt) {
      p.socket.emit('notify', { key: 'error.combat.skill_cooldown', params: { seconds: Math.ceil((readyAt - now) / 1000) } });
      return;
    }
    if (p.mp < skill.mpCost) {
      // Named as in the game (System terms), not as in the interface translations.
      p.socket.emit('notify', { key: 'error.combat.not_enough_mp', params: { term: this.ctx.settings.get('terms', DEFAULT_SETTINGS.terms).mp } });
      return;
    }
    // A skill may need a kind of weapon in hand (an arrow volley needs a bow).
    if (skill.requiredWeaponType > 0) {
      const held = this.ctx.progression.equipment(p.characterId).get('weapon');
      if ((held ? this.ctx.gameData.get('weapon', held.id)?.weaponType : undefined) !== skill.requiredWeaponType) {
        const type = this.ctx.settings.get('weaponTypes', DEFAULT_SETTINGS.weaponTypes)[skill.requiredWeaponType] ?? `#${skill.requiredWeaponType}`;
        p.socket.emit('notify', { key: 'error.combat.weapon_required', params: { type } });
        return;
      }
    }
    const mc = this.mapCombat(p.mapId, p.instance);
    if (!mc) return;
    p.combat.protectedUntil = 0;
    const user: Combatant = { kind: 'player', p };
    const targets = this.skillTargets(mc, user, skill.scope, skill.range, skill.area);
    if (targets.hostile && targets.list.length === 0) {
      p.socket.emit('notify', { key: 'error.combat.no_target' });
      return;
    }
    p.mp -= skill.mpCost;
    p.socket.emit('playerUpdate', { mp: p.mp });
    p.combat.globalReadyAt = now + GLOBAL_COOLDOWN_MS;
    if (skill.cooldown > 0) {
      p.combat.cooldowns.set(skill.id, now + skill.cooldown * 1000);
      p.socket.emit('cooldown', { skillId: skill.id, ms: skill.cooldown * 1000 });
    }
    this.perform(mc, user, skill, targets.list, targets.cells);
  }

  /**
   * Tells whether a player may receive another one's ally skills: alive and visible (an invisible
   * moderator must not be revealed by a heal), and on PvP maps in the same party or guild (or itself).
   */
  private isAlly(mc: MapCombat, user: PlayerSession, other: PlayerSession): boolean {
    if (other.combat.dead) return false;
    if (other === user) return true;
    if (other.invisible) return false;
    if (!mc.map.mmo.pvp) return true;
    const party = this.world.party.partyOf(user.characterId);
    return (party !== 0 && party === this.world.party.partyOf(other.characterId)) || (!!user.guild && user.guild.id === other.guild?.id);
  }

  /** Resolves the targets of a skill scope. */
  private skillTargets(mc: MapCombat, user: Combatant, scope: Scope, range: number, area: number): { list: Combatant[]; cells: { x: number; y: number }[]; hostile: boolean } {
    const pos = this.position(user);
    if (scope === 'enemy' || scope === 'enemies_area') {
      const { target, cell } = this.firstInLine(mc, user, Math.max(1, range));
      if (scope === 'enemy') return { list: target ? [target] : [], cells: [target ? this.position(target) : cell], hostile: true };
      const center = target ? this.position(target) : cell;
      const list: Combatant[] = [];
      for (let y = center.y - area; y <= center.y + area; y++) {
        for (let x = center.x - area; x <= center.x + area; x++) {
          const cell = wrapCell(mc.map, x, y);
          list.push(...this.targetsAt(mc, user, cell.x, cell.y));
        }
      }
      return { list, cells: [center], hostile: true };
    }
    if (scope === 'allies_area') {
      const list: Combatant[] = user.kind === 'player'
        ? this.world.playersOn(mc.mapId, mc.instance).filter((o) => this.isAlly(mc, user.p, o) && distance(mc.map, o.x, o.y, pos.x, pos.y) <= Math.max(area, 1)).map((o) => ({ kind: 'player', p: o }))
        : [...mc.monsters.values()].filter((m) => !m.dead && distance(mc.map, m.x, m.y, pos.x, pos.y) <= Math.max(area, 1)).map((m) => ({ kind: 'monster', m, map: mc }));
      return { list, cells: [pos], hostile: false };
    }
    if (scope === 'ally' && user.kind === 'player') {
      // The ally faced within range, or the user itself.
      let at = { x: pos.x, y: pos.y };
      for (let i = 1; i <= Math.max(1, range); i++) {
        const next = this.lineStep(mc, at.x, at.y, pos.direction);
        if (!next) break;
        at = next;
        const cell = at;
        const other = this.world.playersOn(mc.mapId, mc.instance).find((o) => o !== user.p && this.isAlly(mc, user.p, o) && o.x === cell.x && o.y === cell.y);
        if (other) return { list: [{ kind: 'player', p: other }], cells: [other], hostile: false };
      }
    }
    return { list: [user], cells: [pos], hostile: false };
  }

  /** Performs a skill on resolved targets (message, animation, then damage and effects as many times as it repeats). */
  private perform(mc: MapCombat, user: Combatant, skill: SkillData, targets: Combatant[], cells: { x: number; y: number }[]): void {
    const pos = this.position(user);
    this.announce(mc, { actor: this.actor(user), direction: pos.direction, skillId: skill.id, range: skill.range, targets: cells, animation: this.animation(skill.animationId) }, targets);
    if (skill.message.trim()) this.skillMessage(mc, user, skill.message);
    const views: DamageView[] = [];
    for (let repeat = 0; repeat < Math.max(1, skill.repeats); repeat++) {
      for (const target of targets) {
        if (!this.alive(target)) continue;
        // Below 100 %, the skill may simply fail on a target.
        if (Math.random() * 100 >= skill.successRate) {
          views.push({ target: this.actor(target), amount: 0, kind: 'miss', critical: false, hp: this.vitals(target).hp, maxHp: this.statsOf(target).params.mhp });
          continue;
        }
        const view = this.hit(user, target, skill.damage, false);
        if (view) views.push(view);
        if (view?.kind !== 'miss') views.push(...this.applyEffects(user, target, skill.effects));
      }
    }
    this.broadcastDamage(mc, views, user);
  }

  /** The message of a skill, in the chat of the players near its user (`%1` is the user's name, otherwise put first). */
  private skillMessage(mc: MapCombat, user: Combatant, message: string): void {
    const name = user.kind === 'player' ? user.p.name : user.m.def.name;
    const text = message.includes('%1') ? message.replaceAll('%1', name) : `${name} ${message}`;
    const pos = this.position(user);
    for (const o of this.world.playersOn(mc.mapId, mc.instance)) {
      if (distance(mc.map, o.x, o.y, pos.x, pos.y) <= SKILL_MESSAGE_RADIUS) this.world.social.system(o, 'notify.skill_message', { text });
    }
  }

  // --- Deaths ------------------------------------------------------------------------

  /**
   * A monster died: rewards for everyone who hurt it (shared with their party
   * members on the map) in proportion to the damage each player or party
   * dealt, then its respawn timer. Its drops go to the player or party that
   * dealt the most damage: hitting a monster once does not earn a full reward.
   */
  private monsterDies(mc: MapCombat, m: Monster): void {
    if (m.dead) return;
    m.dead = true;
    mc.unplace(m);
    m.respawnAt = Date.now() + Math.max(1, m.def.respawn) * 1000;
    const raid = this.raidOf(mc, m);
    // Monsters called by a boss are gone for good; a raid boss does not come back in its instance.
    if (m.summoned) mc.remove(m);
    if (raid) m.respawnAt = Number.MAX_SAFE_INTEGER;
    this.world.room(mc.mapId, mc.instance)?.emit('monsterRemoved', { id: m.id, died: true });
    // Its adds go with it: nothing is left to farm once the boss is down.
    this.dismissAdds(mc, m);
    const counted = new Set<number>();
    const groups: { members: PlayerSession[]; damage: number }[] = [];
    for (const characterId of m.damage.keys()) {
      const p = this.world.player(characterId);
      if (!p || !sameZone(p, mc) || !this.world.isLive(p) || counted.has(characterId)) continue;
      // The damage of the whole party in the zone is added up, knocked-out members included (whoever of them
      // hit first): a member knocked out after hitting is not rewarded, but its damage still counts for its party.
      const team = this.world.party.membersInZone(p, true).filter((g) => !counted.has(g.characterId));
      for (const g of team) counted.add(g.characterId);
      const damage = team.reduce((sum, g) => sum + (m.damage.get(g.characterId) ?? 0), 0);
      const members = this.world.party.partyOf(characterId) ? team.filter((g) => !g.combat.dead) : team;
      groups.push({ members, damage });
    }
    const total = groups.reduce((sum, g) => sum + g.damage, 0);
    const top = groups.reduce<(typeof groups)[number] | undefined>((best, g) => (!best || g.damage > best.damage ? g : best), undefined);
    for (const group of groups) {
      // A raid boss gives its normal rewards only to those who are not locked out of the raid this week
      // (otherwise a new group would farm it again and again; the raid's own reward is handled below).
      const paid = raid ? group.members.filter((g) => !this.world.raids.lockedUntil(g.characterId, raid.id)) : group.members;
      const share = total > 0 ? group.damage / total : 1 / groups.length;
      if (paid.length > 0) this.reward(paid[0]!, paid, m.def, share, group === top);
    }
    m.damage.clear();
    const instance = raid ? this.world.instances.get(mc.instance) : undefined;
    if (raid && instance) this.world.raids.bossDefeated(raid, instance);
  }

  /**
   * Experience, gold and drops of a defeated enemy for a player and its party
   * members on the map: their share of the experience and gold (the part of
   * the damage they dealt) is split (+10 % per extra member); drops, when they
   * dealt the most damage, are rolled by each member (personal loot) or once
   * and given in turn (shared loot).
   * @param share - Part of the damage dealt by the player and its party (0–1).
   * @param drops - Whether they receive the enemy's drops.
   */
  private reward(p: PlayerSession, group: PlayerSession[], def: EnemyData, share = 1, drops = true): void {
    const members = group.length ? group : [p];
    const bonus = 1 + 0.1 * (members.length - 1);
    const exp = Math.floor((def.exp * share * bonus) / members.length);
    const gold = Math.floor((def.gold * share * bonus) / members.length);
    // Drops are rolled first, then each member gets everything in ONE transaction: the loop that
    // calls this runs on the event loop and every SQLite write is synchronous.
    const sharedLoot = this.world.party.sharesLoot(p, members);
    const won = new Map<PlayerSession, EnemyData['drops']>();
    const win = (g: PlayerSession, drop: EnemyData['drops'][number]) => {
      const list = won.get(g);
      if (list) list.push(drop);
      else won.set(g, [drop]);
    };
    for (const drop of drops ? def.drops : []) {
      if (sharedLoot) {
        if (Math.random() * 100 < drop.chance) {
          const taker = this.world.party.lootTaker(p, members);
          if (taker) win(taker, drop);
        }
      } else {
        for (const g of members) if (Math.random() * 100 < drop.chance) win(g, drop);
      }
    }
    for (const g of members) {
      // Experience and gold rates of each member (a guild banner, a lucky charm).
      const traits = this.stats(g).traits;
      const gainedExp = Math.floor(exp * Math.max(0, traitRate(traits, 'exp_rate')));
      const gainedGold = Math.floor(gold * Math.max(0, traitRate(traits, 'gold_rate')));
      this.world.storeTogether(g, () => {
        if (gainedExp > 0) {
          g.socket.emit('notify', { key: 'notify.exp_gained', params: { amount: gainedExp } });
          this.world.runner.setExp(g, g.xp + gainedExp, true);
        }
        if (gainedGold > 0) this.world.changeGold(g, gainedGold);
        this.world.quests.onKill(g, def.id);
        for (const drop of won.get(g) ?? []) {
          this.world.changeItems(g, drop.kind, drop.id, 1);
          // Rare drops are logged for the administrators.
          if (drop.chance < RARE_DROP_CHANCE) this.ctx.admin.logDrop(g.characterId, def.id, drop.kind, drop.id, drop.chance);
        }
      });
    }
  }

  /** HP lowered outside a fight (event command allowing a knockout): a player at 0 HP is knocked out. */
  knockOutIfDown(p: PlayerSession): void {
    if (p.hp <= 0) this.playerDies(p);
  }

  /** A player reached 0 HP: it reappears at its respawn point after a short delay. */
  private playerDies(p: PlayerSession): void {
    if (p.combat.dead) return;
    p.combat.dead = true;
    p.combat.states.clear();
    p.combat.stateSteps.clear();
    this.world.trade.cancel(p);
    this.world.sheet.closeWindows(p);
    this.statesChanged({ kind: 'player', p });
    p.socket.emit('playerDied', { seconds: COMBAT.respawnSeconds });
    p.combat.respawnAt = Date.now() + COMBAT.respawnSeconds * 1000;
    this.scheduleRespawn(p, COMBAT.respawnSeconds * 1000);
  }

  /** Brings a knocked-out player back after a delay. */
  private scheduleRespawn(p: PlayerSession, ms: number): void {
    const session = p;
    setTimeout(() => {
      // A failure is logged: thrown from a timer, it would stop the whole server.
      try {
        if (!this.world.isLive(session) || !session.combat.dead) return;
        const back = this.respawnState(session);
        session.combat.dead = false;
        session.combat.respawnAt = undefined;
        session.hp = back.hp;
        session.mp = back.mp;
        session.socket.emit('playerUpdate', { hp: session.hp, mp: session.mp });
        const start = this.ctx.settings.get<StartPosition>('startPosition', DEFAULT_SETTINGS.startPosition);
        if (!this.world.transfer(session, back.mapId, back.x, back.y, back.direction)) this.world.transfer(session, start.mapId, start.x, start.y, start.direction);
      } catch (err) {
        console.error('[brindiwanko] respawn failed', err);
      }
    }, ms).unref();
  }

  /**
   * How a knocked-out player comes back: at its respawn point (or the start of its class), with full HP
   * and MP. Also what is saved for a player leaving before it reappears, so that it never comes back
   * standing at 0 HP where it fell.
   */
  respawnState(p: PlayerSession): { mapId: number; x: number; y: number; direction: Direction; hp: number; mp: number } {
    const { params } = this.stats(p);
    const point = this.ctx.progression.respawn(p.characterId) ?? this.world.startPosition(p.classId);
    return { mapId: point.mapId, x: point.x, y: point.y, direction: 2, hp: params.mhp, mp: params.mmp };
  }

  // --- Monster AI ----------------------------------------------------------------------

  /** Can a monster step from its cell towards `d`? */
  private monsterCanStep(mc: MapCombat, m: Monster, d: Direction): boolean {
    const { x, y } = stepCell(mc.map, m.x, m.y, d);
    if (!isValidPosition(mc.map, x, y)) return false;
    if (!canMove(mc.map, mc.flags, m.x, m.y, d) || mc.blocked.has(y * mc.map.width + x)) return false;
    if (mc.occupied(x, y)) return false;
    return !this.world.playersOn(mc.mapId, mc.instance).some((p) => p.x === x && p.y === y);
  }

  private stepMonster(mc: MapCombat, m: Monster, d: Direction): boolean {
    m.direction = d;
    if (!this.monsterCanStep(mc, m, d)) {
      mc.moves.set(m.id, [m.id, m.x, m.y, m.direction]);
      return false;
    }
    const next = stepCell(mc.map, m.x, m.y, d);
    mc.place(m, next.x, next.y);
    mc.moves.set(m.id, [m.id, m.x, m.y, m.direction]);
    return true;
  }

  /** Steps towards a cell (largest axis first, then the other one). */
  private stepTowards(mc: MapCombat, m: Monster, x: number, y: number, away = false): void {
    const dx = deltaX(mc.map, m.x, x);
    const dy = deltaY(mc.map, m.y, y);
    const horizontal: Direction = dx > 0 ? 6 : 4;
    const vertical: Direction = dy > 0 ? 2 : 8;
    let order: Direction[] = Math.abs(dx) > Math.abs(dy) ? [horizontal, vertical] : [vertical, horizontal];
    if (dx === 0) order = [vertical, 4, 6];
    if (dy === 0) order = [horizontal, 8, 2];
    if (away) order = order.map(reverse);
    for (const d of order) if (this.stepMonster(mc, m, d)) return;
  }

  /** Tells whether a player just arrived (login, new map) and is left alone by monsters. */
  private protectedFromMonsters(p: PlayerSession): boolean {
    return p.editing === true || Date.now() < p.combat.protectedUntil;
  }

  /** The player a monster chases, if still valid. */
  private target(mc: MapCombat, m: Monster): PlayerSession | undefined {
    const p = m.targetId ? this.world.player(m.targetId) : undefined;
    return p && sameZone(p, mc) && !p.combat.dead && !p.invisible && !this.protectedFromMonsters(p) && this.world.isLive(p) ? p : undefined;
  }

  /** Nearest player within the aggro radius (players in a dialogue, or invisible, are left alone). */
  private spot(mc: MapCombat, m: Monster): PlayerSession | undefined {
    let best: PlayerSession | undefined;
    let bestDistance = m.def.aggroRadius + 1;
    for (const p of this.world.playersOn(mc.mapId, mc.instance)) {
      if (p.combat.dead || p.busy || p.invisible || this.protectedFromMonsters(p)) continue;
      const d = distance(mc.map, p.x, p.y, m.x, m.y);
      if (d < bestDistance) {
        best = p;
        bestDistance = d;
      }
    }
    return best;
  }

  /** Runs one AI step of a monster. */
  private think(mc: MapCombat, m: Monster, now: number): void {
    const stats = this.monsterStats(m);
    const moveMs = stepMs(m.def.moveSpeed);
    const canMoveNow = now >= m.nextMoveAt && !this.restricted(m.states, 'move');
    const canAct = now >= m.nextActionAt && !this.restricted(m.states, 'act');
    const tooFar = distance(mc.map, m.x, m.y, m.homeX, m.homeY) > COMBAT.leash;
    if (m.mode === 'idle') {
      if (m.def.ai !== 'passive') {
        const seen = this.spot(mc, m);
        if (seen) {
          m.mode = 'chase';
          m.targetId = seen.characterId;
        }
      }
      if (m.mode === 'idle' && canMoveNow) {
        // Wander around home.
        const d = distance(mc.map, m.x, m.y, m.homeX, m.homeY) > 3 ? towards(mc.map, m.x, m.y, m.homeX, m.homeY) : DIRS[Math.floor(Math.random() * 4)]!;
        this.stepMonster(mc, m, d);
        m.nextMoveAt = now + moveMs + 1500 + Math.random() * 3000;
      }
      return;
    }
    if (m.mode === 'return') {
      if (m.x === m.homeX && m.y === m.homeY) {
        // A monster back home starts the fight over: full HP and MP, no states, and a boss plays its phases
        // again and calms down (otherwise pulling it away would skip its one-time mechanics).
        m.mode = 'idle';
        m.damage.clear();
        m.states.clear();
        m.phases?.clear();
        m.enraged = false;
        const fresh = this.monsterStats(m);
        m.hp = fresh.params.mhp;
        m.mp = fresh.params.mmp;
        // Its adds go with the fight: otherwise each pull past a phase would leave more of them to farm.
        this.dismissAdds(mc, m);
        // An enemy called by an event ("Battle") whose target got away does not stay on the map for good.
        if (m.summoned && m.summoner === undefined) {
          mc.remove(m);
          this.world.room(mc.mapId, mc.instance)?.emit('monsterRemoved', { id: m.id, died: false });
        }
        return;
      }
      if (canMoveNow) {
        const before = m.x * 1000 + m.y;
        this.stepTowards(mc, m, m.homeX, m.homeY);
        // Stuck on the way home: teleport there (once no other monster stands on it).
        if (m.x * 1000 + m.y === before && Math.random() < 0.1 && !mc.occupied(m.homeX, m.homeY)) {
          mc.place(m, m.homeX, m.homeY);
          mc.moves.set(m.id, [m.id, m.x, m.y, m.direction]);
        }
        m.nextMoveAt = now + moveMs;
      }
      return;
    }
    const target = this.target(mc, m);
    if (target && !tooFar) this.bossTick(mc, m, now);
    if (!target || tooFar) {
      m.mode = 'return';
      m.targetId = 0;
      return;
    }
    if (m.mode === 'flee') {
      if (now > m.modeUntil) m.mode = 'return';
      else if (canMoveNow) {
        this.stepTowards(mc, m, target.x, target.y, true);
        m.nextMoveAt = now + moveMs;
      }
      return;
    }
    if (m.def.ai === 'coward' && m.hp < stats.params.mhp * 0.3) {
      m.mode = 'flee';
      m.modeUntil = now + 4000;
      return;
    }
    // Chase and attack.
    const inLine = target.x === m.x || target.y === m.y;
    const gap = Math.abs(deltaX(mc.map, m.x, target.x)) + Math.abs(deltaY(mc.map, m.y, target.y));
    // Nothing to attack through a wall: the monster walks around it instead.
    if (canAct && inLine && gap >= 1 && this.lineClear(mc, m.x, m.y, towards(mc.map, m.x, m.y, target.x, target.y), gap)) {
      // The normal attack, or one of the enemy's skills whose condition holds, whose MP it has and whose
      // reach covers the gap.
      const skills = m.def.actions.flatMap((a) => {
        const skill = this.actionReady(m, a, target, stats.params.mhp) ? this.ctx.gameData.get('skill', a.skillId) : undefined;
        return skill && m.mp >= skill.mpCost && (skill.damage.type !== 'none' || skill.effects.length > 0) ? [{ skill, weight: a.weight, range: Math.max(1, skill.range) }] : [];
      });
      const options = [{ skill: null as SkillData | null, weight: 5, range: 1 }, ...skills].filter((o) => gap <= o.range);
      if (options.length) {
        let roll = Math.random() * options.reduce((s, o) => s + o.weight, 0);
        const choice = options.find((o) => (roll -= o.weight) < 0) ?? options[0]!;
        m.direction = towards(mc.map, m.x, m.y, target.x, target.y);
        mc.moves.set(m.id, [m.id, m.x, m.y, m.direction]);
        this.monsterAct(mc, m, choice.skill);
        m.nextActionAt = now + Math.max(800, 2000 - stats.params.agi * 10) / (m.enraged ? 2 : 1);
        m.nextMoveAt = Math.max(m.nextMoveAt, now + 300);
        return;
      }
    }
    if (canMoveNow && gap > 1) {
      this.stepTowards(mc, m, target.x, target.y);
      m.nextMoveAt = now + moveMs;
    } else if (canMoveNow && !inLine) {
      this.stepTowards(mc, m, target.x, target.y);
      m.nextMoveAt = now + moveMs;
    }
  }

  /** Whether the condition of an enemy action holds (`target`: the player fought, whose switches are read). */
  private actionReady(m: Monster, action: EnemyAction, target: PlayerSession, mhp: number): boolean {
    switch (action.condition) {
      case 'hp_below':
        return m.hp * 100 < mhp * action.hpBelow;
      case 'state':
        return m.states.has(action.stateId);
      case 'switch':
        return this.world.getSwitch(target, action.switchId);
      default:
        return true;
    }
  }

  /** A monster attacks (normal attack when `skill` is null) in the direction it faces. */
  private monsterAct(mc: MapCombat, m: Monster, skill: SkillData | null): void {
    const user: Combatant = { kind: 'monster', m, map: mc };
    if (skill) {
      const targets = this.skillTargets(mc, user, skill.scope, skill.range, skill.area);
      if (targets.hostile && targets.list.length === 0) return;
      m.mp = Math.max(0, m.mp - skill.mpCost);
      this.perform(mc, user, skill, targets.list, targets.cells);
      return;
    }
    const { target, cell } = this.firstInLine(mc, user, 1);
    this.announce(mc, { actor: this.actor(user), direction: m.direction, skillId: 0, range: 1, targets: [target ? this.position(target) : cell], animation: null }, target ? [target] : []);
    if (!target || target.kind !== 'player') return;
    const view = this.hit(user, target, { type: 'hp_damage', formula: COMBAT.attackFormula, element: 0, variance: 20, critical: true }, true);
    if (view) this.broadcastDamage(mc, [view], user);
    if (view && view.kind !== 'miss') this.attackStates(user, target);
  }

  // --- Ticks ------------------------------------------------------------------------

  /** Server tick: AI of the monsters of maps with players, states every second, respawns. */
  tick(): void {
    const now = Date.now();
    const second = now - this.lastSecond >= 1000;
    if (second) this.lastSecond = now;
    for (const [key, mc] of this.maps) {
      const players = this.world.playersOn(mc.mapId, mc.instance);
      if (players.length === 0) {
        mc.emptySince ||= now;
        if (now - mc.emptySince > IDLE_MAP_MS) this.maps.delete(key);
        continue;
      }
      mc.emptySince = 0;
      for (const m of mc.monsters.values()) {
        if (m.dead) {
          if (now >= m.respawnAt) this.respawn(mc, m);
          continue;
        }
        try {
          this.think(mc, m, now);
        } catch (err) {
          // One faulty monster (bad data) must not stop the others.
          console.error('[combat] monster AI error', err);
        }
        if (second && !m.dead) {
          this.stateTick({ kind: 'monster', m, map: mc }, now);
          this.traitRegen({ kind: 'monster', m, map: mc });
        }
      }
    }
    if (second) for (const p of this.world.allPlayers()) this.playerSecond(p, now);
  }

  /** Regeneration traits (a percentage of the maximum HP / MP per second; negative: lost), once per second. */
  private traitRegen(c: Combatant): void {
    const { params, traits } = this.statsOf(c);
    const views: DamageView[] = [];
    for (const [kind, hp] of [['hp_regen', true], ['mp_regen', false]] as const) {
      const rate = traitSum(traits, kind);
      const vitals = this.vitals(c);
      // Nothing to give back at full HP / MP: no number is shown.
      if (!rate || !this.alive(c) || (rate > 0 && (hp ? vitals.hp >= params.mhp : vitals.mp >= params.mmp))) continue;
      const amount = Math.max(1, Math.floor(((hp ? params.mhp : params.mmp) * Math.abs(rate)) / 100));
      const damage = rate < 0 ? (hp ? 'hp_damage' : 'mp_damage') : hp ? 'hp_recover' : 'mp_recover';
      this.applyVitals(c, damage, amount, null);
      if (hp) views.push({ target: this.actor(c), amount, kind: damage, critical: false, hp: this.vitals(c).hp, maxHp: params.mhp });
    }
    this.broadcastDamage(c.kind === 'player' ? c.p : c.map, views);
  }

  /** States (HP / MP per second, expiry) of one combatant, once per second. */
  private stateTick(c: Combatant, now: number): void {
    const states = this.statesOf(c);
    if (states.size === 0) return;
    const views: DamageView[] = [];
    const expired: number[] = [];
    for (const [id, until] of [...states]) {
      const state = this.ctx.gameData.get('state', id);
      if (!state || now >= until) {
        states.delete(id);
        expired.push(id);
        continue;
      }
      const params = this.statsOf(c).params;
      for (const [rate, hp] of [[state.hpPerSecond, true], [state.mpPerSecond, false]] as const) {
        if (!rate) continue;
        const amount = Math.max(1, Math.floor(((hp ? params.mhp : params.mmp) * Math.abs(rate)) / 100));
        const kind = rate < 0 ? (hp ? 'hp_damage' : 'mp_damage') : hp ? 'hp_recover' : 'mp_recover';
        this.applyVitals(c, kind, amount, null);
        if (hp) views.push({ target: this.actor(c), amount, kind, critical: false, hp: this.vitals(c).hp, maxHp: params.mhp });
        if (!this.alive(c)) break;
      }
    }
    this.statesEnded(c, expired);
    this.broadcastDamage(c.kind === 'player' ? c.p : c.map, views);
  }

  /** Once per second for each player: states and regeneration out of combat. */
  private playerSecond(p: PlayerSession, now: number): void {
    if (!this.world.isLive(p) || p.combat.dead) return;
    this.stateTick({ kind: 'player', p }, now);
    if (!p.combat.dead) this.traitRegen({ kind: 'player', p });
    if (p.combat.dead || now - p.combat.lastHurt < REGEN_DELAY_MS) return;
    const { params } = this.stats(p);
    if (p.hp >= params.mhp && p.mp >= params.mmp) return;
    p.hp = Math.min(params.mhp, p.hp + Math.max(1, Math.floor(params.mhp * 0.02)));
    p.mp = Math.min(params.mmp, p.mp + Math.max(1, Math.floor(params.mmp * 0.02)));
    p.socket.emit('playerUpdate', { hp: p.hp, mp: p.mp });
  }

  /** Monster positions changed since the last call, per map (flushed by the world tick). */
  flushMoves(): [number, number, [number, number, number, Direction][]][] {
    const out: [number, number, [number, number, number, Direction][]][] = [];
    for (const mc of this.maps.values()) {
      if (mc.moves.size) out.push([mc.mapId, mc.instance, [...mc.moves.values()]]);
      mc.moves.clear();
    }
    return out;
  }

  /** Positions of the living monsters of a zone, as `[id, x, y, direction]`. */
  positions(mapId: number, instance: number): [number, number, number, Direction][] {
    const out: [number, number, number, Direction][] = [];
    const mc = this.maps.get(mapRoom(mapId, instance));
    if (mc) for (const m of mc.monsters.values()) if (!m.dead) out.push([m.id, m.x, m.y, m.direction]);
    return out;
  }

  /** Interval of the AI tick. */
  static readonly TICK_MS = AI_TICK_MS;
}
