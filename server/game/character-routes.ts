/**
 * @file Character selection and creation pages, and the game page.
 *
 * Flow: /characters (list) -> /characters/new (creation form with live
 * preview) -> POST /characters -> back to the list -> POST
 * /characters/:id/play stores the chosen character in the session and opens
 * /game, where the client connects through socket.io.
 */
import { Router, type Request, type Response } from 'express';
import { HAIR_STYLES, OUTFITS } from '../../shared/art/character.js';
import { HAIR_RAMPS, OUTFIT_RAMPS, SKIN_RAMPS } from '../../shared/art/palette.js';
import { paramAt, type ClassData, type ParamName } from '../../shared/database.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import { currentAccount, requireAuth } from '../auth/middleware.js';
import type { ServerContext } from '../context.js';
import { verifyCsrf } from '../http/csrf.js';
import { gamePreloads } from '../http/preload.js';

function field(req: Request, name: string): string {
  const value: unknown = (req.body as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : '';
}

/** Parses the appearance fields posted by the creation form. */
function appearanceFromForm(req: Request): Record<string, unknown> {
  const int = (name: string) => Number.parseInt(field(req, name), 10);
  return {
    body: field(req, 'body'),
    skin: int('skin'),
    hair: field(req, 'hair'),
    hairColor: int('hairColor'),
    outfitColor: int('outfitColor'),
  };
}

/** What a class is good at, for the creation page: three gauges (0 to 1) and the role they point to. */
export interface ClassProfile {
  attack: number;
  magic: number;
  survival: number;
  role: 'attack' | 'magic' | 'survival';
}

/** Level at which the classes are compared (their curves cross at low levels). */
const PROFILE_LEVEL = 10;

/**
 * Adds to each class its profile: physical attack, magic (attack and defence) and survival (HP and both
 * defences), each relative to the strongest class, so a newcomer sees at a glance what each one does.
 */
export function withProfiles<T extends ClassData>(classes: T[]): (T & { profile: ClassProfile })[] {
  const at = (c: ClassData, p: ParamName) => paramAt(c.params[p], PROFILE_LEVEL);
  const raw = classes.map((c) => ({
    attack: at(c, 'atk') + at(c, 'agi') / 2,
    magic: at(c, 'mat') + at(c, 'mmp') / 10,
    survival: at(c, 'mhp') / 10 + at(c, 'def') + at(c, 'mdf') / 2,
  }));
  const max = (k: 'attack' | 'magic' | 'survival') => Math.max(1, ...raw.map((r) => r[k]));
  return classes.map((c, i) => {
    const r = raw[i]!;
    const profile = { attack: r.attack / max('attack'), magic: r.magic / max('magic'), survival: r.survival / max('survival') };
    const role = (['attack', 'magic', 'survival'] as const).reduce((best, k) => (profile[k] > profile[best] ? k : best), 'attack' as ClassProfile['role']);
    return { ...c, profile: { ...profile, role } };
  });
}

/**
 * Creates the router of character pages.
 * @param ctx - Server context.
 */
export function characterRouter(ctx: ServerContext): Router {
  const router = Router();
  router.use(['/characters', '/game'], requireAuth);

  const renderList = (res: Response, errorKey: string | null = null, status = 200) => {
    const account = currentAccount(res)!;
    // Where each character stands, by the name players see on the map banner.
    const mapName = (id: number) => ctx.maps.peek(id)?.displayName || ctx.maps.info(id)?.name || '—';
    res.status(status).render('characters', {
      characters: ctx.characterService.list(account.id).map((c) => ({ ...c, mapName: mapName(c.mapId) })),
      currency: ctx.settings.get('currencyName', DEFAULT_SETTINGS.currencyName),
      canCreate: ctx.characterService.canCreate(account.id),
      limit: ctx.characterService.limit,
      errorKey,
    });
  };

  const renderCreate = (res: Response, errorKey: string | null, values: Record<string, unknown>, status = 200) => {
    res.status(status).render('character-new', {
      classes: withProfiles(ctx.gameData.list('class')),
      palettes: {
        skin: SKIN_RAMPS.slice(0, 4).map((r) => r[2]),
        hair: HAIR_RAMPS.map((r) => r[2]),
        outfit: OUTFIT_RAMPS.map((r) => r[2]),
      },
      hairStyles: HAIR_STYLES,
      outfits: OUTFITS,
      errorKey,
      values,
    });
  };

  router.get('/characters', (_req, res) => renderList(res));

  router.get('/characters/new', (_req, res) => {
    if (!ctx.characterService.canCreate(currentAccount(res)!.id)) {
      renderList(res, 'error.character.limit_reached', 400);
      return;
    }
    renderCreate(res, null, {});
  });

  // Also served at /characters/new so that a validation error keeps the form's own URL.
  router.post(['/characters', '/characters/new'], verifyCsrf, (req, res) => {
    const account = currentAccount(res)!;
    const values = { name: field(req, 'name'), classId: Number.parseInt(field(req, 'classId'), 10), ...appearanceFromForm(req) };
    const result = ctx.characterService.create(account.id, { name: values.name, classId: values.classId, appearance: values });
    if (!result.ok) {
      renderCreate(res, result.errorKey, values, 400);
      return;
    }
    res.redirect(303, '/characters');
  });

  router.post('/characters/:id/delete', verifyCsrf, (req, res) => {
    const id = Number(req.params.id);
    // A character in the world (another tab) is saved continuously: refuse (only for the owner:
    // the answer must not tell whether somebody else's character is online).
    if (ctx.characterService.owned(currentAccount(res)!.id, id) && ctx.world.player(id)) {
      renderList(res, 'error.character.online', 409);
      return;
    }
    const error = ctx.characterService.delete(currentAccount(res)!.id, id, field(req, 'confirmName'), (c) => ctx.world.guilds.characterDeleted(c.id, c.name));
    if (error) {
      renderList(res, error, 400);
      return;
    }
    res.redirect(303, '/characters');
  });

  router.post('/characters/:id/play', verifyCsrf, (req, res) => {
    const character = ctx.characterService.owned(currentAccount(res)!.id, Number(req.params.id));
    if (!character) {
      renderList(res, 'error.character.not_found', 404);
      return;
    }
    req.session.characterId = character.id;
    req.session.save(() => res.redirect(303, '/game'));
  });

  router.get('/game', (req, res) => {
    const character = ctx.characterService.owned(currentAccount(res)!.id, req.session.characterId);
    if (!character) {
      res.redirect(303, '/characters');
      return;
    }
    res.render('game', { characterName: character.name, preload: gamePreloads(ctx.config.production) });
  });

  return router;
}
