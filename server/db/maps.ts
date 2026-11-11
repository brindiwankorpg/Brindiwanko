/**
 * @file Repository of the `maps` table (map tree and map content).
 *
 * Map content is parsed once and cached; the editor's saves go through
 * `save()`, which refreshes the cache so that the live world picks up the new
 * version immediately.
 */
import type { Statement } from 'better-sqlite3';
import type { MapData, MapInfo } from '../../shared/map.js';
import type { Db } from './database.js';

/** A saved snapshot of a map. */
export interface MapVersion {
  id: number;
  mapId: number;
  accountId: number | null;
  createdAt: string;
}

/** Snapshots kept per map; older ones are pruned. */
export const MAX_VERSIONS_PER_MAP = 50;

interface MapInfoRow {
  id: number;
  parent_id: number;
  name: string;
  sort_order: number;
  expanded: number;
}

/** Data access for maps. */
export class MapRepository {
  private readonly infosStmt: Statement<[], MapInfoRow>;
  private readonly infoStmt: Statement<[number], MapInfoRow>;
  private readonly dataStmt: Statement<[number], string>;
  private readonly upsertStmt: Statement<[number, number, string, number, number, string]>;
  private readonly countStmt: Statement<[], number>;
  private readonly maxIdStmt: Statement<[], number>;
  private readonly givenIdStmt: Statement<[], number>;
  private readonly bumpIdStmt: Statement<[number]>;
  private readonly deleteStmt: Statement<[number]>;
  private readonly deleteSelfSwitchesStmt: Statement<[number]>;
  private readonly insertVersionStmt: Statement<[number, string, number | null]>;
  private readonly listVersionsStmt: Statement<[number], { id: number; map_id: number; account_id: number | null; created_at: string }>;
  private readonly versionDataStmt: Statement<[number, number], string>;
  private readonly pruneStmt: Statement<[number, number, number]>;
  private readonly deleteVersionsStmt: Statement<[number]>;
  private readonly revisionStmt: Statement<[number], number>;
  private readonly cache = new Map<number, MapData>();
  private readonly listeners: ((id: number, map: MapData | undefined) => void)[] = [];

  constructor(private readonly db: Db) {
    this.infosStmt = db.prepare('SELECT id, parent_id, name, sort_order, expanded FROM maps ORDER BY parent_id, sort_order, id');
    this.infoStmt = db.prepare('SELECT id, parent_id, name, sort_order, expanded FROM maps WHERE id = ?');
    this.dataStmt = db.prepare<[number], string>('SELECT data FROM maps WHERE id = ?').pluck();
    this.upsertStmt = db.prepare(`INSERT INTO maps (id, parent_id, name, sort_order, expanded, data) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name, sort_order = excluded.sort_order,
        expanded = excluded.expanded, data = excluded.data, updated_at = datetime('now')`);
    this.countStmt = db.prepare<[], number>('SELECT COUNT(*) FROM maps').pluck();
    this.maxIdStmt = db.prepare<[], number>('SELECT COALESCE(MAX(id), 0) FROM maps').pluck();
    // The largest map number ever given (`id_sequences`): it only goes up, a deletion does not lower it.
    this.givenIdStmt = db.prepare<[], number>("SELECT COALESCE((SELECT seq FROM id_sequences WHERE name = 'maps'), 0)").pluck();
    this.bumpIdStmt = db.prepare("INSERT INTO id_sequences (name, seq) VALUES ('maps', ?) ON CONFLICT(name) DO UPDATE SET seq = MAX(seq, excluded.seq)");
    this.deleteStmt = db.prepare('DELETE FROM maps WHERE id = ?');
    this.deleteSelfSwitchesStmt = db.prepare('DELETE FROM character_self_switches WHERE map_id = ?');
    this.insertVersionStmt = db.prepare('INSERT INTO map_versions (map_id, data, account_id) VALUES (?, ?, ?)');
    this.listVersionsStmt = db.prepare('SELECT id, map_id, account_id, created_at FROM map_versions WHERE map_id = ? ORDER BY id DESC');
    this.versionDataStmt = db.prepare<[number, number], string>('SELECT data FROM map_versions WHERE id = ? AND map_id = ?').pluck();
    // Keep the newest N snapshots of a map.
    this.pruneStmt = db.prepare(`DELETE FROM map_versions WHERE map_id = ? AND id NOT IN
      (SELECT id FROM map_versions WHERE map_id = ? ORDER BY id DESC LIMIT ?)`);
    this.deleteVersionsStmt = db.prepare('DELETE FROM map_versions WHERE map_id = ?');
    this.revisionStmt = db.prepare<[number], number>('SELECT COALESCE(MAX(id), 0) FROM map_versions WHERE map_id = ?').pluck();
  }

  /**
   * Number of the next map: above every map in use and above every map ever given, so that the number of a
   * deleted map never comes back (the self switches, the places and the transfers that still name it would
   * point to a stranger). Does not give the number: it is taken when the map is written.
   */
  nextId(): number {
    return Math.max(this.maxIdStmt.get()!, this.givenIdStmt.get()!) + 1;
  }

  /**
   * Saves a map from the editor and records a snapshot in the history, in one transaction. The content in
   * memory changes only once the transaction went through: a failed save (full disk...) leaves the map that
   * is stored. Called inside a larger transaction, its caller drops the content again if that one fails
   * (see `forget`).
   * @param info - Tree entry.
   * @param data - Content.
   * @param accountId - Author of the change.
   */
  saveWithVersion(info: MapInfo, data: MapData, accountId: number | null): void {
    this.db.transaction(() => {
      // A map never edited (such as one created by the seed) has no snapshot yet: keep its previous content so the first edit can be undone from the history.
      const previous = this.dataStmt.get(info.id);
      if (previous !== undefined && this.listVersionsStmt.all(info.id).length === 0) this.insertVersionStmt.run(info.id, previous, null);
      this.write(info, data);
      this.insertVersionStmt.run(info.id, JSON.stringify(data), accountId);
      this.pruneStmt.run(info.id, info.id, MAX_VERSIONS_PER_MAP);
    })();
    this.publish(info.id, data);
  }

  /** Deletes a map, its history and the self switches the players had on it (nothing can read them again). */
  delete(id: number): void {
    this.db.transaction(() => {
      this.deleteStmt.run(id);
      this.deleteVersionsStmt.run(id);
      this.deleteSelfSwitchesStmt.run(id);
    })();
    this.cache.delete(id);
    for (const listener of this.listeners) listener(id, undefined);
  }

  /**
   * Drops the cached content of maps: it is read again from the database. Needed after a transaction
   * that saved maps was rolled back (the cache would keep content that was never stored).
   */
  forget(ids: Iterable<number>): void {
    for (const id of ids) {
      this.cache.delete(id);
      const map = this.get(id);
      for (const listener of this.listeners) listener(id, map);
    }
  }

  /** Calls `listener` after each save (with the new content) and deletion (`undefined`) of a map. */
  onChange(listener: (id: number, map: MapData | undefined) => void): void {
    this.listeners.push(listener);
  }

  /** Snapshots of a map, newest first. */
  versions(mapId: number): MapVersion[] {
    return this.listVersionsStmt.all(mapId).map((r) => ({ id: r.id, mapId: r.map_id, accountId: r.account_id, createdAt: r.created_at }));
  }

  /**
   * Revision of a map: the id of its latest snapshot (0 before its first edit). Every save from the
   * editor makes a new one, so an editor that loaded an older revision knows its copy is out of date.
   */
  revision(mapId: number): number {
    return this.revisionStmt.get(mapId) ?? 0;
  }

  /** Content of a snapshot. */
  version(mapId: number, versionId: number): MapData | undefined {
    const raw = this.versionDataStmt.get(versionId, mapId);
    return raw === undefined ? undefined : (JSON.parse(raw) as MapData);
  }

  /** The map tree. */
  infos(): MapInfo[] {
    return this.infosStmt.all().map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      name: r.name,
      order: r.sort_order,
      expanded: r.expanded === 1,
    }));
  }

  /** Name of a map in the tree (one row read by its id, not the whole tree). */
  info(id: number): MapInfo | undefined {
    const r = this.infoStmt.get(id);
    return r && { id: r.id, parentId: r.parent_id, name: r.name, order: r.sort_order, expanded: r.expanded === 1 };
  }

  /** Content of a map, or `undefined`. */
  get(id: number): MapData | undefined {
    let map = this.cache.get(id);
    if (!map) {
      const raw = this.dataStmt.get(id);
      if (raw === undefined) return undefined;
      map = JSON.parse(raw) as MapData;
      this.cache.set(id, map);
    }
    return map;
  }

  /** Forgets the parsed content of a map nobody plays on (it is read again when needed). */
  release(id: number): void {
    this.cache.delete(id);
  }

  /** Content of a map for a single reading: parsed again (not kept) when it is not in memory. */
  peek(id: number): MapData | undefined {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const raw = this.dataStmt.get(id);
    return raw === undefined ? undefined : (JSON.parse(raw) as MapData);
  }

  /** Number of maps. */
  count(): number {
    return this.countStmt.get()!;
  }

  /**
   * Inserts or replaces a map.
   * @param info - Tree entry.
   * @param data - Content.
   */
  save(info: MapInfo, data: MapData): void {
    this.write(info, data);
    this.publish(info.id, data);
  }

  private write(info: MapInfo, data: MapData): void {
    this.upsertStmt.run(info.id, info.parentId, info.name, info.order, info.expanded ? 1 : 0, JSON.stringify(data));
    // Every map written (created in the editor, imported, seeded) raises the largest number given.
    this.bumpIdStmt.run(info.id);
  }

  /** The content of a map was stored: it becomes the one in memory, and the listeners hear of it. */
  private publish(id: number, data: MapData): void {
    this.cache.set(id, data);
    for (const listener of this.listeners) listener(id, data);
  }
}
