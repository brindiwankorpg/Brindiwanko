/**
 * @file Catalogue of the event commands offered by the visual command editor:
 * for each command, its group in the command picker, the form editing its
 * parameters and the one-line summary shown in the command list.
 *
 * Forms return complete blocks (the command and its continuation rows, at
 * indentation 0); the editor re-indents them where they are inserted. The
 * parameter layouts are the standard ones documented in shared/events.ts.
 */
import { choicesBlock, ifBlock, loopBlock } from '../../shared/command-blocks.js';
import { EQUIP_SLOTS } from '../../shared/database.js';
import { BranchType, Cmd, MmoCmd, PICTURE_COUNT, QuestStatus, RouteCmd, SELF_SWITCHES, WEATHER_TYPES, type EventCommand, type MoveRoute } from '../../shared/events.js';
import { ICON_NAMES } from '../../shared/icons.js';
import type { DataName } from '../../shared/settings.js';
import { t, tDynamic } from '../i18n.js';
import { el } from '../ui/dom.js';
import type { AssetStore } from '../engine/assets.js';
import { checkbox, field, listenButton, numberInput, readInt, select, textInput, type ResourceLists } from './dialogs.js';
import { spritePickerButton } from './character-picker.js';

/** A database entry shown in pickers. */
export interface Named {
  id: number;
  name: string;
}

/** Everything the command forms need to offer choices. */
export interface CommandLookups {
  switches: DataName[];
  variables: DataName[];
  items: Named[];
  weapons: Named[];
  armors: Named[];
  /** Slot of each armor (by id), to offer only the armors that fit the slot of an equipment command. */
  armorSlots?: Record<number, string>;
  commonEvents: Named[];
  animations: Named[];
  quests: Named[];
  enemies: Named[];
  maps: Named[];
  /** Map being edited and its events (character targets). */
  mapId: number;
  events: Named[];
  resources: ResourceLists;
  /** Images of the game (visual pickers of faces and characters); absent, the number fields only. */
  assets?: AssetStore;
  /** Opens the destination picker on a map. */
  pickCell(mapId: number): Promise<{ x: number; y: number } | null>;
  /** Opens the move route editor. */
  editRoute(route: MoveRoute): Promise<MoveRoute | null>;
}

/** Groups of the command picker. */
export const COMMAND_GROUPS = ['message', 'flow', 'progress', 'player', 'movement', 'effects', 'pictures', 'audio', 'scene'] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

/** A form editing one command. */
export interface CommandForm {
  element: HTMLElement;
  /** Reads the block (throws a translated error when a value is invalid). */
  read(): EventCommand[];
}

/** Declaration of one command of the editor. */
export interface CommandSpec {
  code: number;
  group: CommandGroup;
  /** Builds the form; `block` is the existing block, or `null` for a new command. Absent: no parameters. */
  form?: (look: CommandLookups, block: EventCommand[] | null) => CommandForm;
  /** Summary shown after the command name. */
  summary?: (c: EventCommand, look: CommandLookups) => string;
}

// --- Small helpers -------------------------------------------------------------

const int = (v: unknown, fallback = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback);
const pad = (id: number) => String(id).padStart(4, '0');
const cmd = (code: number, parameters: unknown[] = [], indent = 0): EventCommand => ({ code, indent, parameters });
const grid = (rows: (HTMLElement | null)[]) => el('div', { className: 'form-grid' }, rows);

/** Label of a database entry. */
function entryName(list: Named[], id: number): string {
  const found = list.find((e) => e.id === id);
  return `${pad(id)}${found?.name ? ` ${found.name}` : ''}`;
}

/** Label of a switch or variable, with its scope. */
function dataLabel(list: DataName[], id: number): string {
  const d = list[id - 1];
  const scope = d?.global ? ` [${t('ev.global')}]` : '';
  return `#${pad(id)}${d?.name ? ` ${d.name}` : ''}${scope}`;
}

/** Select of database entries. */
function entrySelect(list: Named[], value: number, none = false): HTMLSelectElement {
  const options: [string, string][] = list.map((e) => [String(e.id), entryName(list, e.id)]);
  if (none) options.unshift(['0', t('editor.none')]);
  // A reference to an entry that does not exist (nothing created yet, or deleted since) is flagged,
  // and the form refuses to apply it (see checkReferences).
  let missing = false;
  let missingValue = '';
  if (list.length === 0 && !none) {
    options.push(['', t('editor.no_entry')]);
    missing = true;
  } else if (!options.some(([v]) => Number(v) === value) && value > 0) {
    options.push([String(value), `${pad(value)} — ${t('editor.missing_entry_label')}`]);
    missing = true;
    missingValue = String(value);
  }
  const picker = select(options, missing && list.length === 0 ? '' : String(value || (none ? 0 : list[0]?.id ?? 1)));
  if (missing) picker.dataset.missing = '1';
  // Choosing another entry settles the problem; choosing the broken one again brings it back.
  picker.addEventListener('change', () => {
    if (picker.value === missingValue) picker.dataset.missing = '1';
    else delete picker.dataset.missing;
  });
  return picker;
}

/** Throws a translated error when a form still points to an entry that does not exist. */
export function checkReferences(form: HTMLElement): void {
  if (form.querySelector('select[data-missing]')) throw Object.assign(new Error('missing'), { key: 'error.editor.missing_entry' });
  // A message without text, a label without a name, a sound without a file... would do nothing in game.
  const empty = [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-required]')].find((c) => c.value.trim() === '');
  if (empty) {
    empty.focus();
    throw Object.assign(new Error('required'), { key: 'error.editor.required_field' });
  }
}

/** Marks a control as required: the form refuses to apply while it is empty. */
const required = <E extends HTMLElement>(control: E): E => {
  control.dataset.required = '1';
  return control;
};

/** Select of switches or variables (declared ones plus a few free ids). */
function dataSelect(list: DataName[], value: number): HTMLSelectElement {
  const count = Math.max(list.length + 10, 20, value);
  const options: [string, string][] = [];
  for (let id = 1; id <= count; id++) options.push([String(id), dataLabel(list, id)]);
  return select(options, String(Math.max(1, value)));
}

/** Select of character targets: player, this event, other events of the map. */
function characterSelect(look: CommandLookups, value: number, withPlayer = true): HTMLSelectElement {
  const options: [string, string][] = [];
  if (withPlayer) options.push(['-1', t('ev.char.player')]);
  options.push(['0', t('ev.char.this')]);
  for (const e of look.events) options.push([String(e.id), `${pad(e.id)} ${e.name}`]);
  return select(options, String(value));
}

function characterName(look: CommandLookups, ref: number): string {
  if (ref < 0) return t('ev.char.player');
  if (ref === 0) return t('ev.char.this');
  return entryName(look.events, ref);
}

const onOff = (value: number) => select([['0', t('ev.on')], ['1', t('ev.off')]], String(value));
const onOffName = (value: unknown) => (int(value) === 0 ? t('ev.on') : t('ev.off'));
const COMPARE = ['=', '≥', '≤', '>', '<', '≠'];
const compareSelect = (value: number) => select(COMPARE.map((c, i): [string, string] => [String(i), c]), String(value));
const directionSelect = (value: number, keep = false) =>
  select(
    [...(keep ? ([['0', t('editor.direction.keep')]] as [string, string][]) : []), ['2', t('editor.direction.down')], ['4', t('editor.direction.left')], ['6', t('editor.direction.right')], ['8', t('editor.direction.up')]],
    String(value),
  );
const directionName = (d: number) => ({ 2: t('editor.direction.down'), 4: t('editor.direction.left'), 6: t('editor.direction.right'), 8: t('editor.direction.up') })[d] ?? t('editor.direction.keep');
const resourceSelect = (names: string[], value: string, none = true) => select([...(none ? ([['', t('editor.none')]] as [string, string][]) : []), ...names.map((n): [string, string] => [n, n])], value);

/** Constant-or-variable operand. */
function operandInput(look: CommandLookups, type: number, value: number, min: number, max: number) {
  const kind = select([['0', t('ev.operand.constant')], ['1', t('ev.operand.variable')]], String(type));
  const constant = numberInput(type === 0 ? value : 0, min, max);
  const variable = dataSelect(look.variables, type === 1 ? value : 1);
  const box = el('div', { className: 'inline-row' }, [kind, constant, variable]);
  const sync = () => {
    constant.classList.toggle('hidden', kind.value !== '0');
    variable.classList.toggle('hidden', kind.value !== '1');
  };
  kind.addEventListener('change', sync);
  sync();
  return {
    element: box,
    read: (): [number, number] => (kind.value === '0' ? [0, readInt(constant, min, max)] : [1, Number(variable.value)]),
  };
}

function operandText(look: CommandLookups, type: unknown, value: unknown): string {
  return int(type) === 1 ? dataLabel(look.variables, int(value)) : String(int(value));
}

/** Increase / decrease select. */
const opSelect = (value: number) => select([['0', t('ev.increase')], ['1', t('ev.decrease')]], String(value));
const opSign = (v: unknown) => (int(v) === 1 ? '−' : '+');

/** Multi-line text area. */
function textArea(value: string, rows = 4, max = 5000): HTMLTextAreaElement {
  const area = el('textarea', { attrs: { rows: String(rows), maxlength: String(max) } });
  area.value = value;
  return area;
}

/** Lines of a text area, trailing empty lines removed. */
function linesOf(area: HTMLTextAreaElement): string[] {
  const lines = area.value.replace(/\r/g, '').split('\n');
  while (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

/** Block made of a first row and continuation rows holding one text line each. */
function linesBlock(code: number, lineCode: number, lines: string[], first: unknown[] = []): EventCommand[] {
  if (code === Cmd.ShowText) return [cmd(code, first), ...lines.map((l) => cmd(lineCode, [l]))];
  const [head = '', ...rest] = lines;
  return [cmd(code, [head]), ...rest.map((l) => cmd(lineCode, [l]))];
}

/** Rows after the head of a block, as text. */
const blockLines = (block: EventCommand[] | null, from = 1) => (block ?? []).slice(from).map((c) => String(c.parameters[0] ?? ''));

// --- Conditional branch --------------------------------------------------------

const BRANCH_TYPES = [
  BranchType.Switch, BranchType.Variable, BranchType.SelfSwitch, BranchType.Item, BranchType.Weapon, BranchType.Armor,
  BranchType.Gold, BranchType.Level, BranchType.Quest, BranchType.Character, BranchType.Timer, BranchType.Script,
] as const;

/** Choices of quest status (conditions and branches). */
export const QUEST_STATUS_OPTIONS = (): [string, string][] => [
  [String(QuestStatus.NotStarted), t('ev.quest.not_started')],
  [String(QuestStatus.InProgress), t('ev.quest.in_progress')],
  [String(QuestStatus.Ready), t('ev.quest.ready')],
  [String(QuestStatus.Completed), t('ev.quest.completed')],
];

function questStatusSelect(value: number): HTMLSelectElement {
  return select(QUEST_STATUS_OPTIONS(), String(value));
}

/** Form part editing the condition of a branch `[type, ...]`. */
function conditionForm(look: CommandLookups, params: unknown[]) {
  const type = select(BRANCH_TYPES.map((b): [string, string] => [String(b), tDynamic(`ev.branch.${b}`)]), String(params[0] ?? 0));
  const body = el('div', { className: 'form-grid' });
  let read: () => unknown[] = () => [];
  const same = (b: number) => int(params[0], -1) === b;
  const render = () => {
    const b = Number(type.value);
    const p = same(b) ? params : [];
    if (b === BranchType.Switch) {
      const s = dataSelect(look.switches, int(p[1], 1));
      const v = onOff(int(p[2]));
      body.replaceChildren(field(t('ev.field.switch'), s), field(t('ev.field.value'), v));
      read = () => [b, Number(s.value), Number(v.value)];
    } else if (b === BranchType.Variable) {
      const v = dataSelect(look.variables, int(p[1], 1));
      const c = compareSelect(int(p[4], 1));
      const operand = operandInput(look, int(p[2]), int(p[3]), -99_999_999, 99_999_999);
      body.replaceChildren(field(t('ev.field.variable'), v), field(t('ev.field.compare'), c), field(t('ev.field.operand'), operand.element));
      read = () => {
        const [ot, ov] = operand.read();
        return [b, Number(v.value), ot, ov, Number(c.value)];
      };
    } else if (b === BranchType.SelfSwitch) {
      const l = select(SELF_SWITCHES.map((x): [string, string] => [x, x]), String(p[1] ?? 'A'));
      const v = onOff(int(p[2]));
      body.replaceChildren(field(t('ev.field.self_switch'), l), field(t('ev.field.value'), v));
      read = () => [b, l.value, Number(v.value)];
    } else if (b === BranchType.Item || b === BranchType.Weapon || b === BranchType.Armor) {
      const list = b === BranchType.Item ? look.items : b === BranchType.Weapon ? look.weapons : look.armors;
      const s = entrySelect(list, int(p[1], list[0]?.id ?? 1));
      const eq = checkbox(p[2] === true);
      body.replaceChildren(...[field(t('ev.field.entry'), s), ...(b === BranchType.Item ? [] : [field(t('ev.field.include_equipped'), eq)])]);
      read = () => (b === BranchType.Item ? [b, Number(s.value)] : [b, Number(s.value), eq.checked]);
    } else if (b === BranchType.Gold) {
      const amount = numberInput(int(p[1]), 0, 999_999_999);
      const c = select([['0', '≥'], ['1', '≤'], ['2', '<']], String(int(p[2])));
      body.replaceChildren(field(t('ev.field.compare'), c), field(t('ev.field.amount'), amount));
      read = () => [b, readInt(amount, 0, 999_999_999), Number(c.value)];
    } else if (b === BranchType.Level) {
      const c = compareSelect(int(p[2], 1));
      const level = numberInput(int(p[1], 1), 1, 999);
      body.replaceChildren(field(t('ev.field.compare'), c), field(t('ev.field.level'), level));
      read = () => [b, readInt(level, 1, 999), Number(c.value)];
    } else if (b === BranchType.Quest) {
      const q = entrySelect(look.quests, int(p[1], look.quests[0]?.id ?? 1));
      const status = questStatusSelect(int(p[2], QuestStatus.InProgress));
      const step = numberInput(int(p[3]), 0, 99);
      body.replaceChildren(field(t('ev.field.quest'), q), field(t('ev.field.quest_status'), status), field(t('ev.field.quest_step_min'), step));
      read = () => [b, Number(q.value), Number(status.value), readInt(step, 0, 99)];
    } else if (b === BranchType.Timer) {
      const c = select([['0', '≥'], ['1', '≤']], String(int(p[2])));
      const total = int(p[1], 60);
      const minutes = numberInput(Math.floor(total / 60), 0, 99);
      const seconds = numberInput(total % 60, 0, 59);
      body.replaceChildren(field(t('ev.field.compare'), c), field(t('ev.field.minutes'), minutes), field(t('ev.field.seconds'), seconds), el('p', { className: 'hint', text: t('ev.timer_branch_help') }));
      read = () => [b, readInt(minutes, 0, 99) * 60 + readInt(seconds, 0, 59), Number(c.value)];
    } else if (b === BranchType.Character) {
      const c = characterSelect(look, int(p[1], -1));
      const d = directionSelect(int(p[2], 2));
      body.replaceChildren(field(t('ev.field.character'), c), field(t('ev.field.facing'), d));
      read = () => [b, Number(c.value), Number(d.value)];
    } else {
      const code = textInput(String(p[1] ?? ''), 1000);
      body.replaceChildren(field(t('ev.field.expression'), code), el('p', { className: 'hint', text: t('ev.script_help') }));
      read = () => [b, code.value];
    }
  };
  type.addEventListener('change', render);
  render();
  return { element: el('div', {}, [grid([field(t('ev.field.condition'), type)]), body]), read: () => read() };
}

/** Summary of a branch condition. */
function conditionText(p: unknown[], look: CommandLookups): string {
  const b = int(p[0], -1);
  switch (b) {
    case BranchType.Switch: return `${dataLabel(look.switches, int(p[1]))} = ${onOffName(p[2])}`;
    case BranchType.Variable: return `${dataLabel(look.variables, int(p[1]))} ${COMPARE[int(p[4])] ?? '='} ${operandText(look, p[2], p[3])}`;
    case BranchType.SelfSwitch: return `${t('ev.field.self_switch')} ${String(p[1])} = ${onOffName(p[2])}`;
    case BranchType.Item: return `${t('ev.owns')} ${entryName(look.items, int(p[1]))}`;
    case BranchType.Weapon: return `${t('ev.owns')} ${entryName(look.weapons, int(p[1]))}`;
    case BranchType.Armor: return `${t('ev.owns')} ${entryName(look.armors, int(p[1]))}`;
    case BranchType.Gold: return `${t('ev.gold')} ${['≥', '≤', '<'][int(p[2])] ?? '≥'} ${int(p[1])}`;
    case BranchType.Level: return `${t('ev.field.level')} ${COMPARE[int(p[2], 1)] ?? '≥'} ${int(p[1])}`;
    case BranchType.Quest: {
      const status = { [QuestStatus.NotStarted]: t('ev.quest.not_started'), [QuestStatus.InProgress]: t('ev.quest.in_progress'), [QuestStatus.Completed]: t('ev.quest.completed'), [QuestStatus.Ready]: t('ev.quest.ready') }[int(p[2], 1)] ?? '';
      const step = int(p[2], 1) === QuestStatus.InProgress && int(p[3]) > 0 ? ` (${t('ev.field.step')} ≥ ${int(p[3])})` : '';
      return t('common.label_value', { label: entryName(look.quests, int(p[1])), value: `${status}${step}` });
    }
    case BranchType.Character: return `${characterName(look, int(p[1]))} → ${directionName(int(p[2]))}`;
    case BranchType.Timer: return `${t('ev.branch.3')} ${int(p[2]) === 1 ? '≤' : '≥'} ${Math.floor(int(p[1]) / 60)}:${String(int(p[1]) % 60).padStart(2, '0')}`;
    case BranchType.Script: return t('common.label_value', { label: t('ev.branch.12'), value: String(p[1] ?? '') });
    default: return '?';
  }
}

// --- Move routes ---------------------------------------------------------------

/** One-line description of a route command. */
export function routeCommandText(c: { code: number; parameters?: unknown[] }): string {
  const p = c.parameters ?? [];
  const name = tDynamic(`ev.route.${c.code}`);
  if (c.code === RouteCmd.Wait) return t('common.label_value', { label: name, value: int(p[0]) });
  if (c.code === RouteCmd.Speed) return t('common.label_value', { label: name, value: int(p[0]) });
  if (c.code === RouteCmd.Image) return t('common.label_value', { label: name, value: `${String(p[0] ?? '')} (${int(p[1])})` });
  if (c.code === RouteCmd.PlaySe) return t('common.label_value', { label: name, value: String((p[0] as { name?: string } | undefined)?.name ?? '') });
  return name;
}

/** Continuation rows listing a route (shown in the command list, ignored when running). */
function routeRows(route: MoveRoute): EventCommand[] {
  return route.list.filter((r) => r.code !== RouteCmd.End).map((r) => cmd(Cmd.MoveRouteLine, [{ code: r.code, parameters: r.parameters ?? [] }]));
}

// --- Pictures ------------------------------------------------------------------

/**
 * Position, size, opacity and blend of a picture command (parameters 2 to 9:
 * origin, 0 | 1 from variables, x, y, width %, height %, opacity, blend).
 */
function pictureLayoutForm(look: CommandLookups, p: unknown[]): { element: HTMLElement; read: () => unknown[] } {
  const fromVars = int(p[3]) === 1;
  const origin = select([['0', t('ev.origin.top_left')], ['1', t('ev.origin.center')]], String(int(p[2])));
  const byVars = checkbox(fromVars);
  const x = numberInput(fromVars ? 0 : int(p[4]), -5000, 5000);
  const y = numberInput(fromVars ? 0 : int(p[5]), -5000, 5000);
  const vX = dataSelect(look.variables, fromVars ? int(p[4], 1) : 1);
  const vY = dataSelect(look.variables, fromVars ? int(p[5], 1) : 1);
  const direct = grid([field('X', x), field('Y', y)]);
  const variables = grid([field(t('ev.field.x_variable'), vX), field(t('ev.field.y_variable'), vY)]);
  const sync = () => {
    direct.classList.toggle('hidden', byVars.checked);
    variables.classList.toggle('hidden', !byVars.checked);
  };
  byVars.addEventListener('change', sync);
  sync();
  const scaleX = numberInput(int(p[6], 100), -2000, 2000);
  const scaleY = numberInput(int(p[7], 100), -2000, 2000);
  const opacity = numberInput(int(p[8], 255), 0, 255);
  const blend = select([0, 1, 2, 3].map((b): [string, string] => [String(b), tDynamic(`ev.blend.${b}`)]), String(int(p[9])));
  return {
    element: el('div', {}, [
      grid([field(t('ev.field.origin'), origin), field(t('ev.field.from_variables'), byVars)]),
      direct,
      variables,
      grid([field(t('ev.field.width_percent'), scaleX), field(t('ev.field.height_percent'), scaleY), field(t('ev.field.opacity'), opacity), field(t('ev.field.blend'), blend)]),
    ]),
    read: () => [
      Number(origin.value),
      byVars.checked ? 1 : 0,
      byVars.checked ? Number(vX.value) : readInt(x, -5000, 5000),
      byVars.checked ? Number(vY.value) : readInt(y, -5000, 5000),
      readInt(scaleX, -2000, 2000),
      readInt(scaleY, -2000, 2000),
      readInt(opacity, 0, 255),
      Number(blend.value),
    ],
  };
}

/** A sound list with its "Listen" button (when the game's files are at hand). */
function withListen(list: HTMLSelectElement, kind: 'bgm' | 'bgs' | 'me' | 'se', look: CommandLookups): HTMLElement {
  const assets = look.assets;
  return assets ? el('div', { className: 'with-listen' }, [list, listenButton(list, kind, (k, n) => assets.url(k, n))]) : list;
}

/** Writes `code` in a text field where the cursor is (replacing the selection), and puts the cursor after it. */
function insertAtCursor(area: HTMLTextAreaElement, code: string): void {
  const start = area.selectionStart ?? area.value.length;
  const end = area.selectionEnd ?? start;
  area.value = area.value.slice(0, start) + code + area.value.slice(end);
  area.focus();
  area.setSelectionRange(start + code.length, start + code.length);
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Buttons writing the message codes in the text (player name, variable, currency, colour, icon, pauses):
 * nobody has to remember `\V[n]` or which number is which colour.
 */
function textCodeBar(area: HTMLTextAreaElement, look: CommandLookups): HTMLElement {
  const insert = (label: string, code: string, title: string) =>
    el('button', { className: 'button small', text: label, title, attrs: { type: 'button' }, on: { click: () => insertAtCursor(area, code) } });
  // A list whose choice is written at once, then goes back to its title.
  const picker = (title: string, options: [string, string][], toCode: (value: string) => string) => {
    const s = select([['', title], ...options], '');
    s.title = title;
    s.addEventListener('change', () => {
      if (s.value !== '') insertAtCursor(area, toCode(s.value));
      s.value = '';
    });
    return s;
  };
  const variables: [string, string][] = look.variables.map((v, i) => [String(i + 1), `${pad(i + 1)} ${v.name}`]);
  const colors: [string, string][] = Array.from({ length: 8 }, (_, i) => [String(i), i === 0 ? t('ev.code.color_normal') : t('ev.code.color_n', { n: i })]);
  const icons: [string, string][] = ICON_NAMES.map((name, i): [string, string] => [String(i), `${i} — ${name}`]).slice(1);
  return el('div', { className: 'text-code-bar', attrs: { role: 'toolbar', 'aria-label': t('ev.code.toolbar') } }, [
    insert(t('ev.code.player'), '\\P', '\\P'),
    insert(t('ev.code.currency'), '\\G', '\\G'),
    picker(t('ev.code.variable'), variables, (v) => `\\V[${v}]`),
    picker(t('ev.code.color'), colors, (v) => `\\C[${v}]`),
    picker(t('ev.code.icon'), icons, (v) => `\\I[${v}]`),
    insert(t('ev.code.short_pause'), '\\.', '\\.'),
    insert(t('ev.code.long_pause'), '\\|', '\\|'),
    insert(t('ev.code.wait_key'), '\\!', '\\!'),
  ]);
}

/** Red, green, blue and gray of a colour tone, with a few ready-made tones. */
function toneFields(tone: unknown[]): { element: HTMLElement; read: () => number[] } {
  const presets: [string, number[]][] = [
    [t('ev.tone.normal'), [0, 0, 0, 0]],
    [t('ev.tone.night'), [-68, -68, 0, 68]],
    [t('ev.tone.dusk'), [68, -34, -34, 0]],
    [t('ev.tone.dark'), [-120, -120, -120, 0]],
    [t('ev.tone.sepia'), [34, -34, -68, 170]],
  ];
  const inputs = [0, 1, 2, 3].map((i) => numberInput(int(tone[i]), i === 3 ? 0 : -255, 255));
  const preset = select([['', '—'], ...presets.map(([label], i): [string, string] => [String(i), label])], '');
  preset.addEventListener('change', () => {
    const values = presets[Number(preset.value)]?.[1];
    if (values) values.forEach((v, i) => (inputs[i]!.value = String(v)));
  });
  return {
    element: grid([field(t('ev.field.preset'), preset), field(t('ev.field.red'), inputs[0]!), field(t('ev.field.green'), inputs[1]!), field(t('ev.field.blue'), inputs[2]!), field(t('ev.field.gray'), inputs[3]!)]),
    read: () => inputs.map((input, i) => readInt(input, i === 3 ? 0 : -255, 255)),
  };
}

// --- Specs ---------------------------------------------------------------------

/** Every command offered by the editor, in picker order. */
export const COMMAND_SPECS: CommandSpec[] = [
  // Messages
  {
    code: Cmd.ShowText,
    group: 'message',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? ['', 0, 0, 2, ''];
      const face = resourceSelect(look.resources.faces, String(p[0] ?? ''));
      const faceIndex = numberInput(int(p[1]), 0, 7);
      const speaker = textInput(String(p[4] ?? ''), 60);
      const background = select([['0', t('ev.bg.window')], ['1', t('ev.bg.dim')], ['2', t('ev.bg.transparent')]], String(int(p[2])));
      const position = select([['0', t('ev.pos.top')], ['1', t('ev.pos.middle')], ['2', t('ev.pos.bottom')]], String(int(p[3], 2)));
      const text = required(textArea(blockLines(block).join('\n'), 5));
      // The portrait is a button opening the picker (theme, then every face); the fields stay without assets.
      const faces = look.assets ? spritePickerButton(look.assets, 'faces', look.resources.faces, face, faceIndex) : null;
      const faceFields = faces
        ? [field(t('editor.face_pick'), faces.element), el('span', { className: 'hidden' }, [face, faceIndex])]
        : [field(t('editor.face_sheet'), face), field(t('editor.face_index'), faceIndex)];
      return {
        element: el('div', {}, [
          grid([...faceFields, field(t('editor.speaker'), speaker), field(t('ev.field.background'), background), field(t('ev.field.position'), position)]),
          textCodeBar(text, look),
          field(t('editor.text'), text),
          el('p', { className: 'hint', text: t('ev.text_codes') }),
        ]),
        read: () => linesBlock(Cmd.ShowText, Cmd.TextLine, linesOf(text), [face.value, readInt(faceIndex, 0, 7), Number(background.value), Number(position.value), speaker.value.trim()]),
      };
    },
    summary: (c) => {
      const p = c.parameters;
      const face = p[0] ? `${String(p[0])}(${int(p[1])})` : t('editor.none');
      return `${face}${p[4] ? `, ${String(p[4])}` : ''}`;
    },
  },
  {
    code: Cmd.ShowChoices,
    group: 'message',
    form: (_look, block) => {
      const p = block?.[0]?.parameters ?? [[t('ev.default_yes'), t('ev.default_no')], 1, 0, 2, 0];
      const choices = textArea(((p[0] as string[]) ?? []).join('\n'), 4, 600);
      const cancel = select([['-2', t('ev.cancel.branch')], ['-1', t('ev.cancel.forbidden')], ['0', t('ev.cancel.choice', { n: 1 })], ['1', t('ev.cancel.choice', { n: 2 })], ['2', t('ev.cancel.choice', { n: 3 })], ['3', t('ev.cancel.choice', { n: 4 })]], String(int(p[1], -2)));
      const def = select([['0', '1'], ['1', '2'], ['2', '3'], ['3', '4'], ['4', '5'], ['5', '6']], String(int(p[2])));
      return {
        element: el('div', {}, [grid([field(t('ev.field.choices'), choices), field(t('ev.field.cancel'), cancel), field(t('ev.field.default_choice'), def)]), el('p', { className: 'hint', text: t('ev.choices_help') })]),
        read: () => {
          const list = linesOf(choices).map((l) => l.trim()).filter((l) => l !== '').slice(0, 6);
          if (list.length === 0) throw Object.assign(new Error('choices'), { key: 'ev.error.no_choice' });
          const cancelType = Math.min(Number(cancel.value), list.length - 1);
          return choicesBlock([list, cancelType, Math.min(Number(def.value), list.length - 1), 2, 0]);
        },
      };
    },
    summary: (c) => ((c.parameters[0] as string[]) ?? []).join(', '),
  },
  {
    code: Cmd.InputNumber,
    group: 'message',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [1, 2];
      const v = dataSelect(look.variables, int(p[0], 1));
      const digits = numberInput(int(p[1], 2), 1, 8);
      return { element: grid([field(t('ev.field.variable'), v), field(t('ev.field.digits'), digits)]), read: () => [cmd(Cmd.InputNumber, [Number(v.value), readInt(digits, 1, 8)])] };
    },
    summary: (c, look) => `${dataLabel(look.variables, int(c.parameters[0]))}, ${int(c.parameters[1])} ${t('ev.field.digits').toLowerCase()}`,
  },
  {
    code: MmoCmd.Notify,
    group: 'message',
    form: (_look, block) => {
      const text = required(textInput(String(block?.[0]?.parameters[0] ?? ''), 300));
      return { element: grid([field(t('editor.text'), text)]), read: () => [cmd(MmoCmd.Notify, [text.value])] };
    },
    summary: (c) => String(c.parameters[0] ?? ''),
  },
  {
    code: Cmd.Comment,
    group: 'message',
    form: (_look, block) => {
      const text = textArea([String(block?.[0]?.parameters[0] ?? ''), ...blockLines(block)].join('\n'), 4);
      return { element: grid([field(t('ev.field.comment'), text)]), read: () => linesBlock(Cmd.Comment, Cmd.CommentLine, linesOf(text)) };
    },
    summary: (c) => String(c.parameters[0] ?? ''),
  },

  // Flow
  {
    code: Cmd.If,
    group: 'flow',
    form: (look, block) => {
      const cond = conditionForm(look, block?.[0]?.parameters ?? [0, 1, 0]);
      const withElse = checkbox(block ? block.some((c) => c.code === Cmd.Else && c.indent === block[0]!.indent) : false);
      return { element: el('div', {}, [cond.element, grid([field(t('ev.field.else_branch'), withElse)])]), read: () => ifBlock(cond.read(), withElse.checked) };
    },
    summary: (c, look) => conditionText(c.parameters, look),
  },
  { code: Cmd.Loop, group: 'flow', form: () => ({ element: el('p', { className: 'hint', text: t('ev.loop_help') }), read: () => loopBlock() }) },
  { code: Cmd.BreakLoop, group: 'flow' },
  { code: Cmd.ExitEvent, group: 'flow' },
  {
    code: Cmd.CommonEvent,
    group: 'flow',
    form: (look, block) => {
      const s = entrySelect(look.commonEvents, int(block?.[0]?.parameters[0], look.commonEvents[0]?.id ?? 1));
      return { element: grid([field(t('ev.field.common_event'), s)]), read: () => [cmd(Cmd.CommonEvent, [Number(s.value)])] };
    },
    summary: (c, look) => entryName(look.commonEvents, int(c.parameters[0])),
  },
  {
    code: Cmd.Label,
    group: 'flow',
    form: (_look, block) => {
      const name = required(textInput(String(block?.[0]?.parameters[0] ?? ''), 60));
      return { element: grid([field(t('ev.field.label'), name)]), read: () => [cmd(Cmd.Label, [name.value.trim()])] };
    },
    summary: (c) => String(c.parameters[0] ?? ''),
  },
  {
    code: Cmd.JumpToLabel,
    group: 'flow',
    form: (_look, block) => {
      const name = required(textInput(String(block?.[0]?.parameters[0] ?? ''), 60));
      return { element: grid([field(t('ev.field.label'), name)]), read: () => [cmd(Cmd.JumpToLabel, [name.value.trim()])] };
    },
    summary: (c) => String(c.parameters[0] ?? ''),
  },
  {
    code: Cmd.Wait,
    group: 'flow',
    form: (_look, block) => {
      const frames = numberInput(int(block?.[0]?.parameters[0], 60), 1, 36_000);
      return { element: el('div', {}, [grid([field(t('ev.field.frames'), frames)]), el('p', { className: 'hint', text: t('ev.frames_help') })]), read: () => [cmd(Cmd.Wait, [readInt(frames, 1, 36_000)])] };
    },
    summary: (c) => `${int(c.parameters[0])} ${t('ev.frames_unit')}`,
  },

  // Progress
  {
    code: Cmd.ControlSwitches,
    group: 'progress',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [1, 1, 0];
      const from = dataSelect(look.switches, int(p[0], 1));
      const to = dataSelect(look.switches, int(p[1], 1));
      const value = onOff(int(p[2]));
      return {
        element: el('div', {}, [grid([field(t('ev.field.switch'), from), field(t('ev.field.range_end'), to), field(t('ev.field.value'), value)]), el('p', { className: 'hint', text: t('ev.scope_help') })]),
        read: () => [cmd(Cmd.ControlSwitches, [Number(from.value), Math.max(Number(from.value), Number(to.value)), Number(value.value)])],
      };
    },
    summary: (c, look) => {
      const [a, b] = [int(c.parameters[0]), int(c.parameters[1])];
      return `${a === b ? dataLabel(look.switches, a) : `#${pad(a)}..#${pad(b)}`} = ${onOffName(c.parameters[2])}`;
    },
  },
  {
    code: Cmd.ControlVariables,
    group: 'progress',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [1, 1, 0, 0, 0];
      const from = dataSelect(look.variables, int(p[0], 1));
      const to = dataSelect(look.variables, int(p[1], 1));
      const op = select([['0', t('ev.varop.set')], ['1', t('ev.varop.add')], ['2', t('ev.varop.sub')], ['3', t('ev.varop.mul')], ['4', t('ev.varop.div')], ['5', t('ev.varop.mod')]], String(int(p[2])));
      const kind = select([['0', t('ev.operand.constant')], ['1', t('ev.operand.variable')], ['2', t('ev.operand.random')], ['3', t('ev.operand.game_data')], ['4', t('ev.operand.script')]], String(int(p[3])));
      const extra = el('div', { className: 'form-grid' });
      let read: () => unknown[] = () => [0];
      const render = () => {
        const k = Number(kind.value);
        const q = int(p[3]) === k ? p : [];
        if (k === 0) {
          const v = numberInput(int(q[4]), -99_999_999, 99_999_999);
          extra.replaceChildren(field(t('ev.field.value'), v));
          read = () => [0, readInt(v, -99_999_999, 99_999_999)];
        } else if (k === 1) {
          const v = dataSelect(look.variables, int(q[4], 1));
          extra.replaceChildren(field(t('ev.field.variable'), v));
          read = () => [1, Number(v.value)];
        } else if (k === 2) {
          const min = numberInput(int(q[4]), -99_999_999, 99_999_999);
          const max = numberInput(int(q[5], 10), -99_999_999, 99_999_999);
          extra.replaceChildren(field(t('ev.field.min'), min), field(t('ev.field.max'), max));
          read = () => [2, readInt(min, -99_999_999, 99_999_999), readInt(max, -99_999_999, 99_999_999)];
        } else if (k === 3) {
          const data = select(
            [['0:0', t('ev.gamedata.item')], ['3:0', t('ev.gamedata.level')], ['3:1', t('ev.gamedata.exp')], ['3:2', t('ev.gamedata.hp')], ['3:3', t('ev.gamedata.mp')], ['7:2', t('ev.gamedata.gold')], ['7:0', t('ev.gamedata.map')], ['5:0', t('ev.gamedata.x')], ['5:1', t('ev.gamedata.y')]],
            q.length ? `${int(q[4])}:${int(q[4]) === 0 ? 0 : int(q[4]) === 7 ? int(q[5]) : int(q[6])}` : '3:0',
          );
          const item = entrySelect(look.items, int(q[5], look.items[0]?.id ?? 1));
          const who = characterSelect(look, int(q[5], -1));
          const itemRow = field(t('ev.field.entry'), item);
          const whoRow = field(t('ev.field.character'), who);
          const sync = () => {
            itemRow.classList.toggle('hidden', data.value !== '0:0');
            whoRow.classList.toggle('hidden', !data.value.startsWith('5:'));
          };
          data.addEventListener('change', sync);
          sync();
          extra.replaceChildren(field(t('ev.field.data'), data), itemRow, whoRow);
          read = () => {
            const [type, sub] = data.value.split(':').map(Number) as [number, number];
            if (type === 0) return [3, 0, Number(item.value), 0];
            if (type === 5) return [3, 5, Number(who.value), sub];
            if (type === 7) return [3, 7, sub, 0];
            return [3, 3, 0, sub];
          };
        } else {
          const code = textInput(String(q[4] ?? ''), 1000);
          extra.replaceChildren(field(t('ev.field.expression'), code), el('p', { className: 'hint', text: t('ev.script_help') }));
          read = () => [4, code.value];
        }
      };
      kind.addEventListener('change', render);
      render();
      return {
        element: el('div', {}, [grid([field(t('ev.field.variable'), from), field(t('ev.field.range_end'), to), field(t('ev.field.operation'), op), field(t('ev.field.operand'), kind)]), extra, el('p', { className: 'hint', text: t('ev.scope_help') })]),
        read: () => [cmd(Cmd.ControlVariables, [Number(from.value), Math.max(Number(from.value), Number(to.value)), Number(op.value), ...read()])],
      };
    },
    summary: (c, look) => {
      const p = c.parameters;
      const target = int(p[0]) === int(p[1]) ? dataLabel(look.variables, int(p[0])) : `#${pad(int(p[0]))}..#${pad(int(p[1]))}`;
      const op = ['=', '+=', '-=', '*=', '/=', '%='][int(p[2])] ?? '=';
      const k = int(p[3]);
      const value = k === 0 ? String(int(p[4])) : k === 1 ? dataLabel(look.variables, int(p[4])) : k === 2 ? `${t('ev.operand.random')} ${int(p[4])}..${int(p[5])}` : k === 3 ? t('ev.operand.game_data') : String(p[4] ?? '');
      return `${target} ${op} ${value}`;
    },
  },
  {
    code: Cmd.ControlSelfSwitch,
    group: 'progress',
    form: (_look, block) => {
      const p = block?.[0]?.parameters ?? ['A', 0];
      const l = select(SELF_SWITCHES.map((x): [string, string] => [x, x]), String(p[0] ?? 'A'));
      const v = onOff(int(p[1]));
      return { element: el('div', {}, [grid([field(t('ev.field.self_switch'), l), field(t('ev.field.value'), v)]), el('p', { className: 'hint', text: t('ev.self_help') })]), read: () => [cmd(Cmd.ControlSelfSwitch, [l.value, Number(v.value)])] };
    },
    summary: (c) => `${String(c.parameters[0])} = ${onOffName(c.parameters[1])}`,
  },
  ...([MmoCmd.StartQuest, MmoCmd.AdvanceQuest, MmoCmd.CompleteQuest] as const).map(
    (code): CommandSpec => ({
      code,
      group: 'progress',
      form: (look, block) => {
        const q = entrySelect(look.quests, int(block?.[0]?.parameters[0], look.quests[0]?.id ?? 1));
        const step = numberInput(int(block?.[0]?.parameters[1]), 0, 99);
        const rows = [field(t('ev.field.quest'), q)];
        if (code === MmoCmd.AdvanceQuest) rows.push(field(t('ev.field.step'), step));
        return {
          element: el('div', {}, [grid(rows), code === MmoCmd.AdvanceQuest ? el('p', { className: 'hint', text: t('ev.step_help') }) : null]),
          read: () => [cmd(code, code === MmoCmd.AdvanceQuest ? [Number(q.value), readInt(step, 0, 99)] : [Number(q.value)])],
        };
      },
      summary: (c, look) => `${entryName(look.quests, int(c.parameters[0]))}${c.code === MmoCmd.AdvanceQuest ? ` → ${int(c.parameters[1]) > 0 ? int(c.parameters[1]) : t('ev.next_step')}` : ''}`,
    }),
  ),

  // Player
  {
    code: Cmd.ChangeGold,
    group: 'player',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [0, 0, 10];
      const op = opSelect(int(p[0]));
      const operand = operandInput(look, int(p[1]), int(p[2]), 0, 999_999_999);
      return { element: grid([field(t('ev.field.operation'), op), field(t('ev.field.amount'), operand.element)]), read: () => [cmd(Cmd.ChangeGold, [Number(op.value), ...operand.read()])] };
    },
    summary: (c, look) => `${opSign(c.parameters[0])} ${operandText(look, c.parameters[1], c.parameters[2])}`,
  },
  ...([Cmd.ChangeItems, Cmd.ChangeWeapons, Cmd.ChangeArmors] as const).map(
    (code): CommandSpec => ({
      code,
      group: 'player',
      form: (look, block) => {
        const list = code === Cmd.ChangeItems ? look.items : code === Cmd.ChangeWeapons ? look.weapons : look.armors;
        const p = block?.[0]?.parameters ?? [list[0]?.id ?? 1, 0, 0, 1];
        const entry = entrySelect(list, int(p[0], 1));
        const op = opSelect(int(p[1]));
        const operand = operandInput(look, int(p[2]), int(p[3], 1), 1, 99);
        return {
          element: grid([field(t('ev.field.entry'), entry), field(t('ev.field.operation'), op), field(t('ev.field.quantity'), operand.element)]),
          read: () => [cmd(code, [Number(entry.value), Number(op.value), ...operand.read(), ...(code === Cmd.ChangeItems ? [] : [false])])],
        };
      },
      summary: (c, look) => {
        const list = c.code === Cmd.ChangeItems ? look.items : c.code === Cmd.ChangeWeapons ? look.weapons : look.armors;
        return `${entryName(list, int(c.parameters[0]))} ${opSign(c.parameters[1])} ${operandText(look, c.parameters[2], c.parameters[3])}`;
      },
    }),
  ),
  ...([Cmd.ChangeHp, Cmd.ChangeMp, Cmd.ChangeExp, Cmd.ChangeLevel] as const).map(
    (code): CommandSpec => ({
      code,
      group: 'player',
      form: (look, block) => {
        const p = block?.[0]?.parameters ?? [0, 0, 0, 0, code === Cmd.ChangeLevel ? 1 : 10, code === Cmd.ChangeExp || code === Cmd.ChangeLevel];
        const op = opSelect(int(p[2]));
        const operand = operandInput(look, int(p[3]), int(p[4], 1), 0, 9_999_999);
        const flag = checkbox(p[5] === true);
        const rows = [field(t('ev.field.operation'), op), field(t('ev.field.amount'), operand.element)];
        if (code === Cmd.ChangeHp) rows.push(field(t('ev.field.allow_ko'), flag));
        if (code === Cmd.ChangeExp || code === Cmd.ChangeLevel) rows.push(field(t('ev.field.show_level_up'), flag));
        return { element: grid(rows), read: () => [cmd(code, [0, 0, Number(op.value), ...operand.read(), ...(code === Cmd.ChangeMp ? [] : [flag.checked])])] };
      },
      summary: (c, look) => `${opSign(c.parameters[2])} ${operandText(look, c.parameters[3], c.parameters[4])}`,
    }),
  ),
  { code: Cmd.RecoverAll, group: 'player', form: () => ({ element: el('p', { className: 'hint', text: t('ev.recover_help') }), read: () => [cmd(Cmd.RecoverAll, [0, 0])] }) },
  {
    code: Cmd.ChangeEquipment,
    group: 'player',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [0, 0, 0];
      const slot = select(EQUIP_SLOTS.map((s, i): [string, string] => [String(i), tDynamic(`db.option.${s}`)]), String(int(p[1])));
      const itemBox = el('div');
      let item = entrySelect(look.weapons, int(p[2]), true);
      const sync = () => {
        const wanted = EQUIP_SLOTS[Number(slot.value)];
        const list = slot.value === '0' ? look.weapons : look.armors.filter((a) => !look.armorSlots || look.armorSlots[a.id] === wanted);
        item = entrySelect(list, Number(item.value), true);
        itemBox.replaceChildren(item);
      };
      slot.addEventListener('change', sync);
      sync();
      return { element: el('div', {}, [grid([field(t('ev.field.slot'), slot), field(t('ev.field.entry'), itemBox)]), el('p', { className: 'hint', text: t('ev.equip_help') })]), read: () => [cmd(Cmd.ChangeEquipment, [0, Number(slot.value), Number(item.value)])] };
    },
    summary: (c, look) => {
      const slot = EQUIP_SLOTS[int(c.parameters[1])] ?? 'weapon';
      const id = int(c.parameters[2]);
      return `${tDynamic(`db.option.${slot}`)} = ${id ? entryName(slot === 'weapon' ? look.weapons : look.armors, id) : t('editor.none')}`;
    },
  },

  // Movement
  {
    code: Cmd.TransferPlayer,
    group: 'movement',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [0, look.mapId, 0, 0, 0, 0];
      const byVars = checkbox(int(p[0]) === 1);
      const map = entrySelect(look.maps, int(p[1], look.mapId));
      const x = numberInput(int(p[2]), 0, 255);
      const y = numberInput(int(p[3]), 0, 255);
      const vMap = dataSelect(look.variables, int(p[0]) === 1 ? int(p[1], 1) : 1);
      const vX = dataSelect(look.variables, int(p[0]) === 1 ? int(p[2], 1) : 1);
      const vY = dataSelect(look.variables, int(p[0]) === 1 ? int(p[3], 1) : 1);
      const dir = directionSelect(int(p[4]), true);
      const fade = select([['0', t('ev.fade.black')], ['1', t('ev.fade.white')], ['2', t('ev.fade.none')]], String(int(p[5])));
      const pick = el('button', {
        className: 'button small',
        text: t('editor.pick_on_map'),
        attrs: { type: 'button' },
        on: {
          click: async () => {
            const cell = await look.pickCell(Number(map.value));
            if (cell) {
              x.value = String(cell.x);
              y.value = String(cell.y);
            }
          },
        },
      });
      const direct = grid([field(t('editor.destination_map'), map), field('X', x), field('Y', y), el('div', { className: 'form-row' }, [el('span'), pick])]);
      const fromVars = grid([field(t('ev.field.map_variable'), vMap), field(t('ev.field.x_variable'), vX), field(t('ev.field.y_variable'), vY)]);
      const sync = () => {
        direct.classList.toggle('hidden', byVars.checked);
        fromVars.classList.toggle('hidden', !byVars.checked);
      };
      byVars.addEventListener('change', sync);
      sync();
      return {
        element: el('div', {}, [grid([field(t('ev.field.from_variables'), byVars)]), direct, fromVars, grid([field(t('editor.direction_label'), dir), field(t('ev.field.fade'), fade)])]),
        read: () =>
          byVars.checked
            ? [cmd(Cmd.TransferPlayer, [1, Number(vMap.value), Number(vX.value), Number(vY.value), Number(dir.value), Number(fade.value)])]
            : [cmd(Cmd.TransferPlayer, [0, Number(map.value), readInt(x, 0, 255), readInt(y, 0, 255), Number(dir.value), Number(fade.value)])],
      };
    },
    summary: (c, look) => {
      const p = c.parameters;
      if (int(p[0]) === 1) return `${dataLabel(look.variables, int(p[1]))} (${dataLabel(look.variables, int(p[2]))}, ${dataLabel(look.variables, int(p[3]))})`;
      return `${entryName(look.maps, int(p[1]))} (${int(p[2])}, ${int(p[3])})`;
    },
  },
  {
    code: Cmd.SetMoveRoute,
    group: 'movement',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [0, { list: [{ code: 0 }], repeat: false, skippable: false, wait: true }];
      const who = characterSelect(look, int(p[0]));
      let route = structuredClone((p[1] as MoveRoute | undefined) ?? { list: [{ code: 0 }], repeat: false, skippable: false, wait: true });
      const preview = el('ol', { className: 'route-preview' });
      const renderPreview = () => {
        const rows = route.list.filter((r) => r.code !== RouteCmd.End);
        preview.replaceChildren(...(rows.length ? rows.map((r) => el('li', { text: routeCommandText(r) })) : [el('li', { className: 'hint', text: t('ev.route_empty') })]));
      };
      renderPreview();
      const edit = el('button', {
        className: 'button small',
        text: t('ev.edit_route'),
        attrs: { type: 'button' },
        on: {
          click: async () => {
            const result = await look.editRoute(route);
            if (result) {
              route = result;
              renderPreview();
            }
          },
        },
      });
      return {
        element: el('div', {}, [grid([field(t('ev.field.character'), who)]), preview, edit]),
        read: () => [cmd(Cmd.SetMoveRoute, [Number(who.value), route]), ...routeRows(route)],
      };
    },
    summary: (c, look) => {
      const route = c.parameters[1] as MoveRoute | undefined;
      const flags = [route?.repeat ? t('ev.route.repeat') : '', route?.wait ? t('ev.route.wait') : ''].filter(Boolean).join(', ');
      return `${characterName(look, int(c.parameters[0]))}${flags ? ` (${flags})` : ''}`;
    },
  },
  { code: Cmd.WaitForMovement, group: 'movement' },

  {
    code: Cmd.SetEventLocation,
    group: 'movement',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [0, 0, 0, 0, 0];
      const who = characterSelect(look, int(p[0]), false);
      const mode = select([['0', t('ev.location.cell')], ['1', t('ev.location.variables')], ['2', t('ev.location.swap')]], String(int(p[1])));
      const x = numberInput(int(p[1]) === 0 ? int(p[2]) : 0, 0, 255);
      const y = numberInput(int(p[1]) === 0 ? int(p[3]) : 0, 0, 255);
      const pick = el('button', { className: 'button small', text: t('editor.pick_on_map'), attrs: { type: 'button' } });
      pick.addEventListener('click', () => {
        void look.pickCell(look.mapId).then((cell) => {
          if (!cell) return;
          x.value = String(cell.x);
          y.value = String(cell.y);
        });
      });
      const vX = dataSelect(look.variables, int(p[1]) === 1 ? int(p[2], 1) : 1);
      const vY = dataSelect(look.variables, int(p[1]) === 1 ? int(p[3], 1) : 1);
      const other = characterSelect(look, int(p[1]) === 2 ? int(p[2]) : 0, false);
      const dir = directionSelect(int(p[4]), true);
      const direct = grid([field('X', x), field('Y', y), el('div', { className: 'form-row' }, [el('span'), pick])]);
      const fromVars = grid([field(t('ev.field.x_variable'), vX), field(t('ev.field.y_variable'), vY)]);
      const swap = grid([field(t('ev.field.other_event'), other)]);
      const sync = () => {
        direct.classList.toggle('hidden', mode.value !== '0');
        fromVars.classList.toggle('hidden', mode.value !== '1');
        swap.classList.toggle('hidden', mode.value !== '2');
      };
      mode.addEventListener('change', sync);
      sync();
      return {
        element: el('div', {}, [grid([field(t('ev.field.character'), who), field(t('ev.field.location_mode'), mode)]), direct, fromVars, swap, grid([field(t('editor.direction_label'), dir)])]),
        read: () => {
          const m = Number(mode.value);
          const [a, b] = m === 0 ? [readInt(x, 0, 255), readInt(y, 0, 255)] : m === 1 ? [Number(vX.value), Number(vY.value)] : [Number(other.value), 0];
          return [cmd(Cmd.SetEventLocation, [Number(who.value), m, a, b, Number(dir.value)])];
        },
      };
    },
    summary: (c, look) => {
      const p = c.parameters;
      const where = int(p[1]) === 2 ? `⇄ ${characterName(look, int(p[2]))}` : int(p[1]) === 1 ? `(${dataLabel(look.variables, int(p[2]))}, ${dataLabel(look.variables, int(p[3]))})` : `(${int(p[2])}, ${int(p[3])})`;
      return `${characterName(look, int(p[0]))} → ${where}`;
    },
  },
  {
    code: Cmd.ScrollMap,
    group: 'movement',
    form: (_look, block) => {
      const p = block?.[0]?.parameters ?? [2, 5, 4, true];
      const dir = directionSelect(int(p[0], 2));
      const distance = numberInput(int(p[1], 5), 1, 100);
      const speed = select([1, 2, 3, 4, 5, 6].map((v): [string, string] => [String(v), tDynamic(`ev.speed.${v}`)]), String(int(p[2], 4)));
      const wait = checkbox(p[3] === true);
      return {
        element: el('div', {}, [grid([field(t('editor.direction_label'), dir), field(t('ev.field.distance'), distance), field(t('ev.field.speed'), speed), field(t('ev.field.wait_end'), wait)]), el('p', { className: 'hint', text: t('ev.scroll_help') })]),
        read: () => [cmd(Cmd.ScrollMap, [Number(dir.value), readInt(distance, 1, 100), Number(speed.value), wait.checked])],
      };
    },
    summary: (c) => `${directionName(int(c.parameters[0]))}, ${int(c.parameters[1])}`,
  },
  {
    code: Cmd.ChangeTransparency,
    group: 'movement',
    form: (_look, block) => {
      const state = select([['0', t('ev.transparent.on')], ['1', t('ev.transparent.off')]], String(int(block?.[0]?.parameters[0])));
      return { element: el('div', {}, [grid([field(t('ev.field.transparency'), state)]), el('p', { className: 'hint', text: t('ev.transparent_help') })]), read: () => [cmd(Cmd.ChangeTransparency, [Number(state.value)])] };
    },
    summary: (c) => (int(c.parameters[0]) === 0 ? t('ev.transparent.on') : t('ev.transparent.off')),
  },

  // Timer and location information
  {
    code: Cmd.ControlTimer,
    group: 'progress',
    form: (_look, block) => {
      const p = block?.[0]?.parameters ?? [0, 60];
      const op = select([['0', t('ev.timer.start')], ['1', t('ev.timer.stop')]], String(int(p[0])));
      const total = int(p[1], 60);
      const minutes = numberInput(Math.floor(total / 60), 0, 99);
      const seconds = numberInput(total % 60, 0, 59);
      const time = grid([field(t('ev.field.minutes'), minutes), field(t('ev.field.seconds'), seconds)]);
      const sync = () => time.classList.toggle('hidden', op.value === '1');
      op.addEventListener('change', sync);
      sync();
      return {
        element: el('div', {}, [grid([field(t('ev.field.operation'), op)]), time, el('p', { className: 'hint', text: t('ev.timer_help') })]),
        read: () => [cmd(Cmd.ControlTimer, op.value === '1' ? [1, 0] : [0, readInt(minutes, 0, 99) * 60 + readInt(seconds, 0, 59)])],
      };
    },
    summary: (c) => (int(c.parameters[0]) === 1 ? t('ev.timer.stop') : `${t('ev.timer.start')} ${Math.floor(int(c.parameters[1]) / 60)}:${String(int(c.parameters[1]) % 60).padStart(2, '0')}`),
  },
  {
    code: Cmd.GetLocationInfo,
    group: 'progress',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [1, 0, 0, 0, 0];
      const variable = dataSelect(look.variables, int(p[0], 1));
      const info = select([0, 1, 2, 3, 4, 5, 6].map((i): [string, string] => [String(i), tDynamic(`ev.location_info.${i}`)]), String(int(p[1])));
      const byVars = checkbox(int(p[2]) === 1);
      const x = numberInput(int(p[2]) === 1 ? 0 : int(p[3]), 0, 255);
      const y = numberInput(int(p[2]) === 1 ? 0 : int(p[4]), 0, 255);
      const vX = dataSelect(look.variables, int(p[2]) === 1 ? int(p[3], 1) : 1);
      const vY = dataSelect(look.variables, int(p[2]) === 1 ? int(p[4], 1) : 1);
      const direct = grid([field('X', x), field('Y', y)]);
      const fromVars = grid([field(t('ev.field.x_variable'), vX), field(t('ev.field.y_variable'), vY)]);
      const sync = () => {
        direct.classList.toggle('hidden', byVars.checked);
        fromVars.classList.toggle('hidden', !byVars.checked);
      };
      byVars.addEventListener('change', sync);
      sync();
      return {
        element: el('div', {}, [grid([field(t('ev.field.variable'), variable), field(t('ev.field.info'), info), field(t('ev.field.from_variables'), byVars)]), direct, fromVars]),
        read: () => [cmd(Cmd.GetLocationInfo, byVars.checked ? [Number(variable.value), Number(info.value), 1, Number(vX.value), Number(vY.value)] : [Number(variable.value), Number(info.value), 0, readInt(x, 0, 255), readInt(y, 0, 255)])],
      };
    },
    summary: (c, look) => `${dataLabel(look.variables, int(c.parameters[0]))} = ${tDynamic(`ev.location_info.${int(c.parameters[1])}`)}`,
  },

  // Effects
  ...([Cmd.ShowAnimation, Cmd.ShowBalloon] as const).map(
    (code): CommandSpec => ({
      code,
      group: 'effects',
      form: (look, block) => {
        const p = block?.[0]?.parameters ?? [0, 1, false];
        const who = characterSelect(look, int(p[0]));
        const what =
          code === Cmd.ShowAnimation
            ? entrySelect(look.animations, int(p[1], look.animations[0]?.id ?? 1))
            : select(Array.from({ length: 10 }, (_, i): [string, string] => [String(i + 1), tDynamic(`ev.balloon.${i + 1}`)]), String(int(p[1], 1)));
        const wait = checkbox(p[2] === true);
        return {
          element: grid([field(t('ev.field.character'), who), field(code === Cmd.ShowAnimation ? t('ev.field.animation') : t('ev.field.balloon'), what), field(t('ev.field.wait_end'), wait)]),
          read: () => [cmd(code, [Number(who.value), Number(what.value), wait.checked])],
        };
      },
      summary: (c, look) => `${characterName(look, int(c.parameters[0]))}, ${c.code === Cmd.ShowAnimation ? entryName(look.animations, int(c.parameters[1])) : tDynamic(`ev.balloon.${int(c.parameters[1], 1)}`)}`,
    }),
  ),
  { code: Cmd.EraseEvent, group: 'effects' },
  {
    code: Cmd.PlaySe,
    group: 'audio',
    form: (look, block) => {
      const se = (block?.[0]?.parameters[0] ?? { name: '', volume: 90, pitch: 100, pan: 0 }) as { name: string; volume: number; pitch: number; pan: number };
      const name = look.resources.se.length > 0 ? required(resourceSelect(look.resources.se, se.name, false)) : resourceSelect(look.resources.se, se.name, true);
      const volume = numberInput(int(se.volume, 90), 0, 100);
      const pitch = numberInput(int(se.pitch, 100), 50, 150);
      const note = look.resources.se.length === 0 ? el('p', { className: 'hint', text: t('ev.no_se') }) : null;
      return {
        element: el('div', {}, [grid([field(t('ev.field.sound'), withListen(name, 'se', look)), field(t('ev.field.volume'), volume), field(t('ev.field.pitch'), pitch)]), note]),
        read: () => [cmd(Cmd.PlaySe, [{ name: name.value, volume: readInt(volume, 0, 100), pitch: readInt(pitch, 50, 150), pan: 0 }])],
      };
    },
    summary: (c) => String((c.parameters[0] as { name?: string } | undefined)?.name ?? ''),
  },

  { code: Cmd.FadeOut, group: 'effects' },
  { code: Cmd.FadeIn, group: 'effects' },
  {
    code: Cmd.TintScreen,
    group: 'effects',
    form: (_look, block) => {
      const p = block?.[0]?.parameters ?? [[0, 0, 0, 0], 60, true];
      const tone = Array.isArray(p[0]) ? (p[0] as unknown[]) : [0, 0, 0, 0];
      const presets: [string, number[]][] = [
        [t('ev.tone.normal'), [0, 0, 0, 0]],
        [t('ev.tone.night'), [-68, -68, 0, 68]],
        [t('ev.tone.dusk'), [68, -34, -34, 0]],
        [t('ev.tone.dark'), [-120, -120, -120, 0]],
        [t('ev.tone.sepia'), [34, -34, -68, 170]],
      ];
      const inputs = [0, 1, 2, 3].map((i) => numberInput(int(tone[i]), i === 3 ? 0 : -255, 255));
      const preset = select([['', '—'], ...presets.map(([label], i): [string, string] => [String(i), label])], '');
      preset.addEventListener('change', () => {
        const values = presets[Number(preset.value)]?.[1];
        if (values) values.forEach((v, i) => (inputs[i]!.value = String(v)));
      });
      const frames = numberInput(int(p[1], 60), 0, 3600);
      const wait = checkbox(p[2] === true);
      return {
        element: grid([
          field(t('ev.field.preset'), preset),
          field(t('ev.field.red'), inputs[0]!),
          field(t('ev.field.green'), inputs[1]!),
          field(t('ev.field.blue'), inputs[2]!),
          field(t('ev.field.gray'), inputs[3]!),
          field(t('ev.field.frames'), frames),
          field(t('ev.field.wait_end'), wait),
        ]),
        read: () => [cmd(Cmd.TintScreen, [inputs.map((input, i) => readInt(input, i === 3 ? 0 : -255, 255)), readInt(frames, 0, 3600), wait.checked])],
      };
    },
    summary: (c) => `(${(Array.isArray(c.parameters[0]) ? (c.parameters[0] as unknown[]) : []).map((v) => int(v)).join(', ')}), ${int(c.parameters[1])} ${t('ev.frames_unit')}${c.parameters[2] === true ? ` (${t('ev.wait_short')})` : ''}`,
  },
  {
    code: Cmd.FlashScreen,
    group: 'effects',
    form: (_look, block) => {
      const p = block?.[0]?.parameters ?? [[255, 255, 255, 170], 30, true];
      const color = Array.isArray(p[0]) ? (p[0] as unknown[]) : [255, 255, 255, 170];
      const hex = (i: number) => int(color[i], 255).toString(16).padStart(2, '0');
      const picker = el('input', { attrs: { type: 'color' } });
      picker.value = `#${hex(0)}${hex(1)}${hex(2)}`;
      const strength = numberInput(int(color[3], 170), 0, 255);
      const frames = numberInput(int(p[1], 30), 1, 3600);
      const wait = checkbox(p[2] === true);
      return {
        element: grid([field(t('ev.field.color'), picker), field(t('ev.field.intensity'), strength), field(t('ev.field.frames'), frames), field(t('ev.field.wait_end'), wait)]),
        read: () => {
          const v = picker.value.replace('#', '');
          const rgb = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0);
          return [cmd(Cmd.FlashScreen, [[...rgb, readInt(strength, 0, 255)], readInt(frames, 1, 3600), wait.checked])];
        },
      };
    },
    summary: (c) => `${int(c.parameters[1])} ${t('ev.frames_unit')}${c.parameters[2] === true ? ` (${t('ev.wait_short')})` : ''}`,
  },
  {
    code: Cmd.ShakeScreen,
    group: 'effects',
    form: (_look, block) => {
      const p = block?.[0]?.parameters ?? [5, 5, 60, true];
      const power = numberInput(int(p[0], 5), 1, 9);
      const speed = numberInput(int(p[1], 5), 1, 9);
      const frames = numberInput(int(p[2], 60), 1, 3600);
      const wait = checkbox(p[3] === true);
      return {
        element: grid([field(t('ev.field.power'), power), field(t('ev.field.speed'), speed), field(t('ev.field.frames'), frames), field(t('ev.field.wait_end'), wait)]),
        read: () => [cmd(Cmd.ShakeScreen, [readInt(power, 1, 9), readInt(speed, 1, 9), readInt(frames, 1, 3600), wait.checked])],
      };
    },
    summary: (c) => `${t('ev.field.power')} ${int(c.parameters[0], 5)}, ${int(c.parameters[2])} ${t('ev.frames_unit')}${c.parameters[3] === true ? ` (${t('ev.wait_short')})` : ''}`,
  },

  // Music and sounds
  ...([Cmd.PlayBgm, Cmd.PlayBgs, Cmd.PlayMe] as const).map(
    (code): CommandSpec => ({
      code,
      group: 'audio',
      form: (look, block) => {
        const audio = (block?.[0]?.parameters[0] ?? { name: '', volume: 90, pitch: 100, pan: 0 }) as { name: string; volume: number; pitch: number };
        const list = code === Cmd.PlayBgm ? look.resources.bgm : code === Cmd.PlayBgs ? look.resources.bgs : look.resources.me;
        // Music and ambience: "none" stops what plays. A jingle needs a file when one exists.
        const name = code === Cmd.PlayMe && list.length > 0 ? required(resourceSelect(list, String(audio.name ?? ''), false)) : resourceSelect(list, String(audio.name ?? ''));
        const volume = numberInput(int(audio.volume, 90), 0, 100);
        const pitch = numberInput(int(audio.pitch, 100), 50, 150);
        const note = list.length === 0 ? el('p', { className: 'hint', text: t('ev.no_music') }) : null;
        return {
          element: el('div', {}, [grid([field(t('ev.field.sound'), withListen(name, code === Cmd.PlayBgm ? 'bgm' : code === Cmd.PlayBgs ? 'bgs' : 'me', look)), field(t('ev.field.volume'), volume), field(t('ev.field.pitch'), pitch)]), note, el('p', { className: 'hint', text: t(code === Cmd.PlayMe ? 'ev.me_help' : 'ev.music_help') })]),
          read: () => [cmd(code, [{ name: name.value, volume: readInt(volume, 0, 100), pitch: readInt(pitch, 50, 150), pan: 0 }])],
        };
      },
      summary: (c) => String((c.parameters[0] as { name?: string } | undefined)?.name || t('editor.none')),
    }),
  ),
  ...([Cmd.FadeoutBgm, Cmd.FadeoutBgs] as const).map(
    (code): CommandSpec => ({
      code,
      group: 'audio',
      form: (_look, block) => {
        const seconds = numberInput(int(block?.[0]?.parameters[0], 2), 0, 60);
        return { element: grid([field(t('ev.field.seconds'), seconds)]), read: () => [cmd(code, [readInt(seconds, 0, 60)])] };
      },
      summary: (c) => `${int(c.parameters[0])} s`,
    }),
  ),
  { code: Cmd.SaveBgm, group: 'audio' },
  { code: Cmd.ResumeBgm, group: 'audio' },
  { code: Cmd.StopSe, group: 'audio' },

  // Pictures, weather and background
  {
    code: Cmd.ShowPicture,
    group: 'pictures',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [1, '', 0, 0, 0, 0, 100, 100, 255, 0];
      const number = numberInput(int(p[0], 1), 1, PICTURE_COUNT);
      const name = look.resources.pictures.length > 0 ? required(resourceSelect(look.resources.pictures, String(p[1] ?? ''), false)) : resourceSelect(look.resources.pictures, String(p[1] ?? ''), true);
      const layout = pictureLayoutForm(look, p);
      const note = look.resources.pictures.length === 0 ? el('p', { className: 'hint', text: t('ev.no_picture') }) : null;
      return {
        element: el('div', {}, [grid([field(t('ev.field.picture_number'), number), field(t('ev.field.picture'), name)]), layout.element, note, el('p', { className: 'hint', text: t('ev.picture_help') })]),
        read: () => [cmd(Cmd.ShowPicture, [readInt(number, 1, PICTURE_COUNT), name.value, ...layout.read()])],
      };
    },
    summary: (c) => `#${int(c.parameters[0])} ${String(c.parameters[1] ?? '')} (${int(c.parameters[4])}, ${int(c.parameters[5])})`,
  },
  {
    code: Cmd.MovePicture,
    group: 'pictures',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [1, 0, 0, 0, 0, 0, 100, 100, 255, 0, 60, true, 0];
      const number = numberInput(int(p[0], 1), 1, PICTURE_COUNT);
      const layout = pictureLayoutForm(look, p);
      const frames = numberInput(int(p[10], 60), 1, 3600);
      const wait = checkbox(p[11] === true);
      const easing = select([0, 1, 2, 3].map((e): [string, string] => [String(e), tDynamic(`ev.easing.${e}`)]), String(int(p[12])));
      return {
        element: el('div', {}, [grid([field(t('ev.field.picture_number'), number)]), layout.element, grid([field(t('ev.field.frames'), frames), field(t('ev.field.easing'), easing), field(t('ev.field.wait_end'), wait)])]),
        read: () => [cmd(Cmd.MovePicture, [readInt(number, 1, PICTURE_COUNT), 0, ...layout.read(), readInt(frames, 1, 3600), wait.checked, Number(easing.value)])],
      };
    },
    summary: (c) => `#${int(c.parameters[0])} (${int(c.parameters[4])}, ${int(c.parameters[5])}), ${int(c.parameters[10])} ${t('ev.frames_unit')}${c.parameters[11] === true ? ` (${t('ev.wait_short')})` : ''}`,
  },
  {
    code: Cmd.RotatePicture,
    group: 'pictures',
    form: (_look, block) => {
      const number = numberInput(int(block?.[0]?.parameters[0], 1), 1, PICTURE_COUNT);
      const speed = numberInput(int(block?.[0]?.parameters[1], 10), -90, 90);
      return { element: el('div', {}, [grid([field(t('ev.field.picture_number'), number), field(t('ev.field.speed'), speed)]), el('p', { className: 'hint', text: t('ev.rotate_help') })]), read: () => [cmd(Cmd.RotatePicture, [readInt(number, 1, PICTURE_COUNT), readInt(speed, -90, 90)])] };
    },
    summary: (c) => `#${int(c.parameters[0])}, ${int(c.parameters[1])}`,
  },
  {
    code: Cmd.TintPicture,
    group: 'pictures',
    form: (_look, block) => {
      const p = block?.[0]?.parameters ?? [1, [0, 0, 0, 0], 60, true];
      const number = numberInput(int(p[0], 1), 1, PICTURE_COUNT);
      const tone = toneFields(Array.isArray(p[1]) ? (p[1] as unknown[]) : [0, 0, 0, 0]);
      const frames = numberInput(int(p[2], 60), 0, 3600);
      const wait = checkbox(p[3] === true);
      return {
        element: el('div', {}, [grid([field(t('ev.field.picture_number'), number)]), tone.element, grid([field(t('ev.field.frames'), frames), field(t('ev.field.wait_end'), wait)])]),
        read: () => [cmd(Cmd.TintPicture, [readInt(number, 1, PICTURE_COUNT), tone.read(), readInt(frames, 0, 3600), wait.checked])],
      };
    },
    summary: (c) => `#${int(c.parameters[0])} (${(Array.isArray(c.parameters[1]) ? (c.parameters[1] as unknown[]) : []).map((v) => int(v)).join(', ')})`,
  },
  {
    code: Cmd.ErasePicture,
    group: 'pictures',
    form: (_look, block) => {
      const number = numberInput(int(block?.[0]?.parameters[0], 1), 1, PICTURE_COUNT);
      return { element: grid([field(t('ev.field.picture_number'), number)]), read: () => [cmd(Cmd.ErasePicture, [readInt(number, 1, PICTURE_COUNT)])] };
    },
    summary: (c) => `#${int(c.parameters[0])}`,
  },
  {
    code: Cmd.SetWeather,
    group: 'pictures',
    form: (_look, block) => {
      const p = block?.[0]?.parameters ?? ['rain', 5, 60, false];
      const type = select(WEATHER_TYPES.map((w): [string, string] => [w, tDynamic(`ev.weather.${w}`)]), WEATHER_TYPES.includes(p[0] as never) ? String(p[0]) : 'none');
      const power = numberInput(int(p[1], 5), 1, 9);
      const frames = numberInput(int(p[2], 60), 0, 3600);
      const wait = checkbox(p[3] === true);
      return {
        element: el('div', {}, [grid([field(t('ev.field.weather'), type), field(t('ev.field.power'), power), field(t('ev.field.frames'), frames), field(t('ev.field.wait_end'), wait)]), el('p', { className: 'hint', text: t('ev.weather_help') })]),
        read: () => [cmd(Cmd.SetWeather, [type.value, readInt(power, 1, 9), readInt(frames, 0, 3600), wait.checked])],
      };
    },
    summary: (c) => `${tDynamic(`ev.weather.${WEATHER_TYPES.includes(c.parameters[0] as never) ? String(c.parameters[0]) : 'none'}`)}${String(c.parameters[0]) !== 'none' ? `, ${int(c.parameters[1], 5)}` : ''}`,
  },
  {
    code: Cmd.ChangeParallax,
    group: 'pictures',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? ['', false, false, 0, 0];
      const name = resourceSelect(look.resources.parallaxes, String(p[0] ?? ''));
      const loopX = checkbox(p[1] === true);
      const loopY = checkbox(p[2] === true);
      const sx = numberInput(int(p[3]), -32, 32);
      const sy = numberInput(int(p[4]), -32, 32);
      return {
        element: el('div', {}, [grid([field(t('editor.parallax'), name), field(t('editor.parallax_loop_x'), loopX), field(t('editor.parallax_loop_y'), loopY), field(t('editor.parallax_speed_x'), sx), field(t('editor.parallax_speed_y'), sy)]), el('p', { className: 'hint', text: t('ev.parallax_help') })]),
        read: () => [cmd(Cmd.ChangeParallax, [name.value, loopX.checked, loopY.checked, readInt(sx, -32, 32), readInt(sy, -32, 32)])],
      };
    },
    summary: (c) => String(c.parameters[0] || t('editor.none')),
  },

  // Scene
  {
    code: Cmd.ShopProcessing,
    group: 'scene',
    form: (look, block) => {
      const goods = (block ?? []).filter((c) => c.code === Cmd.ShopProcessing || c.code === Cmd.ShopItem).map((c) => c.parameters);
      const purchaseOnly = checkbox(block?.[0]?.parameters[4] === true);
      const rows = el('div', { className: 'shop-rows' });
      const addRow = (q: unknown[]) => {
        const kind = select([['0', t('db.tab.item')], ['1', t('db.tab.weapon')], ['2', t('db.tab.armor')]], String(int(q[0])));
        const itemBox = el('span');
        let entry = entrySelect(look.items, int(q[1], look.items[0]?.id ?? 1));
        const sync = () => {
          const list = kind.value === '0' ? look.items : kind.value === '1' ? look.weapons : look.armors;
          entry = entrySelect(list, Number(entry.value));
          itemBox.replaceChildren(entry);
        };
        kind.addEventListener('change', sync);
        sync();
        const custom = checkbox(int(q[2]) === 1);
        const price = numberInput(int(q[3]), 0, 99_999_999);
        const row = el('div', { className: 'inline-row shop-row' }, [
          kind, itemBox, el('label', { className: 'inline-check' }, [custom, el('span', { text: t('ev.field.custom_price') })]), price,
          el('button', { className: 'button small danger', text: '×', attrs: { type: 'button', title: t('editor.delete') }, on: { click: () => row.remove() } }),
        ]);
        (row as HTMLElement & { read?: () => unknown[] }).read = () => [Number(kind.value), Number(entry.value), custom.checked ? 1 : 0, custom.checked ? readInt(price, 0, 99_999_999) : 0];
        rows.append(row);
      };
      (goods.length ? goods : [[0, look.items[0]?.id ?? 1, 0, 0]]).forEach(addRow);
      const add = el('button', { className: 'button small', text: t('ev.add_good'), attrs: { type: 'button' }, on: { click: () => addRow([0, look.items[0]?.id ?? 1, 0, 0]) } });
      return {
        element: el('div', {}, [rows, add, grid([field(t('ev.field.purchase_only'), purchaseOnly)]), el('p', { className: 'hint', text: t('ev.later_shop') })]),
        read: () => {
          const list = [...rows.children].map((r) => (r as HTMLElement & { read: () => unknown[] }).read());
          if (list.length === 0) throw Object.assign(new Error('goods'), { key: 'ev.error.no_goods' });
          return [cmd(Cmd.ShopProcessing, [...list[0]!, purchaseOnly.checked]), ...list.slice(1).map((q) => cmd(Cmd.ShopItem, q))];
        },
      };
    },
    summary: (c, look) => {
      const list = [look.items, look.weapons, look.armors][int(c.parameters[0])] ?? look.items;
      return entryName(list, int(c.parameters[1]));
    },
  },
  {
    code: MmoCmd.SetRespawn,
    group: 'player',
    form: (look, block) => {
      const p = block?.[0]?.parameters ?? [0, look.mapId, 0, 0];
      const mode = select([['0', t('ev.respawn_here')], ['1', t('ev.respawn_cell')]], String(int(p[0])));
      const map = entrySelect(look.maps, int(p[1], look.mapId));
      const x = numberInput(int(p[2]), 0, 255);
      const y = numberInput(int(p[3]), 0, 255);
      const pick = el('button', { className: 'button small', text: t('db.pick_cell'), attrs: { type: 'button' } });
      pick.addEventListener('click', () => {
        void look.pickCell(Number(map.value)).then((cell) => {
          if (!cell) return;
          x.value = String(cell.x);
          y.value = String(cell.y);
          mode.value = '1';
        });
      });
      return {
        element: grid([field(t('ev.field.respawn_mode'), mode), field(t('editor.destination_map'), map), field('X', x), field('Y', y), el('div', { className: 'form-row' }, [el('span'), pick])]),
        read: () => [cmd(MmoCmd.SetRespawn, [Number(mode.value), Number(map.value), readInt(x, 0, 255), readInt(y, 0, 255)])],
      };
    },
    summary: (c, look) => (int(c.parameters[0]) === 1 ? `${entryName(look.maps, int(c.parameters[1]))} (${int(c.parameters[2])}, ${int(c.parameters[3])})` : t('ev.respawn_here')),
  },
  { code: MmoCmd.OpenBank, group: 'scene' },
  {
    code: MmoCmd.OpenInn,
    group: 'scene',
    form: (_look, block) => {
      const price = numberInput(int(block?.[0]?.parameters[0], 20), 0, 99_999_999);
      return { element: el('div', {}, [grid([field(t('ev.field.price'), price)]), el('p', { className: 'hint', text: t('ev.inn_help') })]), read: () => [cmd(MmoCmd.OpenInn, [readInt(price, 0, 99_999_999)])] };
    },
    summary: (c) => `${int(c.parameters[0])}`,
  },
  {
    code: Cmd.BattleProcessing,
    group: 'scene',
    form: (look, block) => {
      const enemy = entrySelect(look.enemies, int(block?.[0]?.parameters[1], look.enemies[0]?.id ?? 1));
      return { element: el('div', {}, [grid([field(t('ev.field.enemy'), enemy)]), el('p', { className: 'hint', text: t('ev.battle_help') })]), read: () => [cmd(Cmd.BattleProcessing, [0, Number(enemy.value), false, false])] };
    },
    summary: (c, look) => entryName(look.enemies, int(c.parameters[1])),
  },
  {
    code: Cmd.Script,
    group: 'scene',
    form: (_look, block) => {
      const code = required(textArea([String(block?.[0]?.parameters[0] ?? ''), ...blockLines(block)].join('\n'), 8, 20_000));
      code.classList.add('json-area');
      code.spellcheck = false;
      return { element: el('div', {}, [grid([field(t('ev.field.script'), code)]), el('p', { className: 'hint', text: t('ev.script_api') })]), read: () => linesBlock(Cmd.Script, Cmd.ScriptLine, linesOf(code)) };
    },
    summary: (c) => String(c.parameters[0] ?? ''),
  },
];

/** Spec of a command code. */
export function specOf(code: number): CommandSpec | undefined {
  return COMMAND_SPECS.find((s) => s.code === code);
}

/** Name of a command code (translated), or a generic label for unknown codes. */
export function commandName(code: number): string {
  return specOf(code) ? tDynamic(`ev.cmd.${code}`) : t('ev.cmd.unknown', { code });
}

/**
 * Text of one row of the command list (continuation rows included).
 * @param list - Command list.
 * @param index - Row.
 * @param look - Lookups for names.
 */
export function rowText(list: readonly EventCommand[], index: number, look: CommandLookups): string {
  const c = list[index]!;
  const p = c.parameters;
  switch (c.code) {
    case Cmd.End: return '◆';
    case Cmd.TextLine: return `: ${String(p[0] ?? '')}`;
    case Cmd.CommentLine: return `: ${String(p[0] ?? '')}`;
    case Cmd.ScriptLine: return `: ${String(p[0] ?? '')}`;
    case Cmd.When: return `: ${t('ev.row.when')} ${String(p[1] ?? '')}`;
    case Cmd.WhenCancel: return `: ${t('ev.row.when_cancel')}`;
    case Cmd.ChoicesEnd: return `: ${t('ev.row.end')}`;
    case Cmd.Else: return `: ${t('ev.row.else')}`;
    case Cmd.IfEnd: return `: ${t('ev.row.end')}`;
    case Cmd.LoopEnd: return `: ${t('ev.row.repeat')}`;
    case Cmd.MoveRouteLine: return `: ◇ ${routeCommandText((p[0] ?? { code: 0 }) as { code: number; parameters?: unknown[] })}`;
    case Cmd.ShopItem: {
      const list = [look.items, look.weapons, look.armors][int(p[0])] ?? look.items;
      return `: ${entryName(list, int(p[1]))}`;
    }
    default: {
      const spec = specOf(c.code);
      const summary = spec?.summary?.(c, look) ?? '';
      return `◆ ${commandName(c.code)}${summary ? ` : ${summary}` : ''}`;
    }
  }
}
