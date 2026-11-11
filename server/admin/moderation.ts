/**
 * @file Sanctions (ban, mute, kick) and their rules, shared by the
 * administration panel and the chat commands of the staff, so that both paths
 * apply exactly the same checks:
 * - nobody sanctions an account of their own rank or above (nor themselves);
 * - a moderator bans for at most a week, never permanently, and may only lift
 *   a ban a moderator could have given;
 * - every sanction is written to the administrator log.
 */
import type { AccountRole } from '../../shared/protocol.js';
import { hasRole } from '../../shared/roles.js';
import { banNotice } from '../auth/service.js';
import type { ServerContext } from '../context.js';
import { PERMANENT, sqlDate, type AccountSummary } from '../db/admin.js';

/** Longest ban a moderator may give, in minutes (a week). */
export const MODERATOR_MAX_BAN_MINUTES = 7 * 24 * 60;
/** Longest timed ban, in minutes (about ten years). */
export const MAX_BAN_MINUTES = 5_256_000;
/** Longest mute, in minutes (a year). */
export const MAX_MUTE_MINUTES = 525_600;
/** Longest reason kept with a sanction. */
export const MAX_REASON_LENGTH = 200;

/** Who gives the sanction. */
export interface Moderator {
  id: number;
  role: AccountRole;
}

/** Outcome of a sanction: an error key (with the matching HTTP status) when refused. */
export type SanctionResult = { ok: true; until?: string } | { ok: false; error: string; status: number };

const refuse = (status: number, error: string): SanctionResult => ({ ok: false, error, status });

/** Sanctions on accounts. */
export class Moderation {
  constructor(private readonly ctx: ServerContext) {}

  /**
   * The account to sanction, if the moderator may act on it.
   * @param allowSelf - Kicking oneself is harmless (it only ends one's own sessions).
   */
  private target(actor: Moderator, id: number, allowSelf = false): AccountSummary | SanctionResult {
    const target = this.ctx.admin.account(id);
    if (!target) return refuse(404, 'error.admin.not_found');
    if (id === actor.id ? !allowSelf : hasRole(target.role, actor.role)) return refuse(403, 'error.admin.rank');
    return target;
  }

  private log(actor: Moderator, action: string, id: number, details: Record<string, unknown> = {}): void {
    this.ctx.admin.logAdmin(actor.id, action, `account:${id}`, details);
  }

  /**
   * Bans an account and disconnects it.
   * @param minutes - Length of the ban, or `'permanent'` (administrators only).
   */
  ban(actor: Moderator, id: number, minutes: number | 'permanent', reason = ''): SanctionResult {
    const target = this.target(actor, id);
    if ('ok' in target) return target;
    const permanent = minutes === 'permanent';
    if (!permanent && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_BAN_MINUTES)) return refuse(400, 'error.admin.invalid');
    if (!hasRole(actor.role, 'admin') && (permanent || minutes > MODERATOR_MAX_BAN_MINUTES)) return refuse(403, 'error.admin.ban_too_long');
    const until = permanent ? PERMANENT : sqlDate(Date.now() + minutes * 60_000);
    const why = reason.trim().slice(0, MAX_REASON_LENGTH);
    this.ctx.admin.setBan(id, until, why || null);
    const notice = banNotice({ bannedUntil: until, banReason: why || null });
    this.ctx.world.kickAccount(id, notice.key, notice.params);
    // The ban also ends the HTTP sessions and the editor locks of the account right away.
    this.ctx.sessionStore.destroyAccountSessions(id);
    this.ctx.editLocks.releaseAll(id);
    this.log(actor, 'ban', id, { until, reason: why });
    return { ok: true, until };
  }

  /** Lifts a ban. */
  unban(actor: Moderator, id: number): SanctionResult {
    const target = this.target(actor, id);
    if ('ok' in target) return target;
    // A moderator may only lift what a moderator could have given (not a permanent or longer ban).
    if (!hasRole(actor.role, 'admin') && target.bannedUntil !== null && target.bannedUntil > sqlDate(Date.now() + MODERATOR_MAX_BAN_MINUTES * 60_000)) {
      return refuse(403, 'error.admin.ban_too_long');
    }
    this.ctx.admin.setBan(id, null, null);
    this.log(actor, 'unban', id);
    return { ok: true };
  }

  /** Forbids an account to write in the chat for a while. */
  mute(actor: Moderator, id: number, minutes: number, reason = ''): SanctionResult {
    const target = this.target(actor, id);
    if ('ok' in target) return target;
    if (!(Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MUTE_MINUTES)) return refuse(400, 'error.admin.invalid');
    const until = sqlDate(Date.now() + minutes * 60_000);
    const why = reason.trim().slice(0, MAX_REASON_LENGTH);
    this.ctx.admin.setMute(id, until, why || null);
    for (const p of this.ctx.world.allPlayers()) {
      if (p.accountId !== id) continue;
      p.mute = undefined;
      p.socket.emit('notify', { key: 'notify.muted', params: { until } });
    }
    this.log(actor, 'mute', id, { until, reason: why });
    return { ok: true, until };
  }

  /** Gives the chat back. */
  unmute(actor: Moderator, id: number): SanctionResult {
    const target = this.target(actor, id);
    if ('ok' in target) return target;
    this.ctx.admin.setMute(id, null, null);
    for (const p of this.ctx.world.allPlayers()) if (p.accountId === id) p.mute = undefined;
    this.log(actor, 'unmute', id);
    return { ok: true };
  }

  /** Disconnects every game session of an account (it may log in again). */
  kick(actor: Moderator, id: number, reason = ''): SanctionResult {
    const target = this.target(actor, id, true);
    if ('ok' in target) return target;
    const why = reason.trim().slice(0, MAX_REASON_LENGTH);
    if (why) this.ctx.world.kickAccount(id, 'error.net.kicked_reason', { reason: why });
    else this.ctx.world.kickAccount(id, 'error.net.kicked');
    this.log(actor, 'kick', id, why ? { reason: why } : {});
    return { ok: true };
  }
}
