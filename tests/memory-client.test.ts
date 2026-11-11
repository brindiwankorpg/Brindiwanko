/** @file Browser resource lifecycle checks with a minimal DOM and canvas stand-in. */
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test, type TestContext } from 'node:test';
import { APPEARANCE_LIMITS, DEFAULT_APPEARANCE } from '../shared/art/character.js';
import type { AssetStore } from '../client/engine/assets.js';

class Element extends EventTarget {
  width = 0;
  height = 0;
  children: Element[] = [];
  parent: Element | null = null;
  private classes = new Set<string>();
  classList = {
    add: (name: string) => { this.classes.add(name); },
    remove: (name: string) => { this.classes.delete(name); },
    contains: (name: string) => this.classes.has(name),
  };
  setAttribute(): void {}
  append(child: Element): void { this.children.push(child); child.parent = this; }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  getContext() { return { putImageData() {}, drawImage() {}, clearRect() {}, fillRect() {}, getTransform: () => ({ a: 1, d: 1, e: 0, f: 0 }) }; }
}

/** Elements created through `document.createElement` since the stand-in was installed. */
let created: Element[] = [];

function browser(t: TestContext) {
  const body = new Element();
  // Node's EventTarget does not normalize boolean capture when removing listeners as browsers do.
  class BrowserWindow extends EventTarget {
    clearInterval = clearInterval;
    override removeEventListener(type: string, listener: EventListener | EventListenerObject | null, options?: EventListenerOptions | boolean): void {
      super.removeEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
    }
  }
  const window = new BrowserWindow();
  created = [];
  const globals = {
    document: { createElement: () => { const e = new Element(); created.push(e); return e; }, getElementById: () => null, body },
    window,
    ImageData: class {
      data: Uint8ClampedArray;
      constructor(width: number, height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    const before = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (before) Object.defineProperty(globalThis, name, before);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  return { body, window };
}

test('sprite caching evicts old appearances while preserving recent and visible sheets', async (t) => {
  browser(t);
  const { appearanceSheet } = await import('../client/engine/scene.js');
  const appearance = (i: number) => ({
    ...DEFAULT_APPEARANCE,
    skin: i % APPEARANCE_LIMITS.skin,
    hairColor: Math.floor(i / APPEARANCE_LIMITS.skin) % APPEARANCE_LIMITS.hairColor,
    outfitColor: Math.floor(i / (APPEARANCE_LIMITS.skin * APPEARANCE_LIMITS.hairColor)),
  });
  const oldest = appearance(0);
  const recent = appearance(1);
  const oldSheet = appearanceSheet(oldest, 48);
  const recentSheet = appearanceSheet(recent, 48);
  for (let i = 2; i <= 100; i++) {
    appearanceSheet(appearance(i), 48);
    assert.equal(appearanceSheet(recent, 48), recentSheet, 'recently used sheets remain cached');
  }
  assert.notEqual(appearanceSheet(oldest, 48), oldSheet, 'the oldest sheet is evicted');
  assert.equal(oldSheet.width, 216, 'eviction must not clear a canvas still used by a scene');
  assert.equal(oldSheet.height, 384);
  assert.notEqual(appearanceSheet(recent, 32), recentSheet, 'different tile sizes use different sheets');
  const oversized = appearanceSheet(recent, 512);
  assert.notEqual(appearanceSheet(recent, 512), oversized, 'sheets exceeding the budget are not cached');
  assert.equal(appearanceSheet(recent, 48), recentSheet, 'oversized sheets do not evict the normal cache');
});

test('a large map builds only the chunks near the player, and gives back those it walked away from', async (t) => {
  browser(t);
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  const { TilemapRenderer } = await import('../client/engine/tilemap.js');
  const width = 150;
  const height = 150;
  const data = new Array<number>(width * height * 6).fill(0);
  const renderer = new TilemapRenderer({ width, height, data }, [], {}, 48);
  const screen = new Element().getContext() as unknown as CanvasRenderingContext2D;
  // 100 chunks of 768 × 768 pixels (about 2.4 MB each): only those around the player are built on entering.
  renderer.warmUp(5, 5);
  assert.equal(renderer.builtChunks, 4);
  renderer.drawLower(screen, 0, 0, 960, 640);
  assert.equal(renderer.builtChunks, 4, 'the view was already built');
  // Far away a few seconds later: the chunks left behind are released, those in view built.
  now += 6000;
  renderer.drawLower(screen, 6000, 6000, 960, 640);
  assert.equal(renderer.builtChunks, 6);
  const released = created.filter((c) => c.width === 0 && c.height === 0).length;
  assert.ok(released >= 4, `the canvases left behind give their memory back (${released})`);
});

test('animated water is drawn from one canvas per animation phase, not tile by tile', async (t) => {
  browser(t);
  const { TilemapRenderer, TILE_ANIMATION_FRAMES } = await import('../client/engine/tilemap.js');
  const width = 16;
  const height = 16;
  const data = new Array<number>(width * height * 6).fill(0);
  // Grass everywhere, a 4 × 4 pond of sea (animated autotile) in the middle.
  data.fill(1, 0, width * height);
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) data[y * width + x] = 2048;
  const sheet = (w: number) => Object.assign(new Element(), { width: w, height: w }) as unknown as HTMLCanvasElement;
  const renderer = new TilemapRenderer({ width, height, data }, [], { A1: sheet(768), B: sheet(768) }, 48);
  let draws = 0;
  const screen = { ...new Element().getContext(), drawImage: () => { draws++; } } as unknown as CanvasRenderingContext2D;
  const before = created.length;
  for (let step = 0; step < 12; step++) {
    renderer.animationCount = step * TILE_ANIMATION_FRAMES;
    draws = 0;
    renderer.drawLower(screen, 0, 0, 768, 768);
    assert.equal(draws, 2, 'the chunk, then its water at the current phase');
  }
  // One chunk canvas, then three water phases (0-1-2-1): no canvas per frame.
  assert.equal(created.length - before, 4);
});

test('the image cache drops the least recently used images past its budget, never those of the current map', async (t) => {
  browser(t);
  const { AssetStore } = await import('../client/engine/assets.js');
  const loads: string[] = [];
  // Each image decodes to 512 × 512 pixels: 1 MB.
  t.mock.method(AssetStore.prototype as unknown as { load(kind: string, name: string): Promise<unknown> }, 'load', async (_kind: string, name: string) => {
    loads.push(name);
    return Object.assign(new Element(), { width: 512, height: 512 });
  });
  const MB = 512 * 512 * 4;
  const store = new AssetStore(3 * MB);
  store.beginScene();
  const a = await store.image('tilesets', 'a');
  await store.image('tilesets', 'b');
  // Next map: three more images. The first map's are dropped to stay within the budget.
  store.beginScene();
  for (const name of ['c', 'd', 'e']) await store.image('tilesets', name);
  assert.equal(store.cachedBytes, 3 * MB);
  assert.equal((a as unknown as Element).width, 512, 'a dropped image is not cleared (a scene may still draw it)');
  // The current map asks for one more: its images are kept, even past the budget.
  await store.image('characters', 'f');
  assert.equal(store.cachedBytes, 4 * MB);
  for (const name of ['c', 'd', 'e']) await store.image('tilesets', name);
  assert.deepEqual(loads, ['a', 'b', 'c', 'd', 'e', 'f'], 'the images of the current map stayed in the cache');
  await store.image('tilesets', 'a');
  assert.equal(loads.at(-1), 'a', 'a dropped image is loaded again when needed');
});

test('failed editor startup removes its DOM and window listeners on every attempt', async (t) => {
  const { body, window } = browser(t);
  const { EditorApi } = await import('../client/editor/api.js');
  const { MapEditorApp } = await import('../client/editor/editor.js');
  const failure = new Error('bootstrap unavailable');
  t.mock.method(EditorApi.prototype, 'get', async () => { throw failure; });
  let closed = 0;
  for (let i = 0; i < 3; i++) {
    await assert.rejects(MapEditorApp.open({
      container: body as unknown as HTMLElement,
      csrf: '', assets: {} as AssetStore, startMapId: 1,
      onClose: () => { closed++; },
    }), (err) => err === failure);
    assert.equal(body.children.length, 0, 'the partial editor is removed');
    assert.equal(body.classList.contains('editor-open'), false, 'another attempt can open the editor');
    assert.equal(getEventListeners(window, 'keydown').length, 0);
    assert.equal(getEventListeners(window, 'beforeunload').length, 0);
    assert.equal(closed, i + 1, 'game input is restored exactly once');
  }
});
