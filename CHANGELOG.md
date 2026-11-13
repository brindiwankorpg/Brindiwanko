# 📜 Journal des modifications

**Français** · [🇬🇧 English](#-changelog-english)

Toutes les évolutions notables de Brindiwanko sont consignées dans ce fichier. Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet suit le [versionnage sémantique](https://semver.org/lang/fr/).

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
