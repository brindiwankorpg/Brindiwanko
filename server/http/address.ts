/**
 * @file Key under which a client address is counted by the limits (login
 * failures, registrations, setup code).
 *
 * An IPv4 address is one client. An IPv6 subscriber, on the other hand,
 * usually receives a whole /64 block (often much more) and may use any address
 * inside it: counting each IPv6 address on its own would give one person
 * billions of fresh counters. IPv6 addresses are therefore counted by their
 * /64 prefix, and IPv4 addresses written in IPv6 form (`::ffff:1.2.3.4`) as
 * the IPv4 address they are.
 */
import { isIPv4, isIPv6 } from 'node:net';

/** The eight 16-bit groups of an IPv6 address, or `null` when it is not one. */
function groupsOf(ip: string): number[] | null {
  let text = ip;
  // An IPv4 address written at the end (`64:ff9b::1.2.3.4`) stands for the last two groups.
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const part = (s: string) => (s ? s.split(':').map((h) => Number.parseInt(h, 16)) : []);
  const head = part(halves[0]!);
  const tail = halves.length === 2 ? part(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...new Array<number>(halves.length === 2 ? missing : 0).fill(0), ...tail];
  return groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * Counting key of a client address: the IPv4 address itself, or the /64 prefix of an IPv6 address.
 * @param ip - Address as seen by the server (`req.ip`); anything else is kept as is (capped).
 */
export function addressKey(ip: string): string {
  const bare = ip.split('%')[0]!.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  if (mapped && isIPv4(mapped[1]!)) return mapped[1]!;
  if (isIPv4(bare)) return bare;
  const groups = isIPv6(bare) ? groupsOf(bare) : null;
  if (!groups) return ip.slice(0, 64);
  // An IPv4-mapped address written with hexadecimal groups (::ffff:102:304) is an IPv4 address too.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join('.');
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`;
}
