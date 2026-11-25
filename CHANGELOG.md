<a id="fr-top"></a>

<div align="center">

  <img src="assets/img/system/AppIcon-512.png" alt="Logo Brindiwanko" width="96" />

  # 📜 Journal des modifications

  **Suivi des versions, correctifs et évolutions de Brindiwanko**

  [![Version](https://img.shields.io/badge/version-1.0.0--beta.1-2563eb?style=for-the-badge)](package.json)
  [![Format](https://img.shields.io/badge/Keep_a_Changelog-1.1.0-f59e0b?style=for-the-badge)](https://keepachangelog.com/fr/1.1.0/)
  [![SemVer](https://img.shields.io/badge/SemVer-2.0.0-0ea5e9?style=for-the-badge)](https://semver.org/lang/fr/)
  [![Tests](https://img.shields.io/badge/tests-354%20passed-15803d?style=for-the-badge&logo=node.js&logoColor=white)](tests/)
  [![License](https://img.shields.io/badge/License-Apache_2.0-475569?style=for-the-badge)](LICENSE)

  <br />

  **🇫🇷 Français** &nbsp;·&nbsp; [🇬🇧 Switch to English](#en-top)

  <br />

  [🚧 Non publié (25/11/2026)](#fr-unreleased) •
  [🧪 1.0.0-beta.1 (11/11/2026)](#fr-beta-1) •
  [📖 Guide README](README.md)

</div>

---

> Toutes les évolutions notables de **Brindiwanko** sont consignées ici selon le format [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le [versionnage sémantique](https://semver.org/lang/fr/).

<a id="fr-unreleased"></a>

## 🚧 Non publié — 25/11/2026

> [!TIP]
> **Lot de stabilisation AppSec, Performance & Bêta UX :** résolution des deux priorités `P1` sur la restauration à chaud et la boucle `20 Hz`, accompagnée de `22` améliorations `P2` *(sécurité, concurrence, SQLite, client, réseau, documentation)* et de la mise à jour de `nodemailer`.

> [!IMPORTANT]
> **Contre-expertise de l'audit 360° (25/11/2026) :** correction de l'unique `P1` restant *(arrêt du serveur sur une écriture SQLite refusée à la connexion d'un joueur)* et des `P2` validés ; suite portée à `354` tests. **Changements incompatibles :** protocole Socket.io `v4` *(clients rechargés automatiquement)*, schéma de `001_init.sql` modifié *(une base existante est à recréer)* et réinitialisation d'un mot de passe depuis le panneau admin confirmée par le mot de passe de l'appelant.

### 🛠️ Contre-expertise de l'audit 360°

| Domaine | Évolution apportée | Fichiers concernés |
| :--- | :--- | :--- |
| **Connexion Socket.io (`P1`)** | Entrée dans le monde isolée (`enterWorld` / `abortEntry`) : une écriture SQLite refusée ne coupe que le socket concerné au lieu d'arrêter le serveur ; erreur de `io.use` renvoyée au client (`error.http.server`) ; à la déconnexion, le joueur quitte le monde avant l'écriture du journal ; plafond de connexions par compte et par IP (`SOCKET_CONNECTIONS_PER_MIN`). | `server/net/socket.ts`, `server/config.ts` |
| **Sauvegardes du monde** | `leave()` nettoie la mémoire même si la sauvegarde échoue, `kickAccount()` déconnecte dans un `finally`, `savedAt` n'avance qu'après une écriture réussie, fermeture idempotente du monde et du contexte. | `server/game/world.ts`, `server/context.ts` |
| **Administration** | Rôle et mot de passe d'un admin modifiables par le seul propriétaire ; réinitialisation confirmée par le mot de passe de l'appelant ; journal `progress` limité aux champs appliqués ; identifiants de `DELETE /db` bornés à `1..9999` ; `baseVersion` obligatoire à l'enregistrement d'une carte ; réponses `404` en JSON sous `/api/`. | `server/admin/admin-routes.ts`, `server/admin/database-routes.ts`, `server/admin/editor-routes.ts`, `server/app.ts`, `client/pages/admin.ts` |
| **Comptes & e-mails** | Avis à l'ancienne adresse et fermeture des autres sessions au changement d'e-mail ; `5` e-mails de réinitialisation par jour et par compte ; confirmation d'adresse par lien *(indicative, avec `SMTP_URL`)* affichée sur le compte et dans le panneau admin ; file bornée devant bcrypt (`503` quand elle est pleine) ; avertissement si `PUBLIC_URL` est défini sans `NODE_ENV=production`. | `server/auth/service.ts`, `server/auth/hash-gate.ts`, `server/auth/account-routes.ts`, `server/db/accounts.ts`, `views/account.ejs`, `server/index.ts` |
| **Sécurité web & bac à sable** | CSP sans `'unsafe-inline'` *(nuanciers via `data-swatch`)* ; scripts d'évènements refusés sur un Node.js sans `--allow-net`, sauf `SANDBOX_WITHOUT_NETWORK_ISOLATION=1` ; `1000` évaluations en attente au plus ; restauration écrite sur disque au fil de l'eau et verrou commun entre import et restauration. | `server/http/security.ts`, `views/character-new.ejs`, `server/events/sandbox.ts`, `server/admin/heavy-jobs.ts`, `server/admin/admin-routes.ts` |
| **Gameplay & éditeur** | Protection d'arrivée étendue au PvP ; plus de rafale de pas après une téléportation ; `turn()` bloqué par `cannot_move` ; repli de `evacuateMap` sur le départ de la classe ; délai `instanceLockMinutes` contre la remise à zéro des donjons ; plafond `guildMaxMembers` ; réponse d'échange liée au demandeur ; rafraîchissements globaux regroupés par tick ; alerte avant d'enregistrer une carte dont des instances sont occupées. | `server/game/combat.ts`, `server/game/world.ts`, `server/game/instances.ts`, `server/game/guild.ts`, `server/game/trade.ts`, `client/editor/editor.ts`, `shared/settings.ts` |
| **Textes & noms** | Message du jour et noms de rangs de guilde nettoyés comme le chat ; alphabets arménien et cherokee ajoutés aux homoglyphes ; remplacements `\P` / `\G` insensibles aux motifs `$&`. | `server/game/guild.ts`, `server/game/social.ts`, `shared/names.ts`, `server/events/interpreter.ts` |
| **Performance** | Présence en guilde et des amis sans N+1 (`friendPresence`) ; index des membres en ligne et des noms ; caches des tags de guilde, des stats de monstres, de l'équipement et des commandes de quête par page ; journal de quêtes reconstruit sur empreinte ; réglages gelés lus sans copie (`peek`) ; itérations sans copie (`zoneMembers`, `gameData.values`) ; seuls les évènements mobiles parcourus ; upload asynchrone. | `server/game/*.ts`, `server/db/*.ts`, `server/resources/*.ts` |
| **Typage & tests (`354`)** | `noUncheckedIndexedAccess` activé partout ; `12` tests de régression ; tests mis à jour pour les nouvelles règles ; correction `Tomas` ➔ `Thomas` restante dans les tests et `demo/data`. | `tsconfig.json`, `tests/avalanche-fixes.test.ts`, `tests/*.test.ts`, `demo/data/*.json` |

### 📸 Documentation & Captures d'écran

| Domaine | Évolution apportée | Fichiers concernés |
| :--- | :--- | :--- |
| **Captures d'écran PC & Mobile** | Ajout de 28 captures d'écran en anglais (`14` PC `1920×1080` + `14` Mobile Pixel 8 `412×915 @ 2.625x` / `1082×2402`) avec joystick tactile visible, dialogue PNJ complet et vues de l'éditeur de map (`08`–`09`), couvrant l'authentification, les personnages, le jeu, la base de données et les éditeurs d'évènements dans les sections française et anglaise. | `README.md`, `docs/screenshots/pc/`, `docs/screenshots/mobile/` |

### 🔒 Sécurité & Durcissement

| Domaine | Évolution apportée | Fichiers concernés |
| :--- | :--- | :--- |
| **Restauration admin (`P1`)** | Vérification du mot de passe (`x-confirm-password`) et prise du verrou `restoring` dans `try/finally` **avant** `express.raw` (`500 Mo` max), empêchant toute allocation mémoire sur session volée. | `server/admin/admin-routes.ts` |
| **Archives ZIP** | Contrôle strict `data.length === size` après décompression deflate et rejet en `O(n log n)` des plages `localOffset` chevauchantes. | `server/importers/zip.ts` |
| **Téléversements SVG** | Dimensions numériques (`width`/`height`) obligatoires dans `storeUpload` ; décodage des échappements CSS hexadécimaux avant filtrage `url()`/`@import` et plafond à `32` balises `<use>` dans `isSafeSvg`. | `server/resources/uploads.ts` |
| **Sandbox & monde** | Bornage des IDs switches/variables à `1..9999` (`isOp`, `setSwitch`, `setVariable`) et validation `Number.isSafeInteger` sur les opérations scriptées. | `server/events/sandbox.ts`, `server/game/world.ts` |
| **Verrous d'édition** | Libération immédiate via `editLocks.releaseAll(id)` sur changement ou réinitialisation de mot de passe ; verrou sur `PATCH /api/editor/maps/:id/info` restreint à `name` et `parentId` *(sans bloquer `expanded` ni `order`)*. | `server/auth/account-routes.ts`, `server/admin/admin-routes.ts`, `server/admin/editor-routes.ts` |
| **Handshakes & i18n** | Rejet dans `isSameOrigin` des requêtes Socket.io ayant `Sec-Fetch-Site` cross-site même sans `Origin` ; garde `Object.hasOwn` dans `lookup()`. | `server/net/socket.ts`, `shared/i18n.ts` |
| **Contre-expertise V2** | Garde anti-cycle `parentId` (`PATCH /maps/:id/info` & `importProject`), `readZip` en 2 passes, durcissement `isSafeSvg`/`svgSize`, sandbox isolée (`64 KiB` IPC), verrou `/import` avant `express.raw`, `isSameOrigin` (`.at(-1)` + `X-Forwarded-Proto`), cookie CSRF `__Host-` + HMAC, `originFromEnv` + CSP `connect-src 'self'`, `POST /lang/:locale` protégé par CSRF et `intFromEnv` strict. | `server/admin/editor-routes.ts`, `server/importers/zip.ts`, `server/resources/uploads.ts`, `server/events/sandbox.ts`, `server/http/csrf.ts`, `server/http/security.ts`, `server/config.ts`, `server/app.ts` |

### ⚡ Performance & Architecture

| Domaine | Évolution apportée | Fichiers concernés |
| :--- | :--- | :--- |
| **Restauration asynchrone (`P1`)** | Passage de `prepareRestore` en `async` en réutilisant le Worker existant `inspectBackup` (`PRAGMA quick_check`) et `fs.promises.cp` pour ne plus bloquer l'Event Loop `20 Hz`. | `server/db/backups.ts`, `server/restore.ts`, `server/admin/admin-routes.ts` |
| **Index & requêtes SQLite (`001_init.sql`)** | Ajout de `11` index secondaires consolidés dans `001_init.sql` (`admin_log(target)`, `character_self_switches(map_id)`, `characters(class_id)`, `characters(respawn_map)`, `character_skills(skill_id)`, `character_quests(quest_id)`, `character_items(item_kind, item_id)`, `character_equipment(item_kind, item_id)`, `character_bank(item_kind, item_id)`, `guild_bank_items(item_kind, item_id)`, `character_raid_lockouts(raid_id)`), cache transaction-safe dans `SettingsRepository` (`WeakMap` par `Db`), suppression des requêtes N+1 dans `GuildRepository.directory` et scan brut `MapRepository.rawIncludes` sans `JSON.parse`/`JSON.stringify`. | `server/db/migrations/001_init.sql`, `server/db/settings.ts`, `server/db/guilds.ts`, `server/db/maps.ts`, `server/admin/editor-routes.ts` |
| **Cycle de vie client** | Suivi des écouteurs globaux par `AbortController`, arrêt du `requestAnimationFrame`, du timer de repli `50 ms` et du callback de langue via `destroy()` à la déconnexion ou au logout. | `client/game.ts`, `client/ui/chat.ts`, `client/ui/windows.ts`, `client/main.ts` |
| **Factorisation & CI** | Extraction de `field(req, name)`, parsing booléen strict `boolFromEnv` pour `TRUST_PROXY` (`1`/`true`/`0`/`false`, échec au démarrage sinon) et validation des placeholders `{{...}}` ainsi que des clés `t('...')` dans `views/**/*.ejs`. | `server/http/form.ts`, `server/config.ts`, `scripts/i18n-check.ts` |

### 🌐 Serveur, Réseau & Robustesse

| Domaine | Évolution apportée | Fichiers concernés |
| :--- | :--- | :--- |
| **Événements & reconnexions** | Garde `p.busy` dans `runCommon()`, re-vérification `isLive && !dead` après les attentes de `inn()`, flush immédiat de la progression en `finally` de `run()`/`runCommon()` et contrôle du `characterId` via `handshake.auth` au reconnect. | `server/game/events.ts`, `client/main.ts`, `server/net/socket.ts` |
| **WebSocket & proxy** | Activation de `tryAllTransports: true` côté client pour garantir le repli HTTP `polling`, tolérance `X-Forwarded-Host` vide / `:80`/`:443` dans `isSameOrigin()` et logs de diagnostic sur `allowRequest` / `connection_error`. | `client/main.ts`, `server/net/socket.ts` |
| **Comptes & tableau de bord** | Helper `safeJsonParse` sur les colonnes JSON SQLite, suppression des assertions `!` après `bcrypt` et dans `renderAccount`, transaction atomique dans `deleteAccount` *(notifications de guilde après commit)*, échantillonnage CPU dans `World.lagMonitor` et suffixe aléatoire sur `/api/admin/backup`. | `server/db/database.ts`, `server/auth/service.ts`, `server/auth/account-routes.ts`, `server/game/guild.ts`, `server/game/world.ts`, `server/admin/admin-routes.ts` |

### 🎮 Gameplay, Client & Éditeur

<details open>
<summary>Voir le détail des améliorations en jeu et dans l'éditeur</summary>

| Domaine | Évolution apportée | Fichiers concernés |
| :--- | :--- | :--- |
| **Combat & IA des régions** | Confinement des monstres à leur région en mode `idle` *(et en fuite sur zones multi-cases)*, aggro à `1` case des bordures peintes et retour au point d'origine au-delà de `2` cases hors zone *(les marqueurs de boss à une case restent libres dans leur salle)*. | `server/game/combat.ts` |
| **Focus & réactivité** | Cliquer sur la carte retire le focus du champ de chat ou du HUD pour rendre aussitôt la main au clavier ; buffer d'entrée de `150 ms` sur `action` (`Espace`, `Entrée`, `Z`, tactile `A`) pressée juste avant la fin d'un pas. | `client/game.ts`, `client/engine/player-controller.ts` |
| **Dialogues & mode tactile** | Masquage des barres du bas, du chat et des contrôles tactiles sous `body.dialogue-active` ; suivi dynamique de `(hover: none)` et `resize` sans rechargement de page. | `client/game.ts`, `client/styles/game.css`, `client/ui/mobile.ts`, `client/ui/windows.ts` |
| **Ergonomie de l'éditeur** | Mémoire de sélection et de défilement par onglet dans la palette *(réinitialisée uniquement si les planches changent)* et ancrage des boutons `+ Ajouter` avec focus automatique sur la ligne créée. | `client/editor/palette.ts`, `client/editor/database-editor.ts`, `client/styles/editor.css` |
| **Correctifs V2, Démo & Tests (`342`)** | `useItem` sous GCD/étourdissement, AoE toroïdale dédupliquée et plafond `MAX_BOSS_ADDS = 24`, `emote()`/`/r` respectant sourdine/invisibilité/ignorés, `CharacterSheet` (`openWindow`, `buy`, `reloadMap`) + `inn()` après fondu, `bootToken` client, correction `Tomas` ➔ `Thomas` (`Maison de Thomas`) et `12` tests de régression V2. | `server/game/combat.ts`, `server/game/world.ts`, `server/game/social.ts`, `server/game/character-sheet.ts`, `client/main.ts`, `server/db/demo-map.ts`, `server/db/seed.ts`, `tests/hardening-v2.test.ts` |

</details>

### 📦 Dépendances & Documentation

| Domaine | Évolution apportée | Fichiers concernés |
| :--- | :--- | :--- |
| **Dépendances** | Mise à jour de `nodemailer` (`10.5.0` → `10.6.0`) et resynchronisation du lockfile pour `npm ci`. | `package.json`, `package-lock.json` |
| **Guides d'installation** | Refonte bilingue du démarrage local PC/Mac/Linux *(téléchargement Node.js 24/26, archive `.zip` directe sans prérequis Git + option `git clone`)* et du guide VPS Linux débutant *(`Debian/Ubuntu`, `4 Go RAM`, `>= 2 vCore`, `nvm` + note avancée `apt`, DNS `A`, `pm2` sans `sudo` avec `nvm` vs `sudo` sous `apt`, Nginx, Certbot HTTPS et dépannage `WebSocket 400`)*. | `README.md`, `CHANGELOG.md` |
| **Présentation bilingue** | Formulation clarifiée de la ligne **Mobile & Bilingue** dans les tableaux de fonctionnalités FR/EN *(adaptation automatique mobile/PC, logiciel et contenu disponibles en français et en anglais)*. | `README.md`, `CHANGELOG.md` |

<div align="right">

[⬆️ Haut de page (FR)](#fr-top)

</div>

---

<a id="fr-beta-1"></a>

## 🧪 1.0.0-beta.1 — 11/11/2026

> Première bêta de **Brindiwanko 1.0** : moteur de MMORPG 2D pour navigateur avec éditeur de monde temps réel intégré, fonctionnant dans un seul processus Node.js (`>= 24`, `26 LTS` recommandé) adossé à SQLite et livré avec un monde de démonstration jouable.

### ✨ Fonctionnalités intégrées

| Domaine | Capacités principales |
| :--- | :--- |
| 🗺️ **Éditeur de cartes** | Barre de menus et d'icônes, palette de tuiles A à E, couches automatiques, autotiles, ombres dynamiques, régions, passabilité manuelle, cartes en boucle toroïdale, historique des versions, bouton *« Tester la carte »*. |
| 🧩 **Événements** | Multi-pages, conditions d'activation, déclencheurs variés, éditeur visuel de commandes, cinématiques (fondus, teintes d'écran, flashs, tremblements, images, météo, défilement de caméra, minuteurs). |
| 🎵 **Musique & Audio** | Musiques et ambiances dédiées par carte, jingles de victoire, commandes d'événement audio (lecture, fondu, mémorisation, reprise). |
| 📜 **Quêtes** | Étapes séquentielles, objectifs multiples (dialoguer, éliminer des cibles, collecter des objets, atteindre une zone), récompenses, chapitres, indicateurs visuels `!` et `?`. |
| ⚔️ **Système de Combat** | Action en temps réel directement sur la carte, compétences, altérations d'état, affinités élémentaires, coups critiques, IA des monstres, tables de butin. |
| 🎒 **Gestion Personnage** | Caractéristiques, points d'attributs à répartir, inventaire en grille, équipements, marchands, auberges de repos, coffres de banque. |
| 💬 **Vie Sociale** | Canaux publics, messagerie privée instantanée, liste d'amis, liste d'ignorés, échanges sécurisés entre joueurs, émoticônes. |
| 🛡️ **Groupes & Guildes** | Partage dynamique d'expérience et d'or, hiérarchie de rangs et permissions, coffre de guilde partagé, journal d'activité, blason généré. |
| 🏰 **Donjons & Raids** | Instances indépendantes par groupe, boss à phases scénarisées, verrous hebdomadaires (lockouts), attribution du butin aux dés. |
| 👑 **Administration** | Tableau de bord temps réel, panel de sanctions, outils d'animation en jeu, journaux d'audit détaillés, sauvegardes à chaud et restauration. |
| 📱 **Compatibilité Mobile** | Joystick virtuel tactile, boutons d'action et d'annulation dédiés, compétences en arc de cercle, mode plein écran, installation en PWA. |
| 🌍 **Bilingue natif** | Interface utilisateur, mécaniques de jeu et éditeur intégralement traduits en **français** et en **anglais**. |

### 🔒 Sécurité & 🗄️ Base de données

- **Confirmation sur restauration par upload :** restaurer un fichier de sauvegarde téléversé depuis `/admin` redemande le mot de passe administrateur via un champ unifié sous l'avertissement de restauration.

> [!IMPORTANT]
> **Rupture de schéma (`001_init.sql`) :** le schéma repart d'une migration initiale unique équivalente aux `22` migrations précédentes. Les bases et sauvegardes `0.x` ne sont **pas compatibles** : repartez d'une base neuve.

---

<div align="center">

📄 Sous licence **[Apache 2.0](LICENSE)** &nbsp;·&nbsp; [⬆️ Haut de page (FR)](#fr-top) &nbsp;·&nbsp; [🇬🇧 English Changelog](#en-top)

</div>

---

<br />

<a id="en-top"></a>

<div align="center">

  <img src="assets/img/system/AppIcon-512.png" alt="Brindiwanko Logo" width="96" />

  # 📜 Changelog (English)

  **Release notes, fixes, and improvements for Brindiwanko**

  [![Version](https://img.shields.io/badge/version-1.0.0--beta.1-2563eb?style=for-the-badge)](package.json)
  [![Format](https://img.shields.io/badge/Keep_a_Changelog-1.1.0-f59e0b?style=for-the-badge)](https://keepachangelog.com/en/1.1.0/)
  [![SemVer](https://img.shields.io/badge/SemVer-2.0.0-0ea5e9?style=for-the-badge)](https://semver.org/)
  [![Tests](https://img.shields.io/badge/tests-354%20passed-15803d?style=for-the-badge&logo=node.js&logoColor=white)](tests/)
  [![License](https://img.shields.io/badge/License-Apache_2.0-475569?style=for-the-badge)](LICENSE)

  <br />

  [🇫🇷 Lire en Français](#fr-top) &nbsp;·&nbsp; **🇬🇧 English**

  <br />

  [🚧 Unreleased (2026-11-25)](#en-unreleased) •
  [🧪 1.0.0-beta.1 (2026-11-11)](#en-beta-1) •
  [📖 README](README.md#en-top)

</div>

---

> All notable changes to **Brindiwanko** are documented in this file based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

<a id="en-unreleased"></a>

## 🚧 Unreleased — 2026-11-25

> [!TIP]
> **AppSec, Performance & Beta UX stabilization:** resolves both `P1` operational issues (restore request ordering & async restore prep) alongside `22` `P2` improvements across security, concurrency, SQLite performance, client lifecycle, networking, and setup docs, plus the `nodemailer` dependency bump.

> [!IMPORTANT]
> **Second opinion on the 360° audit (2026-11-25):** fixes the only remaining `P1` *(server stopping on a refused SQLite write while a player connects)* and the confirmed `P2` items; the suite now has `354` tests. **Breaking changes:** Socket.io protocol `v4` *(clients reload automatically)*, `001_init.sql` schema changed *(an existing database must be recreated)*, and admin password resets now require the caller's password.

### 🛠️ Second Opinion on the 360° Audit

| Area | Change | Files |
| :--- | :--- | :--- |
| **Socket.io connection (`P1`)** | World entry isolated (`enterWorld` / `abortEntry`): a refused SQLite write closes only that socket instead of stopping the server; `io.use` errors reach the client (`error.http.server`); on disconnect the player leaves the world before the log is written; per-account and per-IP connection cap (`SOCKET_CONNECTIONS_PER_MIN`). | `server/net/socket.ts`, `server/config.ts` |
| **World saves** | `leave()` cleans memory even when the save fails, `kickAccount()` disconnects in a `finally`, `savedAt` only moves after a successful write, idempotent world and context shutdown. | `server/game/world.ts`, `server/context.ts` |
| **Administration** | Only the owner changes another admin's role or password; resets confirmed by the caller's password; `progress` log limited to applied fields; `DELETE /db` ids bounded to `1..9999`; `baseVersion` required to save a map; JSON `404` under `/api/`. | `server/admin/admin-routes.ts`, `server/admin/database-routes.ts`, `server/admin/editor-routes.ts`, `server/app.ts`, `client/pages/admin.ts` |
| **Accounts & e-mails** | Old address notified and other sessions closed on e-mail change; `5` reset e-mails per account per day; address confirmation link *(informational, with `SMTP_URL`)* shown on the account page and in the admin panel; bounded queue in front of bcrypt (`503` when full); warning when `PUBLIC_URL` is set without `NODE_ENV=production`. | `server/auth/service.ts`, `server/auth/hash-gate.ts`, `server/auth/account-routes.ts`, `server/db/accounts.ts`, `views/account.ejs`, `server/index.ts` |
| **Web security & sandbox** | CSP without `'unsafe-inline'` *(swatches through `data-swatch`)*; event scripts refused on a Node.js without `--allow-net` unless `SANDBOX_WITHOUT_NETWORK_ISOLATION=1`; at most `1000` pending evaluations; restores streamed to disk and a shared import/restore lock. | `server/http/security.ts`, `views/character-new.ejs`, `server/events/sandbox.ts`, `server/admin/heavy-jobs.ts`, `server/admin/admin-routes.ts` |
| **Gameplay & editor** | Arrival protection extended to PvP; no step burst after teleports; `turn()` blocked by `cannot_move`; `evacuateMap` falls back to the class start; `instanceLockMinutes` delay against dungeon resets; `guildMaxMembers` cap; trade answers bound to the requester; global refreshes batched per tick; warning before saving a map with occupied instances. | `server/game/combat.ts`, `server/game/world.ts`, `server/game/instances.ts`, `server/game/guild.ts`, `server/game/trade.ts`, `client/editor/editor.ts`, `shared/settings.ts` |
| **Texts & names** | Guild message of the day and rank names cleaned like the chat; Armenian and Cherokee added to look-alike alphabets; `\P` / `\G` replacements immune to `$&` patterns. | `server/game/guild.ts`, `server/game/social.ts`, `shared/names.ts`, `server/events/interpreter.ts` |
| **Performance** | Guild and friend presence without N+1 (`friendPresence`); online member and name indexes; caches for guild tags, monster stats, equipment and per-page quest commands; quest journal rebuilt on fingerprint change; frozen settings read without copies (`peek`); copy-free iteration (`zoneMembers`, `gameData.values`); only moving events walked; async uploads. | `server/game/*.ts`, `server/db/*.ts`, `server/resources/*.ts` |
| **Typing & tests (`354`)** | `noUncheckedIndexedAccess` enabled everywhere; `12` regression tests; tests updated for the new rules; remaining `Tomas` ➔ `Thomas` fix in tests and `demo/data`. | `tsconfig.json`, `tests/avalanche-fixes.test.ts`, `tests/*.test.ts`, `demo/data/*.json` |

### 📸 Documentation & Screenshots

| Area | Change | Files |
| :--- | :--- | :--- |
| **Desktop & Mobile Screenshots** | Added 28 English screenshots (`14` Desktop `1920×1080` + `14` Mobile Pixel 8 `412×915 @ 2.625x` / `1082×2402`) with touch joystick visible, full NPC dialogue, and fixed map editor views (`08`–`09`), covering authentication, characters, in-game views, database, and event editors across both French and English sections. | `README.md`, `docs/screenshots/pc/`, `docs/screenshots/mobile/` |

### 🔒 Security & Hardening

| Area | Change | Files |
| :--- | :--- | :--- |
| **Admin restore ordering (`P1`)** | Verify `x-confirm-password` and acquire the `restoring` lock inside `try/finally` **before** invoking `express.raw` (`500 MB` limit), preventing unconfirmed body allocations on stolen sessions. | `server/admin/admin-routes.ts` |
| **ZIP archive validation** | Verify exact `data.length === size` after deflate decompression and reject overlapping `localOffset` ranges in `O(n log n)`. | `server/importers/zip.ts` |
| **SVG upload hardening** | Require explicit numeric `width`/`height` dimensions in `storeUpload`; decode CSS hex escapes before `url()`/`@import` checks and cap `<use>` elements at `32` in `isSafeSvg`. | `server/resources/uploads.ts` |
| **Sandbox & world bounds** | Clamp switch/variable IDs to integer `1..9999` (`isOp`, `setSwitch`, `setVariable`) and require `Number.isSafeInteger` for sandbox script variables. | `server/events/sandbox.ts`, `server/game/world.ts` |
| **Edit locks & passwords** | Call `editLocks.releaseAll(id)` immediately on password changes/resets; enforce edit locks on `PATCH /api/editor/maps/:id/info` for `name` and `parentId` only *(never blocking `expanded` or `order`)*. | `server/auth/account-routes.ts`, `server/admin/admin-routes.ts`, `server/admin/editor-routes.ts` |
| **Handshakes & i18n lookup** | Reject cross-site `Sec-Fetch-Site` Socket.io handshakes even without `Origin`; guard `lookup()` dictionary traversal with `Object.hasOwn`. | `server/net/socket.ts`, `shared/i18n.ts` |
| **V2 Counter-Audit Hardening** | `parentId` cycle guard (`PATCH /maps/:id/info` & `importProject`), 2-pass `readZip`, `isSafeSvg`/`svgSize` hardening, sandbox variable isolation (`64 KiB` IPC cap), `/import` lock before `express.raw`, `isSameOrigin` (`.at(-1)` + `X-Forwarded-Proto`), `__Host-` HMAC anonymous CSRF cookie, `originFromEnv` + `connect-src 'self'`, CSRF-protected `POST /lang/:locale`, and strict `intFromEnv`. | `server/admin/editor-routes.ts`, `server/importers/zip.ts`, `server/resources/uploads.ts`, `server/events/sandbox.ts`, `server/http/csrf.ts`, `server/http/security.ts`, `server/config.ts`, `server/app.ts` |

### ⚡ Performance & Architecture

| Area | Change | Files |
| :--- | :--- | :--- |
| **Non-blocking restore prep (`P1`)** | Converted `prepareRestore` to `async` reusing the `inspectBackup` Worker (`PRAGMA quick_check`) and `fs.promises.cp` instead of synchronous `backupProblem` and `cpSync` on the `20 Hz` game loop. | `server/db/backups.ts`, `server/restore.ts`, `server/admin/admin-routes.ts` |
| **SQLite indexes & queries (`001_init.sql`)** | Consolidated `11` secondary indexes into `001_init.sql` (`admin_log(target)`, `character_self_switches(map_id)`, `characters(class_id)`, `characters(respawn_map)`, `character_skills(skill_id)`, `character_quests(quest_id)`, `character_items(item_kind, item_id)`, `character_equipment(item_kind, item_id)`, `character_bank(item_kind, item_id)`, `guild_bank_items(item_kind, item_id)`, `character_raid_lockouts(raid_id)`), transaction-safe per-`Db` `WeakMap` cache in `SettingsRepository`, unified SQL query eliminating N+1 lookups in `GuildRepository.directory`, and `MapRepository.rawIncludes` avoiding `JSON.parse`/`JSON.stringify` round-trips. | `server/db/migrations/001_init.sql`, `server/db/settings.ts`, `server/db/guilds.ts`, `server/db/maps.ts`, `server/admin/editor-routes.ts` |
| **Client lifecycle cleanup** | Wired `AbortController` listeners, `requestAnimationFrame`, the `50 ms` stall fallback interval, and locale callbacks into `destroy()` on logout or server disconnect. | `client/game.ts`, `client/ui/chat.ts`, `client/ui/windows.ts`, `client/main.ts` |
| **Shared helpers & CI checks** | Extracted shared `field(req, name)`, added strict `boolFromEnv` parsing (`1`/`true`/`0`/`false`, throwing on unknown values) for `TRUST_PROXY`, and extended `i18n-check` to validate `{{...}}` placeholders and static `t('...')` keys in `views/**/*.ejs`. | `server/http/form.ts`, `server/config.ts`, `scripts/i18n-check.ts` |

### 🌐 Server, Networking & Resilience

| Area | Change | Files |
| :--- | :--- | :--- |
| **Events & reconnect safety** | Added `p.busy` guard in `runCommon()`, re-checked `isLive && !dead` across `inn()` sleeps, flushed dirty character progression in `finally` of `run()`/`runCommon()`, and validated `characterId` via Socket.io `handshake.auth` on reconnects. | `server/game/events.ts`, `client/main.ts`, `server/net/socket.ts` |
| **WebSocket fallback & proxy** | Enabled `tryAllTransports: true` so `polling` acts as a real fallback on WebSocket handshake failures, tolerated empty / `:80`/`:443` `X-Forwarded-Host` in `isSameOrigin()`, and added diagnostic logging for `allowRequest` / `connection_error` rejections. | `client/main.ts`, `server/net/socket.ts` |
| **Accounts & admin dashboard** | Introduced `safeJsonParse` for SQLite JSON columns, replaced `!` non-null assertions in `AuthService` and `renderAccount`, wrapped `deleteAccount` SQLite writes in `ctx.db.transaction(...)` with post-commit guild updates, sampled CPU periodically in `World.lagMonitor`, and randomized temp backup filenames. | `server/db/database.ts`, `server/auth/service.ts`, `server/auth/account-routes.ts`, `server/game/guild.ts`, `server/game/world.ts`, `server/admin/admin-routes.ts` |

### 🎮 Gameplay, Client & Editor UX

<details open>
<summary>View in-game, client control, and editor updates</summary>

| Area | Change | Files |
| :--- | :--- | :--- |
| **Combat & Region AI** | Confined region-spawned monsters while idle and fleeing on multi-cell zones; restricted aggro spotting to `1` cell from painted region borders and leashed chasing monsters home beyond `2` cells outside *(single-tile boss markers stay unrestricted within their room)*. | `server/game/combat.ts` |
| **Canvas focus & input buffer** | Clicking the map canvas blurs active non-window inputs *(such as chat)* so keyboard movement resumes right away; a `150 ms` action buffer executes `Space`/`Enter`/`Z`/touch `A` presses made just before step arrival. | `client/game.ts`, `client/engine/player-controller.ts` |
| **Dialogues & live touch toggle** | Active dialogues toggle `body.dialogue-active` to hide bottom bars, chat, and touch controls cleanly; automatic `touch-mode` follows `(hover: none)` and `resize` events without reloading. | `client/game.ts`, `client/styles/game.css`, `client/ui/mobile.ts`, `client/ui/windows.ts` |
| **Editor ergonomics** | Tile palettes retain selection and scroll position per tab *(resetting only when tilesets change)*, and database `+ Add` buttons remain sticky with automatic scroll/focus on added rows. | `client/editor/palette.ts`, `client/editor/database-editor.ts`, `client/styles/editor.css` |
| **V2 Fixes, Demo & Tests (`342`)** | `useItem` GCD & stun checks, deduplicated toroidal AoE & `MAX_BOSS_ADDS = 24`, `emote()`/`/r` mute/invisibility/ignore checks, `CharacterSheet` (`openWindow`, `buy`, `reloadMap`) + `inn()` post-fade charge, client `bootToken`, `Tomas` ➔ `Thomas` (`Thomas's House`) demo fix, and `12` V2 regression tests. | `server/game/combat.ts`, `server/game/world.ts`, `server/game/social.ts`, `server/game/character-sheet.ts`, `client/main.ts`, `server/db/demo-map.ts`, `server/db/seed.ts`, `tests/hardening-v2.test.ts` |

</details>

### 📦 Dependencies & Documentation

| Area | Change | Files |
| :--- | :--- | :--- |
| **Dependencies** | Updated `nodemailer` (`10.5.0` → `10.6.0`) and resynchronized the lockfile for `npm ci`. | `package.json`, `package-lock.json` |
| **Setup & VPS guides** | Refreshed bilingual local desktop instructions *(Node.js 24/26 download links, direct `.zip` workflow without requiring Git + optional `git clone`)* and beginner step-by-step Linux VPS deployment *(`Debian/Ubuntu`, `4 GB RAM`, `>= 2 vCores`, streamlined `nvm` setup plus advanced `apt` notes, DNS `A` setup, `pm2` `sudo` vs non-`sudo` rules, Nginx, Certbot SSL, and troubleshooting covering `WebSocket 400`)*. | `README.md`, `CHANGELOG.md` |
| **Bilingual overview** | Refined the **Mobile & Bilingual** row wording across both FR/EN capability tables *(automatic mobile/desktop adaptation, software and content available in English and French)*. | `README.md`, `CHANGELOG.md` |

<div align="right">

[⬆️ Back to Top (EN)](#en-top)

</div>

---

<a id="en-beta-1"></a>

## 🧪 1.0.0-beta.1 — 2026-11-11

> First beta of **Brindiwanko 1.0**: a browser-based 2D MMORPG engine with a built-in live world editor running in a single Node.js process (`>= 24`, `26 LTS` recommended) backed by SQLite, bundled with a playable demo world.

### ✨ Highlights

| Area | Capabilities |
| :--- | :--- |
| 🗺️ **World Editor** | Menu and toolbar, tile palettes A through E, auto-layering, autotiles, dynamic shadows, region IDs, manual passability overrides, toroidal looping maps, version history, *"Test Map"* instant button. |
| 🧩 **Event System** | Multi-page conditions, customizable triggers, visual command builder, cutscene sequences (fades, screen tints, flashes, camera shakes, picture displays, weather systems, camera scrolling, timers). |
| 🎵 **Audio Engine** | Map-specific background music and ambient tracks, victory jingles, audio event actions (play, fade, memorize, resume). |
| 📜 **Quest System** | Sequential steps, multi-type objectives (talk, defeat mobs, gather items, reach locations), experience & item rewards, story chapters, floating `!` and `?` markers. |
| ⚔️ **Combat Mechanics** | Fast-paced real-time map battles, custom spells & skills, status conditions, elemental weaknesses, critical strikes, reactive monster AI, configurable drop tables. |
| 🎒 **Character Systems** | Primary attributes, allocatable stat points, grid inventory, equipment slots, shopkeepers, resting inns, secure bank storage. |
| 💬 **Social Suite** | Public broadcast channels, instant private whispers, friends list, blacklist/ignore list, secure player-to-player trading, expressive emotes. |
| 🛡️ **Parties & Guilds** | Shared group XP and gold scaling, custom ranks and fine-grained permissions, shared guild bank, audit log, generated guild crests. |
| 🏰 **Dungeons & Raids** | Dynamic party-instanced maps, multi-phase scripted raid bosses, weekly lockout timers, transparent dice-roll loot distribution. |
| 👑 **Administration** | Real-time operations dashboard, moderation tools, in-game gamemaster commands, tamper-evident audit logs, live hot backups and restore. |
| 📱 **Mobile Ready** | Virtual analog joystick, dedicated Action and Cancel touch buttons, skill arc menu layout, immersive fullscreen mode, installable PWA. |
| 🌍 **Native Bilingual** | Player client, game systems, and the world editor are fully supported in both **English** and **French**. |

### 🔒 Security & 🗄️ Database

- **Upload restore confirmation:** restoring an uploaded backup file from `/admin` now asks for the administrator password again, sharing a unified confirmation field beneath the restore warning.

> [!IMPORTANT]
> **Schema reset (`001_init.sql`):** the schema starts from a single base migration matching the `22` earlier migrations. Databases and backups from `0.x` are **not compatible**: start from a fresh database.

---

<div align="center">

📄 Released under the **[Apache 2.0 License](LICENSE)** &nbsp;·&nbsp; [⬆️ Back to Top (EN)](#en-top) &nbsp;·&nbsp; [🇫🇷 Journal en Français](#fr-top)

</div>
