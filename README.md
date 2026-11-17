<a id="fr-top"></a>

<div align="center">

  <img src="assets/img/system/AppIcon-512.png" alt="Logo Brindiwanko" width="128" />

  # 🌿 Brindiwanko

  **Moteur de MMORPG 2D navigateur avec éditeur de monde temps réel intégré**

  [![Version](https://img.shields.io/badge/version-1.0.0--beta.1-2563eb?style=for-the-badge)](package.json)
  [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.0.0-16a34a?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-7.x-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Socket.io](https://img.shields.io/badge/Socket.io-4.x-0f172a?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)
  [![SQLite](https://img.shields.io/badge/SQLite-WAL%20%2B%20better--sqlite3-0369a1?style=for-the-badge&logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
  [![Tests](https://img.shields.io/badge/tests-330%20passed-15803d?style=for-the-badge&logo=node.js&logoColor=white)](tests/)
  [![License](https://img.shields.io/badge/License-Apache_2.0-475569?style=for-the-badge)](LICENSE)

  <br />

  **🇫🇷 Français** &nbsp;·&nbsp; [🇬🇧 Switch to English](#en-top)

  <br />

  [✨ Fonctionnalités](#fr-fonctionnalites) •
  [🚀 Démarrage](#fr-demarrage) •
  [🕹️ Jouer](#fr-jouer) •
  [🗺️ Éditeur](#fr-editeur) •
  [🛡️ Administration](#fr-administration) •
  [⚙️ Configuration](#fr-configuration) •
  [🌐 Déploiement](#fr-deploiement) •
  [📜 Nouveautés](#fr-changelog)

</div>

---

> 🎮 **Un monde persistant directement dans le navigateur :** dessinez vos cartes, écrivez vos quêtes, placez vos monstres… et vos joueurs voient chaque mise à jour **en direct**, sans recharger la page.

**Brindiwanko** réunit dans **un seul processus Node.js** et **une seule base SQLite** tout le nécessaire pour lancer et administrer un monde en ligne complet : cartes en tuiles, cinématiques, quêtes à étapes, combats temps réel, groupes, guildes, donjons instanciés et raids — sans serveur de base de données externe à configurer.

> [!NOTE]
> **Un projet conçu par IA & validé par l'humain**  
> L'ensemble du code (serveur, client, éditeur, générateurs SVG et tests) est rédigé par intelligence artificielle sous direction technique et créative humaine, puis éprouvé par **330 tests automatisés** (`npm test`), un banc de charge multi-clients et des campagnes de jeu en navigateur. Comme pour tout logiciel, une relecture et des essais en pré-production sont recommandés avant ouverture publique.

---

<a id="fr-fonctionnalites"></a>

## ✨ Panorama des capacités

| Domaine | Fonctionnalités clés |
| :--- | :--- |
| 🗺️ **Éditeur temps réel** | Palettes A–E avec mémoire par onglet, couches automatiques, autotiles, ombres dynamiques, régions, passabilité manuelle, cartes toroïdales, historique des versions, bouton *« Tester la carte »*. |
| 🧩 **Événements & Cinématiques** | Multi-pages conditionnelles, déclencheurs (action, contact, auto, parallèle), éditeur visuel de commandes, fondus, teintes, flashs, secousses, images, météo, caméra, minuteurs. |
| ⚔️ **Combat temps réel** | Affrontements directs sur carte, compétences, altérations d'état, affinités élémentaires, critiques, IA à confinement de région et tables de butin. |
| 📜 **Quêtes & Progression** | Étapes séquentielles, objectifs variés (parler, vaincre, collecter, atteindre une zone), marqueurs `!` / `?`, récompenses et journal de quêtes. |
| 🎒 **Personnage & Économie** | Attributs à répartir, inventaire en grille, équipement, marchands, auberges, coffre de banque, sécurité anti-duplication lors des KO ou changements de carte. |
| 💬 **Social & Guildes** | Canaux All/Carte/Groupe/Guilde/Privé/Système, liste d'amis et d'ignorés, échanges sécurisés, émoticônes, rangs/permissions, banque et journal de guilde, blason généré. |
| 🏰 **Donjons & Raids** | Instances privées par groupe, boss à phases scriptées, verrouillage de présence de groupe à l'entrée, lockouts hebdomadaires et butin aux dés. |
| 👑 **Administration** | Tableau de bord live (CPU, lag, instances), sanctions (`/kick`, `/mute`, `/ban`), outils MJ, journaux d'audit, sauvegardes automatiques et restauration vérifiée. |
| 🎨 **100 % Graphismes générés** | Tilesets, personnages, portraits, monstres, boss, icônes et fenêtres générés en pixel-art vectoriel depuis `assets/generators/` (`npm run assets:build`), libres et sans dépendance tierce. |
| 📱 **Mobile & Bilingue** | Joystick virtuel, boutons `A`/`B`, compétences en arc, bascule tactile/bureau à chaud (`(hover: none)`), PWA plein écran et traduction intégrale **FR / EN**. |

### 🏗️ Architecture technique en bref

```mermaid
flowchart LR
  Browser["🌐 Navigateur / PWA<br/>Canvas 2D + Éditeur Live"] <-- "HTTP + Socket.io 4" --> Server["⚙️ Serveur Node.js + Express 5<br/>Simulation 20 Hz · Auth · Admin"]
  Server --> SQLite[("🗄️ SQLite WAL<br/>data/game.db")]
  Server -. "Scripts isolés (--permission)" .-> Sandbox["🧪 Sandbox VM"]
  Server -. "Vérification asynchrone" .-> Worker["🧵 Worker PRAGMA"]
```

<details>
<summary>📁 Arborescence du dépôt</summary>

```text
Brindiwanko/
├── server/       # Serveur Node.js (Express 5, Socket.io, boucle de jeu, dépôts SQLite, migrations)
├── client/       # Client web TypeScript (Canvas 2D, UI RPG modulaire, éditeur visuel intégré)
├── shared/       # Contrats partagés (protocole Socket.io typé, schémas, formules, i18n)
├── assets/       # Générateurs procéduraux SVG de pixel art et ressources compilées
├── views/        # Gabarits EJS des pages web (authentification, personnages, compte, admin)
├── locales/      # Dictionnaires de traduction fr.json et en.json (2 364 clés)
├── scripts/      # Pipeline de build, serveur dev, load-test, export démo, vérifications CI
└── tests/        # Suite de 330 tests automatisés (node --test)
```

</details>

---

<a id="fr-demarrage"></a>

## 🚀 Installation & Démarrage rapide

### Prérequis
- **Node.js 26 LTS** recommandé *(version minimale : **Node.js 24**)*
- **npm**

```bash
# 1. Installer les dépendances
npm install

# 2. Générer les ressources graphiques et compiler serveur + client
npm run build

# 3. Démarrer le serveur
npm start
```

> [!NOTE]
> Le fichier `.npmrc` bloque l'exécution de scripts d'installation tiers : `better-sqlite3` et `bcrypt` utilisent leurs binaires précompilés (Windows, Linux, macOS). Aucun compilateur C++ n'est nécessaire.

Ouvrez ensuite **<http://localhost:3000>** : au premier démarrage, `data/game.db` est créé, migré au schéma le plus récent et peuplé avec le monde de démonstration.

- **Mode développement :** `npm run dev` relance le serveur et recompile le client automatiquement à chaque modification.

### 👑 Premier compte administrateur

Le **tout premier utilisateur** inscrit reçoit automatiquement le rôle d'**administrateur**. Les comptes suivants démarrent en joueurs standards ; les promotions/rétrogradations depuis `/admin` s'appliquent instantanément, y compris en cours de partie.

> [!IMPORTANT]
> **Protection en production (`NODE_ENV=production`) :** tant que la base ne contient aucun compte, l'inscription initiale exige un **code d'installation** (`SETUP_CODE`) lu depuis la variable d'environnement ou affiché une fois dans le journal de démarrage.

---

<a id="fr-jouer"></a>

## 🕹️ Commandes & Guide du Joueur

<details open>
<summary>🎮 Raccourcis clavier, mobile et fenêtres d'interface</summary>

| Action | Clavier / Souris | Mobile / Tactile |
| :--- | :--- | :--- |
| **Se déplacer** | <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd>, <kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd>, <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ou clic gauche | Joystick virtuel |
| **Interagir / Attaque frontale** | <kbd>Espace</kbd> ou <kbd>Entrée</kbd> | Bouton <kbd>A</kbd> |
| **Attaquer** | <kbd>F</kbd> | Bouton d'attaque |
| **Barre d'actions (1–8)** | <kbd>1</kbd> à <kbd>8</kbd> | Compétences en arc |
| **Menu principal / Annuler** | <kbd>Échap</kbd> | Bouton <kbd>B</kbd> / Menu |

| Fenêtre | Touche | Fenêtre | Touche |
| :--- | :---: | :--- | :---: |
| 🎒 **Sac (Inventaire)** | <kbd>I</kbd> | 📜 **Journal de quêtes** | <kbd>J</kbd> |
| 👤 **Fiche Personnage** | <kbd>C</kbd> | 👥 **Amis & Ignorés** | <kbd>L</kbd> |
| 🔮 **Compétences** | <kbd>K</kbd> | 🛡️ **Guilde** | <kbd>G</kbd> |
| ⚔️ **Groupe** | <kbd>P</kbd> | 🗺️ **Carte du monde** | <kbd>M</kbd> |
| ⚙️ **Options** | <kbd>O</kbd> | 💬 **Tchat** | <kbd>Entrée</kbd> |

</details>

- **Premiers pas :** un seul personnage actif par compte à la fois ; gestion du mot de passe, de l'e-mail et suppression définitive depuis **Mon compte** ; récupération d'accès via **Mot de passe oublié ?** *(lien valide 1 h, requiert `SMTP_URL`)*.
- **Ciblage & Social :** glisser-déposer vers la barre 1–8, clic sur un joueur ou un pseudo pour chuchoter, échanger, inviter, inspecter, ignorer ou signaler *(anti-spam 10 s entre invitations, 1 min après refus)*.
- **Partage XP, Butin & Raids :** XP et or répartis au prorata des dégâts *(+10 % par allié de groupe présent)* ; le butin revient au plus gros contributeur ; un boss de raid reste invulnérable tant que tout le groupe n'a pas franchi l'entrée.
- **Sécurité économique :** boutiques, auberges et coffres se ferment automatiquement en cas de KO ou de changement de carte.

---

<a id="fr-editeur"></a>

## 🗺️ Prise en main de l'éditeur de monde

Accessible aux administrateurs depuis le jeu via **Administration** 👑 ➔ **« Ouvrir l'éditeur de cartes »**. Les sauvegardes mettent à jour le monde connecté **en temps réel**.

| Module | Rôle principal |
| :--- | :--- |
| **Cartes & Passabilité** | Arborescence, calques auto/tuiles, ombres, régions, boucle toroïdale, verrou d'édition multi-admin et surcharge de passabilité par case. |
| **Propriétés & Spawns** | Dimensions, tileset, PvP, instanciation de donjon, musiques BGM/BGS, zones et effectifs d'apparition des monstres. |
| **Événements & Base de données** | Événements rapides (PNJ, coffres, téléporteurs), pages/conditions, classes, sorts, objets, monstres, quêtes, raids, import/export JSON sans perte. |

- ▶️ **« Tester la carte » :** sauvegarde, ferme l'éditeur et téléporte votre personnage directement sur la case visée.
- 🖼️ **Ressources & Imports :** détection de type et dimensions, protection contre les fichiers tronqués, mise en **quarantaine** automatique de tout script importé tant qu'un administrateur ne l'a pas validé dans *« Scripts à vérifier »*.
- 🗑️ **Sécurité d'édition :** avertissement listant les dépendances avant suppression ; les identifiants supprimés (comptes, personnages, cartes, fiches) ne sont jamais réattribués.
- 🪜 **Cases spéciales & Interrupteurs :** une tuile **échelle** oriente vers le haut ; un **sol à dégâts** retire 10 PV par pas sans tuer ; les interrupteurs **d'instance** (onglet Système) isolent l'état d'une session de donjon.

---

<a id="fr-administration"></a>

## 🛡️ Administration & Modération

### 📊 Console `/admin`
- **Tableau de bord live :** charge CPU échantillonnée périodiquement, latence de boucle d'événements, joueurs en ligne et instances actives.
- **Comptes & Outils MJ :** rôles, avertissements, sourdine, bannissements, réinitialisation de mot de passe *(modérateurs sans accès IP et e-mails masqués ; le propriétaire initial ne peut être rétrogradé)*, téléportation, invisibilité, dons, interrupteurs/variables et annonces.
- **Audit & Sauvegardes :** journaux de connexions, échanges, ventes, butins rares et modération ; export `.db` nettoyé des sessions/secrets ; restauration avec double contrôle de schéma SQLite et redemande de mot de passe administrateur.

### 💬 Commandes de modération en jeu

| Commande | Rôle minimal | Action |
| :--- | :---: | :--- |
| `/kick <joueur> [motif]` | Modérateur | Expulse immédiatement la session. |
| `/mute <joueur> [durée] [motif]` | Modérateur | Coupe le chat (`30m`, `2h`, `7j`). |
| `/unmute <joueur>` | Modérateur | Lève la mise en sourdine. |
| `/ban <joueur> [durée\|perm] [motif]` | Administrateur | Suspend le compte temporairement ou définitivement. |
| `/unban <joueur>` | Administrateur | Révoque un bannissement actif. |
| `/all <message>` | Modérateur | Annonce sur le canal global staff. |
| `/pkick <joueur>` | Joueur (Chef) | Retire un membre du groupe. |

> [!TIP]
> **Rétention & Confidentialité :** sauvegardes nocturnes automatiques (par défaut 4 h, conservation 1 / 7 / 14 / 31 jours), purge quotidienne des journaux de plus de 90 jours, et effacement irréversible des IP lors de la suppression d'un compte.

---

## 🌳 Monde de démonstration

Une base neuve démarre avec un monde jouable complet : **Village de Brindiwanko**, **Forêt de Bruyère**, **Intérieurs**, **Grotte de Bruyère** *(donjon instancié avec le Roi Gobelin)* et **Chapitre 1**.

```bash
# Exporter le monde de démonstration vers demo/
npm run demo:export
```

> **Réinitialiser le monde :** arrêtez le serveur, supprimez `data/game.db*` (`-wal` et `-shm` inclus), puis relancez. Sans terminal interactif (pm2, Docker), définissez `CONTENT_LANGUAGE=fr` ou `en`.

---

<a id="fr-configuration"></a>

## ⚙️ Configuration

Toutes les variables d'environnement sont optionnelles :

| Variable | Défaut | Rôle |
| :--- | :---: | :--- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Port et adresse d'écoute (`127.0.0.1` conseillé derrière nginx). |
| `DB_PATH` | `data/game.db` | Chemin absolu ou relatif au projet de la base SQLite (backups à côté). |
| `DATA_DIR` / `UPLOADS_DIR` | `data/` / `uploads/` | Dossiers des données par défaut et des ressources importées. |
| `NODE_ENV` | — | `production` active cookies `Secure`, HSTS et caches statiques. |
| `SESSION_SECRET` | auto-généré | Secret de signature des sessions HTTP. |
| `TRUST_PROXY` | `false` | Accepter `1` ou `true` derrière un reverse proxy (`0`/`false` pour désactiver ; échoue au démarrage sinon). |
| `PUBLIC_URL` | — | Origine publique (ex. `https://mondomaine.fr`) requise contre les attaques CSWSH. |
| `SETUP_CODE` | aléatoire | Code du premier compte administrateur en production (à fixer explicitement si vos logs sont centralisés). |
| `CONTENT_LANGUAGE` | prompt terminal | `fr` ou `en` pour générer le monde de démonstration sans saisie interactive. |
| `REGISTRATIONS_PER_HOUR` | `10` *(prod)* | Limite d'inscriptions par heure et par IP (`0` = illimité). |
| `IMPORTS_PER_15_MIN` | `3` *(prod)* | Limite d'imports de projet (200 Mo max) par compte / 15 min (`0` = illimité). |
| `MAX_CHARACTERS` | `4` | Nombre maximum de personnages par compte. |
| `SMTP_URL` / `MAIL_FROM` | — | Relais SMTP sortant et expéditeur pour la réinitialisation de mot de passe. |

---

## 🧪 Tests & Assurance Qualité

```bash
# Contrôles lexicaux, parité i18n (clés + {{placeholders}} + vues .ejs) et 330 tests
npm test

# Vérification TypeScript stricte (serveur, client, outils)
npm run typecheck

# Test de charge : 80 clients simultanés pendant 15 secondes
npm run load-test -- 80 15
```

> [!NOTE]
> Tous les tests s'exécutent dans un répertoire temporaire isolé : `data/` et `uploads/` restent intacts.

---

<a id="fr-deploiement"></a>

## 🌐 Déploiement en Production (VPS Ubuntu / Debian)

| Domaine cible | Serveur interne | Reverse proxy | Autorité SSL |
| :--- | :--- | :--- | :--- |
| `mondomaine.fr` (et `www`) | Node.js sur `127.0.0.1:3000` | Nginx (ports `80` et `443`) | Let's Encrypt (`Certbot`) |

En production, Node.js ne gère pas directement le certificat SSL : **Nginx** reçoit les connexions chiffrées sur le port `443`, déchiffre le trafic HTTPS puis relaie localement vers `http://127.0.0.1:3000`.

### Étape 1 — Pointer le domaine vers l'IP du VPS & ouvrir le pare-feu

> [!IMPORTANT]
> **Prérequis DNS indispensable :** chez votre hébergeur de nom de domaine (registrar), vous devez créer un enregistrement DNS de type **`A`** faisant pointer `mondomaine.fr` (et `www.mondomaine.fr` en `A` ou `CNAME` si utilisé) vers **l'adresse IPv4 publique du VPS** sur lequel le jeu va tourner. Attendez la propagation DNS avant de lancer Certbot.

```bash
# 1. Vérifier que votre domaine renvoie bien l'IP publique de votre VPS
dig +short mondomaine.fr

# 2. Si le pare-feu UFW est actif, autoriser HTTP (80) et HTTPS (443)
sudo ufw allow 'Nginx Full'
sudo ufw status
```

> Contrôle : `dig` affiche exactement l'IPv4 de votre VPS et `Nginx Full` apparaît en statut `ALLOW`.

### Étape 2 — Installer et configurer Nginx

1. Installez Nginx puis créez le fichier de configuration du domaine *(retirez `www.mondomaine.fr` si vous n'avez déclaré que le domaine racine)* :

```bash
sudo apt update && sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/mondomaine.fr
```

2. Collez cette configuration dans le fichier :

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name mondomaine.fr www.mondomaine.fr;

    client_max_body_size 500m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

3. Activez la configuration, vérifiez la syntaxe puis rechargez Nginx :

```bash
sudo ln -s /etc/nginx/sites-available/mondomaine.fr /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

> Contrôle : `sudo nginx -t` affiche `syntax is ok` et `test is successful`.

### Étape 3 — Activer le certificat SSL/TLS avec Certbot

Certbot génère gratuitement le certificat Let's Encrypt, configure automatiquement le port `443` dans Nginx et force la redirection HTTPS *(supprimez `-d www.mondomaine.fr` si le sous-domaine `www` n'est pas configuré)* :

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx --cert-name mondomaine.fr -d mondomaine.fr -d www.mondomaine.fr

# Vérifier le renouvellement automatique (validité 90 jours)
sudo certbot renew --dry-run
```

> Contrôle : renseignez votre e-mail d'alerte, validez les conditions et la redirection HTTPS ; `https://mondomaine.fr` doit s'ouvrir avec un cadenas valide.

### Étape 4 — Lancer et verrouiller Brindiwanko (`127.0.0.1:3000`)

Brindiwanko écoute uniquement sur l'interface locale grâce à `HOST=127.0.0.1` et active la prise en charge du reverse proxy via `TRUST_PROXY=1` *(aucune modification du code requise)*.

```bash
# Installation globale de pm2 et compilation propre
npm install -g pm2
npm ci && npm run build

# Démarrage en processus unique derrière Nginx
NODE_ENV=production HOST=127.0.0.1 TRUST_PROXY=1 PUBLIC_URL=https://mondomaine.fr PORT=3000 pm2 start dist/server/index.js --name Brindiwanko
pm2 startup && pm2 save
```

> [!IMPORTANT]
> **Règles d'exploitation :** écoutez sur `127.0.0.1` derrière HTTPS avec `PUBLIC_URL` défini (empêche l'accès direct non chiffré `http://IP_DU_VPS:3000` et bloque les attaques CSWSH), utilisez un utilisateur système non privilégié et **n'activez jamais** le mode cluster pm2 (`-i`) : l'état du monde et des combats vit dans un processus unique.

<details>
<summary>🩺 Diagnostic rapide en cas d'incident</summary>

| Symptôme | Cause probable | Action corrective |
| :--- | :--- | :--- |
| `502 Bad Gateway` | Le processus Node.js est arrêté ou n'écoute pas sur le port `3000`. | Vérifier avec `ss -tulpn \| grep 3000` et relancer via `pm2 restart Brindiwanko`. |
| `nginx -t` signale `No such file` | Lien symbolique cassé dans `/etc/nginx/sites-enabled/`. | Supprimer le lien invalide (`sudo rm /etc/nginx/sites-enabled/<nom>`) puis recréer le lien vers `mondomaine.fr`. |
| `bind() to 0.0.0.0:80 failed` | Un autre serveur web (ex. Apache2) occupe le port `80`. | Identifier le service (`sudo ss -tulpn \| grep :80`) et l'arrêter (`sudo systemctl stop apache2`). |
| Échec Certbot sur `www` | Aucun enregistrement DNS `A` ou `CNAME` pour `www.mondomaine.fr`. | Relancer sur le domaine racine seul : `sudo certbot --nginx --cert-name mondomaine.fr -d mondomaine.fr`. |

</details>

<details>
<summary>☁️ Derrière Cloudflare ou un proxy amont (module realip nginx)</summary>

Avec un proxy devant nginx, `TRUST_PROXY=1` seul ferait voir à l'application l'IP du proxy (partage des quotas d'inscription et de connexion). Ajoutez dans le bloc `server { ... }` :

```nginx
# Plages officielles Cloudflare (https://www.cloudflare.com/ips/)
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

real_ip_header CF-Connecting-IP;
```

Pour un autre proxy, remplacez les plages par ses IP et utilisez `real_ip_header X-Forwarded-For;` avec `real_ip_recursive on;`. Conservez `TRUST_PROXY=1`.

</details>

<details>
<summary>💾 Restauration et procédure de mise à jour</summary>

```bash
# Lister ou préparer la restauration d'une sauvegarde (puis redémarrer)
npm run restore
npm run restore -- latest
pm2 restart Brindiwanko
```

```bash
# Mise à jour sécurisée
npm run restore           # Vérifier la présence d'une sauvegarde récente
git pull
npm ci && npm run build
pm2 restart Brindiwanko
```

> Les migrations SQLite s'appliquent automatiquement au démarrage. La base remplacée reste conservée avec le suffixe `.before-restore`, et les sauvegardes appliquées sont purgées de toute session ou secret.

</details>

---

<a id="fr-changelog"></a>

## 📜 Journal des modifications (Derniers correctifs)

Historique détaillé dans [CHANGELOG.md](CHANGELOG.md). Principaux apports depuis `1.0.0-beta.1` :

- 🔒 **Sécurité & restauration à chaud :** vérification du mot de passe et du verrou `restoring` avant le buffering sur `POST /api/admin/restore`, `prepareRestore` asynchrone (Worker + `fs.promises.cp`), contrôle anti-chevauchement ZIP, durcissement SVG/sandbox/Socket.io (`Sec-Fetch-Site`) et libération des verrous d'édition au changement de mot de passe.
- ⚡ **Performance, fiabilité & cycle de vie :** migration `002_indexes.sql` (6 index secondaires), cache `SettingsRepository`, requêtes unifiées sur l'annuaire des guildes, parsing JSON défensif, suppression atomique de compte par transaction SQLite, contrôle multi-onglets (`characterId`), nettoyage `AbortController`/`destroy()` côté client et validation `i18n:check` étendue.
- 🗺️ **Combat & IA des régions :** confinement des monstres dans leur région en `idle` et fuite sur zone peinte, détection d'aggro à 1 case des bordures et retour maison au-delà de 2 cases hors zone *(boss à 1 case non bridés)*.
- 🎮 **Ergonomie joueur & éditeur :** focus clavier rendu au clic carte, buffer d'action de `150 ms`, masquage des barres/chat pendant les dialogues actifs, bascule tactile dynamique sans `F5`, mémoire par onglet de la palette et boutons `+ Ajouter` ancrés.

---

<div align="center">

📄 Sous licence **[Apache 2.0](LICENSE)** &nbsp;·&nbsp; [⬆️ Haut de page (FR)](#fr-top) &nbsp;·&nbsp; [🇬🇧 English README](#en-top)

</div>

---

<br />

<a id="en-top"></a>
<a id="english"></a>

<div align="center">

  <img src="assets/img/system/AppIcon-512.png" alt="Brindiwanko Logo" width="128" />

  # 🌿 Brindiwanko (English)

  **A browser-based 2D MMORPG engine with a built-in live world editor**

  [![Version](https://img.shields.io/badge/version-1.0.0--beta.1-2563eb?style=for-the-badge)](package.json)
  [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.0.0-16a34a?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-7.x-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Socket.io](https://img.shields.io/badge/Socket.io-4.x-0f172a?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)
  [![SQLite](https://img.shields.io/badge/SQLite-WAL%20%2B%20better--sqlite3-0369a1?style=for-the-badge&logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
  [![Tests](https://img.shields.io/badge/tests-330%20passed-15803d?style=for-the-badge&logo=node.js&logoColor=white)](tests/)
  [![License](https://img.shields.io/badge/License-Apache_2.0-475569?style=for-the-badge)](LICENSE)

  <br />

  [🇫🇷 Lire en Français](#fr-top) &nbsp;·&nbsp; **🇬🇧 English**

  <br />

  [✨ Highlights](#en-highlights) •
  [🚀 Quick Start](#en-quick-start) •
  [🕹️ Playing](#en-playing) •
  [🗺️ Editor](#en-editor) •
  [🛡️ Administration](#en-administration) •
  [⚙️ Configuration](#en-configuration) •
  [🌐 Deployment](#en-deployment) •
  [📜 Changelog](#en-changelog)

</div>

---

> 🎮 **A living world in your browser:** design your maps, script your quests, place monsters… and players see changes go **live**, with zero page reloads.

**Brindiwanko** packs everything needed to run a persistent online RPG inside **a single Node.js process** backed by **a single SQLite database**: tilemaps, scripted cutscenes, multi-step quests, real-time combat, parties, guilds, instanced dungeons, and raids — with no external database server to maintain.

> [!NOTE]
> **An AI-Engineered & Human-Validated Project**  
> All source code (server, client, editor, SVG generators, and test suites) was authored by AI under human creative and technical direction, and validated by **330 automated tests** (`npm test`), a multi-client stress tester, and browser verification sessions. Review and stage-test before production rollouts; bug reports and PRs are always welcome.

---

<a id="en-highlights"></a>

## ✨ Highlights

| Area | Capabilities |
| :--- | :--- |
| 🗺️ **Live World Editor** | Palettes A–E with per-tab selection memory, auto-layers, autotiles, dynamic shadows, region IDs, manual passability overrides, toroidal wrap-around maps, version snapshots, *"Test Map"* quick preview. |
| 🧩 **Events & Cutscenes** | Conditional pages, flexible triggers (action, touch, autorun, parallel), visual command builder, fades, tints, flashes, camera shakes, pictures, weather, scrolling, timers. |
| ⚔️ **Real-Time Combat** | Action battles directly on the map, custom skills & states, elemental affinities, critical strikes, region-confined monster AI, and configurable drop tables. |
| 📜 **Quests & Progression** | Sequential steps, talk/kill/collect/reach/switch objectives, `!` and `?` map markers, rewards, chapters, and player quest journal. |
| 🎒 **Character & Economy** | Allocatable stats, grid inventory, equipment slots, shops, resting inns, bank storage, automatic lock-down on knock-out or map change. |
| 💬 **Social & Guilds** | All/Map/Party/Guild/Whisper/System chat channels, friends and ignore lists, secure player trades, emotes, guild ranks/permissions, bank vault, log, and generated crests. |
| 🏰 **Dungeons & Raids** | Dynamic party instances, multi-phase raid bosses, party entrance readiness check, weekly lockouts, and dice-roll loot distribution. |
| 👑 **Administration** | Live dashboard (CPU, event loop lag, instances), staff commands (`/kick`, `/mute`, `/ban`), GM tools, audit logs, scheduled backups, and schema-checked restores. |
| 🎨 **100% Generated Art** | Tilesets, characters, facesets, monsters, bosses, icons, and window skins compiled as vector pixel art from `assets/generators/` (`npm run assets:build`) with zero external asset packs. |
| 📱 **Mobile & Bilingual** | Virtual joystick, `A`/`B` touch controls, skill arc layout, live `(hover: none)` desktop/touch switching, fullscreen PWA, and native **English / French** localization. |

### 🏗️ Architecture Overview

```mermaid
flowchart LR
  Browser["🌐 Browser / PWA<br/>Canvas 2D + Live Editor"] <-- "HTTP + Socket.io 4" --> Server["⚙️ Node.js + Express 5 Server<br/>20 Hz Tick · Auth · Admin"]
  Server --> SQLite[("🗄️ SQLite WAL<br/>data/game.db")]
  Server -. "Isolated scripts (--permission)" .-> Sandbox["🧪 VM Sandbox"]
  Server -. "Async quick_check" .-> Worker["🧵 Worker Thread"]
```

<details>
<summary>📁 Repository layout</summary>

```text
Brindiwanko/
├── server/       # Node.js backend (Express 5, Socket.io, world loop, SQLite repositories, migrations)
├── client/       # Web client TypeScript (Canvas 2D engine, RPG windows, embedded world editor)
├── shared/       # Shared contracts (typed Socket.io protocol, schemas, formulas, i18n)
├── assets/       # Procedural SVG pixel-art generators and compiled asset targets
├── views/        # EJS templates for account, auth, character, and admin pages
├── locales/      # Bilingual dictionaries en.json and fr.json (2,364 keys)
├── scripts/      # Build pipeline, dev watcher, load tester, demo export, CI checks
└── tests/        # Automated suite of 330 tests (node --test)
```

</details>

---

<a id="en-quick-start"></a>

## 🚀 Quick Start

### Prerequisites
- **Node.js 26 LTS** recommended *(minimum: **Node.js 24**)*
- **npm**

```bash
# 1. Install dependencies
npm install

# 2. Generate visual assets and compile server + client
npm run build

# 3. Start the server
npm start
```

> [!NOTE]
> The repository's `.npmrc` disables unnecessary third-party install scripts: `better-sqlite3` and `bcrypt` ship prebuilt binaries (Windows, Linux, macOS), so no C++ compiler toolchain is required.

Open **<http://localhost:3000>** in your browser. First startup initializes `data/game.db`, applies schema migrations, and populates the starter demo world.

- **Development mode:** run `npm run dev` for automatic server restarts and client rebundling on file changes.

### 👑 First Administrator Account

The **very first account** registered becomes **administrator** automatically. Subsequent registrations start as regular players; staff promotions/demotions from `/admin` take effect immediately, even for players currently in game.

> [!IMPORTANT]
> **Production safeguard (`NODE_ENV=production`):** while the database has zero accounts, registering the first user requires a **Setup Code** (`SETUP_CODE`) supplied via the environment variable or printed once to the startup log.

---

<a id="en-playing"></a>

## 🕹️ Playing the Game

<details open>
<summary>🎮 Keyboard, touch, and UI shortcuts</summary>

| Action | Keyboard / Mouse | Touch / Mobile |
| :--- | :--- | :--- |
| **Move** | <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd>, <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>, <kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd>, or Left Click | Virtual Joystick |
| **Interact / Front Attack** | <kbd>Space</kbd> or <kbd>Enter</kbd> | Button <kbd>A</kbd> |
| **Attack** | <kbd>F</kbd> | Attack Button |
| **Hotbar (1–8)** | <kbd>1</kbd> through <kbd>8</kbd> | Skill Arc Buttons |
| **Main Menu / Cancel** | <kbd>Escape</kbd> | Button <kbd>B</kbd> / Menu |

| Window | Key | Window | Key |
| :--- | :---: | :--- | :---: |
| 🎒 **Bag (Inventory)** | <kbd>I</kbd> | 📜 **Quest Journal** | <kbd>J</kbd> |
| 👤 **Character Sheet** | <kbd>C</kbd> | 👥 **Friends & Ignore** | <kbd>L</kbd> |
| 🔮 **Skills & Spells** | <kbd>K</kbd> | 🛡️ **Guild** | <kbd>G</kbd> |
| ⚔️ **Party** | <kbd>P</kbd> | 🗺️ **World Map** | <kbd>M</kbd> |
| ⚙️ **Settings** | <kbd>O</kbd> | 💬 **Focus Chat** | <kbd>Enter</kbd> |

</details>

- **Getting started:** one active character per account at a time; update passwords, email, or permanently delete your account under **My Account**; reset lost passwords via **Forgotten Password?** *(1-hour token, requires `SMTP_URL`)*.
- **Targeting & Social:** drag skills or items onto slots 1–8; click players or chat names to whisper, trade, invite, inspect, ignore, or report *(10s invite cooldown, 1 min after refusal)*.
- **XP, Loot & Raids:** XP and gold scale with damage contribution *(+10% party bonus per nearby member)*; item drops go to the highest-damage player or party; raid bosses stay invulnerable until every party member enters the arena.
- **Economic protection:** shops, inns, and banks automatically close if knocked out or transferred off the map.

---

<a id="en-editor"></a>

## 🗺️ World Editor Guide

Administrators can launch the live editor straight from the game menu via **Administration** 👑 ➔ **"Open the map editor"**. Saved changes propagate **immediately** to connected players.

| Toolset | Main Capabilities |
| :--- | :--- |
| **Maps & Passability** | Map hierarchy tree, auto-layers, autotiles, shadows, regions, toroidal loops, multi-admin edit locks, and manual cell passability overrides. |
| **Properties & Spawns** | Display name, size, tileset, PvP flag, instancing toggle, BGM/BGS audio, monster spawn zones and counts. |
| **Events & Database** | Quick NPC/chest/teleporter helpers, multi-page conditions, classes, skills, items, enemies, quests, raids, lossless JSON import/export. |

- ▶️ **"Test Map":** saves your edits, hides the editor, and warps your character directly onto the clicked tile.
- 🖼️ **Resources & Imports:** validates formats and pixel bounds, protects existing uploads from partial transfers, and **quarantines** all imported script logic until manually approved in *"Scripts to review"*.
- 🗑️ **Safe deletions:** warns with a full usage list before removing referenced maps or records; deleted entity IDs are never reused.
- 🪜 **Special tiles & Switches:** **ladder** tiles lock character facing upward; **damage floors** deal 10 HP per step without knocking out; **instance switches** (System tab) scope dungeon puzzle state per run.

---

<a id="en-administration"></a>

## 🛡️ Administration & Moderation

### 📊 Panel (`/admin`)
- **Live dashboard:** periodic CPU usage sampling, event loop lag monitor, active players, maps, and instances.
- **Account tools & GM panel:** roles, warnings, mutes, bans, password resets *(moderators see masked emails with no IP visibility; the server owner cannot be demoted)*, teleportation, staff invisibility, item/gold grants, global progress flags, and announcements.
- **Audit logs & Backups:** connection, trade, sale, rare drop, and report history; downloads stripped of sessions and secrets; schema-validated restores requiring admin password confirmation for both server backups and uploaded archives.

### 💬 Staff Chat Commands

| Command | Min Role | Effect |
| :--- | :---: | :--- |
| `/kick <player> [reason]` | Moderator | Disconnects the player immediately. |
| `/mute <player> [duration] [reason]` | Moderator | Silences chat (`30m`, `2h`, `7d`). |
| `/unmute <player>` | Moderator | Lifts an active mute. |
| `/ban <player> [duration\|perm] [reason]` | Administrator | Suspends an account temporarily or permanently. |
| `/unban <player>` | Administrator | Revokes an active ban. |
| `/all <message>` | Moderator | Broadcasts on the global staff channel. |
| `/pkick <player>` | Player (Leader) | Removes a member from your party. |

> [!TIP]
> **Retention & Privacy:** nightly automated backups run at the configured hour (default 4:00 AM) with 1 / 7 / 14 / 31-day rotation, logs older than 90 days are pruned daily, and deleting an account permanently wipes its IP history.

---

## 🌳 Demonstration World

Every clean install includes a starter adventure: **Village of Brindiwanko**, **Bruyère Forest**, **House Interiors**, **Bruyère Cavern** *(instanced dungeon featuring the Goblin King raid)*, and **Chapter 1** storyline quests.

```bash
# Export the demo world into JSON files under demo/
npm run demo:export
```

> **Resetting the world:** stop the server, delete `data/game.db*` (including `-wal` and `-shm`), and restart. In unattended environments (pm2, Docker), set `CONTENT_LANGUAGE=en` or `fr`.

---

<a id="en-configuration"></a>

## ⚙️ Configuration

All environment variables are optional:

| Variable | Default | Purpose |
| :--- | :---: | :--- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listener port and interface (`127.0.0.1` advised behind nginx). |
| `DB_PATH` | `data/game.db` | SQLite database path (absolute or project-relative; backups sit alongside). |
| `DATA_DIR` / `UPLOADS_DIR` | `data/` / `uploads/` | Default data folder and uploaded resource directory. |
| `NODE_ENV` | — | `production` enables `Secure` cookies, HSTS headers, and static asset caching. |
| `SESSION_SECRET` | auto-generated | Secret key used to sign session cookies. |
| `TRUST_PROXY` | `false` | Accepts `1` or `true` behind a reverse proxy (`0`/`false` to disable; invalid values fail startup). |
| `PUBLIC_URL` | — | Canonical public origin (e.g. `https://mydomain.com`), required to block CSWSH attacks. |
| `SETUP_CODE` | random token | Setup code required for first admin registration in production (set explicitly when logs are centralized). |
| `CONTENT_LANGUAGE` | terminal prompt | `en` or `fr` to seed the starter world non-interactively. |
| `REGISTRATIONS_PER_HOUR` | `10` *(prod)* | Account registration rate limit per IP per hour (`0` = unlimited). |
| `IMPORTS_PER_15_MIN` | `3` *(prod)* | Project import limit (up to 200 MB each) per account per 15 min (`0` = unlimited). |
| `MAX_CHARACTERS` | `4` | Maximum characters per account. |
| `SMTP_URL` / `MAIL_FROM` | — | Outbound SMTP URI and sender address for password reset emails. |

---

## 🧪 Testing & Quality Assurance

```bash
# Runs naming lint, i18n parity/placeholder/EJS checks, and all 330 tests
npm test

# Strict TypeScript checks across server, client, and build tools
npm run typecheck

# Network stress test: 80 concurrent simulated clients over 15 seconds
npm run load-test -- 80 15
```

> [!NOTE]
> All automated tests run against isolated temporary storage: live `data/` and `uploads/` folders are never modified.

---

<a id="en-deployment"></a>

## 🌐 Production Deployment (Ubuntu / Debian VPS)

| Target domain | Internal server | Reverse proxy | SSL authority |
| :--- | :--- | :--- | :--- |
| `mydomain.com` (and `www`) | Node.js on `127.0.0.1:3000` | Nginx (ports `80` and `443`) | Let's Encrypt (`Certbot`) |

In production, Node.js does not handle TLS certificates directly: **Nginx** accepts encrypted connections on port `443`, terminates HTTPS, and proxies traffic locally to `http://127.0.0.1:3000`.

### Step 1 — Point your domain to the VPS IP & open the firewall

> [!IMPORTANT]
> **Required DNS setup:** at your domain registrar / DNS provider, create an **`A` record** pointing `mydomain.com` (and an `A` or `CNAME` record for `www.mydomain.com` if used) to the **public IPv4 address of the VPS** where Brindiwanko will run. Wait for DNS propagation before requesting an SSL certificate.

```bash
# 1. Verify that your domain resolves to your VPS public IPv4
dig +short mydomain.com

# 2. If UFW firewall is enabled, allow HTTP (80) and HTTPS (443)
sudo ufw allow 'Nginx Full'
sudo ufw status
```

> Verification: `dig` prints your VPS IPv4 address and `Nginx Full` shows status `ALLOW`.

### Step 2 — Install and configure Nginx

1. Install Nginx and create the site configuration file *(omit `www.mydomain.com` if only the root domain is configured in DNS)*:

```bash
sudo apt update && sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/mydomain.com
```

2. Paste the following configuration:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name mydomain.com www.mydomain.com;

    client_max_body_size 500m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

3. Enable the site via symlink, validate syntax, and reload Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/mydomain.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

> Verification: `sudo nginx -t` outputs `syntax is ok` and `test is successful`.

### Step 3 — Enable HTTPS with Certbot (Let's Encrypt)

Certbot issues a free Let's Encrypt certificate, automatically configures port `443` in your Nginx file, and enables HTTP-to-HTTPS redirection *(drop `-d www.mydomain.com` if you only use the root domain)*:

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx --cert-name mydomain.com -d mydomain.com -d www.mydomain.com

# Test automatic renewal (90-day certificates)
sudo certbot renew --dry-run
```

> Verification: enter an alert email, accept the terms, confirm HTTPS redirection, and check that `https://mydomain.com` loads with a valid lock icon.

### Step 4 — Launch and lock down Brindiwanko (`127.0.0.1:3000`)

Brindiwanko binds strictly to localhost via `HOST=127.0.0.1` and enables reverse-proxy header trust via `TRUST_PROXY=1` *(no source code edits needed)*.

```bash
# Global pm2 setup and clean build
npm install -g pm2
npm ci && npm run build

# Start single-process server behind Nginx
NODE_ENV=production HOST=127.0.0.1 TRUST_PROXY=1 PUBLIC_URL=https://mydomain.com PORT=3000 pm2 start dist/server/index.js --name Brindiwanko
pm2 startup && pm2 save
```

> [!IMPORTANT]
> **Operational checklist:** bind locally (`127.0.0.1`) behind HTTPS with `PUBLIC_URL` configured (blocks direct unencrypted `http://VPS_IP:3000` access and prevents CSWSH attacks), run under an unprivileged OS user, and **never** enable PM2 cluster mode (`-i`) because world simulation and combat require a single process.

<details>
<summary>🩺 Quick troubleshooting guide</summary>

| Symptom | Likely cause | Fix / command |
| :--- | :--- | :--- |
| `502 Bad Gateway` | Node.js process is stopped or not listening on port `3000`. | Check local listener (`ss -tulpn \| grep 3000`) and restart with `pm2 restart Brindiwanko`. |
| `nginx -t` reports `No such file` | Broken symlink inside `/etc/nginx/sites-enabled/`. | Remove stale link (`sudo rm /etc/nginx/sites-enabled/<name>`) and recreate symlink to `mydomain.com`. |
| `bind() to 0.0.0.0:80 failed` | Another web server (e.g., Apache2) already holds port `80`. | Identify it (`sudo ss -tulpn \| grep :80`) and stop it (`sudo systemctl stop apache2`). |
| Certbot fails on `www` | No `A` or `CNAME` DNS record exists for `www.mydomain.com`. | Re-run for root domain only: `sudo certbot --nginx --cert-name mydomain.com -d mydomain.com`. |

</details>

<details>
<summary>☁️ Behind Cloudflare or an upstream proxy (nginx realip module)</summary>

When another proxy sits in front of nginx, `TRUST_PROXY=1` alone makes the app see the proxy's address instead of the player's (sharing registration and login rate limits). Add inside the `server { ... }` block:

```nginx
# Cloudflare IP ranges (https://www.cloudflare.com/ips/)
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

real_ip_header CF-Connecting-IP;
```

For another upstream proxy, replace the ranges with its IPs and use `real_ip_header X-Forwarded-For;` with `real_ip_recursive on;`. Keep `TRUST_PROXY=1`.

</details>

<details>
<summary>💾 Restoring backups & updating</summary>

```bash
# List backups or prepare a restore (then restart)
npm run restore
npm run restore -- latest
pm2 restart Brindiwanko
```

```bash
# Safe update workflow
npm run restore           # Verify a recent backup exists
git pull
npm ci && npm run build
pm2 restart Brindiwanko
```

> Database migrations apply automatically on startup. Replaced databases are preserved as `.before-restore`, and applied snapshots have all sessions and secrets stripped.

</details>

---

<a id="en-changelog"></a>

## 📜 Changelog (Latest Fixes)

See [CHANGELOG.md](CHANGELOG.md) for complete release notes. Key updates since `1.0.0-beta.1`:

- 🔒 **Security & non-blocking restore:** `POST /api/admin/restore` verifies admin password and `restoring` lock before body buffering; `prepareRestore` runs asynchronously via Worker + `fs.promises.cp`; hardening covers ZIP overlaps, SVG bounds/CSS escapes, script ID bounds, `Sec-Fetch-Site` handshakes, and edit-lock release on password resets.
- ⚡ **Performance, reliability & lifecycle:** added migration `002_indexes.sql` (6 secondary indexes), transaction-safe `SettingsRepository` cache, unified guild directory SQL queries, defensive JSON parsing, transactional account deletion, multi-tab reconnect `characterId` checks, `AbortController`/`destroy()` cleanup, and extended `i18n:check` checks for placeholders and `.ejs` views.
- 🗺️ **Monster region confinement:** monsters remain within their spawn region while idle and fleeing on multi-cell zones, spot players within 1 cell of painted region borders, and leash home beyond 2 cells outside *(single-tile boss markers stay unrestricted)*.
- 🎮 **Player & editor ergonomics:** clicking the canvas restores keyboard focus, a `150 ms` input buffer captures step-end interactions, bottom bars/chat hide during active dialogues, `touch-mode` updates live without reloads, tile palettes keep per-tab selection/scroll, and database `+ Add` buttons stay anchored.

---

<div align="center">

📄 Released under the **[Apache 2.0 License](LICENSE)** &nbsp;·&nbsp; [⬆️ Back to Top (EN)](#en-top) &nbsp;·&nbsp; [🇫🇷 Version Française](#fr-top)

</div>
