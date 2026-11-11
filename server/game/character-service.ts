/**
 * @file Character use-cases (list, create, delete, select), independent of
 * Express. New characters start at the position configured in the system
 * settings, with full HP/MP computed from their class at level 1.
 */
import { sanitizeAppearance, type CharacterAppearance } from '../../shared/art/character.js';
import { validateCharacterName, type CharacterSummary } from '../../shared/characters.js';
import { paramAt, type ClassData } from '../../shared/database.js';
import { DEFAULT_SETTINGS, type StartPosition } from '../../shared/settings.js';
import { CharacterCreationError, type Character, type CharacterRepository } from '../db/characters.js';
import type { GameDataRepository } from '../db/game-data.js';
import type { ProgressionRepository } from '../db/progression.js';
import type { SettingsRepository } from '../db/settings.js';
import type { InventoryService } from './inventory-service.js';

/** What gives a new character the starting items of its class. */
export interface StarterKitDeps {
  inventory: InventoryService;
  progression: ProgressionRepository;
}

/** Raw creation input from the form. */
export interface CharacterInput {
  name: string;
  classId: number;
  appearance: unknown;
}

/** Outcome of a use-case. */
export type CharacterResult = { ok: true; character: Character } | { ok: false; errorKey: string };

/** Character management. */
export class CharacterService {
  constructor(
    private readonly characters: CharacterRepository,
    private readonly data: GameDataRepository,
    private readonly settings: SettingsRepository,
    private readonly maxPerAccount: number,
    private readonly starter?: StarterKitDeps,
  ) {}

  /** Summaries shown on the selection screen. */
  list(accountId: number): CharacterSummary[] {
    return this.characters.listByAccount(accountId).map((c) => ({
      id: c.id,
      name: c.name,
      classId: c.classId,
      className: this.data.get('class', c.classId)?.name ?? '?',
      level: c.level,
      appearance: c.appearance,
      lastPlayed: c.lastPlayed,
      gold: c.gold,
      mapId: c.mapId,
      playTime: c.playTime,
    }));
  }

  /**
   * Where a character of a class starts: the place chosen for the class when it has one, otherwise the
   * start position of the System tab (the direction always comes from the System tab).
   */
  startFor(classId: number): StartPosition {
    const start = this.settings.get<StartPosition>('startPosition', DEFAULT_SETTINGS.startPosition);
    const own = this.data.get('class', classId)?.start;
    return own?.mode === 'custom' ? { mapId: own.mapId, x: own.x, y: own.y, direction: start.direction } : start;
  }

  /** Tells whether the account may create another character. */
  canCreate(accountId: number): boolean {
    return this.characters.countByAccount(accountId) < this.maxPerAccount;
  }

  /** Character limit per account. */
  get limit(): number {
    return this.maxPerAccount;
  }

  /**
   * Creates a character after validation. The outfit is imposed by the class;
   * other appearance fields are sanitised.
   * @param accountId - Owner.
   * @param input - Form values.
   */
  create(accountId: number, input: CharacterInput): CharacterResult {
    // Canonical form: an accent typed as a separate mark becomes the accented letter.
    const name = input.name.normalize('NFC').trim().replace(/\s+/g, ' ');
    const invalid = validateCharacterName(name);
    if (invalid) return { ok: false, errorKey: invalid };
    const cls = this.data.get('class', input.classId);
    if (!cls) return { ok: false, errorKey: 'error.character.class_invalid' };
    const appearance: CharacterAppearance = { ...sanitizeAppearance(input.appearance, [cls.outfit]), beard: false };
    const start = this.startFor(cls.id);
    try {
      const character = this.characters.create(
        {
          accountId,
          name,
          classId: cls.id,
          appearance,
          hp: paramAt(cls.params.mhp, 1),
          mp: paramAt(cls.params.mmp, 1),
          gold: this.settings.get('startingGold', DEFAULT_SETTINGS.startingGold),
          mapId: start.mapId,
          x: start.x,
          y: start.y,
          direction: start.direction,
        },
        this.maxPerAccount,
      );
      this.giveStarterKit(character.id, cls);
      return { ok: true, character };
    } catch (err) {
      if (err instanceof CharacterCreationError) return { ok: false, errorKey: err.key };
      throw err;
    }
  }

  /**
   * Puts the starting items of a class in the new character's bag, and wears the weapons and armors
   * marked so (the first one of each slot; deleted records are skipped).
   */
  private giveStarterKit(characterId: number, cls: ClassData): void {
    if (!this.starter) return;
    const { inventory, progression } = this.starter;
    const bagSize = this.settings.get('bagSize', DEFAULT_SETTINGS.bagSize);
    for (const entry of cls.startItems ?? []) {
      if (inventory.change(characterId, entry.kind, entry.id, entry.count) <= 0 || !entry.equip || entry.kind === 'item') continue;
      const slot = entry.kind === 'weapon' ? 'weapon' : this.data.get('armor', entry.id)?.slot;
      if (!slot || progression.equipment(characterId).has(slot)) continue;
      progression.equip(characterId, slot, { kind: entry.kind, id: entry.id }, { bagSize, maxOf: (kind, id) => inventory.maxOf(kind, id) });
    }
  }

  /**
   * Deletes a character; the owner must retype its exact name to confirm.
   * @param beforeDelete - Called once confirmed, before the row goes (guild succession).
   * @returns An error key, or `null` on success.
   */
  delete(accountId: number, characterId: number, confirmName: string, beforeDelete?: (character: { id: number; name: string }) => void): string | null {
    const character = this.characters.findById(characterId);
    if (!character || character.accountId !== accountId) return 'error.character.not_found';
    if (confirmName.trim() !== character.name) return 'error.character.delete_confirm';
    beforeDelete?.(character);
    this.characters.delete(characterId, accountId);
    return null;
  }

  /**
   * Returns a character only if it belongs to the account.
   * @param accountId - Account claiming the character.
   * @param characterId - Character id (untrusted).
   */
  owned(accountId: number, characterId: unknown): Character | undefined {
    if (!Number.isInteger(characterId)) return undefined;
    const character = this.characters.findById(characterId as number);
    return character?.accountId === accountId ? character : undefined;
  }
}
