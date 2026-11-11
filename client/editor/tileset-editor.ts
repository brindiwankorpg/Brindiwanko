/**
 * @file Tileset editor (database tab "Tilesets"): assigns the nine sheets
 * (A1–E), the mode, and edits tile flags by clicking tiles in the palette:
 * - passage: cycles ○ (passable) → × (impassable) → ☆ (drawn above characters);
 * - passage (4 directions): click near an edge to block/unblock that side;
 * - ladder, bush, counter, damage: toggles the flag;
 * - terrain tag: cycles 0–7.
 * Changing an autotile applies to its 48 shapes. Saving updates the live maps
 * that use the tileset.
 */
import type { TilesetData } from '../../shared/database.js';
import {
  AUTOTILE_SHAPES,
  FLAG_BUSH,
  FLAG_COUNTER,
  FLAG_DAMAGE,
  FLAG_IMPASSABLE,
  FLAG_LADDER,
  FLAG_STAR,
  TERRAIN_TAG_SHIFT,
  TILESET_SHEETS,
  isAutotile,
  terrainTag,
  type TilesetSheet,
} from '../../shared/tiles.js';
import type { AssetStore, Bitmap } from '../engine/assets.js';
import { TilemapRenderer } from '../engine/tilemap.js';
import { t } from '../i18n.js';
import { confirmDialog } from '../ui/dialog.js';
import { el } from '../ui/dom.js';
import type { EditorApi } from './api.js';
import { field, openModal, select, textInput } from './dialogs.js';
import { TilePalette, type FlagView } from './palette.js';

const FLAG_VIEWS: FlagView[] = ['passage', 'passage4', 'ladder', 'bush', 'counter', 'damage', 'terrain'];

/**
 * Opens the tileset editor.
 * @param host - Editor root.
 * @param api - Editor API.
 * @param assets - Asset store (sheets).
 * @param tilesetIds - Tilesets to choose from.
 * @param sheetNames - Names of all tileset images.
 * @param startId - Tileset shown first.
 * @param onSaved - Called after a successful save.
 * @param startView - Flag view shown first (kept when the editor reopens on another tileset).
 */
export async function openTilesetEditor(
  host: HTMLElement,
  api: EditorApi,
  assets: AssetStore,
  tilesetIds: { id: number; name: string }[],
  sheetNames: string[],
  startId: number,
  onSaved: (tileset: TilesetData) => void,
  startView: FlagView = 'passage',
): Promise<void> {
  let tileset: TilesetData = (await api.get<{ tileset: TilesetData }>(`/tilesets/${startId}`)).tileset;
  let view: FlagView = startView;
  const flags = [...tileset.flags];
  /** Changes not saved yet (flags, name, mode, sheets). */
  let dirty = false;

  const loadSheets = async (): Promise<Partial<Record<TilesetSheet, Bitmap>>> => {
    const sheets: Partial<Record<TilesetSheet, Bitmap>> = {};
    await Promise.all(
      TILESET_SHEETS.map(async (slot, i) => {
        const name = sheetSelects[i]!.value;
        const img = name ? await assets.image('tilesets', name) : null;
        if (img) sheets[slot] = img;
      }),
    );
    return sheets;
  };

  const setFlag = (id: number, f: (old: number) => number) => {
    if (id === 0) return; // the empty tile always stays "star"
    const ids = isAutotile(id) ? Array.from({ length: AUTOTILE_SHAPES }, (_, s) => id + s) : [id];
    for (const i of ids) flags[i] = f(flags[i] ?? 0) & 0xffff;
  };

  const onCellClick = (id: number, fx: number, fy: number) => {
    switch (view) {
      case 'passage':
        setFlag(id, (old) => {
          if (old & FLAG_STAR) return old & ~FLAG_STAR & ~FLAG_IMPASSABLE;
          if ((old & FLAG_IMPASSABLE) === FLAG_IMPASSABLE) return (old & ~FLAG_IMPASSABLE) | FLAG_STAR;
          return old | FLAG_IMPASSABLE;
        });
        break;
      case 'passage4': {
        const bit = fy < 0.33 ? 0x8 : fy > 0.66 ? 0x1 : fx < 0.5 ? 0x2 : 0x4;
        setFlag(id, (old) => old ^ bit);
        break;
      }
      case 'ladder':
        setFlag(id, (old) => old ^ FLAG_LADDER);
        break;
      case 'bush':
        setFlag(id, (old) => old ^ FLAG_BUSH);
        break;
      case 'counter':
        setFlag(id, (old) => old ^ FLAG_COUNTER);
        break;
      case 'damage':
        setFlag(id, (old) => old ^ FLAG_DAMAGE);
        break;
      case 'terrain':
        setFlag(id, (old) => (old & ~(0xf << TERRAIN_TAG_SHIFT)) | (((terrainTag(old) + 1) % 8) << TERRAIN_TAG_SHIFT));
        break;
      default:
        break;
    }
    dirty = true;
    palette.setFlags(flags);
  };

  const name = textInput(tileset.name);
  const mode = select([['0', t('editor.tileset_mode.world')], ['1', t('editor.tileset_mode.area')], ['2', t('editor.tileset_mode.legacy')]], String(tileset.mode));
  const sheetSelects = TILESET_SHEETS.map((slot, i) => {
    const s = select([['', t('editor.none')], ...sheetNames.map((n): [string, string] => [n, n])], tileset.tilesetNames[i] ?? '');
    s.dataset.slot = slot;
    return s;
  });
  for (const control of [name, mode, ...sheetSelects]) control.addEventListener('change', () => (dirty = true));
  const sheets = await loadSheets();
  const renderer = new TilemapRenderer({ width: 1, height: 1, data: [0, 0, 0, 0, 0, 0] }, flags, sheets, 48);
  const palette = new TilePalette(renderer, sheetSelects.map((s) => s.value), () => undefined, onCellClick);
  palette.flagView = view;
  palette.setTileset(renderer, sheetSelects.map((s) => s.value), flags);
  for (const s of sheetSelects) {
    s.addEventListener('change', () => {
      void loadSheets().then((loaded) => {
        const r = new TilemapRenderer({ width: 1, height: 1, data: [0, 0, 0, 0, 0, 0] }, flags, loaded, 48);
        palette.setTileset(r, sheetSelects.map((x) => x.value), flags);
      });
    });
  }
  const viewButtons = el(
    'div',
    { className: 'flag-views', attrs: { role: 'tablist' } },
    FLAG_VIEWS.map((v) =>
      el('button', {
        className: `button small${v === view ? ' primary' : ''}`,
        text: t(`editor.flag.${v}` as 'editor.flag.passage'),
        attrs: { type: 'button', 'data-view': String(v) },
        on: {
          click: (e) => {
            view = v;
            palette.flagView = v;
            palette.draw();
            for (const b of viewButtons.querySelectorAll('button')) b.classList.toggle('primary', b === e.currentTarget);
          },
        },
      }),
    ),
  );
  const tilesetSelect = select(tilesetIds.map((ts) => [String(ts.id), `${ts.id} — ${ts.name}`]), String(tileset.id));
  let closeDialog: () => void = () => undefined;
  const askDiscard = () => confirmDialog({ title: t('editor.tileset_editor'), message: t('editor.tileset_discard'), ok: t('editor.discard'), danger: true });
  /** Reopens the editor on another tileset (after asking when changes would be lost). */
  const reopen = async (id: number) => {
    if (dirty && !(await askDiscard())) {
      tilesetSelect.value = String(tileset.id);
      return false;
    }
    // Closed through the dialog (not by removing its element): its Escape listener goes with it.
    closeDialog();
    void openTilesetEditor(host, api, assets, tilesetIds, sheetNames, id, onSaved, view);
    return true;
  };
  tilesetSelect.addEventListener('change', () => void reopen(Number(tilesetSelect.value)));
  const newButton = el('button', {
    className: 'button small',
    text: t('editor.tileset_new'),
    attrs: { type: 'button' },
    on: {
      click: () =>
        void (async () => {
          if (dirty && !(await askDiscard())) return;
          // A new tileset starts as a copy of the one shown (same sheets and flags), under a free number.
          const id = Math.max(0, ...tilesetIds.map((ts) => ts.id)) + 1;
          const created: TilesetData = { ...tileset, id, name: t('editor.tileset_new_name', { id }) };
          await api.put(`/tilesets/${id}`, { tileset: created });
          tilesetIds.push({ id, name: created.name });
          dirty = false;
          closeDialog();
          void openTilesetEditor(host, api, assets, tilesetIds, sheetNames, id, onSaved, view);
        })().catch((err: unknown) => window.alert(String((err as { message?: string }).message ?? err))),
    },
  });

  closeDialog = openModal(host, t('editor.tileset_editor'), el('div', { className: 'tileset-editor' }, [
    el('div', { className: 'tileset-fields form-grid' }, [
      field(t('editor.tileset'), el('div', { className: 'inline-row' }, [tilesetSelect, newButton])),
      field(t('editor.tileset_name'), name),
      field(t('editor.tileset_mode_label'), mode),
      // The nine image sheets, rarely changed, fold away (folded on a phone, where they pushed the palette
      // a whole screen down); the palette, reason to open this window, comes first there.
      el('details', { className: 'tileset-sheets', attrs: matchMedia('(max-width: 900px), (pointer: coarse)').matches ? {} : { open: '' } }, [
        el('summary', { text: t('editor.tileset_sheets', { count: sheetSelects.filter((x) => x.value).length, total: sheetSelects.length }) }),
        el('div', { className: 'form-grid' }, sheetSelects.map((x) => field(x.dataset.slot!, x))),
      ]),
    ]),
    el('div', { className: 'tileset-flags' }, [viewButtons, palette.element, el('p', { className: 'hint', text: t('editor.flag_help') })]),
  ]), [
    // Like Escape, cancelling asks before dropping unsaved flags.
    { label: t('common.cancel'), onClick: async () => (!dirty || (await askDiscard()) ? undefined : false) },
    {
      label: t('editor.save'),
      primary: true,
      onClick: async () => {
        tileset = { ...tileset, name: name.value.trim() || tileset.name, mode: Number(mode.value), tilesetNames: sheetSelects.map((s) => s.value), flags };
        await api.put(`/tilesets/${tileset.id}`, { tileset });
        dirty = false;
        onSaved(tileset);
      },
    },
  ], '', async () => !dirty || askDiscard());
}
