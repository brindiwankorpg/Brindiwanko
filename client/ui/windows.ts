/**
 * @file Window system of the interface.
 *
 * Every window uses the window skin (blue gradient background, light frame),
 * can be closed, and on desktop can be dragged by its title bar; on small
 * screens windows are shown as bottom sheets. Open windows form a stack: the
 * top window receives the navigation buttons (up/down to move the cursor,
 * Action to confirm, Cancel to close), which keeps keyboard and gamepad-style
 * play possible, while mouse and touch simply click items.
 *
 * Window positions are remembered per character in `localStorage`.
 */
import type { UiAudio } from '../engine/audio.js';
import type { Input } from '../engine/input.js';
import { t } from '../i18n.js';
import { el, icon, localized } from './dom.js';
import type { IconName } from '../../shared/icons.js';

/** Clicks received this soon after a window opened are ignored (the end of the touch that opened it). */
const GHOST_CLICK_MS = 350;

/** One entry of a selectable list. */
export interface ListItem {
  label: string;
  icon?: IconName | number;
  enabled?: boolean;
  hint?: string;
  /** Longer text shown under the list while the item is highlighted. */
  description?: string;
  /** Text shown on the right of the label (quantity, price...). */
  suffix?: string;
  onSelect?: () => void;
  /** Called when the item becomes highlighted (details panels). */
  onFocus?: () => void;
}

/** Base class of interface windows. */
export class GameWindow {
  readonly element: HTMLDivElement;
  readonly body: HTMLDivElement;
  private readonly titleEl: HTMLSpanElement;
  protected manager: WindowManager | null = null;
  private items: { item: ListItem; node: HTMLElement }[] = [];
  private cursor = 0;
  private help: HTMLElement | null = null;

  /**
   * @param id - Stable id (used to remember the position).
   * @param title - Title text.
   * @param options - `closable` shows a close button; `className` adds a CSS class.
   */
  constructor(
    readonly id: string,
    title: string,
    options: { closable?: boolean; className?: string; draggable?: boolean } = {},
  ) {
    this.titleEl = el('span', { className: 'window-title', text: title });
    const header = el('div', { className: 'window-header' }, [this.titleEl]);
    if (options.closable !== false) {
      header.append(
        // Marked for translation: the tooltip follows a change of language made in game.
        localized(el('button', { className: 'window-close', attrs: { type: 'button' }, on: { click: () => this.close() } }, [icon('close')]), { title: 'ui.close', label: 'ui.close' }),
      );
    }
    this.body = el('div', { className: 'window-body' });
    this.element = el('div', { className: `skin-window game-window ${options.className ?? ''}`, attrs: { role: 'dialog', 'aria-label': title } }, [header, this.body]);
    if (options.draggable !== false) makeDraggable(this.element, header, id);
    // A window opened by a touch (B for the menu, A for a shop...) can appear under the finger: the click the
    // browser sends when the finger lifts must not choose one of its entries.
    this.element.addEventListener('click', (e) => {
      if (performance.now() - this.openedAt < GHOST_CLICK_MS) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  /** When the window was last opened (see the click guard of the constructor). */
  private openedAt = -Infinity;

  /** Called by the manager when the window is shown (or brought to the front). */
  markOpened(): void {
    this.openedAt = performance.now();
  }

  /** Changes the title. */
  setTitle(title: string): void {
    this.titleEl.textContent = title;
    this.element.setAttribute('aria-label', title);
  }

  /** Called by the manager when opened. */
  attach(manager: WindowManager): void {
    this.manager = manager;
  }

  /** Closes the window. */
  close(): void {
    this.manager?.close(this);
  }

  /**
   * Fills the body with a selectable list.
   * @param keepCursor - Keeps the highlighted position (refresh of the same list).
   * @param cursor - Position to highlight at first.
   */
  setList(items: ListItem[], container: HTMLElement = this.body, keepCursor = false, cursor?: number): void {
    const previous = this.cursor;
    const list = el('ul', { className: 'command-list', attrs: { role: 'menu' } });
    this.items = items.map((item, index) => {
      const node = el(
        'li',
        {
          className: `command${item.enabled === false ? ' disabled' : ''}`,
          title: item.hint,
          attrs: { role: 'menuitem', 'aria-disabled': String(item.enabled === false) },
          on: {
            click: () => {
              this.cursor = index;
              this.refreshCursor();
              this.select();
            },
            pointerenter: () => {
              this.cursor = index;
              this.refreshCursor();
            },
          },
        },
        [item.icon !== undefined ? icon(item.icon) : null, el('span', { className: 'command-label', text: item.label }), item.suffix ? el('span', { className: 'command-suffix', text: item.suffix }) : null],
      );
      list.append(node);
      return { item, node };
    });
    this.help = items.some((i) => i.description !== undefined) ? el('div', { className: 'command-help' }) : null;
    container.replaceChildren(list, ...(this.help ? [this.help] : []));
    const wanted = cursor ?? (keepCursor ? previous : undefined);
    this.cursor = wanted !== undefined ? Math.min(wanted, Math.max(0, this.items.length - 1)) : Math.max(0, this.items.findIndex((i) => i.item.enabled !== false));
    this.focused = -1;
    this.refreshCursor();
  }

  /** Index of the item whose `onFocus` ran last. */
  private focused = -1;

  private refreshCursor(): void {
    this.items.forEach(({ node }, i) => node.classList.toggle('selected', i === this.cursor));
    if (this.help) this.help.textContent = this.items[this.cursor]?.item.description ?? '';
    if (this.focused !== this.cursor) {
      this.focused = this.cursor;
      this.items[this.cursor]?.item.onFocus?.();
    }
  }

  private select(): void {
    const entry = this.items[this.cursor];
    if (!entry) return;
    if (entry.item.enabled === false) {
      this.manager?.audio.play('buzzer');
      return;
    }
    this.manager?.audio.play('ok');
    entry.item.onSelect?.();
  }

  /**
   * Handles navigation buttons when this window is on top.
   * @returns `true` if the input was used.
   */
  handleInput(input: Input): boolean {
    if (input.consume('cancel')) {
      this.manager?.audio.play('cancel');
      this.close();
      return true;
    }
    if (this.items.length > 0) {
      const move = input.consume('down') ? 1 : input.consume('up') ? -1 : 0;
      if (move) {
        this.cursor = (this.cursor + move + this.items.length) % this.items.length;
        this.manager?.audio.play('cursor');
        this.refreshCursor();
        return true;
      }
      if (input.consume('action')) {
        this.select();
        return true;
      }
    }
    input.consume('action');
    return true;
  }

  /** Called when the window becomes visible (refresh contents). */
  onOpen(): void {}

  /** Called after the window was removed. */
  onClose(): void {}
}

/** Keeps the stack of open windows. */
export class WindowManager {
  private readonly stack: GameWindow[] = [];

  /**
   * @param layer - DOM container of windows.
   * @param audio - Interface sounds.
   * @param onChange - Called whenever the stack changes (to freeze the player).
   */
  constructor(
    private readonly layer: HTMLElement,
    readonly audio: UiAudio,
    private readonly onChange: () => void = () => {},
  ) {
    // A resized or rotated screen: windows keep to the screen (or give back their desktop-only inline styles).
    window.addEventListener('resize', () => {
      for (const w of this.stack) adaptToViewport(w.element);
    });
  }

  /** Tells whether any window is open. */
  get hasOpen(): boolean {
    return this.stack.length > 0;
  }

  /** Tells whether a window is open. */
  isOpen(w: GameWindow): boolean {
    return this.stack.includes(w);
  }

  /** Opens (or brings to front) a window. */
  open(w: GameWindow): void {
    const i = this.stack.indexOf(w);
    if (i >= 0) this.stack.splice(i, 1);
    this.stack.push(w);
    w.attach(this);
    w.markOpened();
    this.layer.append(w.element);
    w.onOpen();
    anchorTop(w.element);
    keepOnScreen(w.element);
    this.onChange();
  }

  /** Closes a window. */
  close(w: GameWindow): void {
    const i = this.stack.indexOf(w);
    if (i < 0) return;
    this.stack.splice(i, 1);
    w.element.remove();
    releaseTop(w.element);
    w.onClose();
    this.onChange();
  }

  /** Toggles a window. */
  toggle(w: GameWindow): void {
    if (this.stack.at(-1) === w) this.close(w);
    else this.open(w);
  }

  /** Closes every window. */
  closeAll(): void {
    for (const w of [...this.stack]) this.close(w);
  }

  /**
   * Routes navigation input to the top window.
   * @returns `true` when a window consumed the input.
   */
  handleInput(input: Input): boolean {
    const top = this.stack.at(-1);
    return top ? top.handleInput(input) : false;
  }
}

/**
 * Windows are centred on the screen; once shown, their top edge stays where it is, so that a window whose
 * content changes height (shop: buy / sell) grows downward instead of jumping up and down around its centre.
 * Not for windows moved by the player, nor for phones (docked windows).
 */
function anchorTop(win: HTMLElement): void {
  if (win.classList.contains('positioned') || win.dataset.anchored || document.body.classList.contains('touch-mode') || window.matchMedia('(max-width: 640px)').matches) return;
  const top = Math.round(win.getBoundingClientRect().top);
  win.dataset.anchored = '1';
  win.style.top = `${top}px`;
  win.style.transform = 'translateX(-50%)';
  win.style.maxHeight = `calc(100vh - ${top}px - 8px)`;
}

/** True when windows are docked at the bottom of the screen (phones): inline desktop positions do not apply. */
function isDocked(): boolean {
  return document.body.classList.contains('touch-mode') || window.matchMedia('(max-width: 640px)').matches;
}

/**
 * A remembered position (saved on another screen, or before the browser window was resized) must not hide
 * a window: it comes back inside the screen, entirely when it fits (otherwise its top stays visible).
 */
function keepOnScreen(win: HTMLElement): void {
  if (!win.classList.contains('positioned') || isDocked()) return;
  const rect = win.getBoundingClientRect();
  if (rect.width === 0) return;
  const x = Math.max(0, Math.min(window.innerWidth - rect.width, rect.left));
  const y = Math.max(0, Math.min(window.innerHeight - Math.min(rect.height, window.innerHeight), rect.top));
  if (Math.abs(x - rect.left) >= 1) win.style.left = `${x}px`;
  if (Math.abs(y - rect.top) >= 1) win.style.top = `${y}px`;
}

/** Called when the screen size changes while a window is open. */
function adaptToViewport(win: HTMLElement): void {
  if (isDocked()) releaseTop(win);
  else keepOnScreen(win);
}

/** Back to the centred position (the next opening measures it again). */
function releaseTop(win: HTMLElement): void {
  if (!win.dataset.anchored) return;
  delete win.dataset.anchored;
  win.style.top = '';
  win.style.transform = '';
  win.style.maxHeight = '';
}

/** Remembered window positions, per character. */
let positionsKey = 'brindiwanko.windows';

/** Sets the storage key used for window positions (one per character). */
export function setWindowStorageKey(characterId: number): void {
  positionsKey = `brindiwanko.windows.${characterId}`;
}

function loadPositions(): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(localStorage.getItem(positionsKey) ?? '{}') as Record<string, { x: number; y: number }>;
  } catch {
    return {};
  }
}

function makeDraggable(win: HTMLElement, handle: HTMLElement, id: string): void {
  const saved = loadPositions()[id];
  if (saved) {
    win.style.left = `${saved.x}px`;
    win.style.top = `${saved.y}px`;
    win.classList.add('positioned');
  }
  handle.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button') || window.matchMedia('(max-width: 640px)').matches) return;
    const rect = win.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - offX));
      const y = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - offY));
      releaseTop(win);
      win.style.left = `${x}px`;
      win.style.top = `${y}px`;
      win.classList.add('positioned');
    };
    // A drag interrupted by the system (a call, a gesture of the browser) ends like a release:
    // otherwise the window would keep following a pointer that no longer sends anything.
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      // Pressed and released without moving: no position to remember.
      if (!win.style.left) return;
      const positions = loadPositions();
      positions[id] = { x: Number.parseFloat(win.style.left), y: Number.parseFloat(win.style.top) };
      try {
        localStorage.setItem(positionsKey, JSON.stringify(positions));
      } catch {
        /* storage unavailable: positions are simply not remembered */
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}
