/**
 * @file Character rules shared by the creation form and the server, and the
 * character summary sent to the selection screen.
 */
import type { CharacterAppearance } from './art/character.js';
import { hasInvisible, mixesScripts } from './names.js';

/**
 * Character name: 3–16 characters, letters (any alphabet, accents allowed),
 * digits, spaces, apostrophes and hyphens, starting with a letter, no double
 * spaces, no character drawn as nothing (some count as letters), and not mixing
 * the Latin, Cyrillic and Greek alphabets (whose letters can look alike).
 * Uniqueness is checked on `nameKey` (see `names.ts`).
 */
export const CHARACTER_NAME_PATTERN = /^\p{L}(?:[\p{L}\p{N}'-]| (?! ))*$/u;
export const CHARACTER_NAME_MIN = 3;
export const CHARACTER_NAME_MAX = 16;

/**
 * Validates a character name.
 * @param name - Candidate (already trimmed and in NFC form).
 * @returns An error translation key, or `null` when valid.
 */
export function validateCharacterName(name: string): 'error.character.name_invalid' | 'error.character.name_mixed_scripts' | null {
  const length = [...name].length;
  if (length < CHARACTER_NAME_MIN || length > CHARACTER_NAME_MAX) return 'error.character.name_invalid';
  if (!CHARACTER_NAME_PATTERN.test(name) || name.endsWith(' ') || hasInvisible(name)) return 'error.character.name_invalid';
  if (mixesScripts(name)) return 'error.character.name_mixed_scripts';
  return null;
}

/** What the selection screen shows for each character. */
export interface CharacterSummary {
  id: number;
  name: string;
  classId: number;
  className: string;
  level: number;
  appearance: CharacterAppearance;
  lastPlayed: string | null;
  /** Gold carried. */
  gold: number;
  /** Map the character stands on. */
  mapId: number;
  /** Seconds played. */
  playTime: number;
}
