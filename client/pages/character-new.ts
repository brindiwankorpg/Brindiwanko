/**
 * @file Character creation page: keeps an animated preview in sync with the
 * form. Choosing a class applies its outfit (and its default look the first
 * time); the other fields change hair, skin and colours live. The server
 * re-validates everything on submit.
 */
import { HAIR_STYLES, sanitizeAppearance, type CharacterAppearance, type Outfit } from '../../shared/art/character.js';
import { drawFace } from '../../shared/art/face.js';
import { CharacterPreview, rasterize } from '../art/render.js';

const form = document.getElementById('create-form') as HTMLFormElement;
const canvas = document.getElementById('preview') as HTMLCanvasElement;

function selectedClass(): HTMLInputElement | null {
  return form.querySelector<HTMLInputElement>('input[name="classId"]:checked');
}

/** Reads the appearance currently described by the form. */
function readForm(): CharacterAppearance {
  const data = new FormData(form);
  const int = (name: string) => Number.parseInt(String(data.get(name) ?? ''), 10);
  const outfit = (selectedClass()?.dataset.outfit ?? 'warrior') as Outfit;
  return sanitizeAppearance(
    { body: data.get('body'), skin: int('skin'), hair: data.get('hair'), hairColor: int('hairColor'), outfit, outfitColor: int('outfitColor') },
    [outfit],
  );
}

/** Writes an appearance into the form controls. */
function writeForm(a: CharacterAppearance): void {
  const check = (name: string, value: string | number) => {
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  };
  check('body', a.body);
  check('skin', a.skin);
  check('hairColor', a.hairColor);
  check('outfitColor', a.outfitColor);
  (form.elements.namedItem('hair') as HTMLSelectElement).value = a.hair;
}

const preview = new CharacterPreview(canvas, readForm(), 3);
preview.start(200);

/**
 * One face per hairstyle, drawn with the colours chosen so far: a click picks it (the list stays for
 * keyboards). Redrawn when the skin, the hair colour or the body changes.
 */
const hairSelect = form.elements.namedItem('hair') as HTMLSelectElement;
const hairThumbs = document.getElementById('hair-thumbs');
function drawHairThumbs(): void {
  if (!hairThumbs) return;
  const look = readForm();
  hairThumbs.replaceChildren(
    ...[...hairSelect.options].map((option) => {
      const face = rasterize(drawFace({ ...look, hair: option.value as CharacterAppearance['hair'] }), 1);
      const chosen = option.value === hairSelect.value;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `hair-thumb${chosen ? ' selected' : ''}`;
      button.title = option.text;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(chosen));
      button.setAttribute('aria-label', option.text);
      button.append(face);
      button.addEventListener('click', () => {
        hairSelect.value = option.value;
        hairSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return button;
    }),
  );
}
/** Moves the highlight to the chosen hairstyle without rebuilding the buttons. */
function markHairThumb(): void {
  if (!hairThumbs) return;
  [...hairThumbs.children].forEach((button, i) => {
    const chosen = hairSelect.options[i]?.value === hairSelect.value;
    button.classList.toggle('selected', chosen);
    button.setAttribute('aria-checked', String(chosen));
  });
}
// Only the fields that change the faces rebuild them: rebuilding on every change (e.g. the name
// field losing focus on mousedown over a thumbnail) would swap the button under the cursor and
// swallow the click.
form.addEventListener('change', (event) => {
  const name = (event.target as HTMLInputElement).name;
  if (name === 'hair') markHairThumb();
  else if (name !== 'name') drawHairThumbs();
});
drawHairThumbs();

let touched = false;
form.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.name === 'classId' && !touched) {
    // Until the player customises something, show each class with its default look.
    try {
      writeForm(sanitizeAppearance(JSON.parse(target.dataset.appearance ?? '{}')));
    } catch {
      /* keep current values */
    }
  } else if (target.name !== 'classId' && target.name !== 'name') {
    touched = true;
  }
  preview.setAppearance(readForm());
});

document.getElementById('rotate-left')?.addEventListener('click', () => preview.rotate(-1));
document.getElementById('rotate-right')?.addEventListener('click', () => preview.rotate(1));
document.getElementById('randomize')?.addEventListener('click', () => {
  const pick = (name: string) => {
    const inputs = form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`);
    return inputs.length ? Number(inputs[Math.floor(Math.random() * inputs.length)]!.value) : 0;
  };
  touched = true;
  writeForm({
    body: Math.random() < 0.5 ? 'male' : 'female',
    skin: pick('skin'),
    hair: HAIR_STYLES[Math.floor(Math.random() * HAIR_STYLES.length)]!,
    hairColor: pick('hairColor'),
    outfit: readForm().outfit,
    outfitColor: pick('outfitColor'),
  });
  preview.setAppearance(readForm());
  drawHairThumbs();
});

// First load without posted values: start from the selected class's default look.
// (the error banner is outside the form: after a refused submit the chosen look is kept)
if (!document.querySelector('.form-error') && selectedClass()) {
  const cls = selectedClass()!;
  try {
    writeForm(sanitizeAppearance(JSON.parse(cls.dataset.appearance ?? '{}')));
    preview.setAppearance(readForm());
  } catch {
    /* ignore */
  }
}
