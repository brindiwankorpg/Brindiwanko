/**
 * @file Touch controls: floating virtual joystick, Action (A) and Cancel (B)
 * buttons, menu and fullscreen buttons.
 *
 * - The joystick is fixed in the bottom-left corner (only touches that start on
 *   it count; a tap elsewhere walks to that cell); a dead zone ignores small
 *   movements and the direction is snapped to the four directions by the
 *   dominant axis. Holding it keeps walking.
 * - A and B are large buttons on the right; they give visual feedback and a
 *   short vibration when available. Pointer events are tracked per pointer, so
 *   walking with the joystick while pressing A works (multi-touch).
 * - Fullscreen uses the Fullscreen API (with the WebKit prefix) and keeps the
 *   landscape orientation when the phone is held that way; on iPhone, where web pages cannot go
 *   fullscreen, a hint suggests adding the game to the home screen instead.
 */
import type { Direction } from '../../shared/settings.js';
import type { Input } from '../engine/input.js';
import { t } from '../i18n.js';
import { el, icon, localized } from './dom.js';
import type { GameOptions } from './options.js';

/** Dead zone radius as a fraction of the joystick radius. */
const DEAD_ZONE = 0.28;
/** Shortcut buttons around the Action button (the hotbar is shown four slots at a time). */
const ARC_SIZE = 4;

/**
 * These buttons act as soon as the finger touches them. When the finger lifts, the browser would also send
 * a `click` to whatever is under it by then: a window just opened there (the menu, by B) would get it and
 * choose one of its entries. Cancelling the end of the touch stops that click.
 */
function noGhostClick(button: HTMLElement): void {
  button.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
}

type FullscreenDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => void };

/** Tells whether the page is fullscreen. */
export function isFullscreen(): boolean {
  const d = document as FullscreenDoc;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/** Tells whether this device can use the Fullscreen API. */
export function fullscreenSupported(): boolean {
  const e = document.documentElement as FullscreenEl;
  return typeof e.requestFullscreen === 'function' || typeof e.webkitRequestFullscreen === 'function';
}

/**
 * Enters or leaves fullscreen.
 * @param onUnsupported - Called when fullscreen is not available (iOS Safari).
 */
export function toggleFullscreen(onUnsupported: () => void): void {
  const d = document as FullscreenDoc;
  if (isFullscreen()) {
    if (d.exitFullscreen) void d.exitFullscreen();
    else d.webkitExitFullscreen?.();
    return;
  }
  const root = document.documentElement as FullscreenEl;
  if (root.requestFullscreen) {
    void root
      .requestFullscreen({ navigationUI: 'hide' })
      // Landscape is kept when the phone is already held that way; in portrait the game is playable too, so it is not forced to turn.
      .then(() => (window.innerWidth > window.innerHeight ? (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape') : undefined))
      .catch(() => undefined);
  } else if (root.webkitRequestFullscreen) {
    root.webkitRequestFullscreen();
  } else {
    onUnsupported();
  }
}

/**
 * Tells whether the device has a touch screen as primary pointer. A laptop with
 * a touch screen and a mouse reports touch points but a fine, hovering pointer:
 * it keeps the desktop interface (the options can still force the touch one).
 */
export function isTouchDevice(): boolean {
  const matches = (query: string) => window.matchMedia(query).matches;
  return matches('(pointer: coarse)') || (matches('(hover: none)') && navigator.maxTouchPoints > 0);
}

/** On-screen controls. */
export class TouchControls {
  readonly element: HTMLDivElement;
  private readonly zone: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private stickPointer: number | null = null;
  /** Skill buttons in an arc around the Action button. */
  private readonly skillArc: HTMLDivElement;
  /** Hotbar page shown in the arc: 0 = slots 1 to 4, 1 = slots 5 to 8. */
  private page = 0;
  /** Last hotbar given (redrawn when the page changes). */
  private lastSkills: { entries: ({ icon: number; label: string; disabled?: boolean } | null)[]; onUse: (index: number) => void } | null = null;
  /** Last cooldowns given (all eight slots). */
  private lastCooldowns: number[] = [];
  private originX = 0;
  private originY = 0;
  /** Layout of the stick, read when a touch starts. */
  private zoneLeft = 0;
  private zoneTop = 0;
  private stickRadius = 60;
  /** Cooldown pies of the skill buttons shown, in order. */
  private cooldownNodes: HTMLElement[] = [];
  /** Options last applied (re-applied when the primary pointer changes). */
  private options: GameOptions | null = null;

  /**
   * @param layer - Container.
   * @param input - Input layer receiving the abstract actions.
   * @param callbacks - Menu and fullscreen handlers.
   */
  constructor(
    layer: HTMLElement,
    private readonly input: Input,
    callbacks: { onMenu: () => void; onFullscreen: () => void; onChat: () => void },
  ) {
    this.base = el('div', { className: 'stick-base' });
    this.knob = el('div', { className: 'stick-knob' });
    this.zone = localized(el('div', { className: 'stick-zone' }, [this.base, this.knob]), { label: 'touch.joystick' });
    const buttonA = localized(this.button('touch-a', t('touch.action'), 'action'), { title: 'touch.action', label: 'touch.action' });
    const buttonB = localized(this.button('touch-b', t('touch.cancel'), 'cancel'), { title: 'touch.cancel', label: 'touch.cancel' });
    // Tooltips do not exist on a touch screen: what A and B do is written under them.
    buttonA.append(localized(el('span', { className: 'touch-caption' }), { text: 'touch.action_caption' }));
    buttonB.append(localized(el('span', { className: 'touch-caption' }), { text: 'touch.cancel_caption' }));
    const top = el('div', { className: 'touch-top' }, [
      localized(el('button', { className: 'touch-small', attrs: { type: 'button' }, on: { click: callbacks.onChat } }, [icon('chat')]), { title: 'touch.chat', label: 'touch.chat' }),
      localized(el('button', { className: 'touch-small', attrs: { type: 'button' }, on: { click: callbacks.onMenu } }, [icon('menu')]), { title: 'touch.menu', label: 'touch.menu' }),
      localized(el('button', { className: 'touch-small', attrs: { type: 'button' }, on: { click: callbacks.onFullscreen } }, [icon('fullscreen')]), { title: 'touch.fullscreen', label: 'touch.fullscreen' }),
    ]);
    this.skillArc = el('div', { className: 'touch-skills' });
    this.element = el('div', { className: 'touch-controls' }, [this.zone, el('div', { className: 'touch-buttons' }, [buttonB, buttonA, this.skillArc]), top]);
    layer.append(this.element);
    this.bindStick();
    requestAnimationFrame(() => this.resetStick());
    window.addEventListener('resize', () => this.resetStick());
    document.addEventListener('fullscreenchange', () => this.refreshFullscreenIcon());
    // "Automatic" follows the device live (a convertible switched to tablet mode, an emulator).
    window.matchMedia('(pointer: coarse)').addEventListener('change', () => {
      if (this.options) this.apply(this.options);
    });
  }

  /**
   * Shows the first hotbar slots as round buttons around the Action button.
   * @param onUse - Called with the slot index.
   */
  setSkills(entries: ({ icon: number; label: string; disabled?: boolean } | null)[], onUse: (index: number) => void): void {
    this.lastSkills = { entries, onUse };
    const offset = this.page * ARC_SIZE;
    this.cooldownNodes = [];
    const buttons = entries.slice(offset, offset + ARC_SIZE).map((entry, i) => {
      const slot = offset + i;
      const cooldown = el('span', { className: 'touch-skill-cooldown' });
      this.cooldownNodes.push(cooldown);
      // An empty slot keeps its number: the player sees where the shortcuts of the Skills window go.
      const b = el('button', { className: `touch-skill arc-${i}${entry ? '' : ' empty'}${entry?.disabled ? ' disabled' : ''}`, title: entry?.label ?? '', attrs: entry ? { type: 'button', 'aria-label': `${entry.label} (${slot + 1})` } : { type: 'button', 'aria-hidden': 'true', tabindex: '-1' } }, [
        entry ? icon(entry.icon) : null,
        el('span', { className: 'touch-skill-key', text: String(slot + 1) }),
        cooldown,
      ]);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (!entry) return;
        navigator.vibrate?.(10);
        onUse(slot);
      });
      noGhostClick(b);
      return b;
    });
    // The hotbar has eight slots and the arc four: a small button shows the other four.
    const pages = Math.ceil(entries.length / ARC_SIZE);
    const pager = pages > 1
      ? el('button', { className: 'touch-skill-page', text: `${offset + 1}-${offset + ARC_SIZE}`, title: t('touch.skill_page'), attrs: { type: 'button', 'aria-label': t('touch.skill_page') } })
      : null;
    pager?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.page = (this.page + 1) % pages;
      navigator.vibrate?.(8);
      if (this.lastSkills) this.setSkills(this.lastSkills.entries, this.lastSkills.onUse);
      this.setCooldowns(this.lastCooldowns);
    });
    if (pager) noGhostClick(pager);
    this.skillArc.replaceChildren(...buttons, ...(pager ? [pager] : []));
  }

  /** Remaining cooldown of each skill button (0 = ready, 1 = just used), drawn as a closing pie. */
  setCooldowns(fractions: number[]): void {
    this.lastCooldowns = fractions;
    const offset = this.page * ARC_SIZE;
    // Called every frame: the pies are kept from their creation, not looked up in the page again.
    this.cooldownNodes.forEach((node, i) => {
      const f = fractions[offset + i] ?? 0;
      const value = f > 0 ? `conic-gradient(rgba(0,0,0,0.65) ${Math.round(f * 360)}deg, transparent 0)` : 'none';
      if (node.style.background !== value) node.style.background = value;
    });
  }

  private refreshFullscreenIcon(): void {
    const button = this.element.querySelector('.touch-top button:last-child');
    button?.replaceChildren(icon(isFullscreen() ? 'fullscreen_exit' : 'fullscreen'));
  }

  private button(className: string, label: string, action: 'action' | 'cancel'): HTMLButtonElement {
    const b = el('button', { className: `touch-button ${className}`, title: label, attrs: { type: 'button', 'aria-label': label } });
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.classList.add('pressed');
      this.input.press(action);
      if (action === 'cancel') this.input.press('menu');
      this.input.hold(action, true);
      navigator.vibrate?.(12);
    });
    const release = () => {
      b.classList.remove('pressed');
      this.input.hold(action, false);
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    noGhostClick(b);
    return b;
  }

  private bindStick(): void {
    // Only the stick itself reacts: a tap elsewhere goes through to the map (tap-to-move).
    this.base.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      e.preventDefault();
      this.stickPointer = e.pointerId;
      this.base.setPointerCapture(e.pointerId);
      // Fixed stick: the origin stays at the idle position, wherever the touch lands in the zone.
      const rest = this.restPosition();
      this.originX = rest.x;
      this.originY = rest.y;
      // The layout is read once per touch, not at every move (each read may force the page layout).
      const rect = this.zone.getBoundingClientRect();
      this.zoneLeft = rect.left;
      this.zoneTop = rect.top;
      this.stickRadius = this.base.offsetWidth / 2 || 60;
      this.zone.classList.add('active');
    });
    this.base.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointer) return;
      const radius = this.stickRadius;
      let dx = e.clientX - this.zoneLeft - this.originX;
      let dy = e.clientY - this.zoneTop - this.originY;
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx = (dx / len) * radius;
        dy = (dy / len) * radius;
      }
      this.placeStick(this.originX, this.originY, dx, dy);
      let dir: Direction | 0 = 0;
      if (len > radius * DEAD_ZONE) dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 6 : 4) : dy > 0 ? 2 : 8;
      this.input.touchDirection = dir;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.input.touchDirection = 0;
      this.zone.classList.remove('active');
      this.resetStick();
    };
    this.base.addEventListener('pointerup', end);
    this.base.addEventListener('pointercancel', end);
  }

  /** Idle position: bottom-left corner of the zone, clear of the screen edges. */
  private resetStick(): void {
    const { x, y } = this.restPosition();
    this.placeStick(x, y, 0, 0);
  }

  private restPosition(): { x: number; y: number } {
    const radius = (this.base.offsetWidth || 128) / 2;
    return { x: radius + 36, y: this.zone.clientHeight - radius - 36 };
  }

  private placeStick(x: number, y: number, dx: number, dy: number): void {
    this.base.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    this.knob.style.transform = `translate(${x + dx}px, ${y + dy}px) translate(-50%, -50%)`;
  }

  /** Applies visibility, size and opacity options. */
  apply(options: GameOptions): void {
    this.options = options;
    const visible = options.touchControls === 'on' || (options.touchControls === 'auto' && isTouchDevice());
    this.element.classList.toggle('hidden', !visible);
    document.body.classList.toggle('touch-mode', visible);
    this.element.style.setProperty('--control-scale', String(options.controlSize));
    this.element.style.setProperty('--control-opacity', String(options.controlOpacity));
    requestAnimationFrame(() => this.resetStick());
  }
}
