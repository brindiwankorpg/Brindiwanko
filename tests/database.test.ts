/**
 * @file Database tests: schema normalisation, experience curve, database API
 * (permissions, create / save / delete, system settings, export / import),
 * inventory rules, and the step criterion: an item created in the editor is
 * immediately usable in game.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { SchemaError, defaultRecord, findMissingRef, normalizeRecord } from '../shared/database-schema.js';
import { expForLevel, type ItemData } from '../shared/database.js';
import { Cmd, Priority, Trigger, createPage } from '../shared/events.js';
import type { ClientToServerEvents, EnterWorldPayload, InventoryPayload, ServerToClientEvents } from '../shared/protocol.js';
import { DEMO_MAPS } from '../server/db/demo-map.js';
import { seed } from '../server/db/seed.js';
import { importDatabase, planDatabase } from '../server/importers/database.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

test('records are normalised: missing fields filled, values clamped, garbage refused', () => {
  const item = normalizeRecord('item', { name: 'X'.repeat(500), price: 1e12, occasion: 'sometimes', effects: [{ kind: 'recover_hp', value: '25', percent: 150 }] }, 3);
  assert.equal(item.id, 3);
  assert.equal(item.name.length, 100);
  assert.equal(item.price, 9_999_999);
  assert.equal(item.occasion, 'always');
  assert.deepEqual(item.effects, [{ kind: 'recover_hp', value: 25, percent: 100 }]);
  assert.equal(item.damage.type, 'none');
  assert.throws(() => normalizeRecord('item', { price: 'lots' }, 1), SchemaError);
  const cls = defaultRecord('class', 9);
  assert.equal(cls.params.mhp.base >= 1, true);
  assert.deepEqual(cls.learnings, []);
  assert.equal(expForLevel({ expBase: 30, expGrowth: 25 }, 1), 0);
  assert.equal(expForLevel({ expBase: 30, expGrowth: 25 }, 3), 30 + 38);
});

test('a state without HP / MP rates neither hurts nor drains (no −100 % per second default)', () => {
  const state = defaultRecord('state', 1);
  assert.equal(state.hpPerSecond, 0);
  assert.equal(state.mpPerSecond, 0);
  assert.equal(normalizeRecord('state', { name: 'X', hpPerSecond: -5 }, 1).mpPerSecond, 0);
  // Bounds still apply to the values given.
  assert.equal(normalizeRecord('state', { name: 'X', hpPerSecond: -500 }, 1).hpPerSecond, -100);
});

test('every record has a free note for its creator, bounded', () => {
  for (const type of ['class', 'skill', 'item', 'weapon', 'armor', 'enemy', 'state', 'animation', 'commonEvent', 'quest', 'raid'] as const) {
    const record = normalizeRecord(type, { name: 'X', note: 'n'.repeat(1500) }, 1) as unknown as { note: string };
    assert.equal(record.note.length, 1000, type);
    assert.equal((defaultRecord(type, 1) as unknown as { note: string }).note, '', `${type} starts without a note`);
  }
});

test('effects and traits are typed by their kind', () => {
  const skill = normalizeRecord('skill', {
    name: 'X',
    effects: [
      { kind: 'add_state', value: 0, percent: 50 },
      { kind: 'common_event', value: 4, percent: 0 },
      { kind: 'recover_hp', value: '25', percent: 10 },
    ],
  }, 1);
  // A state never chosen stays 0 (reported on saving) instead of becoming state 1.
  assert.deepEqual(skill.effects, [{ kind: 'add_state', value: 0, percent: 50 }, { kind: 'common_event', value: 4, percent: 0 }, { kind: 'recover_hp', value: 25, percent: 10 }]);
  const armor = normalizeRecord('armor', {
    name: 'X',
    traits: [
      { kind: 'param_rate', target: ' ATK ', value: 1.2 },
      { kind: 'param_rate', target: 'attaque', value: 1.2 },
      { kind: 'state_resist', target: 'poison', value: 0 },
      { kind: 'state_resist', target: 3, value: 0.5 },
      { kind: 'element_rate', target: '2', value: 0.5 },
      { kind: 'hit_rate', target: '', value: 0.05 },
    ],
  }, 1);
  assert.deepEqual(armor.traits.map((t) => t.target), ['atk', '', '0', '3', '2', '']);
  // Saving reports the first field aimed at nothing, with its path.
  const exists = (type: string, id: number) => type === 'state' && id === 3;
  assert.equal(findMissingRef('armor', armor, exists)?.path, 'traits[1].target');
  assert.equal(findMissingRef('armor', { ...armor, traits: armor.traits.slice(3) }, exists), null);
  assert.equal(findMissingRef('skill', skill, () => true), null);
  assert.equal(findMissingRef('skill', skill, (type) => type !== 'state')?.path, 'effects[0].value');
});

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

async function account(name: string) {
  const client = new TestClient(server.url);
  await client.post('/register', {
    _csrf: await client.csrf('/register'),
    username: name,
    email: `${name.toLowerCase()}@example.com`,
    password: 'secret password',
    passwordConfirm: 'secret password',
  });
  const csrf = await client.csrf('/characters');
  const api = async <T>(method: string, path: string, body?: unknown) => {
    const res = await client.request(`/api/editor${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  return { client, api };
}

async function enter(client: TestClient, name: string) {
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name, classId: '1' });
  const html = await (await client.request('/characters')).text();
  const id = /action="\/characters\/(\d+)\/play"/.exec(html)![1]!;
  await client.post(`/characters/${id}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const inventories: InventoryPayload[] = [];
  socket.on('inventory', (inv) => inventories.push(inv));
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  return { socket, payload, inventories };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('default content is seeded and old records are completed on read', () => {
  assert.ok(server.ctx.gameData.list('item').some((i) => i.name === 'Potion'));
  assert.ok(server.ctx.gameData.list('enemy').length >= 6);
  // A class stored without the newer fields still reads with complete defaults.
  server.ctx.db.prepare("UPDATE game_data SET data = json_remove(data, '$.learnings', '$.expBase') WHERE type = 'class' AND id = 1").run();
  server.ctx.gameData.save('class', { ...server.ctx.gameData.get('class', 1)! });
  const cls = server.ctx.gameData.get('class', 1)!;
  assert.ok(Array.isArray(cls.learnings));
});

let admin: Awaited<ReturnType<typeof account>>;

test('the database API: permissions, create, save, delete, system settings', async () => {
  admin = await account('DbAdmin');
  const player = await account('DbPlayer');
  assert.equal((await player.api('GET', '/db/item')).status, 403);

  const created = await admin.api<{ record: ItemData }>('POST', '/db/item', {});
  assert.equal(created.status, 200);
  const id = created.body.record.id;
  const saved = await admin.api<{ record: ItemData }>('PUT', `/db/item/${id}`, {
    record: { ...created.body.record, name: 'Super potion', effects: [{ kind: 'recover_hp', value: 100, percent: 0 }] },
  });
  assert.equal(saved.body.record.name, 'Super potion');
  assert.equal(server.ctx.gameData.get('item', id)?.name, 'Super potion', 'visible to the game at once');
  const bad = await admin.api<{ error: string }>('PUT', `/db/item/${id}`, { record: { price: 'many' } });
  assert.equal(bad.body.error, 'error.db.invalid_field');

  const dup = await admin.api<{ record: ItemData }>('POST', '/db/item', { copyOf: id });
  assert.equal(dup.body.record.name, 'Super potion (2)');
  assert.equal((await admin.api('DELETE', `/db/item/${dup.body.record.id}`)).status, 200);

  const sys = await admin.api<{ system: { currencyName: string; elements: string[] } }>('PUT', '/system', { system: { currencyName: 'Écus', elements: ['—', 'Feu'] } });
  assert.equal(sys.body.system.currencyName, 'Écus');
  assert.deepEqual(sys.body.system.elements, ['—', 'Feu']);
});

test('the starting position must be a walkable cell of an existing map', async () => {
  const start = server.ctx.settings.get('startPosition', { mapId: 1, x: 20, y: 17, direction: 2 });
  for (const wrong of [{ mapId: 9999, x: 0, y: 0 }, { mapId: 1, x: 255, y: 255 }]) {
    const res = await admin.api<{ error: string }>('PUT', '/system', { system: { startPosition: { ...wrong, direction: 2 } } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'error.db.invalid_start');
  }
  assert.deepEqual(server.ctx.settings.get('startPosition', null), start, 'unchanged');
  // An imported System with a start made for other maps keeps the current start.
  const exported = await admin.api<{ version: number; database: Record<string, unknown[]>; system: Record<string, unknown> }>('GET', '/db-export');
  assert.equal((await admin.api('POST', '/db-import', { ...exported.body, system: { ...exported.body.system, startPosition: { mapId: 9999, x: 1, y: 1, direction: 2 } } })).status, 200);
  assert.deepEqual(server.ctx.settings.get('startPosition', null), start);
});

test('empty names are refused, empty system texts keep their value', async () => {
  const created = await admin.api<{ record: ItemData }>('POST', '/db/item', {});
  const id = created.body.record.id;
  const empty = await admin.api<{ error: string }>('PUT', `/db/item/${id}`, { record: { ...created.body.record, name: '   ' } });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, 'error.db.name_required');
  assert.equal(server.ctx.gameData.get('item', id)?.name, created.body.record.name, 'unchanged');
  assert.equal((await admin.api('DELETE', `/db/item/${id}`)).status, 200);

  const before = server.ctx.settings.get('gameTitle', 'Brindiwanko');
  const sys = await admin.api<{ system: { gameTitle: string } }>('PUT', '/system', { system: { gameTitle: '' } });
  assert.equal(sys.body.system.gameTitle, before);
});

test('deleting a record still in use lists where, and needs force', async () => {
  type Refused = { error: string; params: { count: number }; usages: { kind: string; type?: string; id?: number; spawns?: boolean }[] };
  const skill = (await admin.api<{ record: { id: number } }>('POST', '/db/skill', {})).body.record;
  const enemy = (await admin.api<{ record: Record<string, unknown> & { id: number } }>('POST', '/db/enemy', {})).body.record;
  await admin.api('PUT', `/db/enemy/${enemy.id}`, { record: { ...enemy, name: 'Utilisateur', actions: [{ skillId: skill.id, weight: 1 }] } });

  const refused = await admin.api<Refused>('DELETE', `/db/skill/${skill.id}`);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'error.db.in_use');
  assert.deepEqual(refused.body.usages, [{ kind: 'record', type: 'enemy', id: enemy.id, name: 'Utilisateur' }]);
  assert.ok(server.ctx.gameData.get('skill', skill.id), 'kept');

  // Fields hidden by their `when` condition are not references: a reward of kind "armor" keeps a default item id.
  const item = (await admin.api<{ record: { id: number } }>('POST', '/db/item', {})).body.record;
  const raid = (await admin.api<{ record: Record<string, unknown> & { id: number } }>('POST', '/db/raid', {})).body.record;
  await admin.api('PUT', `/db/raid/${raid.id}`, { record: { ...raid, rewardItems: [{ kind: 'armor', item: item.id, weapon: 1, armor: 1, count: 1 }] } });
  assert.equal((await admin.api('DELETE', `/db/item/${item.id}`)).status, 200);

  // Map spawns of the demo world use its enemies.
  const spawned = server.ctx.maps.infos().flatMap((i) => server.ctx.maps.get(i.id)?.mmo.spawns ?? [])[0];
  if (spawned) {
    const res = await admin.api<Refused>('DELETE', `/db/enemy/${spawned.enemyId}`);
    assert.equal(res.status, 409);
    assert.ok(res.body.usages.some((u) => u.kind === 'map' && u.spawns === true));
  }

  assert.equal((await admin.api('DELETE', `/db/skill/${skill.id}?force=1`)).status, 200);
  assert.equal(server.ctx.gameData.get('skill', skill.id), undefined);
  for (const [type, id] of [['enemy', enemy.id], ['raid', raid.id]] as const) assert.equal((await admin.api('DELETE', `/db/${type}/${id}?force=1`)).status, 200);
});

test('effects and traits aimed at a missing state are refused; deleting a state can clean them', async () => {
  type Saved = { record: Record<string, unknown> & { id: number }; error?: string; params?: { field: string } };
  const state = (await admin.api<Saved>('POST', '/db/state', {})).body.record;
  const skill = (await admin.api<Saved>('POST', '/db/skill', {})).body.record;
  const armor = (await admin.api<Saved>('POST', '/db/armor', {})).body.record;

  const missing = await admin.api<Saved>('PUT', `/db/skill/${skill.id}`, { record: { ...skill, name: 'Sort', effects: [{ kind: 'add_state', value: 9999, percent: 100 }] } });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'error.db.missing_ref');
  assert.equal(missing.body.params?.field, 'effects[0].value');

  const effects = [{ kind: 'add_state', value: state.id, percent: 100 }, { kind: 'recover_hp', value: 10, percent: 0 }];
  assert.equal((await admin.api('PUT', `/db/skill/${skill.id}`, { record: { ...skill, name: 'Sort', effects } })).status, 200);
  const traits = [{ kind: 'state_resist', target: String(state.id), value: 0 }, { kind: 'param_rate', target: 'def', value: 1.1 }];
  assert.equal((await admin.api('PUT', `/db/armor/${armor.id}`, { record: { ...armor, name: 'Amulette', traits } })).status, 200);
  const unknownParam = await admin.api<Saved>('PUT', `/db/armor/${armor.id}`, { record: { ...armor, name: 'Amulette', traits: [{ kind: 'param_rate', target: 'force', value: 2 }] } });
  assert.equal(unknownParam.body.error, 'error.db.missing_ref');

  assert.equal((await admin.api('DELETE', `/db/state/${state.id}`)).status, 409, 'still used');
  assert.equal((await admin.api('DELETE', `/db/state/${state.id}?force=1&clean=1`)).status, 200);
  assert.deepEqual(server.ctx.gameData.get('skill', skill.id)!.effects, [{ kind: 'recover_hp', value: 10, percent: 0 }], 'the effect on the state is gone, the others stay');
  assert.deepEqual(server.ctx.gameData.get('armor', armor.id)!.traits, [{ kind: 'param_rate', target: 'def', value: 1.1 }]);
  for (const [type, id] of [['skill', skill.id], ['armor', armor.id]] as const) assert.equal((await admin.api('DELETE', `/db/${type}/${id}?force=1`)).status, 200);
});

test('drops are typed by their kind: a missing weapon is refused, and cleaned with its weapon', async () => {
  type Saved = { record: Record<string, unknown> & { id: number }; error?: string; params?: { field: string } };
  const weapon = (await admin.api<Saved>('POST', '/db/weapon', {})).body.record;
  const enemy = (await admin.api<Saved>('POST', '/db/enemy', {})).body.record;
  const save = (drops: unknown[]) => admin.api<Saved>('PUT', `/db/enemy/${enemy.id}`, { record: { ...enemy, name: 'Pillard', drops } });

  const missing = await save([{ kind: 'weapon', id: 9999, chance: 50 }]);
  assert.equal(missing.body.error, 'error.db.missing_ref');
  assert.equal(missing.body.params?.field, 'drops[0].id');
  // The same id is read with the kind: an item #1 exists, so the drop is valid as an item.
  assert.equal((await save([{ kind: 'weapon', id: weapon.id, chance: 50 }, { kind: 'item', id: 1, chance: 10 }])).status, 200);

  assert.equal((await admin.api('DELETE', `/db/weapon/${weapon.id}`)).status, 409, 'still dropped');
  assert.equal((await admin.api('DELETE', `/db/weapon/${weapon.id}?force=1&clean=1`)).status, 200);
  assert.deepEqual(server.ctx.gameData.get('enemy', enemy.id)!.drops, [{ kind: 'item', id: 1, chance: 10 }]);
  assert.equal((await admin.api('DELETE', `/db/enemy/${enemy.id}?force=1`)).status, 200);

  // Weapon and armor types, and the switch of a common event, stay plain numbers in storage.
  assert.equal(normalizeRecord('weapon', { name: 'X', weaponType: '3' }, 1).weaponType, 3);
  assert.equal(normalizeRecord('commonEvent', { name: 'X', trigger: 'none' }, 1).switchId, 0);
});

test('the demo states do not hurt by themselves, and older databases are repaired once', () => {
  const ctx = server.ctx;
  const rates = () => ctx.db.prepare<[], { id: number; hp: number; mp: number }>("SELECT id, data ->> '$.hpPerSecond' AS hp, data ->> '$.mpPerSecond' AS mp FROM game_data WHERE type = 'state' ORDER BY id").all();
  // "Force accrue" (given by "Cri de guerre") only raises the attack; poison only takes HP.
  assert.deepEqual(rates().slice(0, 4), [{ id: 1, hp: -2, mp: 0 }, { id: 2, hp: 0, mp: 0 }, { id: 3, hp: 0, mp: 0 }, { id: 4, hp: 2, mp: 0 }]);

  // A database seeded by an older version holds −100 % per second where nothing was set.
  ctx.db.prepare("UPDATE game_data SET data = json_set(data, '$.hpPerSecond', -100, '$.mpPerSecond', -100) WHERE type = 'state' AND id IN (2, 3)").run();
  ctx.db.prepare("UPDATE game_data SET data = json_set(data, '$.mpPerSecond', -100) WHERE type = 'state' AND id = 1").run();
  ctx.settings.set('repairedStateRates', false);
  seed(ctx.db);
  assert.deepEqual(rates().slice(0, 4), [{ id: 1, hp: -2, mp: 0 }, { id: 2, hp: 0, mp: 0 }, { id: 3, hp: 0, mp: 0 }, { id: 4, hp: 2, mp: 0 }]);
  // Only once: a creator may later want such a rate.
  ctx.db.prepare("UPDATE game_data SET data = json_set(data, '$.hpPerSecond', -100) WHERE type = 'state' AND id = 2").run();
  seed(ctx.db);
  assert.equal(rates()[1]!.hp, -100);
  ctx.db.prepare("UPDATE game_data SET data = json_set(data, '$.hpPerSecond', 0) WHERE type = 'state' AND id = 2").run();
});

test('database export and import round trip; invalid exports are refused', async () => {
  const exported = await admin.api<{ version: number; database: Record<string, unknown[]> }>('GET', '/db-export');
  assert.equal(exported.body.version, 1);
  const itemCount = exported.body.database.item!.length;
  (exported.body.database.item as { name: string }[])[0]!.name = 'Potion importée';
  const imported = await admin.api<{ ok: boolean }>('POST', '/db-import', exported.body);
  assert.equal(imported.status, 200);
  assert.equal(server.ctx.gameData.list('item').length, itemCount);
  assert.equal(server.ctx.gameData.get('item', 1)?.name, 'Potion importée');
  assert.equal((await admin.api('POST', '/db-import', { version: 99 })).status, 400);
  assert.equal((await admin.api('POST', '/db-import', { version: 1, database: { class: [] } })).status, 400, 'at least one class');
});

test('a database import keeps the references to missing entries but lists them', async () => {
  type Missing = { count: number; first: { type: string; id: number; field: string; value: string }[] };
  const exported = await admin.api<{ version: number; database: Record<string, unknown[]> }>('GET', '/db-export');
  const clean = await admin.api<{ missingRefs: Missing }>('POST', '/db-import', exported.body);
  assert.equal(clean.body.missingRefs.count, 0, 'the export of a consistent database has none');
  const items = exported.body.database.item as { id: number; effects: unknown[] }[];
  const skill = (exported.body.database.skill as { id: number }[])[0]!.id;
  items[0]!.effects = [{ kind: 'learn_skill', value: 9999, percent: 0 }];
  items[1]!.effects = [{ kind: 'learn_skill', value: skill, percent: 0 }];
  // Skills are not in the file: those of the server stay, and a reference to one of them is fine.
  delete exported.body.database.skill;
  const res = await admin.api<{ missingRefs: Missing }>('POST', '/db-import', exported.body);
  assert.equal(res.status, 200, 'imported anyway');
  assert.equal(res.body.missingRefs.count, 1);
  assert.deepEqual(res.body.missingRefs.first, [{ type: 'item', id: items[0]!.id, field: 'effects[0].value', value: '9999' }]);
  assert.deepEqual(server.ctx.gameData.get('item', items[0]!.id)?.effects, [{ kind: 'learn_skill', value: 9999, percent: 0 }]);
});

test('a class saved in the editor gives the players in game their new parameters at once', async () => {
  const { socket, payload } = await enter(admin.client, 'Statue');
  const sheets: { params: Record<string, number> }[] = [];
  const updates: { maxHp?: number; hp?: number }[] = [];
  socket.on('sheet', (sheet) => sheets.push(sheet));
  socket.on('playerUpdate', (update) => updates.push(update));
  const p = server.ctx.world.player(payload.character.id)!;
  const before = server.ctx.gameData.get('class', p.classId)!;
  const was = server.ctx.world.maxVitals(p).maxHp;
  try {
    const stronger = { ...before, params: { ...before.params, mhp: { ...before.params.mhp, base: before.params.mhp.base + 100 } } };
    assert.equal((await admin.api('PUT', `/db/class/${p.classId}`, { record: stronger })).status, 200);
    const end = Date.now() + 3000;
    while (!updates.some((u) => u.maxHp === was + 100) && Date.now() < end) await wait(10);
    assert.ok(updates.some((u) => u.maxHp === was + 100), 'the new maximum HP is sent without waiting for a level up');
    assert.equal(sheets.at(-1)?.params.mhp, was + 100, 'and the character sheet with it');
    // Lowered again: the current HP stays within the new maximum.
    p.hp = was + 100;
    assert.equal((await admin.api('PUT', `/db/class/${p.classId}`, { record: before })).status, 200);
    assert.equal(p.hp, was);
  } finally {
    server.ctx.gameData.save('class', before);
    socket.close();
  }
});

test('an item created in the editor is immediately usable in game (chest → bag → use)', async () => {
  const created = await admin.api<{ record: ItemData }>('POST', '/db/item', {});
  const id = created.body.record.id;
  await admin.api('PUT', `/db/item/${id}`, { record: { ...created.body.record, name: 'Tisane', effects: [{ kind: 'recover_hp', value: 30, percent: 0 }] } });

  // A chest giving the item, placed on the village with the editor API.
  await admin.api('POST', '/maps/1/lock');
  const village = (await admin.api<{ map: import('../shared/map.js').MapData }>('GET', '/maps/1')).body.map;
  village.events.push({
    id: village.events.length, name: 'Coffre', note: '', x: 18, y: 12,
    pages: [createPage({ priorityType: Priority.Same, trigger: Trigger.Action, list: [{ code: Cmd.ChangeItems, indent: 0, parameters: [id, 0, 0, 2] }, { code: Cmd.ChangeGold, indent: 0, parameters: [0, 0, 15] }, { code: 0, indent: 0, parameters: [] }] })],
  });
  assert.equal((await admin.api('PUT', '/maps/1', { map: village })).status, 200);

  const { socket, payload, inventories } = await enter(admin.client, 'Healer');
  await wait(100);
  assert.equal(inventories[0]?.gold, server.ctx.settings.get('startingGold', 0), 'starting gold');
  const p = server.ctx.world.player(payload.character.id)!;
  p.x = 18;
  p.y = 13;
  const notes: string[] = [];
  socket.on('notify', (n) => notes.push(n.key));
  socket.emit('turn', 8);
  await wait(50);
  socket.emit('action');
  await wait(200);
  const inv = inventories.at(-1)!;
  assert.equal(inv.entries.find((e) => e.id === id)?.quantity, 2);
  assert.equal(inv.entries.find((e) => e.id === id)?.usable, true);
  assert.ok(notes.includes('notify.item_gained') && notes.includes('notify.gold_gained'));

  // Use it while hurt: HP goes up, one is consumed.
  p.hp = 10;
  const updated = new Promise<{ hp?: number }>((resolve) => socket.on('playerUpdate', (u) => u.hp !== undefined && resolve(u)));
  socket.emit('useItem', id);
  assert.equal((await updated).hp, 40);
  await wait(100);
  assert.equal(inventories.at(-1)!.entries.find((e) => e.id === id)?.quantity, 1);

  // A key item cannot be used; a full-health character does not waste potions.
  server.ctx.world.changeItems(p, 'item', 6, 1);
  socket.emit('useItem', 6);
  p.hp = 9999;
  socket.emit('useItem', id);
  await wait(150);
  assert.ok(notes.includes('error.item.not_usable'));
  assert.ok(notes.includes('error.item.no_effect'));
  assert.equal(server.ctx.inventory.quantity(p.characterId, 'item', id), 1);
  socket.close();
});

test('a skill book teaches its skill for good, and is kept once the skill is known', async () => {
  const book = server.ctx.gameData.get('item', 7)!;
  assert.deepEqual(book.effects, [{ kind: 'learn_skill', value: 6, percent: 0 }], 'the demo grimoire teaches "Soin"');
  const { socket, payload } = await enter(admin.client, 'Lecteur');
  const p = server.ctx.world.player(payload.character.id)!;
  assert.ok(!server.ctx.world.combat.knownSkills(p).some((s) => s.id === 6), 'a warrior does not know it');
  server.ctx.world.changeItems(p, 'item', 7, 2);
  const notes: string[] = [];
  socket.on('notify', (n) => notes.push(n.key));
  const skills = new Promise<number[]>((resolve) => socket.on('skills', (s) => resolve(s.skills.map((k) => k.id))));
  socket.emit('useItem', 7);
  assert.ok((await skills).includes(6));
  await wait(100);
  assert.ok(notes.includes('notify.skill_learned'));
  assert.deepEqual(server.ctx.progression.learnedSkills(p.characterId), [6], 'stored with the character');
  assert.equal(server.ctx.inventory.quantity(p.characterId, 'item', 7), 1, 'one book used');
  // Known now: the second book would teach nothing, so it is not used.
  socket.emit('useItem', 7);
  await wait(150);
  assert.ok(notes.includes('error.item.no_effect'));
  assert.equal(server.ctx.inventory.quantity(p.characterId, 'item', 7), 1);
  socket.close();
});

test('editing a skill or the skill types sends the new skills list to the players in game', async () => {
  const { socket, payload } = await enter(admin.client, 'Lecteur2');
  const p = server.ctx.world.player(payload.character.id)!;
  const strike = server.ctx.world.combat.knownSkills(p)[0]!;
  const typeOf = (payloadSkills: { skills: { id: number; typeName: string }[] }) => payloadSkills.skills.find((s) => s.id === strike.id)?.typeName;
  const next = () => new Promise<{ skills: { id: number; typeName: string }[] }>((resolve) => socket.once('skills', resolve));

  // The skill gets a type: the window of the player shows it without anything else happening.
  let pushed = next();
  const { records } = (await admin.api<{ records: (Record<string, unknown> & { id: number })[] }>('GET', '/db/skill')).body;
  const skill = records.find((s) => s.id === strike.id)!;
  assert.equal((await admin.api('PUT', `/db/skill/${skill.id}`, { record: { ...skill, skillType: 1 } })).status, 200);
  assert.equal(typeOf(await pushed), 'Magie');

  // Renaming the type in the System tab is shown too.
  pushed = next();
  const system = ((await admin.api<{ system: Record<string, unknown> & { skillTypes: string[] } }>('GET', '/system')).body).system;
  const skillTypes = system.skillTypes.map((n, i) => (i === 1 ? 'Sortilège' : n));
  assert.equal((await admin.api('PUT', '/system', { system: { ...system, skillTypes } })).status, 200);
  assert.equal(typeOf(await pushed), 'Sortilège');

  assert.equal((await admin.api('PUT', '/system', { system })).status, 200);
  assert.equal((await admin.api('PUT', `/db/skill/${skill.id}`, { record: skill })).status, 200);
  socket.close();
});

test('states: a duration drawn between min and max, removal after some steps with an end message', async () => {
  type Saved = { record: Record<string, unknown> & { id: number } };
  const created = (await admin.api<Saved>('POST', '/db/state', {})).body.record;
  const state = { ...created, name: 'Brume', duration: 10, durationMax: 20, removeAfterSteps: 2, message: 'est dans la brume.', endMessage: 'sort de la brume.' };
  assert.equal((await admin.api('PUT', `/db/state/${state.id}`, { record: state })).status, 200);
  const flask = (await admin.api<Saved>('POST', '/db/item', {})).body.record;
  assert.equal((await admin.api('PUT', `/db/item/${flask.id}`, { record: { ...flask, name: 'Fiole de brume', effects: [{ kind: 'add_state', value: state.id, percent: 100 }] } })).status, 200);

  const { socket, payload } = await enter(admin.client, 'Brumeux');
  const p = server.ctx.world.player(payload.character.id)!;
  const notes: string[] = [];
  socket.on('notify', (n) => notes.push(n.key));
  server.ctx.world.changeItems(p, 'item', flask.id, 1);
  const before = Date.now();
  socket.emit('useItem', flask.id);
  await wait(150);
  const until = p.combat.states.get(state.id)!;
  assert.ok(until >= before + 10_000 && until <= Date.now() + 20_000, `drawn between 10 and 20 s (${until - before} ms)`);
  assert.ok(notes.includes('notify.state_added'));

  server.ctx.world.combat.playerStepped(p);
  assert.ok(p.combat.states.has(state.id), 'one cell is not enough');
  server.ctx.world.combat.playerStepped(p);
  assert.ok(!p.combat.states.has(state.id), 'gone after two cells');
  await wait(50);
  assert.ok(notes.includes('notify.state_removed'), 'its end message is shown');
  socket.close();
  for (const [type, id] of [['item', flask.id], ['state', state.id]] as const) assert.equal((await admin.api('DELETE', `/db/${type}/${id}?force=1`)).status, 200);
});

test('traits: a skill given while worn, regeneration, experience rate and attack states', async () => {
  type Saved = { record: Record<string, unknown> & { id: number } };
  const created = (await admin.api<Saved>('POST', '/db/state', {})).body.record;
  const traits = [
    { kind: 'add_skill', target: '3', value: 0 },
    { kind: 'hp_regen', target: '', value: 10 },
    { kind: 'exp_rate', target: '', value: 2 },
    { kind: 'attack_state', target: '1', value: 100 },
  ];
  const blessing = { ...created, name: 'Bénédiction', duration: 0, traits };
  assert.equal((await admin.api('PUT', `/db/state/${blessing.id}`, { record: blessing })).status, 200);
  const flask = (await admin.api<Saved>('POST', '/db/item', {})).body.record;
  assert.equal((await admin.api('PUT', `/db/item/${flask.id}`, { record: { ...flask, name: 'Eau bénite', effects: [{ kind: 'add_state', value: blessing.id, percent: 100 }] } })).status, 200);

  const { socket, payload } = await enter(admin.client, 'Béni');
  const p = server.ctx.world.player(payload.character.id)!;
  const combat = server.ctx.world.combat;
  server.ctx.world.changeItems(p, 'item', flask.id, 1);
  const skills = new Promise<number[]>((resolve) => socket.on('skills', (s) => s.skills.some((k) => k.id === 3) && resolve(s.skills.map((k) => k.id))));
  socket.emit('useItem', flask.id);
  assert.ok((await skills).includes(3), 'the state gives "Boule de feu"');

  // Regeneration: 10 % of the maximum every second.
  p.hp = 1;
  await wait(1300);
  assert.ok(p.hp > 1, `regenerated (${p.hp} HP)`);

  // Experience rate ×2 on a defeated monster.
  const internals = combat as unknown as {
    reward: (p: unknown, group: unknown[], def: unknown) => void;
    attackStates: (user: unknown, target: unknown) => void;
  };
  const xp = p.xp;
  internals.reward(p, [p], { ...server.ctx.gameData.get('enemy', 1)!, exp: 10, gold: 0, drops: [] });
  assert.equal(p.xp - xp, 20);

  // Attack state: the normal attacks of the bearer poison (state 1) at 100 %.
  internals.attackStates({ kind: 'player', p }, { kind: 'player', p });
  assert.ok(p.combat.states.has(1), 'poisoned by the attack trait');

  // Without the state, the skill is gone.
  p.combat.states.delete(blessing.id);
  combat.invalidate(p);
  assert.ok(!combat.knownSkills(p).some((s) => s.id === 3));
  socket.close();
  for (const [type, id] of [['item', flask.id], ['state', blessing.id]] as const) assert.equal((await admin.api('DELETE', `/db/${type}/${id}?force=1`)).status, 200);
});

test('skills: required weapon, repeats, success rate and a message in the nearby chat', async () => {
  type Saved = { record: Record<string, unknown> & { id: number } };
  const created = (await admin.api<Saved>('POST', '/db/skill', {})).body.record;
  const skill = { ...created, name: 'Chant', scope: 'self', range: 0, mpCost: 0, cooldown: 0, damage: { type: 'none', formula: '0', element: 0, variance: 0, critical: false }, effects: [{ kind: 'gain_xp', value: 1, percent: 0 }], repeats: 3, message: '%1 entonne un chant.' };
  assert.equal((await admin.api('PUT', `/db/skill/${skill.id}`, { record: skill })).status, 200);

  const { socket, payload } = await enter(admin.client, 'Chanteur');
  const p = server.ctx.world.player(payload.character.id)!;
  const combat = server.ctx.world.combat;
  combat.learnSkill(p, skill.id);
  const chat: { key?: string; params?: Record<string, unknown> }[] = [];
  const notes: string[] = [];
  socket.on('chat', (m) => chat.push(m));
  socket.on('notify', (n) => notes.push(n.key));

  // Three repeats: three times the effect.
  let xp = p.xp;
  combat.useSkill(p, skill.id);
  assert.equal(p.xp - xp, 3);
  await wait(100);
  assert.ok(chat.some((m) => m.key === 'notify.skill_message' && m.params?.text === `${p.name} entonne un chant.`), 'the message, with the name');

  // Never succeeds: no effect at all.
  await admin.api('PUT', `/db/skill/${skill.id}`, { record: { ...skill, successRate: 0 } });
  p.combat.globalReadyAt = 0;
  xp = p.xp;
  combat.useSkill(p, skill.id);
  assert.equal(p.xp, xp);

  // A bow is needed: refused without one.
  await admin.api('PUT', `/db/skill/${skill.id}`, { record: { ...skill, requiredWeaponType: 4 } });
  p.combat.globalReadyAt = 0;
  for (const slot of server.ctx.progression.equipment(p.characterId).keys()) if (slot === 'weapon') server.ctx.progression.equip(p.characterId, 'weapon', null, { bagSize: 999, maxOf: () => 99 });
  xp = p.xp;
  combat.useSkill(p, skill.id);
  await wait(100);
  assert.equal(p.xp, xp);
  assert.ok(notes.includes('error.combat.weapon_required'));
  socket.close();
  assert.equal((await admin.api('DELETE', `/db/skill/${skill.id}?force=1`)).status, 200);
});

test('enemy actions are drawn only while their condition holds: a heal under 30 % HP', async () => {
  type Saved = { record: Record<string, unknown> & { id: number } };
  const created = (await admin.api<Saved>('POST', '/db/skill', {})).body.record;
  const heal = { ...created, name: 'Régénération', scope: 'self', range: 0, mpCost: 0, cooldown: 0, damage: { type: 'hp_recover', formula: '50', element: 0, variance: 0, critical: false }, effects: [] };
  assert.equal((await admin.api('PUT', `/db/skill/${heal.id}`, { record: heal })).status, 200);
  const blank = (await admin.api<Saved>('POST', '/db/enemy', {})).body.record;
  // Actions saved before conditions existed are always available.
  assert.equal((await admin.api('PUT', `/db/enemy/${blank.id}`, { record: { ...blank, actions: [{ skillId: heal.id, weight: 100 }] } })).status, 200);
  const old = server.ctx.gameData.get('enemy', blank.id)!.actions[0]!;
  assert.equal(old.condition, 'always');
  assert.equal(old.hpBelow, 30);
  const params = { mhp: 100, mmp: 0, atk: 1, def: 1, mat: 1, mdf: 1, agi: 1, luk: 1 };
  const troll = { ...blank, name: 'Troll', params, ai: 'aggressive', actions: [{ skillId: heal.id, weight: 100, condition: 'hp_below', hpBelow: 30 }] };
  assert.equal((await admin.api('PUT', `/db/enemy/${troll.id}`, { record: troll })).status, 200);

  const { socket, payload } = await enter(admin.client, 'Dresseur');
  const p = server.ctx.world.player(payload.character.id)!;
  const combat = server.ctx.world.combat;
  assert.ok(combat.ambush(p, troll.id));
  const m = combat.views(p.mapId, p.instance).map((v) => combat.monster(p.mapId, v.id, p.instance)!).find((x) => x.def.id === troll.id && !x.dead)!;
  // Next to the player, in reach of its normal attack, ready to act at each AI step.
  const step = (hp: number) => {
    m.x = m.homeX = p.x;
    m.y = m.homeY = p.y > 0 ? p.y - 1 : p.y + 1;
    m.hp = hp;
    m.nextActionAt = 0;
    m.nextMoveAt = Number.MAX_SAFE_INTEGER;
    combat.tick();
    return m.hp;
  };
  for (let i = 0; i < 10; i++) assert.equal(step(40), 40, 'never healed above 30 % HP');
  let healed = false;
  for (let i = 0; i < 20 && !healed; i++) healed = step(20) > 20;
  assert.ok(healed, 'healed under 30 % HP');

  // A state the enemy is under, a switch on for the player fought.
  const ready = (combat as unknown as { actionReady: (m: unknown, a: unknown, p: unknown, mhp: number) => boolean }).actionReady.bind(combat);
  const underState = { skillId: heal.id, weight: 1, condition: 'state', hpBelow: 30, stateId: 3, switchId: 99 };
  assert.equal(ready(m, underState, p, 100), false);
  m.states.set(3, 0);
  assert.equal(ready(m, underState, p, 100), true);
  const onSwitch = { ...underState, condition: 'switch' };
  assert.equal(ready(m, onSwitch, p, 100), false);
  server.ctx.world.setSwitch(p, 99, true);
  assert.equal(ready(m, onSwitch, p, 100), true);
  server.ctx.world.setSwitch(p, 99, false);

  m.dead = true;
  m.respawnAt = Number.MAX_SAFE_INTEGER;
  socket.close();
  for (const [type, id] of [['enemy', troll.id], ['skill', heal.id]] as const) assert.equal((await admin.api('DELETE', `/db/${type}/${id}?force=1`)).status, 200);
});

test('the "Try in game" button of an enemy makes it appear next to the administrator, who must be in game', async () => {
  type Refused = { error: string };
  assert.equal((await admin.api<Refused>('POST', '/db/enemy/9999/test')).body.error, 'error.db.not_found');
  const { socket, payload } = await enter(admin.client, 'Testeur');
  const p = server.ctx.world.player(payload.character.id)!;
  const combat = server.ctx.world.combat;
  const before = new Set(combat.views(p.mapId, p.instance).map((v) => v.id));
  assert.equal((await admin.api('POST', '/db/enemy/2/test')).status, 200);
  const spawned = combat.views(p.mapId, p.instance).filter((v) => !before.has(v.id));
  assert.equal(spawned.length, 1);
  const m = combat.monster(p.mapId, spawned[0]!.id, p.instance)!;
  assert.equal(m.def.id, 2);
  assert.equal(m.summoned, true, 'gone for good once defeated');
  assert.equal(m.targetId, p.characterId, 'it attacks the administrator');
  assert.ok(Math.abs(m.x - p.x) <= 3 && Math.abs(m.y - p.y) <= 3);
  m.dead = true;
  m.respawnAt = Number.MAX_SAFE_INTEGER;

  socket.close();
  for (let i = 0; i < 100 && server.ctx.world.isLive(p); i++) await wait(20);
  const offline = await admin.api<Refused>('POST', '/db/enemy/2/test');
  assert.equal(offline.status, 409);
  assert.equal(offline.body.error, 'error.db.test_offline');
});

test('an edited enemy is applied at once to the monsters already on a map; a deleted one leaves', async () => {
  const combat = server.ctx.world.combat;
  const forest = DEMO_MAPS.forest;
  const original = structuredClone(server.ctx.gameData.get('enemy', 1)!);
  const slimes = () => combat.views(forest).filter((v) => v.enemyId === 1);
  const living = slimes()[0]!;
  const m = combat.monster(forest, living.id)!;
  m.hp = Math.floor(living.maxHp / 2);
  const edited = { ...structuredClone(original), name: 'Big slime', exp: 99, params: { ...original.params, mhp: original.params.mhp * 10 } };
  assert.equal((await admin.api('PUT', '/db/enemy/1', { record: edited })).status, 200);
  const view = slimes().find((v) => v.id === living.id)!;
  assert.equal(view.name, 'Big slime');
  assert.equal(view.maxHp, original.params.mhp * 10);
  assert.ok(Math.abs(view.hp / view.maxHp - 0.5) < 0.1, 'the same share of its HP');
  // A monster defeated before the change comes back with the new record too.
  m.dead = true;
  m.respawnAt = 0;
  combat.views(forest);
  assert.equal(combat.monster(forest, living.id)!.def.exp, 99);
  // Deleted (after being shown where it is used): its monsters leave the maps and never come back.
  assert.equal((await admin.api('DELETE', '/db/enemy/1?force=1')).status, 200);
  assert.equal(slimes().length, 0);
  combat.tick();
  assert.equal(slimes().length, 0);
  assert.equal((await admin.api('PUT', '/db/enemy/1', { record: original })).status, 200);
  server.ctx.world.reloadMap(forest);
  assert.ok(slimes().length > 0, 'back with the map once the enemy exists again');
});

test('a deleted quest or skill is forgotten by the players in game, and its id is never given again', async () => {
  const { socket, payload } = await enter(admin.client, 'Oublieuse');
  const p = server.ctx.world.player(payload.character.id)!;
  const world = server.ctx.world;
  try {
    const quest = (await admin.api<{ record: { id: number } }>('POST', '/db/quest', {})).body.record;
    assert.equal((await admin.api('PUT', `/db/quest/${quest.id}`, { record: { ...quest, name: 'Old quest', steps: [{ description: 'a', objectives: [] }, { description: 'b', objectives: [] }] } })).status, 200);
    assert.ok(world.quests.start(p, quest.id));
    world.quests.advance(p, quest.id, 1);
    const skill = (await admin.api<{ record: { id: number } }>('POST', '/db/skill', { copyOf: 1 })).body.record;
    assert.ok(world.combat.learnSkill(p, skill.id));
    assert.equal((await admin.api('DELETE', `/db/quest/${quest.id}?force=1`)).status, 200);
    assert.equal((await admin.api('DELETE', `/db/skill/${skill.id}?force=1`)).status, 200);
    assert.equal(p.progress.quests.has(quest.id), false, 'no progress left in memory');
    assert.equal(p.combat.learned.includes(skill.id), false);
    // New records take new ids: they cannot be found already started or learned.
    assert.ok((await admin.api<{ record: { id: number } }>('POST', '/db/quest', {})).body.record.id > quest.id);
    assert.ok((await admin.api<{ record: { id: number } }>('POST', '/db/skill', {})).body.record.id > skill.id);
  } finally {
    socket.close();
  }
});

test('a new character receives the starting items of its class, and wears those marked so', async () => {
  const before = server.ctx.gameData.get('class', 1)!;
  const startItems = [
    { kind: 'weapon', id: 1, count: 1, equip: true },
    { kind: 'armor', id: 1, count: 1, equip: true },
    { kind: 'item', id: 1, count: 3, equip: false },
  ];
  assert.equal((await admin.api('PUT', '/db/class/1', { record: { ...before, startItems } })).status, 200);
  try {
    // A fresh account: the administrator's one is full of characters by now.
    const { client } = await account('Recrue');
    await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name: 'Recrue', classId: '1' });
    const id = server.ctx.db.prepare<[string], number>('SELECT id FROM characters WHERE name = ?').pluck().get('Recrue');
    assert.ok(id, 'character created');
    const worn = server.ctx.progression.equipment(id);
    assert.deepEqual(worn.get('weapon'), { kind: 'weapon', id: 1 });
    assert.deepEqual(worn.get('body'), { kind: 'armor', id: 1 }, 'armor 1 is a body armor');
    assert.equal(server.ctx.inventory.quantity(id, 'item', 1), 3, 'three potions in the bag');
    assert.equal(server.ctx.inventory.quantity(id, 'weapon', 1), 0, 'the worn sword left the bag');
  } finally {
    assert.equal((await admin.api('PUT', '/db/class/1', { record: before })).status, 200);
  }
});

test('external database files are imported under new ids with references remapped', () => {
  const files: Record<string, unknown> = {
    States: [null, { id: 1, name: 'Sommeil', iconIndex: 5, restriction: 4, minTurns: 2 }],
    Skills: [null, { id: 1, name: 'Berceuse', mpCost: 4, scope: 1, damage: { type: 0, formula: '0' }, effects: [{ code: 21, dataId: 1, value1: 0.5 }] }],
    Items: [null, { id: 1, name: 'Tonique', itypeId: 1, occasion: 0, scope: 7, effects: [{ code: 11, value1: 0.2, value2: 10 }] }],
    Enemies: [null, { id: 1, name: 'Rat', battlerName: 'Rat', params: [30, 0, 5, 3, 1, 1, 6, 4], exp: 3, gold: 2, dropItems: [{ kind: 1, dataId: 1, denominator: 4 }], actions: [{ skillId: 1, rating: 5 }] }],
    Classes: [null, { id: 1, name: 'Barde', params: Array.from({ length: 8 }, () => Array.from({ length: 100 }, (_, l) => 10 + l)), learnings: [{ level: 2, skillId: 1 }], expParams: [25, 30, 30, 30] }],
  };
  const warnings: { key: string }[] = [];
  const counts = importDatabase(server.ctx, planDatabase(server.ctx, (name) => files[name]), warnings);
  assert.deepEqual(counts, { state: 1, skill: 1, item: 1, enemy: 1, class: 1 });
  const skill = server.ctx.gameData.list('skill').find((s) => s.name === 'Berceuse')!;
  const state = server.ctx.gameData.list('state').find((s) => s.name === 'Sommeil')!;
  assert.deepEqual(skill.effects[0], { kind: 'add_state', value: state.id, percent: 50 });
  const tonic = server.ctx.gameData.list('item').find((i) => i.name === 'Tonique')!;
  assert.deepEqual(tonic.effects[0], { kind: 'recover_hp', value: 10, percent: 20 });
  const rat = server.ctx.gameData.list('enemy').find((e) => e.name === 'Rat')!;
  assert.deepEqual(rat.drops[0], { kind: 'item', id: tonic.id, chance: 25 });
  assert.equal(rat.actions[0]!.skillId, skill.id);
  const bard = server.ctx.gameData.list('class').find((c) => c.name === 'Barde')!;
  assert.equal(bard.params.atk.base, 11);
  assert.equal(bard.learnings[0]!.skillId, skill.id);
  assert.ok(warnings.some((w) => w.key === 'import.warning.enemy_sprite'));
});
