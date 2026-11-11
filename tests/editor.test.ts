/**
 * @file Map editor tests: painting rules (automatic layers, stacking, fill,
 * undo data, shadows, clipboard) and the editor API (permissions, CSRF, locks,
 * outdated copies refused, validation, live update, versions, and the full
 * "new map + teleporter" flow).
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { MapEditor, applyChanges, autoLayer, lineCells, pickTile } from '../client/editor/edit-ops.js';
import { buildQuickEvent, quickKindOf, readQuickValues } from '../client/editor/quick-events.js';
import { buildDemoDungeon, buildDemoForest, buildDemoHouse, buildDemoVillage } from '../server/db/demo-map.js';
import type { DatabaseUsage } from '../shared/database.js';
import { Cmd, Priority, RouteCmd, Trigger, createPage, textCommands, type EventCommand, type GameEvent } from '../shared/events.js';
import { createMap, tileAt, type MapData, type MapInfo } from '../shared/map.js';
import type { ClientToServerEvents, EnterWorldPayload, MapChangePayload, MapUpdatedPayload, ServerToClientEvents } from '../shared/protocol.js';
import { TILE_ID_A1, TILE_ID_A2, autotileShape, plainTileId } from '../shared/tiles.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

const GRASS = TILE_ID_A2; // A2 base kind 16
const PATH = TILE_ID_A2 + 4 * 48; // A2 overlay kind 20
const WATER = TILE_ID_A1; // A1 kind 0
const TREE = plainTileId(0, 0, 3);
const FLOWER = plainTileId(0, 0, 1);

test('automatic layers: grounds on 0, overlays on 1, objects on 2 then 3', () => {
  assert.equal(autoLayer(GRASS), 0);
  assert.equal(autoLayer(WATER), 0);
  assert.equal(autoLayer(PATH), 1);
  assert.equal(autoLayer(TREE), 2);
  const map = createMap(4, 4, 1);
  const ed = new MapEditor(map);
  ed.placeTile(1, 1, GRASS);
  ed.placeTile(1, 1, PATH);
  ed.placeTile(1, 1, TREE);
  ed.placeTile(1, 1, FLOWER);
  assert.deepEqual([0, 1, 2, 3].map((z) => tileAt(map, 1, 1, z)), [GRASS, PATH, TREE, FLOWER]);
  ed.placeTile(1, 1, WATER);
  assert.equal(tileAt(map, 1, 1, 1), 0, 'a new ground removes the overlay');
  ed.placeTile(1, 1, 0);
  assert.deepEqual([tileAt(map, 1, 1, 2), tileAt(map, 1, 1, 3)], [0, 0], 'the empty tile clears objects');
});

test('painting records changes that undo and redo exactly, autotile shapes included', () => {
  const map = createMap(5, 5, 1);
  const ed = new MapEditor(map);
  ed.rectangle(0, 0, 4, 4, { tiles: [[GRASS]] });
  ed.commit();
  const snapshot = [...map.data];
  ed.rectangle(1, 1, 3, 3, { tiles: [[WATER]] });
  const changes = ed.commit();
  assert.equal(autotileShape(tileAt(map, 2, 2, 0)), 0, 'centre of the pond');
  assert.notEqual(autotileShape(tileAt(map, 1, 1, 0)), 0, 'pond corner has an edge shape');
  const painted = [...map.data];
  applyChanges(map, changes, true);
  assert.deepEqual(map.data, snapshot);
  applyChanges(map, changes, false);
  assert.deepEqual(map.data, painted);
});

test('fill stops at different tiles; eyedropper returns autotile kinds; shadows and clipboard', () => {
  const map = createMap(6, 3, 1);
  const ed = new MapEditor(map);
  ed.rectangle(0, 0, 5, 2, { tiles: [[GRASS]] });
  ed.rectangle(3, 0, 3, 2, { tiles: [[WATER]] });
  ed.commit();
  ed.fill(0, 0, { tiles: [[PATH]] });
  ed.commit();
  assert.ok(tileAt(map, 2, 1, 1) !== 0, 'overlay fill covers the grass area');
  assert.equal(tileAt(map, 4, 1, 1), 0, 'but does not cross the pond');
  assert.equal(tileAt(map, 3, 1, 1), 0, 'nor cover the water');
  assert.equal(pickTile(map, 3, 1), WATER, 'eyedropper gives the kind, not the shape');
  ed.shadow(0, 0, 3, true);
  ed.commit();
  assert.equal(tileAt(map, 0, 0, 4), 8);
  const clip = ed.copy(3, 0, 3, 2);
  ed.paste(0, 0, clip);
  ed.commit();
  assert.equal(pickTile(map, 0, 1), WATER);
});

// --- API --------------------------------------------------------------------------

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Session {
  client: TestClient;
  csrf: string;
  api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }>;
}

async function account(name: string): Promise<Session> {
  const client = new TestClient(server.url);
  await client.post('/register', {
    _csrf: await client.csrf('/register'),
    username: name,
    email: `${name.toLowerCase()}@example.com`,
    password: 'secret password',
    passwordConfirm: 'secret password',
  });
  const csrf = await client.csrf('/characters');
  return {
    client,
    csrf,
    async api<T>(method: string, path: string, body?: unknown) {
      const res = await client.request(`/api/editor${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as T };
    },
  };
}

async function enter(session: Session, name: string): Promise<{ socket: ClientSocket; payload: EnterWorldPayload }> {
  await session.client.post('/characters', { _csrf: await session.client.csrf('/characters/new'), name, classId: '1' });
  const html = await (await session.client.request('/characters')).text();
  const id = /action="\/characters\/(\d+)\/play"/.exec(html)![1]!;
  await session.client.post(`/characters/${id}/play`, { _csrf: await session.client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: session.client.cookieHeader() } });
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  return { socket, payload };
}

let admin: Session;

test('the editor API is reserved to administrators and requires the CSRF header', async () => {
  admin = await account('Admin');
  const player = await account('Player');
  assert.equal((await player.api('GET', '/bootstrap')).status, 403);
  assert.equal((await admin.api('GET', '/bootstrap')).status, 200);
  const noToken = await admin.client.request('/api/editor/maps/1/lock', { method: 'POST' });
  assert.equal(noToken.status, 403);
});

test('locks, validation, live update of players and version history', async () => {
  const second = await account('Second');
  server.ctx.accounts.setRole(server.ctx.accounts.findByUsername('Second')!.id, 'admin');
  const player = await account('Watcher');
  const { socket } = await enter(player, 'Watcher');

  assert.equal((await admin.api('POST', '/maps/1/lock')).status, 200);
  const conflict = await second.api<{ error: string; params: { name: string } }>('POST', '/maps/1/lock');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.params.name, 'Admin');

  const { body } = await admin.api<{ map: MapData }>('GET', '/maps/1');
  const bad = await admin.api<{ error: string }>('PUT', '/maps/1', { map: { ...body.map, data: [1, 2, 3] } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'error.editor.invalid_map');
  assert.equal((await second.api('PUT', '/maps/1', { map: body.map })).status, 409, 'saving needs the lock');

  const updated = new Promise<MapUpdatedPayload>((resolve) => socket.on('mapUpdated', resolve));
  const watcher = server.ctx.world.player(server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername('Watcher')!.id)[0]!.id)!;
  const epoch = watcher.epoch;
  const edited = { ...body.map, displayName: 'Village rénové' };
  assert.equal((await admin.api('PUT', '/maps/1', { map: edited })).status, 200);
  const update = await updated;
  assert.equal(update.map.displayName, 'Village rénové', 'players on the map receive the new version');
  assert.deepEqual([update.x, update.y, update.epoch], [watcher.x, watcher.y, epoch + 1], 'with their position and a new movement epoch');

  const versions = await admin.api<{ versions: { id: number }[] }>('GET', '/maps/1/versions');
  assert.ok(versions.body.versions.length >= 2, 'the first save of a seeded map also keeps its previous content');
  const oldest = versions.body.versions.at(-1)!;
  assert.notEqual(server.ctx.maps.version(1, oldest.id)?.displayName, 'Village rénové', 'and it is the content from before the edit');
  socket.close();
  await admin.api('DELETE', '/maps/1/lock');
});

test('an outdated copy of a map is refused instead of overwriting a newer save', async () => {
  const second = await account('Latecomer');
  server.ctx.accounts.setRole(server.ctx.accounts.findByUsername('Latecomer')!.id, 'admin');
  // The first administrator opens the map, then its computer sleeps: its lock expires.
  assert.equal((await admin.api('POST', '/maps/1/lock')).status, 200);
  const stale = await admin.api<{ map: MapData; version: number }>('GET', '/maps/1');
  (server.ctx.editLocks as unknown as { locks: Map<number, { expiresAt: number }> }).locks.get(1)!.expiresAt = Date.now() - 1;
  // Another one opens it, saves its work and leaves.
  assert.equal((await second.api('POST', '/maps/1/lock')).status, 200);
  const fresh = await second.api<{ map: MapData; version: number }>('GET', '/maps/1');
  const saved = await second.api<{ version: number }>('PUT', '/maps/1', { map: { ...fresh.body.map, displayName: 'Work of the second one' }, baseVersion: fresh.body.version });
  assert.equal(saved.status, 200);
  assert.ok(saved.body.version > fresh.body.version, 'each save makes a new revision');
  await second.api('DELETE', '/maps/1/lock');
  // The first one wakes up: its lock is free again, but its copy is older than the last save.
  assert.equal((await admin.api('POST', '/maps/1/lock')).status, 200);
  const late = await admin.api<{ error: string }>('PUT', '/maps/1', { map: stale.body.map, baseVersion: stale.body.version });
  assert.equal(late.status, 409);
  assert.equal(late.body.error, 'error.editor.map_conflict');
  assert.equal(server.ctx.maps.get(1)!.displayName, 'Work of the second one', 'the newer work is kept');
  // Reopened, the copy saves normally.
  const reopened = await admin.api<{ map: MapData; version: number }>('GET', '/maps/1');
  assert.equal(reopened.body.version, saved.body.version);
  assert.equal((await admin.api('PUT', '/maps/1', { map: reopened.body.map, baseVersion: reopened.body.version })).status, 200);
  await admin.api('DELETE', '/maps/1/lock');
});

test('an admin creates a map, draws it, places a teleporter, and a player goes there at once', async () => {
  const created = await admin.api<{ info: MapInfo; map: MapData }>('POST', '/maps', { name: 'Clairière', width: 12, height: 10, tilesetId: 1, parentId: 0 });
  assert.equal(created.status, 200);
  const newId = created.body.info.id;
  assert.equal(tileAt(created.body.map, 5, 5, 0) >= TILE_ID_A2, true, 'new maps start with a ground');

  // Draw a pond and a return teleporter on the new map.
  assert.equal((await admin.api('POST', `/maps/${newId}/lock`)).status, 200);
  const map = created.body.map;
  const ed = new MapEditor(map);
  ed.rectangle(7, 1, 10, 4, { tiles: [[WATER]] });
  ed.commit();
  map.events = [null, {
    id: 1, name: 'Retour', note: '', x: 5, y: 9,
    pages: [createPage({ priorityType: Priority.Below, trigger: Trigger.PlayerTouch, list: [{ code: Cmd.TransferPlayer, indent: 0, parameters: [0, 1, 20, 17, 2, 0] }, { code: 0, indent: 0, parameters: [] }] })],
  }];
  assert.equal((await admin.api('PUT', `/maps/${newId}`, { map })).status, 200);

  // Place a teleporter on the village plaza towards the new map.
  await admin.api('POST', '/maps/1/lock');
  const village = (await admin.api<{ map: MapData }>('GET', '/maps/1')).body.map;
  village.events.push({
    id: village.events.length, name: 'Vers la clairière', note: '', x: 18, y: 12,
    pages: [createPage({ priorityType: Priority.Below, trigger: Trigger.PlayerTouch, list: [{ code: Cmd.TransferPlayer, indent: 0, parameters: [0, newId, 5, 8, 8, 0] }, { code: 0, indent: 0, parameters: [] }] })],
  });
  assert.equal((await admin.api('PUT', '/maps/1', { map: village })).status, 200);

  // A player already in the village walks onto the new teleporter.
  const traveller = await account('Traveller');
  const { socket, payload } = await enter(traveller, 'Traveller');
  const p = server.ctx.world.player(payload.character.id)!;
  p.x = 18;
  p.y = 13;
  const changed = new Promise<MapChangePayload>((resolve) => socket.on('mapChange', resolve));
  socket.emit('move', 8, 0);
  const change = await changed;
  assert.equal(change.map.id, newId);
  assert.equal(change.map.displayName, 'Clairière');
  assert.deepEqual([change.x, change.y], [5, 8]);
  assert.ok(tileAt(change.map, 8, 2, 0) >= TILE_ID_A1 && tileAt(change.map, 8, 2, 0) < TILE_ID_A2, 'the drawn pond is there');
  socket.close();
});

test('maps can be deleted, except the starting map', async () => {
  const start = await admin.api<{ error: string }>('DELETE', '/maps/1');
  assert.equal(start.body.error, 'error.editor.delete_start_map');
  const tmp = await admin.api<{ info: MapInfo }>('POST', '/maps', { name: 'Temp', width: 5, height: 5, tilesetId: 1 });
  assert.equal((await admin.api('DELETE', `/maps/${tmp.body.info.id}`)).status, 200);
  assert.equal(server.ctx.maps.get(tmp.body.info.id), undefined);
});

test('a map still used elsewhere is deleted only once the editor has shown where', async () => {
  const tmp = await admin.api<{ info: MapInfo }>('POST', '/maps', { name: 'Lair', width: 5, height: 5, tilesetId: 1 });
  const id = tmp.body.info.id;
  // A raid takes place there, and the village sends players there.
  const raid = server.ctx.gameData.get('raid', 1)!;
  server.ctx.gameData.save('raid', { ...raid, id: 99, name: 'Lair raid', mapId: id });
  const villageInfo = server.ctx.maps.info(1)!;
  const village = structuredClone(server.ctx.maps.get(1)!);
  const original = structuredClone(village);
  village.events.push({ id: village.events.length, name: 'To the lair', note: '', x: 1, y: 1, pages: [createPage({ list: [{ code: Cmd.TransferPlayer, indent: 0, parameters: [0, id, 1, 1, 2, 0] }, { code: 0, indent: 0, parameters: [] }] })] });
  server.ctx.maps.save(villageInfo, village);
  try {
    const refused = await admin.api<{ error: string; usages: DatabaseUsage[] }>('DELETE', `/maps/${id}`);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error, 'error.editor.map_in_use');
    assert.ok(refused.body.usages.some((u) => u.kind === 'record' && u.type === 'raid' && u.id === 99));
    assert.ok(refused.body.usages.some((u) => u.kind === 'map' && u.id === 1 && u.events.includes('To the lair')));
    assert.ok(server.ctx.maps.get(id), 'not deleted');
    assert.equal((await admin.api('DELETE', `/maps/${id}?force=1`)).status, 200);
    assert.equal(server.ctx.maps.get(id), undefined);
  } finally {
    server.ctx.gameData.remove('raid', 99);
    server.ctx.maps.save(villageInfo, original);
  }
});

test('a map cannot be moved under a parent that does not exist (it would vanish from the tree)', async () => {
  const tmp = await admin.api<{ info: MapInfo }>('POST', '/maps', { name: 'Orphan', width: 5, height: 5, tilesetId: 1 });
  const moved = await admin.api<{ error: string }>('PATCH', `/maps/${tmp.body.info.id}/info`, { parentId: 99_999 });
  assert.equal(moved.status, 400);
  assert.equal(server.ctx.maps.info(tmp.body.info.id)!.parentId, 0);
  assert.equal((await admin.api('PATCH', `/maps/${tmp.body.info.id}/info`, { parentId: 1 })).status, 200, 'an existing parent is fine');
});

test('a new map of the type "Instance" is instanced (one copy per party), the other types are not', async () => {
  const instance = await admin.api<{ map: MapData }>('POST', '/maps', { name: 'Crypt', width: 5, height: 5, tilesetId: 1, type: 'instance' });
  assert.equal(instance.status, 200);
  assert.deepEqual([instance.body.map.mmo.type, instance.body.map.mmo.instance], ['instance', true]);
  const dungeon = await admin.api<{ map: MapData }>('POST', '/maps', { name: 'Cave', width: 5, height: 5, tilesetId: 1, type: 'dungeon' });
  assert.deepEqual([dungeon.body.map.mmo.type, dungeon.body.map.mmo.instance], ['dungeon', false]);
});

test('fast strokes paint every cell they cross', () => {
  assert.deepEqual(lineCells(0, 0, 4, 2), [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 2 }, { x: 4, y: 2 }]);
  assert.deepEqual(lineCells(3, 3, 3, 0).map((c) => c.y), [3, 2, 1, 0]);
  assert.deepEqual(lineCells(2, 5, 2, 5), [{ x: 2, y: 5 }]);
  // Every step moves to a touching cell: no gap in the stroke.
  const path = lineCells(-3, 7, 9, -4);
  assert.deepEqual(path.at(-1), { x: 9, y: -4 });
  for (let i = 1; i < path.length; i++) assert.ok(Math.abs(path[i]!.x - path[i - 1]!.x) <= 1 && Math.abs(path[i]!.y - path[i - 1]!.y) <= 1);
});

/** Builds an event the way the quick form does for a new one. */
function quickEvent(kind: 'npc' | 'sign' | 'teleport' | 'chest', change: (v: ReturnType<typeof readQuickValues>) => void = () => undefined): GameEvent {
  const values = readQuickValues(null, { mapId: 2, itemId: 1 });
  change(values);
  return buildQuickEvent(kind, values, { id: 1, name: 'EV001', note: '', x: 3, y: 4 }, null, 'Empty.');
}

test('quick forms: events they create are recognised again, and edited with the same form', () => {
  const npc = quickEvent('npc', (v) => (v.text = 'Hello!\n\nSecond message'));
  assert.equal(quickKindOf(npc), 'npc');
  assert.equal(quickKindOf(quickEvent('sign', (v) => (v.text = 'Village of Brindiwanko'))), 'sign');
  assert.equal(quickKindOf(quickEvent('teleport', (v) => Object.assign(v, { destX: 5, destY: 6, destDir: 8 }))), 'teleport');
  assert.equal(quickKindOf(quickEvent('chest', (v) => Object.assign(v, { chestCount: 3, chestGold: 50 }))), 'chest');
  // The simple events of the demo maps (a character, a sign, teleporters, a chest) stay quick to edit.
  const kinds = [buildDemoVillage(), buildDemoForest(), buildDemoDungeon(), buildDemoHouse()].flatMap((m) => m.events.filter((e): e is GameEvent => e !== null).map(quickKindOf));
  for (const kind of ['npc', 'sign', 'teleport', 'chest']) assert.ok(kinds.includes(kind as never), `${kind} among the demo events: ${kinds.join(', ')}`);
});

test('quick forms keep the settings they do not show (trigger, movement, conditions, options)', () => {
  // A character made with the quick form, then turned in the full editor into one that walks to the player and talks on contact.
  const npc = quickEvent('npc', (v) => (v.text = 'I follow you!'));
  const page = npc.pages[0]!;
  Object.assign(page, { trigger: Trigger.EventTouch, moveType: 2, moveSpeed: 5, moveFrequency: 4, through: true, directionFix: true, priorityType: Priority.Above });
  page.conditions.switch1Valid = true;
  page.conditions.switch1Id = 7;
  page.image.pattern = 0;
  assert.equal(quickKindOf(npc), 'npc', 'still a character with a dialogue');
  // The form opens on it and only the text and the look are changed.
  const values = readQuickValues(npc, { mapId: 1, itemId: 1 });
  assert.equal(values.text, 'I follow you!');
  values.text = 'I follow you everywhere!';
  values.sheetIndex = 2;
  const edited = buildQuickEvent('npc', values, npc, npc.pages, 'Empty.').pages[0]!;
  assert.equal(edited.trigger, Trigger.EventTouch);
  assert.deepEqual([edited.moveType, edited.moveSpeed, edited.moveFrequency, edited.through, edited.directionFix, edited.priorityType], [2, 5, 4, true, true, Priority.Above]);
  assert.deepEqual([edited.conditions.switch1Valid, edited.conditions.switch1Id], [true, 7]);
  assert.deepEqual([edited.image.characterIndex, edited.image.pattern], [2, 0]);
  assert.equal(edited.list[1]!.parameters[0], 'I follow you everywhere!');
  // Nothing was changed: the event is rebuilt exactly as it was.
  assert.deepEqual(buildQuickEvent('npc', readQuickValues(npc, { mapId: 1, itemId: 1 }), npc, npc.pages, 'Empty.').pages, npc.pages);
  // A chest drawn with its own image and closed by a condition keeps them too.
  const chest = quickEvent('chest');
  chest.pages[0]!.image.characterName = '!Chest';
  chest.pages[1]!.image.characterName = '!Chest';
  chest.pages[0]!.conditions.levelValid = true;
  assert.equal(quickKindOf(chest), 'chest');
  const reopened = buildQuickEvent('chest', { ...readQuickValues(chest, { mapId: 1, itemId: 1 }), chestGold: 10 }, chest, chest.pages, 'Empty.');
  assert.deepEqual(reopened.pages.map((p) => p.image.characterName), ['!Chest', '!Chest']);
  assert.equal(reopened.pages[0]!.conditions.levelValid, true);
  // Choosing another kind in the form starts from that kind's defaults.
  assert.equal(buildQuickEvent('sign', values, npc, null, 'Empty.').pages[0]!.trigger, Trigger.Action);
});

test('events holding more than a quick form can show open in the full editor', () => {
  const twoFaces = quickEvent('npc', (v) => (v.text = 'Hello.\n\nGoodbye.'));
  twoFaces.pages[0]!.list[0]!.parameters[0] = 'Actor1';
  assert.equal(quickKindOf(twoFaces), 'json', 'one face per message');
  const onTop = quickEvent('npc', (v) => (v.text = 'Look up!'));
  onTop.pages[0]!.list[0]!.parameters[3] = 0;
  assert.equal(quickKindOf(onTop), 'json', 'message shown at the top of the screen');
  const longMessage = quickEvent('sign');
  longMessage.pages[0]!.list = [...textCommands(['1', '2', '3', '4', '5', '6']), { code: Cmd.End, indent: 0, parameters: [] }];
  assert.equal(quickKindOf(longMessage), 'json', 'a message of six lines would be cut in two');
  const fromVariables = quickEvent('teleport');
  fromVariables.pages[0]!.list[0]!.parameters[0] = 1;
  assert.equal(quickKindOf(fromVariables), 'json', 'destination read from variables');
  const twoItems = quickEvent('chest');
  twoItems.pages[0]!.list.splice(1, 0, { code: Cmd.ChangeItems, indent: 0, parameters: [2, 0, 0, 1] });
  assert.equal(quickKindOf(twoItems), 'json', 'two items in one chest');
  const otherSwitch = quickEvent('chest');
  const close = otherSwitch.pages[0]!.list.find((c: EventCommand) => c.code === Cmd.ControlSelfSwitch)!;
  close.parameters[0] = 'B';
  otherSwitch.pages[1]!.conditions.selfSwitchCh = 'B';
  assert.equal(quickKindOf(otherSwitch), 'json', 'a chest closed with self switch B');
  const moving = quickEvent('npc', (v) => (v.text = 'Hi'));
  moving.pages[0]!.list.splice(0, 0, { code: Cmd.SetMoveRoute, indent: 0, parameters: [0, { list: [{ code: RouteCmd.MoveToward }, { code: 0 }], repeat: false, skippable: false, wait: true }] });
  assert.equal(quickKindOf(moving), 'json', 'any other command');
});

test('event command list: a click moves the highlight without rebuilding the rows, so a double click reaches them', async (t) => {
  // A minimal DOM: enough for the command list to build its rows.
  class Node extends EventTarget {
    className = '';
    textContent = '';
    title = '';
    style: Record<string, string> = {};
    children: Node[] = [];
    private readonly attributes = new Map<string, string>();
    readonly classList = {
      contains: (name: string) => this.className.split(' ').includes(name),
      toggle: (name: string, on: boolean) => {
        const names = this.className.split(' ').filter((n) => n && n !== name);
        this.className = (on ? [...names, name] : names).join(' ');
      },
    };
    setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
    getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
    append(...nodes: Node[]): void { this.children.push(...nodes); }
    replaceChildren(...nodes: Node[]): void { this.children = nodes; }
    querySelector(): null { return null; }
    scrollIntoView(): void {}
    focus(): void {}
  }
  const before = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: { createElement: () => new Node(), getElementById: () => null, addEventListener() {}, removeEventListener() {} } });
  t.after(() => (before ? Object.defineProperty(globalThis, 'document', before) : Reflect.deleteProperty(globalThis, 'document')));
  const { CommandListEditor } = await import('../client/editor/event-editor.js');
  const none = { switches: [], variables: [], items: [], weapons: [], armors: [], commonEvents: [], animations: [], quests: [], enemies: [], maps: [], events: [], mapId: 1 };
  const lookups = { ...none, host: new Node(), resources: { characters: [], faces: [], parallaxes: [], bgm: [], bgs: [], me: [], pictures: [], animations: [], se: [] }, pickCell: async () => null, editRoute: async () => null };
  const editor = new CommandListEditor(lookups as never, [...textCommands(['Hello']), { code: Cmd.End, indent: 0, parameters: [] }]);
  const rows = (editor.element as unknown as Node).children.find((n) => n.className === 'cmd-list')!;
  const shown = [...rows.children];
  assert.equal(shown.length, 3, 'message, its line, empty row');
  const opened: string[] = [];
  editor.insert = () => void opened.push('insert');
  editor.edit = () => void opened.push('edit');
  const sameRows = () => rows.children.length === shown.length && rows.children.every((row, i) => row === shown[i]);
  // First click of a double click on the message's line: the whole message is highlighted, the rows stay the same nodes.
  shown[1]!.dispatchEvent(new Event('mousedown'));
  assert.ok(sameRows(), 'the rows were not rebuilt');
  assert.deepEqual(shown.map((r) => r.classList.contains('selected')), [true, true, false]);
  shown[1]!.dispatchEvent(new Event('dblclick'));
  shown[2]!.dispatchEvent(new Event('mousedown'));
  assert.ok(sameRows(), 'the rows were not rebuilt');
  assert.deepEqual(shown.map((r) => r.getAttribute('aria-selected')), ['false', 'false', 'true']);
  shown[2]!.dispatchEvent(new Event('dblclick'));
  assert.deepEqual(opened, ['edit', 'insert'], 'double click edits a command, or inserts one on the empty row');
});
