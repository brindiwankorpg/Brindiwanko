<a id="fr-top"></a>

<div align="center">

<img src="assets/img/system/AppIcon-512.png" alt="Logo Brindiwanko" width="110" />

# 📜 Journal des modifications

#### Toutes les évolutions de Brindiwanko, version après version

[![Version](https://img.shields.io/badge/version-1.0.0--beta.1-2563eb?style=for-the-badge)](package.json)
[![Tests](https://img.shields.io/badge/tests-354%20passed-15803d?style=for-the-badge&logo=node.js&logoColor=white)](tests/)
[![Format](https://img.shields.io/badge/Keep_a_Changelog-1.1.0-f59e0b?style=for-the-badge)](https://keepachangelog.com/fr/1.1.0/)
[![SemVer](https://img.shields.io/badge/SemVer-2.0.0-0ea5e9?style=for-the-badge)](https://semver.org/lang/fr/)
[![License](https://img.shields.io/badge/License-Apache_2.0-475569?style=for-the-badge)](LICENSE)

**🇫🇷 Français** &nbsp;·&nbsp; [🇬🇧 English version](#en-top)

<table>
  <tr>
    <td align="center" width="200"><a href="#fr-unreleased"><b>🚧 Non publié</b></a><br /><sub>26/11/2026 · 3 lots</sub></td>
    <td align="center" width="200"><a href="#fr-beta-1"><b>🧪 1.0.0-beta.1</b></a><br /><sub>11/11/2026 · première bêta</sub></td>
    <td align="center" width="200"><a href="README.md"><b>📖 README</b></a><br /><sub>Installation & guide</sub></td>
  </tr>
</table>

</div>

> [!NOTE]
> Ce journal suit le format [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le [versionnage sémantique](https://semver.org/lang/fr/). Les niveaux `P1` (prioritaire) et `P2` (à corriger) renvoient aux audits de code.
>
> **Légende** &nbsp;·&nbsp; 🔴 `P1` prioritaire &nbsp;·&nbsp; 🟠 `P2` à corriger &nbsp;·&nbsp; 💥 rupture de compatibilité &nbsp;·&nbsp; 📁 fichiers modifiés

<div align="center">

### 🗓️ En un coup d'œil

| Statut | Étape | Date | Thème | En bref |
| :---: | :--- | :---: | :--- | :--- |
| 🚧 | [**🐺 Lot 3**](#fr-lot-3) | 26/11/2026 | Campagne de test « Red XIII » | 3 anomalies corrigées · 6 dépendances à jour |
| 🚧 | [**🛠️ Lot 2**](#fr-lot-2) | 25/11/2026 | Contre-expertise de l'audit 360° | 🔴 1 `P1` · 12 tests de régression |
| 🚧 | [**🧱 Lot 1**](#fr-lot-1) | 20/11/2026 | Stabilisation AppSec, performance & UX | 🔴 2 `P1` · 🟠 22 `P2` |
| ✅ | [**🧪 1.0.0-beta.1**](#fr-beta-1) | 11/11/2026 | Première bêta | 12 domaines · 💥 nouveau schéma |

<sub>🚧 non publié &nbsp;·&nbsp; ✅ publié</sub>

</div>

---

<a id="fr-unreleased"></a>

## 🚧 Non publié

<div align="center">

| 🔴 `P1` corrigés | 🧪 Tests | 💥 Ruptures | 🆕 Réglages | 📦 Lots |
| :---: | :---: | :---: | :---: | :---: |
| **3** | **354** ✅ | **3** | **5** | **3** |

</div>

> [!WARNING]
> **À lire avant de mettre à jour**
> - 🔌 **Protocole Socket.io `v4`** : les pages de jeu ouvertes se rechargent d'elles-mêmes.
> - 🗄️ **Schéma `001_init.sql` modifié** : une base créée avant ce lot est à recréer, et ses sauvegardes ne se restaurent plus.
> - 🔑 **Réinitialisation de mot de passe depuis le panneau admin** : l'administrateur qui la lance doit saisir son propre mot de passe.

### 🆕 Nouveaux réglages

| Réglage | Où | Par défaut | Rôle |
| :--- | :--- | :---: | :--- |
| `SOCKET_CONNECTIONS_PER_MIN` | Variable d'environnement | `12` *(prod)* | Connexions au jeu par compte et par minute, trois fois plus par IP. |
| `SANDBOX_WITHOUT_NETWORK_ISOLATION` | Variable d'environnement | — | `1` : exécute les scripts même sur un Node.js sans `--allow-net`. |
| `UV_THREADPOOL_SIZE` | Variable d'environnement | `4` | Threads de Node.js ; `8` conseillé sur un serveur public. |
| `guildMaxMembers` | Réglages système | `100` | Taille maximale d'une guilde. |
| `instanceLockMinutes` | Réglages système | `5` | Délai avant de rouvrir une copie d'un même donjon. |

<a id="fr-lot-3"></a>

### 🐺 Lot 3 — Campagne de test « Red XIII » sur base vierge &nbsp;<sub>26/11/2026</sub>

<div align="center">

| 🎯 Nature | 🐞 Anomalies corrigées | 📦 Dépendances | 🧪 Tests |
| :---: | :---: | :---: | :---: |
| Recette sur base vierge | **3** mineures | **6** à jour | **354** ✅ |

</div>

> Parcours complet sur une installation neuve, côté éditeur puis côté joueur : nouveau village, portails aller-retour, 2 monstres, 4 PNJ, quête en 3 étapes, redémarrage du serveur et bascule FR/EN. Aucun bug bloquant ; 3 anomalies mineures corrigées.

#### 🗺️ Éditeur d'évènements

- **Ordre d'insertion** — des commandes insérées l'une après l'autre gardent l'ordre choisi : la sélection reste sur la ligne suivante, comme après un collage. Une boutique ne passe plus avant le message d'accueil qui la précède.
- **Aide de la commande Boutique** — la note de développement « la fenêtre de boutique arrive avec l'étape Boutiques » laisse place à une vraie aide ; clé `ev.later_shop` renommée `ev.shop_help`.

<sub>📁 `client/editor/event-editor.ts` · `client/editor/command-specs.ts` · `locales/*.json`</sub>

#### 🌐 Traductions

- **Changement de langue en jeu** — une fenêtre fermée au moment du changement (sac, équipement…) reprend ses textes fixes dans la nouvelle langue à son ouverture : sa croix affiche « Close » et non plus « Fermer ».
- **README** — nombre de clés de traduction mis à jour (`2 391`).

<sub>📁 `client/ui/windows.ts` · `README.md`</sub>

#### 📦 Dépendances

- **Temps réel** — `engine.io` `6.6.11` → `6.6.13`, `socket.io-adapter` `2.5.8` → `2.5.9`, `ws` `8.21.3` → `8.23.0` *(`engine.io-client` garde sa propre copie de `ws` `8.21.3`)*.
- **Divers** — `object-inspect` `1.13.4` → `1.14.0`.
- **Typages (développement)** — `@types/node` `26.6.6` → `26.6.11`, `@types/body-parser` `1.19.6` → `2.2.0`.

<sub>📁 `package.json` · `package-lock.json`</sub>

#### 🗂️ Lots précédents &nbsp;<sub>cliquer sur un lot pour le déplier</sub>

<a id="fr-lot-2"></a>

<details>
<summary><b>🛠️ Lot 2 — Contre-expertise de l'audit 360°</b> &nbsp;<sub>25/11/2026 · 1 <code>P1</code> · cliquer pour déplier</sub></summary>

<br />

> Correction de l'unique `P1` restant et des `P2` validés par la contre-expertise.

#### 🔌 Connexion & robustesse du serveur

- **Plus d'arrêt du serveur à la connexion (`P1`)** — une écriture SQLite refusée pendant l'entrée d'un joueur ne coupe plus que son socket.
- **Handshake** — une erreur dans `io.use` est renvoyée au client (`error.http.server`) au lieu de le laisser attendre.
- **Déconnexion** — le joueur quitte le monde avant l'écriture du journal de connexion.
- **Reconnexions en boucle** — plafond par compte et par IP (`SOCKET_CONNECTIONS_PER_MIN`).
- **Sauvegardes** — `leave()` nettoie la mémoire même si la sauvegarde échoue, `kickAccount()` déconnecte toujours, `savedAt` n'avance qu'après une écriture réussie et l'arrêt peut être demandé deux fois sans effet.

<sub>📁 `server/net/socket.ts` · `server/game/world.ts` · `server/context.ts` · `server/config.ts`</sub>

#### 🔐 Administration, comptes & e-mails

- **Entre administrateurs** — seul le propriétaire change le rôle ou le mot de passe d'un autre admin ; toute réinitialisation est confirmée par le mot de passe de l'appelant.
- **Changement d'e-mail** — l'ancienne adresse est prévenue et les autres sessions sont fermées.
- **Confirmation d'adresse** — lien envoyé à l'inscription et à chaque changement *(avec `SMTP_URL`)*, statut affiché sur le compte et dans le panneau ; purement indicative.
- **Anti-spam** — `5` e-mails de réinitialisation par jour et par compte.
- **bcrypt** — file d'attente bornée (`503` quand elle est pleine) pour garder des threads libres.
- **API** — journal `progress` limité aux champs appliqués, identifiants de `DELETE /db` bornés à `1..9999`, `baseVersion` obligatoire pour enregistrer une carte, réponses `404` en JSON sous `/api/`.
- **Configuration** — avertissement si `PUBLIC_URL` est défini sans `NODE_ENV=production`.

<sub>📁 `server/admin/*.ts` · `server/auth/*.ts` · `server/db/accounts.ts` · `server/app.ts` · `views/account.ejs` · `client/pages/admin.ts`</sub>

#### 🛡️ Sécurité web & bac à sable

- **CSP** — plus de `'unsafe-inline'` : les couleurs des nuanciers passent par `data-swatch`.
- **Scripts d'évènements** — refusés sur un Node.js sans `--allow-net`, sauf `SANDBOX_WITHOUT_NETWORK_ISOLATION=1` ; `1000` évaluations en attente au plus.
- **Restauration & import** — la sauvegarde est écrite sur disque au fil de l'eau, et un seul import ou une seule restauration tourne à la fois.

<sub>📁 `server/http/security.ts` · `views/character-new.ejs` · `server/events/sandbox.ts` · `server/admin/heavy-jobs.ts`</sub>

#### 🎮 Gameplay & éditeur

- **PvP** — la protection d'arrivée vaut aussi contre les autres joueurs.
- **Déplacements** — plus de rafale de pas offerte après une téléportation ; `turn()` bloqué par `cannot_move`.
- **Cartes supprimées** — `evacuateMap` se replie sur le départ de la classe, puis déconnecte proprement.
- **Donjons** — délai `instanceLockMinutes` : changer de groupe ne remet plus le donjon à zéro.
- **Guildes & échanges** — plafond `guildMaxMembers` ; une réponse d'échange désigne le demandeur.
- **Interrupteurs globaux** — les rafraîchissements de tous les joueurs sont regroupés par tick.
- **Éditeur** — alerte avant d'enregistrer une carte dont des instances sont occupées.

<sub>📁 `server/game/*.ts` · `client/editor/editor.ts` · `shared/settings.ts`</sub>

#### 💬 Textes & noms

- Message du jour et noms de rangs de guilde nettoyés comme le chat.
- Alphabets arménien et cherokee ajoutés aux lettres trompeuses des noms.
- Codes `\P` et `\G` insensibles aux motifs `$&`.

<sub>📁 `server/game/guild.ts` · `server/game/social.ts` · `shared/names.ts` · `server/events/interpreter.ts`</sub>

#### ⚡ Performance

- **Moins de requêtes** — présence en guilde et des amis sans N+1 (`friendPresence`), index des membres en ligne et des noms.
- **Caches** — tags de guilde, stats des monstres, équipement, commandes de quête par page ; journal de quêtes reconstruit seulement s'il change.
- **Moins de copies** — réglages gelés lus sans copie (`peek`), itérations directes (`zoneMembers`, `gameData.values`), seuls les évènements mobiles parcourus.
- **Uploads** — écriture asynchrone, seule la ressource ajoutée est réindexée.

<sub>📁 `server/game/*.ts` · `server/db/*.ts` · `server/resources/*.ts`</sub>

#### 🧪 Typage & tests

- `noUncheckedIndexedAccess` activé sur tout le projet.
- `12` tests de régression dédiés, suite portée à **354** tests.
- Dernier `Tomas` ➔ `Thomas` corrigé dans les tests et `demo/data`.

<sub>📁 `tsconfig.json` · `tests/avalanche-fixes.test.ts` · `tests/*.test.ts` · `demo/data/*.json`</sub>

</details>

<a id="fr-lot-1"></a>

<details>
<summary><b>🧱 Lot 1 — Stabilisation AppSec, performance & UX bêta</b> &nbsp;<sub>20/11/2026 · 2 <code>P1</code> + 22 <code>P2</code> · cliquer pour déplier</sub></summary>

<br />

#### 🔒 Sécurité & durcissement

- **Restauration admin (`P1`)** — mot de passe vérifié et verrou pris **avant** de lire le fichier (`500 Mo` max) : aucune allocation sur une session volée.
- **Archives ZIP** — taille exacte vérifiée après décompression, plages `localOffset` chevauchantes rejetées.
- **SVG téléversés** — dimensions numériques obligatoires, échappements CSS décodés avant le filtrage `url()` / `@import`, `32` balises `<use>` au plus.
- **Bac à sable & monde** — identifiants d'interrupteurs et de variables bornés à `1..9999`, `Number.isSafeInteger` sur les opérations scriptées.
- **Verrous d'édition** — libérés dès un changement ou une réinitialisation de mot de passe ; le verrou de `PATCH /maps/:id/info` ne bloque que `name` et `parentId`.
- **Handshakes & i18n** — requêtes `Sec-Fetch-Site` intersites refusées même sans `Origin` ; garde `Object.hasOwn` dans `lookup()`.
- **Contre-expertise V2** — garde anti-cycle de `parentId`, `readZip` en deux passes, sandbox isolée (`64 KiB` d'IPC), cookie CSRF `__Host-` signé, CSP `connect-src 'self'`, `POST /lang/:locale` protégé, `intFromEnv` strict.

<sub>📁 `server/admin/*.ts` · `server/importers/zip.ts` · `server/resources/uploads.ts` · `server/events/sandbox.ts` · `server/http/*.ts` · `shared/i18n.ts`</sub>

#### ⚡ Performance & architecture

- **Restauration asynchrone (`P1`)** — `prepareRestore` passe par le Worker `inspectBackup` et `fs.promises.cp` : la boucle `20 Hz` n'est plus bloquée.
- **SQLite** — `11` index secondaires dans `001_init.sql`, cache de réglages sûr en transaction, annuaire des guildes sans N+1, recherche brute dans les cartes sans `JSON.parse`.
- **Cycle de vie client** — écouteurs, `requestAnimationFrame`, minuteur de repli et rappel de langue libérés par `destroy()`.
- **Outils & CI** — `field(req, name)` partagé, `boolFromEnv` strict pour `TRUST_PROXY`, placeholders et clés `t('...')` des vues vérifiés.

<sub>📁 `server/db/*.ts` · `server/restore.ts` · `client/game.ts` · `client/main.ts` · `scripts/i18n-check.ts`</sub>

#### 🌐 Serveur & réseau

- **Évènements & reconnexions** — garde `p.busy` dans `runCommon()`, état revérifié après `inn()`, progression enregistrée en `finally`, `characterId` vérifié à la reconnexion.
- **WebSocket & proxy** — repli `polling` réel (`tryAllTransports`), `X-Forwarded-Host` vide ou `:80` / `:443` toléré, journaux de diagnostic.
- **Comptes & tableau de bord** — `safeJsonParse` sur les colonnes JSON, suppression de compte atomique, mesure du CPU, noms aléatoires des sauvegardes temporaires.

<sub>📁 `server/game/events.ts` · `server/net/socket.ts` · `server/auth/*.ts` · `server/game/world.ts` · `client/main.ts`</sub>

#### 🎮 Gameplay, client & éditeur

- **IA des régions** — monstres confinés à leur région, aggro à `1` case des bordures, retour au départ au-delà de `2` cases.
- **Réactivité** — un clic sur la carte rend la main au clavier ; mémoire de `150 ms` pour l'action pressée juste avant la fin d'un pas.
- **Dialogues & tactile** — barres, chat et commandes tactiles masqués pendant un dialogue ; mode tactile suivi sans recharger la page.
- **Éditeur** — sélection et défilement mémorisés par onglet de palette ; boutons `+ Ajouter` fixes avec focus sur la ligne créée.
- **Correctifs V2 & démo** — `useItem` sous recharge globale, AoE dédoublonnée, `MAX_BOSS_ADDS = 24`, `emote()` et `/r` respectueux des sourdines, `bootToken` client, `12` tests de régression *(342 tests à cette date)*.

<sub>📁 `server/game/combat.ts` · `client/game.ts` · `client/engine/player-controller.ts` · `client/editor/*.ts` · `tests/hardening-v2.test.ts`</sub>

#### 📦 Dépendances & documentation

- **`nodemailer`** `10.5.0` → `10.6.0`, lockfile resynchronisé pour `npm ci`.
- **Guides d'installation** — démarrage local PC / Mac / Linux (archive `.zip` ou `git clone`) et guide VPS pas à pas (`nvm`, `pm2`, Nginx, Certbot, dépannage `WebSocket 400`).
- **Captures d'écran** — `28` captures *(14 PC `1920×1080`, 14 mobile `412×915`)* : connexion, personnages, jeu, base de données, éditeurs.
- **Présentation** — ligne **Mobile & Bilingue** clarifiée dans les tableaux de fonctionnalités.

<sub>📁 `package.json` · `README.md` · `docs/screenshots/`</sub>

</details>

<p align="right"><a href="#fr-top">⬆️ Haut de page</a></p>

---

<a id="fr-beta-1"></a>

## 🧪 1.0.0-beta.1 &nbsp;<sub>11/11/2026</sub>

<div align="center">

| 🏷️ Nature | 🧩 Domaines | ⚙️ Moteur | 💥 Rupture |
| :---: | :---: | :---: | :---: |
| Première bêta | **12** | Node.js `>= 24` + SQLite | Schéma `001_init.sql` |

</div>

> Première bêta de **Brindiwanko 1.0** : un moteur de MMORPG 2D pour navigateur avec éditeur de monde en temps réel, dans un seul processus Node.js (`>= 24`, `26 LTS` conseillé) adossé à SQLite, livré avec un monde de démonstration jouable.

### ✨ Ce que contient la bêta

| | Domaine | Capacités |
| :---: | :--- | :--- |
| 🗺️ | **Éditeur de cartes** | Palettes A à E, couches automatiques, autotiles, ombres, régions, passabilité manuelle, cartes en boucle, historique des versions, bouton *« Tester la carte »*. |
| 🧩 | **Évènements** | Multi-pages, conditions, déclencheurs, éditeur visuel de commandes, cinématiques (fondus, teintes, flashs, tremblements, images, météo, caméra, minuteurs). |
| 🎵 | **Audio** | Musiques et ambiances par carte, jingles de victoire, commandes audio (lecture, fondu, mémorisation, reprise). |
| 📜 | **Quêtes** | Étapes, objectifs (parler, vaincre, collecter, atteindre), récompenses, chapitres, marqueurs `!` et `?`. |
| ⚔️ | **Combat** | Temps réel sur la carte, compétences, altérations, éléments, critiques, IA des monstres, butins. |
| 🎒 | **Personnage** | Caractéristiques, points à répartir, inventaire en grille, équipement, marchands, auberges, banque. |
| 💬 | **Vie sociale** | Canaux publics, messages privés, amis, ignorés, échanges sécurisés, émoticônes. |
| 🛡️ | **Groupes & guildes** | Partage d'XP et d'or, rangs et permissions, coffre de guilde, journal, blason. |
| 🏰 | **Donjons & raids** | Instances par groupe, boss à phases, verrous hebdomadaires, butin aux dés. |
| 👑 | **Administration** | Tableau de bord en direct, sanctions, outils d'animation, journaux d'audit, sauvegardes et restauration. |
| 📱 | **Mobile** | Joystick tactile, boutons Action et Annuler, compétences en arc, plein écran, installation PWA. |
| 🌍 | **Bilingue** | Jeu, systèmes et éditeur entièrement en **français** et en **anglais**. |

### 🔒 Sécurité & base de données

- **Restauration par fichier confirmée** — restaurer une sauvegarde téléversée depuis `/admin` redemande le mot de passe administrateur.

> [!IMPORTANT]
> **Rupture de schéma (`001_init.sql`)** : le schéma repart d'une migration initiale unique, équivalente aux `22` migrations précédentes. Les bases et sauvegardes `0.x` ne sont **pas compatibles** : repartez d'une base neuve.

---

<div align="center">

📄 Sous licence **[Apache 2.0](LICENSE)** &nbsp;·&nbsp; [⬆️ Haut de page](#fr-top) &nbsp;·&nbsp; [🇬🇧 English changelog](#en-top)

</div>

<br />

---

<br />

<a id="en-top"></a>

<div align="center">

<img src="assets/img/system/AppIcon-512.png" alt="Brindiwanko logo" width="110" />

# 📜 Changelog

#### Every change to Brindiwanko, release after release

[![Version](https://img.shields.io/badge/version-1.0.0--beta.1-2563eb?style=for-the-badge)](package.json)
[![Tests](https://img.shields.io/badge/tests-354%20passed-15803d?style=for-the-badge&logo=node.js&logoColor=white)](tests/)
[![Format](https://img.shields.io/badge/Keep_a_Changelog-1.1.0-f59e0b?style=for-the-badge)](https://keepachangelog.com/en/1.1.0/)
[![SemVer](https://img.shields.io/badge/SemVer-2.0.0-0ea5e9?style=for-the-badge)](https://semver.org/)
[![License](https://img.shields.io/badge/License-Apache_2.0-475569?style=for-the-badge)](LICENSE)

[🇫🇷 Version française](#fr-top) &nbsp;·&nbsp; **🇬🇧 English**

<table>
  <tr>
    <td align="center" width="200"><a href="#en-unreleased"><b>🚧 Unreleased</b></a><br /><sub>2026-11-26 · 3 batches</sub></td>
    <td align="center" width="200"><a href="#en-beta-1"><b>🧪 1.0.0-beta.1</b></a><br /><sub>2026-11-11 · first beta</sub></td>
    <td align="center" width="200"><a href="README.md#en-top"><b>📖 README</b></a><br /><sub>Setup & guide</sub></td>
  </tr>
</table>

</div>

> [!NOTE]
> This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/). `P1` (urgent) and `P2` (to fix) refer to the code audits.
>
> **Legend** &nbsp;·&nbsp; 🔴 `P1` urgent &nbsp;·&nbsp; 🟠 `P2` to fix &nbsp;·&nbsp; 💥 breaking change &nbsp;·&nbsp; 📁 files changed

<div align="center">

### 🗓️ At a glance

| Status | Step | Date | Theme | Highlights |
| :---: | :--- | :---: | :--- | :--- |
| 🚧 | [**🐺 Batch 3**](#en-batch-3) | 2026-11-26 | "Red XIII" test campaign | 3 issues fixed · 6 dependencies updated |
| 🚧 | [**🛠️ Batch 2**](#en-batch-2) | 2026-11-25 | Second opinion on the 360° audit | 🔴 1 `P1` · 12 regression tests |
| 🚧 | [**🧱 Batch 1**](#en-batch-1) | 2026-11-20 | AppSec, performance & UX stabilization | 🔴 2 `P1` · 🟠 22 `P2` |
| ✅ | [**🧪 1.0.0-beta.1**](#en-beta-1) | 2026-11-11 | First beta | 12 areas · 💥 new schema |

<sub>🚧 unreleased &nbsp;·&nbsp; ✅ released</sub>

</div>

---

<a id="en-unreleased"></a>

## 🚧 Unreleased

<div align="center">

| 🔴 `P1` fixed | 🧪 Tests | 💥 Breaking | 🆕 Settings | 📦 Batches |
| :---: | :---: | :---: | :---: | :---: |
| **3** | **354** ✅ | **3** | **5** | **3** |

</div>

> [!WARNING]
> **Read before updating**
> - 🔌 **Socket.io protocol `v4`**: open game pages reload by themselves.
> - 🗄️ **`001_init.sql` schema changed**: a database created before this batch must be recreated, and its backups can no longer be restored.
> - 🔑 **Password resets from the admin panel**: the administrator starting one must type their own password.

### 🆕 New settings

| Setting | Where | Default | Purpose |
| :--- | :--- | :---: | :--- |
| `SOCKET_CONNECTIONS_PER_MIN` | Environment variable | `12` *(prod)* | Game connections per account per minute, three times as many per IP. |
| `SANDBOX_WITHOUT_NETWORK_ISOLATION` | Environment variable | — | `1`: run scripts even on a Node.js without `--allow-net`. |
| `UV_THREADPOOL_SIZE` | Environment variable | `4` | Node.js threads; `8` advised on a public server. |
| `guildMaxMembers` | System settings | `100` | Largest guild size. |
| `instanceLockMinutes` | System settings | `5` | Wait before reopening a copy of the same dungeon. |

<a id="en-batch-3"></a>

### 🐺 Batch 3 — "Red XIII" test campaign on a blank database &nbsp;<sub>2026-11-26</sub>

<div align="center">

| 🎯 Kind | 🐞 Issues fixed | 📦 Dependencies | 🧪 Tests |
| :---: | :---: | :---: | :---: |
| Run on a blank database | **3** minor | **6** updated | **354** ✅ |

</div>

> Full run on a fresh install, first in the editor then as a player: new village, two-way portals, 2 monsters, 4 NPCs, a 3-step quest, a server restart and FR/EN switching. No blocking bug; 3 minor issues fixed.

#### 🗺️ Event editor

- **Insertion order** — commands inserted one after the other keep the order they were chosen in: the selection stays on the next row, as after a paste. A shop no longer ends up before the greeting that should open it.
- **Shop command help** — the development note "the shop window comes with the Shops step" gives way to real help; key `ev.later_shop` renamed `ev.shop_help`.

<sub>📁 `client/editor/event-editor.ts` · `client/editor/command-specs.ts` · `locales/*.json`</sub>

#### 🌐 Translations

- **Changing language in game** — a window closed at the time of the change (bag, equipment…) gets its fixed texts in the new language when it opens: its close button reads "Close" instead of "Fermer".
- **README** — translation key count updated (`2,391`).

<sub>📁 `client/ui/windows.ts` · `README.md`</sub>

#### 📦 Dependencies

- **Real time** — `engine.io` `6.6.11` → `6.6.13`, `socket.io-adapter` `2.5.8` → `2.5.9`, `ws` `8.21.3` → `8.23.0` *(`engine.io-client` keeps its own copy of `ws` `8.21.3`)*.
- **Misc** — `object-inspect` `1.13.4` → `1.14.0`.
- **Typings (development)** — `@types/node` `26.6.6` → `26.6.11`, `@types/body-parser` `1.19.6` → `2.2.0`.

<sub>📁 `package.json` · `package-lock.json`</sub>

#### 🗂️ Previous batches &nbsp;<sub>click a batch to expand it</sub>

<a id="en-batch-2"></a>

<details>
<summary><b>🛠️ Batch 2 — Second opinion on the 360° audit</b> &nbsp;<sub>2026-11-25 · 1 <code>P1</code> · click to expand</sub></summary>

<br />

> Fixes the only remaining `P1` and the `P2` items confirmed by the second opinion.

#### 🔌 Connection & server resilience

- **No more server stop on connection (`P1`)** — a refused SQLite write while a player enters now closes only that player's socket.
- **Handshake** — an error in `io.use` reaches the client (`error.http.server`) instead of leaving it waiting.
- **Disconnection** — the player leaves the world before the connection log is written.
- **Reconnect loops** — per-account and per-IP cap (`SOCKET_CONNECTIONS_PER_MIN`).
- **Saves** — `leave()` cleans memory even when the save fails, `kickAccount()` always disconnects, `savedAt` only moves after a successful write, and shutdown can safely run twice.

<sub>📁 `server/net/socket.ts` · `server/game/world.ts` · `server/context.ts` · `server/config.ts`</sub>

#### 🔐 Administration, accounts & e-mails

- **Between administrators** — only the owner changes another admin's role or password; every reset is confirmed with the caller's password.
- **E-mail change** — the old address is notified and the other sessions are closed.
- **Address confirmation** — link sent at registration and after each change *(with `SMTP_URL`)*, status shown on the account page and in the panel; informational only.
- **Anti-spam** — `5` password reset e-mails per account per day.
- **bcrypt** — bounded queue (`503` when full) so threads stay free.
- **API** — `progress` log limited to applied fields, `DELETE /db` ids bounded to `1..9999`, `baseVersion` required to save a map, JSON `404` under `/api/`.
- **Configuration** — warning when `PUBLIC_URL` is set without `NODE_ENV=production`.

<sub>📁 `server/admin/*.ts` · `server/auth/*.ts` · `server/db/accounts.ts` · `server/app.ts` · `views/account.ejs` · `client/pages/admin.ts`</sub>

#### 🛡️ Web security & sandbox

- **CSP** — no more `'unsafe-inline'`: swatch colours go through `data-swatch`.
- **Event scripts** — refused on a Node.js without `--allow-net` unless `SANDBOX_WITHOUT_NETWORK_ISOLATION=1`; at most `1000` pending evaluations.
- **Restore & import** — backups are streamed to disk, and only one import or restore runs at a time.

<sub>📁 `server/http/security.ts` · `views/character-new.ejs` · `server/events/sandbox.ts` · `server/admin/heavy-jobs.ts`</sub>

#### 🎮 Gameplay & editor

- **PvP** — arrival protection also applies against other players.
- **Movement** — no step burst after a teleport; `turn()` blocked by `cannot_move`.
- **Deleted maps** — `evacuateMap` falls back to the class start, then disconnects cleanly.
- **Dungeons** — `instanceLockMinutes` delay: changing party no longer resets the dungeon.
- **Guilds & trades** — `guildMaxMembers` cap; a trade answer names the requester.
- **Global switches** — everyone's refresh is batched per tick.
- **Editor** — warning before saving a map with occupied instances.

<sub>📁 `server/game/*.ts` · `client/editor/editor.ts` · `shared/settings.ts`</sub>

#### 💬 Texts & names

- Guild message of the day and rank names cleaned like the chat.
- Armenian and Cherokee added to the look-alike letters of names.
- `\P` and `\G` codes immune to `$&` patterns.

<sub>📁 `server/game/guild.ts` · `server/game/social.ts` · `shared/names.ts` · `server/events/interpreter.ts`</sub>

#### ⚡ Performance

- **Fewer queries** — guild and friend presence without N+1 (`friendPresence`), online member and name indexes.
- **Caches** — guild tags, monster stats, equipment, per-page quest commands; quest journal rebuilt only when it changes.
- **Fewer copies** — frozen settings read without copies (`peek`), direct iteration (`zoneMembers`, `gameData.values`), only moving events walked.
- **Uploads** — written asynchronously, only the new resource is re-indexed.

<sub>📁 `server/game/*.ts` · `server/db/*.ts` · `server/resources/*.ts`</sub>

#### 🧪 Typing & tests

- `noUncheckedIndexedAccess` enabled across the project.
- `12` dedicated regression tests, suite now at **354** tests.
- Last `Tomas` ➔ `Thomas` fixed in tests and `demo/data`.

<sub>📁 `tsconfig.json` · `tests/avalanche-fixes.test.ts` · `tests/*.test.ts` · `demo/data/*.json`</sub>

</details>

<a id="en-batch-1"></a>

<details>
<summary><b>🧱 Batch 1 — AppSec, performance & beta UX stabilization</b> &nbsp;<sub>2026-11-20 · 2 <code>P1</code> + 22 <code>P2</code> · click to expand</sub></summary>

<br />

#### 🔒 Security & hardening

- **Admin restore (`P1`)** — password checked and lock taken **before** the file is read (`500 MB` max): no allocation on a stolen session.
- **ZIP archives** — exact size checked after decompression, overlapping `localOffset` ranges rejected.
- **Uploaded SVGs** — numeric dimensions required, CSS escapes decoded before `url()` / `@import` filtering, at most `32` `<use>` elements.
- **Sandbox & world** — switch and variable ids bounded to `1..9999`, `Number.isSafeInteger` on scripted operations.
- **Edit locks** — released on any password change or reset; the `PATCH /maps/:id/info` lock only guards `name` and `parentId`.
- **Handshakes & i18n** — cross-site `Sec-Fetch-Site` requests refused even without `Origin`; `Object.hasOwn` guard in `lookup()`.
- **V2 counter-audit** — `parentId` cycle guard, two-pass `readZip`, isolated sandbox (`64 KiB` IPC), signed `__Host-` CSRF cookie, CSP `connect-src 'self'`, protected `POST /lang/:locale`, strict `intFromEnv`.

<sub>📁 `server/admin/*.ts` · `server/importers/zip.ts` · `server/resources/uploads.ts` · `server/events/sandbox.ts` · `server/http/*.ts` · `shared/i18n.ts`</sub>

#### ⚡ Performance & architecture

- **Async restore (`P1`)** — `prepareRestore` uses the `inspectBackup` Worker and `fs.promises.cp`: the `20 Hz` loop is no longer blocked.
- **SQLite** — `11` secondary indexes in `001_init.sql`, transaction-safe settings cache, guild directory without N+1, raw map search without `JSON.parse`.
- **Client lifecycle** — listeners, `requestAnimationFrame`, fallback timer and locale callback released by `destroy()`.
- **Tooling & CI** — shared `field(req, name)`, strict `boolFromEnv` for `TRUST_PROXY`, view placeholders and `t('...')` keys checked.

<sub>📁 `server/db/*.ts` · `server/restore.ts` · `client/game.ts` · `client/main.ts` · `scripts/i18n-check.ts`</sub>

#### 🌐 Server & networking

- **Events & reconnects** — `p.busy` guard in `runCommon()`, state re-checked after `inn()`, progression saved in `finally`, `characterId` checked on reconnect.
- **WebSocket & proxy** — real `polling` fallback (`tryAllTransports`), empty or `:80` / `:443` `X-Forwarded-Host` tolerated, diagnostic logs.
- **Accounts & dashboard** — `safeJsonParse` on JSON columns, atomic account deletion, CPU sampling, random names for temporary backups.

<sub>📁 `server/game/events.ts` · `server/net/socket.ts` · `server/auth/*.ts` · `server/game/world.ts` · `client/main.ts`</sub>

#### 🎮 Gameplay, client & editor

- **Region AI** — monsters kept in their region, aggro `1` cell from borders, sent home beyond `2` cells.
- **Responsiveness** — clicking the map gives the keyboard back; a `150 ms` buffer keeps an action pressed just before a step ends.
- **Dialogues & touch** — bars, chat and touch controls hidden during dialogues; touch mode followed without reloading.
- **Editor** — selection and scroll remembered per palette tab; sticky `+ Add` buttons with focus on the new row.
- **V2 fixes & demo** — `useItem` under the global cooldown, deduplicated AoE, `MAX_BOSS_ADDS = 24`, `emote()` and `/r` honouring mutes, client `bootToken`, `12` regression tests *(342 tests at the time)*.

<sub>📁 `server/game/combat.ts` · `client/game.ts` · `client/engine/player-controller.ts` · `client/editor/*.ts` · `tests/hardening-v2.test.ts`</sub>

#### 📦 Dependencies & documentation

- **`nodemailer`** `10.5.0` → `10.6.0`, lockfile resynchronized for `npm ci`.
- **Setup guides** — local desktop start on PC / Mac / Linux (`.zip` archive or `git clone`) and a step-by-step VPS guide (`nvm`, `pm2`, Nginx, Certbot, `WebSocket 400` troubleshooting).
- **Screenshots** — `28` captures *(14 desktop `1920×1080`, 14 mobile `412×915`)*: sign-in, characters, game, database, editors.
- **Overview** — clearer **Mobile & Bilingual** row in the capability tables.

<sub>📁 `package.json` · `README.md` · `docs/screenshots/`</sub>

</details>

<p align="right"><a href="#en-top">⬆️ Back to top</a></p>

---

<a id="en-beta-1"></a>

## 🧪 1.0.0-beta.1 &nbsp;<sub>2026-11-11</sub>

<div align="center">

| 🏷️ Kind | 🧩 Areas | ⚙️ Engine | 💥 Breaking |
| :---: | :---: | :---: | :---: |
| First beta | **12** | Node.js `>= 24` + SQLite | `001_init.sql` schema |

</div>

> First beta of **Brindiwanko 1.0**: a browser-based 2D MMORPG engine with a live world editor, in a single Node.js process (`>= 24`, `26 LTS` recommended) backed by SQLite, shipped with a playable demo world.

### ✨ What the beta includes

| | Area | Capabilities |
| :---: | :--- | :--- |
| 🗺️ | **World editor** | Palettes A to E, auto-layering, autotiles, shadows, regions, manual passability, looping maps, version history, *"Test Map"* button. |
| 🧩 | **Events** | Multi-page, conditions, triggers, visual command builder, cutscenes (fades, tints, flashes, shakes, pictures, weather, camera, timers). |
| 🎵 | **Audio** | Per-map music and ambience, victory jingles, audio commands (play, fade, memorize, resume). |
| 📜 | **Quests** | Steps, objectives (talk, defeat, collect, reach), rewards, chapters, `!` and `?` markers. |
| ⚔️ | **Combat** | Real time on the map, skills, states, elements, critical hits, monster AI, loot tables. |
| 🎒 | **Character** | Attributes, stat points, grid inventory, equipment, shops, inns, bank. |
| 💬 | **Social** | Public channels, private messages, friends, ignore list, safe trades, emotes. |
| 🛡️ | **Parties & guilds** | Shared XP and gold, ranks and permissions, guild bank, log, crest. |
| 🏰 | **Dungeons & raids** | Per-party instances, multi-phase bosses, weekly lockouts, dice-roll loot. |
| 👑 | **Administration** | Live dashboard, sanctions, game master tools, audit logs, backups and restore. |
| 📱 | **Mobile** | Touch joystick, Action and Cancel buttons, skill arc, fullscreen, installable PWA. |
| 🌍 | **Bilingual** | Game, systems and editor fully in **English** and **French**. |

### 🔒 Security & database

- **Confirmed file restore** — restoring an uploaded backup from `/admin` asks for the administrator password again.

> [!IMPORTANT]
> **Schema reset (`001_init.sql`)**: the schema starts from a single base migration matching the `22` earlier ones. Databases and backups from `0.x` are **not compatible**: start from a fresh database.

---

<div align="center">

📄 Released under the **[Apache 2.0 License](LICENSE)** &nbsp;·&nbsp; [⬆️ Back to top](#en-top) &nbsp;·&nbsp; [🇫🇷 Journal en français](#fr-top)

</div>
