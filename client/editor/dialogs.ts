/**
 * @file Dialogs of the map editor: a generic modal, new map, map properties,
 * quick events (teleporter, character with dialogue, sign, or raw JSON for
 * anything else) with a destination picker, and the version history.
 */
import { MAX_SPAWN_COUNT, MAX_SPAWNS, type Spawn } from '../../shared/combat.js';
import { createPage, type GameEvent } from '../../shared/events.js';
import type { MapData, MapInfo, MapType } from '../../shared/map.js';
import { MAX_MAP_SIDE, validateEvent } from '../../shared/map-validation.js';
import type { Direction } from '../../shared/settings.js';
import { formatServerTime, t, tDynamic } from '../i18n.js';
import { confirmDialog } from '../ui/dialog.js';
import { el } from '../ui/dom.js';
import type { AssetStore } from '../engine/assets.js';
import { buildQuickEvent, quickKindOf, readQuickValues, type QuickKind, type QuickValues } from './quick-events.js';
import { sheetLabel, spritePickerButton } from './character-picker.js';

/** A dialog button. Returning `false` keeps the dialog open. */
export interface ModalButton {
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick?: () => boolean | void | Promise<boolean | void>;
}

/**
 * Opens a modal dialog inside the editor.
 * @param host - Editor root element.
 * @param title - Title.
 * @param content - Body.
 * @param buttons - Buttons (Cancel is not added automatically).
 * @param className - Extra class of the dialog (e.g. `modal-wide`).
 * @param mayEscape - Asked before Escape closes the dialog (unsaved changes...).
 * @param onClosed - Called once when the dialog is gone, whatever closed it (button, Escape, caller).
 * @returns A function closing the dialog.
 */
export function openModal(host: HTMLElement, title: string, content: HTMLElement, buttons: ModalButton[], className = '', mayEscape?: () => boolean | Promise<boolean>, onClosed?: () => void): () => void {
  const error = el('p', { className: 'modal-error hidden', attrs: { role: 'alert' } });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    onClosed?.();
  };
  // Escape closes the dialog on top, wherever the focus is (not only when it is inside the dialog).
  const onKey = (e: KeyboardEvent) => {
    const open = host.querySelectorAll('.modal-backdrop');
    if (e.key !== 'Escape' || open[open.length - 1] !== backdrop) return;
    e.stopPropagation();
    void (async () => {
      if (!mayEscape || (await mayEscape())) close();
    })();
  };
  const footer = el(
    'div',
    { className: 'modal-buttons' },
    buttons.map((b) =>
      el('button', {
        className: `button${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`,
        text: b.label,
        attrs: { type: 'button' },
        on: {
          click: async () => {
            // The error of a previous attempt must not stay under the result of the next one.
            error.classList.add('hidden');
            error.textContent = '';
            try {
              const keep = (await b.onClick?.()) === false;
              if (!keep) close();
            } catch (err) {
              const key = (err as { key?: string }).key;
              const params = (err as { params?: Record<string, string | number> }).params;
              error.textContent = key ? tDynamic(key, params) : String(err);
              error.classList.remove('hidden');
            }
          },
        },
      }),
    ),
  );
  const dialog = el('div', { className: `skin-window modal ${className}`.trim(), attrs: { role: 'dialog', 'aria-label': title } }, [
    el('div', { className: 'modal-title', text: title }),
    el('div', { className: 'modal-body' }, [content, error]),
    footer,
  ]);
  const backdrop = el('div', { className: 'modal-backdrop' }, [dialog]);
  document.addEventListener('keydown', onKey);
  host.append(backdrop);
  (dialog.querySelector('input, select, textarea, button') as HTMLElement | null)?.focus();
  return close;
}

/** Labelled form row. */
export function field(label: string, control: HTMLElement): HTMLLabelElement {
  return el('label', { className: 'form-row' }, [el('span', { text: label }), control]);
}

/** Text input. */
export function textInput(value: string, max = 100): HTMLInputElement {
  const input = el('input', { attrs: { type: 'text', maxlength: String(max) } });
  input.value = value;
  return input;
}

/** Number input. */
export function numberInput(value: number, min: number, max: number): HTMLInputElement {
  const input = el('input', { attrs: { type: 'number', min: String(min), max: String(max), step: '1' } });
  input.value = String(value);
  return input;
}

/** Select control. */
export function select(options: [string, string][], value: string): HTMLSelectElement {
  const s = el('select', {}, options.map(([v, label]) => el('option', { text: label, attrs: { value: v } })));
  s.value = value;
  return s;
}

/** Checkbox. */
export function checkbox(checked: boolean): HTMLInputElement {
  const c = el('input', { attrs: { type: 'checkbox' } });
  c.checked = checked;
  return c;
}

/** Reads a bounded integer from an input, throwing a translated error when invalid. */
export function readInt(input: HTMLInputElement, min: number, max: number): number {
  const v = Number(input.value);
  if (!Number.isInteger(v) || v < min || v > max) throw Object.assign(new Error('range'), { key: 'error.editor.number_range', params: { min, max } });
  return v;
}

const MAP_TYPES: MapType[] = ['town', 'field', 'dungeon', 'instance'];

/** Values of the new map dialog. */
export interface NewMapValues {
  name: string;
  width: number;
  height: number;
  tilesetId: number;
  type: MapType;
}

/** Usual map sizes, in cells: one screen of the game (about 17 × 13 cells), then larger areas. */
const MAP_SIZE_PRESETS: [string, number, number][] = [
  ['screen', 17, 13],
  ['small', 30, 24],
  ['medium', 50, 40],
  ['large', 100, 80],
];

/**
 * Asks for the settings of a new map.
 * @param onCreate - Creates it (may throw an API error shown in the dialog).
 */
export function newMapDialog(host: HTMLElement, tilesets: { id: number; name: string }[], onCreate: (v: NewMapValues) => Promise<void>): void {
  const name = textInput(t('editor.new_map_default'));
  const width = numberInput(25, 1, MAX_MAP_SIDE);
  const height = numberInput(19, 1, MAX_MAP_SIDE);
  const tileset = select(tilesets.map((ts) => [String(ts.id), `${ts.id} — ${ts.name}`]), String(tilesets[0]?.id ?? 1));
  const type = select(MAP_TYPES.map((m) => [m, t(`editor.map_type.${m}` as 'editor.map_type.town')]), 'field');
  // Sizes in words (how much of the screen the map fills); the numbers stay editable.
  const sizes = el('div', { className: 'size-presets' }, MAP_SIZE_PRESETS.map(([key, w, h]) =>
    el('button', {
      className: 'button small',
      text: t('editor.size_preset', { name: tDynamic(`editor.size.${key}`), width: w, height: h }),
      attrs: { type: 'button' },
      on: {
        click: () => {
          width.value = String(w);
          height.value = String(h);
        },
      },
    }),
  ));
  openModal(host, t('editor.new_map'), el('div', { className: 'form-grid' }, [
    field(t('editor.map_name'), name),
    // Several buttons under one title: a group, not a <label> (which would press the first one when its title is clicked).
    el('div', { className: 'form-row', attrs: { role: 'group', 'aria-label': t('editor.map_size') } }, [el('span', { text: t('editor.map_size'), attrs: { 'aria-hidden': 'true' } }), sizes]),
    field(t('editor.width'), width),
    field(t('editor.height'), height),
    field(t('editor.tileset'), tileset),
    field(t('editor.map_type_label'), type),
  ]), [
    { label: t('common.cancel') },
    {
      label: t('editor.create'),
      primary: true,
      onClick: () =>
        onCreate({
          name: name.value.trim() || t('editor.new_map_default'),
          width: readInt(width, 1, MAX_MAP_SIDE),
          height: readInt(height, 1, MAX_MAP_SIDE),
          tilesetId: Number(tileset.value),
          type: type.value as MapType,
        }),
    },
  ]);
}

/** Resource names available to pickers. */
export interface ResourceLists {
  characters: string[];
  faces: string[];
  parallaxes: string[];
  bgm: string[];
  bgs: string[];
  me: string[];
  pictures: string[];
  animations: string[];
  se: string[];
}

/** The sound being listened to in the editor (one at a time). */
let listening: { audio: HTMLAudioElement; button: HTMLButtonElement; timer: number } | null = null;
/** Longest preview of a piece of music, in seconds (it stops by itself). */
const PREVIEW_SECONDS = 30;

function stopListening(): void {
  if (!listening) return;
  listening.audio.pause();
  window.clearTimeout(listening.timer);
  listening.button.textContent = `▶ ${t('editor.listen')}`;
  listening = null;
}

/**
 * "Listen" button next to a music or ambience list: plays the chosen piece for a while (again: stop), so
 * the right one can be chosen without starting the game.
 * @param url - Address of a sound file, or `null` when unknown.
 */
export function listenButton(list: HTMLSelectElement, kind: 'bgm' | 'bgs' | 'me' | 'se', url: (kind: string, name: string) => string | null): HTMLButtonElement {
  const button = el('button', { className: 'button small listen-button', text: `▶ ${t('editor.listen')}`, attrs: { type: 'button' } });
  button.addEventListener('click', () => {
    const playingThis = listening?.button === button;
    stopListening();
    if (playingThis) return;
    const src = list.value ? url(kind, list.value) : null;
    if (!src) return;
    const audio = new Audio(src);
    audio.volume = 0.6;
    audio.loop = kind === 'bgm' || kind === 'bgs';
    void audio.play().catch(() => stopListening());
    button.textContent = `⏹ ${t('editor.stop_listening')}`;
    listening = { audio, button, timer: window.setTimeout(stopListening, PREVIEW_SECONDS * 1000) };
    audio.addEventListener('ended', () => listening?.audio === audio && stopListening());
  });
  list.addEventListener('change', () => listening?.button === button && stopListening());
  return button;
}

/**
 * Map properties dialog. Name and size are applied through `onInfo`; the other
 * properties modify the working copy through `onData`.
 * @param audioUrl - Address of a sound (the "Listen" buttons); absent, no button.
 */
export function propertiesDialog(
  host: HTMLElement,
  info: MapInfo,
  map: MapData,
  tilesets: { id: number; name: string }[],
  enemies: { id: number; name: string }[],
  resources: ResourceLists,
  apply: (changes: { name: string; width: number; height: number; data: Partial<MapData> }) => Promise<void>,
  audioUrl?: (kind: string, name: string) => string | null,
): void {
  const name = textInput(info.name);
  const displayName = textInput(map.displayName);
  const width = numberInput(map.width, 1, MAX_MAP_SIDE);
  const height = numberInput(map.height, 1, MAX_MAP_SIDE);
  // A resource the map uses but the lists no longer hold (imported project, deleted file) stays selectable:
  // otherwise the list would look empty and Apply would silently erase the reference.
  const keepCurrent = (options: [string, string][], current: string): [string, string][] =>
    current === '' || options.some(([value]) => value === current) ? options : [...options, [current, `${current} ⚠ ${t('editor.missing_resource')}`]];
  const tileset = select(keepCurrent(tilesets.map((ts): [string, string] => [String(ts.id), `${ts.id} — ${ts.name}`]), String(map.tilesetId)), String(map.tilesetId));
  const type = select(MAP_TYPES.map((m) => [m, t(`editor.map_type.${m}` as 'editor.map_type.town')]), map.mmo.type);
  const pvp = checkbox(map.mmo.pvp);
  const instance = checkbox(map.mmo.instance);
  // Only the "Instance" box makes a map instanced: choosing the type "Instance" ticks it, and unticking it
  // while that type is chosen goes back to the previous type.
  let previousType: string = map.mmo.type === 'instance' ? 'dungeon' : map.mmo.type;
  type.addEventListener('change', () => {
    if (type.value === 'instance') instance.checked = true;
    else previousType = type.value;
  });
  instance.addEventListener('change', () => {
    if (instance.checked) {
      if (type.value !== 'instance') previousType = type.value;
      type.value = 'instance';
    } else if (type.value === 'instance') type.value = previousType;
  });
  const none: [string, string] = ['', t('editor.none')];
  const bgm = select(keepCurrent([none, ...resources.bgm.map((n): [string, string] => [n, n])], map.bgm.name), map.bgm.name);
  const autoBgm = checkbox(map.autoplayBgm);
  const bgs = select(keepCurrent([none, ...resources.bgs.map((n): [string, string] => [n, n])], map.bgs.name), map.bgs.name);
  const autoBgs = checkbox(map.autoplayBgs);
  // Looping: walking past an edge comes back by the opposite one.
  const loop = select([['0', t('editor.loop.none')], ['2', t('editor.loop.horizontal')], ['1', t('editor.loop.vertical')], ['3', t('editor.loop.both')]], String(map.scrollType || 0));
  const parallax = select(keepCurrent([none, ...resources.parallaxes.map((n): [string, string] => [n, n])], map.parallaxName), map.parallaxName);
  const loopX = checkbox(map.parallaxLoopX);
  const loopY = checkbox(map.parallaxLoopY);
  const sx = numberInput(map.parallaxSx, -32, 32);
  const sy = numberInput(map.parallaxSy, -32, 32);
  const note = el('textarea', { attrs: { rows: '3', maxlength: '10000' } });
  note.value = map.note;
  // Monster spawns: enemy, count, region (0 = anywhere).
  const spawns: Spawn[] = structuredClone(map.mmo.spawns ?? []);
  const spawnBox = el('div', { className: 'spawn-list' });
  // Inputs of each spawn row: read again when applying, so an invalid value is reported.
  const spawnInputs: { count: HTMLInputElement; region: HTMLInputElement }[] = [];
  /** Keeps a typed value in the spawn as long as it is valid. */
  const keep = (input: HTMLInputElement, min: number, max: number, set: (v: number) => void) =>
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (Number.isInteger(v) && v >= min && v <= max) set(v);
    });
  const renderSpawns = () => {
    spawnInputs.length = 0;
    spawnBox.replaceChildren(
      ...spawns.map((s, i) => {
        const enemy = select(enemies.map((e): [string, string] => [String(e.id), `${e.id} — ${e.name}`]), String(s.enemyId));
        enemy.addEventListener('change', () => (s.enemyId = Number(enemy.value)));
        const count = numberInput(s.count, 1, MAX_SPAWN_COUNT);
        keep(count, 1, MAX_SPAWN_COUNT, (v) => (s.count = v));
        const region = numberInput(s.region, 0, 255);
        keep(region, 0, 255, (v) => (s.region = v));
        spawnInputs.push({ count, region });
        const remove = el('button', { className: 'button small danger', text: '✕', attrs: { type: 'button', title: t('editor.delete') } });
        remove.addEventListener('click', () => {
          spawns.splice(i, 1);
          renderSpawns();
        });
        return el('div', { className: 'spawn-row' }, [field(t('editor.spawn_enemy'), enemy), field(t('editor.spawn_count'), count), field(t('editor.spawn_region'), region), remove]);
      }),
    );
  };
  renderSpawns();
  const addSpawn = el('button', { className: 'button small', text: t('editor.spawn_add'), attrs: { type: 'button' } });
  addSpawn.addEventListener('click', () => {
    if (spawns.length >= MAX_SPAWNS || enemies.length === 0) return;
    spawns.push({ enemyId: enemies[0]!.id, count: 3, region: 0 });
    renderSpawns();
  });
  const spawnSection = el('fieldset', { className: 'db-group spawn-section' }, [
    el('legend', { text: t('editor.spawns') }),
    el('p', { className: 'hint', text: t('editor.spawns_help') }),
    spawnBox,
    addSpawn,
  ]);
  openModal(host, t('editor.map_properties'), el('div', {}, [el('div', { className: 'form-grid two-columns' }, [
    field(t('editor.map_name'), name),
    field(t('editor.display_name'), displayName),
    field(t('editor.width'), width),
    field(t('editor.height'), height),
    field(t('editor.tileset'), tileset),
    field(t('editor.map_type_label'), type),
    field(t('editor.pvp'), pvp),
    field(t('editor.instance'), instance),
    field(t('editor.bgm'), audioUrl ? el('div', { className: 'with-listen' }, [bgm, listenButton(bgm, 'bgm', audioUrl)]) : bgm),
    field(t('editor.autoplay_bgm'), autoBgm),
    field(t('editor.bgs'), audioUrl ? el('div', { className: 'with-listen' }, [bgs, listenButton(bgs, 'bgs', audioUrl)]) : bgs),
    field(t('editor.autoplay_bgs'), autoBgs),
    field(t('editor.loop.label'), loop),
    field(t('editor.parallax'), parallax),
    field(t('editor.parallax_loop_x'), loopX),
    field(t('editor.parallax_loop_y'), loopY),
    field(t('editor.parallax_speed_x'), sx),
    field(t('editor.parallax_speed_y'), sy),
    field(t('editor.note'), note),
  ]), el('p', { className: 'hint', text: t('editor.loop.help') }), spawnSection]), [
    { label: t('common.cancel') },
    {
      label: t('editor.apply'),
      primary: true,
      onClick: () =>
        apply({
          name: name.value.trim() || info.name,
          width: readInt(width, 1, MAX_MAP_SIDE),
          height: readInt(height, 1, MAX_MAP_SIDE),
          data: {
            displayName: displayName.value,
            tilesetId: Number(tileset.value),
            // Only the settings of this form: the hand-made passability stays the editor's
            // (a resize renumbers its cells after this dialog was opened).
            mmo: {
              type: type.value as MapType,
              pvp: pvp.checked,
              instance: instance.checked,
              spawns: spawns.map((s, i) => ({ ...s, count: readInt(spawnInputs[i]!.count, 1, MAX_SPAWN_COUNT), region: readInt(spawnInputs[i]!.region, 0, 255) })),
            },
            bgm: { ...map.bgm, name: bgm.value },
            autoplayBgm: autoBgm.checked && bgm.value !== '',
            bgs: { ...map.bgs, name: bgs.value },
            autoplayBgs: autoBgs.checked && bgs.value !== '',
            scrollType: Number(loop.value),
            parallaxName: parallax.value,
            parallaxLoopX: loopX.checked,
            parallaxLoopY: loopY.checked,
            parallaxSx: readInt(sx, -32, 32),
            parallaxSy: readInt(sy, -32, 32),
            note: note.value,
          },
        }),
    },
  ]);
}

/**
 * Options of a select, plus the current value when the options no longer hold it (deleted resource,
 * map or item): otherwise the select would show another value and Apply would silently replace it.
 */
function withCurrent(options: [string, string][], current: string): [string, string][] {
  return current === '' || options.some(([value]) => value === current) ? options : [...options, [current, `${current} ⚠ ${t('editor.missing_resource')}`]];
}

/** Context of the quick event dialog. */
export interface QuickEventContext {
  host: HTMLElement;
  maps: MapInfo[];
  currentMapId: number;
  map: MapData;
  resources: ResourceLists;
  assets: AssetStore;
  /** Items of the database (for chests). */
  items: { id: number; name: string }[];
  /** Opens the destination picker; resolves with the chosen cell, or `null`. */
  pickCell: (mapId: number) => Promise<{ x: number; y: number } | null>;
  /** Size of a map in cells (to keep a teleporter destination inside it). */
  mapSize?: (mapId: number) => Promise<{ width: number; height: number } | null>;
  /** Continues in the full event editor with the event as currently filled in. */
  openFullEditor: (event: GameEvent) => void;
}

/**
 * Creates or edits an event with the quick forms.
 * @param ctx - Dialog context.
 * @param x - Cell of the event.
 * @param y - Cell of the event.
 * @param existing - Event to edit, or `null` to create.
 * @param onDone - Receives the finished event, or `null` to delete it.
 */
export function quickEventDialog(ctx: QuickEventContext, x: number, y: number, existing: GameEvent | null, onDone: (e: GameEvent | null) => void): void {
  const id = existing?.id ?? (() => {
    const free = ctx.map.events.findIndex((e, i) => i > 0 && e === null);
    return free > 0 ? free : ctx.map.events.length;
  })();
  let kind: QuickKind = existing ? quickKindOf(existing) : 'npc';
  // Settings the form does not show are kept as long as the event stays of the kind it had.
  const initialKind = kind;
  const name = textInput(existing?.name ?? `EV${String(id).padStart(3, '0')}`);
  const kindSelect = select(
    [['npc', t('editor.quick.npc')], ['teleport', t('editor.quick.teleport')], ['sign', t('editor.quick.sign')], ['chest', t('editor.quick.chest')], ['json', t('editor.quick.json')]],
    kind,
  );
  const body = el('div', { className: 'quick-body' });

  // --- Fields of each kind (created once, shown according to the kind) ---
  const values = readQuickValues(existing, { mapId: ctx.currentMapId, itemId: ctx.items[0]?.id ?? 0 });
  const destMap = select(withCurrent(ctx.maps.map((m) => [String(m.id), `${m.id} — ${m.name}`]), String(values.destMap)), String(values.destMap));
  const destX = numberInput(values.destX, 0, 255);
  const destY = numberInput(values.destY, 0, 255);
  const dirOptions: [string, string][] = [['0', t('editor.direction.keep')], ['2', t('editor.direction.down')], ['4', t('editor.direction.left')], ['6', t('editor.direction.right')], ['8', t('editor.direction.up')]];
  const destDir = select(dirOptions, String(values.destDir));
  // The destination must lie inside the destination map: its size is looked up whenever the map changes.
  const sizes = new Map<number, { width: number; height: number }>();
  const refreshBounds = async () => {
    const mapId = Number(destMap.value);
    const size = mapId === ctx.currentMapId ? ctx.map : (sizes.get(mapId) ?? (await ctx.mapSize?.(mapId)));
    if (!size) return;
    sizes.set(mapId, size);
    if (Number(destMap.value) !== mapId) return;
    destX.max = String(size.width - 1);
    destY.max = String(size.height - 1);
  };
  destMap.addEventListener('change', () => void refreshBounds());
  void refreshBounds();
  const destMax = (axis: 'width' | 'height') => {
    const mapId = Number(destMap.value);
    const size = mapId === ctx.currentMapId ? ctx.map : sizes.get(mapId);
    return size ? size[axis] - 1 : 255;
  };
  const pick = el('button', {
    className: 'button small',
    text: t('editor.pick_on_map'),
    attrs: { type: 'button' },
    on: {
      click: async () => {
        const cell = await ctx.pickCell(Number(destMap.value));
        if (cell) {
          destX.value = String(cell.x);
          destY.value = String(cell.y);
        }
      },
    },
  });

  const sheet = select(withCurrent([['', t('editor.none')], ...ctx.resources.characters.map((n): [string, string] => [n, sheetLabel(n)])], values.sheet), values.sheet);
  const sheetIndex = numberInput(values.sheetIndex, 0, 7);
  const sheetPicker = spritePickerButton(ctx.assets, 'characters', ctx.resources.characters, sheet, sheetIndex);
  const facing = select(dirOptions.slice(1), String(values.facing));
  const faceSheet = select(withCurrent([['', t('editor.none')], ...ctx.resources.faces.map((n): [string, string] => [n, n])], values.face[0]), values.face[0]);
  const faceIndex = numberInput(values.face[1], 0, 7);
  const facePicker = spritePickerButton(ctx.assets, 'faces', ctx.resources.faces, faceSheet, faceIndex);
  const speaker = textInput(values.speaker);
  const text = el('textarea', { attrs: { rows: '6', maxlength: '5000', placeholder: t('editor.text_placeholder') } });
  text.value = values.text;
  const chestItem = select(withCurrent([['0', t('editor.none')], ...ctx.items.map((i): [string, string] => [String(i.id), `${i.id} — ${i.name}`])], String(values.chestItem)), String(values.chestItem));
  const chestCount = numberInput(values.chestCount, 1, 99);
  const chestGold = numberInput(values.chestGold, 0, 999_999);
  const json = el('textarea', { className: 'json-area', attrs: { rows: '14', spellcheck: 'false' } });
  json.value = JSON.stringify(existing ?? { id, name: name.value, note: '', x, y, pages: [createPage()] }, null, 2);

  const render = () => {
    kind = kindSelect.value as QuickKind;
    const rows: HTMLElement[] = [];
    if (kind === 'teleport') {
      rows.push(field(t('editor.destination_map'), destMap), field('X', destX), field('Y', destY), field(t('editor.direction_label'), destDir), el('div', { className: 'form-row' }, [el('span'), pick]));
    } else if (kind === 'chest') {
      rows.push(field(t('editor.chest_item'), chestItem), field(t('editor.chest_count'), chestCount), field(t('editor.chest_gold'), chestGold));
      rows.push(el('p', { className: 'hint', text: t('editor.chest_help') }));
    } else if (kind === 'npc' || kind === 'sign') {
      if (kind === 'npc') rows.push(field(t('editor.character_pick'), sheetPicker.element), field(t('editor.direction_label'), facing));
      rows.push(field(t('editor.face_pick'), facePicker.element), el('span', { className: 'hidden' }, [sheet, sheetIndex, faceSheet, faceIndex]), field(t('editor.speaker'), speaker), field(t('editor.text'), text));
      rows.push(el('p', { className: 'hint', text: t('editor.text_help') }));
    } else {
      rows.push(el('p', { className: 'hint', text: t('editor.json_help') }), json);
    }
    body.replaceChildren(...rows);
  };
  kindSelect.addEventListener('change', render);
  render();

  const build = (): GameEvent => {
    const base = { id, name: name.value.trim() || `EV${id}`, note: existing?.note ?? '', x, y };
    if (kind !== 'json') {
      // Only the fields of the form shown are read (and checked): the others keep what they hold.
      const shown: QuickValues = { ...values };
      if (kind === 'teleport') {
        const target = ctx.maps.find((m) => m.id === Number(destMap.value));
        if (!target) throw Object.assign(new Error('map'), { key: 'error.editor.map_not_found' });
        shown.destMap = target.id;
        shown.destX = readInt(destX, 0, destMax('width'));
        shown.destY = readInt(destY, 0, destMax('height'));
        shown.destDir = Number(destDir.value) as Direction | 0;
      } else if (kind === 'chest') {
        shown.chestItem = Number(chestItem.value);
        shown.chestCount = readInt(chestCount, 1, 99);
        shown.chestGold = readInt(chestGold, 0, 999_999);
      } else {
        shown.face = [faceSheet.value, readInt(faceIndex, 0, 7)];
        shown.speaker = speaker.value.trim();
        shown.text = text.value;
        if (kind === 'npc') {
          shown.sheet = sheet.value;
          shown.sheetIndex = readInt(sheetIndex, 0, 7);
          shown.facing = Number(facing.value) as Direction;
        }
      }
      return buildQuickEvent(kind, shown, base, existing && kind === initialKind ? existing.pages : null, t('editor.chest_empty'));
    }
    let parsed: GameEvent;
    try {
      parsed = JSON.parse(json.value) as GameEvent;
    } catch {
      throw Object.assign(new Error('json'), { key: 'error.editor.invalid_json' });
    }
    parsed = { ...parsed, id, x, y };
    const error = validateEvent(parsed, id, ctx.map.width, ctx.map.height);
    if (error) throw Object.assign(new Error(error), { key: 'error.editor.invalid_event', params: { detail: error } });
    return parsed;
  };

  const buttons: ModalButton[] = [{ label: t('common.cancel') }];
  buttons.push({
    label: t('editor.full_editor'),
    onClick: () => {
      let current: GameEvent;
      try {
        current = build();
      } catch {
        current = existing ?? { id, name: name.value.trim() || `EV${id}`, note: '', x, y, pages: [createPage()] };
      }
      ctx.openFullEditor(current);
    },
  });
  // Like in the full editor, deleting asks first.
  if (existing) {
    buttons.push({
      label: t('editor.delete'),
      danger: true,
      onClick: async () => {
        if (!(await confirmDialog({ title: t('editor.delete'), message: t('editor.delete_event_confirm'), ok: t('editor.delete'), danger: true }))) return false;
        onDone(null);
      },
    });
  }
  buttons.push({ label: existing ? t('editor.apply') : t('editor.create'), primary: true, onClick: () => onDone(build()) });
  openModal(ctx.host, existing ? t('editor.edit_event', { x, y }) : t('editor.new_event', { x, y }), el('div', { className: 'form-grid' }, [
    field(t('editor.event_name'), name),
    field(t('editor.event_kind'), kindSelect),
    body,
  ]), buttons);
}

/**
 * Version history list.
 * @param versions - Snapshots, newest first.
 * @param onRestore - Restores one version; resolves `true` when done (the list then closes).
 */
export function versionsDialog(host: HTMLElement, versions: { id: number; createdAt: string; accountId: number | null }[], onRestore: (id: number) => Promise<boolean>): void {
  let close: () => void = () => undefined;
  const list = el(
    'ul',
    { className: 'versions-list' },
    versions.map((v, i) =>
      el('li', {}, [
        // The first snapshot of a map never edited has no author: it is the content before the first save.
        el('span', { text: `${formatServerTime(v.createdAt, 'full')}${v.accountId === null ? ` — ${t('editor.original_version')}` : ''}${i === 0 ? ` (${t('editor.current')})` : ''}` }),
        i === 0 ? null : el('button', { className: 'button small', text: t('editor.restore'), attrs: { type: 'button' }, on: { click: () => void onRestore(v.id).then((done) => done && close()) } }),
      ]),
    ),
  );
  close = openModal(host, t('editor.versions'), versions.length ? list : el('p', { text: t('editor.no_versions') }), [{ label: t('ui.close') }]);
}
