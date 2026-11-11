/**
 * @file Database window of the editor: one tab per record type (classes,
 * skills, items, weapons, armors, enemies, states, animations, common
 * events, quests), plus the System and Terms settings and the declaration of
 * switches and variables (with their personal or global scope). Common
 * events are edited with the same visual command list as map events.
 *
 * Each tab shows the list of records on the left and, on the right, a form
 * generated from the shared schema (`shared/database-schema.ts`), so the form
 * always matches what the server accepts. Saving sends the record to the
 * server, which normalises it and makes it available in game at once.
 * The whole database can be exported to and imported from a JSON file.
 */
import { drawCharacterFrame, HAIR_STYLES, sanitizeAppearance, type CharacterAppearance } from '../../shared/art/character.js';
import { HAIR_RAMPS, OUTFIT_RAMPS } from '../../shared/art/palette.js';
import { KIND_GROUPS, SCHEMAS, activeFields, completeValues, fieldApplies, fieldDefault, findMissingRef, normalizeRecord, walkFields, type Field, type SystemList } from '../../shared/database-schema.js';
import { DATABASE_TYPES, PARAMS, expForLevel, paramAt, type DatabaseType, type DatabaseUsage, type ParamCurve, type ParamName } from '../../shared/database.js';
import { ICON_COLUMNS, iconIndex, type IconName } from '../../shared/icons.js';
import type { SystemSettings } from '../../shared/settings.js';
import { rasterize } from '../art/render.js';
import type { AssetStore } from '../engine/assets.js';
import { sheetFlags } from '../engine/character.js';
import { t, tDynamic } from '../i18n.js';
import { confirmDialog, confirmWithOption } from '../ui/dialog.js';
import { el, icon } from '../ui/dom.js';
import { AnimationPreview, type AnimationLook } from './animation-preview.js';
import { EditorApiError, type EditorApi } from './api.js';
import type { CommandLookups } from './command-specs.js';
import { openModal } from './dialogs.js';
import { CommandListEditor } from './event-editor.js';
import { recordPicker } from './record-picker.js';
import { pickCharacter } from './character-picker.js';
import type { EventCommand } from '../../shared/events.js';

type AnyRecord = { id: number; name: string } & Record<string, unknown>;
type Tab = DatabaseType | 'system' | 'terms' | 'switches';

/** Tabs holding settings rather than records. */
const isSettingsTab = (tab: Tab): tab is 'system' | 'terms' | 'switches' => tab === 'system' || tab === 'terms' || tab === 'switches';

/** Lists shared by the forms (references to other records, resources). */
interface Lookups {
  records: Partial<Record<DatabaseType, AnyRecord[]>>;
  resources: Record<string, string[]>;
  system: SystemSettings | null;
  /** Image store, to preview sprites. */
  assets?: AssetStore;
  /** Lookups of the command editor (loaded for the common events and quests tabs: maps, cell picker). */
  commands?: CommandLookups & { host: HTMLElement };
  /** Events of a map, for event pickers. */
  mapEvents?: (mapId: number) => Promise<{ id: number; name: string }[]>;
  /** Opens a record in its tab ("used by" links). */
  goTo?: (type: DatabaseType, id: number) => void;
}

const label = (key: string) => tDynamic(`db.field.${key}`);

/**
 * A record named `---Something` is a separator: the creator's heading in the list (as in other
 * editors' databases), never offered where a record is chosen.
 */
const isSeparator = (name: unknown) => /^\s*-{3,}/.test(String(name ?? ''));
/** Title of a separator: its name without the dashes. */
const separatorTitle = (name: string) => name.replace(/^\s*-+\s*/, '').replace(/\s*-+\s*$/, '');

/** Record types with an icon: references to them are picked in a list showing it. */
const ICON_TYPES: ReadonlySet<DatabaseType> = new Set(['class', 'skill', 'item', 'weapon', 'armor', 'state', 'quest']);

/** Computed blocks a panel may end with. */
type PanelExtra = 'rates' | 'stateMessage' | 'skillMessage' | 'usedBy' | 'expTable' | 'animation';

/** Ready-made damage formulas (translation key of the role, formula). */
const FORMULA_TEMPLATES: [string, string][] = [
  ['physical_light', 'a.atk * 2 - b.def'],
  ['physical', 'a.atk * 4 - b.def * 2'],
  ['physical_strong', 'a.atk * 6 - b.def * 2'],
  ['magic', 'a.mat * 3 - b.mdf'],
  ['magic_strong', 'a.mat * 5 - b.mdf * 2'],
  ['heal', 'a.mat * 3 + 20'],
  ['heal_strong', 'a.mat * 5 + 50'],
  ['fixed', '50'],
];

/** Growth levels offered in words, from the weakest to the strongest. */
const CURVE_LEVELS = ['very_low', 'low', 'medium', 'high', 'very_high'] as const;

/**
 * Level 1 value and growth per level of each growth level, by kind of parameter (calibrated on the demo
 * classes: a warrior has high HP, a mage very high magic attack).
 */
const CURVE_TABLE: Record<'mhp' | 'mmp' | 'other', [number, number][]> = {
  mhp: [[60, 6], [80, 10], [100, 14], [120, 18], [150, 24]],
  mmp: [[10, 1], [20, 3], [40, 5], [60, 8], [80, 11]],
  other: [[5, 0.5], [8, 1], [11, 1.5], [15, 2.5], [18, 3.5]],
};

/** Base and growth of a parameter at a growth level (0-4). */
function curveOf(p: ParamName, level: number): [number, number] {
  const table = p === 'mhp' || p === 'mmp' ? CURVE_TABLE[p] : CURVE_TABLE.other;
  return table[Math.max(0, Math.min(table.length - 1, level))]!;
}

/** Growth level matching a curve exactly, or `-1` for a hand-made one. */
function curveLevel(p: ParamName, curve: ParamCurve): number {
  return CURVE_LEVELS.findIndex((_, i) => {
    const [base, growth] = curveOf(p, i);
    return curve.base === base && curve.growth === growth;
  });
}

/** Ready-made sets of curves (growth level of every parameter). */
const ARCHETYPES: Record<string, Record<ParamName, number>> = {
  tank: { mhp: 4, mmp: 1, atk: 2, def: 4, mat: 0, mdf: 3, agi: 0, luk: 1 },
  warrior: { mhp: 3, mmp: 1, atk: 4, def: 3, mat: 0, mdf: 1, agi: 2, luk: 1 },
  mage: { mhp: 1, mmp: 4, atk: 0, def: 0, mat: 4, mdf: 3, agi: 2, luk: 2 },
  healer: { mhp: 2, mmp: 3, atk: 1, def: 1, mat: 3, mdf: 4, agi: 1, luk: 2 },
  scout: { mhp: 2, mmp: 1, atk: 3, def: 1, mat: 1, mdf: 1, agi: 4, luk: 4 },
};

/** Colour of each parameter's curve. */
const CURVE_COLORS: Record<ParamName, string> = {
  mhp: '#e07a55', mmp: '#5a86e8', atk: '#d2496a', def: '#93b85e', mat: '#c75ac9', mdf: '#45a852', agi: '#4db2e6', luk: '#dcb53c',
};

/** A panel of a form: its title (`db.section.<title>`), the keys of its fields, its column. */
interface Panel {
  title: string;
  fields: string[];
  /** Right column (left by default). */
  side?: boolean;
  /** Across both columns, under them (command lists). */
  wide?: boolean;
  extra?: PanelExtra;
}

const usedByPanel: Panel = { title: 'used_by', fields: [], side: true, extra: 'usedBy' };
const notePanel: Panel = { title: 'note', fields: ['note'], side: true };

/**
 * Forms laid out in panels on two columns, by database tab (and the System and Terms tabs).
 * A field left out of the panels lands in a last "Other" panel, so none is ever lost.
 */
const PANELS: Partial<Record<string, Panel[]>> = {
  class: [
    { title: 'general', fields: ['name', 'icon', 'description', 'outfit'] },
    { title: 'appearance', fields: ['defaultAppearance'] },
    { title: 'curves', fields: ['params'] },
    { title: 'experience', fields: ['expBase', 'expGrowth'], extra: 'expTable' },
    { title: 'start', fields: ['start'] },
    { title: 'learnings', fields: ['learnings'], side: true },
    { title: 'start_items', fields: ['startItems'], side: true },
    { title: 'equip_types', fields: ['weaponTypes', 'armorTypes'], side: true },
    { title: 'traits', fields: ['traits'], side: true },
    notePanel,
  ],
  skill: [
    { title: 'general', fields: ['name', 'icon', 'description', 'skillType'] },
    { title: 'use', fields: ['scope', 'mpCost', 'cooldown', 'range', 'area', 'requiredWeaponType'] },
    { title: 'invocation', fields: ['successRate', 'repeats'] },
    { title: 'display', fields: ['animationId', 'message'], extra: 'skillMessage' },
    { title: 'damage', fields: ['damage'], side: true },
    { title: 'effects', fields: ['effects'], side: true },
    usedByPanel,
    notePanel,
  ],
  item: [
    { title: 'general', fields: ['name', 'icon', 'description', 'kind', 'price'] },
    { title: 'use', fields: ['occasion', 'scope', 'consumable', 'maxStack'] },
    { title: 'animation', fields: ['animationId'] },
    { title: 'damage', fields: ['damage'], side: true },
    { title: 'effects', fields: ['effects'], side: true },
    usedByPanel,
    notePanel,
  ],
  weapon: [
    { title: 'general', fields: ['name', 'icon', 'description', 'weaponType', 'price'] },
    { title: 'attack', fields: ['range', 'animationId'] },
    { title: 'params', fields: ['params'] },
    { title: 'traits', fields: ['traits'], side: true },
    usedByPanel,
    notePanel,
  ],
  armor: [
    { title: 'general', fields: ['name', 'icon', 'description', 'armorType', 'slot', 'price'] },
    { title: 'params', fields: ['params'] },
    { title: 'traits', fields: ['traits'], side: true },
    usedByPanel,
    notePanel,
  ],
  enemy: [
    { title: 'general', fields: ['name', 'characterName', 'characterIndex'] },
    { title: 'params', fields: ['params'] },
    { title: 'behaviour', fields: ['ai', 'aggroRadius', 'moveSpeed', 'respawn'] },
    { title: 'rewards', fields: ['exp', 'gold', 'drops'] },
    { title: 'actions', fields: ['actions'], side: true },
    { title: 'traits', fields: ['traits'], side: true },
    usedByPanel,
    notePanel,
  ],
  state: [
    { title: 'general', fields: ['name', 'icon', 'restriction', 'priority', 'animationId'] },
    { title: 'removal', fields: ['duration', 'durationMax', 'removeOnDamage', 'removeOnDamageChance', 'removeAfterSteps'] },
    { title: 'over_time', fields: ['hpPerSecond', 'mpPerSecond'], extra: 'rates' },
    { title: 'message', fields: ['message', 'endMessage'], extra: 'stateMessage' },
    { title: 'traits', fields: ['traits'], side: true },
    usedByPanel,
    notePanel,
  ],
  animation: [
    { title: 'general', fields: ['name', 'sheet', 'sound'] },
    { title: 'frames', fields: ['frameCount', 'frameSize', 'fps'] },
    { title: 'preview', fields: [], side: true, extra: 'animation' },
    usedByPanel,
    notePanel,
  ],
  commonEvent: [
    { title: 'general', fields: ['name', 'trigger', 'switchId'] },
    { ...notePanel },
    { title: 'commands', fields: ['list'], wide: true },
  ],
  quest: [
    { title: 'general', fields: ['name', 'icon', 'description', 'category', 'level', 'prerequisite'] },
    { title: 'completion', fields: ['autoComplete', 'takeItems'] },
    { title: 'rewards', fields: ['rewardGold', 'rewardExp', 'rewardItems'] },
    { title: 'steps', fields: ['steps'], side: true },
    usedByPanel,
    notePanel,
  ],
  raid: [
    { title: 'general', fields: ['name', 'description', 'mapId', 'bossEnemyId'] },
    { title: 'access', fields: ['minLevel', 'minPlayers', 'maxPlayers'] },
    { title: 'rewards', fields: ['lockout', 'lootMode', 'rewardGold', 'rewardExp', 'rewardItems'] },
    { title: 'phases', fields: ['phases'], side: true },
    notePanel,
  ],
  system: [
    { title: 'game', fields: ['gameTitle', 'currencyName', 'maxLevel'] },
    { title: 'economy', fields: ['startingGold', 'sellRate', 'guildCreationCost'] },
    { title: 'characters', fields: ['statPointsPerLevel', 'bagSize'], side: true },
    { title: 'groups', fields: ['maxPartySize', 'maxRaidSize', 'instanceIdleMinutes'], side: true },
    { title: 'start_position', fields: ['startPosition'], side: true },
  ],
  terms: [{ title: 'basic_terms', fields: ['terms'] }],
};

/** Field types shown alone in their panel, without a label (the panel title names them). */
const PANEL_WHOLE = new Set<Field['type']>(['list', 'params', 'curves', 'commands', 'appearance']);

/** Longest option text (characters) a half-width choice shows without being cut by its arrow. */
const LONG_OPTION = 22;

/** Age after which the lists the forms refer to are read again when a tab is shown. */
const LOOKUPS_MAX_AGE_MS = 60_000;

/** Lists drawn as cards headed by a readable summary of the row. */
const CARD_LISTS = new Set(['effects', 'traits', 'drops', 'rewardItems', 'startItems', 'actions']);

/** Sign shown before a value, by field label (`× 1,25` rate, `+ 0,05` bonus). */
const VALUE_SIGNS: Record<string, string> = { rate: '×', bonus: '+' };

/** Icons of the summaries that do not show a record's own icon. */
const SUMMARY_ICONS: Record<string, IconName> = {
  recover_hp: 'hp',
  recover_mp: 'mp',
  gain_xp: 'xp',
  common_event: 'scroll',
  element_rate: 'shield_up',
  attack_element: 'sword',
  hit_rate: 'arrow',
  evasion: 'speed',
  critical: 'star',
};

/** A number in the interface language (`1,25`), with its sign when asked (`+25`). */
function fmt(n: number, signed = false): string {
  // A real minus sign (−), not the hyphen of the number formatting.
  const text = n.toLocaleString(document.documentElement.lang || undefined, { maximumFractionDigits: 2 }).replace(/^-/, '−');
  return signed && n > 0 ? `+${text}` : text;
}

/** How long a state lasts, as people read it: « 30 s », « 20 à 30 s », « jusqu'à son retrait ». */
function stateLasts(state: Record<string, unknown>): string {
  const min = Number(state.duration) || 0;
  const max = Number(state.durationMax) || 0;
  if (min <= 0) return t('db.summary.until_removed');
  return max > min ? t('db.summary.seconds_range', { min: fmt(min), max: fmt(max) }) : t('db.summary.seconds', { count: fmt(min) });
}

/** Readable line of an effect or a trait, with a warning when it would do nothing. */
interface Summary {
  icon: number;
  text: string;
  warning?: string;
}

/**
 * Help text of a field: `db.help.<parent>_<field>` (a field inside a list or group), then
 * `db.help.<tab>_<field>`, then `db.help.<field>`. Empty when the field is self-explanatory.
 * @param scope - Database tab the form belongs to.
 * @param path - Path of the field in the record.
 */
function helpText(scope: string, path: (string | number)[]): string {
  const key = String(path[path.length - 1]);
  const parent = path.slice(0, -1).reverse().find((p) => typeof p === 'string');
  for (const id of [parent ? `${parent}_${key}` : '', `${scope}_${key}`, key]) {
    if (!id) continue;
    const full = `db.help.${id}`;
    const text = tDynamic(full);
    if (text !== full) return text;
  }
  return '';
}

/** Text fields that cannot be saved empty. */
const REQUIRED_TEXT = new Set(['name', 'gameTitle', 'currencyName']);
const option = (value: string) => tDynamic(`db.option.${value}`);
/** Label of a choice; a field can have its own wording (`db.option.<field>_<value>`) when a shared one does not fit. */
const optionOf = (field: string, value: string) => {
  const own = `db.option.${field}_${value}`;
  const text = tDynamic(own);
  return text === own ? option(value) : text;
};

/** Reads a value at a path of nested keys. */
function getPath(obj: Record<string, unknown>, path: (string | number)[]): unknown {
  return path.reduce<unknown>((v, k) => (v as Record<string | number, unknown> | undefined)?.[k], obj);
}

/** Writes a value at a path of nested keys. */
function setPath(obj: Record<string, unknown>, path: (string | number)[], value: unknown): void {
  let cur = obj as Record<string | number, unknown>;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]!] as Record<string | number, unknown>;
  cur[path.at(-1)!] = value;
}

/** Icon picker: grid of the icon sheet in a small dialog. */
function pickIcon(host: HTMLElement, current: number, onPick: (index: number) => void): void {
  const grid = el('div', { className: 'icon-grid' });
  let close: () => void = () => undefined;
  for (let i = 0; i < ICON_COLUMNS * 8; i++) {
    const cell = el('button', { className: `icon-cell${i === current ? ' selected' : ''}`, title: String(i), attrs: { type: 'button' } }, [icon(i)]);
    cell.addEventListener('click', () => {
      onPick(i);
      // Closed through the dialog (not by removing its element): its Escape listener goes with it.
      close();
    });
    grid.append(cell);
  }
  close = openModal(host, t('db.pick_icon'), grid, [{ label: t('common.cancel') }]);
}

/** Renders a form for a record (fields are generated from the schema). */
class RecordForm {
  readonly element = el('div', { className: 'db-form' });
  /** Laid out in panels (the help of a field shows under its panel rather than under the field). */
  private readonly panels: boolean;
  /** Parts drawn from several fields (summaries, warnings, previews), redrawn on every change. */
  private readonly watchers: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    private readonly fields: Field[],
    private readonly record: Record<string, unknown>,
    private readonly lookups: Lookups,
    private readonly onChange: () => void,
    private readonly scope = '',
  ) {
    const panels = PANELS[scope];
    this.panels = panels !== undefined;
    if (panels) this.renderPanels(panels);
    else this.element.append(...fields.map((f) => this.fieldRow(f, [f.key])));
    if (fields.some((f) => f.key === 'characterName') && fields.some((f) => f.key === 'characterIndex')) this.addSpritePreview();
    // A choice too long for its box ends with « … »: the tooltip gives it whole.
    const fullText = (e: Event) => {
      const target = e.target;
      if (target instanceof HTMLSelectElement) target.title = target.selectedOptions[0]?.text ?? '';
    };
    this.element.addEventListener('mouseover', fullText);
    this.element.addEventListener('focusin', fullText);
  }

  /** Lays the fields out in titled panels on two columns. */
  private renderPanels(panels: Panel[]): void {
    const placed = new Set(panels.flatMap((p) => p.fields));
    const rest = this.fields.filter((f) => !placed.has(f.key)).map((f) => f.key);
    const columns = [el('div', { className: 'db-column' }), el('div', { className: 'db-column' })];
    const wide: HTMLElement[] = [];
    for (const panel of rest.length > 0 ? [...panels, { title: 'other', fields: rest }] : panels) {
      const body = el('div', { className: 'db-panel-body' });
      for (const key of panel.fields) {
        const field = this.fields.find((f) => f.key === key);
        if (!field) continue;
        if (field.type === 'group') {
          // A group alone in its panel shows its fields directly (the panel title names it); conditional ones hide themselves.
          body.append(...field.fields.map((f) => this.cell(f, [key, f.key])));
          // Without damage, the other damage fields do not count: they are dimmed.
          if (key === 'damage') this.watch(() => body.classList.toggle('db-dim-rest', (this.record.damage as { type?: string } | undefined)?.type === 'none'));
          if (field.fields.some((f) => f.type === 'map')) body.append(this.positionNote(field));
        } else if ((PANEL_WHOLE.has(field.type) || (field.type === 'text' && field.multiline)) && panel.fields.length === 1) {
          // Lists, parameter grids, curves and command lists fill their panel; its title names them.
          const help = helpText(this.scope, [key]);
          if (help) body.append(el('p', { className: 'hint db-panel-intro', text: help }));
          body.append(el('div', { className: 'db-whole' }, [this.control(field, [key], () => undefined)]));
        } else body.append(this.cell(field, [key]));
      }
      if (panel.extra === 'rates') body.append(this.ratesNote());
      else if (panel.extra === 'stateMessage') body.append(this.messagePreview());
      else if (panel.extra === 'usedBy') body.append(...this.usedBy());
      else if (panel.extra === 'expTable') body.append(this.expTable());
      else if (panel.extra === 'skillMessage') body.append(this.skillMessagePreview());
      else if (panel.extra === 'animation') body.append(this.animationStage());
      // The help of the field being edited shows at the bottom of its panel.
      const help = el('p', { className: 'db-panel-help', attrs: { 'aria-live': 'polite' } });
      const section = el('section', { className: `db-panel db-panel-${panel.title}` }, [el('h3', { className: 'db-panel-title', text: tDynamic(`db.section.${panel.title}`) }), body, help]);
      section.addEventListener('focusin', (e) => (help.textContent = (e.target as HTMLElement).closest<HTMLElement>('[data-help]')?.dataset.help ?? ''));
      section.addEventListener('focusout', (e) => {
        if (!section.contains(e.relatedTarget as Node | null)) help.textContent = '';
      });
      if ('wide' in panel && panel.wide) wide.push(section);
      else columns['side' in panel && panel.side ? 1 : 0]!.append(section);
    }
    this.element.classList.add('db-form-panels');
    this.element.append(...columns, ...wide.map((section) => el('div', { className: 'db-wide-panel' }, [section])));
  }

  /** The place a group with a map and a cell points to, read as « Village (20, 17) » (hidden while the map is not used). */
  private positionNote(field: Field & { type: 'group' }): HTMLElement {
    const note = el('p', { className: 'db-note wide db-position' });
    const mapField = field.fields.find((f) => f.type === 'map')!;
    this.watch(() => {
      const values = (this.record[field.key] ?? {}) as Record<string, unknown>;
      const used = fieldApplies(mapField, values);
      note.classList.toggle('hidden', !used);
      const id = Number(values[mapField.key]) || 0;
      const map = this.lookups.commands?.maps.find((m) => m.id === id);
      note.textContent = t('db.position', { map: map?.name || `#${id}`, x: Number(values.x) || 0, y: Number(values.y) || 0 });
    });
    return note;
  }

  /** A field of a panel: its name above its control (a check box before its name). */
  private cell(field: Field, path: (string | number)[]): HTMLElement {
    const key = field.label ?? field.key;
    const help = helpText(this.scope, [...path.slice(0, -1), key]);
    const control = this.control(field, path, () => undefined);
    const attrs = help ? { 'data-help': help } : undefined;
    const name = el('span', { className: 'db-label', text: label(key), title: help || undefined });
    if (field.type === 'bool') return this.shownWhen(field, path, el('label', { className: 'db-cell db-check', attrs }, [control, name]));
    // A "pick on the map" button says what it does: no name above it.
    if (field.type === 'cell') return this.shownWhen(field, path, el('div', { className: 'db-cell db-check', attrs }, [control]));
    // A choice that names records or long options needs the whole width of its panel to be read.
    const longChoice = control instanceof HTMLSelectElement && [...control.options].some((o) => o.text.length >= LONG_OPTION);
    const wide =
      ['group', 'list', 'params', 'curves', 'commands', 'appearance', 'intList', 'ref', 'resource'].includes(field.type) ||
      field.key === 'scope' ||
      longChoice ||
      (field.type === 'text' && (field.multiline === true || (field.max ?? 200) >= 200));
    return this.shownWhen(field, path, el('div', { className: `db-cell${wide ? ' wide' : ''}`, attrs }, [name, control]));
  }

  /** Registers a part to redraw on every change, and draws it once. */
  private watch(draw: () => void): void {
    this.watchers.push(draw);
    draw();
  }

  /** Something changed: computed parts are redrawn, the window marks the entry as unsaved. */
  private changed(): void {
    for (const draw of this.watchers) draw();
    this.onChange();
  }

  /** Name of a term of the System tab (HP, MP). */
  private term(key: 'hp' | 'mp'): string {
    return this.lookups.system?.terms[key] || key.toUpperCase();
  }

  /** Name of an element of the System tab. */
  private elementName(index: number): string {
    return index === 0 ? t('db.element_none') : this.lookups.system?.elements[index] || `#${index}`;
  }

  /** Readable line heading an effect or a trait. */
  private summary(list: string, row: Record<string, unknown>): Summary {
    const kind = String(row.kind);
    const value = Number(row.value) || 0;
    const states = this.lookups.records.state ?? [];
    const state = (id: unknown) => states.find((s) => s.id === Number(id));
    const stateName = (id: unknown) => state(id)?.name ?? t('db.picker.missing', { id: Number(id) || 0 });
    const missing = t('db.summary.missing');
    const named = (name: IconName) => iconIndex(name);
    if (list === 'drops' || list === 'rewardItems' || list === 'startItems') {
      // An item, a weapon or an armor depending on the kind: drops and starting items keep it in `id`, rewards in a field named after the kind.
      const type = kind as 'item' | 'weapon' | 'armor';
      const id = Number(list === 'rewardItems' ? row[type] : row.id) || 0;
      const entry = this.lookups.records[type]?.find((r) => r.id === id);
      const name = entry?.name || t('db.picker.missing', { id });
      let text = list === 'drops' ? t('db.summary.drop', { name, chance: fmt(Number(row.chance) || 0) }) : t('db.summary.reward', { name, count: fmt(Number(row.count) || 0) });
      if (list === 'startItems' && type !== 'item' && row.equip === true) text += ` — ${t('db.summary.worn')}`;
      const warning = !entry ? missing : list === 'drops' && !(Number(row.chance) > 0) ? t('db.summary.never_dropped') : undefined;
      return { icon: Number(entry?.icon) || 0, text, warning };
    }
    if (list === 'actions') {
      // An enemy skill, its weight and the condition under which it may be drawn.
      const skill = this.lookups.records.skill?.find((r) => r.id === Number(row.skillId));
      let text = t('db.summary.action', { name: skill?.name || t('db.picker.missing', { id: Number(row.skillId) || 0 }), weight: fmt(Number(row.weight) || 0) });
      let warning = skill ? undefined : missing;
      if (row.condition === 'hp_below') text += ` — ${t('db.summary.when_hp_below', { stat: this.term('hp'), percent: fmt(Number(row.hpBelow) || 0) })}`;
      else if (row.condition === 'state') {
        text += ` — ${t('db.summary.when_state', { state: stateName(row.stateId) })}`;
        if (!state(row.stateId)) warning ??= missing;
      } else if (row.condition === 'switch') {
        const id = Number(row.switchId) || 0;
        const declared = this.lookups.system?.switches[id - 1];
        text += ` — ${t('db.summary.when_switch', { name: declared ? `${String(id).padStart(4, '0')} — ${declared.name || t('db.unnamed')}` : `#${id}` })}`;
        if (!declared) warning ??= t('db.switch_undeclared', { id });
      }
      return { icon: Number(skill?.icon) || 0, text, warning };
    }
    if (list === 'effects') {
      const percent = Number(row.percent) || 0;
      switch (kind) {
        case 'recover_hp':
        case 'recover_mp': {
          const stat = this.term(kind === 'recover_hp' ? 'hp' : 'mp');
          const key = value && percent ? 'recover_both' : percent ? 'recover_percent' : 'recover';
          return { icon: named(SUMMARY_ICONS[kind]!), text: tDynamic(`db.summary.${key}`, { amount: fmt(value), percent: fmt(percent), stat }), warning: value || percent ? undefined : t('db.summary.no_effect') };
        }
        case 'add_state': {
          const s = state(row.value);
          // Like a removal, a sure application says no chance.
          const head = percent >= 100 ? t('db.summary.add_state_always', { state: stateName(row.value) }) : t('db.summary.add_state', { state: stateName(row.value), chance: fmt(percent) });
          const text = head + (s ? ` — ${stateLasts(s)}` : '');
          return { icon: Number(s?.icon) || 0, text, warning: !s ? missing : percent === 0 ? t('db.summary.never_applied') : undefined };
        }
        case 'remove_state': {
          const s = state(row.value);
          // 0 comes from records saved before removals had a chance: it means "always", like 100.
          const chance = percent > 0 && percent < 100 ? ` — ${t('db.summary.chance', { chance: fmt(percent) })}` : '';
          return { icon: Number(s?.icon) || 0, text: t('db.summary.remove_state', { state: stateName(row.value) }) + chance, warning: s ? undefined : missing };
        }
        case 'learn_skill': {
          const skill = this.lookups.records.skill?.find((r) => r.id === value);
          return { icon: Number(skill?.icon) || 0, text: t('db.summary.learn_skill', { name: skill?.name || t('db.picker.missing', { id: value }) }), warning: skill ? undefined : missing };
        }
        case 'gain_xp':
          return { icon: named('xp'), text: t('db.summary.gain_xp', { amount: fmt(value) }), warning: value ? undefined : t('db.summary.no_effect') };
        default: {
          const event = this.lookups.records.commonEvent?.find((c) => c.id === value);
          return { icon: named('scroll'), text: t('db.summary.common_event', { name: event?.name || t('db.picker.missing', { id: value }) }), warning: event ? undefined : missing };
        }
      }
    }
    const change = fmt(Math.round((value - 1) * 10_000) / 100, true);
    switch (kind) {
      case 'param_rate': {
        const param = String(row.target);
        const known = (PARAMS as readonly string[]).includes(param);
        const text = t('db.summary.param_rate', { param: known ? this.paramName(param) : '?', value: fmt(value), change });
        return { icon: named(value >= 1 ? 'atk_up' : 'atk_down'), text, warning: known ? undefined : t('db.summary.missing_param') };
      }
      case 'element_rate':
      case 'attack_element': {
        const element = Number(row.target) || 0;
        const text = tDynamic(`db.summary.${kind}`, { element: this.elementName(element), value: fmt(value), change });
        return { icon: named(SUMMARY_ICONS[kind]!), text, warning: element === 0 ? t('db.summary.no_element') : undefined };
      }
      case 'state_resist': {
        const s = state(row.target);
        const text = value === 0 ? t('db.summary.state_immune', { state: stateName(row.target) }) : t('db.summary.state_resist', { state: stateName(row.target), value: fmt(value), change });
        return { icon: Number(s?.icon) || 0, text, warning: s ? undefined : missing };
      }
      case 'attack_state': {
        const s = state(row.target);
        const text = t('db.summary.attack_state', { state: stateName(row.target), chance: fmt(value) });
        return { icon: Number(s?.icon) || 0, text, warning: !s ? missing : value <= 0 ? t('db.summary.never_applied') : undefined };
      }
      case 'add_skill': {
        const skill = this.lookups.records.skill?.find((r) => r.id === Number(row.target));
        return { icon: Number(skill?.icon) || 0, text: t('db.summary.add_skill', { name: skill?.name || t('db.picker.missing', { id: Number(row.target) || 0 }) }), warning: skill ? undefined : missing };
      }
      case 'hp_regen':
      case 'mp_regen': {
        const text = t('db.summary.regen', { stat: this.term(kind === 'hp_regen' ? 'hp' : 'mp'), rate: fmt(value, true) });
        return { icon: named(kind === 'hp_regen' ? 'regen' : 'mp'), text, warning: value === 0 ? t('db.summary.no_effect') : undefined };
      }
      case 'exp_rate':
      case 'gold_rate':
        return { icon: named(kind === 'exp_rate' ? 'xp' : 'gold'), text: tDynamic(`db.summary.${kind}`, { value: fmt(value), change }) };
      default:
        return { icon: named(SUMMARY_ICONS[kind] ?? 'star'), text: tDynamic(`db.summary.${kind}`, { change: fmt(Math.round(value * 10_000) / 100, true) }) };
    }
  }

  /** What a state does to HP and MP over its duration, with a warning when it knocks out or drains. */
  private ratesNote(): HTMLElement {
    const box = el('div', { className: 'db-notes wide' });
    this.watch(() => {
      // The worst case counts: the longest duration a state may draw.
      const duration = Number(this.record.duration) > 0 ? Math.max(Number(this.record.duration), Number(this.record.durationMax) || 0) : 0;
      const lasts = stateLasts(this.record);
      const notes: HTMLElement[] = [];
      for (const [key, stat, hp] of [['hpPerSecond', this.term('hp'), true], ['mpPerSecond', this.term('mp'), false]] as const) {
        const rate = Number(this.record[key]) || 0;
        if (rate === 0) continue;
        const params = { stat, rate: fmt(rate, true), total: fmt(Math.round(rate * duration * 100) / 100, true), duration: fmt(duration), time: Math.ceil(100 / Math.abs(rate)), lasts };
        // A loss reaching the whole maximum before the state ends (or with no end) empties the gauge.
        const empties = rate < 0 && (duration === 0 || -rate * duration >= 100);
        const text = empties ? t(hp ? 'db.rates.lethal' : 'db.rates.drained', params) : t(duration > 0 ? 'db.rates.change' : 'db.rates.change_forever', params);
        notes.push(el('p', { className: `db-note${empties ? ' warn' : ''}`, text: empties ? `⚠ ${text}` : text }));
      }
      box.replaceChildren(...(notes.length > 0 ? notes : [el('p', { className: 'db-note', text: t('db.rates.none') })]));
    });
    return box;
  }

  /** How the messages of a state read in game (after the name of the character). */
  private messagePreview(): HTMLElement {
    const preview = el('div', { className: 'db-notes wide' });
    this.watch(() => {
      const line = (key: 'message' | 'endMessage', template: 'db.message_preview' | 'db.message_preview_end', none: 'db.message_none' | 'db.message_none_end') => {
        const message = String(this.record[key] ?? '').trim();
        return el('p', { className: 'db-note', text: message ? t(template, { text: t('notify.state_added', { name: t('db.preview_name'), message }) }) : t(none) });
      };
      preview.replaceChildren(line('message', 'db.message_preview', 'db.message_none'), line('endMessage', 'db.message_preview_end', 'db.message_none_end'));
    });
    return preview;
  }

  /** How the message of a skill reads in the chat of nearby players (`%1` = the user's name, otherwise put first). */
  private skillMessagePreview(): HTMLElement {
    const preview = el('p', { className: 'db-note wide' });
    this.watch(() => {
      const message = String(this.record.message ?? '').trim();
      const name = t('db.preview_name');
      const text = message.includes('%1') ? message.replaceAll('%1', name) : `${name} ${message}`;
      preview.textContent = message ? t('db.message_preview', { text }) : t('db.skill_message_none');
    });
    return preview;
  }

  /** The animation being edited, playing in a loop over its target tile, and a button to play it again with its sound. */
  private animationStage(): HTMLElement {
    const stage = new AnimationPreview(this.lookups.assets, 192);
    this.watch(() => stage.show(this.record as unknown as AnimationLook));
    const play = el('button', { className: 'button small', text: t('db.anim_play'), attrs: { type: 'button' }, on: { click: () => stage.replay() } });
    return el('div', { className: 'db-anim wide' }, [stage.canvas, el('p', { className: 'hint', text: t('db.anim_hint') }), play]);
  }

  /** Records of the database referring to this one, as links. */
  private usedBy(): HTMLElement[] {
    const type = this.scope as DatabaseType;
    const id = Number(this.record.id);
    const users: { type: DatabaseType; record: AnyRecord }[] = [];
    for (const [other, list] of Object.entries(this.lookups.records) as [DatabaseType, AnyRecord[]][]) {
      for (const r of list) {
        if (other === type && r.id === id) continue;
        let hit = false;
        walkFields(SCHEMAS[other], r, (f, v) => {
          if (f.type === 'ref' && f.ref === type && Number(v) === id) hit = true;
        });
        if (hit) users.push({ type: other, record: r });
      }
    }
    if (users.length === 0) return [el('p', { className: 'hint wide', text: t('db.used_by_none') })];
    return [
      el('p', { className: 'hint db-panel-intro', text: t('db.used_by_hint') }),
      el(
        'div',
        { className: 'db-chips' },
        users.map((u) =>
          el('button', { className: 'db-chip', attrs: { type: 'button' }, on: { click: () => this.lookups.goTo?.(u.type, u.record.id) } }, [
            typeof u.record.icon === 'number' ? icon(u.record.icon) : null,
            el('span', { text: u.record.name || `#${u.record.id}` }),
            el('small', { text: tDynamic(`db.tab.${u.type}`) }),
          ]),
        ),
      ),
    ];
  }

  /** Default value of a field: the first existing record for a reference, the current map for a map. */
  private defaultOf(field: Field): unknown {
    if (field.type === 'ref' && !field.allowNone) {
      const first = this.lookups.records[field.ref]?.find((r) => !isSeparator(r.name))?.id;
      if (first !== undefined) return field.asText ? String(first) : first;
    }
    if (field.type === 'map') return this.lookups.commands?.mapId ?? 1;
    return fieldDefault(field);
  }

  /**
   * Gives a list row's field its default when a kind change swapped its declaration (an amount became
   * a state...): the old value has another meaning.
   * @param seen - Declarations in use in each row at its last drawing.
   */
  private settle(fields: Field[], row: Record<string, unknown>, seen: WeakMap<object, Map<string, Field>>): void {
    const now = new Map(activeFields(fields, row).map((f) => [f.key, f]));
    const before = seen.get(row);
    if (before) for (const [key, f] of now) if (before.get(key) !== f) row[key] = this.defaultOf(f);
    seen.set(row, now);
  }

  private spriteRedraw: (() => void) | null = null;

  /** Adds a preview of the chosen character sheet and index, right after the index field. */
  private addSpritePreview(): void {
    const canvas = el('canvas', { className: 'appearance-preview', attrs: { width: '96', height: '96' } });
    this.spriteRedraw = () => {
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const name = String(this.record.characterName ?? '');
      const index = Number(this.record.characterIndex) || 0;
      const assets = this.lookups.assets;
      if (!name || !assets) return;
      void assets.image('characters', name).then((image) => {
        if (!image || name !== this.record.characterName || index !== (Number(this.record.characterIndex) || 0)) return;
        const { single } = sheetFlags(name);
        const fw = image.width / (single ? 3 : 12);
        const fh = image.height / (single ? 4 : 8);
        const bx = single ? 0 : (index % 4) * 3;
        const by = single ? 0 : Math.floor(index / 4) * 4;
        const scale = Math.min(canvas.width / fw, canvas.height / fh);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, (bx + 1) * fw, by * fh, fw, fh, (canvas.width - fw * scale) / 2, canvas.height - fh * scale, fw * scale, fh * scale);
      });
    };
    // A click on the preview opens the picker (theme, then every character); the sheet and index rows are hidden.
    const indexInput = this.element.querySelector<HTMLInputElement>('input[type="number"][max="7"]');
    const assets = this.lookups.assets;
    const indexRow = indexInput?.closest<HTMLElement>('.db-row, .db-cell') ?? null;
    const sheetRow = indexRow?.previousElementSibling as HTMLElement | null;
    const sheetSelect = sheetRow?.querySelector('select') ?? null;
    let picker: HTMLButtonElement | null = null;
    if (indexInput && assets && sheetSelect) {
      const host = this.host;
      picker = el('button', { className: 'sprite-pick-button', title: t('editor.character_pick'), attrs: { type: 'button', 'aria-label': t('editor.character_pick') } }, [canvas]);
      picker.addEventListener('click', async () => {
        const choice = await pickCharacter(host, assets, this.lookups.resources.characters ?? [], { name: String(this.record.characterName ?? ''), index: Number(this.record.characterIndex) || 0 });
        if (!choice) return;
        sheetSelect.value = choice.name;
        indexInput.value = String(choice.index);
        this.change(['characterName'], choice.name);
        this.change(['characterIndex'], choice.index);
      });
      indexRow!.classList.add('hidden');
      sheetRow!.classList.add('hidden');
    }
    this.spriteRedraw();
    const shown = picker ?? canvas;
    const row = this.panels ? el('div', { className: 'db-cell wide db-sprite' }, [shown]) : el('div', { className: 'db-row wide' }, [el('span', { className: 'db-label', text: '' }), shown]);
    const after = indexRow;
    if (after) after.after(row);
    else this.element.append(row);
  }

  private change(path: (string | number)[], value: unknown): void {
    setPath(this.record, path, value);
    if (path[0] === 'characterName' || path[0] === 'characterIndex') this.spriteRedraw?.();
    this.changed();
  }

  private fieldRow(field: Field, path: (string | number)[], refresh: () => void = () => undefined): HTMLElement {
    const control = this.control(field, path, refresh);
    const wide = ['group', 'list', 'params', 'curves', 'commands', 'appearance'].includes(field.type) || (field.type === 'text' && field.multiline);
    const key = field.label ?? field.key;
    const help = helpText(this.scope, [...path.slice(0, -1), key]);
    const row = el('div', { className: `db-row${wide ? ' wide' : ''}` }, [el('span', { className: 'db-label', text: label(key), title: help || undefined }), control, ...(help ? [el('small', { className: 'db-help', text: help })] : [])]);
    // Fields of groups are redrawn with their group when a condition changes; those of the record are hidden instead.
    return path.length === 1 ? this.shownWhen(field, path, row) : row;
  }

  /**
   * Hides a field drawn once (a field of the record, or of a group laid out in a panel) while its
   * condition does not hold, e.g. the switch of a common event that is not automatic.
   */
  private shownWhen(field: Field, path: (string | number)[], row: HTMLElement): HTMLElement {
    if (field.when) this.watch(() => row.classList.toggle('hidden', !fieldApplies(field, (getPath(this.record, path.slice(0, -1)) ?? {}) as Record<string, unknown>)));
    return row;
  }

  /** A field of a list row: its name above its control (its help under the name, or under the panel). */
  private listField(field: Field, path: (string | number)[], refresh: () => void): HTMLElement {
    const control = this.control(field, path, refresh);
    const nested = field.type === 'list';
    const key = field.label ?? field.key;
    const help = helpText(this.scope, [...path.slice(0, -1), key]);
    const inline = help && !this.panels ? [el('small', { className: 'db-help', text: help })] : [];
    return el(nested ? 'div' : 'label', { className: nested ? 'db-sublist' : '', title: help || undefined, attrs: help ? { 'data-help': help } : undefined }, [el('span', { text: label(key) }), ...inline, control]);
  }

  /**
   * Builds the control of a field.
   * @param refresh - Re-renders the enclosing list row (a field other fields depend on changed).
   */
  private control(field: Field, path: (string | number)[], refresh: () => void): HTMLElement {
    const value = getPath(this.record, path);
    const sibling = (key: string) => getPath(this.record, [...path.slice(0, -1), key]);
    switch (field.type) {
      case 'text': {
        const attrs = { maxlength: String(field.max ?? 200), 'aria-label': label(field.label ?? field.key) };
        const input = field.multiline ? el('textarea', { attrs: { rows: '3', ...attrs } }) : el('input', { attrs: { type: 'text', ...attrs } });
        // Names must not be left empty (lists and the game show them).
        if (REQUIRED_TEXT.has(field.key)) input.required = true;
        input.value = String(value ?? '');
        input.addEventListener('input', () => this.change(path, input.value));
        // A damage formula gets ready-made ones by role, and what the letters mean.
        if (field.key === 'formula' && input instanceof HTMLInputElement) return this.formulaControl(input, path);
        if (!field.multiline) return input;
        // A long text counts its characters against the limit.
        const max = field.max ?? 200;
        const count = el('small', { className: 'db-count', attrs: { 'aria-hidden': 'true' } });
        const showCount = () => (count.textContent = t('db.char_count', { count: input.value.length, max }));
        input.addEventListener('input', showCount);
        showCount();
        return el('div', { className: 'db-counted' }, [input, count]);
      }
      case 'int':
      case 'number': {
        const input = el('input', { attrs: { type: 'number', min: String(field.min), max: String(field.max), step: field.type === 'int' ? '1' : 'any' } });
        input.required = true;
        input.value = String(value ?? field.min);
        input.addEventListener('input', () => this.change(path, Number(input.value)));
        // In panels (drawn once), a value written elsewhere shows here: a cell picked on the map sets x and y.
        if (this.panels && !path.some((p) => typeof p === 'number')) {
          this.watch(() => {
            const current = getPath(this.record, path);
            if (document.activeElement !== input && current !== undefined && String(current) !== input.value) input.value = String(current);
          });
        }
        // A rate multiplies (× 1,25), a bonus adds (+ 0,05): the sign says which.
        const sign = field.label ? VALUE_SIGNS[field.label] : undefined;
        return sign ? el('span', { className: 'db-affix' }, [el('span', { className: 'db-affix-sign', text: sign, attrs: { 'aria-hidden': 'true' } }), input]) : input;
      }
      case 'systemList': {
        // Elements, weapon and armor types are chosen by name (the System tab lists them), not typed as numbers.
        const names = this.lookups.system?.[field.list] ?? [''];
        const current = Number(value) || 0;
        const s = el('select', {}, names.map((n, i) => el('option', { text: i === 0 ? t('db.element_none') : n || `#${i}`, attrs: { value: String(i) } })));
        // An index past the end of the list (removed from the System tab) stays visible, flagged.
        const missing = !(current in names);
        if (missing) s.append(el('option', { text: `⚠ #${current}`, attrs: { value: String(current) } }));
        s.value = String(current);
        s.classList.toggle('missing', missing);
        s.addEventListener('change', () => {
          s.classList.toggle('missing', missing && Number(s.value) === current);
          this.change(path, field.asText ? s.value : Number(s.value));
        });
        return s;
      }
      case 'switch': {
        // Switches are chosen by their name in the Switches tab (ids start at 1).
        const switches = this.lookups.system?.switches ?? [];
        const current = Number(value) || 0;
        const s = el('select', { className: 'long-options' }, [
          ...(field.allowNone ? [el('option', { text: t('editor.none'), attrs: { value: '0' } })] : []),
          ...switches.map((d, i) => el('option', { text: `${String(i + 1).padStart(4, '0')} — ${d.name || t('db.unnamed')}`, attrs: { value: String(i + 1) } })),
        ]);
        const missing = current > switches.length || (current === 0 && !field.allowNone);
        if (missing) s.append(el('option', { text: `⚠ ${t('db.switch_undeclared', { id: current })}`, attrs: { value: String(current) } }));
        s.value = String(current);
        s.classList.toggle('missing', missing);
        s.addEventListener('change', () => {
          s.classList.toggle('missing', missing && Number(s.value) === current);
          this.change(path, Number(s.value));
        });
        return s;
      }
      case 'param': {
        const s = el('select', {}, PARAMS.map((p) => el('option', { text: `${this.paramName(p)} (${p})`, attrs: { value: p } })));
        // A name typed by hand in older versions that is no parameter: shown until another is chosen.
        if (!(PARAMS as readonly unknown[]).includes(value)) s.prepend(el('option', { text: t('db.param_unknown'), attrs: { value: '' } }));
        s.value = String(value ?? '');
        s.classList.toggle('missing', s.value === '');
        s.addEventListener('change', () => {
          s.classList.toggle('missing', s.value === '');
          this.change(path, s.value);
        });
        return s;
      }
      case 'bool': {
        const input = el('input', { attrs: { type: 'checkbox' } });
        input.checked = value === true;
        input.addEventListener('change', () => this.change(path, input.checked));
        return input;
      }
      case 'select': {
        if (field.key === 'scope' && field.options.includes('allies_area')) return this.scopeControl(path);
        // The kinds of traits and effects are grouped by family (characteristics, resistances, attack...).
        const groups = field.key === 'kind' ? KIND_GROUPS[String(path.at(-3)) as keyof typeof KIND_GROUPS] : undefined;
        const option = (o: string) => el('option', { text: optionOf(field.key, o), attrs: { value: o } });
        const s = el('select', {}, groups ? groups.map(([family, kinds]) => el('optgroup', { attrs: { label: tDynamic(`db.kind_group.${family}`) } }, kinds.map(option))) : field.options.map(option));
        // Long wordings get a wider box in a card (the box is otherwise as wide as the short ones).
        if ([...s.options].some((o) => o.text.length >= 18)) s.classList.add('long-options');
        s.value = String(value);
        s.addEventListener('change', () => {
          this.change(path, s.value);
          refresh();
        });
        return s;
      }
      case 'map': {
        const maps = this.lookups.commands?.maps ?? [];
        const s = el('select', { className: 'long-options' }, maps.map((m) => el('option', { text: `${m.id} — ${m.name}`, attrs: { value: String(m.id) } })));
        if (!maps.some((m) => m.id === Number(value))) s.append(el('option', { text: `#${String(value)}`, attrs: { value: String(value) } }));
        s.value = String(value ?? 1);
        s.addEventListener('change', () => {
          this.change(path, Number(s.value));
          refresh();
        });
        return s;
      }
      case 'event': {
        const s = el('select', { className: 'long-options' }, [el('option', { text: `#${String(value)}`, attrs: { value: String(value) } })]);
        s.value = String(value);
        void this.lookups.mapEvents?.(Number(sibling(field.mapKey)) || 1).then((events) => {
          s.replaceChildren(...events.map((e) => el('option', { text: `${e.id} — ${e.name}`, attrs: { value: String(e.id) } })));
          if (!events.some((e) => e.id === Number(value))) s.append(el('option', { text: `#${String(value)}`, attrs: { value: String(value) } }));
          s.value = String(value);
        });
        s.addEventListener('change', () => this.change(path, Number(s.value)));
        return s;
      }
      case 'cell': {
        const pick = this.lookups.commands?.pickCell;
        return el('button', {
          className: 'button small',
          text: t('db.pick_cell'),
          attrs: { type: 'button', ...(pick ? {} : { disabled: '' }) },
          on: {
            click: () =>
              void pick?.(Number(sibling(field.mapKey)) || 1).then((cell) => {
                if (!cell) return;
                const base = path.slice(0, -1);
                setPath(this.record, [...base, 'x'], cell.x);
                setPath(this.record, [...base, 'y'], cell.y);
                this.changed();
                refresh();
              }),
          },
        });
      }
      case 'icon': {
        const input = el('input', { attrs: { type: 'number', min: '0', max: '9999' } });
        input.value = String(value ?? 0);
        const choose = () => pickIcon(this.host, Number(input.value) || 0, update);
        // The icon itself opens the icon sheet too.
        const preview = el('button', { className: 'icon-preview', title: t('db.pick_icon'), attrs: { type: 'button' }, on: { click: choose } }, [icon(Number(value) || 0)]);
        const update = (n: number) => {
          input.value = String(n);
          preview.replaceChildren(icon(n));
          this.change(path, n);
        };
        input.addEventListener('input', () => update(Number(input.value) || 0));
        return el('div', { className: 'icon-field' }, [preview, input, el('button', { className: 'button small', text: t('db.choose'), attrs: { type: 'button' }, on: { click: choose } })]);
      }
      case 'resource': {
        const names = this.lookups.resources[field.kind] ?? [];
        const s = el('select', { className: 'long-options' }, [el('option', { text: t('editor.none'), attrs: { value: '' } }), ...names.map((n) => el('option', { text: field.kind === 'characters' ? `${n} — ${t(sheetFlags(n).single ? 'db.sheet_single' : 'db.sheet_multi')}` : n, attrs: { value: n } }))]);
        s.value = String(value ?? '');
        s.addEventListener('change', () => this.change(path, s.value));
        return s;
      }
      case 'ref': {
        const id = Number(value) || 0;
        // Separators are headings of the list, not records to choose (one chosen before stays visible).
        const list = (this.lookups.records[field.ref] ?? []).filter((r) => !isSeparator(r.name) || r.id === id);
        const store = (n: number) => this.change(path, field.asText ? String(n) : n);
        // Animations are picked in a list that plays the one under the cursor.
        if (field.ref === 'animation') {
          const look = (n: number) => (list.find((r) => r.id === n) ?? null) as AnimationLook | null;
          return recordPicker(list.map((r) => ({ id: r.id, name: r.name })), id, store, field.allowNone ? t('editor.none') : undefined, () => {
            const stage = new AnimationPreview(this.lookups.assets, 120);
            return { element: stage.canvas, show: (n) => stage.show(look(n)) };
          });
        }
        // Records with an icon are picked in a list showing it.
        if (ICON_TYPES.has(field.ref)) {
          return recordPicker(list.map((r) => ({ id: r.id, name: r.name, icon: Number(r.icon) || 0 })), id, store, field.allowNone ? t('editor.none') : undefined);
        }
        const s = el('select', {}, [
          ...(field.allowNone ? [el('option', { text: t('editor.none'), attrs: { value: '0' } })] : []),
          ...list.map((r) => el('option', { text: `${r.id} — ${r.name}`, attrs: { value: String(r.id) } })),
        ]);
        // A deleted record stays visible (and flagged) until another one is chosen.
        const missing = !(field.allowNone && id === 0) && !list.some((r) => r.id === id);
        if (missing) s.append(el('option', { text: `⚠ ${t('db.picker.missing', { id })}`, attrs: { value: String(id) } }));
        s.classList.toggle('missing', missing);
        s.value = String(id);
        s.addEventListener('change', () => {
          s.classList.toggle('missing', missing && Number(s.value) === id);
          store(Number(s.value));
        });
        return s;
      }
      case 'params': {
        const box = el('div', { className: 'param-grid' });
        for (const p of PARAMS) {
          const input = el('input', { attrs: { type: 'number', step: '1' } });
          input.value = String((value as Record<string, number>)?.[p] ?? 0);
          input.addEventListener('input', () => this.change([...path, p], Number(input.value)));
          box.append(el('label', {}, [el('span', { text: this.paramName(p) }), input]));
        }
        return box;
      }
      case 'curves':
        return this.curvesControl(value as Record<ParamName, ParamCurve>);
      case 'group': {
        const box = el('fieldset', { className: 'db-group' });
        // Drawn again when a field others depend on changes, or when a cell is picked on the map (x / y).
        const render = () => {
          const values = (getPath(this.record, path) ?? {}) as Record<string, unknown>;
          box.replaceChildren(...activeFields(field.fields, values).map((f) => this.fieldRow(f, [...path, f.key], render)));
        };
        render();
        return box;
      }
      case 'list': {
        const box = el('div', { className: 'db-list' });
        // Effects and traits are cards headed by what they do, redrawn as their fields change.
        const cards = CARD_LISTS.has(field.key);
        const seen = new WeakMap<object, Map<string, Field>>();
        let heads: (() => void)[] = [];
        if (cards) this.watchers.push(() => heads.forEach((paint) => paint()));
        const render = () => {
          const items = (getPath(this.record, path) as Record<string, unknown>[]) ?? [];
          heads = [];
          const rows = items.map((row, i) => {
            this.settle(field.fields, row, seen);
            // Fields depending on another one (objective kind, effect kind...) are shown only when they apply.
            const controls = activeFields(field.fields, row).map((f) => this.listField(f, [...path, i, f.key], render));
            const remove = el('button', {
              className: 'button small danger',
              text: '✕',
              title: t('editor.delete'),
              attrs: { type: 'button' },
              on: {
                click: () => {
                  items.splice(i, 1);
                  this.changed();
                  render();
                },
              },
            });
            if (!cards) return el('div', { className: 'db-list-item' }, [...controls, remove]);
            const head = el('div', { className: 'db-card-head' });
            const card = el('div', { className: 'db-list-item db-card' }, [el('div', { className: 'db-card-top' }, [head, remove]), el('div', { className: 'db-card-fields' }, controls)]);
            const paint = () => {
              const s = this.summary(field.key, row);
              head.replaceChildren(icon(s.icon), el('span', { className: 'db-card-text', text: s.text }), ...(s.warning ? [el('small', { className: 'db-card-warning', text: `⚠ ${s.warning}` })] : []));
              card.classList.toggle('warn', s.warning !== undefined);
            };
            paint();
            heads.push(paint);
            return card;
          });
          box.replaceChildren(
            ...rows,
            ...(cards && rows.length === 0 ? [el('p', { className: 'hint db-list-empty', text: t('db.list_empty') })] : []),
            el('button', {
              className: 'button small',
              text: t('db.add_row'),
              attrs: { type: 'button' },
              on: {
                click: () => {
                  if (items.length >= field.max) return;
                  items.push(completeValues(field.fields, {}, (f) => this.defaultOf(f)));
                  setPath(this.record, path, items);
                  this.changed();
                  render();
                },
              },
            }),
          );
        };
        render();
        return box;
      }
      case 'intList': {
        // Allowed weapon / armor types: one box per type of the System tab, named.
        const names = field.key === 'weaponTypes' ? this.lookups.system?.weaponTypes : field.key === 'armorTypes' ? this.lookups.system?.armorTypes : undefined;
        if (names) {
          const chosen = new Set((value as number[]) ?? []);
          const box = el('div', { className: 'check-list' });
          names.forEach((name, i) => {
            if (i === 0 && !name) return;
            const cb = el('input', { attrs: { type: 'checkbox' } });
            cb.checked = chosen.has(i);
            cb.addEventListener('change', () => {
              if (cb.checked) chosen.add(i);
              else chosen.delete(i);
              this.change(path, [...chosen].sort((a, b) => a - b));
            });
            box.append(el('label', { className: 'inline-check' }, [cb, el('span', { text: name || `#${i}` })]));
          });
          return box;
        }
        const input = el('input', { attrs: { type: 'text', placeholder: '1, 2, 3' } });
        input.value = ((value as number[]) ?? []).join(', ');
        input.addEventListener('input', () =>
          this.change(path, input.value.split(/[,;\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n >= field.min && n <= field.max)),
        );
        return input;
      }
      case 'appearance':
        return this.appearanceControl(path);
      case 'commands': {
        if (this.lookups.commands) {
          const list = structuredClone((value ?? []) as EventCommand[]);
          return new CommandListEditor(this.lookups.commands, list, () => this.change(path, list)).element;
        }
        const area = el('textarea', { className: 'json-area', attrs: { rows: '10', spellcheck: 'false' } });
        area.value = JSON.stringify(value ?? [], null, 1);
        area.addEventListener('input', () => {
          try {
            this.change(path, JSON.parse(area.value) as unknown);
            area.classList.remove('invalid');
          } catch {
            area.classList.add('invalid');
          }
        });
        return el('div', {}, [area, el('p', { className: 'hint', text: t('db.commands_help') })]);
      }
    }
  }

  /**
   * Damage formula: a list of ready-made formulas by role (physical, magic, healing, fixed) that fills the
   * field, which stays editable; the letters are explained under it.
   */
  private formulaControl(input: HTMLInputElement, path: (string | number)[]): HTMLElement {
    const choose = el('select', { attrs: { 'aria-label': t('db.formula.template') } }, [
      el('option', { text: t('db.formula.template'), attrs: { value: '' } }),
      ...FORMULA_TEMPLATES.map(([key, formula]) => el('option', { text: `${tDynamic(`db.formula.${key}`)} — ${formula}`, attrs: { value: formula } })),
    ]);
    choose.addEventListener('change', () => {
      if (!choose.value) return;
      input.value = choose.value;
      this.change(path, input.value);
      choose.value = '';
    });
    return el('div', { className: 'db-formula' }, [el('div', { className: 'db-formula-row' }, [input, choose]), el('small', { className: 'hint', text: t('db.formula.help') })]);
  }

  /**
   * Parameter curves of a class: one coloured mini-graph per parameter, from level 1 to the maximum level
   * (HP and MP share a scale, the six others another), and the base and growth of the one chosen under them.
   */
  private curvesControl(curves: Record<ParamName, ParamCurve>): HTMLElement {
    const maxLevel = this.lookups.system?.maxLevel ?? 99;
    const tiles = el('div', { className: 'curve-tiles' });
    const editor = el('div', { className: 'curve-editor' });
    let chosen: ParamName = 'mhp';
    const scaleOf = (p: ParamName) => {
      const group = p === 'mhp' || p === 'mmp' ? (['mhp', 'mmp'] as const) : PARAMS.filter((q) => q !== 'mhp' && q !== 'mmp');
      return Math.max(1, ...group.map((q) => paramAt(curves[q], maxLevel)));
    };
    const drawTiles = () => {
      tiles.replaceChildren(
        ...PARAMS.map((p) => {
          const canvas = el('canvas', { className: 'curve-canvas', attrs: { width: '120', height: '44', 'aria-hidden': 'true' } });
          const ctx = canvas.getContext('2d')!;
          const scale = scaleOf(p);
          ctx.fillStyle = CURVE_COLORS[p];
          ctx.beginPath();
          ctx.moveTo(0, canvas.height);
          for (let x = 0; x <= canvas.width; x++) ctx.lineTo(x, canvas.height - (paramAt(curves[p], 1 + ((maxLevel - 1) * x) / canvas.width) / scale) * (canvas.height - 2));
          ctx.lineTo(canvas.width, canvas.height);
          ctx.fill();
          return el(
            'button',
            {
              className: `curve-tile${p === chosen ? ' chosen' : ''}`,
              attrs: { type: 'button', 'aria-pressed': String(p === chosen) },
              on: { click: () => { chosen = p; drawTiles(); drawEditor(); } },
            },
            [el('span', { className: 'curve-name', text: this.paramName(p) }), canvas, el('span', { className: 'curve-range', text: `${paramAt(curves[p], 1)} → ${paramAt(curves[p], maxLevel)}` })],
          );
        }),
      );
    };
    const drawEditor = () => {
      const curve = curves[chosen];
      const preview = el('p', { className: 'curve-preview' });
      const levels = [...new Set([1, 10, 50, maxLevel].filter((l) => l <= maxLevel))];
      const refresh = () => (preview.textContent = levels.map((l) => t('db.curve.at', { level: l, value: paramAt(curve, l) })).join(' · '));
      const input = (key: 'base' | 'growth', min: string, step: string) => {
        const box = el('input', { attrs: { type: 'number', min, step, 'aria-label': t(`db.curve.${key}`) } });
        box.value = String(curve[key]);
        box.addEventListener('input', () => {
          curve[key] = Number(box.value);
          refresh();
          drawTiles();
          this.changed();
        });
        return el('label', { className: 'db-cell' }, [el('span', { className: 'db-label', text: t(`db.curve.${key}`) }), box]);
      };
      // Five levels in words for the chosen parameter: the numbers below follow, and can still be typed.
      const current = curveLevel(chosen, curve);
      const levelsRow = el('div', { className: 'curve-levels', attrs: { role: 'radiogroup', 'aria-label': t('db.curve.intensity') } }, CURVE_LEVELS.map((name, i) =>
        el('button', {
          className: `curve-level${current === i ? ' selected' : ''}`,
          text: tDynamic(`db.curve.level_${name}`),
          attrs: { type: 'button', role: 'radio', 'aria-checked': String(current === i) },
          on: { click: () => apply({ [chosen]: i }) },
        }),
      ));
      refresh();
      editor.replaceChildren(el('strong', { className: 'curve-chosen', text: this.paramName(chosen) }), levelsRow, input('base', '1', '1'), input('growth', '0', '0.1'), preview);
    };
    /** Gives parameters the curve of a level (0 = very low ... 4 = very high), then redraws. */
    const apply = (levels: Partial<Record<ParamName, number>>) => {
      for (const [p, level] of Object.entries(levels) as [ParamName, number][]) {
        const [base, growth] = curveOf(p, level);
        curves[p].base = base;
        curves[p].growth = growth;
      }
      drawTiles();
      drawEditor();
      this.changed();
    };
    // Archetypes: the eight curves at once, in one click.
    const archetypes = el('div', { className: 'curve-archetypes' }, [
      el('span', { className: 'db-label', text: t('db.curve.archetype') }),
      ...Object.entries(ARCHETYPES).map(([name, levels]) =>
        el('button', { className: 'button small', text: tDynamic(`db.curve.archetype_${name}`), title: t('db.curve.archetype_help'), attrs: { type: 'button' }, on: { click: () => apply(levels) } }),
      ),
    ]);
    drawTiles();
    drawEditor();
    return el('div', { className: 'curve-field' }, [archetypes, tiles, editor]);
  }

  /** Experience needed at every level of a class, in a window (to the next level, or in total), following its base and growth. */
  private expTable(): HTMLElement {
    return el('button', {
      className: 'button small wide db-exp-button',
      text: t('db.exp_table'),
      attrs: { type: 'button' },
      on: {
        click: () => {
          const maxLevel = this.lookups.system?.maxLevel ?? 99;
          let total = false;
          const grid = el('div', { className: 'exp-grid' });
          const tabs = el('div', { className: 'db-segment' });
          const render = () => {
            const curve = { expBase: Number(this.record.expBase) || 1, expGrowth: Number(this.record.expGrowth) || 0 };
            tabs.replaceChildren(
              ...([false, true] as const).map((isTotal) =>
                el('button', {
                  className: `db-segment-button${total === isTotal ? ' pressed' : ''}`,
                  text: t(isTotal ? 'db.exp_total' : 'db.exp_next'),
                  attrs: { type: 'button', 'aria-pressed': String(total === isTotal) },
                  on: { click: () => { total = isTotal; render(); } },
                }),
              ),
            );
            const rows: HTMLElement[] = [];
            for (let level = 1; level <= maxLevel; level++) {
              const value = total ? expForLevel(curve, level) : level < maxLevel ? expForLevel(curve, level + 1) - expForLevel(curve, level) : 0;
              rows.push(el('div', { className: 'exp-cell' }, [el('span', { className: 'data-id', text: `${t('db.level_short')} ${level}` }), el('span', { text: fmt(value) })]));
            }
            grid.replaceChildren(...rows);
          };
          render();
          openModal(this.host, t('db.exp_table_title'), el('div', { className: 'exp-table' }, [tabs, grid]), [{ label: t('ui.close') }], 'modal-exp');
        },
      },
    });
  }

  /**
   * Scope of a skill or an item as two rows of buttons: who (nobody, oneself, an enemy, an ally) and how
   * many (one, everyone in an area). The value stored stays one of the six scopes.
   */
  private scopeControl(path: (string | number)[]): HTMLElement {
    const box = el('div', { className: 'db-scope' });
    const render = () => {
      const value = String(getPath(this.record, path));
      const who = value === 'enemies_area' ? 'enemy' : value === 'allies_area' ? 'ally' : value;
      const area = value.endsWith('_area');
      const set = (w: string, inArea: boolean) => {
        this.change(path, w === 'enemy' ? (inArea ? 'enemies_area' : 'enemy') : w === 'ally' ? (inArea ? 'allies_area' : 'ally') : w);
        render();
      };
      const group = (buttons: { text: string; pressed: boolean; disabled?: boolean; pick: () => void }[]) =>
        el(
          'div',
          { className: 'db-segment', attrs: { role: 'group' } },
          buttons.map((b) =>
            el('button', {
              className: `db-segment-button${b.pressed ? ' pressed' : ''}`,
              text: b.text,
              attrs: { type: 'button', 'aria-pressed': String(b.pressed), ...(b.disabled ? { disabled: '' } : {}) },
              on: { click: b.pick },
            }),
          ),
        );
      // Nobody and oneself have no area.
      const single = who === 'none' || who === 'self';
      box.replaceChildren(
        group(['none', 'self', 'enemy', 'ally'].map((w) => ({ text: tDynamic(`db.scope.${w}`), pressed: who === w, pick: () => set(w, area && (w === 'enemy' || w === 'ally')) }))),
        group([
          { text: t('db.scope.one'), pressed: !area && !single, disabled: single, pick: () => set(who, false) },
          { text: t('db.scope.area'), pressed: area, disabled: single, pick: () => set(who, true) },
        ]),
      );
    };
    render();
    return box;
  }

  private paramName(p: string): string {
    return this.lookups.system?.terms.params[p as keyof SystemSettings['terms']['params']] || p.toUpperCase();
  }

  private appearanceControl(path: (string | number)[]): HTMLElement {
    const current = () => sanitizeAppearance(getPath(this.record, path));
    const canvas = el('canvas', { className: 'appearance-preview' });
    const draw = () => {
      const img = rasterize(drawCharacterFrame(current(), 'down', 1), 2);
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
    };
    const set = (patch: Partial<CharacterAppearance>) => {
      this.change(path, { ...current(), ...patch });
      draw();
    };
    const a = current();
    const sel = (options: [string, string][], v: string, on: (v: string) => void) => {
      const s = el('select', {}, options.map(([value, text]) => el('option', { text, attrs: { value } })));
      s.value = v;
      s.addEventListener('change', () => on(s.value));
      return s;
    };
    const range = (n: number, prefix: string): [string, string][] => Array.from({ length: n }, (_, i) => [String(i), `${prefix} ${i + 1}`]);
    draw();
    return el('div', { className: 'appearance-field' }, [
      canvas,
      el('div', { className: 'appearance-controls' }, [
        sel([['male', t('character_new.body_male')], ['female', t('character_new.body_female')]], a.body, (v) => set({ body: v as 'male' | 'female' })),
        sel(range(4, t('character_new.skin')), String(a.skin), (v) => set({ skin: Number(v) })),
        sel(HAIR_STYLES.map((h): [string, string] => [h, tDynamic(`character_new.hair_style.${h}`)]), a.hair, (v) => set({ hair: v as CharacterAppearance['hair'] })),
        sel(range(HAIR_RAMPS.length, t('character_new.hair_color')), String(a.hairColor), (v) => set({ hairColor: Number(v) })),
        sel(range(OUTFIT_RAMPS.length, t('character_new.outfit_color')), String(a.outfitColor), (v) => set({ outfitColor: Number(v) })),
      ]),
    ]);
  }
}

/** The database window. */
export class DatabaseEditor {
  private tab: Tab = 'item';
  private records: AnyRecord[] = [];
  private selected: AnyRecord | null = null;
  private dirty = false;
  /** When the lists the forms refer to were last read (0 = never). */
  private lookupsReadAt = 0;
  private readonly listEl = el('ul', { className: 'db-records' });
  /** Filters the list by number, name, description or note (Ctrl+F). */
  private readonly searchEl = el('input', { className: 'db-search', attrs: { type: 'search', placeholder: t('db.search'), 'aria-label': t('db.search') } });
  private readonly formHost = el('div', { className: 'db-form-host' });
  private readonly tabsEl = el('div', { className: 'db-tabs', attrs: { role: 'tablist' } });
  /** Phones: the 14 tabs as one list ("Enemies ▾") instead of a strip three screens wide. */
  private readonly tabSelect = el('select', { className: 'db-tab-select', attrs: { 'aria-label': t('db.tab_select') } });
  /** Phones: folds or unfolds the list of entries, naming the entry open. */
  private readonly listToggle = el('button', { className: 'button small db-list-toggle', attrs: { type: 'button', 'aria-expanded': 'true' } });
  private readonly side = el('div', { className: 'db-side' });
  private readonly status = el('span', { className: 'db-status' });
  private readonly lookups: Lookups = { records: {}, resources: {}, system: null };
  private close: () => void = () => undefined;
  /** Body of the open window (detached once closed). */
  private body: HTMLElement | null = null;
  /** New / duplicate / delete buttons (hidden on the settings tabs). */
  private sideTools: HTMLElement | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly api: EditorApi,
    resources: Record<string, string[]>,
    private readonly loadCommandLookups?: () => Promise<CommandLookups>,
    assets?: AssetStore,
  ) {
    this.lookups.resources = resources;
    this.lookups.assets = assets;
    const events = new Map<number, Promise<{ id: number; name: string }[]>>();
    this.lookups.mapEvents = (mapId) => {
      let list = events.get(mapId);
      if (!list) {
        list = this.api
          .get<{ map: { events: ({ id: number; name: string } | null)[] } }>(`/maps/${mapId}`)
          .then((r) => r.map.events.filter((e): e is { id: number; name: string } => e !== null).map((e) => ({ id: e.id, name: e.name })))
          .catch(() => []);
        events.set(mapId, list);
      }
      return list;
    };
    this.lookups.goTo = (type, id) =>
      void this.guarded(async () => {
        if (this.tab !== type) await this.showTab(type);
        // Unsaved changes kept (the switch was cancelled): stay where we are.
        const record = this.tab === type ? this.records.find((r) => r.id === id) : undefined;
        if (record) await this.select(record);
      });
  }

  /** Opens the window. */
  async open(): Promise<void> {
    this.lookups.system = (await this.api.get<{ system: SystemSettings }>('/system')).system;
    // New / duplicate / delete only make sense for lists of records, not for the settings tabs.
    this.sideTools = el('div', { className: 'db-side-tools' }, [
      el('button', { className: 'button small', text: t('db.new'), attrs: { type: 'button' }, on: { click: () => void this.guarded(() => this.create()) } }),
      el('button', { className: 'button small', text: t('db.duplicate'), attrs: { type: 'button' }, on: { click: () => void this.guarded(() => this.create(true)) } }),
      el('button', { className: 'button small danger', text: t('editor.delete'), attrs: { type: 'button' }, on: { click: () => void this.remove() } }),
    ]);
    this.side.replaceChildren(this.listToggle, this.sideTools, this.searchEl, this.listEl);
    this.listToggle.addEventListener('click', () => this.foldList(!this.side.classList.contains('folded')));
    this.tabSelect.addEventListener('change', () => void this.showTab(this.tabSelect.value as Tab));
    const body = el('div', { className: 'db-editor' }, [this.tabsEl, this.tabSelect, el('div', { className: 'db-main' }, [this.side, this.formHost])]);
    this.body = body;
    this.searchEl.addEventListener('input', () => this.renderList());
    this.searchEl.addEventListener('keydown', (e) => {
      // Escape empties the search first; a second one closes the window.
      if (e.key !== 'Escape' || this.searchEl.value === '') return;
      e.stopPropagation();
      this.searchEl.value = '';
      this.renderList();
    });
    body.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f' || this.searchEl.classList.contains('hidden')) return;
      e.preventDefault();
      e.stopPropagation();
      this.searchEl.focus();
      this.searchEl.select();
    });
    // Closing with unsaved changes (button or Escape) asks first.
    const mayClose = async () => !this.dirty || (await this.confirmDiscard());
    this.close = openModal(this.host, t('db.title'), body, [
      { label: t('db.export'), onClick: () => this.exportAll() },
      { label: t('db.import'), onClick: () => this.importAll() },
      { label: t('ui.close'), onClick: async () => ((await mayClose()) ? undefined : false) },
      { label: t('editor.save'), primary: true, onClick: async () => { await this.guarded(() => this.save()); return false; } },
    ], '', mayClose);
    body.closest('.modal')?.classList.add('db-modal');
    this.renderTabs();
    await this.showTab('item');
  }

  /** Tells whether the window is open with changes not saved yet. */
  hasUnsavedChanges(): boolean {
    return this.dirty && this.body?.isConnected === true;
  }

  /** Phones: folds the list of entries (the form gets the screen) or unfolds it; the button names the entry open. */
  private foldList(folded: boolean): void {
    this.side.classList.toggle('folded', folded);
    this.listToggle.setAttribute('aria-expanded', String(!folded));
    const name = this.selected && !isSettingsTab(this.tab) ? `${String(this.selected.id).padStart(3, '0')} ${String(this.selected.name ?? '')}` : '';
    this.listToggle.textContent = folded ? t('db.list_show', { name }) : t('db.list_hide');
  }

  private renderTabs(): void {
    const tabs: Tab[] = [...DATABASE_TYPES, 'switches', 'system', 'terms'];
    // (A switch refused because of unsaved changes leaves the list on the tab still shown.)
    this.tabSelect.replaceChildren(...tabs.map((tab) => el('option', { text: tDynamic(`db.tab.${tab}`), attrs: { value: tab } })));
    this.tabSelect.value = this.tab;
    this.tabsEl.replaceChildren(
      ...tabs.map((tab) =>
        el('button', {
          className: `palette-tab${tab === this.tab ? ' active' : ''}`,
          text: tDynamic(`db.tab.${tab}`),
          attrs: { type: 'button', role: 'tab' },
          on: { click: () => void this.showTab(tab) },
        }),
      ),
    );
  }

  private async loadType(type: DatabaseType): Promise<AnyRecord[]> {
    const { records } = await this.api.get<{ records: AnyRecord[] }>(`/db/${type}`);
    this.lookups.records[type] = records;
    return records;
  }

  /**
   * Reads the records the forms refer to (skills of classes and enemies, animations, quest targets,
   * states and common events of effects...), also listed under "Used by".
   */
  private async loadLookups(force = false): Promise<void> {
    // Saving, creating and deleting keep the lists of the window in step (`setRecords`): going from tab to tab
    // only reads them again when they were never read, or a while ago (another administrator may have edited).
    if (!force && Date.now() - this.lookupsReadAt < LOOKUPS_MAX_AGE_MS) return;
    await Promise.all((['class', 'skill', 'animation', 'item', 'state', 'weapon', 'armor', 'enemy', 'quest', 'commonEvent'] as DatabaseType[]).map((ty) => this.loadType(ty)));
    this.lookupsReadAt = Date.now();
  }

  private async showTab(tab: Tab): Promise<void> {
    if (this.dirty && !(await this.confirmDiscard())) return;
    this.dirty = false;
    this.tab = tab;
    this.sideTools?.classList.toggle('hidden', isSettingsTab(tab));
    this.searchEl.classList.toggle('hidden', isSettingsTab(tab));
    this.searchEl.value = '';
    this.renderTabs();
    await this.loadLookups();
    if ((tab === 'commonEvent' || tab === 'quest' || tab === 'raid' || tab === 'system' || tab === 'class') && this.loadCommandLookups && !this.lookups.commands) {
      this.lookups.commands = { assets: this.lookups.assets, ...(await this.loadCommandLookups()), host: this.host };
    }
    if (isSettingsTab(tab)) {
      // The tabs edit the settings object in place: start from what is stored, so discarded edits are really gone.
      this.lookups.system = (await this.api.get<{ system: SystemSettings }>('/system')).system;
      this.listEl.replaceChildren();
      this.selected = null;
      this.setStatus('');
      if (tab === 'switches') this.renderSwitches();
      else this.renderSystem(tab);
      return;
    }
    this.records = await this.loadType(tab);
    await this.select(this.records[0] ?? null);
  }

  /** Replaces the records of the current tab (the forms' lookups see the same list). */
  private setRecords(records: AnyRecord[]): void {
    this.records = records;
    if (!isSettingsTab(this.tab)) this.lookups.records[this.tab] = records;
  }

  private renderList(): void {
    const icons = !isSettingsTab(this.tab) && ICON_TYPES.has(this.tab);
    const query = this.searchEl.value.trim().toLowerCase();
    const matches = (r: AnyRecord) =>
      !query || String(r.id) === query.replace(/^#/, '') || [r.name, r.description, r.note].some((v) => typeof v === 'string' && v.toLowerCase().includes(query));
    const shown = this.records.filter(matches);
    this.listEl.replaceChildren(
      ...shown.map((r) => {
        const separator = isSeparator(r.name);
        return el('li', { className: separator ? 'db-separator' : '' }, [
          el(
            'button',
            {
              className: `tree-label db-record${r.id === this.selected?.id ? ' current' : ''}`,
              attrs: { type: 'button' },
              // Phones: once an entry is chosen, its list folds away and the form gets the screen.
              on: { click: () => void this.select(r).then(() => matchMedia('(max-width: 800px)').matches && this.foldList(true)) },
            },
            [
              icons && !separator ? icon(Number(r.icon) || 0) : null,
              el('span', { className: 'db-record-id', text: String(r.id).padStart(3, '0') }),
              el('span', { className: 'db-record-name', text: separator ? separatorTitle(r.name) : r.name }),
            ],
          ),
        ]);
      }),
      ...(query && shown.length === 0 ? [el('li', { className: 'hint db-no-match', text: t('db.picker.no_match') })] : []),
    );
    this.listEl.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }

  /** Asks whether the unsaved changes of the current entry can be dropped. */
  private confirmDiscard(): Promise<boolean> {
    return confirmDialog({ title: t('editor.unsaved_title'), message: t('db.discard_question'), ok: t('editor.discard'), danger: true });
  }

  private async select(record: AnyRecord | null): Promise<void> {
    if (this.dirty && record !== this.selected && !(await this.confirmDiscard())) return;
    this.dirty = false;
    this.selected = record ? (JSON.parse(JSON.stringify(record)) as AnyRecord) : null;
    // Records saved before a field existed get its default value (e.g. the start place of a class).
    if (this.selected && !isSettingsTab(this.tab)) {
      try {
        this.selected = normalizeRecord(this.tab, this.selected, this.selected.id) as unknown as AnyRecord;
      } catch {
        // Shown as stored: the server reports what is wrong on saving.
      }
    }
    this.renderList();
    this.foldList(this.side.classList.contains('folded'));
    if (!this.selected || isSettingsTab(this.tab)) {
      this.formHost.replaceChildren(el('p', { className: 'hint', text: t('db.empty') }));
      return;
    }
    const form = new RecordForm(this.host, SCHEMAS[this.tab], this.selected, this.lookups, () => {
      this.dirty = true;
      this.setStatus(t('editor.unsaved'));
    }, this.tab);
    this.setStatus('');
    // An enemy can be tried out at once, next to the administrator's character in game.
    const tools =
      this.tab === 'enemy'
        ? [el('button', { className: 'button small db-title-tool', text: t('db.test_enemy'), title: t('db.test_enemy_help'), attrs: { type: 'button' }, on: { click: () => void this.guarded(() => this.testEnemy()) } })]
        : [];
    this.formHost.replaceChildren(el('div', { className: 'db-form-title' }, [el('strong', { text: `#${this.selected.id}` }), this.status, ...tools]), form.element);
    this.formHost.scrollTop = 0;
  }

  /** Makes the enemy appear next to the administrator's character (saved first: the game plays the stored record). */
  private async testEnemy(): Promise<void> {
    if (this.dirty) {
      await this.save();
      // Not saved (an invalid field, reported in the status line): nothing to test yet.
      if (this.dirty) return;
    }
    const target = this.selected;
    if (!target) return;
    await this.api.post(`/db/enemy/${target.id}/test`);
    this.setStatus(t('db.test_enemy_done', { name: target.name }));
  }

  /** Readable name of a field path (`effects[0].value` → « Effets n° 1 › État »). */
  private pathLabel(path: string): string {
    if (isSettingsTab(this.tab)) return path;
    let fields = SCHEMAS[this.tab];
    let values: unknown = this.selected;
    const parts: string[] = [];
    for (const segment of path.split('.')) {
      const match = /^(\w+)(?:\[(\d+)\])?$/.exec(segment);
      const src = (values ?? {}) as Record<string, unknown>;
      const field = match && (activeFields(fields, src).find((f) => f.key === match[1]) ?? fields.find((f) => f.key === match[1]));
      if (!match || !field) return path;
      const name = label(field.label ?? field.key);
      parts.push(match[2] === undefined ? name : t('db.check.row', { field: name, n: Number(match[2]) + 1 }));
      values = match[2] === undefined ? src[field.key] : (src[field.key] as unknown[] | undefined)?.[Number(match[2])];
      fields = field.type === 'list' || field.type === 'group' ? field.fields : [];
    }
    return parts.join(' › ');
  }

  private renderSystem(tab: 'system' | 'terms'): void {
    const sys = this.lookups.system!;
    const fields: Field[] =
      tab === 'system'
        ? [
            { key: 'gameTitle', type: 'text', max: 100 },
            { key: 'currencyName', type: 'text', max: 30 },
            { key: 'startingGold', type: 'int', min: 0, max: 99_999_999 },
            { key: 'statPointsPerLevel', type: 'int', min: 0, max: 20 },
            { key: 'sellRate', type: 'int', min: 0, max: 100 },
            { key: 'bagSize', type: 'int', min: 10, max: 200 },
            { key: 'maxLevel', type: 'int', min: 1, max: 999 },
            { key: 'maxPartySize', type: 'int', min: 2, max: 40 },
            { key: 'maxRaidSize', type: 'int', min: 2, max: 40 },
            { key: 'instanceIdleMinutes', type: 'int', min: 1, max: 1440 },
            { key: 'guildCreationCost', type: 'int', min: 0, max: 99_999_999 },
            { key: 'startPosition', type: 'group', fields: [{ key: 'mapId', type: 'map' }, { key: 'x', type: 'int', min: 0, max: 255 }, { key: 'y', type: 'int', min: 0, max: 255 }, { key: 'pick', type: 'cell', mapKey: 'mapId' }] },
          ]
        : [
            { key: 'terms', type: 'group', fields: [{ key: 'level', type: 'text', max: 30 }, { key: 'hp', type: 'text', max: 30 }, { key: 'mp', type: 'text', max: 30 }, { key: 'xp', type: 'text', max: 30 }] },
          ];
    const form = new RecordForm(this.host, fields, sys as unknown as Record<string, unknown>, this.lookups, () => {
      this.dirty = true;
      this.setStatus(t('editor.unsaved'));
    }, this.tab);
    const changed = () => {
      this.dirty = true;
      this.setStatus(t('editor.unsaved'));
    };
    const panel = (title: string, children: HTMLElement[]) =>
      el('div', { className: 'db-wide-panel' }, [el('section', { className: `db-panel db-panel-${title}` }, [el('h3', { className: 'db-panel-title', text: tDynamic(`db.section.${title}`) }), ...children])]);
    // Element, weapon and armor types are numbered lists: records point to them by number, so a
    // line is renamed in place and only the last one can be removed (the others would shift).
    const listEditor = (key: SystemList) => {
      const box = el('div', { className: 'db-type-list' });
      const render = (focusLast = false) => {
        const names = sys[key];
        const rows = names.map((n, i) => {
          const input = el('input', { attrs: { type: 'text', maxlength: '40', 'aria-label': `${label(key)} ${i}` } });
          input.value = n;
          if (i === 0) input.placeholder = t('db.element_none');
          input.addEventListener('input', () => {
            sys[key][i] = input.value;
            changed();
          });
          return el('li', {}, [el('span', { className: 'data-id', text: String(i).padStart(2, '0') }), input]);
        });
        const add = el('button', { className: 'button small', text: t('db.add_row'), attrs: { type: 'button' }, on: { click: () => { sys[key].push(''); changed(); render(true); } } });
        const removeLast = el('button', {
          className: 'button small danger',
          text: '−',
          title: t('db.remove_last'),
          attrs: { type: 'button', ...(names.length <= 1 ? { disabled: '' } : {}) },
          on: { click: () => { sys[key].pop(); changed(); render(); } },
        });
        box.replaceChildren(el('h4', { text: tDynamic(`db.list_title.${key}`) }), el('ol', { className: 'db-numbered' }, rows), el('div', { className: 'inline-row' }, [add, removeLast]));
        if (focusLast) box.querySelector<HTMLInputElement>('li:last-child input')?.focus();
      };
      render();
      return box;
    };
    const extra: HTMLElement[] = [];
    if (tab === 'system') {
      extra.push(panel('lists', [el('p', { className: 'hint db-panel-intro', text: t('db.lists_help') }), el('div', { className: 'db-type-lists' }, [listEditor('elements'), listEditor('weaponTypes'), listEditor('armorTypes'), listEditor('skillTypes')])]));
    } else {
      const box = el('div', { className: 'param-grid' });
      for (const p of PARAMS) {
        const input = el('input', { attrs: { type: 'text', maxlength: '30' } });
        input.value = sys.terms.params[p];
        input.addEventListener('input', () => {
          sys.terms.params[p] = input.value;
          changed();
        });
        // What the parameter does in a fight, under its name (the same text as in the game's Character window).
        box.append(el('label', { title: tDynamic(`status.param_help.${p}`) }, [el('span', { text: p.toUpperCase() }), input, el('small', { className: 'hint param-help', text: tDynamic(`status.param_help.${p}`) })]));
      }
      extra.push(panel('param_names', [box]));
    }
    this.formHost.replaceChildren(el('div', { className: 'db-form-title' }, [el('strong', { text: tDynamic(`db.tab.${tab}`) }), this.status]), form.element, ...extra);
  }

  /** Switch and variable declarations: name and scope of each id. */
  private renderSwitches(): void {
    const sys = this.lookups.system!;
    const column = (key: 'switches' | 'variables') => {
      const box = el('div', { className: 'data-names' });
      const render = () => {
        box.replaceChildren(
          ...sys[key].map((d, i) => {
            const name = el('input', { attrs: { type: 'text', maxlength: '60', 'aria-label': `#${i + 1}` } });
            name.value = d.name;
            name.addEventListener('input', () => {
              d.name = name.value;
              this.dirty = true;
              this.setStatus(t('editor.unsaved'));
            });
            const global = el('input', { attrs: { type: 'checkbox' } });
            global.checked = d.global;
            global.addEventListener('change', () => {
              d.global = global.checked;
              this.dirty = true;
              this.setStatus(t('editor.unsaved'));
            });
            const instance = el('input', { attrs: { type: 'checkbox' } });
            instance.checked = d.instance === true;
            instance.addEventListener('change', () => {
              d.instance = instance.checked;
              if (instance.checked) {
                d.global = false;
                global.checked = false;
              }
              this.dirty = true;
              this.setStatus(t('editor.unsaved'));
            });
            return el('div', { className: 'data-name-row' }, [
              el('span', { className: 'data-id', text: `#${String(i + 1).padStart(4, '0')}` }),
              name,
              el('label', { className: 'inline-check' }, [global, el('span', { text: t('db.global') })]),
              // Instance scope exists for switches only.
              key === 'switches' ? el('label', { className: 'inline-check', title: t('db.instance_help') }, [instance, el('span', { text: t('db.instance') })]) : el('span'),
            ]);
          }),
        );
      };
      render();
      const add = el('button', {
        className: 'button small',
        text: key === 'switches' ? t('db.add_switch') : t('db.add_variable'),
        attrs: { type: 'button' },
        on: {
          click: () => {
            sys[key].push({ name: '', global: false });
            this.dirty = true;
            this.setStatus(t('editor.unsaved'));
            render();
          },
        },
      });
      // Only the last declaration can be removed, so ids used by events never shift.
      const removeLast = el('button', {
        className: 'button small danger',
        text: '−',
        attrs: { type: 'button', title: t('editor.delete') },
        on: {
          click: () => {
            sys[key].pop();
            this.dirty = true;
            this.setStatus(t('editor.unsaved'));
            render();
          },
        },
      });
      return el('section', { className: 'data-column' }, [el('h3', { text: t(key === 'switches' ? 'db.switches' : 'db.variables') }), box, el('div', { className: 'inline-row' }, [add, removeLast])]);
    };
    this.formHost.replaceChildren(
      el('div', { className: 'db-form-title' }, [el('strong', { text: t('db.tab.switches') }), this.status]),
      el('p', { className: 'hint', text: t('db.switches_help') }),
      el('div', { className: 'data-columns' }, [column('switches'), column('variables')]),
    );
  }

  /** Shows a status message next to the title; errors are highlighted. */
  private setStatus(text: string, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('error', error);
  }

  /** Shows the error of a failed request (the server's message when it sent one). */
  private showError(err: unknown): void {
    if (err instanceof EditorApiError && err.key === 'error.db.missing_ref' && typeof err.params.field === 'string') {
      this.setStatus(t('db.check.missing_ref', { field: this.pathLabel(err.params.field) }), true);
    } else this.setStatus(err instanceof EditorApiError ? tDynamic(err.key, err.params) : t('error.http.server'), true);
  }

  /** Runs an action of a button and reports its failure instead of dropping it. */
  private async guarded(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (err) {
      this.showError(err);
    }
  }

  /**
   * Checks the visible fields before saving (the server would otherwise clamp
   * or drop the values silently); reports and focuses the first invalid one.
   */
  private checkForm(): boolean {
    const fields = [...this.formHost.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].filter((f) => f.offsetParent !== null);
    // An emptied number field would be sent as 0, whatever its control.
    const empty = (f: HTMLInputElement | HTMLTextAreaElement) => f instanceof HTMLInputElement && f.type === 'number' && f.value.trim() === '';
    const bad = fields.find((f) => !f.checkValidity() || empty(f));
    if (!bad) return true;
    bad.focus();
    const field =
      bad.closest('label')?.querySelector('span')?.textContent?.trim() ||
      bad.closest('.db-row, .db-cell')?.querySelector('.db-label')?.textContent?.trim() ||
      bad.getAttribute('aria-label') ||
      '?';
    const number = (v: string) => Number(v).toLocaleString(document.documentElement.lang || undefined);
    let message: string;
    if (bad.validity.valueMissing || empty(bad)) message = t('db.check.required', { field });
    else if (bad instanceof HTMLInputElement && bad.type === 'number') {
      message = t(bad.step === '1' ? 'db.check.range_int' : 'db.check.range', { field, min: number(bad.min), max: number(bad.max) });
    } else message = t('db.check.invalid', { field });
    this.setStatus(message, true);
    return false;
  }

  private async save(): Promise<void> {
    if (!this.checkForm()) return;
    if (isSettingsTab(this.tab)) {
      this.lookups.system = (await this.api.put<{ system: SystemSettings }>('/system', { system: this.lookups.system })).system;
      // The form shows what was stored (the server may have adjusted values).
      this.dirty = false;
      if (this.tab === 'switches') this.renderSwitches();
      else this.renderSystem(this.tab);
    } else if (this.selected) {
      // Same rule as the server: an effect or a trait aimed at a deleted state would silently do nothing.
      const missing = findMissingRef(this.tab, this.selected, (type, id) => this.lookups.records[type]?.some((r) => r.id === id) ?? true);
      if (missing) {
        this.setStatus(t('db.check.missing_ref', { field: this.pathLabel(missing.path) }), true);
        return;
      }
      const { record } = await this.api.put<{ record: AnyRecord }>(`/db/${this.tab}/${this.selected.id}`, { record: this.selected });
      this.setRecords(this.records.map((r) => (r.id === record.id ? record : r)));
      this.dirty = false;
      await this.select(this.records.find((r) => r.id === record.id) ?? null);
    }
    this.dirty = false;
    this.setStatus(t('db.saved'));
  }

  private async create(copy = false): Promise<void> {
    if (isSettingsTab(this.tab)) return;
    // The new entry replaces the form: unsaved changes of the current one are asked about first.
    if (this.dirty && !(await this.confirmDiscard())) return;
    const { record } = await this.api.post<{ record: AnyRecord }>(`/db/${this.tab}`, copy && this.selected ? { copyOf: this.selected.id } : {});
    this.records.push(record);
    this.dirty = false;
    await this.select(record);
  }

  private async remove(): Promise<void> {
    const target = this.selected;
    if (!target || isSettingsTab(this.tab)) return;
    const type = this.tab;
    const name = target.name || `#${target.id}`;
    if (!(await confirmDialog({ title: t('editor.delete'), message: t('db.delete_confirm', { name }), ok: t('editor.delete'), danger: true }))) return;
    let cleaned: boolean | null = false;
    try {
      try {
        await this.api.delete(`/db/${type}/${target.id}`);
      } catch (err) {
        // Still used somewhere: say where, and delete only if confirmed again.
        if (!(err instanceof EditorApiError) || err.key !== 'error.db.in_use') throw err;
        const usages = (err.body.usages ?? []) as DatabaseUsage[];
        const list = usages.map((u) => `• ${describeUsage(u)}`).join('\n');
        const more = err.params.count !== undefined && Number(err.params.count) > usages.length ? `\n${t('db.use.more', { count: Number(err.params.count) - usages.length })}` : '';
        const confirm = { title: t('db.in_use_title'), message: t('db.in_use_confirm', { name, list: list + more }), ok: t('db.delete_anyway'), danger: true };
        // Other records point to it: their effects, traits and rows aimed at it can go with it.
        if (usages.some((u) => u.kind === 'record')) {
          cleaned = await confirmWithOption(confirm, t('db.delete_clean'));
          if (cleaned === null) return;
        } else if (!(await confirmDialog(confirm))) return;
        await this.api.delete(`/db/${type}/${target.id}?force=1${cleaned ? '&clean=1' : ''}`);
      }
      // The next entry gets the selection (the previous one at the end of the list), never the first one.
      const index = this.records.findIndex((r) => r.id === target.id);
      // Cleaned records of other tabs are read again, for the pickers and the "used by" lists.
      if (cleaned) await this.loadLookups(true);
      this.setRecords((this.lookups.records[type] ?? this.records).filter((r) => r.id !== target.id));
      this.dirty = false;
      await this.select(this.records[Math.min(index, this.records.length - 1)] ?? null);
      this.setStatus(t('db.deleted', { name }));
    } catch (err) {
      this.showError(err);
    }
  }

  private exportAll(): boolean {
    const link = el('a', { attrs: { href: '/api/editor/db-export', download: 'database.json' } });
    this.host.append(link);
    link.click();
    link.remove();
    return false;
  }

  private importAll(): boolean {
    const input = el('input', { attrs: { type: 'file', accept: '.json,application/json' } });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!(await confirmDialog({ title: t('db.import'), message: t('db.import_confirm'), ok: t('db.import'), danger: true }))) return;
      try {
        const data = JSON.parse(await file.text()) as unknown;
        const { quarantined, missingRefs } = await this.api.post<{ quarantined?: number; missingRefs?: { count: number; first: { type: DatabaseType; id: number; field: string; value: string }[] } }>('/db-import', data);
        // Everything was replaced: the form reloads (without asking about its old edits), then says so.
        this.dirty = false;
        this.lookupsReadAt = 0;
        await this.showTab(this.tab);
        const done = quarantined ? t('db.imported_quarantined', { count: quarantined }) : t('db.imported');
        if (!missingRefs?.count) this.setStatus(done);
        else {
          // Imported anyway (a forced deletion can leave some): the first ones are named so they can be fixed.
          const list = missingRefs.first.map((m) => t('db.import_missing_ref', { type: tDynamic(`db.tab.${m.type}`), id: m.id, field: m.field, value: m.value })).join(' · ');
          this.setStatus(`${done} ${t('db.imported_missing_refs', { count: missingRefs.count, list })}`, true);
        }
      } catch (err) {
        this.setStatus(err instanceof EditorApiError ? tDynamic(err.key, err.params) : t('error.editor.invalid_json'), true);
      }
    });
    input.click();
    return false;
  }

  /** Closes the window. */
  dispose(): void {
    this.close();
  }
}

/** One line of the "still used" warning (database records and maps). */
export function describeUsage(u: DatabaseUsage): string {
  switch (u.kind) {
    case 'record':
      return t('db.use.record', { type: tDynamic(`db.tab.${u.type}`), name: u.name || `#${u.id}` });
    case 'map': {
      const parts = [...(u.spawns ? [t('db.use.spawns')] : []), ...u.events.map((e) => t('db.use.event', { name: e }))];
      return t('db.use.map', { name: u.name, detail: parts.join(', ') });
    }
    case 'characters':
      return t('db.use.characters', { count: u.count });
    case 'questProgress':
      return t('db.use.quest_progress', { count: u.count });
    case 'guildBanks':
      return t('db.use.guild_banks', { count: u.count });
    case 'respawns':
      return t('db.use.respawns', { count: u.count });
  }
}
