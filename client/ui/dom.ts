/**
 * @file Small DOM helpers for the interface. Text is always set through
 * `textContent`, never `innerHTML`, so names and messages written by players
 * or creators cannot inject markup.
 */
import { ICON_COLUMNS, iconIndex, type IconName } from '../../shared/icons.js';
import type { TranslationKey } from '../../shared/i18n.js';
import { tDynamic } from '../i18n.js';

/** Attributes accepted by `el()`. */
export interface ElementProps {
  className?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
}

/**
 * Creates an element.
 * @param tag - Tag name.
 * @param props - Class, text, attributes and listeners.
 * @param children - Child nodes.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: (Node | null | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const [type, fn] of Object.entries(props.on ?? {})) node.addEventListener(type, fn as EventListener);
  for (const child of children) if (child) node.append(child);
  return node;
}

/** Translation keys of an element's texts, kept on the element so that a language switch can redo them. */
export interface LocalizedProps {
  /** Text content. */
  text?: TranslationKey;
  /** Tooltip. */
  title?: TranslationKey;
  /** Accessible name (`aria-label`). */
  label?: TranslationKey;
  /** Placeholder of a field. */
  placeholder?: TranslationKey;
}

const LOCALIZED = { text: 'data-i18n-text', title: 'data-i18n-title', label: 'data-i18n-label', placeholder: 'data-i18n-placeholder' } as const;

/** Applies the translation of a `data-i18n-*` attribute to its element. */
function applyLocalized(node: Element, what: keyof LocalizedProps): void {
  const key = node.getAttribute(LOCALIZED[what]);
  if (!key) return;
  const value = tDynamic(key);
  if (what === 'text') node.textContent = value;
  else if (what === 'title') (node as HTMLElement).title = value;
  else if (what === 'label') node.setAttribute('aria-label', value);
  else (node as HTMLInputElement).placeholder = value;
}

/**
 * Marks an element's texts as translated from keys: they are set now and set again by {@link retranslate}
 * when the language changes (static labels, tooltips and accessible names are not rebuilt by the interface).
 */
export function localized<T extends Element>(node: T, keys: LocalizedProps): T {
  for (const what of Object.keys(keys) as (keyof LocalizedProps)[]) {
    node.setAttribute(LOCALIZED[what], keys[what]!);
    applyLocalized(node, what);
  }
  return node;
}

/** Translates again every element marked with {@link localized} (after a language switch). */
export function retranslate(root: ParentNode = document): void {
  for (const what of Object.keys(LOCALIZED) as (keyof LocalizedProps)[]) {
    for (const node of root.querySelectorAll(`[${LOCALIZED[what]}]`)) applyLocalized(node, what);
  }
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/** Named text fields of an element (those a rebuild keeps). */
const namedFields = (root: HTMLElement) => [...root.querySelectorAll<Field>('input[name], textarea[name]')].filter((f) => f.type !== 'checkbox' && f.type !== 'radio');

/**
 * Rebuilds the content of a window updated live (party, guild, friends, bank...) without losing what the
 * player is typing: the named fields (`name` attribute) the player changed keep their text, and the one
 * with the focus keeps it, with its cursor. A field the player did not touch shows its new value.
 * @param root - Element whose content is rebuilt.
 * @param rebuild - Replaces the content.
 */
export function rebuildKeepingInput(root: HTMLElement, rebuild: () => void): void {
  const typed = new Map<string, string>();
  for (const f of namedFields(root)) if (f.value !== (f.dataset.shown ?? f.defaultValue)) typed.set(f.name, f.value);
  const active = document.activeElement;
  const focused = (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && active.name && root.contains(active) ? active : null;
  const selection = focused ? { start: safe(() => focused.selectionStart), end: safe(() => focused.selectionEnd) } : null;
  if (focused) typed.set(focused.name, focused.value);
  rebuild();
  for (const f of namedFields(root)) {
    f.dataset.shown = f.value;
    const value = typed.get(f.name);
    if (value !== undefined) f.value = value;
    if (focused && f.name === focused.name) {
      f.focus();
      if (selection?.start != null && selection.end != null) safe(() => f.setSelectionRange(selection.start!, selection.end!));
    }
  }
}

/**
 * Marks what a field holds as sent (its button was used): the next {@link rebuildKeepingInput} shows the
 * field's new value instead of keeping the text already sent.
 */
export function sent<F extends Field>(field: F): F {
  field.dataset.shown = field.value;
  return field;
}

/** Runs a field access that some input types refuse (selection of a number field). */
function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/**
 * Creates an icon element showing one cell of the icon sheet.
 * @param icon - Icon name or index.
 */
export function icon(icon: IconName | number): HTMLSpanElement {
  const index = typeof icon === 'number' ? icon : iconIndex(icon);
  const span = el('span', { className: 'icon', attrs: { 'aria-hidden': 'true' } });
  span.style.setProperty('--ix', String(index % ICON_COLUMNS));
  span.style.setProperty('--iy', String(Math.floor(index / ICON_COLUMNS)));
  return span;
}

/** A gauge (HP/MP/XP bar) with a label and value text. */
export class Gauge {
  readonly element: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly value: HTMLSpanElement;

  /**
   * @param label - Short label (e.g. "PV").
   * @param kind - CSS modifier: `hp`, `mp` or `xp`.
   */
  constructor(label: string, kind: 'hp' | 'mp' | 'xp') {
    this.fill = el('div', { className: 'gauge-fill' });
    this.value = el('span', { className: 'gauge-value' });
    this.element = el('div', { className: `gauge gauge-${kind}` }, [
      el('span', { className: 'gauge-label', text: label }),
      el('div', { className: 'gauge-track' }, [this.fill]),
      this.value,
    ]);
  }

  /** Updates the bar. */
  set(current: number, max: number, showValue = true): void {
    const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    this.fill.style.width = `${ratio * 100}%`;
    this.value.textContent = showValue ? `${current}/${max}` : '';
  }

  /**
   * Changes the label (language switch).
   * @param full - Whole name shown on hover, when the label is a short form of it.
   */
  setLabel(label: string, full = label): void {
    const node = this.element.querySelector<HTMLElement>('.gauge-label')!;
    node.textContent = label;
    node.title = full === label ? '' : full;
  }
}
