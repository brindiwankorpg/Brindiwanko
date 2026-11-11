/**
 * @file Storage of resources uploaded by administrators (editor resource
 * manager and project imports).
 *
 * Files go to `uploads/img/<kind>/` or `uploads/audio/<kind>/` under a
 * sanitised name. Only known image and audio types are accepted, recognised by
 * their content (magic bytes), not by the name. SVG files are accepted only
 * when they contain no scripting or external references, because uploads are
 * served from the game's own origin.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { IMAGE_KINDS, RESOURCE_KINDS, type ResourceKind } from '../../shared/resource-formats.js';
import { PATHS } from '../paths.js';

/** Largest accepted file. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Detected file type of an upload. */
export type UploadType = 'png' | 'jpg' | 'webp' | 'svg' | 'ogg' | 'm4a' | 'mp3' | 'wav';

/**
 * Recognises a file type from its first bytes.
 * @param data - File content.
 * @returns The type, or `null` when unsupported.
 */
export function sniffType(data: Buffer): UploadType | null {
  if (data.length >= 8 && data.readUInt32BE(0) === 0x89504e47) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (data.length >= 4 && data.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (data.length >= 8 && data.toString('ascii', 4, 8) === 'ftyp') return 'm4a';
  if (data.length >= 3 && (data.toString('ascii', 0, 3) === 'ID3' || (data[0] === 0xff && (data[1]! & 0xe0) === 0xe0))) return 'mp3';
  const head = data.subarray(0, 1024).toString('utf8').trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return null;
}

/** Named character references that can hide a dangerous scheme or separator. */
const NAMED_REFERENCES: Record<string, string> = { colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')', quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' };

/** Decodes the character references of a text (`&#106;`, `&#x6A;`, `&colon;`...). */
function decodeReferences(text: string): string {
  return text.replace(/&(?:#0*(\d{1,7})|#x0*([0-9a-f]{1,6})|([a-z]+));?/gi, (all, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    const code = dec !== undefined ? Number(dec) : hex !== undefined ? Number.parseInt(hex, 16) : -1;
    if (code >= 0) return code <= 0x10ffff ? String.fromCodePoint(code) : '';
    return NAMED_REFERENCES[name!.toLowerCase()] ?? all;
  });
}

/**
 * Tells whether an SVG document is safe to serve from the game's origin: no
 * scripts, no event handler attributes, no embedded HTML, no external or
 * `javascript:` links, no animation rewriting a link, no entity declarations.
 * Character references are decoded first so they cannot hide a forbidden word.
 * (Uploads are also served with a sandboxing Content-Security-Policy.)
 * @param svg - SVG source.
 */
export function isSafeSvg(svg: string): boolean {
  const lower = decodeReferences(svg).toLowerCase();
  // Without spaces and control characters: `java\tscript:` is still `javascript:` for a browser.
  const compact = lower.replace(/[\s\u0000-\u001f]+/g, '');
  if (/<script|<foreignobject|<iframe|<object|<embed|<!entity|<!doctype|<handler|<listener/.test(lower)) return false;
  if (/[\s/"']on[a-z]+\s*=/.test(lower)) return false;
  if (/javascript:|data:text\/html|vbscript:|data:image\/svg/.test(compact)) return false;
  // Animations may not rewrite links or event attributes.
  if (/attributename\s*=\s*["']?\s*(?:xlink:)?(?:href|on)/.test(lower)) return false;
  // Links may only point inside the document (#id).
  for (const m of lower.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/g)) if (!m[1]!.trim().startsWith('#')) return false;
  if (/(?:xlink:)?href\s*=\s*[^"'\s]/.test(lower)) return false;
  if (/url\(\s*["']?(?!#)/.test(lower) || /@import/.test(lower)) return false;
  return true;
}

/**
 * Makes a safe file name: keeps letters, digits, `_`, `-`, spaces and the
 * special sheet prefixes `$` and `!`; strips paths and extensions.
 * @param name - Name proposed by the client.
 */
export function sanitizeName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const withoutExt = base.replace(/\.[a-z0-9]+$/i, '');
  return withoutExt.replace(/[^\p{L}\p{N}_\-$! ]/gu, '').trim().slice(0, 80);
}

/** Tells whether a kind is valid for a file type. */
function kindMatchesType(kind: ResourceKind, type: UploadType): boolean {
  const image = type === 'png' || type === 'jpg' || type === 'webp' || type === 'svg';
  return image === IMAGE_KINDS.includes(kind);
}

/**
 * Largest image accepted: every player's browser decodes it in memory (a
 * 16384 × 4096 sheet already takes 256 MB), and canvases have size limits.
 */
export const MAX_IMAGE_SIDE = 16_384;
export const MAX_IMAGE_PIXELS = 64_000_000;

/** Pixel size of an image. */
interface PixelSize {
  width: number;
  height: number;
}

/** Size written in a JPEG frame header (the first SOFn marker). */
function jpegSize(data: Buffer): PixelSize | null {
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = data[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    // Markers without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    // SOF0-SOF15 carry the size, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
    }
    i += 2 + data.readUInt16BE(i + 2);
  }
  return null;
}

/** Size of a WebP image (lossy, lossless or extended format). */
function webpSize(data: Buffer): PixelSize | null {
  if (data.length < 30) return null;
  const chunk = data.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = data.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
  return null;
}

/** Size given by the `width` and `height` attributes of an SVG root element, when they are plain numbers. */
function svgSize(data: Buffer): PixelSize | null {
  const root = /<svg\b[^>]*>/i.exec(data.subarray(0, 4096).toString('utf8'))?.[0] ?? '';
  const read = (name: string) => Number(new RegExp(`\\s${name}\\s*=\\s*["']\\s*(\\d+(?:\\.\\d+)?)\\s*(?:px)?\\s*["']`, 'i').exec(root)?.[1] ?? Number.NaN);
  const width = read('width');
  const height = read('height');
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
}

/**
 * Pixel size of an uploaded image, read from its header.
 * @returns The size, or `null` when unknown (sounds, unusual headers).
 */
export function pixelSize(data: Buffer, type: UploadType): PixelSize | null {
  if (type === 'png') return data.length >= 24 ? { width: data.readUInt32BE(16), height: data.readUInt32BE(20) } : null;
  if (type === 'jpg') return jpegSize(data);
  if (type === 'webp') return webpSize(data);
  if (type === 'svg') return svgSize(data);
  return null;
}

/** Offset of the start of scan of a JPEG, found by walking its segments (a thumbnail inside one is skipped), or -1. */
function jpegScan(data: Buffer): number {
  let i = 2;
  while (i + 4 <= data.length) {
    if (data[i] !== 0xff) return -1;
    const marker = data[i + 1]!;
    if (marker === 0xff) i++;
    else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) i += 2;
    else if (marker === 0xda) return i;
    else if (marker === 0xd9) return -1;
    else i += 2 + data.readUInt16BE(i + 2);
  }
  return -1;
}

/** Every chunk of a PNG is whole with a right checksum, from IHDR to IEND, with image data. */
function isCompletePng(data: Buffer): boolean {
  let i = 8;
  let pixels = false;
  while (i + 12 <= data.length) {
    const length = data.readUInt32BE(i);
    const end = i + 12 + length;
    if (end > data.length) return false;
    const type = data.toString('latin1', i + 4, i + 8);
    if (crc32(data.subarray(i + 4, i + 8 + length)) !== data.readUInt32BE(i + 8 + length)) return false;
    if (i === 8 && (type !== 'IHDR' || length !== 13)) return false;
    if (type === 'IDAT') pixels = true;
    if (type === 'IEND') return pixels;
    i = end;
  }
  return false;
}

/**
 * Tells whether an image is complete and undamaged, as far as its structure shows: a cut or damaged
 * upload must not replace a working picture. PNG: every chunk with its checksum, up to IEND. JPEG: the
 * end marker after the image data. WebP: the bytes its header announces. SVG: its closing tag.
 * Sounds are not checked.
 */
export function isCompleteImage(data: Buffer, type: UploadType): boolean {
  if (type === 'png') return isCompletePng(data);
  if (type === 'jpg') {
    const scan = jpegScan(data);
    return scan > 0 && data.lastIndexOf(Buffer.from([0xff, 0xd9])) > scan;
  }
  if (type === 'webp') return data.length >= 20 && 8 + data.readUInt32LE(4) <= data.length && 20 + data.readUInt32LE(16) <= data.length;
  if (type === 'svg') return /<\/svg\s*>/i.test(data.toString('utf8'));
  return true;
}

/** Result of storing an upload. */
export type StoreResult = { ok: true; id: string } | { ok: false; errorKey: string; params?: Record<string, number> };

/**
 * Validates and writes an uploaded file.
 * @param kind - Resource folder.
 * @param name - Proposed name.
 * @param data - Content.
 */
export function storeUpload(kind: string, name: string, data: Buffer): StoreResult {
  if (!RESOURCE_KINDS.includes(kind as ResourceKind)) return { ok: false, errorKey: 'error.resources.invalid_kind' };
  if (data.length === 0 || data.length > MAX_UPLOAD_BYTES) return { ok: false, errorKey: 'error.resources.too_large' };
  const type = sniffType(data);
  if (!type) return { ok: false, errorKey: 'error.resources.unsupported_type' };
  if (!kindMatchesType(kind as ResourceKind, type)) return { ok: false, errorKey: 'error.resources.wrong_kind' };
  if (type === 'svg' && !isSafeSvg(data.toString('utf8'))) return { ok: false, errorKey: 'error.resources.unsafe_svg' };
  const size = pixelSize(data, type);
  if (size && (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE || size.width * size.height > MAX_IMAGE_PIXELS)) {
    return { ok: false, errorKey: 'error.resources.image_too_large', params: { max: MAX_IMAGE_SIDE, pixels: MAX_IMAGE_PIXELS / 1_000_000 } };
  }
  if (!isCompleteImage(data, type)) return { ok: false, errorKey: 'error.resources.damaged_image' };
  const clean = sanitizeName(name);
  if (!clean) return { ok: false, errorKey: 'error.resources.invalid_name' };
  const folder = uploadFolder(kind as ResourceKind);
  mkdirSync(folder, { recursive: true });
  // Written aside first, then put in place in one step: the current file stays as long as the new one is
  // not whole on disk (a full disk keeps the working picture).
  const target = join(folder, `${clean}.${type}`);
  const part = `${target}.${process.pid}.part`;
  try {
    writeFileSync(part, data);
    renameSync(part, target);
  } catch (err) {
    rmSync(part, { force: true });
    throw err;
  }
  // One file per resource id: the other extensions of the same name go once the new one is in place.
  for (const ext of UPLOAD_EXTENSIONS) {
    const other = join(folder, `${clean}.${ext}`);
    if (ext !== type && existsSync(other)) unlinkSync(other);
  }
  return { ok: true, id: `${kind}/${clean}` };
}

const UPLOAD_EXTENSIONS: readonly UploadType[] = ['png', 'jpg', 'webp', 'svg', 'ogg', 'm4a', 'mp3', 'wav'];

/** Folder of the uploads of a kind. */
function uploadFolder(kind: ResourceKind): string {
  return join(PATHS.uploads, IMAGE_KINDS.includes(kind) ? 'img' : 'audio', kind);
}

/** Uploaded files of one resource name as they were before a change, to put them back. */
export interface UploadSnapshot {
  folder: string;
  name: string;
  files: { file: string; data: Buffer }[];
}

/**
 * Keeps a copy of the uploaded files a resource name has now (none for a new
 * resource), before `storeUpload` replaces them.
 * @returns `null` for an invalid kind or name (nothing would be written).
 */
export function snapshotUpload(kind: string, name: string): UploadSnapshot | null {
  const clean = sanitizeName(name);
  if (!RESOURCE_KINDS.includes(kind as ResourceKind) || !clean) return null;
  const folder = uploadFolder(kind as ResourceKind);
  const files = UPLOAD_EXTENSIONS.map((ext) => `${clean}.${ext}`)
    .filter((file) => existsSync(join(folder, file)))
    .map((file) => ({ file, data: readFileSync(join(folder, file)) }));
  return { folder, name: clean, files };
}

/** Puts back the files of a snapshot: what was written since under that name is removed. */
export function restoreUpload(snapshot: UploadSnapshot): void {
  for (const ext of UPLOAD_EXTENSIONS) {
    const file = join(snapshot.folder, `${snapshot.name}.${ext}`);
    if (existsSync(file)) unlinkSync(file);
  }
  for (const { file, data } of snapshot.files) writeFileSync(join(snapshot.folder, file), data);
}

/**
 * Deletes an uploaded resource (generated resources cannot be deleted).
 * @param path - Path as stored in the manifest (`uploads/img/<kind>/<file>`).
 */
export function deleteUpload(path: string): boolean {
  if (!path.startsWith('uploads/') || path.includes('..')) return false;
  const full = join(PATHS.uploads, path.slice('uploads/'.length));
  if (!existsSync(full)) return false;
  unlinkSync(full);
  return true;
}

/**
 * Guesses the resource kind of an image from its name and size, for drops
 * without an explicit folder (standard sheet suffixes, `$`/`!` character
 * prefixes, face and window sizes...).
 */
export function guessKind(name: string, width: number, height: number): ResourceKind {
  const lower = name.toLowerCase();
  if (/_(a[1-5]|[b-e])$/.test(lower) || (width === 480 && height === 256) || (width === 96 && height === 128)) return 'tilesets';
  if (lower === 'window' || lower === 'iconset' || lower === 'balloon' || lower.startsWith('shadow')) return 'system';
  if (lower.startsWith('$') || lower.startsWith('!')) return 'characters';
  if ((width === 576 && height === 288) || (width === 192 && height === 192)) return 'faces';
  if (width % 12 === 0 && height % 8 === 0 && width / 12 <= 96 && height / 8 <= 128) return 'characters';
  if (width >= 800 || height >= 600) return 'parallaxes';
  return 'pictures';
}
