/**
 * @file Event system tests: command list structure (blocks, branches,
 * choices), the interpreter on its own, the script sandbox, the database of
 * switch scopes, and the step criterion over sockets: an NPC whose dialogue
 * changes after a quest and a chest that each character opens only once,
 * while a global variable is shared by everybody.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { blockRange, checkStructure, dropsCommands, ifBlock, insertBlock, removeBlock, updateChoices, updateIf } from '../shared/command-blocks.js';
import { refreshAllAutotiles } from '../shared/autotile-shapes.js';
import { BranchType, Cmd, Priority, RouteCmd, Trigger, createPage, type EventCommand, type EventPage, type GameEvent } from '../shared/events.js';
import { createMap } from '../shared/map.js';
import { validateMap } from '../shared/map-validation.js';
import { TILE_ID_A2 } from '../shared/tiles.js';
import type { EventView } from '../shared/events.js';
import type { ClientToServerEvents, EffectPayload, EnterWorldPayload, MessagePayload, ServerToClientEvents } from '../shared/protocol.js';
import { buildDemoVillage } from '../server/db/demo-map.js';
import { runCommands, type InterpreterHost } from '../server/events/interpreter.js';
import { POOL_SIZE, evaluateScript, runScript, stopSandbox, type ScriptState } from '../server/events/sandbox.js';
import type { PlayerSession } from '../server/game/world.js';
import { startTestServer, TestClient, type TestServer } from './helpers/server.js';

const c = (code: number, parameters: unknown[] = [], indent = 0): EventCommand => ({ code, indent, parameters });

test('command blocks: ranges, insertion, removal and editing of branches and choices', () => {
  const list: EventCommand[] = [
    c(Cmd.ShowText, ['', 0, 0, 2, '']), c(Cmd.TextLine, ['a']), c(Cmd.TextLine, ['b']),
    ...ifBlock([BranchType.Switch, 1, 0], true),
    c(Cmd.End),
  ];
  assert.deepEqual(blockRange(list, 2), [0, 3], 'a text line belongs to its message');
  assert.deepEqual(blockRange(list, 5), [3, 8], 'the else row belongs to its branch');
  assert.deepEqual(blockRange(list, 6), [6, 7], 'an empty body row is a block of its own');
  // Insert a command inside the "then" body (before its empty row, at its indentation).
  insertBlock(list, 4, [c(Cmd.ControlSwitches, [2, 2, 0])]);
  assert.equal(list[4]!.indent, 1);
  assert.equal(checkStructure(list), null);
  // Removing the else branch keeps the body of the condition.
  updateIf(list, 3, [BranchType.Switch, 1, 1], false);
  assert.deepEqual(list.slice(3).map((x) => x.code), [Cmd.If, Cmd.ControlSwitches, Cmd.End, Cmd.IfEnd, Cmd.End]);
  assert.deepEqual(list[3]!.parameters, [BranchType.Switch, 1, 1]);
  // Choices: a third choice gets an empty branch, existing branch bodies are kept.
  const choices: EventCommand[] = [c(Cmd.ShowChoices, [['Yes', 'No'], 1, 0, 2, 0]), c(Cmd.When, [0, 'Yes']), c(Cmd.Wait, [5], 1), c(Cmd.End, [], 1), c(Cmd.When, [1, 'No']), c(Cmd.End, [], 1), c(Cmd.ChoicesEnd), c(Cmd.End)];
  updateChoices(choices, 0, [['Yes', 'No', 'Maybe'], -2, 0, 2, 0]);
  assert.deepEqual(choices.map((x) => x.code), [102, 402, 230, 0, 402, 0, 402, 0, 403, 0, 404, 0]);
  assert.equal(checkStructure(choices), null);
  assert.equal(removeBlock(choices, 5).length, 0, 'an empty row cannot be removed');
  assert.equal(removeBlock(choices, 4).length, 11, 'removing any row of the choices removes the whole block');
  assert.equal(checkStructure([c(Cmd.If, [0, 1, 0]), c(Cmd.End, [], 1), c(Cmd.End)]), 0, 'unclosed branch');
});

test('command blocks: the editor knows when removing an "else" branch or choices would drop commands', () => {
  /** The list once changed by `change`, the original being left as it is. */
  const changed = (list: EventCommand[], change: (copy: EventCommand[]) => void) => {
    const copy = structuredClone(list);
    change(copy);
    return copy;
  };
  // A condition whose "else" branch is empty, then holds a message.
  const emptyElse = [...ifBlock([BranchType.Switch, 1, 0], true), c(Cmd.End)];
  assert.equal(dropsCommands(emptyElse, changed(emptyElse, (l) => updateIf(l, 0, [BranchType.Switch, 1, 0], false))), false, 'an empty "else" goes without asking');
  const writtenElse = structuredClone(emptyElse);
  insertBlock(writtenElse, 3, [c(Cmd.ShowText, ['', 0, 0, 2, ''], 0), c(Cmd.TextLine, ['Else'], 0)]);
  assert.equal(dropsCommands(writtenElse, changed(writtenElse, (l) => updateIf(l, 0, [BranchType.Switch, 1, 0], false))), true, 'an "else" holding a message');
  assert.equal(dropsCommands(writtenElse, changed(writtenElse, (l) => updateIf(l, 0, [BranchType.Switch, 2, 1], true))), false, 'changing only the condition');
  // Choices: removing an empty choice is fine, removing one with commands (or the cancel branch holding some) is asked.
  const choices: EventCommand[] = [c(Cmd.ShowChoices, [['A', 'B', 'C'], -2, 0, 2, 0]), c(Cmd.When, [0, 'A']), c(Cmd.End, [], 1), c(Cmd.When, [1, 'B']), c(Cmd.End, [], 1), c(Cmd.When, [2, 'C']), c(Cmd.Wait, [5], 1), c(Cmd.End, [], 1), c(Cmd.WhenCancel, [6, null]), c(Cmd.End, [], 1), c(Cmd.ChoicesEnd), c(Cmd.End)];
  assert.equal(dropsCommands(choices, changed(choices, (l) => updateChoices(l, 0, [['A', 'B', 'C', 'D'], -2, 0, 2, 0]))), false, 'adding a choice');
  assert.equal(dropsCommands(choices, changed(choices, (l) => updateChoices(l, 0, [['A', 'B', 'C'], 1, 0, 2, 0]))), false, 'removing an empty cancel branch');
  assert.equal(dropsCommands(choices, changed(choices, (l) => updateChoices(l, 0, [['A', 'B'], -2, 0, 2, 0]))), true, 'removing the third choice, which waits');
  assert.equal(dropsCommands(choices, changed(choices, (l) => updateChoices(l, 0, [['A', 'B', 'Sea'], -2, 0, 2, 0]))), false, 'renaming a choice');
});

test('the demo village is valid and its event lists are well formed', () => {
  const village = buildDemoVillage();
  assert.equal(validateMap(village, () => true), null);
  for (const e of village.events) for (const page of e?.pages ?? []) assert.equal(checkStructure(page.list), null, `${e!.name}`);
});

/** Interpreter host keeping switches and variables in memory. */
function fakeHost(answers: number[] = []): InterpreterHost & { switches: Set<number>; variables: Map<number, number>; shown: MessagePayload[]; effects: EffectPayload[]; located: unknown[] } {
  const switches = new Set<number>();
  const variables = new Map<number, number>();
  const shown: MessagePayload[] = [];
  const effects: EffectPayload[] = [];
  const located: unknown[] = [];
  let timerSeconds: number | null = null;
  const noop = () => undefined;
  const resolved = () => Promise.resolve();
  return {
    switches, variables, shown, effects, located,
    effect: (e) => void effects.push(e),
    setTimer: (seconds) => void (timerSeconds = seconds),
    timer: () => timerSeconds,
    setEventLocation: (target, cell, direction) => void located.push([target, cell, direction]),
    locationInfo: (info, x, y) => info * 100 + x * 10 + y,
    isActive: () => true,
    showMessage: async (m) => (shown.push(m), answers.shift() ?? 0),
    playerName: () => 'Alice', currencyName: () => 'G',
    getSwitch: (id) => switches.has(id), setSwitch: (id, on) => void (on ? switches.add(id) : switches.delete(id)),
    getVariable: (id) => variables.get(id) ?? 0, setVariable: (id, v) => void variables.set(id, v),
    getSelfSwitch: () => false, setSelfSwitch: noop,
    gold: () => 100, level: () => 3, exp: () => 0, vitals: () => ({ hp: 10, mp: 5 }), itemCount: () => 0, mapId: () => 1,
    characterState: () => ({ x: 1, y: 2, direction: 2 }), questStatus: () => ({ status: 0, step: 0 }),
    changeGold: noop, changeItems: noop, changeHp: noop, changeMp: noop, recoverAll: noop, changeExp: noop, changeLevel: noop, changeEquipment: noop,
    transfer: () => true, moveRoute: resolved, waitForMovement: resolved, showAnimation: resolved, showBalloon: resolved, eraseEvent: noop, playSe: noop,
    wait: resolved, notify: noop, quest: noop, screen: resolved, setRespawn: noop, bank: resolved, inn: resolved, shop: resolved, battle: resolved,
    commonEvent: (id) => (id === 1 ? [c(Cmd.ControlVariables, [3, 3, 0, 0, 42]), c(Cmd.End)] : null),
    runScript: (code) => runScript(code, { variables: Object.fromEntries(variables), switches: {}, selfSwitches: {}, gold: 100, level: 3, items: {}, player: { name: 'Alice', mapId: 1, x: 0, y: 0 } }),
    evaluate: (e) => evaluateScript(e, { variables: Object.fromEntries(variables), switches: {}, selfSwitches: {}, gold: 100, level: 3, items: {}, player: { name: 'Alice', mapId: 1, x: 0, y: 0 } }),
  };
}

test('music, pictures, weather, timer, event location and cell information commands', async () => {
  const host = fakeHost();
  host.variables.set(7, 4);
  await runCommands([
    c(Cmd.PlayBgm, [{ name: 'Field', volume: 80, pitch: 100, pan: 0 }]),
    c(Cmd.PlayMe, [{ name: 'Fanfare', volume: 200, pitch: 10 }]),
    c(Cmd.FadeoutBgs, [3]),
    c(Cmd.SaveBgm),
    c(Cmd.ShowPicture, [2, 'Title', 1, 1, 7, 7, 50, 50, 255, 1]),
    c(Cmd.MovePicture, [2, 0, 0, 0, 10, 20, 100, 100, 128, 0, 30, true, 2]),
    c(Cmd.ShowPicture, [500, 'Out of range', 0, 0, 0, 0, 100, 100, 255, 0]),
    c(Cmd.SetWeather, ['snow', 12, 0, false]),
    c(Cmd.ControlTimer, [0, 90]),
    c(Cmd.If, [BranchType.Timer, 60, 0]),
    c(Cmd.ControlSwitches, [1, 1, 0], 1),
    c(Cmd.End, [], 1),
    c(Cmd.IfEnd),
    c(Cmd.SetEventLocation, [3, 1, 7, 7, 8]),
    c(Cmd.SetEventLocation, [3, 2, 5, 0, 0]),
    c(Cmd.GetLocationInfo, [9, 6, 0, 1, 2]),
    c(Cmd.ScrollMap, [6, 3, 4, false]),
    c(Cmd.ChangeTransparency, [0]),
    c(Cmd.End),
  ], host);
  const kinds = host.effects.map((e) => e.kind);
  assert.deepEqual(kinds, ['music', 'music', 'musicFade', 'musicMemory', 'picture', 'movePicture', 'weather', 'scrollMap', 'transparent'], 'a picture number out of range is ignored');
  assert.deepEqual(host.effects[0], { kind: 'music', channel: 'bgm', name: 'Field', volume: 80, pitch: 100 });
  assert.deepEqual(host.effects[1], { kind: 'music', channel: 'me', name: 'Fanfare', volume: 100, pitch: 50 }, 'volume and pitch are bounded');
  assert.deepEqual(host.effects[2], { kind: 'musicFade', channel: 'bgs', ms: 3000 });
  assert.equal((host.effects[4] as { x: number }).x, 4, 'a picture placed from variables');
  assert.equal((host.effects[6] as { power: number }).power, 9);
  assert.equal(host.switches.has(1), true, 'the timer condition holds (90 s ≥ 60 s)');
  assert.deepEqual(host.located, [[3, { x: 4, y: 4 }, 8], [3, { swapWith: 5 }, 0]]);
  assert.equal(host.variables.get(9), 612, 'cell information goes to the variable');
});

test('the interpreter runs loops, branches, labels, choices, number input, common events and scripts', async () => {
  const host = fakeHost([1, 1234]);
  await runCommands([
    c(Cmd.ControlVariables, [1, 1, 0, 0, 0]),
    c(Cmd.Loop),
    c(Cmd.ControlVariables, [1, 1, 1, 0, 1], 1),
    c(Cmd.If, [BranchType.Variable, 1, 0, 5, 1], 1),
    c(Cmd.BreakLoop, [], 2),
    c(Cmd.End, [], 2),
    c(Cmd.IfEnd, [], 1),
    c(Cmd.End, [], 1),
    c(Cmd.LoopEnd),
    c(Cmd.JumpToLabel, ['skip']),
    c(Cmd.ControlSwitches, [9, 9, 0]),
    c(Cmd.Label, ['skip']),
    c(Cmd.ShowText, ['', 0, 0, 2, '']),
    c(Cmd.TextLine, ['Hello \\P, v1 = \\V[1]']),
    c(Cmd.ShowChoices, [['A', 'B'], -2, 0, 2, 0]),
    c(Cmd.When, [0, 'A']),
    c(Cmd.ControlSwitches, [2, 2, 0], 1),
    c(Cmd.End, [], 1),
    c(Cmd.When, [1, 'B']),
    c(Cmd.ControlSwitches, [3, 3, 0], 1),
    c(Cmd.End, [], 1),
    c(Cmd.WhenCancel, [6, null]),
    c(Cmd.End, [], 1),
    c(Cmd.ChoicesEnd),
    c(Cmd.InputNumber, [4, 3]),
    c(Cmd.CommonEvent, [1]),
    c(Cmd.If, [BranchType.Level, 3, 1]),
    c(Cmd.ControlSwitches, [5, 5, 0], 1),
    c(Cmd.End, [], 1),
    c(Cmd.Else),
    c(Cmd.ControlSwitches, [6, 6, 0], 1),
    c(Cmd.End, [], 1),
    c(Cmd.IfEnd),
    c(Cmd.Script, ['setV(5, v(1) * 2);']),
    c(Cmd.ScriptLine, ['if (level() === 3) setS(7, true);']),
    c(Cmd.ControlVariables, [6, 6, 0, 2, 3, 3]),
    c(Cmd.End),
  ], host);
  assert.equal(host.variables.get(1), 5, 'loop stopped by the break');
  assert.equal(host.switches.has(9), false, 'jumped over');
  assert.equal(host.shown[0]!.text, 'Hello Alice, v1 = 5');
  assert.deepEqual(host.shown[0]!.choices, ['A', 'B'], 'choices shown with the message');
  assert.deepEqual([host.switches.has(2), host.switches.has(3)], [false, true], 'second choice taken');
  assert.equal(host.variables.get(4), 999, 'number input clamped to its digits');
  assert.equal(host.variables.get(3), 42, 'common event called');
  assert.deepEqual([host.switches.has(5), host.switches.has(6)], [true, false]);
  assert.equal(host.variables.get(5), 10);
  assert.equal(host.switches.has(7), true);
  assert.equal(host.variables.get(6), 3, 'random between 3 and 3');
});

test('a runaway loop without any pause is stopped', async () => {
  const host = fakeHost();
  const started = Date.now();
  await runCommands([c(Cmd.Loop), c(Cmd.ControlVariables, [1, 1, 1, 0, 1], 1), c(Cmd.End, [], 1), c(Cmd.LoopEnd), c(Cmd.End)], host);
  assert.ok(Date.now() - started < 2000);
  assert.ok((host.variables.get(1) ?? 0) < 10_000);
});

test('a repeating move route never blocks the interpreter even when wait is set', async () => {
  const host = {
    ...fakeHost(),
    moveRoute: () => new Promise<void>(() => {}), // never resolves when repeating
  };
  await runCommands([
    c(Cmd.SetMoveRoute, [0, { list: [{ code: 1, parameters: [] }, { code: 0, parameters: [] }], repeat: true, skippable: true, wait: true }]),
    c(Cmd.ControlVariables, [1, 1, 0, 0, 99]),
    c(Cmd.End),
  ], host);
  assert.equal(host.variables.get(1), 99, 'execution continues without waiting forever on a repeating route');
});

test('scripts run in a sandbox: no host objects, no code generation, bounded time', async () => {
  const state: ScriptState = { variables: { 1: 4 }, switches: {}, selfSwitches: {}, gold: 7, level: 2, items: { 3: 1 }, player: { name: 'Bob', mapId: 1, x: 2, y: 3 } };
  assert.deepEqual(await runScript('setV(2, v(1) + gold()); notify(player.name);', state), [{ op: 'variable', id: 2, value: 11 }, { op: 'notify', text: 'Bob' }]);
  assert.equal(await evaluateScript('item(3) > 0 && level() === 2', state), true);
  assert.deepEqual(await runScript("const p = setV.constructor.constructor('return process')(); setV(1, p ? 1 : 0);", state), [], 'Function constructor is disabled');
  assert.deepEqual(await runScript('setV(1, typeof process === "undefined" && typeof require === "undefined" ? 1 : 0);', state), [{ op: 'variable', id: 1, value: 1 }]);
  const started = Date.now();
  assert.deepEqual(await runScript('while (true) {}', state), []);
  assert.ok(Date.now() - started < 1000, 'infinite loops are interrupted');
  assert.equal(await evaluateScript('this is not javascript', state), undefined);
});

test('scripts cannot freeze or exhaust the server: promise chains and memory bombs are stopped', { timeout: 15_000 }, async () => {
  const state: ScriptState = { variables: {}, switches: {}, selfSwitches: {}, gold: 0, level: 1, items: {}, player: { name: 'Bob', mapId: 1, x: 0, y: 0 } };
  const started = Date.now();
  assert.deepEqual(await runScript('Promise.resolve().then(function f() { Promise.resolve().then(f); });', state), []);
  assert.ok(Date.now() - started < 1000);
  // The server's event loop still turns (it would never reach this point with the chain running).
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await runScript('let a = "x"; while (true) a += a;', state), []);
  assert.deepEqual(await runScript('const a = []; while (true) a.push(new Array(1e5).fill(1));', state), []);
  // Buffers take memory outside the heap, which the cap does not count: scripts have none.
  const buffers = ['ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'WebAssembly', 'Uint8Array', 'Float64Array', 'BigInt64Array'];
  assert.deepEqual(await runScript(`setV(1, [${buffers.map((b) => `typeof ${b}`).join(', ')}].filter((t) => t !== 'undefined').length);`, state), [{ op: 'variable', id: 1, value: 0 }]);
  assert.deepEqual(await runScript('const a = []; while (true) a.push(new ArrayBuffer(1 << 28));', state), []);
  // Later scripts still run normally.
  assert.deepEqual(await runScript('setV(1, 2);', state), [{ op: 'variable', id: 1, value: 2 }]);
});

test('the game keeps running while a script runs; a stopped sandbox restarts on demand', { timeout: 15_000 }, async () => {
  const state: ScriptState = { variables: {}, switches: {}, selfSwitches: {}, gold: 0, level: 1, items: {}, player: { name: 'Bob', mapId: 1, x: 0, y: 0 } };
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  try {
    assert.deepEqual(await runScript('const end = Date.now() + 40; while (Date.now() < end) {} setV(1, 1);', state), [{ op: 'variable', id: 1, value: 1 }]);
    assert.ok(ticks >= 2, `the server ticked ${ticks} times during a 40 ms script`);
  } finally {
    clearInterval(timer);
  }
  stopSandbox();
  assert.deepEqual(await runScript('setV(1, 3);', state), [{ op: 'variable', id: 1, value: 3 }], 'a new sandbox starts on demand');
});

test('scripts of many players run side by side, each with its own answer', { timeout: 15_000 }, async () => {
  const state = (n: number): ScriptState => ({ variables: { 1: n }, switches: {}, selfSwitches: {}, gold: 0, level: 1, items: {}, player: { name: `P${n}`, mapId: 1, x: 0, y: 0 } });
  const answers = await Promise.all(Array.from({ length: 4 * POOL_SIZE + 3 }, (_, n) => evaluateScript('v(1) * 2', state(n))));
  assert.deepEqual(answers, answers.map((_, n) => n * 2));
  // One script that never ends does not stop those running next to it.
  const [stuck, fine] = await Promise.all([runScript('while (true) {}', state(1)), runScript('setV(2, v(1) + 1);', state(5))]);
  assert.deepEqual(stuck, []);
  assert.deepEqual(fine, [{ op: 'variable', id: 2, value: 6 }]);
});

test('event commands that wait for nothing cannot freeze the server', { timeout: 30_000 }, async () => {
  // Each of these "waits" resolves at once when there is nothing to wait for; in a
  // loop they used to keep the event loop busy forever (no timer, socket or save).
  const bodies: EventCommand[] = [
    c(Cmd.WaitForMovement, [], 1),
    c(Cmd.CommonEvent, [2], 1),
    c(Cmd.ShowBalloon, [99, 1, true], 1),
    c(Cmd.ShowAnimation, [99, 1, true], 1),
    c(Cmd.BattleProcessing, [0, 1], 1),
    c(1020, [100], 1),
  ];
  for (const body of bodies) {
    const host = { ...fakeHost(), commonEvent: () => [c(Cmd.Comment, ['empty']), c(Cmd.End)] };
    // Longest time the event loop could not run a timer while the loop was running.
    let last = performance.now();
    let longest = 0;
    const beat = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 1);
    const started = Date.now();
    await runCommands([c(Cmd.Loop), body, c(Cmd.LoopEnd), c(Cmd.End)], host);
    longest = Math.max(longest, performance.now() - last);
    clearInterval(beat);
    assert.ok(Date.now() - started < 10_000, `command ${body.code}: the loop is stopped`);
    assert.ok(longest < 250, `command ${body.code}: the server was blocked for ${Math.round(longest)} ms`);
  }
});

// --- Criterion over sockets ----------------------------------------------------

let server: TestServer;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** A connected player driven by the test. */
interface Player {
  socket: ClientSocket;
  client: TestClient;
  session: PlayerSession;
  messages: MessagePayload[];
  answers: number[];
  notes: string[];
  /** Active page of each event as last told by the server (-1 = not shown). */
  pages: Map<number, number>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout');
    await wait(10);
  }
}

async function connectPlayer(client: TestClient, characterId: number): Promise<Player> {
  await client.post(`/characters/${characterId}/play`, { _csrf: await client.csrf('/characters') });
  const socket: ClientSocket = connect(server.url, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: client.cookieHeader() } });
  const player = { socket, client, messages: [], answers: [], notes: [], pages: new Map() } as unknown as Player;
  const track = (views: EventView[]) => views.forEach((v) => player.pages.set(v.id, v.page));
  socket.on('showMessage', (m, ack) => {
    player.messages.push(m);
    ack(player.answers.shift() ?? 0);
  });
  socket.on('notify', (n) => player.notes.push(n.key));
  socket.on('eventsChanged', ({ views, removed }) => {
    track(views);
    removed.forEach((id) => player.pages.set(id, -1));
  });
  const payload = await new Promise<EnterWorldPayload>((resolve, reject) => {
    socket.on('enterWorld', resolve);
    socket.on('connect_error', reject);
  });
  track(payload.events);
  player.session = server.ctx.world.player(payload.character.id)!;
  return player;
}

async function newPlayer(name: string): Promise<Player> {
  const client = new TestClient(server.url);
  await client.post('/register', { _csrf: await client.csrf('/register'), username: name, email: `${name.toLowerCase()}@example.com`, password: 'secret password', passwordConfirm: 'secret password' });
  await client.post('/characters', { _csrf: await client.csrf('/characters/new'), name: `${name}Hero`, classId: '1' });
  const id = server.ctx.characters.listByAccount(server.ctx.accounts.findByUsername(name)!.id)[0]!.id;
  return connectPlayer(client, id);
}

/** Id of a village event by name. */
function eventId(name: string): number {
  return (server.ctx.maps.get(1)!.events.find((e) => e?.name === name) as GameEvent).id;
}

/** Stands in front of an event (below it, facing up) and presses Action; waits for the run to end. */
async function actOn(player: Player, name: string): Promise<void> {
  const def = server.ctx.maps.get(1)!.events.find((e) => e?.name === name)!;
  const p = player.session;
  p.x = def.x;
  p.y = def.y + 1;
  p.direction = 8;
  server.ctx.world.action(p);
  await wait(30);
  await until(() => !p.busy);
  await wait(30);
}

test('criterion: a chest opens once per character, an NPC talks differently after a quest, a global counter is shared', async () => {
  const alice = await newPlayer('Alice');
  const bob = await newPlayer('Bob');
  const chest = eventId('Coffre');
  const lina = eventId('Lina');
  const box = eventId('Coffret de Lina');
  assert.equal(alice.pages.get(chest), 0);
  assert.equal(bob.pages.get(box), 0, 'the lost box is not visible without the quest');

  // The chest: Alice opens it, it stays open for her only.
  await actOn(alice, 'Coffre');
  assert.equal(server.ctx.inventory.quantity(alice.session.characterId, 'item', 1), 2);
  await until(() => alice.pages.get(chest) === 1);
  await actOn(alice, 'Coffre');
  assert.equal(server.ctx.inventory.quantity(alice.session.characterId, 'item', 1), 2, 'nothing more the second time');
  assert.equal(alice.messages.at(-1)!.text, 'Le coffre est vide.');
  assert.equal(bob.pages.get(chest), 0, 'still closed for Bob');
  await actOn(bob, 'Coffre');
  assert.equal(server.ctx.inventory.quantity(bob.session.characterId, 'item', 1), 2, 'Bob opens his own');

  // Lina's quest, for Alice only.
  alice.answers.push(0, 0); // First message then "Bien sûr !"
  await actOn(alice, 'Lina');
  assert.deepEqual(alice.messages.find((m) => m.choices)?.choices, ['Bien sûr !', 'Pas maintenant']);
  assert.ok(alice.notes.includes('notify.quest_started'));
  await until(() => alice.pages.get(lina) === 1 && alice.pages.get(box) === 1);
  assert.equal(bob.pages.get(lina), 0, 'Bob still sees the first page');
  assert.equal(bob.pages.get(box), 0);
  const count = alice.messages.length;
  await actOn(alice, 'Lina');
  assert.match(alice.messages[count]!.text, /Tu as trouvé mon coffret/);

  await actOn(alice, 'Coffret de Lina');
  await until(() => alice.pages.get(box) === 2 && alice.pages.get(lina) === 2);
  const gold = server.ctx.inventory.gold(alice.session.characterId);
  await actOn(alice, 'Lina');
  assert.equal(server.ctx.inventory.gold(alice.session.characterId), gold + 50);
  assert.ok(alice.notes.includes('notify.quest_completed'));
  await until(() => alice.pages.get(lina) === 3);
  await actOn(alice, 'Lina');
  assert.match(alice.messages.at(-1)!.text, /Merci encore pour mon coffret, AliceHero/);
  assert.equal(bob.pages.get(lina), 0, 'Bob has not started the quest');

  // The visitors' book: a global variable, a personal self switch.
  alice.answers.push(0, 0);
  await actOn(alice, 'Registre');
  bob.answers.push(0, 0);
  await actOn(bob, 'Registre');
  assert.match(bob.messages.at(-1)!.text, /visiteur n° 2/);
  assert.equal(server.ctx.world.global.variables.get(1), 2);
  await actOn(alice, 'Registre');
  assert.match(alice.messages.at(-1)!.text, /déjà signé\. 2 visiteurs/);

  // Progress survives a reconnection.
  const characterId = alice.session.characterId;
  alice.socket.close();
  await wait(100);
  const again = await connectPlayer(alice.client, characterId);
  assert.equal(again.pages.get(chest), 1, 'the chest is still open after reconnecting');
  assert.equal(again.pages.get(lina), 3);
  again.socket.close();
  bob.socket.close();
});

test('switch scopes come from the System settings; editing them refreshes players', async () => {
  const carol = await newPlayer('Carol');
  const world = server.ctx.world;
  world.setSwitch(carol.session, 5, true);
  assert.equal(world.global.switches.has(5), false, 'undeclared switches are personal');
  server.ctx.settings.set('switches', [{ name: 'a', global: false }, { name: 'b', global: false }, { name: 'c', global: false }, { name: 'd', global: false }, { name: 'World', global: true }]);
  world.systemChanged();
  assert.equal(world.getSwitch(carol.session, 5), false, 'now read from the global value');
  world.setSwitch(carol.session, 5, true);
  assert.equal(world.global.switches.has(5), true);
  assert.deepEqual(server.ctx.progression.loadGlobal().switches.has(5), true, 'stored');
  carol.socket.close();
});

test('automatic and parallel events run for the player, move routes move the player', async () => {
  const dave = await newPlayer('Dave');
  const world = server.ctx.world;
  const p = dave.session;
  // Add an automatic event and a parallel one to the house (map 3) through the editor path.
  const house = server.ctx.maps.get(3)!;
  const id = house.events.length;
  house.events.push({
    id, name: 'Auto', note: '', x: 1, y: 1,
    pages: [
      { ...structuredClone(house.events.find((e) => e)!.pages[0]!), trigger: 3, conditions: { ...house.events.find((e) => e)!.pages[0]!.conditions, selfSwitchValid: false, switch1Valid: false }, list: [
        c(Cmd.ShowText, ['', 0, 0, 2, '']), c(Cmd.TextLine, ['Bienvenue']),
        c(Cmd.SetMoveRoute, [-1, { list: [{ code: 4 }, { code: 0 }], repeat: false, skippable: true, wait: true }]),
        c(Cmd.ControlSelfSwitch, ['A', 0]),
        c(Cmd.End),
      ] },
      { ...structuredClone(house.events.find((e) => e)!.pages[0]!), trigger: 4, conditions: { ...house.events.find((e) => e)!.pages[0]!.conditions, selfSwitchValid: true, selfSwitchCh: 'A', switch1Valid: false }, list: [
        c(Cmd.ControlVariables, [7, 7, 1, 0, 1]), c(Cmd.Wait, [3]), c(Cmd.End),
      ] },
    ],
  });
  server.ctx.maps.save({ ...server.ctx.maps.info(3)!, id: 3 }, house);
  world.reloadMap(3);
  const forced: { x: number; y: number }[] = [];
  dave.socket.on('forceMove', (m) => forced.push(m));
  world.transfer(p, 3, 6, 7, 8);
  await until(() => dave.messages.some((m) => m.text === 'Bienvenue'));
  await until(() => forced.length > 0);
  assert.deepEqual([p.x, p.y], [6, 6], 'the route moved the player up');
  await until(() => world.getVariable(p, 7) >= 3, 3000);
  world.transfer(p, 1, 20, 17, 2);
  const stopped = world.getVariable(p, 7);
  await wait(300);
  assert.ok(world.getVariable(p, 7) <= stopped + 1, 'the parallel event stops when leaving the map');
  dave.socket.close();
});

test('a parallel event looping without a wait is stopped, reported once, and runs again less and less often', { timeout: 15_000 }, async () => {
  const erin = await newPlayer('Erin');
  const world = server.ctx.world;
  const p = erin.session;
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
  try {
    const id = Math.max(0, ...server.ctx.gameData.list('commonEvent').map((ce) => ce.id)) + 1;
    const list = [c(Cmd.Loop), c(Cmd.ControlVariables, [9, 9, 1, 0, 1], 1), c(Cmd.End, [], 1), c(Cmd.LoopEnd), c(Cmd.End)];
    server.ctx.gameData.save('commonEvent', { id, name: 'Runaway', trigger: 'parallel', switchId: 0, list });
    world.runner.startTriggers(p);
    await wait(1500);
    const steps = world.getVariable(p, 9);
    // Each stopped run counts about 3 333 loops (3 commands each); without the growing pause it ran every 100 ms.
    assert.ok(steps > 0 && steps <= 3 * 3_400, `${steps} loops in 1.5 s`);
    assert.equal(warnings.filter((w) => w.includes(`common event ${id}`)).length, 1, 'reported once in the server log');
    server.ctx.gameData.remove('commonEvent', id);
  } finally {
    console.warn = warn;
    erin.socket.close();
  }
});

test('move routes with wait=false do not stack or speed up, and skippable=false waits until unblocked', { timeout: 15_000 }, async () => {
  const frank = await newPlayer('Frank');
  const world = server.ctx.world;
  const p = frank.session;
  const house = structuredClone(server.ctx.maps.get(3)!);
  const basePage = structuredClone(house.events.find((e) => e)!.pages[0]!);
  basePage.conditions.selfSwitchValid = false;
  basePage.conditions.switch1Valid = false;
  const id = house.events.length;
  // Event at (4, 6) moving right (code 3) then down (code 1), in a parallel event with wait: false and skippable: false.
  house.events.push({
    id, name: 'Walker', note: '', x: 4, y: 6,
    pages: [
      {
        ...basePage,
        priorityType: 1,
        through: false,
        trigger: 4,
        moveSpeed: 3,
        list: [
          c(Cmd.SetMoveRoute, [0, { list: [{ code: 3 }, { code: 1 }, { code: 0 }], repeat: false, skippable: false, wait: false }]),
          c(Cmd.End),
        ],
      },
    ],
  });
  server.ctx.maps.save({ ...server.ctx.maps.info(3)!, id: 3 }, house);
  world.reloadMap(3);

  // Place Frank at (5, 6), directly blocking the first step (right from 4, 6 to 5, 6).
  world.transfer(p, 3, 5, 6, 4);
  await wait(2300);
  const npc = p.events.get(id)!;
  assert.deepEqual([npc.x, npc.y], [4, 6], 'with skippable=false, the blocked step is not skipped even after 2 seconds');

  // Move Frank out of the way to (5, 8): the NPC can now step right to (5, 6) and then down to (5, 7) at normal speed.
  world.transfer(p, 3, 5, 8, 8);
  await wait(300);
  const mid = p.events.get(id)!;
  // At speed 3 (426 ms per step), after 300 ms the NPC has taken at most 1 step, despite wait=false in a parallel event.
  assert.ok(mid.x <= 5 && mid.y <= 6, `no stacked routes speeding up the NPC (at ${mid.x}, ${mid.y})`);
  await until(() => {
    const cur = p.events.get(id)!;
    return cur.x === 5 && cur.y === 7;
  }, 3000);
  frank.socket.close();
});

/** Adds a 12 × 8 grass map holding the given events (one page each, on top of a character's defaults); returns its id. */
function eventsMap(events: { x: number; y: number; page: Partial<EventPage> }[]): number {
  const map = createMap(12, 8, 1);
  map.data.fill(TILE_ID_A2, 0, map.width * map.height);
  refreshAllAutotiles(map);
  const image = { tileId: 0, characterName: 'People1', characterIndex: 0, direction: 2 as const, pattern: 1 };
  map.events = [null, ...events.map((e, i): GameEvent => ({ id: i + 1, name: `E${i + 1}`, note: '', x: e.x, y: e.y, pages: [createPage({ image, ...e.page })] }))];
  const id = server.ctx.maps.nextId();
  server.ctx.maps.save({ id, parentId: 0, name: `Events ${id}`, order: id, expanded: true }, map);
  return id;
}

/** A move route with the editor's defaults: waited for, blocked steps not skipped. */
const route = (...codes: number[]) => ({ list: [...codes.map((code) => ({ code })), { code: RouteCmd.End }], repeat: false, skippable: false, wait: true });

test('a character told to walk "toward the player" stops once next to it instead of freezing the player', { timeout: 15_000 }, async () => {
  const gina = await newPlayer('Gina');
  const p = gina.session;
  // It walks to the player on its own, then its dialogue makes it take one more step toward the player.
  const mapId = eventsMap([{ x: 8, y: 3, page: { trigger: Trigger.EventTouch, moveType: 2, moveSpeed: 5, moveFrequency: 5, list: [
    c(Cmd.SetMoveRoute, [0, route(RouteCmd.MoveToward)]), c(Cmd.ShowText, ['', 0, 0, 2, '']), c(Cmd.TextLine, ['Found you!']), c(Cmd.End),
  ] } }]);
  server.ctx.world.transfer(p, mapId, 2, 3, 6);
  await until(() => gina.messages.some((m) => m.text === 'Found you!'), 6000);
  await until(() => !p.busy, 1000);
  const npc = p.events.get(1)!;
  assert.equal(Math.abs(npc.x - p.x) + Math.abs(npc.y - p.y), 1, 'it stands next to the player');
  assert.equal(npc.direction, 4, 'facing the player');
  gina.socket.close();
});

test('a blocked step of a route the frozen player waits for is given up after a while, and reported once', { timeout: 15_000 }, async () => {
  const hugo = await newPlayer('Hugo');
  const p = hugo.session;
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
  try {
    // Talking to it pushes the player two steps up: the second one is past the edge of the map.
    const mapId = eventsMap([{ x: 5, y: 2, page: { trigger: Trigger.Action, priorityType: Priority.Same, list: [
      c(Cmd.SetMoveRoute, [-1, route(RouteCmd.MoveUp, RouteCmd.MoveUp)]), c(Cmd.ShowText, ['', 0, 0, 2, '']), c(Cmd.TextLine, ['Off you go.']), c(Cmd.End),
    ] } }]);
    server.ctx.world.transfer(p, mapId, 5, 1, 2);
    await wait(100);
    server.ctx.world.action(p);
    await wait(2000);
    assert.equal(p.busy, true, 'the step is not given up at once');
    assert.deepEqual([p.x, p.y], [5, 0], 'the first step was taken');
    await until(() => hugo.messages.some((m) => m.text === 'Off you go.'), 3000);
    await until(() => !p.busy, 1000);
    assert.equal(warnings.filter((w) => w.includes(`map ${mapId}, event 1`) && w.includes('Skip if cannot move')).length, 1, 'the creator is told in the server log');
  } finally {
    console.warn = warn;
    hugo.socket.close();
  }
});
