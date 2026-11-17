# 📜 Journal des modifications

**Français** · [🇬🇧 English](#-changelog-english)

Toutes les évolutions notables de Brindiwanko sont consignées dans ce fichier. Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet suit le [versionnage sémantique](https://semver.org/lang/fr/).

## Non publié — 17/11/2026

### 🔒 Sécurité & Durcissement

- **Restauration admin sécurisée (`server/admin/admin-routes.ts`)** : `POST /api/admin/restore` vérifie désormais le mot de passe administrateur (`x-confirm-password`) et pose le verrou `restoring` dans `try/finally` avant d'invoquer `express.raw` (`500 Mo` max), évitant toute allocation mémoire sur une session volée.
- **Import ZIP & téléversements SVG (`server/importers/zip.ts`, `server/resources/uploads.ts`)** : `readZip` contrôle l'égalité stricte `data.length === size` après décompression deflate et rejette les plages locales chevauchantes en `O(n log n)`. `storeUpload` exige des dimensions numériques explicites pour les SVG et `isSafeSvg` décode les échappements CSS hexadécimaux tout en plafonnant `<use>` à 32 occurrences.
- **Sandbox & réseau (`server/events/sandbox.ts`, `server/game/world.ts`, `server/net/socket.ts`, `shared/i18n.ts`)** : Les IDs de switches/variables sont bornés à `1..9999` (`Number.isSafeInteger` requis en sortie de sandbox), `isSameOrigin` rejette les handshakes Socket.io `Sec-Fetch-Site` cross-site même sans `Origin`, et `lookup()` protège la traversée de dictionnaire avec `Object.hasOwn`.
- **Verrous d'édition & comptes (`server/auth/account-routes.ts`, `server/admin/admin-routes.ts`, `server/admin/editor-routes.ts`)** : `editLocks.releaseAll(id)` est appelé dès qu'un mot de passe est changé ou réinitialisé, et `PATCH /api/editor/maps/:id/info` contrôle le verrou sur les changements de `name` et `parentId` sans bloquer `expanded` ni `order`.

### ⚡ Performance & Architecture

- **Restauration de sauvegarde asynchrone (`server/db/backups.ts`, `server/restore.ts`, `server/admin/admin-routes.ts`)** : `prepareRestore` est désormais asynchrone en réutilisant le Worker `inspectBackup` (`PRAGMA quick_check`) et `fs.promises.cp`, évitant de bloquer la boucle de jeu 20 Hz.
- **Base de données SQLite (`server/db/migrations/002_indexes.sql`, `server/db/settings.ts`, `server/db/guilds.ts`, `server/db/maps.ts`)** : Ajout de 6 index secondaires (`admin_log(target)`, `character_self_switches(map_id)`, `characters(class_id)`, `characters(respawn_map)`, `character_skills(skill_id)`, `character_quests(quest_id)`), mise en cache mémoire transaction-safe de `SettingsRepository` (`WeakMap` par connexion `Db`), suppression des requêtes N+1 dans `GuildRepository.directory`, et recherche directe `MapRepository.rawIncludes` sans aller-retour `JSON.parse`/`JSON.stringify`.
- **Cycle de vie client (`client/game.ts`, `client/ui/chat.ts`, `client/ui/windows.ts`, `client/main.ts`)** : Suivi et nettoyage systématique des écouteurs globaux (`AbortController`), du `requestAnimationFrame`, du timer 50 ms et du callback de langue via `destroy()` à la déconnexion.
- **Factorisation & outillage (`server/http/form.ts`, `server/config.ts`, `scripts/i18n-check.ts`)** : Extraction du helper `field(req, name)` partagé entre routeurs HTTP, parsing booléen explicite de `TRUST_PROXY` (`1`/`true`/`0`/`false`, erreur au démarrage sur valeur invalide) et extension d'`i18n:check` aux placeholders `{{...}}` ainsi qu'aux clés `t('...')` des vues `views/**/*.ejs`.

### 🛠️ Correctifs & Améliorations

- **Événements, progression & reconnexion multi-onglets (`server/game/events.ts`, `client/main.ts`, `server/net/socket.ts`)** : Garde `p.busy` dans `runCommon()`, re-vérification `isLive && !dead` après les attentes de `inn()`, flush immédiat de la progression en `finally` de `run()`/`runCommon()`, et contrôle du `characterId` via `handshake.auth` lors des reconnexions Socket.io.
- **Robustesse comptes, tableaux de bord & JSON (`server/db/database.ts`, `server/auth/service.ts`, `server/auth/account-routes.ts`, `server/game/guild.ts`, `server/game/world.ts`, `server/admin/admin-routes.ts`)** : Helper `safeJsonParse` sur les colonnes JSON SQLite, suppression des assertions `!` après `bcrypt` / `renderAccount`, transaction SQLite atomique dans `deleteAccount` (notifications de guilde émises après commit), échantillonnage CPU périodique dans `World.lagMonitor` et suffixe aléatoire sur les exports temporaires `/api/admin/backup`.
- **Combat & IA des régions (`server/game/combat.ts`)** : Les monstres associés à une région restent désormais confinés à leur région en mode `idle` (et en fuite sur les zones multi-cases). Sur les zones de chasse peintes, la détection d'aggro se limite aux abords immédiats de la région (1 case) et la poursuite rompt le combat pour rentrer au point d'origine au-delà de 2 cases hors région, tout en laissant les marqueurs de boss à une case chasser librement dans leur salle.
- **Focus clavier & réactivité des interactions (`client/game.ts`, `client/engine/player-controller.ts`)** : Cliquer sur la carte retire le focus du champ de chat (ou d'un contrôle du HUD) pour rendre immédiatement la main au clavier. Un buffer d'entrée de `150 ms` conserve également l'action (`Espace`, `Entrée`, `Z` ou bouton tactile `A`) pressée juste avant la fin d'un pas.
- **Interface, dialogues & bascule tactile (`client/game.ts`, `client/styles/game.css`, `client/ui/mobile.ts`, `client/ui/windows.ts`)** : Pendant un dialogue actif (`body.dialogue-active`), les barres du bas, la fenêtre de chat et les contrôles tactiles sont masqués (et le chat défocalisé si actif) afin d'éviter tout chevauchement en vue compacte ou mobile. Le passage dynamique entre mode tactile et bureau suit désormais `(hover: none)` et `resize` sans rechargement de page.
- **Ergonomie de l'éditeur (`client/editor/palette.ts`, `client/editor/database-editor.ts`, `client/styles/editor.css`)** : La palette de tuiles mémorise la sélection et la position de défilement de chaque onglet (réinitialisées uniquement si les planches du tileset changent). Dans l'éditeur de base de données, le bouton `+ Ajouter` reste ancré en pied de liste pour les listes principales et en tête pour les sous-listes imbriquées (objectifs de quêtes), avec défilement et focus automatiques sur la ligne ajoutée.

## 1.0.0-beta.1 — 11/11/2026

🧪 **Première bêta de Brindiwanko 1.0** : un moteur de MMORPG 2D pour navigateur, avec son éditeur de monde en temps réel intégré. Le tout tourne dans un seul processus Node.js (26 LTS recommandé, 24 au minimum) adossé à une seule base SQLite, et est livré avec un monde de démonstration jouable.

### ✨ Fonctionnalités

| Domaine | Capacités intégrées |
| :--- | :--- |
| 🗺️ **Éditeur de cartes** | Barre de menus et d'icônes, palette de tuiles A à E, couches automatiques, autotiles, ombres dynamiques, régions, passabilité manuelle, cartes en boucle toroïdale, historique des versions, bouton *« Tester la carte »*. |
| 🧩 **Événements** | Multi-pages, conditions d'activation, déclencheurs variés, éditeur visuel de commandes, cinématiques (fondus, teintes d'écran, flashs, tremblements, affichage d'images, météo, défilement de caméra, minuteurs). |
| 🎵 **Musique & Audio** | Musiques et ambiances dédiées par carte, jingles de victoire, commandes d'événement audio (lecture, fondu, mémorisation, reprise). |
| 📜 **Quêtes** | Étapes séquentielles, objectifs multiples (dialoguer, éliminer des cibles, collecter des objets, atteindre une zone), récompenses, chapitres, indicateurs visuels « ! » et « ? ». |
| ⚔️ **Système de Combat** | Action en temps réel directement sur la carte, compétences, altérations d'état, affinités élémentaires, coups critiques, IA des monstres, tables de butin. |
| 🎒 **Gestion Personnage** | Caractéristiques, points d'attributs à répartir, inventaire en grille, équipements, marchands, auberges de repos, coffres de banque. |
| 💬 **Vie Sociale** | Canaux de discussion publics, messagerie privée instantanée, liste d'amis, liste d'ignorés, système d'échanges sécurisés entre joueurs, émoticônes. |
| 🛡️ **Groupes & Guildes** | Partage dynamique de points d'expérience et d'or, hiérarchie de rangs et permissions, coffre de guilde partagé, journal d'activité, blason généré. |
| 🏰 **Donjons & Raids** | Instances indépendantes générées par groupe, combats de boss à phases scénarisées, verrous hebdomadaires (lockouts), attribution du butin aux dés. |
| 👑 **Administration** | Tableau de bord temps réel, panel de sanctions, outils d'animation en jeu, journaux d'audit détaillés, sauvegardes à chaud et restauration. |
| 📱 **Compatibilité Mobile** | Joystick virtuel tactile, boutons d'action et d'annulation dédiés, compétences disposées en arc de cercle, mode plein écran, installation en PWA. |
| 🌍 **Bilingue natif** | Interface utilisateur, mécaniques de jeu et éditeur intégralement traduits en **français** et en **anglais**. |

### 🔒 Sécurité

- Restaurer un **fichier de sauvegarde téléversé** depuis le panneau d'administration redemande désormais le mot de passe de l'administrateur, comme c'était déjà le cas pour une sauvegarde du serveur. Une session d'administrateur volée ne suffit donc plus à remplacer toute la base au prochain redémarrage. Un seul champ mot de passe, placé sous l'avertissement de restauration, sert aux deux méthodes.

### 🗄️ Base de données

- Le schéma de la base repart d'une **migration unique** (`server/db/migrations/001_init.sql`), qui produit exactement le schéma des 22 migrations précédentes. Les bases et les sauvegardes créées avec une version 0.x ne sont **pas compatibles** : partez d'une base neuve.

---

<br />

# 📜 Changelog (English)

[🇫🇷 Lire en Français](#-journal-des-modifications) · **English**

All notable changes to Brindiwanko are recorded in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## Unreleased — 2026-11-17

### 🔒 Security & Hardening

- **Admin restore request ordering (`server/admin/admin-routes.ts`)**: `POST /api/admin/restore` now verifies `x-confirm-password` and acquires the `restoring` lock inside `try/finally` before invoking `express.raw` (`500 MB` cap), preventing large unconfirmed memory allocations on stolen admin sessions.
- **ZIP & SVG validation (`server/importers/zip.ts`, `server/resources/uploads.ts`)**: `readZip` verifies `data.length === size` after deflate decompression and rejects overlapping local entry ranges in `O(n log n)`. `storeUpload` requires explicit numeric dimensions for SVGs, while `isSafeSvg` decodes CSS hex escapes before checking `url()`/`@import` and caps `<use>` elements at 32.
- **Sandbox bounds, handshakes & i18n lookup (`server/events/sandbox.ts`, `server/game/world.ts`, `server/net/socket.ts`, `shared/i18n.ts`)**: Switch/variable IDs are bounded to `1..9999` (with `Number.isSafeInteger` enforced on sandbox script outputs), `isSameOrigin` rejects cross-site `Sec-Fetch-Site` Socket.io handshakes even without `Origin`, and `lookup()` guards dictionary traversal with `Object.hasOwn`.
- **Edit lock enforcement (`server/auth/account-routes.ts`, `server/admin/admin-routes.ts`, `server/admin/editor-routes.ts`)**: `editLocks.releaseAll(id)` runs immediately on password changes/resets, and `PATCH /api/editor/maps/:id/info` enforces edit locks on `name` and `parentId` updates without blocking tree expand/reorder.

### ⚡ Performance & Architecture

- **Non-blocking backup restore prep (`server/db/backups.ts`, `server/restore.ts`, `server/admin/admin-routes.ts`)**: Converted `prepareRestore` to `async` using the existing `inspectBackup` worker (`PRAGMA quick_check`) and `fs.promises.cp`, keeping the 20 Hz game loop responsive.
- **SQLite indexes, caching & queries (`server/db/migrations/002_indexes.sql`, `server/db/settings.ts`, `server/db/guilds.ts`, `server/db/maps.ts`)**: Added 6 secondary indexes (`admin_log(target)`, `character_self_switches(map_id)`, `characters(class_id)`, `characters(respawn_map)`, `character_skills(skill_id)`, `character_quests(quest_id)`), added transaction-safe `WeakMap` caching per `Db` in `SettingsRepository`, eliminated N+1 queries in `GuildRepository.directory`, and added `MapRepository.rawIncludes` to check resource usage without `JSON.parse`/`JSON.stringify` round-trips.
- **Client lifecycle cleanup (`client/game.ts`, `client/ui/chat.ts`, `client/ui/windows.ts`, `client/main.ts`)**: Global listeners (`AbortController`), animation frames, the 50 ms fallback loop timer, and locale callbacks are now tracked and torn down via `destroy()` on logout or disconnect.
- **Shared HTTP helper, env parsing & i18n checks (`server/http/form.ts`, `server/config.ts`, `scripts/i18n-check.ts`)**: Extracted shared `field(req, name)`, added strict `boolFromEnv` parsing (`1`/`true`/`0`/`false`) for `TRUST_PROXY`, and extended `i18n:check` to verify `{{...}}` placeholders and static `t('...')` keys in `views/**/*.ejs`.

### 🛠️ Fixes & Improvements

- **Events, progression flush & multi-tab reconnect (`server/game/events.ts`, `client/main.ts`, `server/net/socket.ts`)**: Added `p.busy` guard in `runCommon()`, re-checked `isLive && !dead` across `inn()` sleeps, flushed dirty character progression in `finally` of `run()`/`runCommon()`, and validated `characterId` via Socket.io `handshake.auth` on reconnects.
- **Account deletion, dashboard CPU & JSON safety (`server/db/database.ts`, `server/auth/service.ts`, `server/auth/account-routes.ts`, `server/game/guild.ts`, `server/game/world.ts`, `server/admin/admin-routes.ts`)**: Added `safeJsonParse` for SQLite JSON columns, replaced `!` non-null assertions after `bcrypt`/`renderAccount`, wrapped `deleteAccount` SQLite writes in `ctx.db.transaction(...)` with post-commit guild updates, sampled CPU in `World.lagMonitor`, and randomized temp filenames in `GET /api/admin/backup`.
- **Combat & Region AI (`server/game/combat.ts`)**: Monsters spawned in a region now stay within that region while idle (and while fleeing in multi-cell zones). On painted multi-cell hunting regions, aggro spotting is restricted to players within 1 cell of the region and chasing monsters return home once more than 2 cells outside the region, while single-tile boss spawn markers remain free to chase within their room.
- **Canvas Focus & Interaction Buffering (`client/game.ts`, `client/engine/player-controller.ts`)**: Clicking the map canvas blurs active non-window inputs (such as the chat field) so keyboard movement and action keys resume immediately. A `150 ms` input buffer preserves `action` presses (`Space`, `Enter`, `Z`, or touch `A`) made near the end of a step so interactions trigger on landing.
- **HUD Dialogue Layering & Live Touch Switching (`client/game.ts`, `client/styles/game.css`, `client/ui/mobile.ts`, `client/ui/windows.ts`)**: Active event dialogues toggle `body.dialogue-active` to hide bottom bars, the chat box, and touch controls (and blur any focused chat input) so dialogues stay unobstructed on compact/touch screens. Automatic `touch-mode` detection now tracks `(hover: none)` and `resize` events and recalculates layout without needing a manual reload.
- **Editor Ergonomics (`client/editor/palette.ts`, `client/editor/database-editor.ts`, `client/styles/editor.css`)**: The tile palette preserves each tab's last selection and scroll position across tab switches (resetting only when tileset sheets change). In the database editor, top-level `+ Add` list buttons remain sticky at the bottom of the scroll viewport, nested sublist `+ Add` buttons (such as quest objectives) sit at the top of each sublist, and newly added rows scroll into view and receive focus.

## 1.0.0-beta.1 — 11/11/2026

🧪 **First beta of Brindiwanko 1.0**: a browser-based 2D MMORPG engine with a built-in live world editor. Everything runs in a single Node.js process (26 LTS recommended, 24 at least) backed by a single SQLite database, and ships with a playable demonstration world.

### ✨ Highlights

| Area | Capabilities |
| :--- | :--- |
| 🗺️ **World Editor** | Menu and toolbar, tile palettes A through E, auto-layering, autotiles, dynamic shadows, region IDs, manual passability overrides, toroidal looping maps, version history, *"Test Map"* instant button. |
| 🧩 **Event System** | Multi-page conditions, customizable triggers, visual command builder, cutscene sequences (fades, screen tints, flashes, camera shakes, picture displays, weather systems, camera scrolling, timers). |
| 🎵 **Audio Engine** | Map-specific background music and ambient tracks, victory jingles, audio event actions (play, fade, memorize, resume). |
| 📜 **Quest System** | Sequential steps, multi-type objectives (talk, defeat mobs, gather items, reach locations), experience & item rewards, story chapters, floating "!" and "?" markers. |
| ⚔️ **Combat Mechanics** | Fast-paced real-time map battles, custom spells & skills, status conditions, elemental weaknesses, critical strikes, reactive monster AI, configurable drop tables. |
| 🎒 **Character Systems** | Primary attributes, allocatable stat points, grid-based inventory, equipment slots, shopkeepers, resting inns, secure bank storage. |
| 💬 **Social Suite** | Public broadcast channels, instant private whispers, friends list, blacklist/ignore list, secure player-to-player trading, expressive emotes. |
| 🛡️ **Parties & Guilds** | Shared group XP and gold scaling, custom ranks and fine-grained permissions, shared guild bank, audit log, generated guild crests. |
| 🏰 **Dungeons & Raids** | Dynamic party-instanced maps, multi-phase scripted raid bosses, weekly lockout timers, transparent dice-roll loot distribution. |
| 👑 **Administration** | Real-time operations dashboard, moderation tools, in-game gamemaster commands, tamper-evident audit logs, live hot backups and restore. |
| 📱 **Mobile Ready** | Virtual analog joystick, dedicated Action and Cancel touch buttons, skill arc menu layout, immersive fullscreen mode, installable PWA. |
| 🌍 **Native Bilingual** | Player client, game systems, and the world editor are fully supported in both **English** and **French**. |

### 🔒 Security

- Restoring an **uploaded backup file** from the administration panel now asks for the administrator's password again, as restoring a server backup already did. A stolen administrator session is therefore no longer enough to replace the whole database at the next restart. A single password field, placed under the restore warning, serves both methods.

### 🗄️ Database

- The database schema now starts from a **single migration** (`server/db/migrations/001_init.sql`), which makes exactly the schema of the 22 previous migrations. Databases and backups made with a 0.x version are **not compatible**: start from a fresh database.
