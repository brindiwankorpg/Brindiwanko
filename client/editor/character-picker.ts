/**
 * @file Appearance picker of the event editor: a theme drop-down (sheets grouped by name, e.g. Monster1,
 * Monster2... form "Monster") and, below, every character of every sheet of that theme. A click picks one.
 */
import type { AssetStore } from '../engine/assets.js';
import { sheetFlags } from '../engine/character.js';
import { t, tDynamic } from '../i18n.js';
import { el } from '../ui/dom.js';
import { openModal, select } from './dialogs.js';
import { drawEntry, spritePreview } from './sprite-preview.js';

/** A chosen appearance: sheet name ('' for none) and index (0-7). */
export interface CharacterChoice {
  name: string;
  index: number;
}

/** Theme of a sheet: its name without the `$` / `!` flags and the trailing number ("Monster12" → "Monster"). */
export function themeOf(sheet: string): string {
  return sheet.replace(/^[!$]+/, '').replace(/[\s_-]*\d+$/, '') || sheet;
}

/**
 * Readable name of a theme in the language of the interface ("Monster" → "Monstres"). A theme added by
 * the creators (an unknown file name) keeps its name.
 */
export function themeLabel(theme: string): string {
  const key = `editor.theme.${theme.toLowerCase()}`;
  const text = tDynamic(key);
  return text === key ? theme : text;
}

/**
 * Readable name of a sheet: its theme and number ("!Objects1" → "Objets animés 1", "Monster2" →
 * "Monstres 2"); a `$` sheet holds one big character instead of eight.
 */
export function sheetLabel(sheet: string): string {
  if (!sheet) return sheet;
  const number = /(\d+)$/.exec(sheet)?.[1];
  const single = /^[!$]*\$/.test(sheet);
  return `${themeLabel(themeOf(sheet))}${number ? ` ${number}` : ''}${single ? ` ${t('editor.sheet_single')}` : ''}`;
}

/**
 * Opens the picker.
 * @param host - Editor root element.
 * @param assets - Asset store.
 * @param sheets - Available character sheets.
 * @param current - Current appearance (its theme is shown first, its cell marked).
 * @returns The chosen appearance, or `null` when cancelled.
 */
export function pickCharacter(host: HTMLElement, assets: AssetStore, sheets: string[], current: CharacterChoice): Promise<CharacterChoice | null> {
  return pickSprite(host, assets, 'characters', sheets, current);
}

/** Same picker for faces or characters. */
export function pickSprite(host: HTMLElement, assets: AssetStore, kind: 'characters' | 'faces', sheets: string[], current: CharacterChoice): Promise<CharacterChoice | null> {
  const themes = [...new Set(sheets.map(themeOf))].sort((a, b) => themeLabel(a).localeCompare(themeLabel(b)));
  const startTheme = current.name ? themeOf(current.name) : (themes[0] ?? '');
  return new Promise((resolve) => {
    let result: CharacterChoice | null = null;
    const themeSelect = select(themes.map((th): [string, string] => [th, themeLabel(th)]), startTheme);
    const grid = el('div', { className: 'character-picker-grid' });
    let generation = 0;
    const render = () => {
      const run = ++generation;
      const theme = themeSelect.value;
      const list = sheets.filter((s) => themeOf(s) === theme);
      grid.replaceChildren();
      if (list.length === 0) {
        grid.append(el('p', { className: 'hint', text: t('editor.character_theme_empty') }));
        return;
      }
      for (const name of list) {
        const count = kind === 'characters' && sheetFlags(name).single ? 1 : 8;
        const cells = Array.from({ length: count }, (_, i) => {
          const canvas = el('canvas', { attrs: { width: '48', height: '48', 'aria-hidden': 'true' } });
          const button = el('button', { className: 'sprite-cell', title: `${sheetLabel(name)} #${i + 1}`, attrs: { type: 'button', 'aria-label': `${sheetLabel(name)} ${i + 1}` } }, [canvas]);
          button.classList.toggle('selected', name === current.name && i === current.index);
          button.addEventListener('click', () => {
            result = { name, index: i };
            close();
          });
          grid.append(button);
          return canvas;
        });
        void assets.image(kind, name).then((image) => {
          if (!image || run !== generation) return;
          cells.forEach((canvas, i) => drawEntry(canvas, image, kind, name, i));
        });
      }
    };
    themeSelect.addEventListener('change', render);
    const content = el('div', { className: 'character-picker' }, [
      el('label', { className: 'form-row' }, [el('span', { text: t('editor.character_theme') }), themeSelect]),
      grid,
    ]);
    const close = openModal(
      host,
      t(kind === 'faces' ? 'editor.face_pick' : 'editor.character_pick'),
      content,
      [
        { label: t('editor.none'), onClick: () => void (result = { name: '', index: 0 }) },
        { label: t('common.cancel') },
      ],
      '',
      undefined,
      () => resolve(result),
    );
    render();
  });
}


/**
 * A preview button standing for a sheet control and an index field (kept, hidden by the caller): a click opens
 * the picker and writes the choice into both controls, firing their `input` / `change` events.
 */
export function spritePickerButton(assets: AssetStore, kind: 'characters' | 'faces', sheets: string[], sheet: HTMLSelectElement | HTMLInputElement, index: HTMLInputElement): { element: HTMLButtonElement; refresh(): void } {
  const preview = spritePreview(assets, kind, () => sheet.value, () => Number(index.value) || 0);
  const label = t(kind === 'faces' ? 'editor.face_pick' : 'editor.character_pick');
  const element = el('button', { className: 'sprite-pick-button', title: label, attrs: { type: 'button', 'aria-label': label } }, [preview.element]);
  const fire = (control: HTMLElement) => {
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  };
  element.addEventListener('click', async () => {
    // The picker opens over the dialog holding the button.
    const host = element.closest('.modal-backdrop')?.parentElement ?? document.body;
    const choice = await pickSprite(host, assets, kind, sheets, { name: sheet.value, index: Number(index.value) || 0 });
    if (!choice) return;
    sheet.value = choice.name;
    fire(sheet);
    index.value = String(choice.index);
    fire(index);
    preview.refresh();
  });
  sheet.addEventListener('change', preview.refresh);
  index.addEventListener('input', preview.refresh);
  return { element, refresh: preview.refresh };
}