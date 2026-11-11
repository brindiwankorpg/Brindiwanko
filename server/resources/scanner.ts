/**
 * @file Scans resource folders and builds manifest entries.
 *
 * Generated graphics live in `assets/img/<kind>/`, creator uploads in
 * `uploads/img/<kind>/`, sounds in `audio/<kind>/`. For every file the scanner
 * reads the pixel size (from the SVG root attributes or the PNG header),
 * detects the sheet format and computes a short content hash, which the client
 * uses for cache busting.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { RESOURCE_KINDS, detectFormat, type ResourceKind } from '../../shared/resource-formats.js';
import type { ScannedResource } from '../db/resources.js';
import { PATHS } from '../paths.js';
import { pixelSize } from './uploads.js';

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/**
 * Reads the pixel size of an image file.
 * @param data - File content.
 * @param ext - Lower-case extension.
 * @returns Width and height, or zeros when unknown.
 */
export function imageSize(data: Buffer, ext: string): { width: number; height: number } {
  if (ext === '.svg') {
    const head = data.subarray(0, 512).toString('utf8');
    const w = /\swidth="(\d+(?:\.\d+)?)"/.exec(head);
    const h = /\sheight="(\d+(?:\.\d+)?)"/.exec(head);
    return { width: w ? Math.round(Number(w[1])) : 0, height: h ? Math.round(Number(h[1])) : 0 };
  }
  if (ext === '.png' && data.length >= 24 && data.toString('ascii', 12, 16) === 'IHDR') {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.webp') {
    const size = pixelSize(data, ext === '.webp' ? 'webp' : 'jpg');
    if (size) return size;
  }
  return { width: 0, height: 0 };
}

/**
 * Size and hash of the files already read, by path: a scan (done after every upload) only reads the files
 * that are new or changed (size or modification time), instead of reading and hashing every resource again
 * while the game waits.
 */
const known = new Map<string, { size: number; mtimeMs: number; width: number; height: number; hash: string }>();

/** Pixel size and content hash of a resource file, read again only when the file changed. */
function fileInfo(full: string, ext: string, size: number, mtimeMs: number): { width: number; height: number; hash: string } {
  const cached = known.get(full);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached;
  const data = readFileSync(full);
  const info = { ...imageSize(data, ext), hash: createHash('sha1').update(data).digest('hex').slice(0, 12) };
  known.set(full, { size, mtimeMs, ...info });
  return info;
}

function scanFolder(base: string, kind: ResourceKind, origin: ScannedResource['origin'], out: Map<string, ScannedResource>, seen: Set<string>): void {
  const dir = join(base, kind);
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    const full = join(dir, file);
    const ext = extname(file).toLowerCase();
    const mime = MIME[ext];
    if (!mime) continue;
    const stat = statSync(full);
    if (!stat.isFile()) continue;
    seen.add(full);
    const name = file.slice(0, -ext.length);
    const id = `${kind}/${name}`;
    const { width, height, hash } = fileInfo(full, ext, stat.size, stat.mtimeMs);
    // Uploaded files override generated ones with the same id.
    out.set(id, {
      id,
      kind,
      name,
      // Uploads are served under `/uploads/` wherever their folder is (`UPLOADS_DIR`).
      path: (origin === 'uploaded' ? `uploads/${relative(PATHS.uploads, full)}` : relative(PATHS.root, full)).replaceAll('\\', '/'),
      format: detectFormat(kind, name, width, height).format,
      mime,
      width: width || null,
      height: height || null,
      hash,
      origin,
    });
  }
}

/** Scans every resource folder. */
export function scanResources(): ScannedResource[] {
  const found = new Map<string, ScannedResource>();
  const seen = new Set<string>();
  for (const kind of RESOURCE_KINDS) {
    scanFolder(join(PATHS.assets, 'img'), kind, 'generated', found, seen);
    scanFolder(PATHS.audio, kind, 'generated', found, seen);
    scanFolder(join(PATHS.uploads, 'img'), kind, 'uploaded', found, seen);
    scanFolder(join(PATHS.uploads, 'audio'), kind, 'uploaded', found, seen);
  }
  // Files deleted since the last scan are forgotten.
  for (const path of known.keys()) if (!seen.has(path)) known.delete(path);
  return [...found.values()];
}
