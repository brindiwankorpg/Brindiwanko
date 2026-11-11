-- Schema of the database of Brindiwanko 1.0, in one migration: the starting point of every game made
-- with this version. Like any applied migration it is never edited again; a later change of the schema
-- goes to a new numbered file (see `server/db/migrate.ts`).

-- --- Base: settings, secrets and resources ------------------------------------------------------------

-- Key/value store for engine-wide settings edited from the admin panel
-- (game title, start position, currency name...). Values are JSON.
CREATE TABLE system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Secrets generated at first boot (e.g. session signing key). Never sent to clients.
CREATE TABLE server_secrets (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Manifest of every graphic/audio resource. Files live on disk; only metadata is stored here.
CREATE TABLE resources (
  id         TEXT PRIMARY KEY,                  -- stable identifier, e.g. 'tilesets/Outside_A2'
  kind       TEXT NOT NULL,                     -- tilesets, characters, faces, enemies, animations, system, parallaxes, pictures, bgm, bgs, me, se
  name       TEXT NOT NULL,                     -- file name without extension
  path       TEXT NOT NULL,                     -- path relative to the project root
  format     TEXT NOT NULL DEFAULT '',          -- detected sheet format, e.g. 'standard-tileset-a2'
  mime       TEXT NOT NULL,
  width      INTEGER,
  height     INTEGER,
  hash       TEXT NOT NULL DEFAULT '',
  origin     TEXT NOT NULL DEFAULT 'generated', -- generated, uploaded or imported
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_resources_kind ON resources(kind);

-- --- Accounts and sessions ----------------------------------------------------------------------------

CREATE TABLE accounts (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- login name, unique regardless of case
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,                        -- bcrypt hash, never sent anywhere
  role          TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'moderator', 'admin')),
  locale        TEXT NOT NULL DEFAULT 'en',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login    TEXT,
  banned_until  TEXT,                                 -- NULL = not banned; '9999-12-31 ...' = permanent
  ban_reason    TEXT,
  muted_until   TEXT,                                 -- chat mute, like banned_until
  mute_reason   TEXT
);
CREATE INDEX idx_accounts_role ON accounts(role);

-- express-session storage. `expires` is a Unix timestamp in milliseconds.
CREATE TABLE sessions (
  sid     TEXT PRIMARY KEY,
  sess    TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires);
-- For logging an account out everywhere (password change, ban, logout): without it,
-- `DELETE ... WHERE json_extract(sess, '$.accountId') = ?` scans the whole sessions table.
CREATE INDEX sessions_account ON sessions (json_extract(sess, '$.accountId'));

-- "Forgotten password" links sent by e-mail. Only a hash of the token is stored:
-- whoever reads the database cannot use a pending link.
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,                -- SHA-256 of the token, hex
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,                -- Unix time in milliseconds
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_password_resets_account ON password_resets(account_id);

-- --- Editor content and characters --------------------------------------------------------------------

-- Content authored in the editor's database tabs (classes, tilesets, items, skills...).
-- One row per entry; `data` is the full JSON record validated by the shared types.
CREATE TABLE game_data (
  type       TEXT NOT NULL,              -- 'class', 'tileset', 'item', 'skill', ...
  id         INTEGER NOT NULL,           -- identifier within the type, starting at 1
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (type, id)
);

CREATE TABLE characters (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  class_id    INTEGER NOT NULL,
  appearance  TEXT NOT NULL,             -- JSON, see shared/art/character.ts
  level       INTEGER NOT NULL DEFAULT 1,
  xp          INTEGER NOT NULL DEFAULT 0,
  hp          INTEGER NOT NULL,
  mp          INTEGER NOT NULL,
  gold        INTEGER NOT NULL DEFAULT 0,
  map_id      INTEGER NOT NULL,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  direction   INTEGER NOT NULL DEFAULT 2, -- 2 down, 4 left, 6 right, 8 up
  play_time   INTEGER NOT NULL DEFAULT 0, -- seconds
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_played TEXT,
  hotbar      TEXT NOT NULL DEFAULT '[]', -- JSON array of { kind, id } or null
  respawn_map INTEGER NOT NULL DEFAULT 0, -- respawn point; 0 = the start position of the System settings
  respawn_x   INTEGER NOT NULL DEFAULT 0,
  respawn_y   INTEGER NOT NULL DEFAULT 0,
  allocated   TEXT NOT NULL DEFAULT '{}', -- parameter points distributed by the player: JSON { param: points }
  bank_gold   INTEGER NOT NULL DEFAULT 0,
  -- Comparison key of the name (see shared/names.ts): case ignored in every alphabet and look-alike
  -- letters folded, so that two names that look the same cannot both exist. SQLite's NOCASE only folds ASCII.
  name_key    TEXT
);
CREATE INDEX idx_characters_account ON characters(account_id);
CREATE INDEX idx_characters_map ON characters(map_id);
CREATE INDEX idx_characters_name_key ON characters(name_key);

-- --- Maps ---------------------------------------------------------------------------------------------

-- Maps authored in the editor. The map tree (parent/order) and the full map
-- content (cells, events, properties) are stored together; `data` is JSON.
CREATE TABLE maps (
  id         INTEGER PRIMARY KEY,
  parent_id  INTEGER NOT NULL DEFAULT 0,  -- 0 = root of the tree
  name       TEXT NOT NULL,               -- editor name (the in-game name is data.displayName)
  sort_order INTEGER NOT NULL DEFAULT 0,
  expanded   INTEGER NOT NULL DEFAULT 1,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_maps_parent ON maps(parent_id, sort_order);

-- Version history of maps: a snapshot is stored at every save from the editor,
-- so any earlier state can be restored. Old snapshots are pruned per map.
CREATE TABLE map_versions (
  id         INTEGER PRIMARY KEY,
  map_id     INTEGER NOT NULL,
  data       TEXT NOT NULL,          -- full map JSON at that time
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_map_versions_map ON map_versions(map_id, id);
-- A deleted account clears the author of its map versions (ON DELETE SET NULL, by account_id).
CREATE INDEX map_versions_account ON map_versions (account_id);

-- --- Numbers never given twice ------------------------------------------------------------------------

-- SQLite gives a new row the largest number in use plus one: the number of the last account, character
-- or map deleted would come back with the next one created. What still names it would then point to a
-- stranger: the logs keep the numbers of deleted accounts and characters (a newcomer would appear in the
-- administration panel as the author of a former moderator's sanctions, or as the target of reports made
-- against somebody else), the game keeps character numbers in memory for a while (a place in a party, the
-- last private message to answer), and self switches, respawn points and transfers name maps (a chest
-- opened on the old map would show open on the new one).
--
-- The server takes each new number from this table instead (see `server/db/ids.ts` and
-- `server/db/maps.ts`): it only goes up, a deletion never lowers it.
CREATE TABLE id_sequences (
  name TEXT PRIMARY KEY,   -- table whose numbers are given: 'accounts', 'characters' or 'maps'
  seq  INTEGER NOT NULL    -- largest number given so far
);
INSERT INTO id_sequences (name, seq) VALUES ('accounts', 0), ('characters', 0), ('maps', 0);

-- --- Inventory, equipment and bank --------------------------------------------------------------------

-- Character inventories: one row per owned item, weapon or armor, with its quantity.
CREATE TABLE character_items (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_kind    TEXT NOT NULL CHECK (item_kind IN ('item', 'weapon', 'armor')),
  item_id      INTEGER NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (character_id, item_kind, item_id)
);

-- Equipped weapon / armors (one row per occupied slot); an equipped item leaves the bag.
CREATE TABLE character_equipment (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot         TEXT NOT NULL,
  item_kind    TEXT NOT NULL CHECK (item_kind IN ('weapon', 'armor')),
  item_id      INTEGER NOT NULL,
  PRIMARY KEY (character_id, slot)
);

-- The personal bank: its items (its gold is `characters.bank_gold`).
CREATE TABLE character_bank (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_kind    TEXT NOT NULL CHECK (item_kind IN ('item', 'weapon', 'armor')),
  item_id      INTEGER NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (character_id, item_kind, item_id)
);

-- --- Story progress -----------------------------------------------------------------------------------

-- Personal switches / variables / self switches / quests of each character, and global (server-wide)
-- switches and variables. Only non-default values are stored (a switch that is OFF or a variable at 0
-- has no row).

CREATE TABLE character_switches (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  switch_id    INTEGER NOT NULL,
  PRIMARY KEY (character_id, switch_id)
);

CREATE TABLE character_variables (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  variable_id  INTEGER NOT NULL,
  value        INTEGER NOT NULL,
  PRIMARY KEY (character_id, variable_id)
);

-- Self switches belong to one event of one map, for one character
-- (a chest opened by me stays closed for the others).
CREATE TABLE character_self_switches (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  map_id       INTEGER NOT NULL,
  event_id     INTEGER NOT NULL,
  letter       TEXT NOT NULL CHECK (letter IN ('A', 'B', 'C', 'D')),
  PRIMARY KEY (character_id, map_id, event_id, letter)
);

CREATE TABLE character_quests (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_id     INTEGER NOT NULL,
  status       INTEGER NOT NULL CHECK (status IN (1, 2)), -- 1 in progress, 2 completed
  step         INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  -- Counters of the current step (talk / kill / reach objectives), as a JSON array indexed like the
  -- step's objectives.
  counters     TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (character_id, quest_id)
);

CREATE TABLE global_switches (
  switch_id INTEGER PRIMARY KEY
);

CREATE TABLE global_variables (
  variable_id INTEGER PRIMARY KEY,
  value       INTEGER NOT NULL
);

-- --- Skills and raids ---------------------------------------------------------------------------------

-- Skills a character learned outside its class (a skill book, an event...). Skills of the class come
-- from its learnings and are not stored.
CREATE TABLE character_skills (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL,
  learned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (character_id, skill_id)
);

-- Raid lockouts: a character receives the rewards of a raid once per period.
CREATE TABLE character_raid_lockouts (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  raid_id      INTEGER NOT NULL,
  until        INTEGER NOT NULL, -- epoch milliseconds
  PRIMARY KEY (character_id, raid_id)
);

-- --- Social: friends, ignores and trades --------------------------------------------------------------

-- Friends and ignore lists are also read the other way round ("who has this character as a friend", to
-- tell them it logged in), and a deleted character is removed from the lists of the others (ON DELETE
-- CASCADE looks its rows up by friend_id / ignored_id): hence the second index of each.

CREATE TABLE character_friends (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  friend_id    INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (character_id, friend_id)
);
CREATE INDEX character_friends_friend ON character_friends (friend_id);

CREATE TABLE character_ignores (
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  ignored_id   INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  PRIMARY KEY (character_id, ignored_id)
);
CREATE INDEX character_ignores_ignored ON character_ignores (ignored_id);

-- One row per completed trade; items as JSON arrays of { kind, id, quantity }.
CREATE TABLE trade_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  a_id       INTEGER NOT NULL,
  b_id       INTEGER NOT NULL,
  a_items    TEXT NOT NULL,
  b_items    TEXT NOT NULL,
  a_gold     INTEGER NOT NULL,
  b_gold     INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX trade_log_a ON trade_log (a_id);
CREATE INDEX trade_log_b ON trade_log (b_id);
CREATE INDEX trade_log_created ON trade_log (created_at);

-- --- Guilds -------------------------------------------------------------------------------------------

-- Identity (name, tag, emblem), message of the day, level and experience, bank gold; ranks with
-- permissions; members; bank items; log.
CREATE TABLE guilds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tag        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  emblem     TEXT NOT NULL,
  motd       TEXT NOT NULL DEFAULT '',
  level      INTEGER NOT NULL DEFAULT 1,
  xp         INTEGER NOT NULL DEFAULT 0,
  gold       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Comparison keys of the name and the tag, like characters.name_key.
  name_key   TEXT,
  tag_key    TEXT
);
CREATE INDEX idx_guilds_name_key ON guilds(name_key);
CREATE INDEX idx_guilds_tag_key ON guilds(tag_key);

-- Rank 0 is the leader; higher numbers are lower ranks.
CREATE TABLE guild_ranks (
  guild_id    INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  rank        INTEGER NOT NULL,
  name        TEXT NOT NULL,
  permissions INTEGER NOT NULL,
  PRIMARY KEY (guild_id, rank)
);

CREATE TABLE guild_members (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  guild_id     INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  rank         INTEGER NOT NULL,
  joined_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX guild_members_guild ON guild_members (guild_id);

CREATE TABLE guild_bank_items (
  guild_id  INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('item', 'weapon', 'armor')),
  item_id   INTEGER NOT NULL,
  quantity  INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (guild_id, item_kind, item_id)
);

CREATE TABLE guild_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  character_id INTEGER,
  action       TEXT NOT NULL,
  details      TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX guild_log_guild ON guild_log (guild_id, id);
CREATE INDEX guild_log_created ON guild_log (created_at);

-- --- Administration logs ------------------------------------------------------------------------------

-- Logs read by the administration panel: connections, administrator actions, shop sales, rare drops and
-- player reports (trades are in trade_log, above). Each one is read by its subject, and the daily purge
-- of the logs deletes by date: hence their two indexes.

CREATE TABLE connection_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id   INTEGER NOT NULL,
  character_id INTEGER,
  event        TEXT NOT NULL CHECK (event IN ('login', 'logout')),
  ip           TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX connection_log_account ON connection_log (account_id, id);
CREATE INDEX connection_log_created ON connection_log (created_at);

CREATE TABLE admin_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   INTEGER NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  details    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX admin_log_admin ON admin_log (admin_id, id);
CREATE INDEX admin_log_created ON admin_log (created_at);

CREATE TABLE sale_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('buy', 'sell')),
  item_kind    TEXT NOT NULL,
  item_id      INTEGER NOT NULL,
  quantity     INTEGER NOT NULL,
  price        INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sale_log_character ON sale_log (character_id, id);
CREATE INDEX sale_log_created ON sale_log (created_at);

CREATE TABLE drop_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  enemy_id     INTEGER NOT NULL,
  item_kind    TEXT NOT NULL,
  item_id      INTEGER NOT NULL,
  chance       REAL NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX drop_log_character ON drop_log (character_id, id);
CREATE INDEX drop_log_created ON drop_log (created_at);

-- Player reports ("Report" in the menu of a player). Names are kept so a report survives the deletion
-- of the characters.
CREATE TABLE report_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id   INTEGER,
  reporter_name TEXT NOT NULL,
  target_id     INTEGER,
  target_name   TEXT NOT NULL,
  reason        TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX report_log_target ON report_log (target_id, id);
CREATE INDEX report_log_created ON report_log (created_at);
