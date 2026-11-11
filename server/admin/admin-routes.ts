/**
 * @file JSON API of the administration panel (mounted under `/api/admin`).
 *
 * Moderators may read the dashboard, the accounts and the logs, kick players,
 * mute them and ban them for up to 7 days; they see e-mail addresses masked
 * and no IP address. Administrators may also change roles, ban for longer or
 * for good, reset passwords, use the game tools (teleport, invisibility, give
 * items and gold, change switches and variables, announcements), download
 * or restore database backups, and set the daily automatic backups. Nobody but the server owner (the first
 * account) may change the owner's role or password.
 * Every action is checked here and written to the administrator log.
 * Writes need the `X-CSRF-Token` header.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import os from 'node:os';
import express, { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { isPassable } from '../../shared/passability.js';
import { ANNOUNCE_MODES, type AccountRole, type AnnounceMode } from '../../shared/protocol.js';
import { hasRole, isRole } from '../../shared/roles.js';
import { currentAccount, requireRoleApi } from '../auth/middleware.js';
import type { ServerContext } from '../context.js';
import { LOG_TYPES, sqlDate, type LogLine, type LogType } from '../db/admin.js';
import { verifyCsrfHeader } from '../http/csrf.js';
import { MAX_BAN_MINUTES, MAX_MUTE_MINUTES, MAX_REASON_LENGTH, Moderation, type SanctionResult } from './moderation.js';
import { backupsDirOf, dataDirOf, restorePathOf } from '../paths.js';
import { backupTime, inspectBackup, listBackups, prepareRestore, SQLITE_HEADER, stripSecrets, uploadsRestorePathOf } from '../db/backups.js';
import { BACKUP_KEEP_CHOICES, backupScheduleOf, DEFAULT_BACKUP_SCHEDULE, DEFAULT_SETTINGS } from '../../shared/settings.js';

const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
/** Largest backup accepted by a restoration (the reverse proxy must let it through: see the README). */
export const MAX_RESTORE_BYTES = '500mb';
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Password typed again to confirm the restoration of an uploaded file. The body holds the file, so it comes in
 * the `X-Confirm-Password` header, URI-encoded: a header only carries Latin-1 text, a password may hold any character.
 */
function confirmedPassword(req: Request): string {
  try {
    return decodeURIComponent(req.get('x-confirm-password') ?? '');
  } catch {
    return '';
  }
}

function fail(res: Response, status: number, error: string, params?: Record<string, string | number>): void {
  res.status(status).json({ error, params });
}

/**
 * Creates the administration API router.
 * @param ctx - Server context.
 */
export function adminRouter(ctx: ServerContext): Router {
  const router = Router();
  router.use(requireRoleApi('moderator'));
  router.use(express.json({ limit: '1mb' }));
  router.use(verifyCsrfHeader);
  const me = (res: Response) => currentAccount(res)!;
  const isAdmin = (res: Response) => hasRole(me(res).role, 'admin');
  const adminOnly = (req: Request, res: Response, next: () => void) => (isAdmin(res) ? next() : fail(res, 403, 'error.http.forbidden'));
  const log = (res: Response, action: string, target: string, details: Record<string, unknown> = {}) => ctx.admin.logAdmin(me(res).id, action, target, details);
  const world = ctx.world;
  let lastCpu = process.cpuUsage();
  let lastCpuAt = Date.now();

  // --- Dashboard -----------------------------------------------------------------

  router.get('/dashboard', (_req, res) => {
    const cpu = process.cpuUsage(lastCpu);
    const elapsed = Math.max(1, Date.now() - lastCpuAt) * 1000;
    lastCpu = process.cpuUsage();
    lastCpuAt = Date.now();
    const players = [...world.allPlayers()].filter((p) => world.isLive(p));
    const maps = new Map<string, { mapId: number; instance: number; name: string; players: number }>();
    for (const p of players) {
      const key = `${p.mapId}:${p.instance}`;
      const entry = maps.get(key) ?? { mapId: p.mapId, instance: p.instance, name: world.mapRuntime(p.mapId)?.map.displayName ?? '?', players: 0 };
      entry.players++;
      maps.set(key, entry);
    }
    const memory = process.memoryUsage();
    res.json({
      players: players.map((p) => ({ id: p.characterId, accountId: p.accountId, name: p.name, level: p.level, mapId: p.mapId, instance: p.instance, x: p.x, y: p.y, invisible: p.invisible === true })),
      maps: [...maps.values()],
      instances: world.instances.list().map((i) => ({ id: i.id, mapId: i.mapId, owner: i.owner, players: world.instances.players(i).length, bossDefeated: i.bossDefeated })),
      server: {
        uptime: Math.round(process.uptime()),
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        cpu: Math.round(((cpu.user + cpu.system) / elapsed) * 100),
        lag: world.eventLoopLag,
        load: os.loadavg()[0],
        node: process.version,
        accounts: ctx.accounts.count(),
      },
    });
  });

  // --- Accounts -----------------------------------------------------------------------

  const itemName = (kind: unknown, id: unknown) =>
    (kind === 'item' || kind === 'weapon' || kind === 'armor') && typeof id === 'number' ? `${ctx.gameData.get(kind, id)?.name ?? '?'} (#${id})` : '?';
  /** Items of a trade, stored as JSON: "Potion (#1) ×2, Élixir (#3) ×1". */
  const tradeItems = (json: unknown): string => {
    try {
      const items = JSON.parse(String(json)) as { kind?: unknown; id?: unknown; quantity?: unknown }[];
      return Array.isArray(items) ? items.map((it) => `${itemName(it.kind, it.id)} ×${Number(it.quantity) || 0}`).join(', ') : '';
    } catch {
      return String(json);
    }
  };
  /** Name of a declared switch or variable (numbered from 1 in the order of the System tab). */
  const declaredName = (key: 'switches' | 'variables', id: unknown): string | undefined =>
    typeof id === 'number' ? ctx.settings.get(key, DEFAULT_SETTINGS[key])[id - 1]?.name || undefined : undefined;
  /**
   * Details of an administration line, stored as JSON: given back as an object, with the names of the
   * numbers it holds (map, object, switch, variable, enemy, character), for the panel to say it in words.
   */
  const detailsWithNames = (json: string): Record<string, unknown> | string => {
    let d: unknown;
    try {
      d = JSON.parse(json);
    } catch {
      return json;
    }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return json;
    const out: Record<string, unknown> = { ...(d as Record<string, unknown>) };
    if (typeof out.mapId === 'number') out.mapName = ctx.maps.infos().find((m) => m.id === out.mapId)?.name;
    if (typeof out.id === 'number' && typeof out.kind === 'string') out.itemName = itemName(out.kind, out.id);
    if (typeof out.switchId === 'number') out.switchName = declaredName('switches', out.switchId);
    if (typeof out.variableId === 'number') out.variableName = declaredName('variables', out.variableId);
    if (typeof out.enemyId === 'number') out.enemyName = ctx.gameData.get('enemy', out.enemyId)?.name;
    return out;
  };
  /**
   * Logs store numbers: the panel shows names. Sales, drops and trades: objects and enemies ("Potion (#1)").
   * Administration: the target account or character by its name (with its account, to open it) instead of
   * "character:15", and the details as an object with names.
   */
  const withNames = (line: LogLine): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...line };
    const kind = out.kind;
    if (typeof out.item === 'number' && (kind === 'item' || kind === 'weapon' || kind === 'armor')) out.item = itemName(kind, out.item);
    if (typeof out.enemy === 'number') out.enemy = `${ctx.gameData.get('enemy', out.enemy)?.name ?? '?'} (#${out.enemy})`;
    for (const key of ['aItems', 'bItems'] as const) if (typeof out[key] === 'string') out[key] = tradeItems(out[key]);
    if (typeof out.details === 'string') out.details = detailsWithNames(out.details);
    const target = typeof out.target === 'string' && out.admin !== undefined ? /^(account|character):(\d+)$/.exec(out.target) : null;
    if (target) {
      const id = Number(target[2]);
      const found = target[1] === 'account' ? ctx.accounts.findById(id) : ctx.characters.findById(id);
      if (found) {
        out.target = 'username' in found ? found.username : found.name;
        out.targetAccount = 'username' in found ? found.id : found.accountId;
      }
    }
    return out;
  };
  /** Moderators see e-mail addresses masked and no IP address (personal data). */
  const forViewer = <T extends object>(res: Response, row: T): T => {
    if (isAdmin(res)) return row;
    const out = { ...row } as Record<string, unknown>;
    if (typeof out.email === 'string') out.email = maskEmail(out.email);
    delete out.ip;
    return out as T;
  };
  /** The server owner's role and password are out of reach of the other administrators. */
  const ownerProtected = (res: Response, id: number) => id === ctx.accounts.ownerId() && id !== me(res).id;

  router.get('/accounts', (req, res) => {
    // Moderators do not search in the e-mail addresses they cannot see (an address could be guessed piece by piece).
    res.json({ accounts: ctx.admin.searchAccounts(text(req.query.q, 60), 50, isAdmin(res)).map((a) => forViewer(res, a)) });
  });

  router.get('/accounts/:id', (req, res) => {
    const id = Number(req.params.id);
    const account = ctx.admin.account(id);
    if (!account) return fail(res, 404, 'error.admin.not_found');
    const characters = ctx.characters.listByAccount(id).map((c) => ({ id: c.id, name: c.name, level: c.level, mapId: c.mapId, x: c.x, y: c.y, gold: c.gold, online: !!world.player(c.id) }));
    const logs = Object.fromEntries(LOG_TYPES.map((t) => [t, ctx.admin.logs(t, id, 50).map((line) => forViewer(res, withNames(line)))]));
    res.json({ account: forViewer(res, account), characters, logs, currency: world.currencyName() });
  });

  router.post('/accounts/:id/role', adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const role = (req.body as { role?: unknown }).role;
    if (!isRole(role) || !ctx.admin.account(id)) return fail(res, 400, 'error.admin.invalid');
    if (id === me(res).id) return fail(res, 400, 'error.admin.self');
    if (ownerProtected(res, id)) return fail(res, 403, 'error.admin.owner');
    ctx.admin.setRole(id, role as AccountRole);
    world.setAccountRole(id, role as AccountRole);
    log(res, 'role', `account:${id}`, { role });
    res.json({ ok: true });
  });

  // Sanctions: the rules live in `Moderation`, shared with the chat commands of the staff.
  const moderation = new Moderation(ctx);
  const actor = (res: Response) => ({ id: me(res).id, role: me(res).role });
  const reply = (res: Response, result: SanctionResult) => (result.ok ? res.json({ ok: true, until: result.until }) : fail(res, result.status, result.error));

  router.post('/accounts/:id/ban', (req, res) => {
    const body = req.body as { minutes?: unknown; permanent?: unknown; reason?: unknown };
    const minutes = body.permanent === true ? 'permanent' : isInt(body.minutes, 1, MAX_BAN_MINUTES) ? body.minutes : NaN;
    reply(res, moderation.ban(actor(res), Number(req.params.id), minutes, text(body.reason, MAX_REASON_LENGTH)));
  });

  router.post('/accounts/:id/unban', (req, res) => {
    reply(res, moderation.unban(actor(res), Number(req.params.id)));
  });

  router.post('/accounts/:id/mute', (req, res) => {
    const body = req.body as { minutes?: unknown; reason?: unknown };
    const minutes = isInt(body.minutes, 1, MAX_MUTE_MINUTES) ? body.minutes : NaN;
    reply(res, moderation.mute(actor(res), Number(req.params.id), minutes, text(body.reason, MAX_REASON_LENGTH)));
  });

  router.post('/accounts/:id/unmute', (req, res) => {
    reply(res, moderation.unmute(actor(res), Number(req.params.id)));
  });

  router.post('/accounts/:id/kick', (req, res) => {
    reply(res, moderation.kick(actor(res), Number(req.params.id), text((req.body as { reason?: unknown }).reason, MAX_REASON_LENGTH)));
  });

  /** Gives the account a new random password, shown once to the administrator. */
  router.post('/accounts/:id/reset-password', adminOnly, async (req, res) => {
    const id = Number(req.params.id);
    if (!ctx.admin.account(id)) return fail(res, 404, 'error.admin.not_found');
    if (ownerProtected(res, id)) return fail(res, 403, 'error.admin.owner');
    const password = randomBytes(9).toString('base64url');
    ctx.admin.setPasswordHash(id, await bcrypt.hash(password, ctx.config.production ? 11 : 4));
    // Whoever knew the old password is logged out of the site too (the caller keeps its own session).
    ctx.sessionStore.destroyAccountSessions(id, id === me(res).id ? req.sessionID : '');
    world.kickAccount(id, 'error.net.kicked');
    log(res, 'reset_password', `account:${id}`);
    res.json({ ok: true, password });
  });

  /** Sends a character (offline or online) back to the start position. */
  router.post('/characters/:id/reset-position', (req, res) => {
    const id = Number(req.params.id);
    const character = ctx.characters.findById(id);
    if (!character) return fail(res, 404, 'error.admin.not_found');
    // Same rank rule as the sanctions: only characters of lower ranks (or one's own).
    const owner = ctx.admin.account(character.accountId);
    if (owner && owner.id !== me(res).id && hasRole(owner.role, me(res).role)) return fail(res, 403, 'error.admin.rank');
    const start = world.startPosition(character.classId);
    const online = world.player(id);
    if (online) world.transfer(online, start.mapId, start.x, start.y, start.direction);
    else ctx.characters.saveStates([[id, { mapId: start.mapId, x: start.x, y: start.y, direction: start.direction, hp: character.hp, mp: character.mp, playTimeDelta: 0 }]]);
    log(res, 'reset_position', `character:${id}`);
    res.json({ ok: true });
  });

  // --- Game tools (administrators) ------------------------------------------------------

  const online = (res: Response, id: unknown) => {
    const p = isInt(id, 1, Number.MAX_SAFE_INTEGER) ? world.player(id) : undefined;
    if (!p || !world.isLive(p)) fail(res, 404, 'error.admin.offline');
    return p && world.isLive(p) ? p : undefined;
  };
  /** The administrator's own character in game. */
  const self = (res: Response) => [...world.allPlayers()].find((p) => p.accountId === me(res).id && world.isLive(p));

  /** The online character a tool targets (`'self'`: the administrator's own); answers 404 when there is none. */
  const resolveTarget = (res: Response, id: unknown) => {
    const p = id === 'self' ? self(res) : online(res, id);
    if (!p && !res.headersSent) fail(res, 404, 'error.admin.offline');
    return p;
  };

  /** Names to pick from in the tools (maps, the three kinds of objects, the declared switches and variables). */
  router.get('/tools/lookups', adminOnly, (_req, res) => {
    const named = (type: 'item' | 'weapon' | 'armor') => ctx.gameData.list(type).map((r) => ({ id: r.id, name: r.name }));
    // Switches and variables are numbered from 1 in the order of the System tab.
    const declared = (key: 'switches' | 'variables') => ctx.settings.get(key, DEFAULT_SETTINGS[key]).map((d, i) => ({ id: i + 1, name: d.name, global: d.global }));
    res.json({
      maps: ctx.maps.infos().map((m) => ({ id: m.id, name: m.name })),
      item: named('item'),
      weapon: named('weapon'),
      armor: named('armor'),
      switches: declared('switches'),
      variables: declared('variables'),
    });
  });

  /**
   * Cells of a map where a character may stand (a step is possible in at least one direction), for the
   * teleport tool: the administrator picks the destination on a drawing of the map instead of typing X and Y.
   * `cells` holds one character per cell, row after row: `1` walkable, `0` blocked.
   */
  router.get('/tools/maps/:id/grid', adminOnly, (req, res) => {
    const map = ctx.maps.peek(Number(req.params.id));
    if (!map) return fail(res, 404, 'error.editor.map_not_found');
    const flags = ctx.gameData.get('tileset', map.tilesetId)?.flags ?? [];
    let cells = '';
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) cells += [2, 4, 6, 8].some((d) => isPassable(map, flags, x, y, d)) ? '1' : '0';
    }
    res.json({ width: map.width, height: map.height, cells });
  });

  router.post('/tools/teleport', adminOnly, (req, res) => {
    const body = req.body as { characterId?: unknown; mapId?: unknown; x?: unknown; y?: unknown; toCharacterId?: unknown };
    const target = body.characterId === 'self' ? self(res) : online(res, body.characterId);
    if (!target) {
      if (!res.headersSent) fail(res, 404, 'error.admin.offline');
      return;
    }
    let dest: { mapId: number; x: number; y: number; instance?: number } | undefined;
    if (body.toCharacterId !== undefined) {
      const to = body.toCharacterId === 'self' ? self(res) : online(res, body.toCharacterId);
      if (!to) {
        if (!res.headersSent) fail(res, 404, 'error.admin.offline');
        return;
      }
      // Into the very instance (dungeon copy) of that player, not the administrator's own.
      dest = { mapId: to.mapId, x: to.x, y: to.y, ...(to.instance ? { instance: to.instance } : {}) };
    } else if (isInt(body.mapId, 1, 1_000_000) && isInt(body.x, 0, 255) && isInt(body.y, 0, 255)) {
      dest = { mapId: body.mapId, x: body.x, y: body.y };
    }
    if (!dest || !world.transfer(target, dest.mapId, dest.x, dest.y, 2, 0, dest.instance)) return fail(res, 400, 'error.admin.invalid');
    log(res, 'teleport', `character:${target.characterId}`, dest);
    res.json({ ok: true });
  });

  router.post('/tools/invisible', adminOnly, (req, res) => {
    const p = self(res);
    if (!p) return fail(res, 404, 'error.admin.offline');
    world.setInvisible(p, (req.body as { on?: unknown }).on === true);
    log(res, 'invisible', `character:${p.characterId}`, { on: p.invisible });
    res.json({ ok: true, invisible: p.invisible });
  });

  router.post('/tools/give', adminOnly, (req, res) => {
    const body = req.body as { characterId?: unknown; kind?: unknown; id?: unknown; quantity?: unknown; gold?: unknown; exp?: unknown };
    const p = resolveTarget(res, body.characterId);
    if (!p) return;
    // Experience (to test content for higher levels): level-ups are handled like for any other gain.
    if (isInt(body.exp, 1, 99_999_999)) {
      p.socket.emit('notify', { key: 'notify.exp_gained', params: { amount: body.exp } });
      world.runner.setExp(p, p.xp + body.exp, true);
    }
    if (isInt(body.gold, -999_999_999, 999_999_999) && body.gold !== 0) world.changeGold(p, body.gold);
    if ((body.kind === 'item' || body.kind === 'weapon' || body.kind === 'armor') && isInt(body.id, 1, 9999) && isInt(body.quantity, -999, 999) && body.quantity !== 0) {
      world.changeItems(p, body.kind, body.id, body.quantity);
    }
    log(res, 'give', `character:${p.characterId}`, { kind: body.kind, id: body.id, quantity: body.quantity, gold: body.gold, exp: body.exp });
    res.json({ ok: true });
  });

  router.post('/tools/progress', adminOnly, (req, res) => {
    const body = req.body as { characterId?: unknown; switchId?: unknown; switchValue?: unknown; variableId?: unknown; variableValue?: unknown };
    const p = resolveTarget(res, body.characterId);
    if (!p) return;
    if (isInt(body.switchId, 1, 9999) && typeof body.switchValue === 'boolean') world.setSwitch(p, body.switchId, body.switchValue);
    if (isInt(body.variableId, 1, 9999) && isInt(body.variableValue, -99_999_999, 99_999_999)) world.setVariable(p, body.variableId, body.variableValue);
    log(res, 'progress', `character:${p.characterId}`, body as Record<string, unknown>);
    res.json({ ok: true, switches: [...p.progress.switches], variables: Object.fromEntries(p.progress.variables) });
  });

  router.post('/tools/announce', adminOnly, (req, res) => {
    const body = req.body as { text?: unknown; mode?: unknown };
    const message = text(body.text, 300);
    const mode = body.mode === undefined ? 'banner' : (ANNOUNCE_MODES as readonly unknown[]).includes(body.mode) ? (body.mode as AnnounceMode) : null;
    if (!message || !mode) return fail(res, 400, 'error.admin.invalid');
    world.announce(message, mode);
    log(res, 'announce', 'server', { text: message, mode });
    res.json({ ok: true });
  });

  // --- Logs ----------------------------------------------------------------------------

  router.get('/logs/:type', (req, res) => {
    const type = req.params.type as LogType;
    if (!LOG_TYPES.includes(type)) return fail(res, 404, 'error.admin.not_found');
    // The account is named by its number, or by the name of the account or of one of its characters.
    const name = text(req.query.name, 40);
    let accountId = Math.trunc(Number(req.query.account ?? 0)) || 0;
    if (name) {
      const found = ctx.accounts.findByUsername(name)?.id ?? ctx.characters.findByName(name)?.accountId;
      if (found === undefined) return res.json({ lines: [] });
      accountId = found;
    }
    // A whole number from 1 to 500: SQLite reads a negative limit as "no limit" and refuses a fraction.
    const limit = Math.min(500, Math.max(1, Math.trunc(Number(req.query.limit ?? 100)) || 100));
    // Next page: the lines older than `before` (a line number). Span of time: SQLite dates in UTC ("2026-11-07 00:00:00").
    const before = Math.trunc(Number(req.query.before ?? 0)) || 0;
    const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? v : undefined);
    const lines = ctx.admin.logs(type, accountId, limit, { before: before > 0 ? before : undefined, from: date(req.query.from), to: date(req.query.to) });
    res.json({ lines: lines.map((line) => forViewer(res, withNames(line))) });
  });

  // --- Backups (administrators) ------------------------------------------------------------

  /**
   * Downloads a consistent copy of the database, without what must never leave
   * the server: open sessions and server secrets (whoever got the file could
   * otherwise act as any logged-in player). Restoring such a copy logs everybody
   * out and creates new secrets.
   */
  router.get('/backup', adminOnly, async (_req, res) => {
    const dir = dataDirOf(ctx.config.dbPath);
    const file = join(dir, `backup-${Date.now()}.db`);
    const cleanUp = () => {
      for (const suffix of ['', '-journal', '-wal', '-shm']) if (existsSync(file + suffix)) unlinkSync(file + suffix);
    };
    try {
      mkdirSync(dir, { recursive: true });
      await ctx.db.backup(file);
      stripSecrets(file);
      log(res, 'backup', 'server');
      res.download(file, `brindiwanko-${sqlDate(Date.now()).replace(/[: ]/g, '-')}.db`, cleanUp);
    } catch (err) {
      cleanUp();
      throw err;
    }
  });

  /**
   * Receives a backup to restore: it is checked (SQLite file with the schema of
   * this engine) and replaces the database at the next start of the server.
   * The administrator's password is asked again, as for a backup of the server: this replaces the whole game.
   */
  // One restoration at a time (a double click, two administrators): the second must not replace or delete
  // the file the first one is checking.
  let restoring = false;
  router.post('/restore', adminOnly, express.raw({ type: '*/*', limit: MAX_RESTORE_BYTES }), async (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.subarray(0, 16).toString('latin1') !== SQLITE_HEADER) return fail(res, 400, 'error.admin.invalid_backup');
    const refused = await ctx.auth.verifyPassword(me(res).id, confirmedPassword(req));
    if (refused) return fail(res, refused.errorKey === 'error.auth.too_many_attempts' ? 429 : 403, refused.errorKey, refused.params);
    // Checked after the password, and set below with no wait in between: two uploads cannot both pass it.
    if (restoring) return fail(res, 409, 'error.admin.restore_busy');
    const pending = restorePathOf(ctx.config.dbPath);
    // Written and checked under another name first: a refused file never replaces a restoration already
    // prepared, and a server stopped in the middle never applies an unchecked file at its next start.
    // Writing and checking run outside the game loop (a backup may weigh hundreds of megabytes).
    const upload = `${pending}.${randomBytes(8).toString('hex')}.upload`;
    restoring = true;
    try {
      mkdirSync(dirname(upload), { recursive: true });
      await writeFile(upload, body);
      const problem = await inspectBackup(upload);
      if (problem) return fail(res, 400, problem);
      // Same cleaning as the downloaded backups (sessions and secrets are not restored).
      stripSecrets(upload);
      renameSync(upload, pending);
    } finally {
      rmSync(upload, { force: true });
      restoring = false;
    }
    // No resources left over from an earlier `npm run restore` that would replace `uploads/` together with this database.
    rmSync(uploadsRestorePathOf(ctx.config.dbPath), { recursive: true, force: true });
    log(res, 'restore', 'server', { bytes: statSync(pending).size });
    res.json({ ok: true });
  });

  /** Daily automatic backups: their schedule and the copies on the server (restored with `npm run restore`). */
  router.get('/backups', adminOnly, (_req, res) => {
    const dir = backupsDirOf(ctx.config.dbPath);
    res.json({
      schedule: backupScheduleOf(ctx.settings.get('backupSchedule', DEFAULT_BACKUP_SCHEDULE)),
      folder: dir,
      backups: listBackups(dir).reverse().map((name) => ({ name, at: sqlDate(backupTime(name)) })),
    });
  });

  /**
   * Puts an automatic backup of the server back, like `npm run restore`: it is checked, cleaned of sessions
   * and secrets, and replaces the database (and the imported resources) at the next start of the server.
   * The administrator's password is asked again: this replaces the whole game.
   */
  router.post('/backups/:name/restore', adminOnly, async (req, res) => {
    const name = String(req.params.name);
    const dir = backupsDirOf(ctx.config.dbPath);
    if (!listBackups(dir).includes(name)) return fail(res, 404, 'error.admin.not_found');
    const refused = await ctx.auth.verifyPassword(me(res).id, String((req.body as { password?: unknown }).password ?? ''));
    if (refused) return fail(res, refused.errorKey === 'error.auth.too_many_attempts' ? 429 : 403, refused.errorKey, refused.params);
    if (restoring) return fail(res, 409, 'error.admin.restore_busy');
    restoring = true;
    let prepared: ReturnType<typeof prepareRestore>;
    try {
      prepared = prepareRestore(join(dir, name), ctx.config.dbPath);
    } finally {
      restoring = false;
    }
    if (!prepared) return fail(res, 404, 'error.admin.not_found');
    if ('problem' in prepared) return fail(res, 400, prepared.problem);
    log(res, 'restore', 'server', { backup: name, uploads: prepared.uploads });
    res.json({ ok: true, uploads: prepared.uploads });
  });

  router.post('/backups/schedule', adminOnly, (req, res) => {
    const { hour, keep } = (req.body ?? {}) as { hour?: unknown; keep?: unknown };
    if (!isInt(hour, 0, 23) || !(BACKUP_KEEP_CHOICES as readonly unknown[]).includes(keep)) return fail(res, 400, 'error.admin.invalid_schedule');
    const schedule = { hour, keep: keep as number };
    ctx.settings.set('backupSchedule', schedule);
    log(res, 'backup_schedule', 'server', schedule);
    res.json({ schedule });
  });

  return router;
}

/** `alice@example.com` → `a***@example.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return at > 0 ? `${email[0]}***${email.slice(at)}` : '***';
}
