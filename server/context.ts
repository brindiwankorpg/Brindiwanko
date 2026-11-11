/**
 * @file The server context: the set of long-lived services (database connection,
 * repositories, configuration) shared by HTTP routes, socket handlers and the
 * game loop. It is created once in `index.ts` and passed explicitly, which keeps
 * modules free of hidden global state and lets tests build an isolated context
 * on an in-memory database.
 */
import type { RequestHandler } from 'express';
import { EditLocks } from './admin/edit-locks.js';
import { AuthService } from './auth/service.js';
import type { Config } from './config.js';
import { AccountRepository } from './db/accounts.js';
import { CharacterRepository } from './db/characters.js';
import type { Db } from './db/database.js';
import { openDatabase } from './db/database.js';
import { GameDataRepository } from './db/game-data.js';
import { InventoryRepository } from './db/inventory.js';
import { MapRepository } from './db/maps.js';
import { ResourceRepository } from './db/resources.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { ProgressionRepository } from './db/progression.js';
import { SocialRepository } from './db/social.js';
import { GuildRepository } from './db/guilds.js';
import { AdminRepository } from './db/admin.js';
import { SqliteSessionStore } from './db/session-store.js';
import { SettingsRepository } from './db/settings.js';
import { CharacterService } from './game/character-service.js';
import { InventoryService } from './game/inventory-service.js';
import { World } from './game/world.js';
import type { Locale } from '../shared/i18n.js';
import { DEFAULT_SETTINGS } from '../shared/settings.js';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { stopSandbox } from './events/sandbox.js';
import { createSessionMiddleware } from './http/session.js';
import { createMailer, type Mailer } from './mail.js';
import { PATHS } from './paths.js';
import { applyPendingRestore, undoRestore } from './db/backups.js';
import { scanResources } from './resources/scanner.js';

/** Services available to every part of the server. */
export interface ServerContext {
  config: Config;
  db: Db;
  settings: SettingsRepository;
  accounts: AccountRepository;
  auth: AuthService;
  resources: ResourceRepository;
  gameData: GameDataRepository;
  characters: CharacterRepository;
  characterService: CharacterService;
  maps: MapRepository;
  inventory: InventoryRepository;
  inventoryService: InventoryService;
  /** Story progress (switches, variables, self switches, quests) and equipment. */
  progression: ProgressionRepository;
  /** Friend and ignore lists, trades. */
  social: SocialRepository;
  /** Guilds, their ranks, bank and log. */
  guilds: GuildRepository;
  /** Sanctions and logs of the administration panel. */
  admin: AdminRepository;
  /** Editor locks (one administrator per map). */
  editLocks: EditLocks;
  /** Live world (loaded maps, connected players). */
  world: World;
  sessionStore: SqliteSessionStore;
  /** Session middleware shared by Express and socket.io. */
  sessionMiddleware: RequestHandler;
  /** E-mails (forgotten password links). */
  mailer: Mailer;
  /** The server is shutting down: the readiness probe fails so that no new player is sent here. */
  stopping: boolean;
}

/** Options mainly useful for tests. */
export interface ContextOptions {
  /** Password hashing cost (default 11). */
  bcryptRounds?: number;
  /** Language of the demo content if the database is brand new (default French); see `first-run.ts`. */
  contentLanguage?: Locale;
  /** E-mail sender (default: from the configuration, see `mail.ts`). */
  mailer?: Mailer;
}

/**
 * Opens the database, applies migrations and seed data, and builds the context.
 * @param config - Server configuration (the database path is taken from it).
 * @param options - Optional overrides.
 * @returns A fully initialised context.
 */
export function createContext(config: Config, options: ContextOptions = {}): ServerContext {
  // A restoration waiting for this database (panel or `npm run restore`) is applied before it is opened.
  const restored = applyPendingRestore(config.dbPath, PATHS.uploads);
  if (restored) console.log('[brindiwanko] database restored from a backup');
  const db = openDatabase(config.dbPath);
  try {
    migrate(db, PATHS.migrations);
    seed(db, options.contentLanguage);
    return assemble(db, config, options);
  } catch (err) {
    db.close();
    // A restored database the game cannot start on must not keep the server down: the previous one is put back.
    if (!restored || !undoRestore(config.dbPath, PATHS.uploads)) throw err;
    console.error('[brindiwanko] the restored backup could not be started: the previous database is put back (the refused one is kept as .failed-restore)', err);
    return createContext(config, options);
  }
}

class ServerContextContainer implements ServerContext {
  readonly world: World;
  stopping = false;

  constructor(
    readonly config: Config,
    readonly db: Db,
    readonly settings: SettingsRepository,
    readonly accounts: AccountRepository,
    readonly auth: AuthService,
    readonly resources: ResourceRepository,
    readonly gameData: GameDataRepository,
    readonly characters: CharacterRepository,
    readonly characterService: CharacterService,
    readonly maps: MapRepository,
    readonly inventory: InventoryRepository,
    readonly inventoryService: InventoryService,
    readonly progression: ProgressionRepository,
    readonly social: SocialRepository,
    readonly guilds: GuildRepository,
    readonly admin: AdminRepository,
    readonly editLocks: EditLocks,
    readonly sessionStore: SqliteSessionStore,
    readonly sessionMiddleware: RequestHandler,
    readonly mailer: Mailer,
  ) {
    this.world = new World(this);
  }
}

/** Builds the services of the context on a migrated and seeded database. */
function assemble(db: Db, config: Config, options: ContextOptions): ServerContext {
  const settings = new SettingsRepository(db);
  const accounts = new AccountRepository(db);
  const sessionStore = new SqliteSessionStore(db);
  const resources = new ResourceRepository(db);
  // Register every graphic/sound present on disk (generated, uploaded or imported).
  resources.sync(scanResources());
  const gameData = new GameDataRepository(db);
  const characters = new CharacterRepository(db);
  const inventory = new InventoryRepository(db);
  const inventoryService = new InventoryService(inventory, gameData, () => settings.get('bagSize', DEFAULT_SETTINGS.bagSize));
  const progression = new ProgressionRepository(db);
  const secret = config.sessionSecret ?? settings.secret('session');
  // Whoever registers first becomes administrator: on a public server, that first
  // registration is protected by a code only the person running the server can read.
  let setupCode = config.setupCode ?? null;
  if (setupCode === null && config.production && accounts.count() === 0) {
    setupCode = randomBytes(9).toString('base64url');
    console.log(`[brindiwanko] no account yet: the first account (administrator) needs the setup code ${setupCode}`);
  }
  return new ServerContextContainer(
    config,
    db,
    settings,
    accounts,
    new AuthService(accounts, options.bcryptRounds ?? 11, undefined, setupCode, settings.secret('device')),
    resources,
    gameData,
    characters,
    new CharacterService(characters, gameData, settings, config.maxCharactersPerAccount, { inventory: inventoryService, progression }),
    new MapRepository(db),
    inventory,
    inventoryService,
    progression,
    new SocialRepository(db),
    new GuildRepository(db),
    new AdminRepository(db),
    new EditLocks(),
    sessionStore,
    createSessionMiddleware(config, sessionStore, secret),
    options.mailer ?? createMailer(config),
  );
}

/**
 * Releases the resources held by a context (timers, database handle).
 * @param ctx - Context to close.
 */
export function closeContext(ctx: ServerContext): void {
  ctx.stopping = true;
  ctx.world.close();
  ctx.sessionStore.close();
  if (ctx.db.open) {
    try {
      // Statistics refreshed for the query planner, then the whole journal written into the database
      // file and emptied: the next start opens a clean file (and a copy of it alone is complete).
      ctx.db.pragma('optimize');
      ctx.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      console.error('[brindiwanko] could not checkpoint the database before closing it', err);
    }
  }
  ctx.db.close();
  stopSandbox();
}
