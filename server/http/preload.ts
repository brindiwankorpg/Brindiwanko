/**
 * @file Chunks of the game script that the game page asks for at once (`<link rel="modulepreload">`),
 * instead of waiting for the script to be read to discover them. The list is written by the client
 * build (`public/build/preload.json`, see `scripts/build-client.ts`); without it nothing is preloaded.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../paths.js';

let cached: string[] | null = null;

/**
 * Addresses of the chunks the game script imports.
 * @param production - Read once (the build does not change while the server runs); otherwise at each
 *   call, so that a development rebuild is followed.
 */
export function gamePreloads(production: boolean): string[] {
  if (cached && production) return cached;
  try {
    const list = (JSON.parse(readFileSync(join(PATHS.public, 'build', 'preload.json'), 'utf8')) as { game?: unknown }).game;
    cached = Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string' && /^\/build\/chunks\/[\w.-]+\.js$/.test(p)) : [];
  } catch {
    cached = [];
  }
  return cached;
}
