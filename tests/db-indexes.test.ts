/**
 * @file Database lookups that used to walk through whole tables now use an index (see the migration), the
 * connection has its larger page cache, and the log purge runs in one transaction.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { purgeOldLogs } from '../server/db/backups.js';
import { openDatabase } from '../server/db/database.js';
import { migrate } from '../server/db/migrate.js';
import { PATHS } from '../server/paths.js';

/** Plan SQLite chooses for a query, as one line. */
function plan(db: ReturnType<typeof openDatabase>, sql: string): string {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(' | ');
}

test('reverse friend and ignore lookups, map versions by author and logs by date use an index', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db, PATHS.migrations);
    assert.match(plan(db, 'SELECT character_id FROM character_friends WHERE friend_id = 1'), /USING (COVERING )?INDEX character_friends_friend/);
    assert.match(plan(db, 'SELECT character_id FROM character_ignores WHERE ignored_id = 1'), /USING (COVERING )?INDEX character_ignores_ignored/);
    assert.match(plan(db, 'SELECT id FROM map_versions WHERE account_id = 1'), /USING (COVERING )?INDEX map_versions_account/);
    for (const table of ['connection_log', 'admin_log', 'sale_log', 'drop_log', 'trade_log', 'guild_log', 'report_log']) {
      assert.match(plan(db, `SELECT id FROM ${table} WHERE created_at < '2000-01-01'`), new RegExp(`USING (COVERING )?INDEX ${table}_created`), table);
    }
    assert.match(plan(db, "SELECT id FROM admin_log WHERE target = 'server'"), /USING (COVERING )?INDEX idx_admin_log_target/);
    assert.match(plan(db, 'SELECT character_id FROM character_self_switches WHERE map_id = 1'), /USING (COVERING )?INDEX idx_char_self_switches_map/);
    assert.match(plan(db, 'SELECT id FROM characters WHERE class_id = 1'), /USING (COVERING )?INDEX idx_characters_class/);
    assert.match(plan(db, 'SELECT id FROM characters WHERE respawn_map = 1'), /USING (COVERING )?INDEX idx_characters_respawn_map/);
    assert.match(plan(db, 'SELECT character_id FROM character_skills WHERE skill_id = 1'), /USING (COVERING )?INDEX idx_character_skills_skill/);
    assert.match(plan(db, 'SELECT character_id FROM character_quests WHERE quest_id = 1'), /USING (COVERING )?INDEX idx_character_quests_quest/);
    assert.match(plan(db, "SELECT character_id FROM character_items WHERE item_kind = 'item' AND item_id = 1"), /USING (COVERING )?INDEX idx_character_items_item/);
    assert.match(plan(db, "SELECT character_id FROM character_bank WHERE item_kind = 'item' AND item_id = 1"), /USING (COVERING )?INDEX idx_character_bank_item/);
    assert.match(plan(db, "SELECT character_id FROM character_equipment WHERE item_kind = 'weapon' AND item_id = 1"), /USING (COVERING )?INDEX idx_character_equipment_item/);
    assert.match(plan(db, "SELECT guild_id FROM guild_bank_items WHERE item_kind = 'item' AND item_id = 1"), /USING (COVERING )?INDEX idx_guild_bank_items_item/);
    assert.match(plan(db, 'SELECT character_id FROM character_raid_lockouts WHERE raid_id = 1'), /USING (COVERING )?INDEX idx_raid_lockouts_raid/);
    assert.equal(db.pragma('cache_size', { simple: true }), -32000);
  } finally {
    db.close();
  }
});

test('the log purge deletes in one transaction', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db, PATHS.migrations);
    let transactions = 0;
    const original = db.transaction.bind(db);
    db.transaction = ((fn: (...args: never[]) => unknown) => {
      transactions++;
      return original(fn);
    }) as typeof db.transaction;
    assert.equal(purgeOldLogs(db), 0);
    assert.equal(transactions, 1);
  } finally {
    db.close();
  }
});
