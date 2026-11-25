/**
 * @file Attaches the typed socket.io server to the HTTP server.
 *
 * All real-time traffic goes through here. The event contract lives in
 * `shared/protocol.ts`; handlers for each domain (movement, chat, editor...)
 * are registered from this module as features are added.
 *
 * Authentication: the Express session middleware runs on the socket.io engine,
 * so the handshake carries the same session as the web pages. Sockets without a
 * logged-in, non-banned account are refused before `connection` fires.
 * Browsers must also open the connection from the game's own pages: a
 * handshake whose `Origin` names another site is refused (protection against
 * cross-site WebSocket hijacking with the visitor's cookie).
 */
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Session, SessionData } from 'express-session';
import { Server, type Socket } from 'socket.io';
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '../../shared/protocol.js';
import { banNotice, isBanned } from '../auth/service.js';
import type { ServerContext } from '../context.js';
import type { Character } from '../db/characters.js';
import { addressKey } from '../http/address.js';
import { SlidingWindowLimiter } from '../http/rate-limit.js';
import { RateLimiter } from './rate-limit.js';
import { isDirection, isIntIn } from './validate.js';

/** Typed socket.io server used across the engine. */
export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
/** Typed server-side socket. */
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** Window of the handshake limits. */
const HANDSHAKE_WINDOW_MS = 60_000;
/** One client address (IPv6: one /64) may open this many times the connections of one account: a household behind one address still fits. */
const HANDSHAKES_ADDRESS_FACTOR = 3;

/**
 * Tells whether a handshake comes from the game's own origin. Requests without
 * `Origin` are not sent by a browser page (tools, tests) and are accepted: they
 * cannot carry a visitor's cookie without the visitor's knowledge.
 * @param req - Handshake request.
 * @param trustProxy - Behind a reverse proxy, the public host may be in `X-Forwarded-Host`.
 * @param publicUrl - Public origin of the game (`PUBLIC_URL`): when set, only this exact origin is accepted.
 */
export function isSameOrigin(req: IncomingMessage, trustProxy: boolean, publicUrl?: string): boolean {
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (publicUrl) return url.origin === publicUrl;
  const forwarded = trustProxy ? req.headers['x-forwarded-host'] : undefined;
  const forwardedHost = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',').map((s) => s.trim()).filter(Boolean).at(-1);
  const expected = (forwardedHost || req.headers.host)?.replace(/:(80|443)$/, '');
  const rawProto = trustProxy ? req.headers['x-forwarded-proto'] : undefined;
  const forwardedProto = (Array.isArray(rawProto) ? rawProto.join(',') : rawProto ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).at(-1);
  return url.host !== '' && url.host === expected && (!forwardedProto || url.protocol === `${forwardedProto}:`);
}

/**
 * Address of the client of a handshake. Behind a reverse proxy (`TRUST_PROXY`),
 * it is the last address of `X-Forwarded-For`, the one the proxy saw, like
 * Express's `req.ip` with one trusted hop; otherwise the socket's address.
 */
export function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  const forwarded = trustProxy ? req.headers['x-forwarded-for'] : undefined;
  const last = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',').map((a) => a.trim()).filter(Boolean).at(-1);
  return last ?? req.socket.remoteAddress ?? '';
}

/** Handshake request once the session middleware has run. */
type SessionRequest = IncomingMessage & { session?: Session & Partial<SessionData> };

/**
 * Creates the socket.io server and registers connection handlers.
 * @param httpServer - Node HTTP server shared with Express.
 * @param ctx - Server context.
 */
export function createSocketServer(httpServer: HttpServer, ctx: ServerContext): GameServer {
  const io: GameServer = new Server(httpServer, {
    serveClient: false,
    // Keep payloads small: nothing legitimate that a client sends comes near this.
    maxHttpBufferSize: 64 * 1024,
    allowRequest: (req, callback) => {
      const ok = isSameOrigin(req, ctx.config.trustProxy, ctx.config.publicUrl);
      if (!ok) {
        console.warn(
          `[brindiwanko] rejected socket handshake (origin=${req.headers.origin ?? 'none'}, sec-fetch-site=${String(req.headers['sec-fetch-site'] ?? 'none')}, host=${req.headers.host ?? 'none'}, x-forwarded-host=${String(req.headers['x-forwarded-host'] ?? 'none')}, publicUrl=${ctx.config.publicUrl ?? 'unset'})`,
        );
      }
      callback(null, ok);
    },
  });

  io.engine.on('connection_error', (err: { req: IncomingMessage; code: number; message: string; context?: Record<string, unknown> }) => {
    if (err.code !== 4) {
      console.warn(
        `[brindiwanko] socket engine error code=${err.code} (${err.message}) upgrade=${err.req.headers.upgrade ?? 'none'} connection=${err.req.headers.connection ?? 'none'} context=${JSON.stringify(err.context ?? {})}`,
      );
    }
  });

  // Run the Express session middleware on the engine's HTTP handshake requests.
  io.engine.use(ctx.sessionMiddleware);
  // Packets sent to one client in the same turn of the event loop (positions, fight results, chat...) leave in a
  // single write instead of one system call each: the TCP socket is corked while the engine flushes them.
  io.engine.on('connection', (conn) => {
    conn.on('flush', () => {
      const raw = (conn.transport as unknown as { socket?: { _socket?: { destroyed: boolean; cork(): void; uncork(): void } } }).socket?._socket;
      if (!raw || raw.destroyed) return;
      raw.cork();
      process.nextTick(() => {
        if (!raw.destroyed) raw.uncork();
      });
    });
  });
  ctx.world.attach(io);

  // Every accepted handshake puts a character in the world and takes it out again (two writes to the
  // connection log, a save): an account or an address reconnecting in a loop is held back here.
  const handshakesByAccount = new SlidingWindowLimiter(ctx.config.socketConnectionsPerMin, HANDSHAKE_WINDOW_MS);
  const handshakesByAddress = new SlidingWindowLimiter(ctx.config.socketConnectionsPerMin * HANDSHAKES_ADDRESS_FACTOR, HANDSHAKE_WINDOW_MS);

  /**
   * Checks the account and the character of a handshake, and stores them on the socket.
   * @returns The error refusing the handshake, or `null` when it is accepted.
   */
  const authorizeHandshake = (socket: GameSocket): Error | null => {
    const req = socket.request as SessionRequest;
    const accountId = req.session?.accountId;
    const account = accountId === undefined ? undefined : ctx.accounts.findById(accountId);
    if (!account) return new Error('error.auth.not_authenticated');
    if (isBanned(account)) {
      const notice = banNotice(account);
      // The reason and the end date travel in `data`, so the page can tell them.
      return Object.assign(new Error(notice.key), { data: notice.params });
    }
    const requestedId = Number((socket.handshake.auth as { characterId?: unknown } | undefined)?.characterId);
    if (Number.isInteger(requestedId) && requestedId > 0 && req.session?.characterId !== requestedId) return new Error('error.character.not_selected');
    const character = ctx.characterService.owned(account.id, req.session?.characterId);
    if (!character) return new Error('error.character.not_selected');
    const accountKey = String(account.id);
    const addressBucket = addressKey(clientAddress(socket.request, ctx.config.trustProxy));
    if (handshakesByAccount.retryAfter(accountKey) > 0 || handshakesByAddress.retryAfter(addressBucket) > 0) return new Error('error.net.too_many_connections');
    handshakesByAccount.record(accountKey);
    handshakesByAddress.record(addressBucket);
    socket.data.accountId = account.id;
    socket.data.username = account.username;
    socket.data.role = account.role;
    socket.data.characterId = character.id;
    return null;
  };

  io.use((socket, next) => {
    // socket.io runs this middleware inside a promise: a database error thrown here would only be an unhandled
    // rejection, and the client would wait for its connection timeout without ever hearing why.
    let refusal: Error | null;
    try {
      refusal = authorizeHandshake(socket);
    } catch (err) {
      console.error('[brindiwanko] socket handshake failed', err);
      refusal = new Error('error.http.server');
    }
    if (refusal) next(refusal);
    else next();
  });

  /**
   * Puts the character of an accepted socket in the world and sends it what it needs to start.
   * @returns The character, or `undefined` when there is no map to enter (the socket is then closed).
   */
  const enterWorld = (socket: GameSocket, ip: string): Character | undefined => {
    socket.emit('welcome', { protocol: PROTOCOL_VERSION, serverTime: Date.now() });
    const character = ctx.characters.findById(socket.data.characterId);
    const payload = character ? ctx.world.join(socket, character) : null;
    if (!character || !payload) {
      socket.emit('errorMessage', { key: 'error.net.no_map' });
      socket.disconnect(true);
      return undefined;
    }
    ctx.characters.touchPlayed(character.id);
    ctx.admin.logConnection(socket.data.accountId, character.id, 'login', ip);
    socket.emit('enterWorld', payload);
    const joined = ctx.world.player(character.id);
    if (joined) {
      ctx.world.pushInventory(joined);
      ctx.world.afterEnter(joined);
    }
    return character;
  };

  /**
   * Entering the world failed half-way: the session this socket may already have in the world is taken
   * out (so no player is left half-joined), and only this socket is closed.
   */
  const abortEntry = (socket: GameSocket, err: unknown): void => {
    const characterId = socket.data.characterId;
    console.error(`[brindiwanko] character #${characterId} could not enter the world`, err);
    try {
      if (ctx.world.player(characterId)?.socket.id === socket.id) ctx.world.leave(characterId);
    } catch (leaveErr) {
      console.error(`[brindiwanko] character #${characterId} could not be taken out of the world`, leaveErr);
    }
    socket.emit('errorMessage', { key: 'error.http.server' });
    socket.disconnect(true);
  };

  io.on('connection', (socket) => {
    // socket.io calls handlers outside any try: an exception (or a rejected promise) in one
    // handler is logged instead of stopping the whole server.
    const listen = socket.on.bind(socket) as (event: string, listener: (...args: unknown[]) => unknown) => typeof socket;
    socket.on = ((event: string, listener: (...args: unknown[]) => unknown) => {
      const wrapped = (...args: unknown[]) => {
        const fail = (err: unknown) => console.error(`[brindiwanko] socket handler "${event}" failed`, err);
        try {
          const result = listener(...args);
          if (result instanceof Promise) result.catch(fail);
        } catch (err) {
          fail(err);
        }
      };
      // Keeps the original reference so that `off(event, original)` (and `once`) still find it.
      (wrapped as { listener?: unknown }).listener = (listener as { listener?: unknown }).listener ?? listener;
      return listen(event, wrapped);
    }) as typeof socket.on;
    const limiter = new RateLimiter();
    socket.use((_packet, next) => {
      const verdict = limiter.take();
      if (verdict === 'ok') {
        next();
        return;
      }
      if (verdict === 'kick') {
        socket.emit('errorMessage', { key: 'error.net.rate_limited' });
        socket.disconnect(true);
        return;
      }
      // Warn on the first dropped event of a burst, then stay quiet.
      if (limiter.droppedCount === 1) socket.emit('errorMessage', { key: 'error.net.rate_limited' });
    });
    const ip = clientAddress(socket.request, ctx.config.trustProxy);
    // socket.io runs this handler from a `process.nextTick`: an exception escaping it would stop the
    // whole server. Entering writes to the database (play date, connection log, the session it replaces):
    // when one of those writes fails, only this player is turned away.
    let entered: Character | undefined;
    try {
      entered = enterWorld(socket, ip);
    } catch (err) {
      abortEntry(socket, err);
      return;
    }
    if (!entered) return;
    const character = entered;

    /** The session of this socket, if it is still the active one for the character. */
    const session = () => {
      const p = ctx.world.player(character.id);
      return p?.socket.id === socket.id ? p : undefined;
    };

    socket.on('ping', (_sentAt, ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });
    socket.on('move', (direction, epoch) => {
      const p = session();
      if (p && isDirection(direction) && isIntIn(epoch, 0, Number.MAX_SAFE_INTEGER)) ctx.world.move(p, direction, epoch);
    });
    socket.on('turn', (direction) => {
      const p = session();
      if (p && isDirection(direction)) ctx.world.turn(p, direction);
    });
    socket.on('useItem', (itemId) => {
      const p = session();
      if (p && isIntIn(itemId, 1, 9999)) ctx.world.useItem(p, itemId);
    });
    socket.on('action', () => {
      const p = session();
      if (p) ctx.world.action(p);
    });
    socket.on('questAbandon', (questId) => {
      const p = session();
      if (p && idle(p) && isIntIn(questId, 1, 9999)) ctx.world.quests.abandon(p, questId);
    });
    socket.on('attack', () => {
      const p = session();
      if (p) ctx.world.combat.attack(p);
    });
    socket.on('useSkill', (skillId) => {
      const p = session();
      if (p && isIntIn(skillId, 1, 9999)) ctx.world.combat.useSkill(p, skillId);
    });
    /** Inventory-changing requests are refused while an event runs (its checks and its effects must not be split by a transfer). */
    const idle = (p: { busy: boolean; combat: { dead: boolean } }): boolean => !p.busy && !p.combat.dead;
    const kinds = ['item', 'weapon', 'armor'] as const;
    const isKind = (k: unknown): k is (typeof kinds)[number] => kinds.includes(k as 'item');
    socket.on('equip', (slot, id) => {
      const p = session();
      if (!p || !idle(p) || typeof slot !== 'string' || !isIntIn(id, 0, 9999)) return;
      const error = ctx.world.sheet.equip(p, slot, id);
      if (error) socket.emit('notify', { key: error });
    });
    socket.on('allocate', (param) => {
      const p = session();
      if (p && idle(p) && typeof param === 'string') ctx.world.sheet.allocate(p, param);
    });
    socket.on('discard', (kind, id, quantity) => {
      const p = session();
      if (p && idle(p) && isKind(kind) && isIntIn(id, 1, 9999) && isIntIn(quantity, 1, 9999)) ctx.world.sheet.discard(p, kind, id, quantity);
    });
    socket.on('shopBuy', (index, quantity) => {
      const p = session();
      if (p && isIntIn(index, 0, 999) && isIntIn(quantity, 1, 99)) ctx.world.sheet.buy(p, index, quantity);
    });
    socket.on('shopSell', (kind, id, quantity) => {
      const p = session();
      if (p && isKind(kind) && isIntIn(id, 1, 9999) && isIntIn(quantity, 1, 99)) ctx.world.sheet.sell(p, kind, id, quantity);
    });
    socket.on('bankMove', (kind, id, quantity, toBank) => {
      const p = session();
      if (p && isKind(kind) && isIntIn(id, 1, 9999) && isIntIn(quantity, 1, 9999) && typeof toBank === 'boolean') ctx.world.sheet.bankMove(p, kind, id, quantity, toBank);
    });
    socket.on('bankGold', (amount) => {
      const p = session();
      if (p && isIntIn(amount, -999_999_999, 999_999_999)) ctx.world.sheet.bankGold(p, amount);
    });
    const channels = ['map', 'global', 'party', 'guild'] as const;
    socket.on('chat', (text, channel) => {
      const p = session();
      if (p && typeof text === 'string' && text.length <= 1000 && channels.includes(channel)) ctx.world.social.chat(p, text, channel);
    });
    socket.on('emote', (balloon) => {
      const p = session();
      if (p && isIntIn(balloon, 1, 10)) ctx.world.social.emote(p, balloon);
    });
    socket.on('friendAdd', (name) => {
      const p = session();
      if (p && typeof name === 'string' && name.length <= 40) ctx.world.social.addFriend(p, name);
    });
    socket.on('friendRemove', (id) => {
      const p = session();
      if (p && isIntIn(id, 1, Number.MAX_SAFE_INTEGER)) ctx.world.social.removeFriend(p, id);
    });
    socket.on('ignore', (name) => {
      const p = session();
      if (p && typeof name === 'string' && name.length <= 40) ctx.world.social.ignore(p, name);
    });
    socket.on('unignore', (id) => {
      const p = session();
      if (p && isIntIn(id, 1, Number.MAX_SAFE_INTEGER)) ctx.world.social.unignore(p, id);
    });
    socket.on('inspect', (id) => {
      const p = session();
      if (p && isIntIn(id, 1, Number.MAX_SAFE_INTEGER)) ctx.world.social.inspect(p, id);
    });
    // While the editor covers the game, the administrator's character cannot defend itself.
    socket.on('editing', (on) => {
      const p = session();
      if (p) p.editing = on === true && socket.data.role === 'admin';
    });
    socket.on('report', (id, reason) => {
      const p = session();
      if (p && isIntIn(id, 1, Number.MAX_SAFE_INTEGER) && typeof reason === 'string' && reason.length <= 1000) ctx.world.social.report(p, id, reason);
    });
    socket.on('tradeRequest', (id) => {
      const p = session();
      if (p && isIntIn(id, 1, Number.MAX_SAFE_INTEGER)) ctx.world.trade.request(p, id);
    });
    socket.on('tradeRespond', (accept, requesterId) => {
      const p = session();
      if (p && typeof accept === 'boolean' && isIntIn(requesterId, 1, Number.MAX_SAFE_INTEGER)) ctx.world.trade.respond(p, accept, requesterId);
    });
    socket.on('tradeOffer', (offer) => {
      const p = session();
      if (!p || !idle(p) || typeof offer !== 'object' || offer === null || !Array.isArray(offer.items) || offer.items.length > 50) return;
      ctx.world.trade.offer(p, { items: offer.items.filter((i) => i && isKind(i.kind) && isIntIn(i.id, 1, 9999) && isIntIn(i.quantity, 1, 9999)), gold: isIntIn(offer.gold, 0, 999_999_999) ? offer.gold : 0 });
    });
    socket.on('tradeLock', () => {
      const p = session();
      if (p && idle(p)) ctx.world.trade.lock(p);
    });
    socket.on('tradeConfirm', () => {
      const p = session();
      if (p && idle(p)) ctx.world.trade.confirm(p);
    });
    socket.on('tradeCancel', () => {
      const p = session();
      if (p) ctx.world.trade.cancel(p);
    });
    const onP = <A extends unknown[]>(check: (...args: A) => boolean, run: (p: NonNullable<ReturnType<typeof session>>, ...args: A) => void) => (...args: A) => {
      const p = session();
      if (p && check(...args)) run(p, ...args);
    };
    const anyId = (id: unknown) => isIntIn(id, 1, Number.MAX_SAFE_INTEGER);
    const text = (s: unknown, max: number) => typeof s === 'string' && s.length <= max;
    socket.on('partyInvite', onP((id: number) => anyId(id), (p, id) => ctx.world.party.invite(p, id)));
    socket.on('partyRespond', onP((a: boolean) => typeof a === 'boolean', (p, a) => ctx.world.party.respond(p, a)));
    socket.on('partyLeave', onP(() => true, (p) => ctx.world.party.leave(p)));
    socket.on('partyKick', onP((id: number) => anyId(id), (p, id) => ctx.world.party.kick(p, id)));
    socket.on('partyPromote', onP((id: number) => anyId(id), (p, id) => ctx.world.party.promote(p, id)));
    socket.on('lootChoice', onP((id: number, c: 'need' | 'greed' | 'pass') => anyId(id) && ['need', 'greed', 'pass'].includes(c), (p, id, c) => ctx.world.raids.choose(p, id, c)));
    socket.on('partyRaid', onP((r: boolean) => typeof r === 'boolean', (p, r) => ctx.world.party.setRaid(p, r)));
    socket.on('partyLoot', onP((l: 'personal' | 'shared') => l === 'personal' || l === 'shared', (p, l) => ctx.world.party.setLoot(p, l)));
    socket.on('guildCreate', onP((n: string, t: string, _e: unknown) => text(n, 40) && text(t, 10), (p, n, t, e) => void (idle(p) && ctx.world.guilds.create(p, n, t, e))));
    socket.on('guildInvite', onP((id: number) => anyId(id), (p, id) => ctx.world.guilds.invite(p, id)));
    // The directory of guilds (public information: names, sizes, leaders), for players looking for one.
    socket.on('guildDirectory', (query, ack) => {
      if (!session() || typeof ack !== 'function' || typeof query !== 'object' || query === null) return;
      const search = typeof query.search === 'string' ? query.search.slice(0, 40) : '';
      ack(ctx.guilds.directory(search, isIntIn(query.page, 0, 100_000) ? query.page : 0));
    });
    socket.on('guildRespond', onP((a: boolean) => typeof a === 'boolean', (p, a) => ctx.world.guilds.respond(p, a)));
    socket.on('guildLeave', onP(() => true, (p) => ctx.world.guilds.leave(p)));
    socket.on('guildKick', onP((id: number) => anyId(id), (p, id) => ctx.world.guilds.kick(p, id)));
    socket.on('guildSetRank', onP((id: number, r: number) => anyId(id) && isIntIn(r, 0, 9), (p, id, r) => ctx.world.guilds.setMemberRank(p, id, r)));
    socket.on('guildEditRank', onP((r: number, n: string, perm: number) => isIntIn(r, 0, 9) && text(n, 40) && isIntIn(perm, 0, 63), (p, r, n, perm) => ctx.world.guilds.editRank(p, r, n, perm)));
    socket.on('guildMotd', onP((m: string) => text(m, 1000), (p, m) => ctx.world.guilds.setMotd(p, m)));
    socket.on('guildBank', onP((k: 'item' | 'weapon' | 'armor', id: number, q: number, d: boolean) => isKind(k) && isIntIn(id, 1, 9999) && isIntIn(q, 1, 9999) && typeof d === 'boolean', (p, k, id, q, d) => void (idle(p) && ctx.world.guilds.bankItems(p, k, id, q, d))));
    socket.on('guildGold', onP((a: number) => isIntIn(a, -999_999_999, 999_999_999), (p, a) => void (idle(p) && ctx.world.guilds.bankGold(p, a))));
    socket.on('setHotbar', (slots) => {
      const p = session();
      if (p && Array.isArray(slots) && slots.length <= 32) ctx.world.combat.setHotbar(p, slots);
    });
    socket.on('disconnect', () => {
      // The player leaves the world first: a connection log that cannot be written must not keep it there.
      if (session()) ctx.world.leave(character.id);
      // An administrator leaving the game also leaves the editor.
      if (socket.data.role === 'admin') ctx.editLocks.releaseAll(socket.data.accountId);
      ctx.admin.logConnection(socket.data.accountId, character.id, 'logout', ip);
    });
  });

  return io;
}
