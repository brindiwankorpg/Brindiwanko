/**
 * @file Parties: invitation, leader, members' frames, party chat, and the
 * sharing of experience, gold and loot of the monsters they defeat together.
 *
 * Parties live in memory (they end when their members have left the game; a member who
 * disconnects keeps its place for two minutes, so a page reload does not break the party). The
 * leader invites (up to the party size of the System settings), removes
 * members, gives the lead and chooses the loot rule: personal (each member on
 * the map rolls the drops for itself) or shared (each drop goes to one member,
 * in turn). Experience and gold of a defeated monster are split between the
 * members on the map, with a bonus of 10 % per extra member.
 */
import type { PartyView } from '../../shared/guild.js';
import { nameKey } from '../../shared/names.js';
import { DEFAULT_SETTINGS } from '../../shared/settings.js';
import { RequestThrottle } from './request-throttle.js';
import { sameZone, type PlayerSession, type World } from './world.js';

/** An invitation expires after this delay. */
const INVITE_MS = 60_000;
/** A member who disconnects keeps its place this long (page reload, network drop) before being removed. */
export const PARTY_GRACE_MS = 120_000;

interface Party {
  id: number;
  leader: number;
  members: number[];
  loot: PartyView['loot'];
  /** Next member receiving a shared drop. */
  turn: number;
  /** Turned into a raid (larger size). */
  raid: boolean;
  /** Last frames sent (unchanged frames are not sent again). */
  sent: string;
  /** Members who are disconnected, with the timer that removes them if they do not come back. */
  away: Map<number, ReturnType<typeof setTimeout>>;
  /** Names of the members seen online (shown while they are away). */
  names: Map<number, string>;
}

/** Parties for the whole world. */
export class PartyService {
  private readonly parties = new Map<number, Party>();
  private readonly byMember = new Map<number, Party>();
  private readonly invites = new Map<number, { from: number; at: number }>();
  /** Spacing of the invitations of one player to another. */
  private readonly throttle = new RequestThrottle();
  private nextId = 1;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly world: World) {
    world.social.partyMembers = (p) => {
      const party = this.byMember.get(p.characterId);
      return party ? this.online(party) : null;
    };
    world.social.commands.set('invite', (p, arg) => this.inviteByName(p, arg));
    world.social.commands.set('leave', (p) => this.leave(p));
    world.social.commands.set('pkick', (p, arg) => {
      const party = this.byMember.get(p.characterId);
      const target = party && this.online(party).find((m) => nameKey(m.name) === nameKey(arg));
      if (target) this.kick(p, target.characterId);
      else world.social.system(p, party ? 'error.party.not_member' : 'error.chat.no_party', { name: arg });
    });
    this.timer = setInterval(() => {
      for (const party of this.parties.values()) this.push(party);
    }, 1000);
    this.timer.unref();
  }

  /** Stops updates and pending reconnection callbacks when the world closes. */
  close(): void {
    clearInterval(this.timer);
    for (const party of this.parties.values()) {
      for (const timer of party.away.values()) clearTimeout(timer);
      party.away.clear();
    }
    this.parties.clear();
    this.byMember.clear();
    this.invites.clear();
  }

  /** Online members of a party. */
  private online(party: Party): PlayerSession[] {
    return party.members.map((id) => this.world.player(id)).filter((m): m is PlayerSession => !!m && this.world.isLive(m));
  }

  /** Members of a player's party on its map (itself included), for sharing rewards. */
  membersNear(p: PlayerSession): PlayerSession[] {
    return this.membersInZone(p, false);
  }

  /**
   * Members of a player's party in its zone (itself included, whatever its state).
   * @param knockedOut - Whether members knocked out count too (their damage still counts for the party).
   */
  membersInZone(p: PlayerSession, knockedOut: boolean): PlayerSession[] {
    const party = this.byMember.get(p.characterId);
    if (!party) return [p];
    return this.online(party).filter((m) => sameZone(m, p) && (knockedOut || !m.combat.dead));
  }

  /** Party id of a player (0 = none). */
  partyOf(characterId: number): number {
    return this.byMember.get(characterId)?.id ?? 0;
  }

  /** Whether a party shares drops in turn among `candidates`. */
  sharesLoot(p: PlayerSession, candidates: PlayerSession[]): boolean {
    const party = this.byMember.get(p.characterId);
    return !!party && party.loot === 'shared' && candidates.length > 0;
  }

  /** Loot rule of a party, and the member receiving the next shared drop. */
  lootTaker(p: PlayerSession, candidates: PlayerSession[]): PlayerSession | null {
    const party = this.byMember.get(p.characterId);
    if (!party || party.loot === 'personal' || candidates.length === 0) return null;
    party.turn = (party.turn + 1) % candidates.length;
    return candidates[party.turn]!;
  }

  private notify(p: PlayerSession, key: string, params?: Record<string, string | number>): void {
    p.socket.emit('notify', { key, params });
  }

  // --- Invitations ---------------------------------------------------------------------

  private inviteByName(p: PlayerSession, name: string): void {
    const target = this.world.social.findOnline(name);
    if (!target) {
      this.world.social.system(p, 'error.chat.offline', { name });
      return;
    }
    this.invite(p, target.characterId);
  }

  /** Invites a player (creating the party if needed). */
  invite(p: PlayerSession, targetId: number): void {
    const target = this.world.player(targetId);
    const party = this.byMember.get(p.characterId);
    const max = this.maxSize(party);
    if (!target || target === p || !this.world.isLive(target) || target.invisible || this.world.social.ignores(target, p.characterId)) return this.notify(p, 'error.party.unavailable');
    if (this.byMember.has(target.characterId)) return this.notify(p, 'error.party.already', { name: target.name });
    if (party && party.leader !== p.characterId) return this.notify(p, 'error.party.not_leader');
    if (party && party.members.length >= max) return this.notify(p, 'error.party.full');
    const wait = this.throttle.take(p.characterId, target.characterId);
    if (wait > 0) return this.notify(p, 'error.social.too_soon', { name: target.name, seconds: Math.ceil(wait / 1000) });
    this.invites.set(target.characterId, { from: p.characterId, at: Date.now() });
    target.socket.emit('partyInvite', { id: p.characterId, name: p.name });
    this.notify(p, 'notify.party_invited', { name: target.name });
  }

  /** Answers an invitation. */
  respond(p: PlayerSession, accept: boolean): void {
    const invite = this.invites.get(p.characterId);
    this.invites.delete(p.characterId);
    if (!invite || Date.now() - invite.at > INVITE_MS) return;
    const from = this.world.player(invite.from);
    if (!from || !this.world.isLive(from)) return;
    if (!accept) {
      this.throttle.declined(from.characterId, p.characterId);
      return this.notify(from, 'notify.party_declined', { name: p.name });
    }
    this.throttle.accepted(from.characterId, p.characterId);
    if (this.byMember.has(p.characterId)) return;
    let party = this.byMember.get(from.characterId);
    const max = this.maxSize(party);
    if (party && party.leader !== from.characterId) return this.notify(p, 'error.party.not_leader_now');
    if (party && party.members.length >= max) return this.notify(p, 'error.party.full');
    if (!party) {
      party = { id: this.nextId++, leader: from.characterId, members: [from.characterId], loot: 'personal', turn: -1, sent: '', raid: false, away: new Map(), names: new Map([[from.characterId, from.name]]) };
      this.parties.set(party.id, party);
      this.byMember.set(from.characterId, party);
    }
    party.members.push(p.characterId);
    party.names.set(p.characterId, p.name);
    this.byMember.set(p.characterId, party);
    for (const m of this.online(party)) this.notify(m, 'notify.party_joined', { name: p.name });
    this.push(party, true);
  }

  // --- Management ----------------------------------------------------------------------

  /** Leaves the party (the lead passes on; a party of one ends). */
  leave(p: PlayerSession): void {
    const party = this.byMember.get(p.characterId);
    if (!party) return;
    this.remove(party, p.characterId);
    p.socket.emit('party', null);
    for (const m of this.online(party)) this.notify(m, 'notify.party_left', { name: p.name });
  }

  /** The leader removes a member. */
  kick(p: PlayerSession, targetId: number): void {
    const party = this.byMember.get(p.characterId);
    if (!party || party.leader !== p.characterId || targetId === p.characterId || !party.members.includes(targetId)) return;
    const target = this.world.player(targetId);
    this.remove(party, targetId);
    if (target) {
      target.socket.emit('party', null);
      this.notify(target, 'notify.party_kicked');
    }
  }

  /** The leader gives the lead to another member. */
  promote(p: PlayerSession, targetId: number): void {
    const party = this.byMember.get(p.characterId);
    if (!party || party.leader !== p.characterId || !party.members.includes(targetId)) return;
    party.leader = targetId;
    this.push(party, true);
  }

  /** Largest size of a party (a raid is larger). */
  private maxSize(party: Party | undefined): number {
    const s = this.world.ctx.settings;
    return party?.raid ? s.get('maxRaidSize', DEFAULT_SETTINGS.maxRaidSize) : s.get('maxPartySize', DEFAULT_SETTINGS.maxPartySize);
  }

  /** Party of a player (id and members' ids), for instances and raids. */
  info(p: PlayerSession): { id: number; members: number[]; raid: boolean; loot: Party['loot'] } | null {
    const party = this.byMember.get(p.characterId);
    return party ? { id: party.id, members: [...party.members], raid: party.raid, loot: party.loot } : null;
  }

  /** The leader turns the party into a raid (or back, when small enough). */
  setRaid(p: PlayerSession, raid: boolean): void {
    const party = this.byMember.get(p.characterId);
    if (!party || party.leader !== p.characterId) return;
    if (!raid && party.members.length > this.world.ctx.settings.get('maxPartySize', DEFAULT_SETTINGS.maxPartySize)) return this.notify(p, 'error.party.too_big');
    party.raid = raid;
    this.push(party, true);
  }

  /** The leader changes the loot rule. */
  setLoot(p: PlayerSession, loot: PartyView['loot']): void {
    const party = this.byMember.get(p.characterId);
    if (!party || party.leader !== p.characterId) return;
    party.loot = loot;
    this.push(party, true);
  }

  /** Sends a player out of the party's instance, back to its class start, if it is inside. */
  private leaveInstance(party: Party, characterId: number): void {
    const p = this.world.player(characterId);
    if (!p || !p.instance || this.world.instances.get(p.instance)?.owner !== `p${party.id}`) return;
    const start = this.world.startPosition(p.classId);
    this.world.transfer(p, start.mapId, start.x, start.y, start.direction);
  }

  private remove(party: Party, characterId: number): void {
    // A member who leaves (or is kicked) cannot stay in the party's instance: it would let more players than
    // the raid allows gather there once new members are invited.
    party.members = party.members.filter((id) => id !== characterId);
    this.byMember.delete(characterId);
    this.leaveInstance(party, characterId);
    clearTimeout(party.away.get(characterId));
    party.away.delete(characterId);
    if (party.leader === characterId && party.members.length) party.leader = party.members[0]!;
    if (party.members.length <= 1) {
      // The party is gone: so is the right of the last member to stay in its instance (a raid alone).
      for (const id of party.members) {
        this.byMember.delete(id);
        this.leaveInstance(party, id);
        this.world.player(id)?.socket.emit('party', null);
      }
      for (const timer of party.away.values()) clearTimeout(timer);
      this.parties.delete(party.id);
      return;
    }
    this.push(party, true);
  }

  /**
   * A player left the game. Its place in the party is kept for a while (a page reload or a network drop
   * must not break the party); it is removed if the player does not come back in time.
   */
  playerLeft(p: PlayerSession): void {
    this.invites.delete(p.characterId);
    const party = this.byMember.get(p.characterId);
    if (!party) return;
    party.names.set(p.characterId, p.name);
    clearTimeout(party.away.get(p.characterId));
    // Failures of these callbacks are logged: thrown from a timer or a microtask, they would stop the whole server.
    const timer = setTimeout(() => {
      try {
        party.away.delete(p.characterId);
        if (this.byMember.get(p.characterId) !== party) return;
        this.remove(party, p.characterId);
        for (const m of this.online(party)) this.notify(m, 'notify.party_left', { name: p.name });
      } catch (err) {
        console.error('[brindiwanko] party grace period failed', err);
      }
    }, PARTY_GRACE_MS);
    timer.unref();
    party.away.set(p.characterId, timer);
    // Frames still show the member (as away) to the others.
    queueMicrotask(() => {
      try {
        if (this.byMember.get(p.characterId) === party) this.push(party, true);
      } catch (err) {
        console.error('[brindiwanko] party frames failed', err);
      }
    });
  }

  /** A player entered the game: back in its party, if it kept its place. */
  playerJoined(p: PlayerSession): void {
    const party = this.byMember.get(p.characterId);
    if (!party) return;
    clearTimeout(party.away.get(p.characterId));
    party.away.delete(p.characterId);
    // A failure is logged: thrown from a microtask, it would stop the whole server.
    queueMicrotask(() => {
      try {
        if (this.byMember.get(p.characterId) === party) this.push(party, true);
      } catch (err) {
        console.error('[brindiwanko] party frames failed', err);
      }
    });
  }

  // --- Frames --------------------------------------------------------------------------

  /** Sends the party frames to its members (only when they changed, unless forced). */
  private push(party: Party, force = false): void {
    const members = party.members.map((id) => this.world.player(id));
    const zone = (m: { mapId: number; instance: number }): string => `${m.mapId}:${m.instance}`;
    const base = members.map((m, i) => {
      if (!m) return { id: party.members[i]!, name: party.names.get(party.members[i]!) ?? '?', level: 0, hp: 0, maxHp: 1, mp: 0, maxMp: 1, near: false, online: false, zone: '' };
      const { maxHp, maxMp } = this.world.maxVitals(m);
      return { id: m.characterId, name: m.name, level: m.level, hp: m.hp, maxHp, mp: m.mp, maxMp, near: true, online: this.world.isLive(m), zone: zone(m) };
    });
    const signature = JSON.stringify([party.leader, party.loot, base]);
    if (!force && signature === party.sent) return;
    party.sent = signature;
    for (const viewer of members) {
      if (!viewer || !this.world.isLive(viewer)) continue;
      const view: PartyView = { leader: party.leader, loot: party.loot, raid: party.raid, members: base.map(({ zone: z, ...m }) => ({ ...m, near: z === zone(viewer) })) };
      viewer.socket.emit('party', view);
    }
  }
}
