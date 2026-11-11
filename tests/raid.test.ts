/**
 * @file Instance and raid tests: each party gets its own copy of an
 * instanced map (monsters, chat room, instance switches), raid access
 * conditions, boss phases (adds, marked zone, enrage), rewards with a weekly
 * lockout, loot given in turn or after need / greed rolls, and the cleanup of
 * empty instances.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ChatMessage } from '../shared/social.js';
import type { ClientToServerEvents, EnterWorldPayload, ServerToClientEvents } from '../shared/protocol.js';
import { DEMO_MAPS } from '../server/db/demo-map.js';
import type { Monster } from '../server/game/combat.js';
import { lockoutEnd } from '../server/game/raids.js';
import type { PlayerSession } from '../server/game/world.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

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
  chat: ChatMessage[];
  telegraphs: number;
  partyInvites: number;
}

async function newPlayer(name: string): Promise<Player> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const player = { socket, notes: [], chat: [], telegraphs: 0, partyInvites: 0 } as unknown as Player;
  socket.on('notify', (n) => player.notes.push(n.key));
  socket.on('chat', (m) => player.chat.push(m));
  socket.on('telegraph', () => player.telegraphs++);
  socket.on('partyInvite', () => player.partyInvites++);
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  player.session = server.ctx.world.player(payload.character.id)!;
  return player;
}

async function party(leader: Player, member: Player): Promise<void> {
  leader.socket.emit('partyInvite', member.session.characterId);
  await until(() => member.partyInvites > 0);
  member.socket.emit('partyRespond', true);
  await until(() => server.ctx.world.party.partyOf(member.session.characterId) !== 0);
}

const boss = (instance: number): Monster => {
  const world = server.ctx.world;
  const view = world.combat.views(DEMO_MAPS.dungeon, instance).find((v) => v.enemyId === 8)!;
  return world.combat.monster(DEMO_MAPS.dungeon, view.id, instance)!;
};

test('lockout periods end at the next UTC midnight or Monday', () => {
  const wednesday = Date.UTC(2026, 8, 30, 15, 0); // Wednesday 30 September 2026
  assert.equal(lockoutEnd('daily', wednesday), Date.UTC(2026, 9, 1));
  assert.equal(lockoutEnd('weekly', wednesday), Date.UTC(2026, 9, 5));
  assert.equal(lockoutEnd('always', wednesday), 0);
});

test('criterion: a party enters the dungeon, defeats the boss and is rewarded; another party has its own instance', async () => {
  const [ada, bea, cid] = [await newPlayer('Ada'), await newPlayer('Bea'), await newPlayer('Cid')];
  const world = server.ctx.world;
  await party(ada, bea);

  // Ada and Bea share an instance; Cid (alone) gets another one.
  for (const p of [ada, bea, cid]) assert.ok(world.transfer(p.session, DEMO_MAPS.dungeon, 12, 19, 8));
  const [a, b, c] = [ada.session, bea.session, cid.session];
  // Arrival protection (monsters ignore a player who just changed map) is not what this test is about.
  for (const s of [a, b, c]) s.combat.protectedUntil = 0;
  assert.ok(a.instance > 0);
  assert.equal(a.instance, b.instance, 'party members share their instance');
  assert.notEqual(a.instance, c.instance, 'another party has its own instance');
  const bossA = boss(a.instance);
  const bossC = boss(c.instance);
  assert.notEqual(bossA.id, bossC.id, 'each instance has its own boss');

  // The map chat stays inside the instance.
  ada.socket.emit('chat', 'Le boss est au fond !', 'map');
  await until(() => bea.chat.some((m) => m.text === 'Le boss est au fond !'));
  await wait(50);
  assert.ok(!cid.chat.some((m) => m.text === 'Le boss est au fond !'));

  // The fight: phases trigger as the boss loses HP.
  const monstersBefore = world.combat.views(DEMO_MAPS.dungeon, a.instance).length;
  bossA.nextMoveAt = Number.MAX_SAFE_INTEGER;
  a.x = bossA.x;
  a.y = bossA.y + 1;
  a.direction = 8;
  b.x = bossA.x + 1;
  b.y = bossA.y + 1;
  bossA.mode = 'chase';
  bossA.targetId = a.characterId;
  bossA.hp = Math.floor(600 * 0.7);
  world.combat.tick();
  assert.equal(world.combat.views(DEMO_MAPS.dungeon, a.instance).length, monstersBefore + 2, 'adds called at 75 %');
  assert.equal(world.combat.views(DEMO_MAPS.dungeon, c.instance).length, monstersBefore, 'nothing happens in the other instance');
  bossA.hp = Math.floor(600 * 0.45);
  world.combat.tick();
  await until(() => ada.telegraphs > 0 && bea.telegraphs > 0);
  assert.equal(cid.telegraphs, 0);
  bossA.hp = Math.floor(600 * 0.2);
  world.combat.tick();
  assert.equal(bossA.enraged, true);

  // The last blows: raid rewards for both, lockout, loot in turn.
  const goldA = server.ctx.inventory.gold(a.characterId);
  bossA.hp = 1;
  a.hp = 9999;
  for (let i = 0; i < 20 && !bossA.dead; i++) {
    a.combat.nextAttackAt = 0;
    world.combat.attack(a);
  }
  assert.ok(bossA.dead);
  await until(() => ada.notes.includes('notify.raid_cleared') && bea.notes.includes('notify.raid_cleared'));
  assert.ok(server.ctx.inventory.gold(a.characterId) >= goldA + 150);
  const raid = server.ctx.gameData.get('raid', 1)!;
  assert.ok(world.raids.lockedUntil(a.characterId, raid.id) > Date.now(), 'weekly lockout');
  const helmets = server.ctx.inventory.quantity(a.characterId, 'armor', 4) + server.ctx.inventory.quantity(b.characterId, 'armor', 4);
  const elixirs = server.ctx.inventory.quantity(a.characterId, 'item', 3) + server.ctx.inventory.quantity(b.characterId, 'item', 3);
  assert.deepEqual([helmets, elixirs], [1, 1], 'each item of the loot table is given once');
  assert.equal(bossC.dead, false, 'the other boss is untouched');

  // A defeated raid boss does not come back in its instance.
  assert.equal(bossA.respawnAt, Number.MAX_SAFE_INTEGER);
  world.combat.tick();
  assert.equal(world.combat.views(DEMO_MAPS.dungeon, a.instance).some((v) => v.enemyId === 8), false);

  // Leaving: the empty instance is closed after the delay (instances do not survive).
  for (const p of [a, b]) world.transfer(p, DEMO_MAPS.forest, 12, 10, 2);
  const closed = a.instance === 0 ? undefined : a.instance;
  assert.equal(closed, undefined, 'back to the shared world');
  world.instances.cleanup(Date.now());
  world.instances.cleanup(Date.now() + 10 * 60_000);
  assert.equal(world.instances.list().filter((i) => i.mapId === DEMO_MAPS.dungeon).length, 1, 'only Cid’s instance is left');
  for (const p of [ada, bea, cid]) p.socket.close();
});

test('raid access conditions and instance switches', async () => {
  const dee = await newPlayer('Dee');
  const world = server.ctx.world;
  const raid = server.ctx.gameData.get('raid', 1)!;
  server.ctx.gameData.save('raid', { ...raid, minPlayers: 2 });
  assert.equal(world.transfer(dee.session, DEMO_MAPS.dungeon, 12, 19, 8), false);
  await until(() => dee.notes.includes('error.instance.too_few'));
  server.ctx.gameData.save('raid', { ...raid, minPlayers: 1 });
  // Switch 5 declared as an instance switch: shared in the instance only.
  server.ctx.settings.set('switches', [...Array(4)].map(() => ({ name: '', global: false })).concat([{ name: 'Levier', global: false, instance: true } as never]));
  world.systemChanged();
  assert.ok(world.transfer(dee.session, DEMO_MAPS.dungeon, 12, 19, 8));
  world.setSwitch(dee.session, 5, true);
  assert.equal(world.getSwitch(dee.session, 5), true);
  assert.equal(world.instances.of(dee.session)!.switches.has(5), true);
  world.transfer(dee.session, DEMO_MAPS.forest, 12, 10, 2);
  assert.equal(world.getSwitch(dee.session, 5), false, 'outside of the instance');
  dee.socket.close();
});

test('a raid counts the party members standing with the player, not those elsewhere', async () => {
  const [fay, gus, hal] = [await newPlayer('Fay'), await newPlayer('Gus'), await newPlayer('Hal')];
  const world = server.ctx.world;
  const raid = server.ctx.gameData.get('raid', 1)!;
  server.ctx.gameData.save('raid', { ...raid, minPlayers: 3 });
  try {
    await party(fay, gus);
    await party(fay, hal);
    for (const p of [fay, gus]) assert.ok(world.transfer(p.session, DEMO_MAPS.forest, 12, 10, 2));
    assert.ok(world.transfer(hal.session, DEMO_MAPS.village, 20, 17, 2));
    // A party of three, but one of them stayed in the village.
    assert.equal(world.transfer(fay.session, DEMO_MAPS.dungeon, 12, 19, 8), false);
    await until(() => fay.notes.includes('error.instance.too_few'));
    assert.ok(world.transfer(hal.session, DEMO_MAPS.forest, 12, 11, 2));
    assert.ok(world.transfer(fay.session, DEMO_MAPS.dungeon, 12, 19, 8), 'all three at the entrance');
    // The others join the party inside.
    assert.ok(world.transfer(gus.session, DEMO_MAPS.dungeon, 12, 19, 8));
    assert.equal(gus.session.instance, fay.session.instance);
  } finally {
    server.ctx.gameData.save('raid', raid);
    for (const p of [fay, gus, hal]) p.socket.close();
  }
});

test('a raid boss cannot be hurt while fewer players than the minimum are inside', async () => {
  const [ida, jon] = [await newPlayer('Ida'), await newPlayer('Jon')];
  const world = server.ctx.world;
  const raid = server.ctx.gameData.get('raid', 1)!;
  server.ctx.gameData.save('raid', { ...raid, minPlayers: 2 });
  try {
    await party(ida, jon);
    for (const p of [ida, jon]) assert.ok(world.transfer(p.session, DEMO_MAPS.forest, 12, 10, 2));
    // Both stood at the entrance, but only Ida goes in.
    assert.ok(world.transfer(ida.session, DEMO_MAPS.dungeon, 12, 19, 8));
    const i = ida.session;
    i.combat.protectedUntil = 0;
    const king = boss(i.instance);
    king.nextMoveAt = Number.MAX_SAFE_INTEGER;
    king.nextActionAt = Number.MAX_SAFE_INTEGER;
    const hit = () => {
      [i.x, i.y, i.direction] = [king.x, king.y + 1, 8];
      const hp = king.hp;
      for (let n = 0; n < 20 && king.hp === hp; n++) {
        i.combat.nextAttackAt = 0;
        world.combat.attack(i);
      }
      return hp - king.hp;
    };
    assert.equal(hit(), 0, 'out of reach alone');
    await until(() => ida.notes.includes('notify.boss_waiting'));
    assert.ok(world.transfer(jon.session, DEMO_MAPS.dungeon, 12, 19, 8));
    assert.ok(hit() > 0, 'fought once the second player is in');
  } finally {
    server.ctx.gameData.save('raid', raid);
    for (const p of [ida, jon]) p.socket.close();
  }
});

test('a raid whose rewards cannot be stored does not lock the player out', async () => {
  const kim = await newPlayer('Kim');
  const world = server.ctx.world;
  const raid = server.ctx.gameData.get('raid', 1)!;
  server.ctx.gameData.save('raid', { ...raid, minPlayers: 1, rewardGold: 70, lockout: 'weekly' });
  try {
    assert.ok(world.transfer(kim.session, DEMO_MAPS.dungeon, 12, 19, 8));
    const k = kim.session;
    const gold = server.ctx.inventory.gold(k.characterId);
    server.ctx.db.exec("CREATE TRIGGER no_lockout BEFORE INSERT ON character_raid_lockouts BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
    const errors = console.error;
    console.error = () => undefined;
    try {
      world.raids.bossDefeated(server.ctx.gameData.get('raid', 1)!, world.instances.of(k)!);
    } finally {
      console.error = errors;
      server.ctx.db.exec('DROP TRIGGER no_lockout');
    }
    await until(() => kim.notes.includes('error.raid.not_rewarded'));
    assert.equal(server.ctx.inventory.gold(k.characterId), gold, 'no gold kept');
    assert.equal(world.raids.lockedUntil(k.characterId, raid.id), 0, 'not locked out: the raid can be done again');
  } finally {
    server.ctx.gameData.save('raid', raid);
    kim.socket.close();
  }
});

test('need / greed loot: the highest need wins, otherwise greed; an item nobody wants is passed', async () => {
  const [dan, eve] = [await newPlayer('Dan'), await newPlayer('Eve')];
  const world = server.ctx.world;
  const data = server.ctx.gameData;
  const raid = data.get('raid', 1)!;
  data.save('raid', { ...raid, lootMode: 'need_greed' });
  try {
    const rolls = new Map<Player, { id: number; name: string }[]>([[dan, []], [eve, []]]);
    for (const p of [dan, eve]) p.socket.on('lootRoll', (r) => rolls.get(p)!.push(r));
    await party(dan, eve);
    for (const p of [dan, eve]) assert.ok(world.transfer(p.session, DEMO_MAPS.dungeon, 12, 19, 8));
    const [d, e] = [dan.session, eve.session];
    for (const s of [d, e]) s.combat.protectedUntil = 0;
    const king = boss(d.instance);
    king.nextMoveAt = Number.MAX_SAFE_INTEGER;
    king.hp = 1;
    d.x = king.x;
    d.y = king.y + 1;
    d.direction = 8;
    d.hp = 9999;
    for (let i = 0; i < 20 && !king.dead; i++) {
      d.combat.nextAttackAt = 0;
      world.combat.attack(d);
    }
    assert.ok(king.dead);
    // One roll per item of the loot table, offered to both.
    await until(() => rolls.get(dan)!.length === raid.rewardItems.length && rolls.get(eve)!.length === raid.rewardItems.length);
    const [first, second] = rolls.get(dan)!;
    dan.socket.emit('lootChoice', first!.id, 'need');
    eve.socket.emit('lootChoice', first!.id, 'greed');
    dan.socket.emit('lootChoice', second!.id, 'pass');
    eve.socket.emit('lootChoice', second!.id, 'pass');
    await until(() => dan.chat.some((m) => m.key === 'notify.loot_won') && dan.chat.some((m) => m.key === 'notify.loot_passed'));
    const won = dan.chat.find((m) => m.key === 'notify.loot_won')!;
    assert.equal(won.params?.name, 'Dan', 'need beats greed');
    assert.equal(won.params?.item, first!.name);
    assert.equal(dan.chat.find((m) => m.key === 'notify.loot_passed')?.params?.item, second!.name);
    // A choice for a roll already decided, or by someone not in it, changes nothing.
    eve.socket.emit('lootChoice', first!.id, 'need');
    await wait(50);
    assert.equal(dan.chat.filter((m) => m.key === 'notify.loot_won').length, 1);
  } finally {
    data.save('raid', raid);
    for (const p of [dan, eve]) p.socket.close();
  }
});
