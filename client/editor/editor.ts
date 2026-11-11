/**
 * @file The map editor application, opened full screen over the game by
 * administrators.
 *
 * Layout, in the manner of classic desktop map editors: a menu bar (File,
 * Edit, Mode, Draw, Layer, View, Tools, Game, Help) holding every command, an
 * icon toolbar under it (new map, import, save | cut, copy, paste, delete |
 * undo, redo | modes | drawing tools and layer | zoom and grid | database,
 * tilesets, resources, properties, history | scripts to review | test the
 * map), the map tree and tile palette on the left, the map canvas in the
 * centre and a status bar at the bottom (map size, zoom, cell under the
 * cursor). Buttons show their state: the current mode and tool are pressed,
 * commands that cannot be used now are greyed out.
 *
 * Editing works on a local copy of the map. Saving sends the whole map to the
 * server, which validates it, keeps a snapshot in the history and updates the
 * players on the map immediately. Opening a map takes its edit lock; when
 * another administrator holds it, the map opens read-only.
 */
import { tilesetSheetNames } from '../../shared/conversions.js';
import type { DatabaseUsage, TilesetData } from '../../shared/database.js';
import type { GameEvent } from '../../shared/events.js';
import type { MapData, MapInfo } from '../../shared/map.js';
import { TILESET_SHEETS, type TilesetSheet } from '../../shared/tiles.js';
import type { SystemSettings } from '../../shared/settings.js';
import type { AssetStore, Bitmap } from '../engine/assets.js';
import { TilemapRenderer } from '../engine/tilemap.js';
import { t, tDynamic } from '../i18n.js';
import { confirmDialog } from '../ui/dialog.js';
import { el, icon } from '../ui/dom.js';
import { isFullscreen, toggleFullscreen } from '../ui/mobile.js';
import { EditorApi, EditorApiError } from './api.js';
import { newMapDialog, openModal, propertiesDialog, quickEventDialog, versionsDialog, type ResourceLists } from './dialogs.js';
import { quickKindOf } from './quick-events.js';
import { openEventEditor, type EventEditorContext } from './event-editor.js';
import { editRoute } from './route-editor.js';
import { MapEditor, applyChanges, type CellChange, type Stamp } from './edit-ops.js';
import { MapView, type Mode, type Tool } from './map-view.js';
import { TilePalette } from './palette.js';
import { DatabaseEditor, describeUsage } from './database-editor.js';
import { MenuBar, type Menu, type MenuItem } from './menu-bar.js';
import { openImportDialog, openResourceManager } from './resources-dialog.js';
import { openTilesetEditor } from './tileset-editor.js';
import { toolbarIcon, type ToolbarIconName } from './toolbar-icons.js';

/** Zoom levels of the map view. */
const ZOOMS = [0.25, 0.5, 0.75, 1, 2];

/** Drawing tools in toolbar order, with their key. */
/** Key of the Move tool (hand). */
const PAN_KEY = 'H';
/**
 * Phones and small tablets, upright or sideways: the map takes the whole width and the Maps / Palette column
 * becomes a drawer. A phone held sideways is wider than 900 px but has little height: it counts too.
 * The same query is in editor.css.
 */
const COMPACT_QUERY = '(max-width: 900px), (pointer: coarse) and (max-height: 600px)';
/** Zoom last chosen on this device (browser storage). */
const ZOOM_KEY = 'brindiwanko.editor.zoom';
/** Touch screen: a finger, with its own texts and defaults. */
const coarse = () => matchMedia('(pointer: coarse)').matches;

const TOOLS: readonly [Tool, string][] = [
  ['pencil', 'P'],
  ['rect', 'R'],
  ['ellipse', 'E'],
  ['fill', 'F'],
  ['picker', 'I'],
  ['eraser', 'G'],
  ['select', 'S'],
];

/** Undo history entry. */
type HistoryEntry =
  | { kind: 'cells'; changes: CellChange[] }
  | { kind: 'events'; before: string; after: string }
  | { kind: 'props'; before: string; after: string };

/** Options to open the editor. */
export interface EditorOptions {
  /** Element the editor is appended to. */
  container: HTMLElement;
  csrf: string;
  assets: AssetStore;
  /** Map opened first (the map the administrator is on). */
  startMapId: number;
  onClose: () => void;
}

interface TilesetSummary {
  id: number;
  name: string;
  mode: number;
  tilesetNames: string[];
}

const deepCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A script from an imported file waiting for approval (see `shared/quarantine.ts`). */
type QuarantineItem =
  | { kind: 'map'; mapId: number; mapName: string; eventId: number; eventName: string; page: number; index: number; code: string }
  | { kind: 'commonEvent'; id: number; name: string; index: number; code: string };

/** The editor application. */
export class MapEditorApp {
  private readonly root: HTMLDivElement;
  private readonly api: EditorApi;
  /** Administration tools (putting the administrator on the map to test it). */
  private readonly adminApi: EditorApi;
  private readonly treeEl = el('ul', { className: 'map-tree', attrs: { role: 'tree' } });
  private readonly paletteHost = el('div', { className: 'palette-host' });
  private readonly viewHost = el('div', { className: 'view-host' });
  /** Status bar: lock and unsaved changes on the left, map size, zoom and cell on the right. */
  private readonly statusText = el('span', { className: 'status-text' });
  private readonly statusInfo = el('span', { className: 'status-info' });
  /** What the marks of the current mode mean (passability symbols...), always in sight in the status bar. */
  private readonly modeLegend = el('span', { className: 'status-legend', attrs: { 'aria-live': 'polite' } });
  private readonly titleEl = el('span', { className: 'editor-map-title' });
  private menuBar: MenuBar | null = null;
  /** Toolbar buttons by command (`save`, `tool-pencil`, `mode-events`...). */
  private readonly toolbar = new Map<string, HTMLButtonElement>();
  private layerSelect: HTMLSelectElement | null = null;
  /** Scripts from imported files waiting for approval (the toolbar button shows while there are some). */
  private quarantineCount = 0;
  /** Cell under the pointer, shown in the status bar. */
  private cursor: { x: number; y: number } | null = null;
  private infos: MapInfo[] = [];
  private tilesets: TilesetSummary[] = [];
  private resources: ResourceLists = { characters: [], faces: [], parallaxes: [], bgm: [], bgs: [], me: [], pictures: [], animations: [], se: [] };
  private tilesetImages: string[] = [];
  private info: MapInfo | null = null;
  private map: MapData | null = null;
  private tileset: TilesetData | null = null;
  private sheets: Partial<Record<TilesetSheet, Bitmap>> = {};
  private view: MapView | null = null;
  private palette: TilePalette | null = null;
  /** Narrow screens: the Maps / Palette column slides over the map as a drawer, open on one of its panels. */
  private drawer: 'maps' | 'palette' | null = null;
  private dirty = false;
  /** Bumped at every change of the working copy (tells whether a save covered everything). */
  private revision = 0;
  /** Revision of the map on the server when this copy was loaded or last saved (refused saves of an outdated copy). */
  private mapVersion = 0;
  private readOnly = false;
  private lockHolder = '';
  private tool: Tool = 'pencil';
  /** The hand: a press moves the map instead of drawing (on by default on touch screens). */
  private panning = false;
  /** Touch screens: the hand / drawing switch, undo, redo and save at the bottom right of the map. */
  /** Keeps the fullscreen button in step with the page (removed when the editor closes). */
  private fullscreenHandler: (() => void) | null = null;
  /** Built with the rest of the layout (after loading): a failed start leaves the page untouched. */
  private fab: HTMLDivElement | null = null;
  private mode: Mode = 'tiles';
  private grid = true;
  private forcedLayer: number | null = null;
  /** Show only the forced layer. */
  private onlyLayer = false;
  private stamp: Stamp = { tiles: [[0]] };
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  /** Length of the undo stack when the map was last saved (-1: that state is no longer reachable). */
  private savedDepth = 0;
  private clipboard: number[][][] | null = null;
  private eventClipboard: GameEvent | null = null;
  private readonly eventImages = new Map<string, Bitmap | null>();
  private lockTimer = 0;
  private readonly keyHandler = (e: KeyboardEvent) => this.onKey(e);
  /** Database window last opened (it may have unsaved changes too). */
  private database: DatabaseEditor | null = null;
  /** Closing or reloading the tab with unsaved work asks the browser to confirm. */
  private readonly unloadHandler = (e: BeforeUnloadEvent) => {
    if (!this.dirty && !this.database?.hasUnsavedChanges()) return;
    e.preventDefault();
    e.returnValue = '';
  };

  private constructor(private readonly options: EditorOptions) {
    this.api = new EditorApi(options.csrf);
    this.adminApi = new EditorApi(options.csrf, '/api/admin');
    this.root = el('div', { className: 'editor', attrs: { role: 'application', 'aria-label': t('editor.title') } });
    options.container.append(this.root);
    document.body.classList.add('editor-open');
    window.addEventListener('keydown', this.keyHandler, true);
    window.addEventListener('beforeunload', this.unloadHandler);
  }

  /**
   * Opens the editor.
   * @param options - Container, credentials and callbacks.
   */
  static async open(options: EditorOptions): Promise<MapEditorApp> {
    const app = new MapEditorApp(options);
    try {
      await app.init();
      return app;
    } catch (err) {
      app.shutdown();
      throw err;
    }
  }

  private button(label: string, onClick: () => void, extra = '', title?: string): HTMLButtonElement {
    return el('button', { className: `button small ${extra}`, text: label, title: title ?? label, attrs: { type: 'button' }, on: { click: onClick } });
  }

  private async init(): Promise<void> {
    const boot = await this.api.get<{ maps: MapInfo[]; tilesets: TilesetSummary[] }>('/bootstrap');
    this.infos = boot.maps;
    if (this.info) this.info = this.infos.find((i) => i.id === this.info!.id) ?? this.info;
    this.tilesets = boot.tilesets;
    await this.loadResourceLists();
    this.buildLayout();
    const first = this.infos.find((i) => i.id === this.options.startMapId) ?? this.infos[0];
    if (first) await this.loadMap(first.id);
    void this.refreshQuarantine();
    this.lockTimer = window.setInterval(() => void this.refreshLock(), 60_000);
  }

  /** Reads the resource manifest into the pickers' lists (after uploads too). */
  private async loadResourceLists(): Promise<void> {
    const manifest = await fetch('/api/resources', { credentials: 'same-origin' }).then(
      (r) => r.json() as Promise<{ resources: { kind: string; name: string; format: string; width: number | null; height: number | null }[] }>,
    );
    const of = (kind: string) => manifest.resources.filter((r) => r.kind === kind);
    const names = (kind: string) => of(kind).map((r) => r.name);
    this.resources = { characters: names('characters'), faces: names('faces'), parallaxes: names('parallaxes'), bgm: names('bgm'), bgs: names('bgs'), me: names('me'), pictures: names('pictures'), animations: names('animations'), se: names('se') };
    this.tilesetImages = of('tilesets').flatMap((r) => tilesetSheetNames(r.name, r.format, r.width ?? 0, r.height ?? 0));
  }

  // --- Layout ------------------------------------------------------------------

  private buildLayout(): void {
    this.menuBar = new MenuBar(this.menus(), [
      el('span', { className: 'editor-title', text: t('editor.title') }),
      this.titleEl,
      el('button', { className: 'mbar-close', title: t('editor.close'), attrs: { type: 'button', 'aria-label': t('editor.close') }, on: { click: () => void this.close() } }, [toolbarIcon('close')]),
    ]);
    const treeTools = el('div', { className: 'tree-tools' }, [
      this.button('+', () => this.newMap(), '', t('editor.new_map')),
      this.button('↑', () => void this.reorder(-1), '', t('editor.move_up')),
      this.button('↓', () => void this.reorder(1), '', t('editor.move_down')),
      // Indentation marks, not arrows: these move the map in the tree (parent / child), not on the screen.
      this.button('⇤', () => void this.outdent(), '', t('editor.outdent')),
      this.button('⇥', () => void this.indent(), '', t('editor.indent')),
      this.button('🗑', () => void this.deleteMap(), 'danger', t('editor.delete_map')),
    ]);
    // Shown on narrow screens only, where the column is a drawer over the map.
    const drawerClose = () =>
      el('button', { className: 'drawer-close', text: '✕', title: t('editor.close_panel'), attrs: { type: 'button', 'aria-label': t('editor.close_panel') }, on: { click: () => this.setDrawer(null) } });
    const sidebar = el('div', { className: 'editor-sidebar', attrs: { id: 'editor-sidebar' } }, [
      el('div', { className: 'editor-panel tree-panel' }, [el('div', { className: 'panel-title' }, [el('span', { text: t('editor.maps') }), treeTools, drawerClose()]), this.treeEl]),
      el('div', { className: 'editor-panel palette-panel' }, [el('div', { className: 'panel-title' }, [el('span', { text: t('editor.palette') }), drawerClose()]), this.paletteHost]),
    ]);
    const backdrop = el('div', { className: 'editor-drawer-backdrop', attrs: { 'aria-hidden': 'true' }, on: { click: () => this.setDrawer(null) } });
    this.fab = this.buildFab();
    this.root.replaceChildren(
      this.menuBar.element,
      this.buildToolbar(),
      el('div', { className: 'editor-main' }, [sidebar, backdrop, this.viewHost]),
      el('div', { className: 'editor-status' }, [this.statusText, this.modeLegend, this.statusInfo]),
    );
    // Touch screens start with the hand: a finger sliding on the map moves it instead of drawing.
    this.panning = coarse();
    this.setTool('pencil');
    this.setMode('tiles');
    this.renderTree();
    // Touch screens: say once how the map reacts to the fingers.
    if (coarse()) window.setTimeout(() => this.notify(t('editor.touch_hint')), 600);
    // The legend is cut to two lines on a phone: a tap shows all of it.
    this.modeLegend.addEventListener('click', () => this.modeLegend.classList.toggle('expanded'));
  }

  /** Phone or small tablet: the Maps / Palette column is a drawer instead of a fixed column. */
  private compact(): boolean {
    return matchMedia(COMPACT_QUERY).matches;
  }

  /**
   * The round buttons at the bottom right of the map, within thumb reach (shown on touch screens and narrow
   * windows, see editor.css): fullscreen (as in the game), undo, redo, save (a dot when there are unsaved
   * changes) and the big switch between the hand (the finger moves the map) and drawing. Its colour says
   * which one is on.
   */
  private buildFab(): HTMLDivElement {
    // Fullscreen, the same button and the same behaviour as the game's (iPhone: how to get it from the home screen).
    const fullscreen = el(
      'button',
      {
        className: 'fab-button fab-fullscreen',
        title: t('touch.fullscreen'),
        attrs: { type: 'button', 'aria-label': t('touch.fullscreen'), 'data-id': 'fab-fullscreen' },
        on: { click: () => toggleFullscreen(() => this.notify(t('touch.ios_hint'))) },
      },
    );
    // Its icon says what a tap does, as in the game: enter fullscreen, or leave it.
    const syncFullscreen = () => {
      fullscreen.setAttribute('aria-pressed', String(isFullscreen()));
      fullscreen.replaceChildren(icon(isFullscreen() ? 'fullscreen_exit' : 'fullscreen'));
    };
    syncFullscreen();
    this.fullscreenHandler = syncFullscreen;
    document.addEventListener('fullscreenchange', syncFullscreen);
    const small = (id: string, icon: ToolbarIconName, label: string, run: () => void) => {
      const b = el('button', { className: 'fab-button', title: label, attrs: { type: 'button', 'aria-label': label, 'data-id': id }, on: { click: run } }, [toolbarIcon(icon)]);
      this.toolbar.set(id, b);
      return b;
    };
    const main = el('button', { className: 'fab-main', attrs: { type: 'button', 'data-id': 'fab-hand' }, on: { click: () => this.setPanning(!this.panning) } });
    this.toolbar.set('fab-hand', main);
    return el('div', { className: 'map-fab', attrs: { role: 'group', 'aria-label': t('editor.fab.group') } }, [
      fullscreen,
      small('fab-undo', 'undo', t('editor.undo'), () => this.undo()),
      small('fab-redo', 'redo', t('editor.redo'), () => this.redo()),
      small('fab-save', 'save', t('editor.save'), () => void this.save()),
      main,
    ]);
  }

  /** Puts the hand on (the finger moves the map) or off (it draws). */
  private setPanning(on: boolean): void {
    this.panning = on;
    this.syncToolbar();
  }

  /** The big round button and the frame of the map say what a finger does now. */
  private syncFab(): void {
    const main = this.toolbar.get('fab-hand');
    if (!main) return;
    // Events and Passability modes do not draw tiles: the finger edits events or cells there.
    const state = this.panning ? 'pan' : this.mode === 'events' || this.mode === 'passage' ? 'edit' : 'draw';
    const icon: ToolbarIconName = this.panning ? 'pan' : this.mode === 'events' ? 'modeEvents' : this.mode === 'passage' ? 'modePassage' : this.mode === 'shadow' ? 'shadow' : this.tool;
    const [short, long] =
      state === 'pan'
        ? [t('editor.fab.pan_short'), t('editor.fab.panning')]
        : state === 'edit'
          ? [t('editor.fab.edit_short'), t('editor.fab.editing')]
          : [t('editor.fab.draw_short'), t('editor.fab.drawing')];
    this.viewHost.dataset.hand = state;
    if (main.dataset.key === `${state}:${icon}`) return;
    main.dataset.key = `${state}:${icon}`;
    main.dataset.state = state;
    main.replaceChildren(toolbarIcon(icon), el('span', { className: 'fab-label', text: short }));
    main.setAttribute('aria-pressed', String(this.panning));
    main.setAttribute('aria-label', long);
    main.title = long;
  }

  /** Opens the drawer on a panel (a second press on the same button closes it), or closes it (`null`). */
  private setDrawer(panel: 'maps' | 'palette' | null): void {
    this.drawer = panel !== null && panel === this.drawer ? null : panel;
    this.root.classList.toggle('drawer-open', this.drawer !== null);
    if (this.drawer) this.root.dataset.drawer = this.drawer;
    for (const name of ['maps', 'palette'] as const) this.toolbar.get(`drawer-${name}`)?.setAttribute('aria-expanded', String(this.drawer === name));
    if (this.drawer === null) this.view?.element.focus({ preventScroll: true });
  }

  /** The icon toolbar, under the menu bar: the most used commands, one click away. */
  private buildToolbar(): HTMLDivElement {
    /** A button: its label (read by screen readers), with its keys or a longer explanation in the tooltip. */
    const button = (id: string, icon: ToolbarIconName, label: string, run: () => void, keys?: string, tooltip?: string) => {
      const b = el('button', { className: 'tb-button', title: tooltip ?? (keys ? `${label} (${keys})` : label), attrs: { type: 'button', 'aria-label': label, 'data-id': id }, on: { click: run } }, [toolbarIcon(icon)]);
      this.toolbar.set(id, b);
      return b;
    };
    const separator = () => el('span', { className: 'tb-separator', attrs: { role: 'separator', 'aria-orientation': 'vertical' } });
    const modeButton = (mode: Mode, icon: ToolbarIconName) => button(`mode-${mode}`, icon, t('editor.mode_title', { name: t(`editor.mode.${mode}`) }), () => this.setMode(mode));
    this.layerSelect = el('select', { className: 'tb-select', title: t('editor.layer'), attrs: { 'aria-label': t('editor.layer') } }, [
      el('option', { text: t('editor.layer_auto'), attrs: { value: '' } }),
      ...[1, 2, 3, 4].map((n) => el('option', { text: t('editor.layer_n', { n }), attrs: { value: String(n - 1) } })),
    ]);
    this.layerSelect.addEventListener('change', () => this.setLayer(this.layerSelect!.value === '' ? null : Number(this.layerSelect!.value)));
    const scripts = button('scripts', 'scripts', t('editor.quarantine.button', { count: 0 }), () => void this.openQuarantine());
    scripts.append(el('span', { className: 'tb-badge', attrs: { 'aria-hidden': 'true' } }));
    const save = button('save', 'save', t('editor.save'), () => void this.save(), 'Ctrl+S');
    // Narrow screens: the two panels of the column open as a drawer from here.
    const drawerButton = (panel: 'maps' | 'palette') => {
      const b = el('button', {
        className: 'tb-button tb-drawer',
        text: t(`editor.${panel}`),
        title: t(`editor.${panel}`),
        attrs: { type: 'button', 'aria-controls': 'editor-sidebar', 'aria-expanded': 'false', 'data-id': `drawer-${panel}` },
        on: { click: () => this.setDrawer(panel) },
      });
      this.toolbar.set(`drawer-${panel}`, b);
      return b;
    };
    return el('div', { className: 'editor-toolbar', attrs: { role: 'toolbar', 'aria-label': t('editor.title') } }, [
      drawerButton('maps'),
      drawerButton('palette'),
      button('new-map', 'newMap', t('editor.new_map'), () => this.newMap()),
      button('import', 'importProject', t('editor.import.button'), () => this.openImport()),
      save,
      separator(),
      button('cut', 'cut', t('editor.cut'), () => this.copy(true), 'Ctrl+X'),
      button('copy', 'copy', t('editor.copy'), () => this.copy(false), 'Ctrl+C'),
      button('paste', 'paste', t('editor.paste'), () => this.paste(), 'Ctrl+V'),
      button('delete', 'delete', t('editor.delete'), () => this.deleteSelection(), t('editor.key_delete')),
      separator(),
      button('undo', 'undo', t('editor.undo'), () => this.undo(), 'Ctrl+Z'),
      button('redo', 'redo', t('editor.redo'), () => this.redo(), 'Ctrl+Y'),
      separator(),
      modeButton('tiles', 'modeMap'),
      modeButton('events', 'modeEvents'),
      modeButton('region', 'modeRegion'),
      modeButton('passage', 'modePassage'),
      separator(),
      button('tool-pan', 'pan', t('editor.tool.pan'), () => this.setPanning(!this.panning), PAN_KEY),
      ...TOOLS.slice(0, 4).map(([tool, key]) => button(`tool-${tool}`, tool, t(`editor.tool.${tool}`), () => this.chooseTool(tool), key)),
      button('tool-shadow', 'shadow', t('editor.tool.shadow'), () => this.setMode('shadow')),
      ...TOOLS.slice(4).map(([tool, key]) => button(`tool-${tool}`, tool, t(`editor.tool.${tool}`), () => this.chooseTool(tool), key)),
      this.layerSelect,
      separator(),
      button('zoom-in', 'zoomIn', t('editor.zoom_in'), () => this.zoomStep(1)),
      button('zoom-out', 'zoomOut', t('editor.zoom_out'), () => this.zoomStep(-1)),
      button('zoom-reset', 'zoomReset', t('editor.zoom_reset'), () => this.setZoom(1)),
      button('grid', 'grid', t('editor.grid'), () => this.toggleGrid()),
      separator(),
      button('database', 'database', t('db.button'), () => void this.openDatabase()),
      button('tilesets', 'tilesets', t('editor.tilesets'), () => void this.openTilesets()),
      button('resources', 'resources', t('editor.resources.button'), () => this.openResources()),
      button('properties', 'properties', t('editor.map_properties'), () => void this.openProperties()),
      button('versions', 'versions', t('editor.versions'), () => void this.openVersions()),
      scripts,
      separator(),
      button('playtest', 'playtest', t('editor.playtest'), () => void this.playtest(), undefined, t('editor.playtest_hint')),
    ]);
  }

  /** Menus of the menu bar; their items are read each time a menu opens (current state). */
  private menus(): Menu[] {
    const item = (label: string, run: () => void, more: Omit<MenuItem, 'label' | 'run'> = {}): MenuItem => ({ label, run, ...more });
    const can = () => this.editState();
    const drawing = () => this.mode !== 'events' && this.mode !== 'passage';
    const hasMap = () => this.map !== null;
    return [
      {
        label: t('editor.menu.file'),
        items: () => [
          item(t('editor.new_map'), () => this.newMap(), { dialog: true }),
          item(t('editor.import.button'), () => this.openImport(), { dialog: true }),
          'separator',
          item(t('editor.save'), () => void this.save(), { shortcut: 'Ctrl+S', enabled: () => !this.readOnly && this.dirty }),
          item(t('editor.export'), () => this.exportMap(), { enabled: hasMap }),
          item(t('editor.versions'), () => void this.openVersions(), { dialog: true, enabled: hasMap }),
          'separator',
          item(t('editor.playtest'), () => void this.playtest(), { enabled: hasMap }),
          item(t('editor.close'), () => void this.close()),
        ],
      },
      {
        label: t('editor.menu.edit'),
        items: () => [
          item(t('editor.undo'), () => this.undo(), { shortcut: 'Ctrl+Z', enabled: () => !this.readOnly && this.undoStack.length > 0 }),
          item(t('editor.redo'), () => this.redo(), { shortcut: 'Ctrl+Y', enabled: () => !this.readOnly && this.redoStack.length > 0 }),
          'separator',
          item(t('editor.cut'), () => this.copy(true), { shortcut: 'Ctrl+X', enabled: () => can().cut }),
          item(t('editor.copy'), () => this.copy(false), { shortcut: 'Ctrl+C', enabled: () => can().copy }),
          item(t('editor.paste'), () => this.paste(), { shortcut: 'Ctrl+V', enabled: () => can().paste }),
          item(t('editor.delete'), () => this.deleteSelection(), { shortcut: t('editor.key_delete'), enabled: () => can().remove }),
          'separator',
          item(t('editor.map_properties'), () => void this.openProperties(), { dialog: true, enabled: hasMap }),
        ],
      },
      {
        label: t('editor.menu.mode'),
        items: () =>
          (['tiles', 'events', 'region', 'passage'] as const).map((mode) =>
            item(t(`editor.mode.${mode}`), () => this.setMode(mode), { radio: true, checked: () => this.mode === mode || (mode === 'tiles' && this.mode === 'shadow') }),
          ),
      },
      {
        label: t('editor.menu.draw'),
        items: () => {
          const tool = ([id, key]: [Tool, string]) =>
            item(t(`editor.tool.${id}`), () => this.chooseTool(id), { shortcut: key, radio: true, enabled: drawing, checked: () => !this.panning && this.mode !== 'shadow' && this.tool === id });
          return [
            item(t('editor.tool.pan'), () => this.setPanning(!this.panning), { shortcut: PAN_KEY, checked: () => this.panning }),
            'separator',
            ...TOOLS.slice(0, 4).map(tool),
            item(t('editor.tool.shadow'), () => this.setMode('shadow'), { radio: true, enabled: drawing, checked: () => !this.panning && this.mode === 'shadow' }),
            'separator',
            ...TOOLS.slice(4).map(tool),
          ];
        },
      },
      {
        label: t('editor.menu.layer'),
        items: () => [
          item(t('editor.layer_auto'), () => this.setLayer(null), { radio: true, checked: () => this.forcedLayer === null }),
          ...[0, 1, 2, 3].map((z) => item(t('editor.layer_n', { n: z + 1 }), () => this.setLayer(z), { radio: true, checked: () => this.forcedLayer === z })),
          'separator',
          item(t('editor.only_layer_hint'), () => this.toggleOnlyLayer(), { checked: () => this.onlyLayer, enabled: () => this.forcedLayer !== null }),
        ],
      },
      {
        label: t('editor.menu.view'),
        items: () => [
          item(t('editor.zoom_in'), () => this.zoomStep(1), { enabled: () => this.zoom() < ZOOMS.at(-1)! }),
          item(t('editor.zoom_out'), () => this.zoomStep(-1), { enabled: () => this.zoom() > ZOOMS[0]! }),
          'separator',
          ...ZOOMS.map((z) => item(`${z * 100} %`, () => this.setZoom(z), { radio: true, checked: () => this.zoom() === z })),
          'separator',
          item(t('editor.grid'), () => this.toggleGrid(), { checked: () => this.grid }),
        ],
      },
      {
        label: t('editor.menu.tools'),
        items: () => [
          item(t('db.button'), () => void this.openDatabase(), { dialog: true }),
          item(t('editor.tilesets'), () => void this.openTilesets(), { dialog: true }),
          item(t('editor.resources.button'), () => this.openResources(), { dialog: true }),
          'separator',
          item(t('editor.quarantine.button', { count: this.quarantineCount }), () => void this.openQuarantine(), { dialog: true, enabled: () => this.quarantineCount > 0 }),
        ],
      },
      {
        label: t('editor.menu.game'),
        items: () => [item(t('editor.playtest'), () => void this.playtest(), { enabled: hasMap }), item(t('editor.close'), () => void this.close())],
      },
      {
        label: t('editor.menu.help'),
        items: () => [item(t('editor.help.title'), () => this.openHelp(), { dialog: true })],
      },
    ];
  }

  /**
   * Gives the toolbar the state of the editor: pressed mode, tool, grid; greyed
   * commands that cannot be used now; the scripts button while some wait.
   */
  private syncToolbar(): void {
    const set = (id: string, state: { disabled?: boolean; active?: boolean }) => {
      const b = this.toolbar.get(id);
      if (!b) return;
      if (state.disabled !== undefined) b.disabled = state.disabled;
      if (state.active !== undefined) {
        b.classList.toggle('active', state.active);
        b.setAttribute('aria-pressed', String(state.active));
      }
    };
    const can = this.editState();
    const hasMap = this.map !== null;
    const unsaved = !this.readOnly && this.dirty;
    for (const id of ['save', 'fab-save']) {
      set(id, { disabled: !unsaved });
      // A dot on the save buttons while there are unsaved changes.
      this.toolbar.get(id)?.classList.toggle('dirty', unsaved);
    }
    for (const id of ['undo', 'fab-undo']) set(id, { disabled: this.readOnly || this.undoStack.length === 0 });
    for (const id of ['redo', 'fab-redo']) set(id, { disabled: this.readOnly || this.redoStack.length === 0 });
    set('cut', { disabled: !can.cut });
    set('copy', { disabled: !can.copy });
    set('paste', { disabled: !can.paste });
    set('delete', { disabled: !can.remove });
    set('mode-tiles', { active: this.mode === 'tiles' || this.mode === 'shadow' });
    for (const mode of ['events', 'region', 'passage'] as const) set(`mode-${mode}`, { active: this.mode === mode });
    // Drawing tools paint tiles, regions or shadows: they rest in the Events and Passability modes.
    const drawing = this.mode !== 'events' && this.mode !== 'passage';
    // Only the tool really in use is lit: the hand while it is on, otherwise the drawing tool.
    for (const [tool] of TOOLS) set(`tool-${tool}`, { disabled: !drawing, active: drawing && !this.panning && this.mode !== 'shadow' && this.tool === tool });
    set('tool-shadow', { disabled: !drawing, active: !this.panning && this.mode === 'shadow' });
    // The hand works in every mode.
    set('tool-pan', { active: this.panning });
    this.view?.element.classList.toggle('pan-tool', this.panning);
    this.syncFab();
    if (this.layerSelect) {
      this.layerSelect.value = this.forcedLayer === null ? '' : String(this.forcedLayer);
      this.layerSelect.disabled = !drawing;
    }
    const zoom = this.zoom();
    set('zoom-in', { disabled: !hasMap || zoom >= ZOOMS.at(-1)! });
    set('zoom-out', { disabled: !hasMap || zoom <= ZOOMS[0]! });
    set('zoom-reset', { disabled: !hasMap || zoom === 1 });
    set('grid', { active: this.grid });
    for (const id of ['properties', 'versions', 'playtest']) set(id, { disabled: !hasMap });
    const scripts = this.toolbar.get('scripts');
    if (scripts) {
      scripts.classList.toggle('hidden', this.quarantineCount === 0);
      const label = t('editor.quarantine.button', { count: this.quarantineCount });
      scripts.setAttribute('aria-label', label);
      scripts.title = `${label} — ${t('editor.quarantine.help')}`;
      scripts.querySelector('.tb-badge')!.textContent = String(this.quarantineCount);
    }
  }

  /**
   * What the clipboard commands can do now, as the keys do it: the event chosen
   * in Events mode, otherwise the rectangle of the Select tool.
   */
  private editState(): { cut: boolean; copy: boolean; paste: boolean; remove: boolean } {
    const view = this.view;
    if (!view || !this.map) return { cut: false, copy: false, paste: false, remove: false };
    const events = this.mode === 'events';
    const target = (events && view.selectedEvent !== null) || view.selection !== null;
    const clip = (events && this.eventClipboard !== null) || this.clipboard !== null;
    const where = view.hoverCell ?? view.selection ?? view.lastCell;
    return { copy: target, cut: target && !this.readOnly, remove: target && !this.readOnly, paste: clip && !this.readOnly && where !== null };
  }

  /** Current zoom of the map view. */
  private zoom(): number {
    return this.view?.zoom ?? 0.5;
  }

  private setZoom(zoom: number): void {
    if (!this.view) return;
    this.view.setZoom(zoom);
    this.rememberZoom();
    this.setStatus();
  }

  /**
   * Zoom of the first map shown: the one last chosen on this device, else 100 % on a touch screen (a cell
   * about the size of a fingertip) and 50 % with a mouse.
   */
  private initialZoom(): number {
    try {
      const saved = Number(localStorage.getItem(ZOOM_KEY));
      if (saved >= ZOOMS[0]! && saved <= ZOOMS.at(-1)!) return saved;
    } catch {
      /* no storage (private window): the default below */
    }
    return coarse() ? 1 : 0.5;
  }

  private rememberZoom(): void {
    try {
      localStorage.setItem(ZOOM_KEY, String(this.zoom()));
    } catch {
      /* not kept: the default comes back next time */
    }
  }

  /** Next zoom level up (+1) or down (-1). */
  private zoomStep(direction: 1 | -1): void {
    const zoom = this.zoom();
    const next = direction > 0 ? ZOOMS.find((z) => z > zoom) : ZOOMS.findLast((z) => z < zoom);
    if (next !== undefined) this.setZoom(next);
  }

  private toggleGrid(): void {
    this.grid = !this.grid;
    this.view?.requestDraw();
    this.syncToolbar();
  }

  /** Forces a layer (0–3), or goes back to automatic placement (`null`). */
  private setLayer(layer: number | null): void {
    this.forcedLayer = layer;
    // "This layer only" means something once a layer is forced.
    if (layer === null) this.onlyLayer = false;
    this.applyLayerView();
    this.syncToolbar();
  }

  private toggleOnlyLayer(): void {
    if (this.forcedLayer === null) return;
    this.onlyLayer = !this.onlyLayer;
    this.applyLayerView();
  }

  private applyLayerView(): void {
    this.view?.renderer.showOnlyLayer(this.onlyLayer ? this.forcedLayer : null);
    this.view?.requestDraw();
  }

  private openImport(): void {
    openImportDialog(this.root, this.api, () => void this.reloadTree());
  }

  private openResources(): void {
    // The image store reads its manifest again too: otherwise a resource just uploaded is unknown to it (no
    // preview, nothing drawn) until the page is reloaded, and a replaced one keeps its old picture.
    openResourceManager(this.root, this.api, () => void Promise.all([this.loadResourceLists(), this.options.assets.refresh()]).then(() => this.view?.requestDraw()));
  }

  /** Gestures of the touch screen, keyboard shortcuts and mouse gestures of the editor. */
  private openHelp(): void {
    const keys = ['save', 'undo', 'clipboard', 'delete', 'tools', 'picker', 'shadow', 'palette', 'layer', 'events', 'passage', 'playtest'] as const;
    const touch = ['touch_fab', 'touch_two', 'touch_long', 'touch_events', 'touch_passage', 'touch_drawers', 'touch_save'] as const;
    const section = (title: string, items: string[]) =>
      el('section', { className: 'help-section' }, [el('h3', { className: 'help-heading', text: title }), el('ul', { className: 'help-list' }, items.map((text) => el('li', { text })))]);
    const touchSection = section(t('editor.help.touch_title'), touch.map((key) => t(`editor.help.${key}`)));
    const keySection = section(t('editor.help.keyboard_title'), keys.map((key) => t(`editor.help.${key}`)));
    // On a touch screen the gestures come first.
    const body = el('div', { className: 'help-body' }, coarse() ? [touchSection, keySection] : [keySection, touchSection]);
    openModal(this.root, t('editor.help.title'), body, [{ label: t('ui.close'), primary: true }]);
  }

  /** Opens the database window; its unsaved changes are protected like the map's. */
  private async openDatabase(): Promise<void> {
    this.database = new DatabaseEditor(this.root, this.api, { ...this.resources }, () => this.commandLookups(this.map ?? null).then((l) => ({ ...l, events: [] })), this.options.assets);
    try {
      await this.database.open();
    } catch (err) {
      this.showError(err);
    }
  }

  private setTool(tool: Tool): void {
    // The dotted selection belongs to the Select tool: it goes away with another tool.
    if (tool !== 'select' && this.view?.selection) {
      this.view.selection = null;
      this.view.requestDraw();
    }
    this.tool = tool;
    this.syncToolbar();
  }

  /** A drawing tool chosen with its button or key: it puts the hand and the shadow pen down. */
  private chooseTool(tool: Tool): void {
    if (this.mode === 'shadow') this.setMode(this.palette?.currentTab === 'R' ? 'region' : 'tiles');
    this.panning = false;
    this.setTool(tool);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    // The shadow pen draws: it puts the hand down.
    if (mode === 'shadow') this.panning = false;
    if (mode === 'region' && this.palette && this.palette.currentTab !== 'R') this.palette.setTab('R');
    if (mode === 'tiles' && this.palette?.currentTab === 'R') this.palette.setTab('A');
    this.view?.requestDraw();
    this.syncToolbar();
    // Tiles mode needs no legend; the others say what their marks mean.
    // A finger taps and presses long where a mouse clicks and double-clicks: the touch screens have their own texts.
    this.modeLegend.textContent = mode === 'tiles' ? '' : tDynamic(`editor.${coarse() ? 'legend_touch' : 'legend'}.${mode}`);
    this.modeLegend.title = this.modeLegend.textContent;
    this.modeLegend.classList.remove('expanded');
  }

  private renderTree(): void {
    const children = (parentId: number): HTMLElement[] =>
      this.infos
        .filter((i) => i.parentId === parentId)
        .sort((a, b) => a.order - b.order || a.id - b.id)
        .map((info) => {
          const kids = children(info.id);
          // A map without children keeps the toggle's room but not a button that does nothing.
          const toggle = el('button', {
            className: 'tree-toggle',
            text: kids.length ? (info.expanded ? '▾' : '▸') : '',
            attrs: kids.length
              ? { type: 'button', 'aria-label': t('editor.expand'), 'aria-expanded': String(info.expanded) }
              : { type: 'button', tabindex: '-1', 'aria-hidden': 'true', disabled: '' },
            on: {
              click: () => {
                info.expanded = !info.expanded;
                void this.api.patch(`/maps/${info.id}/info`, { expanded: info.expanded });
                this.renderTree();
              },
            },
          });
          const label = el('button', {
            className: `tree-label${info.id === this.info?.id ? ' current' : ''}`,
            text: `${info.id} · ${info.name}`,
            attrs: { type: 'button', role: 'treeitem', 'aria-selected': String(info.id === this.info?.id) },
            on: { click: () => void this.switchMap(info.id) },
          });
          return el('li', {}, [el('div', { className: 'tree-row' }, [toggle, label]), kids.length && info.expanded ? el('ul', {}, kids) : null]);
        });
    this.treeEl.replaceChildren(...children(0));
  }

  private setStatus(): void {
    const lock = this.readOnly ? t('editor.read_only', { name: this.lockHolder }) : '';
    const dirty = this.dirty ? t('editor.unsaved') : '';
    this.statusText.textContent = [lock, dirty].filter(Boolean).join(' — ');
    this.titleEl.textContent = this.info ? `${this.info.id} · ${this.info.name}${this.dirty ? ' *' : ''}` : '';
    this.updateStatusInfo();
    this.syncToolbar();
  }

  /** Right part of the status bar: map size, zoom and the cell under the pointer. */
  private updateStatusInfo(): void {
    const parts = [this.map ? `${this.map.width} × ${this.map.height}` : '', `${Math.round(this.zoom() * 100)} %`, this.cursor ? `${this.cursor.x}, ${this.cursor.y}` : ''];
    this.statusInfo.textContent = parts.filter(Boolean).join('   ');
  }

  private notify(text: string): void {
    const toast = el('div', { className: 'skin-window editor-toast', text });
    this.root.append(toast);
    window.setTimeout(() => toast.remove(), 2600);
  }

  private showError(err: unknown): void {
    if (err instanceof EditorApiError) this.notify(tDynamic(err.key, err.params));
    else {
      console.error(err);
      this.notify(t('error.http.server'));
    }
  }

  // --- Maps ----------------------------------------------------------------------

  private async loadSheets(tileset: TilesetData): Promise<Partial<Record<TilesetSheet, Bitmap>>> {
    const sheets: Partial<Record<TilesetSheet, Bitmap>> = {};
    await Promise.all(
      TILESET_SHEETS.map(async (slot, i) => {
        const name = tileset.tilesetNames[i];
        const img = name ? await this.options.assets.image('tilesets', name) : null;
        if (img) sheets[slot] = img;
      }),
    );
    return sheets;
  }

  /** Asks what to do with unsaved changes; resolves `true` when it is fine to continue. */
  private confirmDiscard(): Promise<boolean> {
    if (!this.dirty) return Promise.resolve(true);
    return new Promise((resolve) => {
      openModal(this.root, t('editor.unsaved_title'), el('p', { text: t('editor.unsaved_question') }), [
        { label: t('common.cancel'), onClick: () => resolve(false) },
        { label: t('editor.discard'), danger: true, onClick: () => resolve(true) },
        {
          label: t('editor.save'),
          primary: true,
          onClick: async () => {
            const ok = await this.save();
            resolve(ok);
          },
        },
      ]);
    });
  }

  private async switchMap(id: number): Promise<void> {
    if (id === this.info?.id) return;
    if (!(await this.confirmDiscard())) return;
    // The new map is loaded (and locked) first: if that fails, the current one stays open and locked.
    const previous = this.info && !this.readOnly ? this.info.id : null;
    await this.loadMap(id);
    if (previous !== null && this.info?.id !== previous) void this.api.delete(`/maps/${previous}/lock`).catch(() => undefined);
    // On a phone the drawer covers the map: show the map just chosen.
    if (this.compact()) this.setDrawer(null);
  }

  private async loadMap(id: number): Promise<void> {
    try {
      const { info, map, version } = await this.api.get<{ info: MapInfo; map: MapData; version: number }>(`/maps/${id}`);
      let readOnly = false;
      let lockHolder = '';
      try {
        await this.api.post(`/maps/${id}/lock`);
      } catch (err) {
        if (err instanceof EditorApiError && err.key === 'error.editor.locked') {
          readOnly = true;
          lockHolder = String(err.params.name ?? '?');
        } else throw err;
      }
      let tileset: TilesetData;
      try {
        tileset = (await this.api.get<{ tileset: TilesetData }>(`/tilesets/${map.tilesetId}`)).tileset;
      } catch (err) {
        if (!readOnly) void this.api.delete(`/maps/${id}/lock`).catch(() => undefined);
        throw err;
      }
      this.readOnly = readOnly;
      this.lockHolder = lockHolder;
      // Keep the entry of the tree: reorder / indent / outdent edit `this.info` and the tree draws `this.infos`.
      const known = this.infos.find((i) => i.id === info.id);
      if (known) Object.assign(known, info);
      this.info = known ?? info;
      this.map = map;
      this.mapVersion = version;
      this.tileset = tileset;
      this.sheets = await this.loadSheets(tileset);
      this.undoStack = [];
      this.redoStack = [];
      this.savedDepth = 0;
      this.dirty = false;
      this.mountView();
      this.renderTree();
      this.setStatus();
    } catch (err) {
      this.showError(err);
    }
  }

  private mountView(): void {
    const map = this.map!;
    const tileset = this.tileset!;
    const renderer = new TilemapRenderer({ width: 1, height: 1, data: [0, 0, 0, 0, 0, 0] }, tileset.flags, this.sheets, 48);
    if (!this.palette) {
      this.palette = new TilePalette(renderer, tileset.tilesetNames, (s) => {
        this.stamp = s;
        if (s.region && this.mode !== 'region') this.setMode('region');
        if (!s.region && this.mode === 'region') this.setMode('tiles');
      });
      this.paletteHost.replaceChildren(this.palette.element);
      this.palette.element.addEventListener('pointerup', (e) => {
        if ((e.target as HTMLElement).tagName !== 'CANVAS') return;
        // Tiles chosen: the hand gives way to drawing, to paint them (the round button and the frame of the map turn yellow).
        if (this.panning && this.mode !== 'events' && this.mode !== 'passage') this.setPanning(false);
        // On a phone, once tiles are chosen (finger lifted), the drawer gives the map back.
        if (e.pointerType === 'touch' && this.compact() && this.drawer === 'palette') window.setTimeout(() => this.setDrawer(null), 150);
      });
    } else {
      this.palette.setTileset(renderer, tileset.tilesetNames);
    }
    const zoom = this.view?.zoom ?? this.initialZoom();
    this.view?.destroy();
    this.view = new MapView(map, tileset.flags, this.sheets, {
      tool: () => this.tool,
      panning: () => this.panning,
      mode: () => this.mode,
      stamp: () => this.stamp,
      forcedLayer: () => this.forcedLayer,
      readOnly: () => this.readOnly,
      showGrid: () => this.grid,
      onEdit: (changes) => this.pushHistory({ kind: 'cells', changes }),
      onPassageEdit: (before, after) => this.pushHistory({ kind: 'props', before, after }),
      onPick: (id) => {
        this.palette?.selectTile(id);
        // The hand stays on (a long press is not a wish to draw): the round button turns drawing on.
        if (this.tool === 'picker') this.setTool('pencil');
      },
      onCursor: (x, y) => {
        this.cursor = { x, y };
        this.updateStatusInfo();
      },
      onEventSelect: () => this.syncToolbar(),
      onSelectionChange: () => this.syncToolbar(),
      onEventOpen: (x, y, id) => void this.openEvent(x, y, id),
      onEventMove: (id, x, y) => this.editEvents(() => {
        const e = this.map!.events[id];
        if (e) {
          e.x = x;
          e.y = y;
        }
      }),
      eventImage: (name) => this.eventImage(name),
      onZoom: () => {
        this.rememberZoom();
        this.updateStatusInfo();
        this.syncToolbar();
      },
    });
    this.view.zoom = zoom;
    if (this.onlyLayer) this.view.renderer.showOnlyLayer(this.forcedLayer);
    this.viewHost.replaceChildren(this.view.element, ...(this.fab ? [this.fab] : []));
    this.syncFab();
    this.view.setZoom(zoom);
  }

  private eventImage(name: string): Bitmap | null {
    if (this.eventImages.has(name)) return this.eventImages.get(name) ?? null;
    this.eventImages.set(name, null);
    void this.options.assets.image('characters', name).then((img) => {
      this.eventImages.set(name, img);
      this.view?.requestDraw();
    });
    return null;
  }

  private async refreshLock(): Promise<void> {
    if (!this.info || this.readOnly) return;
    try {
      await this.api.post(`/maps/${this.info.id}/lock`);
    } catch (err) {
      if (err instanceof EditorApiError && err.key === 'error.editor.locked') {
        this.readOnly = true;
        this.lockHolder = String(err.params.name ?? '?');
        this.setStatus();
      }
    }
  }

  /**
   * Saves the map; resolves `true` on success. Changes made while the request
   * travels are not in it: the map then stays marked as unsaved.
   */
  private async save(): Promise<boolean> {
    if (!this.info || !this.map || this.readOnly) return false;
    const revision = this.revision;
    try {
      const { version } = await this.api.put<{ version: number }>(`/maps/${this.info.id}`, { map: this.map, baseVersion: this.mapVersion });
      this.mapVersion = version;
      if (this.revision === revision) {
        this.dirty = false;
        this.savedDepth = this.undoStack.length;
      }
      // Touch screens: the hand comes back after each save, so that a finger does not paint by mistake.
      if (coarse()) this.panning = true;
      this.setStatus();
      this.notify(t('editor.saved'));
      // A script enabled in the event editor is saved with the map.
      void this.refreshQuarantine();
      return true;
    } catch (err) {
      if (err instanceof EditorApiError && err.key === 'error.editor.map_conflict') this.conflict();
      else this.showError(err);
      return false;
    }
  }

  /**
   * The map was saved by someone else (or another tab) since this copy was loaded: saving it would erase
   * that work. The administrator reopens the map (and redoes its own changes), or keeps its copy open.
   */
  private conflict(): void {
    const info = this.info;
    if (!info) return;
    openModal(this.root, t('editor.conflict_title'), el('p', { text: t('error.editor.map_conflict') }), [
      { label: t('editor.conflict_keep'), onClick: () => undefined },
      {
        label: t('editor.conflict_reload'),
        primary: true,
        onClick: async () => {
          this.dirty = false;
          await this.loadMap(info.id);
        },
      },
    ]);
  }

  /** Reloads the map tree and resource lists (after a project import). */
  private async reloadTree(): Promise<void> {
    const boot = await this.api.get<{ maps: MapInfo[]; tilesets: TilesetSummary[] }>('/bootstrap');
    this.infos = boot.maps;
    this.tilesets = boot.tilesets;
    await this.loadResourceLists();
    this.renderTree();
    await this.refreshQuarantine();
  }

  // --- Scripts in quarantine ------------------------------------------------------------

  /** Shows how many scripts from imported files wait for approval (the button hides when there are none). */
  private async refreshQuarantine(): Promise<QuarantineItem[]> {
    try {
      const { items } = await this.api.get<{ items: QuarantineItem[] }>('/quarantine');
      this.quarantineCount = items.length;
      this.syncToolbar();
      return items;
    } catch (err) {
      this.showError(err);
      return [];
    }
  }

  /**
   * Lists the scripts from imported files with their code: each one is turned on once read
   * ("Enable"), or all at once. The open map is saved (or its changes dropped) first, then reloaded.
   */
  private async openQuarantine(): Promise<void> {
    const items = await this.refreshQuarantine();
    const place = (item: QuarantineItem) =>
      item.kind === 'map'
        ? t('editor.quarantine.in_map', { map: `${item.mapId} · ${item.mapName}`, event: item.eventName, page: item.page + 1 })
        : t('editor.quarantine.in_common_event', { id: item.id, name: item.name });
    let close: () => void = () => undefined;
    const approve = async (chosen: QuarantineItem[]) => {
      const current = this.info?.id;
      const touchesCurrent = chosen.some((i) => i.kind === 'map' && i.mapId === current);
      if (touchesCurrent && !(await this.confirmDiscard())) return;
      try {
        const { approved, skipped } = await this.api.post<{ approved: number; skipped: number }>('/quarantine/approve', { items: chosen });
        this.notify(t(skipped ? 'editor.quarantine.done_skipped' : 'editor.quarantine.done', { approved, skipped }));
        if (touchesCurrent && current !== undefined) await this.loadMap(current);
      } catch (err) {
        this.showError(err);
      }
      close();
      if ((await this.refreshQuarantine()).length > 0) void this.openQuarantine();
    };
    const rows = items.map((item) =>
      el('section', { className: 'quarantine-item' }, [
        el('div', { className: 'quarantine-head' }, [
          el('strong', { text: place(item) }),
          item.kind === 'map' && item.mapId !== this.info?.id
            ? this.button(t('editor.quarantine.open'), () => {
                close();
                void this.switchMap(item.mapId);
              })
            : null,
          this.button(t('ev.quarantine.enable'), () => void approve([item]), 'primary'),
        ]),
        el('pre', { className: 'script-code', text: item.code }),
      ]),
    );
    const body = el('div', { className: 'quarantine-list' }, [el('p', { className: 'hint', text: t('editor.quarantine.intro') }), ...(rows.length ? rows : [el('p', { text: t('editor.quarantine.empty') })])]);
    close = openModal(this.root, t('editor.quarantine.title'), body, [
      { label: t('ui.close') },
      ...(items.length > 1 ? [{ label: t('editor.quarantine.enable_all', { count: items.length }), danger: true, onClick: () => void approve(items) }] : []),
    ], 'modal-wide');
  }

  /** Downloads the current map in the external map file layout. */
  private exportMap(): void {
    if (!this.info) return;
    const link = el('a', { attrs: { href: `/api/editor/maps/${this.info.id}/export`, download: `Map${String(this.info.id).padStart(3, '0')}.json` } });
    this.root.append(link);
    link.click();
    link.remove();
  }

  private newMap(): void {
    newMapDialog(this.root, this.tilesets, async (v) => {
      const { info } = await this.api.post<{ info: MapInfo }>('/maps', { ...v, parentId: this.info?.parentId ?? 0 });
      this.infos.push(info);
      this.renderTree();
      await this.switchMap(info.id);
    });
  }

  private async reorder(delta: number): Promise<void> {
    const info = this.info;
    if (!info) return;
    const siblings = this.infos.filter((i) => i.parentId === info.parentId).sort((a, b) => a.order - b.order || a.id - b.id);
    const index = siblings.findIndex((i) => i.id === info.id);
    const other = siblings[index + delta];
    if (!other) return;
    // Siblings are numbered 1, 2, 3... again (orders may have gaps or duplicates after an
    // import); every order that changes is saved, so the tree looks the same after a reload.
    const before = new Map(siblings.map((s) => [s.id, s.order]));
    siblings.forEach((s, i) => (s.order = i + 1));
    [info.order, other.order] = [other.order, info.order];
    const changed = siblings.filter((s) => s.order !== before.get(s.id));
    await Promise.all(changed.map((s) => this.api.patch(`/maps/${s.id}/info`, { order: s.order }))).catch((e) => this.showError(e));
    this.renderTree();
  }

  private async outdent(): Promise<void> {
    const info = this.info;
    if (!info || info.parentId === 0) return;
    const parent = this.infos.find((i) => i.id === info.parentId);
    await this.moveTo(info, parent?.parentId ?? 0);
  }

  private async indent(): Promise<void> {
    const info = this.info;
    if (!info) return;
    const siblings = this.infos.filter((i) => i.parentId === info.parentId).sort((a, b) => a.order - b.order || a.id - b.id);
    const previous = siblings[siblings.findIndex((i) => i.id === info.id) - 1];
    if (previous) await this.moveTo(info, previous.id);
  }

  private async moveTo(info: MapInfo, parentId: number): Promise<void> {
    try {
      const res = await this.api.patch<{ info: MapInfo }>(`/maps/${info.id}/info`, { parentId, order: 9999 });
      Object.assign(info, res.info);
      this.renderTree();
    } catch (err) {
      this.showError(err);
    }
  }

  private async deleteMap(): Promise<void> {
    const info = this.info;
    if (!info) return;
    openModal(this.root, t('editor.delete_map'), el('p', { text: t('editor.delete_map_confirm', { name: info.name }) }), [
      { label: t('common.cancel') },
      {
        label: t('editor.delete'),
        danger: true,
        onClick: async () => {
          try {
            await this.api.delete(`/maps/${info.id}`);
          } catch (err) {
            // Still used elsewhere: say where, and delete only if confirmed again.
            if (!(err instanceof EditorApiError) || err.key !== 'error.editor.map_in_use') throw err;
            const usages = (err.body.usages ?? []) as DatabaseUsage[];
            const more = Number(err.params.count) > usages.length ? `\n${t('db.use.more', { count: Number(err.params.count) - usages.length })}` : '';
            const list = usages.map((u) => `• ${describeUsage(u)}`).join('\n') + more;
            if (!(await confirmDialog({ title: t('db.in_use_title'), message: t('editor.map_in_use_confirm', { name: info.name, list }), ok: t('db.delete_anyway'), danger: true }))) return;
            await this.api.delete(`/maps/${info.id}?force=1`);
          }
          this.infos = this.infos.filter((i) => i.id !== info.id);
          this.dirty = false;
          this.info = null;
          const next = this.infos[0];
          if (next) await this.loadMap(next.id);
          this.renderTree();
        },
      },
    ]);
  }

  private async openProperties(): Promise<void> {
    const info = this.info;
    const map = this.map;
    if (!info || !map) return;
    const enemies = await this.api.get<{ records: { id: number; name: string }[] }>('/db/enemy').then((r) => r.records.map((e) => ({ id: e.id, name: e.name })), () => []);
    propertiesDialog(this.root, info, map, this.tilesets, enemies, this.resources, async ({ name, width, height, data }) => {
      if (this.readOnly) throw new EditorApiError('error.editor.lock_required');
      const resized = width !== map.width || height !== map.height;
      if (resized && this.dirty && !(await this.save())) return;
      if (name !== info.name || resized) {
        const res = await this.api.patch<{ info: MapInfo; map: MapData; version: number }>(`/maps/${info.id}/info`, { name, width, height });
        Object.assign(info, res.info);
        if (resized) {
          this.map = res.map;
          this.mapVersion = res.version;
          this.undoStack = [];
          this.redoStack = [];
          this.savedDepth = 0;
        }
        this.renderTree();
      }
      const before = JSON.stringify(this.pickProps(this.map!));
      Object.assign(this.map!, { ...data, mmo: { ...this.map!.mmo, ...data.mmo } });
      const after = JSON.stringify(this.pickProps(this.map!));
      if (before !== after) this.pushHistory({ kind: 'props', before, after });
      if (data.tilesetId !== undefined && data.tilesetId !== this.tileset?.id) {
        this.tileset = (await this.api.get<{ tileset: TilesetData }>(`/tilesets/${data.tilesetId}`)).tileset;
        this.sheets = await this.loadSheets(this.tileset);
      }
      this.mountView();
      this.setStatus();
    }, (kind, name) => this.options.assets.url(kind, name));
  }

  private pickProps(map: MapData): Partial<MapData> {
    const { data: _d, events: _e, width: _w, height: _h, ...props } = map;
    return props;
  }

  private async openTilesets(): Promise<void> {
    try {
      await openTilesetEditor(this.root, this.api, this.options.assets, this.tilesets, this.tilesetImages, this.map?.tilesetId ?? 1, (saved) => {
        const summary = this.tilesets.find((ts) => ts.id === saved.id);
        if (summary) Object.assign(summary, { name: saved.name, mode: saved.mode, tilesetNames: saved.tilesetNames });
        if (this.map && saved.id === this.map.tilesetId) {
          this.tileset = saved;
          void this.loadSheets(saved).then((sheets) => {
            this.sheets = sheets;
            this.mountView();
          });
        }
        this.notify(t('db.saved'));
      });
    } catch (err) {
      this.showError(err);
    }
  }

  private async openVersions(): Promise<void> {
    const info = this.info;
    if (!info) return;
    try {
      const { versions } = await this.api.get<{ versions: { id: number; createdAt: string; accountId: number | null }[] }>(`/maps/${info.id}/versions`);
      versionsDialog(this.root, versions, async (versionId) => {
        // Restoring replaces the working copy: unsaved changes are saved or dropped first.
        if (!(await this.confirmDiscard())) return false;
        try {
          const { map, version } = await this.api.post<{ map: MapData; version: number }>(`/maps/${info.id}/versions/${versionId}/restore`);
          this.map = map;
          this.mapVersion = version;
          this.undoStack = [];
          this.redoStack = [];
          this.savedDepth = 0;
          this.dirty = false;
          this.revision++;
          this.mountView();
          this.setStatus();
          this.notify(t('editor.restored'));
          return true;
        } catch (err) {
          this.showError(err);
          return false;
        }
      });
    } catch (err) {
      this.showError(err);
    }
  }

  // --- Events ------------------------------------------------------------------------

  /** Applies a change to the event list, recording it in the history. */
  private editEvents(change: () => void): void {
    if (!this.map || this.readOnly) return;
    const before = JSON.stringify(this.map.events);
    change();
    // Trailing deleted slots are dropped so ids stay compact.
    while (this.map.events.length > 1 && this.map.events.at(-1) === null) this.map.events.pop();
    const after = JSON.stringify(this.map.events);
    if (before !== after) this.pushHistory({ kind: 'events', before, after });
    this.view?.requestDraw();
  }

  /** Loads what the event forms offer to pick from (database entries, switch names...). */
  private async eventLookups(map: MapData): Promise<EventEditorContext> {
    return { ...(await this.commandLookups(map)), map };
  }

  /**
   * What the command forms offer to pick from. Without a map open (the database window opened first), the
   * forms of common events, quests and raids still work: no event of a current map to choose.
   */
  private async commandLookups(map: MapData | null): Promise<Omit<EventEditorContext, 'map'>> {
    type Named = { id: number; name: string };
    const list = (type: string) => this.api.get<{ records: Named[] }>(`/db/${type}`).then((r) => r.records.map((e) => ({ id: e.id, name: e.name })));
    const [system, items, weapons, armorRecords, commonEvents, animations, quests, enemies] = await Promise.all([
      this.api.get<{ system: SystemSettings }>('/system').then((r) => r.system),
      list('item'), list('weapon'), this.api.get<{ records: (Named & { slot?: string })[] }>('/db/armor').then((r) => r.records), list('commonEvent'), list('animation'), list('quest'), list('enemy'),
    ]);
    const armors = armorRecords.map((a) => ({ id: a.id, name: a.name }));
    const armorSlots = Object.fromEntries(armorRecords.map((a) => [a.id, String(a.slot ?? '')]));
    return {
      host: this.root,
      assets: this.options.assets,
      switches: system.switches,
      variables: system.variables,
      items, weapons, armors, armorSlots, commonEvents, animations, quests, enemies,
      maps: this.infos.map((m) => ({ id: m.id, name: m.name })),
      mapId: this.info?.id ?? this.infos[0]?.id ?? 1,
      events: (map?.events ?? []).filter((e): e is GameEvent => e !== null).map((e) => ({ id: e.id, name: e.name })),
      resources: this.resources,
      pickCell: (mapId) => this.pickCell(mapId),
      editRoute: (route) => editRoute(this.root, route, this.resources),
    };
  }

  private async openEvent(x: number, y: number, id: number | null): Promise<void> {
    const map = this.map;
    if (!map || this.readOnly) return;
    const look = await this.eventLookups(map);
    const existing = id !== null ? map.events[id] ?? null : null;
    const done = (event: GameEvent | null) =>
      this.editEvents(() => {
        if (event === null && existing) map.events[existing.id] = null;
        else if (event) map.events[event.id] = event;
      });
    // Events the quick forms cannot represent open in the full editor directly.
    if (existing && quickKindOf(existing) === 'json') {
      openEventEditor(look, x, y, existing, done);
      return;
    }
    quickEventDialog(
      {
        host: this.root,
        maps: this.infos,
        currentMapId: this.info!.id,
        map,
        resources: this.resources,
        assets: this.options.assets,
        items: look.items,
        pickCell: (mapId) => this.pickCell(mapId),
        mapSize: async (mapId) => {
          try {
            const { map: other } = await this.api.get<{ map: MapData }>(`/maps/${mapId}`);
            return { width: other.width, height: other.height };
          } catch {
            return null;
          }
        },
        openFullEditor: (event) => openEventEditor(look, x, y, event, done, existing !== null),
      },
      x,
      y,
      existing,
      done,
    );
  }

  /** Shows a map preview and resolves with the clicked cell. */
  private async pickCell(mapId: number): Promise<{ x: number; y: number } | null> {
    const { map } = mapId === this.info?.id && this.map ? { map: this.map } : await this.api.get<{ map: MapData }>(`/maps/${mapId}`);
    const tileset = map.tilesetId === this.tileset?.id ? this.tileset : (await this.api.get<{ tileset: TilesetData }>(`/tilesets/${map.tilesetId}`)).tileset;
    const sheets = await this.loadSheets(tileset);
    const renderer = new TilemapRenderer(map, tileset.flags, sheets, 48);
    const scale = Math.min(1, 720 / (map.width * 48), 480 / (map.height * 48));
    const canvas = el('canvas', { className: 'pick-canvas' });
    canvas.width = Math.round(map.width * 48 * scale);
    canvas.height = Math.round(map.height * 48 * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.scale(scale, scale);
    renderer.drawLower(ctx, 0, 0, map.width * 48, map.height * 48);
    renderer.drawUpper(ctx, 0, 0, map.width * 48, map.height * 48);
    return new Promise((resolve) => {
      let close: () => void = () => undefined;
      canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor(((e.clientX - rect.left) / rect.width) * map.width);
        const y = Math.floor(((e.clientY - rect.top) / rect.height) * map.height);
        close();
        resolve({ x, y });
      });
      close = openModal(this.root, t('editor.pick_on_map'), el('div', { className: 'pick-body' }, [el('p', { className: 'hint', text: t('editor.pick_help') }), canvas]), [
        { label: t('common.cancel'), onClick: () => resolve(null) },
      ]);
    });
  }

  // --- History -------------------------------------------------------------------------

  private pushHistory(entry: HistoryEntry): void {
    // A new change drops the redo branch: a state saved inside it can no longer be reached.
    if (this.savedDepth > this.undoStack.length) this.savedDepth = -1;
    this.undoStack.push(entry);
    if (this.undoStack.length > 200) {
      this.undoStack.shift();
      if (this.savedDepth >= 0) this.savedDepth--;
    }
    this.redoStack = [];
    this.dirty = true;
    this.revision++;
    this.setStatus();
  }

  private applyEntry(entry: HistoryEntry, undo: boolean): void {
    const map = this.map!;
    if (entry.kind === 'cells') applyChanges(map, entry.changes, undo);
    else if (entry.kind === 'events') map.events = JSON.parse(undo ? entry.before : entry.after) as MapData['events'];
    else Object.assign(map, JSON.parse(undo ? entry.before : entry.after) as Partial<MapData>);
    this.dirty = true;
    this.revision++;
    this.view?.refresh();
    this.setStatus();
  }

  /** Back at the saved state (by undoing or redoing) means nothing is left to save. */
  private syncDirty(): void {
    this.dirty = this.undoStack.length !== this.savedDepth;
    this.setStatus();
  }

  private undo(): void {
    const entry = this.undoStack.pop();
    if (!entry || this.readOnly) return;
    this.applyEntry(entry, true);
    this.redoStack.push(entry);
    this.syncDirty();
  }

  private redo(): void {
    const entry = this.redoStack.pop();
    if (!entry || this.readOnly) return;
    this.applyEntry(entry, false);
    this.undoStack.push(entry);
    this.syncDirty();
  }

  // --- Keyboard ------------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (!this.root.isConnected) return;
    const target = e.target as HTMLElement;
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    // (The game underneath ignores the keyboard while the editor is open.)
    // An open menu of the menu bar takes the keys (arrows, Enter, Escape).
    if (typing || this.menuBar?.isOpen || this.root.querySelector('.modal-backdrop')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && key === 's') {
      e.preventDefault();
      void this.save();
    } else if (ctrl && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault();
      this.redo();
    } else if (ctrl && (key === 'c' || key === 'x')) {
      e.preventDefault();
      this.copy(key === 'x');
    } else if (ctrl && key === 'v') {
      e.preventDefault();
      this.paste();
    } else if (key === 'delete' || key === 'backspace') {
      e.preventDefault();
      this.deleteSelection();
    } else if (key === 'enter' && this.mode === 'events' && this.view?.selectedEvent != null && this.map) {
      // Keyboard alternative to double-clicking an event.
      e.preventDefault();
      const ev = this.map.events[this.view.selectedEvent];
      if (ev) void this.openEvent(ev.x, ev.y, ev.id);
    } else if (!ctrl && !e.altKey) {
      const tool = TOOLS.find(([, letter]) => letter.toLowerCase() === key);
      if (tool) this.chooseTool(tool[0]);
      else if (key === PAN_KEY.toLowerCase()) this.setPanning(!this.panning);
    }
  }

  private copy(cut: boolean): void {
    const view = this.view;
    const map = this.map;
    if (!view || !map) return;
    if (this.mode === 'events' && view.selectedEvent !== null) {
      this.eventClipboard = deepCopy(map.events[view.selectedEvent] ?? null);
      if (cut) this.deleteSelection();
      this.syncToolbar();
      return;
    }
    const s = view.selection;
    if (!s) return;
    const editor = new MapEditor(map);
    this.clipboard = editor.copy(s.x0, s.y0, s.x1, s.y1);
    if (cut && !this.readOnly) {
      editor.clear(s.x0, s.y0, s.x1, s.y1, true);
      this.pushHistory({ kind: 'cells', changes: editor.commit() });
      view.refresh();
    }
    this.syncToolbar();
  }

  /** Pastes under the pointer; from the toolbar or the menu, at the selection or the last cell pressed. */
  private paste(): void {
    const view = this.view;
    const map = this.map;
    const cell = view?.hoverCell ?? (view?.selection ? { x: view.selection.x0, y: view.selection.y0 } : null) ?? view?.lastCell ?? null;
    if (!view || !map || !cell || this.readOnly) return;
    if (this.mode === 'events' && this.eventClipboard) {
      const clip = this.eventClipboard;
      this.editEvents(() => {
        const free = map.events.findIndex((e, i) => i > 0 && e === null);
        const id = free > 0 ? free : map.events.length;
        map.events[id] = { ...deepCopy(clip), id, x: cell.x, y: cell.y };
      });
      return;
    }
    if (!this.clipboard) return;
    const editor = new MapEditor(map);
    editor.paste(cell.x, cell.y, this.clipboard);
    const changes = editor.commit();
    if (changes.length) this.pushHistory({ kind: 'cells', changes });
    view.refresh();
  }

  private deleteSelection(): void {
    const view = this.view;
    const map = this.map;
    if (!view || !map || this.readOnly) return;
    if (this.mode === 'events' && view.selectedEvent !== null) {
      const id = view.selectedEvent;
      this.editEvents(() => {
        map.events[id] = null;
      });
      view.selectedEvent = null;
      this.syncToolbar();
      return;
    }
    const s = view.selection;
    if (!s) return;
    const editor = new MapEditor(map);
    editor.clear(s.x0, s.y0, s.x1, s.y1);
    const changes = editor.commit();
    if (changes.length) this.pushHistory({ kind: 'cells', changes });
    view.refresh();
  }

  /**
   * Goes back to the game on the edited map, to try it at once: unsaved changes
   * are saved (or dropped) first, then the administrator's character is placed
   * on the last cell pressed (the centre of the map by default; a blocked cell
   * gives the closest free one) and the editor closes.
   */
  private async playtest(): Promise<void> {
    const info = this.info;
    const map = this.map;
    if (!info || !map || !(await this.confirmDiscard())) return;
    const cell = this.view?.lastCell ?? { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
    try {
      await this.adminApi.post('/tools/teleport', { characterId: 'self', mapId: info.id, x: cell.x, y: cell.y });
    } catch (err) {
      this.showError(err);
      return;
    }
    this.shutdown();
  }

  /** Closes the editor (asking about unsaved changes). */
  async close(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.shutdown();
  }

  /** Removes the editor; its unsaved changes were saved or dropped already. */
  private shutdown(): void {
    this.menuBar?.close();
    if (this.info && !this.readOnly) void this.api.delete(`/maps/${this.info.id}/lock`).catch(() => undefined);
    window.clearInterval(this.lockTimer);
    window.removeEventListener('keydown', this.keyHandler, true);
    window.removeEventListener('beforeunload', this.unloadHandler);
    if (this.fullscreenHandler) document.removeEventListener('fullscreenchange', this.fullscreenHandler);
    document.body.classList.remove('editor-open');
    this.view?.destroy();
    this.root.remove();
    this.options.onClose();
  }
}
