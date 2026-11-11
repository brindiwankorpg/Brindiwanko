/**
 * @file Sandbox for the "script" event command and script conditions.
 *
 * Scripts are written by administrators in the editor (the only place where
 * events can be authored) or come from imported projects, so they run
 * isolated, behind several layers:
 * - a separate Node.js process, started with the permission model
 *   (`--permission`: no file access, no child process, no worker, no native
 *   addon), without the server's environment variables, with code generation
 *   from strings disabled and a small memory cap: even a flaw in the layers
 *   below cannot reach the server's files, secrets or memory;
 * - inside it, a fresh `node:vm` context per run that contains no host object
 *   at all, only a JSON copy of the player's state and small helper functions
 *   defined inside the context; buffers (array buffers, typed arrays,
 *   WebAssembly memories) are removed from it, their memory being out of
 *   reach of the cap;
 * - promise jobs run within the run's time budget (`microtaskMode:
 *   'afterEvaluate'`), so an endless `.then()` chain is stopped like an
 *   endless loop.
 * A script cannot act directly: it returns a list of operations (set a
 * variable, a switch, a self switch, show a notification) that the server
 * validates and applies.
 *
 * Runs are asynchronous: the game never waits for a script and keeps running
 * its ticks meanwhile. Up to `POOL_SIZE` sandbox processes run scripts side by
 * side (one core is left to the game). A sandbox that stops answering, or dies
 * (out of memory...), is killed and replaced; the script it was running simply
 * does nothing, and those waiting behind it run in another sandbox.
 *
 * Node.js versions whose permission model does not cover the network (before
 * `--allow-net`) cannot keep a script that escaped `node:vm` from opening
 * connections: the server says so once, and an isolation by the system (a
 * dedicated user, a network namespace) is advised for imported scripts.
 *
 * Helpers available to scripts:
 *   v(id), setV(id, value)          variables
 *   s(id), setS(id, on)             switches
 *   self(letter), setSelf(letter, on)  self switches of the running event
 *   gold(), level(), item(id)       read-only player data
 *   player                          { name, mapId, x, y }
 *   notify(text)                    notification for the player
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { Script } from 'node:vm';

/** State exposed to a script (read-only copy). */
export interface ScriptState {
  variables: Record<number, number>;
  switches: Record<number, boolean>;
  selfSwitches: Record<string, boolean>;
  gold: number;
  level: number;
  items: Record<number, number>;
  player: { name: string; mapId: number; x: number; y: number };
}

/** An operation requested by a script. */
export type ScriptOp =
  | { op: 'variable'; id: number; value: number }
  | { op: 'switch'; id: number; value: boolean }
  | { op: 'self'; letter: 'A' | 'B' | 'C' | 'D'; value: boolean }
  | { op: 'notify'; text: string };

/** Time budget of one script run (promise jobs included). */
const TIMEOUT_MS = 50;
/** Longest silence of a busy sandbox before it is replaced (includes starting a new one). */
const WAIT_MS = 2000;
/** Memory cap of the sandbox process. */
const MEMORY_MB = 64;
/** Sandbox processes running at most (one core is left to the game). */
export const POOL_SIZE = Math.max(1, Math.min(4, availableParallelism() - 1));
/** Maximum operations and code size accepted. */
const MAX_OPS = 200;
const MAX_CODE = 20_000;
const MAX_NOTIFY = 200;

const PRELUDE = `
const __ops = [];
const __push = (o) => { if (__ops.length < ${MAX_OPS}) __ops.push(o); };
const __int = (n) => (Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : 0);
const v = (id) => __state.variables[__int(id)] ?? 0;
const setV = (id, value) => { __state.variables[__int(id)] = __int(value); __push({ op: 'variable', id: __int(id), value: __int(value) }); };
const s = (id) => __state.switches[__int(id)] === true;
const setS = (id, on) => { __state.switches[__int(id)] = !!on; __push({ op: 'switch', id: __int(id), value: !!on }); };
const self = (letter) => __state.selfSwitches[String(letter)] === true;
const setSelf = (letter, on) => { __state.selfSwitches[String(letter)] = !!on; __push({ op: 'self', letter: String(letter), value: !!on }); };
const gold = () => __state.gold;
const level = () => __state.level;
const item = (id) => __state.items[__int(id)] ?? 0;
const player = __state.player;
const notify = (text) => __push({ op: 'notify', text: String(text).slice(0, ${MAX_NOTIFY}) });
`;

/**
 * Globals removed from each context: their memory lives outside the JavaScript heap, where the memory cap
 * of the sandbox does not reach (a script could take gigabytes of the server's memory with them).
 */
const OFF_HEAP_GLOBALS = [
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'WebAssembly',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
];

/** Code of the sandbox process (run with `node -e`, so no file has to be readable). */
const SANDBOX_SOURCE = `
'use strict';
const vm = require('node:vm');
// The sandbox lives as long as the server: it ends with its channel.
process.on('disconnect', () => process.exit(0));
process.on('message', (message) => {
  let out = null;
  try {
    const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
    vm.runInContext(${JSON.stringify(`for (const name of ${JSON.stringify(OFF_HEAP_GLOBALS)}) delete globalThis[name];`)}, context);
    const result = new vm.Script(String(message.source)).runInContext(context, { timeout: ${TIMEOUT_MS} });
    if (typeof result === 'string') out = result;
  } catch {}
  process.send({ id: message.id, out });
});
`;

/** Flag of the permission model in this Node.js version (stable since 22.13, experimental before). */
function permissionFlags(): string[] {
  const flags = process.allowedNodeEnvironmentFlags;
  if (flags.has('--permission')) return ['--permission'];
  if (flags.has('--experimental-permission')) return ['--experimental-permission'];
  return [];
}

interface Sandbox {
  process: ChildProcess;
  /** Runs sent and not answered yet, in the order they were sent. */
  pending: Map<number, Run>;
  /** Fires when a busy sandbox stays silent too long. */
  watchdog: NodeJS.Timeout | null;
}

/** A run waiting for its answer. */
interface Run {
  source: string;
  resolve: (out: string | null) => void;
  /** Already sent again after the sandbox died because of another script. */
  retried: boolean;
}

const pool = new Set<Sandbox>();
let nextId = 1;
let warned = false;

/**
 * Ends a sandbox process.
 * @param failed - The sandbox died or stopped answering. It runs one script at a time, in order: the
 *   oldest run waiting is the one that broke it and answers `null`; the others (scripts of other players,
 *   never started) are sent once to a new sandbox instead of being cancelled. Otherwise (shutdown) every
 *   run answers `null`.
 */
function stop(s: Sandbox, failed = true): void {
  pool.delete(s);
  if (s.watchdog) clearTimeout(s.watchdog);
  s.watchdog = null;
  const pending = [...s.pending.values()];
  s.pending.clear();
  if (s.process.exitCode === null && s.process.signalCode === null) s.process.kill('SIGKILL');
  pending.forEach((run, index) => {
    if (!failed || index === 0 || run.retried) run.resolve(null);
    else void execute(run.source, true).then(run.resolve);
  });
}

/** Restarts the watchdog: a busy sandbox must answer within `WAIT_MS`. */
function arm(s: Sandbox): void {
  if (s.watchdog) clearTimeout(s.watchdog);
  s.watchdog = s.pending.size > 0 ? setTimeout(() => stop(s), WAIT_MS) : null;
}

function start(): Sandbox {
  const flags = permissionFlags();
  if (!warned && (flags.length === 0 || !process.allowedNodeEnvironmentFlags.has('--allow-net'))) {
    warned = true;
    console.warn(`[sandbox] Node.js ${process.version} ${flags.length ? 'does not restrict the network of the script sandbox' : 'has no permission model for the script sandbox'}: a newer Node.js, or running the server as a dedicated user without network access to your other services, is advised before approving imported scripts`);
  }
  const child = spawn(process.execPath, [...flags, '--disallow-code-generation-from-strings', `--max-old-space-size=${MEMORY_MB}`, '-e', SANDBOX_SOURCE], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    // None of the server's environment (secrets, NODE_OPTIONS...) reaches the sandbox.
    env: process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {},
    windowsHide: true,
  });
  const s: Sandbox = { process: child, pending: new Map(), watchdog: null };
  child.on('message', (message: { id?: unknown; out?: unknown }) => {
    const run = typeof message?.id === 'number' ? s.pending.get(message.id) : undefined;
    if (!run) return;
    s.pending.delete(message.id as number);
    arm(s);
    run.resolve(typeof message.out === 'string' ? message.out : null);
  });
  child.on('exit', () => stop(s));
  child.on('error', () => stop(s));
  // An idle sandbox never keeps the server alive (the watchdog does while a run is pending).
  child.unref();
  child.channel?.unref();
  return s;
}

/** The sandbox to run the next script: an idle one, a new one while the pool has room, or the least busy. */
function sandbox(): Sandbox {
  let best: Sandbox | undefined;
  for (const s of pool) {
    if (s.pending.size === 0) return s;
    if (!best || s.pending.size < best.pending.size) best = s;
  }
  if (best && pool.size >= POOL_SIZE) return best;
  const s = start();
  pool.add(s);
  return s;
}

/** Runs a source in a sandbox and resolves with its JSON answer, or `null`. */
function execute(source: string, retried = false): Promise<string | null> {
  const s = sandbox();
  const id = nextId++;
  return new Promise((resolve) => {
    s.pending.set(id, { source, resolve, retried });
    if (!s.watchdog) arm(s);
    try {
      s.process.send({ id, source }, (err) => {
        if (err) stop(s);
      });
    } catch {
      stop(s);
    }
  });
}

/** Ends the sandbox processes (server shutdown); the next script starts a new one. */
export function stopSandbox(): void {
  for (const s of [...pool]) stop(s, false);
}

async function run(code: string, state: ScriptState, expression: boolean): Promise<{ ops: ScriptOp[]; value: unknown }> {
  if (code.length > MAX_CODE) return { ops: [], value: undefined };
  // The state enters the context as a JSON string parsed inside it: no host object is reachable.
  const body = expression ? `return (${code}\n);` : `${code}\n;return undefined;`;
  // The code must be valid on its own (compiled, never run, here): text such as `})(); } catch (e) {}` could
  // otherwise close the wrapper below and run outside its try block.
  try {
    new Script(`(() => { ${body} })`);
  } catch {
    return { ops: [], value: undefined };
  }
  const source = `(() => {
const __state = JSON.parse(${JSON.stringify(JSON.stringify(state))});
${PRELUDE}
let __value;
try { __value = (() => { ${body} })(); } catch (e) { __value = undefined; }
return JSON.stringify({ ops: __ops, value: typeof __value === 'number' || typeof __value === 'boolean' ? __value : null });
})()`;
  const out = await execute(source);
  if (out === null) return { ops: [], value: undefined };
  try {
    // Syntax errors, timeouts and malformed answers come back as `null`: the script does nothing.
    const parsed = JSON.parse(out) as { ops?: unknown; value?: unknown };
    const ops = (Array.isArray(parsed.ops) ? parsed.ops : []).filter(isOp).slice(0, MAX_OPS);
    return { ops: ops.map((op) => (op.op === 'notify' ? { ...op, text: op.text.slice(0, MAX_NOTIFY) } : op)), value: parsed.value };
  } catch {
    return { ops: [], value: undefined };
  }
}

function isOp(o: unknown): o is ScriptOp {
  const op = o as ScriptOp;
  if (typeof op !== 'object' || op === null) return false;
  if (op.op === 'variable') return Number.isInteger(op.id) && op.id > 0 && Number.isFinite(op.value);
  if (op.op === 'switch') return Number.isInteger(op.id) && op.id > 0 && typeof op.value === 'boolean';
  if (op.op === 'self') return ['A', 'B', 'C', 'D'].includes(op.letter) && typeof op.value === 'boolean';
  if (op.op === 'notify') return typeof op.text === 'string';
  return false;
}

/**
 * Runs a script and resolves with the operations it requested.
 * @param code - Script source.
 * @param state - Player state copy.
 */
export async function runScript(code: string, state: ScriptState): Promise<ScriptOp[]> {
  return (await run(code, state, false)).ops;
}

/**
 * Evaluates an expression (script conditions and variable operands).
 * @param expression - Expression source.
 * @param state - Player state copy.
 * @returns A number or boolean, or `undefined` when invalid.
 */
export async function evaluateScript(expression: string, state: ScriptState): Promise<number | boolean | undefined> {
  const value = (await run(expression, state, true)).value;
  return typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
}
