/**
 * @file Quick event forms, without their interface: which form can edit an event, the values the form
 * shows, and the event it builds from them.
 *
 * A quick form only shows part of an event (the text of a character, the destination of a teleporter,
 * the contents of a chest). Editing an existing event with it changes only that part: the rest of its
 * pages (trigger, movement, conditions, options) is kept. An event whose commands hold more than its
 * form can show (a face per message, a destination read from variables, several items...) is not
 * offered to a quick form at all: it opens in the full editor.
 */
import { Cmd, Priority, Trigger, createPage, emptyConditions, textCommands, type EventCommand, type EventImage, type EventPage, type GameEvent } from '../../shared/events.js';
import type { Direction } from '../../shared/settings.js';

/** Kinds of quick events (`json`: none of the forms, the event is edited as a whole). */
export type QuickKind = 'teleport' | 'npc' | 'sign' | 'chest' | 'json';

/** Values shown by the quick forms. */
export interface QuickValues {
  /** Teleporter: destination map, cell, direction (0 = keep) and fade. */
  destMap: number;
  destX: number;
  destY: number;
  destDir: Direction | 0;
  fade: number;
  /** Character: sheet, index in the sheet and facing. */
  sheet: string;
  sheetIndex: number;
  facing: Direction;
  /** Character and sign: face of the messages, speaker and text (a blank line separates two messages). */
  face: [string, number];
  speaker: string;
  text: string;
  /** Chest: item given (0 = none), how many, and gold. */
  chestItem: number;
  chestCount: number;
  chestGold: number;
}

/** What a new event starts with. */
export interface QuickDefaults {
  /** Map of a new teleporter's destination. */
  mapId: number;
  /** Item of a new chest. */
  itemId: number;
}

const CHEST_IMAGE: EventImage = { tileId: 0, characterName: '!Objects1', characterIndex: 0, direction: 2, pattern: 1 };
const END: EventCommand = { code: Cmd.End, indent: 0, parameters: [] };

const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Messages of a text-only event, one block per message (lines separated by newlines). */
function messagesOf(list: EventCommand[]): { face: [string, number]; speaker: string; text: string } {
  const blocks: string[] = [];
  let face: [string, number] = ['', 0];
  let speaker = '';
  for (const c of list) {
    if (c.code === Cmd.ShowText) {
      face = [String(c.parameters[0] ?? ''), num(c.parameters[1], 0)];
      speaker = String(c.parameters[4] ?? '');
      blocks.push('');
    } else if (c.code === Cmd.TextLine) {
      const last = blocks.length - 1;
      blocks[last] = blocks[last] ? `${blocks[last]}\n${String(c.parameters[0])}` : String(c.parameters[0]);
    }
  }
  return { face, speaker, text: blocks.join('\n\n') };
}

/** Builds text commands from blocks separated by blank lines (four lines max per message). */
function commandsFromText(text: string, face: [string, number], speaker: string): EventCommand[] {
  const out: EventCommand[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l, i, all) => l !== '' || i < all.length - 1);
    for (let i = 0; i < lines.length; i += 4) out.push(...textCommands(lines.slice(i, i + 4), face, speaker));
  }
  out.push({ ...END });
  return out;
}

/**
 * Reads the values a quick form shows for an event.
 * @param e - Event to edit, or `null` for a new one.
 * @param defaults - Starting values of a new event.
 */
export function readQuickValues(e: GameEvent | null, defaults: QuickDefaults): QuickValues {
  const page = e?.pages[0];
  const list = page?.list ?? [];
  const transfer = list.find((c) => c.code === Cmd.TransferPlayer)?.parameters;
  const giveItem = list.find((c) => c.code === Cmd.ChangeItems)?.parameters;
  const giveGold = list.find((c) => c.code === Cmd.ChangeGold)?.parameters;
  const msgs = messagesOf(list);
  return {
    destMap: num(transfer?.[1], defaults.mapId),
    destX: num(transfer?.[2], 0),
    destY: num(transfer?.[3], 0),
    destDir: num(transfer?.[4], 0) as Direction | 0,
    fade: num(transfer?.[5], 0),
    sheet: page?.image.characterName ?? 'People1',
    sheetIndex: page?.image.characterIndex ?? 0,
    facing: page?.image.direction ?? 2,
    face: e ? msgs.face : ['People1', 0],
    speaker: msgs.speaker,
    text: msgs.text,
    chestItem: e ? num(giveItem?.[0], 0) : defaults.itemId,
    chestCount: num(giveItem?.[3], 1),
    chestGold: num(giveGold?.[2], 0),
  };
}

/**
 * Builds an event from the values of a quick form.
 * @param kind - Form used (not `json`).
 * @param values - Values of the form.
 * @param base - Identity of the event (number, name, note, cell).
 * @param kept - Pages of the event being edited, whose settings the form does not show and keeps
 *   (`null` for a new event, or when the kind of the event was changed in the form).
 * @param emptyChestText - Message of an opened chest.
 */
export function buildQuickEvent(kind: Exclude<QuickKind, 'json'>, values: QuickValues, base: Pick<GameEvent, 'id' | 'name' | 'note' | 'x' | 'y'>, kept: EventPage[] | null, emptyChestText: string): GameEvent {
  // A page of the edited event keeps everything but what the form changes; a new page starts from the form's defaults.
  const page = (index: number, defaults: Partial<EventPage>, edits: Partial<EventPage>): EventPage => {
    const old = kept?.[index];
    return old ? { ...structuredClone(old), ...edits } : createPage({ ...defaults, ...edits });
  };
  if (kind === 'teleport') {
    const list = [{ code: Cmd.TransferPlayer, indent: 0, parameters: [0, values.destMap, values.destX, values.destY, values.destDir, values.fade] }, { ...END }];
    return { ...base, pages: [page(0, { priorityType: Priority.Below, trigger: Trigger.PlayerTouch }, { list })] };
  }
  if (kind === 'chest') {
    const list: EventCommand[] = [];
    if (values.chestItem > 0) list.push({ code: Cmd.ChangeItems, indent: 0, parameters: [values.chestItem, 0, 0, values.chestCount] });
    if (values.chestGold > 0) list.push({ code: Cmd.ChangeGold, indent: 0, parameters: [0, 0, values.chestGold] });
    list.push({ code: Cmd.ControlSelfSwitch, indent: 0, parameters: ['A', 0] }, { ...END });
    return {
      ...base,
      pages: [
        page(0, { priorityType: Priority.Same, trigger: Trigger.Action, directionFix: true, image: { ...CHEST_IMAGE } }, { list }),
        page(1, {
          conditions: { ...emptyConditions(), selfSwitchValid: true, selfSwitchCh: 'A' },
          priorityType: Priority.Same,
          trigger: Trigger.Action,
          directionFix: true,
          image: { ...CHEST_IMAGE, direction: 8 },
          list: [...textCommands([emptyChestText]), { ...END }],
        }, {}),
      ],
    };
  }
  const list = commandsFromText(values.text, values.face, values.speaker);
  if (kind === 'sign') return { ...base, pages: [page(0, { priorityType: Priority.Same, trigger: Trigger.Action }, { list })] };
  const image: EventImage = { ...(kept?.[0]?.image ?? createPage().image), tileId: 0, characterName: values.sheet, characterIndex: values.sheetIndex, direction: values.facing };
  return { ...base, pages: [page(0, { priorityType: Priority.Same, trigger: Trigger.Action }, { image, list })] };
}

/** The form an event looks like, judging by its commands only. */
function likelyKind(e: GameEvent): QuickKind {
  const first = e.pages[0]?.list.filter((c) => c.code !== Cmd.End) ?? [];
  // A chest gives once per character (self switch A), then a second page says it is empty.
  const given = first.filter((c) => c.code !== Cmd.ControlSelfSwitch);
  if (given.length > 0 && given.every((c) => c.code === Cmd.ChangeItems || c.code === Cmd.ChangeGold) && e.pages.length === 2 && e.pages[1]!.conditions.selfSwitchValid) return 'chest';
  if (e.pages.length !== 1) return 'json';
  if (first.length === 1 && first[0]!.code === Cmd.TransferPlayer && e.pages[0]!.trigger === Trigger.PlayerTouch) return 'teleport';
  if (first.length > 0 && first.every((c) => c.code === Cmd.ShowText || c.code === Cmd.TextLine)) return e.pages[0]!.image.characterName ? 'npc' : 'sign';
  return 'json';
}

/** Compares two pieces of stored data, whatever the order of their fields. */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const fields = (o: object) => Object.entries(o).filter(([, v]) => v !== undefined);
  const fa = fields(a);
  const fb = new Map(fields(b));
  return fa.length === fb.size && fa.every(([k, v]) => fb.has(k) && sameData(v, fb.get(k)));
}

/**
 * Recognises which quick form can edit an event: one that rebuilds it exactly as it is from the values
 * it shows (`json` when none can).
 */
export function quickKindOf(e: GameEvent): QuickKind {
  const kind = likelyKind(e);
  if (kind === 'json') return 'json';
  const rebuilt = buildQuickEvent(kind, readQuickValues(e, { mapId: 0, itemId: 0 }), e, e.pages, '');
  return sameData(rebuilt.pages, e.pages) ? kind : 'json';
}
