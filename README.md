<div align="center">

  <img src="assets/img/system/AppIcon-512.png" alt="Logo Brindiwanko" width="130" style="border-radius: 20px;" />

  # 🌿 Brindiwanko 🌿

  **Un moteur de MMORPG 2D web avec éditeur de monde en temps réel intégré**

  [![Version](https://img.shields.io/badge/version-1.0.0--beta.1-blue.svg?style=flat-square)](package.json)
  [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-7.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Socket.io](https://img.shields.io/badge/Socket.io-4.x-010101?style=flat-square&logo=socketdotio&logoColor=white)](https://socket.io/)
  [![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
  [![Tests](https://img.shields.io/badge/tests-320%2B%20passed-brightgreen?style=flat-square&logo=node.js&logoColor=white)](tests/)
  [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=flat-square)](LICENSE)

  <br />

  **Français** · [🇬🇧 Switch to English](#-brindiwanko-english-)

  <br />

  <p align="center">
    <a href="#-en-un-coup-dœil">✨ Fonctionnalités</a> •
    <a href="#-démarrage-rapide">🚀 Démarrage</a> •
    <a href="#-commandes--guide-du-joueur">🕹️ Jouer</a> •
    <a href="#-prise-en-main-de-léditeur">🗺️ Éditeur</a> •
    <a href="#-administration--modération">🛡️ Administration</a> •
    <a href="#-configuration">⚙️ Configuration</a> •
    <a href="#-déploiement">🌐 Déploiement</a>
  </p>

</div>

---

> 🎮 **Un monde persistant dans votre navigateur :** Dessinez vos cartes, programmez vos quêtes, placez vos monstres… et vos joueurs voient les modifications apparaître **en direct**, sans rechargement ! ✨

Brindiwanko réunit tout ce qu'il faut pour créer et faire vivre un petit monde en ligne : cartes en tuiles, événements scénarisés et cinématiques, quêtes scénarisées, combats en temps réel sur la carte, groupes, guildes, donjons instanciés et raids.

Le tout s'exécute dans **un seul processus Node.js** adossé à **une seule base de données SQLite** : aucun serveur de base de données externe lourd à installer ou configurer. 🚀

---

## 🤖 Un projet conçu par IA & testé par l'humain

> [!NOTE]
> **Brindiwanko a été entièrement conçu et programmé via une intelligence artificielle, et testé rigoureusement par son auteur en complément des batteries de tests de l'IA.** 🧠

* 💻 **Code & Générateurs** : L'ensemble du code source (serveur, client, éditeur, tests), les générateurs d'actifs procéduraux et la documentation sont écrits par l'IA sous la direction créative et technique humaine.
* 🧪 **Validation rigoureuse** : Le projet est validé par plus de **320 tests automatisés** (`npm test`), un simulateur de charge multi-clients et des campagnes de validation de bout en bout en conditions réelles dans le navigateur.
* ⚠️ **Mise en garde** : Comme pour toute réalisation générée, une relecture et des essais attentifs sont conseillés avant toute mise en production. Les signalements de bugs et contributions sont chaleureusement accueillis ! 🙏

---

## ✨ En un coup d'œil

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

---

## 🎨 Ressources visuelles : 100 % générées

> [!TIP]
> **Toutes les ressources graphiques de Brindiwanko sont produites par le code source du projet.**

Tilesets, autotiles, personnages animés, visages (facesets), monstres, boss de raid, objets, icônes d'interface, habillages de fenêtres, bulles de dialogue, marqueurs de quête, blasons de guilde et icône applicative… 🖌️

* 🧪 **Pixel art vectoriel** : Générées à partir des scripts SVG de `assets/generators/` lors de chaque commande `npm run build`.
* 🆓 **Libres de droit & originales** : Aucun élément n'est issu d'un pack externe ou de banques de données tierces. Rien n'enfreint de licence propriétaire.
* 🔁 **Personnalisables à l'infini** : Régénérez-les à volonté (`npm run assets:build`), éditez-les ou importez vos propres créations via le gestionnaire de **Ressources** intégré à l'éditeur.

---

## 🛠️ Pile technologique

* 🖥️ **Serveur** : TypeScript (mode strict), Express 5, Socket.io 4, better-sqlite3 (moteur unique de persistance), moteurs de vues EJS.
* 🌐 **Client Web** : TypeScript compilé via esbuild, rendu graphique sur HTML5 Canvas 2D, interfaces modulaires façon RPG classique.
* 🧪 **Qualité & Tests** : Runner natif `node --test` (plus de 320 tests automatisés), suite de test de charge multi-clients intégrée.

---

## 📦 Installation & Démarrage rapide

### Prérequis

* **Node.js 22** ou version ultérieure
* Gestionnaire de paquets **npm**

```bash
# 1. Cloner et installer les dépendances
npm install

# 2. Générer les assets graphiques et compiler l'application
npm run build

# 3. Lancer le serveur
npm start
```

> [!NOTE]
> Le fichier `.npmrc` préconfiguré bloque l'exécution de scripts d'installation superflus : SQLite et bcrypt fournissent directement leurs binaires précompilés (Windows, Linux, macOS). Aucun compilateur C++ n'est requis sur votre machine.

🌐 Rendez-vous sur **<http://localhost:3000>**. 
Lors de cette première exécution, la base de données `data/game.db` est automatiquement créée, mise à jour au dernier schéma et alimentée avec le monde de démonstration.

* **Environnement de développement** : Lancez `npm run dev` pour bénéficier du rechargement automatique du serveur et de la recompilation du client à chaque enregistrement.

---

## 👑 Premier compte administrateur

Le **tout premier utilisateur** qui s'enregistre sur la plateforme reçoit automatiquement le rôle d'**administrateur** 🎉. Tous les comptes créés ultérieurement seront de simples joueurs. L'administrateur peut ensuite désigner d'autres administrateurs ou modérateurs directement via le panel d'administration (les permissions s'appliquent immédiatement, y compris en cours de jeu).

> [!IMPORTANT]
> **Sécurisation en production (`NODE_ENV=production`)** :  
> Tant qu'aucun compte n'existe en base, la création du premier utilisateur exige un **code d'installation** (`SETUP_CODE`). Ce code est affiché dans le journal d'amorçage du serveur ou défini manuellement via la variable d'environnement `SETUP_CODE`. Cela empêche un visiteur impromptu d'obtenir les privilèges administrateur lors de la mise en ligne.

---

## 🕹️ Commandes & Guide du Joueur

### 🚀 Vos premiers pas
1. **Création de personnage** : Choisissez votre classe et personnalisez votre apparence. Un compte ne peut connecter qu'un seul personnage en jeu simultanément.
2. **Gestion du compte** : Le menu **Mon compte** (en haut à gauche) vous permet de modifier votre mot de passe, votre adresse e-mail ou de supprimer le compte et ses personnages associés.
3. **Récupération d'accès** : Le lien **Mot de passe oublié ?** transmet un jeton de réinitialisation sécurisé par e-mail, valide pendant une heure (nécessite la configuration de `SMTP_URL`).

### 🎮 Tableau des commandes

| Action | Raccourcis Clavier | Bouton Mobile |
| :--- | :--- | :--- |
| **Se déplacer** | <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> ou <kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> / <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ou clic gauche | Joystick tactile |
| **Interagir / Attaque frontale** | <kbd>Espace</kbd> ou <kbd>Entrée</kbd> | Bouton <kbd>A</kbd> |
| **Attaquer** | <kbd>F</kbd> | Bouton dédié |
| **Barre d'actions rapides** | <kbd>1</kbd> à <kbd>8</kbd> | Raccourcis en arc |
| **Menu principal** | <kbd>Échap</kbd> | Icône menu |

### 🪟 Raccourcis d'interface

| Fenêtre | Touche | Fenêtre | Touche |
| :--- | :---: | :--- | :---: |
| 🎒 **Sac (Inventaire)** | <kbd>I</kbd> | 📜 **Journal de quêtes** | <kbd>J</kbd> |
| 👤 **Fiche Personnage** | <kbd>C</kbd> | 👥 **Liste d'amis** | <kbd>L</kbd> |
| 🔮 **Grimoire de compétences** | <kbd>K</kbd> | 🛡️ **Guilde** | <kbd>G</kbd> |
| ⚔️ **Gestion de groupe** | <kbd>P</kbd> | 🗺️ **Carte du monde** | <kbd>M</kbd> |
| ⚙️ **Paramètres & Options** | <kbd>O</kbd> | 💬 **Ouvrir le chat** | <kbd>Entrée</kbd> |

### ⚔️ Mécaniques de jeu essentielles
* **Raccourcis & Ciblage** : Glissez-déposez compétences et consommables sur la barre d'action rapide. Cliquez sur un ennemi ou un allié pour le sélectionner.
* **Interactions sociales** : En cliquant sur un avatar ou sur un pseudo dans le chat, un menu contextuel propose l'envoi de message privé, demande d'ami, invitation de groupe/guilde, échange commercial sécurisé, inspection d'équipement, mise sous silence (ignorer) et signalement modérateur. Un délai anti-spam de 10 s s'applique aux invitations (porté à 1 minute après un refus).
* **Partage d'XP & Butin** : L'expérience et les pièces d'or générées par un monstre sont réparties proportionnellement aux dégâts infligés par chacun (les membres d'un même groupe bénéficient d'un bonus supplémentaire de +10 % par allié présent). Le butin physique revient au joueur ou au groupe ayant infligé le plus lourd tribut de dégâts.
* **Instances de Raid** : Le système contrôle à l'entrée le nombre d'équipiers présents ; le boss de raid demeure invulnérable tant que l'ensemble du groupe n'a pas pénétré dans l'arène.
* **Intégrité commerciale** : Toute fenêtre d'aubergiste, de marchande ou de coffre de banque se verrouille instantanément si le joueur tombe K.-O. ou change de carte, annulant toute transaction en cours.

---

## 🗺️ Prise en main de l'éditeur de monde

Pour les utilisateurs dotés des droits administrateurs, l'éditeur s'ouvre directement depuis le jeu via l'icône **Administration** 👑 de la barre de menus, puis **« Ouvrir l'éditeur de cartes »**. Toutes les modifications sauvegardées sont diffusées **en temps réel** aux joueurs connectés ! ⚡

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Éditeur de Monde en Direct                           │
├─────────────────┬──────────────────────────────────────────────────────┤
│ 🗺️ Cartes       │ Arborescence, calques auto, autotiles, ombres,       │
│                 │ régions, passage tore (boucle), historique versions   │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 🚧 Passabilité  │ Blocage / déblocage manuel par case sans altérer     │
│                 │ les graphismes (contour de sélection distinctif)     │
├─────────────────┼──────────────────────────────────────────────────────┤
│ ⚙️ Propriétés   │ Nom, dimensions, tileset, PvP, drapeau d'instance,   │
│                 │ thèmes musicaux et d'ambiance, monstres associés     │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 🧩 Événements   │ PNJ, coffres, téléportations rapides, cinématiques,   │
│                 │ déclencheurs, gestion des pages et conditions        │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 📚 Données      │ Classes, sorts, objets, monstres, quêtes, raids...   │
│                 │ Importation et exportation JSON sans pertes          │
└─────────────────┴──────────────────────────────────────────────────────┘
```

* ▶️ **Bouton « Tester la carte »** : Enregistre les altérations en cours, masque l'éditeur et téléporte votre personnage sur la case précisément ciblée.
* 📚 **Résilience des données JSON** : Lors de l'import d'une base de données, les liaisons vers des éléments non répertoriés sont préservées sans bloquer le moteur de jeu ; l'éditeur recense le total et met en évidence les dix premières incohérences pour révision.
* 🖼️ **Gestionnaire de Ressources** : Importez vos graphismes et bruitages personnalisés ou chargez un projet complet au format de fichiers standard. Tout fichier altéré ou transmission tronquée est automatiquement neutralisé au profit du fichier initial sain.
* 🧪 **Quarantaine de sécurité sur les scripts** : Tout fragment de code exécutable importé (commandes de script, conditions formulées par script, évaluations de variables) est consigné mais **totalement désactivé** jusqu'à ce qu'un administrateur valide son contenu dans la vue dédiée (*« Scripts à vérifier »*).
* 🗑️ **Suppression sécurisée** : La suppression d'une carte ou d'une entrée encore référencée (objectif de quête, transfert, monstre, magasin) déclenche un panneau d'avertissement avec la liste des dépendances. Les identifiants uniques supprimés ne sont jamais recyclés.
* 🪜 **Dalles spéciales** : Une tuile marquée comme **échelle** force l'orientation du personnage vers le haut ; une case de type **dégâts** soustrait 10 PV par foulée sans jamais infliger d'état K.-O.
* 🔑 **Interrupteurs locaux vs Instances** : Les interrupteurs locaux sont liés à l'identité du personnage (un coffre ouvert dans un donjon demeure ouvert pour lui lors de visites ultérieures). Pour un mécanisme propre à l'instance en cours, cochez l'option d'interrupteur d'instance sous l'onglet **Système**.

---

## 🛡️ Administration & Modération

### 📊 Console d'administration (`/admin`)

Réservée aux administrateurs et modérateurs habilités :

* 📈 **Tableau de bord** : Mesure de la charge processeur, joueurs actifs, volumétrie des cartes et instances allouées.
* 👤 **Gestion des comptes** : Attribution de rôles, avertissements, mise en sourdine, déconnexions forcées et réinitialisation de mots de passe.  
  *(Les modérateurs accèdent aux adresses e-mail anonymisées et n'ont pas accès aux adresses IP. Le propriétaire originel du serveur ne peut pas être déchu de son rang).*
* 🧰 **Boîte à outils de jeu** : Téléportation sur coordonnées, invisibilité, distribution de monnaie et d'objets, altération d'interrupteurs globaux et alertes système.
* 📝 **Journaux d'audit** : Historique inaltérable des connexions, transactions, échanges entre joueurs, butins épiques et rapports de signalement.
* 💾 **Sauvegarde & Restauration** : Téléchargement d'archives exemptes de secrets serveur et sessions. Restauration vérifiée avec contrôle d'intégrité strict du schéma ; qu'il s'agisse d'une sauvegarde du serveur ou d'un fichier téléversé, elle redemande le mot de passe de l'administrateur.

### 💬 Commandes de modération en jeu

| Commande | Rôle minimal | Description |
| :--- | :---: | :--- |
| `/kick <joueur> [motif]` | Modérateur | Expulse immédiatement le joueur (reconnexion autorisée). |
| `/mute <joueur> [durée] [motif]` | Modérateur | Réduit le joueur au silence pour une période (`30m`, `2h`, `7j`). |
| `/unmute <joueur>` | Modérateur | Lève la sanction de sourdine sur le compte ciblé. |
| `/ban <joueur> [durée\|perm] [motif]` | Administrateur | Bannit le compte temporairement ou définitivement. |
| `/unban <joueur>` | Administrateur | Révoque une mesure de bannissement active. |
| `/all <message>` | Modérateur | Diffuse une annonce officielle sur le canal mondial réservé au staff. |
| `/pkick <joueur>` | Joueur (Chef) | Expulse un aventurier de son propre groupe d'expédition. |

> [!TIP]
> **Politique de rétention et RGPD** : Les sauvegardes automatiques s'exécutent chaque nuit à l'heure configurée dans le panel (4 h du matin par défaut) avec rotation sur 1, 7, 14 ou 31 jours. Les journaux de plus de 90 jours sont purgés quotidiennement, et la suppression d'un compte retire irrévocablement toutes ses adresses IP archivées.

---

## 🌳 Monde de démonstration

Chaque installation neuve contient un univers de démonstration prêt à l'emploi :
* 🏘️ **Le village de Brindiwanko** : PNJ animés, comptoir marchand, auberge réparatrice, coffres de dépôt et banquier.
* 🌲 **La forêt de Bruyère** : Faune hostile, herbes médicinales à récolter, cinématiques interactives d'introduction.
* 🏠 **Intérieurs & Maisons** : Habitations meublées avec transitions transparentes.
* 🦇 **La grotte de Bruyère** : Donjon instancié abritant le redoutable 👺 **Roi Gobelin** (boss de raid multi-joueurs).
* 📖 **Chapitre 1** : Série de quêtes scénarisées guidant les premiers pas de l'aventurier.

```bash
# Exporter le monde de démonstration en fichiers JSON structurés dans demo/
npm run demo:export
```

> [!TIP]
> **Réinitialiser le monde** : Arrêtez le serveur, supprimez les fichiers de base de données `data/game.db*` (incluant les suffixes `-wal` et `-shm`), puis relancez le serveur.  
> Au démarrage sur une base vierge, le terminal invite à sélectionner la langue : `Choose language/Choix de la langue (EN/FR) :`. Cartes, quêtes et dialogues de démonstration sont générés dans la langue désignée. En environnement automatisé (pm2, Docker), définissez la variable d'environnement `CONTENT_LANGUAGE=fr` ou `en`.

---

## ⚙️ Configuration

Toutes les variables d'environnement suivantes sont optionnelles et disposent de valeurs par défaut saines :

| Variable | Défaut | Description |
| :--- | :---: | :--- |
| `PORT` | `3000` | Port d'écoute du serveur HTTP / WebSocket. |
| `HOST` | `0.0.0.0` | Adresse d'écoute réseau (`127.0.0.1` vivement recommandé derrière un proxy inverse nginx). |
| `DB_PATH` | `game.db` dans `DATA_DIR` | Chemin du fichier SQLite, absolu (ex. `/var/lib/brindiwanko/game.db`) ou relatif au **dossier du projet** (pas à `DATA_DIR`). Ses sauvegardes vont dans un dossier `backups/` à côté de lui. |
| `DATA_DIR` | `data/` | Répertoire de la base par défaut et de son sous-dossier `backups/` (sans effet sur un `DB_PATH` donné). |
| `UPLOADS_DIR` | `uploads/` | Répertoire d'accueil des graphismes et sons importés (exposés sous `/uploads/`). |
| `NODE_ENV` | — | Définir sur `production` pour activer le mode sécurisé (cookies `Secure`, en-têtes HSTS, mise en cache). |
| `SESSION_SECRET` | auto-généré | Clé cryptographique préservant les signatures de session. |
| `TRUST_PROXY` | — | Définir sur `1` derrière un reverse proxy (requis pour la validation HTTPS et le traçage exact des IP). |
| `SETUP_CODE` | aléatoire | Code secret réclamé lors de l'enregistrement du premier compte administrateur. |
| `CONTENT_LANGUAGE` | prompt terminal | `fr` ou `en` : force la langue des éléments lors de la génération du monde initial. |
| `PUBLIC_URL` | — | URL publique d'accès (ex. `https://jeu.mondomaine.org`). Requis en production contre les attaques CSWSH. |
| `REGISTRATIONS_PER_HOUR` | `10` *(prod)* | Plafond d'inscriptions autorisées par tranche d'une heure depuis une même IP (`0` = illimité). |
| `IMPORTS_PER_15_MIN` | `3` *(prod)* | Imports de projet (jusqu'à 200 Mo chacun) qu'un même compte peut lancer par tranche de 15 minutes ; illimité hors production (`0` = illimité). |
| `MAX_CHARACTERS` | `4` | Nombre maximum d'avatars qu'un même compte peut détenir. |
| `SMTP_URL` | — | URI de connexion au relais mail sortant (ex. `smtps://user:pass@smtp.example.org:465`). |
| `MAIL_FROM` | — | En-tête d'expédition des e-mails automatiques (ex. `Brindiwanko <no-reply@example.org>`). |

> [!NOTE]
> Les options relatives au gameplay (nom de la monnaie, niveau maximal, paramètres de guilde, taille du sac) se configurent directement dans l'éditeur sous l'onglet **Système**. Le point d'apparition initial propre à chaque classe s'établit dans l'onglet **Classes**.

---

## 🧪 Tests & Assurance Qualité

```bash
# Exécute les contrôles de conformité lexicale, les clés de traduction, puis les 320+ tests unitaires
npm test

# Validation du typage strict sur l'ensemble de la base de code
npm run typecheck

# Simulation de charge réseau : 80 connexions concurrentes pendant 15 secondes
npm run load-test -- 80 15
```

> [!NOTE]
> Les tests s'exécutent au sein d'un environnement temporaire sandboxé : vos dossiers opérationnels `data/` et `uploads/` ne sont jamais modifiés ni altérés lors des sessions de test.

---

## 🚀 Déploiement en Production

Déploiement type sur serveur Linux (Debian / Ubuntu) adossé à **nginx**, certificats SSL **Let's Encrypt** et orchestrateur **pm2** :

```bash
# Installation globale de pm2 et compilation propre
npm install -g pm2
npm ci
npm run build

# Démarrage du service sous isolation locale
NODE_ENV=production HOST=127.0.0.1 TRUST_PROXY=1 PUBLIC_URL=https://jeu.mondomaine.org PORT=3000 pm2 start dist/server/index.js --name Brindiwanko

# Enregistrement du service au démarrage du système
pm2 startup
pm2 save
```

### 🔒 Recommandations de sécurité
1. **Écoute locale stricte** : `HOST=127.0.0.1` assure que Node.js ne répond qu'aux requêtes relayées par nginx, bloquant toute tentative de contournement des pares-feux applicatifs.
2. **Reverse proxy & HTTPS** : Avec `TRUST_PROXY=1`, les sessions requièrent impérativement un flux chiffré HTTPS.
3. **Prévention CSWSH** : La spécification rigoureuse de `PUBLIC_URL` interdit les connexions WebSockets parasites initiées depuis des domaines tiers.
4. **Sandbox de scripts** : L'interpréteur de scripts d'événements s'exécute dans une enclave mémoire bornée sans accès au système de fichiers hôte. Exécutez le processus sous un utilisateur système non privilégié dédié.
5. **Instance unique** : N'activez jamais le mode cluster (`-i`) de pm2 : la simulation du monde virtuel et des combats repose sur la cohérence d'un processus central unique.

### 🌐 Configuration nginx

```nginx
server {
  listen 80;
  server_name jeu.mondomaine.org;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name jeu.mondomaine.org;

  ssl_certificate /etc/letsencrypt/live/jeu.mondomaine.org/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/jeu.mondomaine.org/privkey.pem;

  # Autorise le téléversement de gros packages de cartes (200 Mo) et restaurations (500 Mo)
  client_max_body_size 500m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;

    # Négociation WebSocket
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # En-têtes d'acheminement réseau
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### ☁️ Derrière Cloudflare (ou un second proxy)

Avec Cloudflare (ou tout autre proxy) placé devant nginx, `TRUST_PROXY=1` fait voir à l'application l'adresse de Cloudflare au lieu de celle du joueur. Tous les joueurs partageraient alors les mêmes limites d'inscription (10 par heure et par adresse en production) et de connexion, et les journaux n'enregistreraient que des adresses de Cloudflare.

Demandez à nginx de rétablir la véritable adresse du joueur (module `realip`, inclus dans les paquets nginx de Debian et Ubuntu) en ajoutant ces lignes dans le bloc `server { listen 443 … }` ci-dessus :

```nginx
# Plages d'adresses de Cloudflare, publiées sur https://www.cloudflare.com/ips/ (à vérifier de temps en temps)
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;

# Adresse du joueur transmise par Cloudflare (crue seulement pour les connexions venant des plages ci-dessus)
real_ip_header CF-Connecting-IP;
```

Gardez `TRUST_PROXY=1` : nginx transmet alors à l'application la véritable adresse du joueur. Avec un autre proxy que Cloudflare, indiquez ses propres adresses dans `set_real_ip_from`, puis `real_ip_header X-Forwarded-For;` et `real_ip_recursive on;`.

### 💾 Procédure de restauration des données

```bash
# Lister l'ensemble des sauvegardes archivées
npm run restore

# Restaurer l'archive la plus récente (ou indiquer un nom spécifique)
npm run restore -- latest

# Redémarrer le service pour charger la base restaurée
pm2 restart Brindiwanko
```

> [!TIP]
> Lors d'une restauration, la base en place est archivée avec le suffixe `.before-restore`. L'archive appliquée est préalablement assainie de toutes sessions ou secrets résiduels. Veillez à synchroniser régulièrement le répertoire `data/backups/` vers un support de stockage externe.

### 🔄 Mise à jour

```bash
# 1. Vérifier qu'une sauvegarde récente existe (la plus récente est en tête de liste)
npm run restore

# 2. Récupérer la nouvelle version
git pull

# 3. Installer les dépendances exactes puis recompiler
npm ci
npm run build

# 4. Redémarrer le service
pm2 restart Brindiwanko
```

> [!NOTE]
> Les migrations de la base s'appliquent seules au démarrage du serveur : aucune autre commande n'est nécessaire.  
> En cas de problème, remettez la dernière sauvegarde faite avant la mise à jour avec `npm run restore -- latest` (ou son nom, affiché par `npm run restore`), puis `pm2 restart Brindiwanko`.

---

## 📁 Architecture du Code Source

```text
Brindiwanko/
├── server/       # Cœur applicatif Node.js (Express, Socket.io, Moteur de jeu, DB SQLite)
├── client/       # Client Web (Moteur Canvas 2D, Rendu graphique, UI, Éditeur embarqué)
├── shared/       # Définitions communes (Protocoles réseau, Formules, Typages stricts)
├── assets/       # Générateurs procéduraux de pixel art SVG et actifs compilés
├── views/        # Gabarits HTML / EJS des pages Web du service
├── locales/      # Dictionnaires de localisation bilingues (fr.json, en.json)
├── scripts/      # Outils d'automatisation (Build, Dev, Tests de charge, Démo)
└── tests/        # Bancs de tests automatisés (node --test)
```

---

## 📄 Licence

Ce projet est distribué sous licence open-source **[Apache 2.0](LICENSE)**.

---

<br />

<div align="center">
  <a id="english"></a>

  <img src="assets/img/system/AppIcon-512.png" alt="Brindiwanko Logo" width="130" style="border-radius: 20px;" />

  # 🌿 Brindiwanko (English) 🌿

  **A browser-based 2D MMORPG engine with a built-in live world editor**

  [![Version](https://img.shields.io/badge/version-1.0.0--beta.1-blue.svg?style=flat-square)](package.json)
  [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-7.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Socket.io](https://img.shields.io/badge/Socket.io-4.x-010101?style=flat-square&logo=socketdotio&logoColor=white)](https://socket.io/)
  [![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
  [![Tests](https://img.shields.io/badge/tests-320%2B%20passed-brightgreen?style=flat-square&logo=node.js&logoColor=white)](tests/)
  [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=flat-square)](LICENSE)

  <br />

  [🇫🇷 Lire en Français](#-brindiwanko-) · **English**

  <br />

  <p align="center">
    <a href="#-highlights">✨ Highlights</a> •
    <a href="#-installation--quick-start">🚀 Quick Start</a> •
    <a href="#-playing-the-game">🕹️ Playing</a> •
    <a href="#-world-editor-guide">🗺️ Editor</a> •
    <a href="#-administration--moderation">🛡️ Administration</a> •
    <a href="#-configuration-1">⚙️ Configuration</a> •
    <a href="#-production-deployment">🌐 Deployment</a>
  </p>

</div>

---

> 🎮 **A living world in your browser:** Design your maps, script your quests, place your monsters… and your players see the changes appear **live**, with zero page reloads! ✨

Brindiwanko provides everything needed to build and operate a persistent online world: tilemaps, scripted events and cutscenes, story quests, real-time map combat, parties, guilds, instanced dungeons, and raids.

All powered by **a single Node.js process** backed by **a single SQLite database**: no external database server to deploy or maintain. 🚀

---

## 🤖 An AI-Engineered & Human-Validated Project

> [!NOTE]
> **Brindiwanko was entirely designed and written via artificial intelligence, and rigorously tested by its author alongside standard AI test routines.** 🧠

* 💻 **Code & Generators**: The full codebase (server, client, editor, test suites), procedural asset generators, and documentation are authored by AI under human creative and technical direction.
* 🧪 **Thorough Validation**: Tested with over **320 automated test cases** (`npm test`), an integrated multi-client load tester, and comprehensive end-to-end browser verification sessions.
* ⚠️ **Disclaimer**: As with any generated software, careful review and staging tests are encouraged before going live in production. Issue reports and pull requests are warmly appreciated! 🙏

---

## ✨ Highlights

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

---

## 🎨 Visual Assets: 100% Generated

> [!TIP]
> **Every single visual graphic in Brindiwanko is generated on-the-fly by the project's own build scripts.**

Tilesets, autotiles, character spritesheets, facesets, monsters, raid bosses, inventory icons, window skins, speech bubbles, quest markers, guild banners, and the desktop application icon… 🖌️

* 🧪 **Procedural SVG Pixel Art**: Rendered from vector SVG generators in `assets/generators/` during `npm run build`.
* 🆓 **Zero Proprietary Packs**: Contains no ripped images, commercial tileset packages, or proprietary third-party art. Clean, original, and license-compliant.
* 🔁 **Fully Customizable**: Regenerate them at will (`npm run assets:build`), tweak their generation scripts, or import your custom assets through the built-in **Resources** manager.

---

## 🛠️ Technology Stack

* 🖥️ **Server Engine**: Strict TypeScript, Express 5, Socket.io 4, better-sqlite3 (standalone persistent engine), EJS templating.
* 🌐 **Web Client**: TypeScript bundled via esbuild, high-performance HTML5 2D Canvas rendering, retro-inspired RPG modular windowing.
* 🧪 **Quality Assurance**: Native `node --test` runner (320+ automated tests), integrated stress-testing suite.

---

## 📦 Installation & Quick Start

### Prerequisites

* **Node.js 22** or higher
* **npm** package manager

```bash
# 1. Install dependencies
npm install

# 2. Build visual assets and compile TypeScript
npm run build

# 3. Start the game server
npm start
```

> [!NOTE]
> The included `.npmrc` file deliberately disables unneeded dependency installation scripts. Both SQLite and bcrypt ship with precompiled platform binaries (Windows, Linux, macOS) — no C++ compilation toolchain is required.

🌐 Open **<http://localhost:3000>**.  
Upon first launch, `data/game.db` is created, migrated to the latest schema, and initialized with the demo starter world.

* **Development mode**: Run `npm run dev` for automatic server reloading and client recompilation on any file save.

---

## 👑 First Administrator Account

The **very first player** to register an account automatically gains full **administrator privileges** 🎉. Accounts created afterwards will be standard players. Administrators can promote other users to moderator or administrator ranks directly from the administration dashboard (permissions take effect immediately, even while in-game).

> [!IMPORTANT]
> **Production Hardening (`NODE_ENV=production`)**:  
> When running in production on an empty database, registration of the first account mandates entering a **Setup Code** (`SETUP_CODE`). This token is output in the server initialization log or defined via the `SETUP_CODE` environment variable, ensuring unauthorized visitors cannot claim server ownership.

---

## 🕹️ Playing the Game

### 🚀 Getting Started
1. **Character Creation**: Pick your starting class and customize your appearance. Each account may log in with one active character at a time.
2. **Account Management**: Access **My Account** (top-left link) to update passwords, change registered email addresses, or delete characters and accounts.
3. **Password Recovery**: The **Forgotten Password?** page emails a secure reset link valid for 60 minutes (requires `SMTP_URL` to be configured).

### 🎮 Default Controls

| Action | Keyboard Controls | Touch / Mobile |
| :--- | :--- | :--- |
| **Movement** | <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / <kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> or Left Click | Virtual Joystick |
| **Interact / Attack Forward** | <kbd>Space</kbd> or <kbd>Enter</kbd> | Button <kbd>A</kbd> |
| **Direct Attack** | <kbd>F</kbd> | Action Button |
| **Hotbar Slots** | <kbd>1</kbd> through <kbd>8</kbd> | Arc Skill Buttons |
| **Main Menu** | <kbd>Escape</kbd> | Menu Button |

### 🪟 Interface Hotkeys

| Window | Key | Window | Key |
| :--- | :---: | :--- | :---: |
| 🎒 **Bag (Inventory)** | <kbd>I</kbd> | 📜 **Quest Journal** | <kbd>J</kbd> |
| 👤 **Character Sheet** | <kbd>C</kbd> | 👥 **Friends List** | <kbd>L</kbd> |
| 🔮 **Spellbook & Skills** | <kbd>K</kbd> | 🛡️ **Guild Panel** | <kbd>G</kbd> |
| ⚔️ **Party Management** | <kbd>P</kbd> | 🗺️ **World Map** | <kbd>M</kbd> |
| ⚙️ **Game Settings** | <kbd>O</kbd> | 💬 **Focus Chat** | <kbd>Enter</kbd> |

### ⚔️ Core Gameplay Mechanics
* **Action Hotbars & Targeting**: Drag-and-drop skills and consumable items onto the hotbar slots. Click any monster or player to set them as your active target.
* **Player Context Menu**: Clicking another player avatar or their name in chat opens a contextual menu allowing private messages, friend requests, party or guild invites, secure trade requests, gear inspection, muting/ignoring, or reporting. A 10-second spam cooldown applies to invitations (increased to 1 minute following a refusal).
* **Experience & Loot Sharing**: XP and gold from defeated enemies are shared proportionally according to damage dealt (party members receive an additional +10% bonus per ally present). Physical item drops are awarded to the player or party dealing the majority of damage.
* **Raid Encounters**: Raids verify the count of present party members at the entrance threshold; the boss encounter remains invulnerable until all members are inside the arena.
* **Economic Security**: Vendor, inn, and bank storage dialogs close automatically if a player is knocked out or transitions to another map, preventing out-of-bounds trade exploits.

---

## 🗺️ World Editor Guide

For accounts granted administrator privileges, the world editor is accessible directly in-game via the **Administration** 👑 menu icon, then selecting **"Open the map editor"**. All saved changes propagate **instantly** to active players! ⚡

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Live World Editor                               │
├─────────────────┬──────────────────────────────────────────────────────┤
│ 🗺️ Maps        │ Map hierarchy, auto layers, autotiles, shadows,      │
│                 │ region IDs, looping wrap-around, version rollbacks   │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 🚧 Passability  │ Manual cell block/unblock without changing tiles     │
│                 │ (displayed with distinct highlight outlines)         │
├─────────────────┼──────────────────────────────────────────────────────┤
│ ⚙️ Properties   │ Display name, dimensions, tileset, PvP flag,         │
│                 │ instancing toggle, BGM/BGS audio, map monster spawns │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 🧩 Events       │ Quick NPCs, chests, teleporters, cutscenes, triggers │
│                 │ multi-page condition trees, visual command lists     │
├─────────────────┼──────────────────────────────────────────────────────┤
│ 📚 Database     │ Classes, skills, items, enemies, quests, raids...    │
│                 │ Resilient lossless JSON import and export            │
└─────────────────┴──────────────────────────────────────────────────────┘
```

* ▶️ **"Test Map" Quick Tool**: Saves current modifications, exits the editor, and instantly teleports your player character to the clicked coordinate.
* 📚 **JSON Reference Resilience**: When importing database files, references to entries not present in the game or file are retained safely without crashing; the editor tallies missing links and highlights the first 10 entries for administrator review.
* 🖼️ **Resource Manager**: Import bespoke audio and graphic files or import complete projects in standard file formats. Damaged or interrupted file uploads are rejected automatically, leaving active assets unharmed.
* 🧪 **Script Quarantine Safety**: Any imported executable script logic (script commands, script page conditions, script variable formulas) is safely quarantined and **remains inert** until reviewed and activated by an administrator in the *"Scripts to review"* window.
* 🗑️ **Safe Deletions**: Deleting a map or database record that remains referenced elsewhere (quest targets, transitions, monsters, stores) requires confirmation and presents a list of usages. Deleted entity IDs are never recycled.
* 🪜 **Special Tiles**: A tile configured as a **ladder** forces the player sprite to look upward; tiles configured as **damage floors** deduct 10 HP per step without ever causing a knock-out.
* 🔑 **Self Switches vs Instance Switches**: Self switches belong to individual player characters (a opened chest in a dungeon stays opened for that specific player). For states bound to a specific dungeon run, declare an instance-bound switch under the **System** tab.

---

## 🛡️ Administration & Moderation

### 📊 Management Dashboard (`/admin`)

Available to authorized moderators and administrators:

* 📈 **Live Overview**: Monitor active server load, connected player sessions, and active map/dungeon instances.
* 👤 **Account Oversight**: Manage permission roles, issue kicks/mutes/bans, force logouts, or reset credentials.  
  *(Moderators view masked email addresses and no IP addresses. The root server administrator cannot be demoted).*
* 🧰 **Game Tools**: Coordinate-based teleportation, staff invisibility, currency/item distribution, global switch manipulation, and server-wide broadcast banners.
* 📝 **Audit Logs**: Tamper-proof logs detailing connections, player trades, vendor transactions, rare loot drops, and moderation actions.
* 💾 **Backup & Restore**: Download database backups stripped of server secrets and sessions. Restores are verified against strict schema constraints before application and, whether from a server backup or an uploaded file, ask for the administrator's password again.

### 💬 In-Game Staff Commands

| Command | Min Role | Effect |
| :--- | :---: | :--- |
| `/kick <player> [reason]` | Moderator | Disconnects the targeted player immediately (may log back in). |
| `/mute <player> [duration] [reason]` | Moderator | Mutes player across channels for a specified duration (`30m`, `2h`, `7d`). |
| `/unmute <player>` | Moderator | Removes an active chat silence from the user. |
| `/ban <player> [duration\|perm] [reason]` | Administrator | Temporarily or permanently suspends the user account. |
| `/unban <player>` | Administrator | Revokes an existing account suspension. |
| `/all <message>` | Moderator | Broadcasts a priority announcement to the global staff-only world channel. |
| `/pkick <player>` | Player (Leader) | Removes an adventurer from your active expedition party. |

> [!TIP]
> **Data Retention & Privacy**: Automated backups execute nightly at the hour configured in the panel (default: 4:00 AM) with retention windows of 1, 7, 14, or 31 days. Activity logs older than 90 days are pruned daily, and account deletion permanently scrubs all associated IP history.

---

## 🌳 Demonstration World

Fresh installations come with a ready-to-play starter world:
* 🏘️ **Village of Brindiwanko**: Interactive villagers, general store merchant, restful inn, bank storage clerk, and starter chests.
* 🌲 **Bruyère Forest**: Roaming wildlife, collectable herbs, and scripted introductory cutscenes.
* 🏠 **House Interiors**: Fully decorated indoor maps with seamless entrance transitions.
* 🦇 **Bruyère Cavern**: Instanced dungeon housing the formidable 👺 **Goblin King** raid encounter.
* 📖 **Chapter 1 Storyline**: A sequence of linked starter quests teaching basic adventure mechanics.

```bash
# Export the complete demo world into JSON files in demo/
npm run demo:export
```

> [!TIP]
> **Resetting to a Blank World**: Shut down the server, delete the database files `data/game.db*` (including `-wal` and `-shm`), and restart.  
> On clean startup, the terminal prompts: `Choose language/Choix de la langue (EN/FR) :`. The starter world will be populated in the chosen language. In unattended deployments (pm2, Docker), set `CONTENT_LANGUAGE=en` or `fr`.

---

## ⚙️ Configuration

All environment variables are optional with sensible defaults:

| Variable | Default | Description |
| :--- | :---: | :--- |
| `PORT` | `3000` | HTTP and WebSocket listener port. |
| `HOST` | `0.0.0.0` | Network bind address (`127.0.0.1` strongly advised behind an nginx reverse proxy). |
| `DB_PATH` | `game.db` in `DATA_DIR` | Path of the SQLite file, absolute (e.g. `/var/lib/brindiwanko/game.db`) or relative to the **project folder** (not to `DATA_DIR`). Its backups go to a `backups/` folder next to it. |
| `DATA_DIR` | `data/` | Folder of the default database and of its `backups/` subfolder (no effect on a `DB_PATH` you set). |
| `UPLOADS_DIR` | `uploads/` | Storage directory for uploaded user assets (served under `/uploads/`). |
| `NODE_ENV` | — | Set to `production` to enforce secure cookies, HSTS headers, and asset caching. |
| `SESSION_SECRET` | auto-generated | Secret key used to sign HTTP session cookies. |
| `TRUST_PROXY` | — | Set to `1` behind a reverse proxy (required for HTTPS cookie validation and IP tracing). |
| `SETUP_CODE` | random token | Verification code required when registering the initial admin account in production. |
| `CONTENT_LANGUAGE` | prompt | `en` or `fr`: sets the language for initial database demo generation. |
| `PUBLIC_URL` | — | Canonical public address (e.g. `https://game.example.org`). Blocks CSWSH attacks. |
| `REGISTRATIONS_PER_HOUR` | `10` *(prod)* | Maximum account registrations per IP per hour (`0` = unlimited). |
| `IMPORTS_PER_15_MIN` | `3` *(prod)* | Project imports (up to 200 MB each) one account may start per 15 minutes; unlimited outside production (`0` = unlimited). |
| `MAX_CHARACTERS` | `4` | Maximum character slots permitted per player account. |
| `SMTP_URL` | — | Outbound SMTP connection string (e.g. `smtps://user:pass@smtp.example.org:465`). |
| `MAIL_FROM` | — | From address for outgoing transaction emails (e.g. `Brindiwanko <no-reply@example.org>`). |

> [!NOTE]
> Gameplay rules (currency names, level caps, guild limits, bag capacities) are adjusted in the editor's **System** tab. Class-specific starting spawn locations are defined within the **Classes** tab.

---

## 🧪 Testing & Quality Verification

```bash
# Runs naming lint, translation parity checks, and the 320+ unit test suite
npm test

# Strict TypeScript type checks across server, client, and developer tools
npm run typecheck

# Network load test: 80 simulated concurrent clients over 15 seconds
npm run load-test -- 80 15
```

> [!NOTE]
> All automated tests execute in an isolated temporary directory: live files in `data/` and `uploads/` are never touched during testing runs.

---

## 🚀 Production Deployment

Standard production deployment on a Linux server using **nginx**, **Let's Encrypt** SSL, and **pm2** process management:

```bash
# Global PM2 setup and build
npm install -g pm2
npm ci
npm run build

# Start server bound to local loopback interface
NODE_ENV=production HOST=127.0.0.1 TRUST_PROXY=1 PUBLIC_URL=https://game.example.org PORT=3000 pm2 start dist/server/index.js --name Brindiwanko

# Persist daemon across server reboots
pm2 startup
pm2 save
```

### 🔒 Operational Security Checklist
1. **Loopback Binding**: `HOST=127.0.0.1` guarantees Node.js only accepts connections forwarded by nginx, eliminating unproxied access vectors.
2. **Reverse Proxy & HTTPS**: With `TRUST_PROXY=1`, session cookies are marked `Secure`, requiring HTTPS transport.
3. **CSWSH Defense**: Providing `PUBLIC_URL` ensures WebSocket upgrades originating from third-party origins are rejected.
4. **Sandboxed Event Scripts**: The event scripting sandbox has no filesystem access and enforces a strict memory ceiling. Run the server under a dedicated system user with restricted permissions.
5. **Single Process**: Never run pm2 in cluster mode (`-i`): game world state and combat simulations rely on single-process state integrity.

### 🌐 Nginx Configuration

```nginx
server {
  listen 80;
  server_name game.example.org;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name game.example.org;

  ssl_certificate /etc/letsencrypt/live/game.example.org/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/game.example.org/privkey.pem;

  # Allow large project uploads (200MB) and database restore archives (500MB)
  client_max_body_size 500m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;

    # WebSocket Upgrade
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # Forwarding Headers
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### ☁️ Behind Cloudflare (or a Second Proxy)

With Cloudflare (or any other proxy) in front of nginx, `TRUST_PROXY=1` makes the application see Cloudflare's address instead of the player's. Every player would then share the same registration limit (10 per hour and per address in production) and login limits, and the logs would only record Cloudflare addresses.

Have nginx restore the player's real address (`realip` module, included in the Debian and Ubuntu nginx packages) by adding these lines to the `server { listen 443 … }` block above:

```nginx
# Cloudflare address ranges, published at https://www.cloudflare.com/ips/ (check them now and then)
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;

# Player address sent by Cloudflare (trusted only for connections coming from the ranges above)
real_ip_header CF-Connecting-IP;
```

Keep `TRUST_PROXY=1`: nginx then passes the player's real address on to the application. With a proxy other than Cloudflare, list its own addresses in `set_real_ip_from`, then use `real_ip_header X-Forwarded-For;` and `real_ip_recursive on;`.

### 💾 Backup Restoration Guide

```bash
# Display chronological list of available backups
npm run restore

# Restore the most recent backup snapshot (or specify an exact archive name)
npm run restore -- latest

# Restart the process to apply the restored state
pm2 restart Brindiwanko
```

> [!TIP]
> Restoring a snapshot preserves existing database state with a `.before-restore` extension. Restored archives are automatically purged of active sessions and secrets. Schedule regular off-site transfers of the `data/backups/` directory.

### 🔄 Updating

```bash
# 1. Check that a recent backup exists (the newest is at the top of the list)
npm run restore

# 2. Fetch the new version
git pull

# 3. Install the exact dependencies, then rebuild
npm ci
npm run build

# 4. Restart the service
pm2 restart Brindiwanko
```

> [!NOTE]
> Database migrations apply on their own when the server starts: no other command is needed.  
> If something goes wrong, put back the last backup made before the update with `npm run restore -- latest` (or its name, shown by `npm run restore`), then `pm2 restart Brindiwanko`.

---

## 📁 Source Tree Architecture

```text
Brindiwanko/
├── server/       # Node.js backend (Express, Socket.io, World simulation, SQLite database)
├── client/       # Web client (Canvas 2D render loop, UI windows, Embedded world editor)
├── shared/       # Shared contracts (Network wire protocol, Math formulas, Shared types)
├── assets/       # Procedural SVG pixel art generators and asset compilation targets
├── views/        # EJS templates for public account and auth views
├── locales/      # Internationalization dictionaries (fr.json, en.json)
├── scripts/      # Operational scripts (Build pipeline, Load tester, Demo export)
└── tests/        # Automated test suites (node --test)
```

---

## 📄 License

This software is released under the **[Apache 2.0 License](LICENSE)**.
