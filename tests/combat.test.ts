/**
 * @file Combat tests: damage formulas (parsing, safety), and the step
 * criterion over sockets: fighting monsters for experience, gold and items up
 * to a level up, skills with cost and cooldown, aggressive monsters, being
 * knocked out and reappearing, and the validation of map spawns.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { DamageView } from '../shared/combat.js';
import { checkFormula, evalFormula } from '../shared/formula.js';
import { stepCell } from '../shared/map.js';
import { validateMap } from '../shared/map-validation.js';
import { canMove } from '../shared/passability.js';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
import { buildDemoForest, DEMO_MAPS } from '../server/db/demo-map.js';
import type { Monster } from '../server/game/combat.js';
import { attackElement, elementRate, stateRate, traitSum } from '../server/game/stats.js';
import type { PlayerSession } from '../server/game/world.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

test('formulas: arithmetic, parameters, functions, and nothing else', () => {
  const a = { atk: 20, def: 5, level: 3, hp: 50 };
  const b = { atk: 10, def: 8 };
  assert.equal(evalFormula('a.atk * 4 - b.def * 2', a, b), 64);
  assert.equal(evalFormula('(a.atk + 2) * 2 % 7', a, b), 2);
  assert.equal(evalFormula('Math.max(1, a.level * 10 - b.atk)', a, b), 20);
  assert.equal(evalFormula('a.hp < 60 ? 100 : 0', a, b), 100);
  assert.equal(evalFormula('v[3] + 1', a, b, (id) => id * 10), 31);
  assert.equal(evalFormula('-a.def + +2', a, b), -3);
  assert.equal(evalFormula('a.atk / 0', a, b), 0, 'division by zero gives 0');
  for (const bad of ['process.exit()', 'a.constructor', 'this', 'a.atk; 1', 'eval("1")', 'a[0]', '1 +', 'x = 2']) {
    assert.notEqual(checkFormula(bad), null, bad);
    assert.equal(evalFormula(bad, a, b), 0);
  }
  assert.equal(checkFormula('a.mat * 3 + 20'), null);
});

test('battle parameters: element rates, attack element, additive traits, state resistance', () => {
  const traits = [
    { kind: 'element_rate' as const, target: '2', value: 2 },
    { kind: 'element_rate' as const, target: '2', value: 0.5 },
    { kind: 'element_rate' as const, target: '3', value: 0 },
    { kind: 'attack_element' as const, target: '2', value: 1 },
    { kind: 'critical' as const, target: '', value: 0.1 },
    { kind: 'critical' as const, target: '', value: 0.05 },
    { kind: 'state_resist' as const, target: '1', value: 0.5 },
  ];
  assert.equal(elementRate(traits, 2), 1, 'rates multiply');
  assert.equal(elementRate(traits, 3), 0, 'immunity');
  assert.equal(elementRate(traits, 0), 1, 'no element');
  assert.equal(attackElement(traits), 2);
  assert.ok(Math.abs(traitSum(traits, 'critical') - 0.15) < 1e-9);
  assert.equal(stateRate(traits, 1), 0.5);
  assert.equal(stateRate(traits, 2), 1);
});

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout');
    await wait(10);
  }
}

interface Player {
  socket: ClientSocket;
  session: PlayerSession;
  notes: string[];
  damage: DamageView[];
  died: number;
  payload: EnterWorldPayload;
}

async function newPlayer(name: string, classId = 1): Promise<Player> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name: `${name}Hero`, classId: String(classId) });
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const player = { socket, notes: [], damage: [], died: 0 } as unknown as Player;
  socket.on('notify', (n) => player.notes.push(n.key));
  socket.on('damage', (views) => player.damage.push(...views));
  socket.on('playerDied', () => player.died++);
  player.payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  player.session = server.ctx.world.player(player.payload.character.id)!;
  return player;
}

/** Living monsters of the forest with a given enemy id, frozen in place. */
function monsters(enemyId: number): Monster[] {
  const world = server.ctx.world;
  return world.combat
    .views(DEMO_MAPS.forest)
    .filter((v) => v.enemyId === enemyId)
    .map((v) => world.combat.monster(DEMO_MAPS.forest, v.id)!)
    .filter((m) => !m.dead);
}

/** Puts the player right below a monster, facing it, and freezes the monster. */
function faceMonster(p: PlayerSession, m: Monster): void {
  m.nextMoveAt = Number.MAX_SAFE_INTEGER;
  m.nextActionAt = Number.MAX_SAFE_INTEGER;
  // Free the cell below the monster if another monster stands there.
  p.x = m.x;
  p.y = m.y + 1;
  p.direction = 8;
}

test('criterion: fight monsters, gain experience, gold and items, level up', async () => {
  const eve = await newPlayer('Warrior');
  const p = eve.session;
  const world = server.ctx.world;
  assert.ok(world.transfer(p, DEMO_MAPS.forest, 14, 28, 8));
  assert.equal(monsters(1).length, 4, 'the forest spawns four slimes');
  assert.equal(p.level, 1);
  const gold = server.ctx.inventory.gold(p.characterId);
  let kills = 0;
  for (const slime of monsters(1)) {
    faceMonster(p, slime);
    for (let i = 0; i < 20 && !slime.dead; i++) {
      p.combat.nextAttackAt = 0;
      world.combat.attack(p);
    }
    assert.ok(slime.dead, 'the slime is defeated');
    kills++;
  }
  assert.equal(kills, 4);
  await until(() => eve.damage.some((d) => d.target.kind === 'monster' && d.kind === 'hp_damage'));
  assert.equal(p.xp, 32, '4 × 8 experience');
  assert.equal(p.level, 2, 'level up after 30 experience');
  await until(() => eve.notes.includes('notify.level_up'));
  assert.equal(server.ctx.inventory.gold(p.characterId), gold + 20, '4 × 5 gold');
  assert.equal(monsters(1).length, 0);
  // Defeated monsters come back after their respawn delay.
  const dead = world.combat.views(DEMO_MAPS.forest).length;
  for (const m of [...Array(20).keys()].map((i) => world.combat.monster(DEMO_MAPS.forest, i + 1)).filter((x): x is Monster => !!x && x.dead)) m.respawnAt = 0;
  world.combat.tick();
  assert.ok(world.combat.views(DEMO_MAPS.forest).length > dead, 'respawned');
  eve.socket.close();
});

test('skills cost MP and have a cooldown; a knocked out player reappears at its respawn point', async () => {
  const bob = await newPlayer('Fighter');
  const p = bob.session;
  const world = server.ctx.world;
  world.transfer(p, DEMO_MAPS.forest, 14, 28, 8);
  const slime = monsters(1)[0] ?? monsters(6)[0]!;
  faceMonster(p, slime);
  const mp = p.mp;
  world.combat.useSkill(p, 1);
  assert.equal(p.mp, mp - 3, 'Coup puissant costs 3 MP');
  p.combat.globalReadyAt = 0;
  world.combat.useSkill(p, 1);
  assert.equal(p.mp, mp - 3, 'still in cooldown');
  world.combat.useSkill(p, 3);
  assert.equal(p.mp, mp - 3, 'a skill of another class is refused');

  // An aggressive bat attacks a player standing near it.
  const bat = monsters(2)[0]!;
  bat.nextActionAt = 0;
  bat.nextMoveAt = 0;
  bat.mode = 'chase';
  bat.targetId = p.characterId;
  // Next to it, on a side its attack can reach (attacks do not cross walls, water or cliffs).
  const runtime = world.mapRuntime(p.mapId)!;
  const side = ([2, 4, 6, 8] as const)
    .map((d) => ({ d, cell: stepCell(runtime.map, bat.x, bat.y, d) }))
    .find(({ d, cell }) => canMove(runtime.map, runtime.flags, bat.x, bat.y, d) && runtime.isStandable(cell.x, cell.y))!;
  p.x = side.cell.x;
  p.y = side.cell.y;
  const hp = p.hp;
  await until(() => p.hp < hp || bob.damage.some((d) => d.target.kind === 'player' && d.kind === 'miss'), 8000);

  // Knocked out: back to the start position of the village after the delay.
  p.hp = 1;
  p.combat.states.clear();
  const bats = monsters(2);
  for (const b of bats) {
    b.nextActionAt = 0;
    b.mode = 'chase';
    b.targetId = p.characterId;
  }
  await until(() => bob.died > 0, 8000);
  assert.equal(p.combat.dead, true);
  world.move(p, 2, p.epoch);
  await until(() => p.mapId === DEMO_MAPS.village, 6000);
  assert.equal(p.combat.dead, false);
  assert.ok(p.hp > 1, 'full HP after reappearing');
  bob.socket.close();
});

test('rewards follow the damage dealt: a party earns at least what solo players sharing the kill do', async () => {
  const world = server.ctx.world;
  const [a, b, c, d] = [await newPlayer('Tagger'), await newPlayer('Hitter'), await newPlayer('Partner'), await newPlayer('Mate')];
  for (const x of [a, b, c, d]) assert.ok(world.transfer(x.session, DEMO_MAPS.forest, 14, 28, 8));
  world.party.invite(c.session, d.session.characterId);
  world.party.respond(d.session, true);
  world.party.setLoot(c.session, 'shared');
  // A grey wolf (20 experience, 12 gold) with an empty drop slot (0 %) before a guaranteed drop (100 %).
  const wolf = { ...structuredClone(server.ctx.gameData.get('enemy', 3)!), drops: [{ kind: 'item' as const, id: 2, chance: 0 }, { kind: 'item' as const, id: 1, chance: 100 }] };
  const internals = world.combat as unknown as { maps: Map<string, { monsters: Map<number, Monster> }>; monsterDies: (mc: unknown, m: Monster) => void };
  const mc = internals.maps.get(`map:${DEMO_MAPS.forest}`)!;
  const kill = (id: number, damage: [PlayerSession, number][]) => {
    const m = { ...[...mc.monsters.values()][0]!, id, def: wolf, dead: false, damage: new Map(damage.map(([p, n]) => [p.characterId, n])), summoned: true, states: new Map() };
    mc.monsters.set(id, m);
    internals.monsterDies.call(world.combat, mc, m);
  };
  const before = [a, b, c, d].map((x) => ({ xp: x.session.xp, gold: server.ctx.inventory.gold(x.session.characterId), potions: server.ctx.inventory.quantity(x.session.characterId, 'item', 1) }));
  // Two players on their own: three quarters and one quarter of the damage.
  kill(900_001, [[a.session, 30], [b.session, 10]]);
  // A party of two, each half of the damage.
  kill(900_002, [[c.session, 20], [d.session, 20]]);
  const gained = [a, b, c, d].map((x, i) => ({ xp: x.session.xp - before[i]!.xp, gold: server.ctx.inventory.gold(x.session.characterId) - before[i]!.gold, potions: server.ctx.inventory.quantity(x.session.characterId, 'item', 1) - before[i]!.potions }));
  assert.deepEqual(gained.map((g) => g.xp), [15, 5, 11, 11], 'the share of the damage; the party keeps its bonus');
  assert.deepEqual(gained.map((g) => g.gold), [9, 3, 6, 6]);
  assert.equal(gained[0]!.potions, 1, 'the drop goes to whoever dealt the most damage');
  assert.equal(gained[1]!.potions, 0, 'one hit does not earn the drop too');
  assert.ok(gained[2]!.potions + gained[3]!.potions >= 1);
  // A second kill in shared loot mode gives the drop to the other party member (failed 0 % rolls do not skip a turn).
  kill(900_003, [[c.session, 20], [d.session, 20]]);
  assert.deepEqual(
    [server.ctx.inventory.quantity(c.session.characterId, 'item', 1) - before[2]!.potions, server.ctx.inventory.quantity(d.session.characterId, 'item', 1) - before[3]!.potions],
    [1, 1],
    'shared drops alternate evenly even when another drop slot did not fall',
  );
  for (const x of [a, b, c, d]) x.socket.close();
});

test('the damage of a party member knocked out still counts for its party, whatever the order of the first hits', async () => {
  const world = server.ctx.world;
  const [x, y, b] = [await newPlayer('Fallen'), await newPlayer('Standing'), await newPlayer('Rival')];
  for (const p of [x, y, b]) assert.ok(world.transfer(p.session, DEMO_MAPS.forest, 14, 28, 8));
  world.party.invite(y.session, x.session.characterId);
  world.party.respond(x.session, true);
  const wolf = { ...structuredClone(server.ctx.gameData.get('enemy', 3)!), drops: [{ kind: 'item' as const, id: 1, chance: 100 }] };
  const internals = world.combat as unknown as { maps: Map<string, { monsters: Map<number, Monster> }>; monsterDies: (mc: unknown, m: Monster) => void };
  const mc = internals.maps.get(`map:${DEMO_MAPS.forest}`)!;
  const potions = (p: Player) => server.ctx.inventory.quantity(p.session.characterId, 'item', 1);
  const before = [x, y, b].map(potions);
  // Y hits first (10), then X (60) who is knocked out, then B on its own (50): the party dealt 70 against 50.
  x.session.combat.dead = true;
  try {
    const m = { ...[...mc.monsters.values()][0]!, id: 900_101, def: wolf, dead: false, summoned: true, states: new Map(), damage: new Map([[y.session.characterId, 10], [x.session.characterId, 60], [b.session.characterId, 50]]) };
    mc.monsters.set(m.id, m);
    internals.monsterDies.call(world.combat, mc, m);
  } finally {
    x.session.combat.dead = false;
  }
  const gained = [x, y, b].map((p, i) => potions(p) - before[i]!);
  assert.deepEqual(gained, [0, 1, 0], 'the party keeps the drop (its living member receives it), not the solo player');
  for (const p of [x, y, b]) p.socket.close();
});

test("a boss's adds leave when it is defeated; an ambushing enemy leaves once it went back home", async () => {
  const world = server.ctx.world;
  const hero = await newPlayer('Witness');
  const removed: number[] = [];
  hero.socket.on('monsterRemoved', (r) => removed.push(r.id));
  assert.ok(world.transfer(hero.session, DEMO_MAPS.forest, 14, 28, 8));
  const internals = world.combat as unknown as { maps: Map<string, { monsters: Map<number, Monster> }>; monsterDies: (mc: unknown, m: Monster) => void };
  const mc = internals.maps.get(`map:${DEMO_MAPS.forest}`)!;
  const template = [...mc.monsters.values()][0]!;
  const boss: Monster = { ...template, id: 900_201, dead: false, summoned: true, states: new Map(), damage: new Map() };
  const add: Monster = { ...template, id: 900_202, dead: false, summoned: true, summoner: boss.id, states: new Map(), damage: new Map(), nextMoveAt: Number.MAX_SAFE_INTEGER, nextActionAt: Number.MAX_SAFE_INTEGER };
  mc.monsters.set(boss.id, boss);
  mc.monsters.set(add.id, add);
  internals.monsterDies.call(world.combat, mc, boss);
  assert.equal(mc.monsters.has(add.id), false, 'the add is gone with its boss');
  await until(() => removed.includes(add.id));

  // The event command "Battle": the enemy chases the player, who runs away; back home, it leaves.
  hero.session.combat.protectedUntil = 0;
  const known = new Set(mc.monsters.keys());
  assert.ok(world.combat.ambush(hero.session, 2));
  const ambusher = [...mc.monsters.values()].find((m) => !known.has(m.id))!;
  assert.ok(ambusher);
  ambusher.mode = 'return';
  ambusher.targetId = 0;
  [ambusher.x, ambusher.y] = [ambusher.homeX, ambusher.homeY];
  world.combat.tick();
  assert.equal(mc.monsters.has(ambusher.id), false, 'the ambushing enemy does not stay on the map');
  await until(() => removed.includes(ambusher.id));
  hero.socket.close();
});

test('combat messages reach the players who see the fight, not the whole map', async () => {
  const world = server.ctx.world;
  const [near, far] = [await newPlayer('Brawler'), await newPlayer('Faraway')];
  for (const x of [near, far]) assert.ok(world.transfer(x.session, DEMO_MAPS.forest, 14, 28, 8));
  const actions = { near: 0, far: 0 };
  near.socket.on('combatAction', () => actions.near++);
  far.socket.on('combatAction', () => actions.far++);
  const slime = monsters(1)[0] ?? monsters(6)[0]!;
  faceMonster(near.session, slime);
  // The other player sees neither the attacker nor the slime (out of its area of interest).
  far.session.aoi = new Set();
  near.session.combat.nextAttackAt = 0;
  world.combat.attack(near.session);
  await until(() => actions.near > 0 && near.damage.length > 0);
  await wait(100);
  assert.equal(actions.far, 0, 'no animation for a fight out of sight');
  assert.equal(far.damage.length, 0, 'no damage numbers either');
  for (const x of [near, far]) x.socket.close();
});

test('a player who may not move does not turn either', async () => {
  const hero = await newPlayer('Statue');
  const p = hero.session;
  p.direction = 2;
  p.combat.dead = true;
  try {
    server.ctx.world.move(p, 4, p.epoch);
    assert.equal(p.direction, 2);
  } finally {
    p.combat.dead = false;
  }
  hero.socket.close();
});

test('on a PvP map, attacks hurt other players but never party members', async () => {
  const world = server.ctx.world;
  const [ann, ben, cal] = [await newPlayer('Ann'), await newPlayer('Ben'), await newPlayer('Cal')];
  const [a, b, c] = [ann.session, ben.session, cal.session];
  world.party.invite(a, b.characterId);
  world.party.respond(b, true);
  const map = world.mapRuntime(DEMO_MAPS.forest)!.map;
  map.mmo.pvp = true;
  try {
    for (const p of [a, b, c]) assert.ok(world.transfer(p, DEMO_MAPS.forest, 14, 28, 8));
    for (const p of [a, b, c]) p.combat.protectedUntil = 0;
    // Ann faces Ben (her party), then Cal.
    const hit = (target: PlayerSession) => {
      [target.x, target.y] = [a.x, a.y - 1];
      a.direction = 8;
      const hp = target.hp;
      for (let i = 0; i < 20 && target.hp === hp; i++) {
        a.combat.nextAttackAt = 0;
        a.combat.globalReadyAt = 0;
        world.combat.attack(a);
      }
      [target.x, target.y] = [a.x + 3, a.y];
      return hp - target.hp;
    };
    assert.equal(hit(b), 0, 'a party member is passed by');
    assert.ok(hit(c) > 0, 'another player is hurt');
  } finally {
    map.mmo.pvp = false;
    for (const p of [ann, ben, cal]) p.socket.close();
  }
});

test('an administrator with the editor open is left alone; a player cannot claim to be editing', async () => {
  const world = server.ctx.world;
  const player = await newPlayer('Claimer');
  const p = player.session;
  // Not an administrator: the claim is ignored.
  p.socket.data.role = 'player';
  player.socket.emit('editing', true);
  await wait(100);
  assert.notEqual(p.editing, true);
  p.socket.data.role = 'admin';
  player.socket.emit('editing', true);
  await until(() => p.editing === true);
  assert.ok(world.transfer(p, DEMO_MAPS.forest, 14, 28, 8));
  p.combat.protectedUntil = 0;
  // An aggressive bat chasing the administrator gives up at its next step.
  const bat = monsters(2)[0]!;
  const chase = () => {
    [bat.mode, bat.targetId, bat.nextActionAt, bat.nextMoveAt] = ['chase', p.characterId, 0, 0];
    [p.x, p.y] = [bat.x, bat.y + 1];
    world.combat.tick();
    return bat.mode;
  };
  assert.equal(chase(), 'return', 'monsters leave an administrator with the editor open alone');
  player.socket.emit('editing', false);
  await until(() => p.editing === false);
  assert.equal(chase(), 'chase', 'and chase it again once it is closed');
  player.socket.close();
});

test('monster attacks never hurt other monsters, and leave invisible players alone', async () => {
  const hero = await newPlayer('Bystander');
  const p = hero.session;
  const world = server.ctx.world;
  world.transfer(p, DEMO_MAPS.forest, 14, 28, 8);
  const living = world.combat.views(DEMO_MAPS.forest).map((v) => world.combat.monster(DEMO_MAPS.forest, v.id)!).filter((m) => !m.dead);
  assert.ok(living.length >= 2);
  const [caster, other] = living as [Monster, Monster];
  // What a monster can hit on a cell where another monster and the player stand.
  type Internals = { maps: Map<string, unknown>; targetsAt(mc: unknown, user: unknown, x: number, y: number): { kind: string }[] };
  const combat = world.combat as unknown as Internals;
  const mc = combat.maps.get(`map:${DEMO_MAPS.forest}`);
  const asMonster = { kind: 'monster', m: caster, map: mc };
  p.x = other.x;
  p.y = other.y;
  assert.deepEqual(combat.targetsAt(mc, asMonster, other.x, other.y).map((t) => t.kind), ['player']);
  assert.deepEqual(combat.targetsAt(mc, { kind: 'player', p }, other.x, other.y).map((t) => t.kind), ['monster'], 'a player still hits monsters');
  other.mode = 'return';
  assert.deepEqual(combat.targetsAt(mc, { kind: 'player', p }, other.x, other.y), [], 'a monster walking back to its spawn cannot be targeted');
  other.mode = 'idle';
  world.setInvisible(p, true);
  assert.deepEqual(combat.targetsAt(mc, asMonster, other.x, other.y), [], 'an invisible player is out of reach');
  world.setInvisible(p, false);
  hero.socket.close();
});

test('map spawns are validated; the hotbar is stored', async () => {
  const forest = buildDemoForest();
  assert.equal(validateMap(forest, () => true), null);
  assert.equal(validateMap({ ...forest, mmo: { ...forest.mmo, spawns: [{ enemyId: 1, count: 999, region: 0 }] } }, () => true), 'mmo.spawns');
  const cat = await newPlayer('Keeper');
  const p = cat.session;
  assert.deepEqual(p.combat.hotbar[0], { kind: 'skill', id: 1 }, 'known skills fill an empty hotbar');
  server.ctx.world.combat.setHotbar(p, [{ kind: 'item', id: 1 }, null, { kind: 'skill', id: 1 }, { kind: 'bogus', id: 3 } as never]);
  assert.deepEqual(server.ctx.progression.hotbar(p.characterId).slice(0, 4), [{ kind: 'item', id: 1 }, null, { kind: 'skill', id: 1 }, null]);
  cat.socket.close();
});

test('the event command "Battle" makes the enemy appear next to the player and attack it', async () => {
  const hero = await newPlayer('Ambushed');
  const spawned: number[] = [];
  hero.socket.on('monsterSpawned', (m) => spawned.push(m.id));
  await server.ctx.world.runner.runCommonList(hero.session, [{ code: 301, indent: 0, parameters: [0, 2, false, false] }, { code: 0, indent: 0, parameters: [] }]);
  await until(() => spawned.length === 1);
  const m = server.ctx.world.combat.monster(hero.session.mapId, spawned[0]!, hero.session.instance)!;
  assert.equal(m.def.id, 2);
  assert.equal(m.summoned, true, 'removed for good once defeated');
  // The player has just logged in (arrival protection): the enemy must not give up at the next AI step.
  server.ctx.world.combat.tick();
  assert.equal(m.mode, 'chase');
  assert.equal(m.targetId, hero.session.characterId);
  assert.ok(Math.abs(m.x - hero.session.x) <= 3 && Math.abs(m.y - hero.session.y) <= 3);
  hero.socket.close();
});
