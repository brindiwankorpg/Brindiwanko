/**
 * @file Chat commands of the staff (moderators and administrators):
 * `/kick name [reason]`, `/mute name [duration] [reason]`, `/unmute name`,
 * `/ban name [duration|perm] [reason]`, `/unban name`. They apply the same
 * rules as the administration panel (see `Moderation`) and are logged the same
 * way. `/kick` is a disconnection by the staff only; anyone removes a member
 * from their party with `/pkick`.
 *
 * Names may contain spaces: the longest run of leading words that names a
 * character is taken as the name, the rest as the duration and the reason.
 */
import type { AccountRole } from '../../shared/protocol.js';
import { hasRole } from '../../shared/roles.js';
import { Moderation, type SanctionResult } from '../admin/moderation.js';
import { splitLeadingName as split } from './social.js';
import type { PlayerSession, World } from './world.js';

/** Duration when none is typed: a short mute, a one-day ban (within a moderator's reach). */
const DEFAULT_MUTE_MINUTES = 10;
const DEFAULT_BAN_MINUTES = 24 * 60;

/** Role of the account playing a character (kept up to date when it changes). */
export function roleOf(p: PlayerSession): AccountRole {
  return (p.socket.data.role as AccountRole | undefined) ?? 'player';
}

/** Tells whether a character is played by a moderator or an administrator. */
export function isStaff(p: PlayerSession): boolean {
  return hasRole(roleOf(p), 'moderator');
}

/**
 * Reads a duration: `30` or `30m` (minutes), `2h`, `7j` / `7d`, or `perm` (permanent).
 * @returns Minutes, `'permanent'`, or `null` when the word is not a duration.
 */
export function parseDuration(word: string): number | 'permanent' | null {
  const w = word.toLowerCase();
  if (['perm', 'permanent', 'def', 'definitif', 'définitif'].includes(w)) return 'permanent';
  const m = /^(\d{1,7})(m|min|h|j|d)?$/.exec(w);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? 'm';
  return unit === 'h' ? n * 60 : unit === 'j' || unit === 'd' ? n * 24 * 60 : n;
}

/** Registers the commands in the chat of the world. */
export function registerModerationCommands(world: World): void {
  const social = world.social;
  const moderation = new Moderation(world.ctx);

  /** Account and name of a character, online or not. */
  const findAccount = (name: string) => {
    const character = world.ctx.social.findByName(name);
    const accountId = character ? world.ctx.characters.findById(character.id)?.accountId : undefined;
    return character && accountId !== undefined ? { accountId, name: character.name } : undefined;
  };
  const actor = (p: PlayerSession) => ({ id: p.accountId, role: roleOf(p) });
  const report = (p: PlayerSession, result: SanctionResult, done: string, params: Record<string, string>) => {
    if (result.ok) social.system(p, done, result.until ? { ...params, until: result.until } : params);
    else social.system(p, result.error);
  };
  /** Runs a staff command, or explains why it cannot run. */
  const staff = (command: string, run: (p: PlayerSession, words: string[]) => void) => (p: PlayerSession, _arg: string, words: string[]) => {
    if (!isStaff(p)) return social.system(p, 'error.chat.staff_only');
    if (words.length === 0) return social.system(p, `error.chat.usage.${command}`);
    run(p, words);
  };
  const unknown = (p: PlayerSession, words: string[]) => social.system(p, 'error.social.unknown_player', { name: words.join(' ') });

  // /kick: a player disconnected by the staff (it may log in again).
  social.commands.set(
    'kick',
    staff('kick', (p, words) => {
      const found = split(words, (name) => social.findOnline(name));
      if (!found) return social.system(p, 'error.chat.offline', { name: words.join(' ') });
      const { target, rest } = found;
      report(p, moderation.kick(actor(p), target.accountId, rest.join(' ')), 'notify.mod.kicked', { name: target.name });
    }),
  );

  social.commands.set(
    'mute',
    staff('mute', (p, words) => {
      const found = split(words, findAccount);
      if (!found) return unknown(p, words);
      const duration = found.rest[0] === undefined ? null : parseDuration(found.rest[0]);
      if (duration === 'permanent') return social.system(p, 'error.chat.usage.mute');
      const reason = (duration === null ? found.rest : found.rest.slice(1)).join(' ');
      report(p, moderation.mute(actor(p), found.target.accountId, duration ?? DEFAULT_MUTE_MINUTES, reason), 'notify.mod.muted', { name: found.target.name });
    }),
  );
  social.commands.set(
    'unmute',
    staff('unmute', (p, words) => {
      const found = split(words, findAccount);
      if (!found) return unknown(p, words);
      report(p, moderation.unmute(actor(p), found.target.accountId), 'notify.mod.unmuted', { name: found.target.name });
    }),
  );
  social.commands.set(
    'ban',
    staff('ban', (p, words) => {
      const found = split(words, findAccount);
      if (!found) return unknown(p, words);
      const duration = found.rest[0] === undefined ? null : parseDuration(found.rest[0]);
      const reason = (duration === null ? found.rest : found.rest.slice(1)).join(' ');
      const result = moderation.ban(actor(p), found.target.accountId, duration ?? DEFAULT_BAN_MINUTES, reason);
      report(p, result, duration === 'permanent' ? 'notify.mod.banned_forever' : 'notify.mod.banned', { name: found.target.name });
    }),
  );
  social.commands.set(
    'unban',
    staff('unban', (p, words) => {
      const found = split(words, findAccount);
      if (!found) return unknown(p, words);
      report(p, moderation.unban(actor(p), found.target.accountId), 'notify.mod.unbanned', { name: found.target.name });
    }),
  );
}
