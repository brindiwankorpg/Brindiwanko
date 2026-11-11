# 🔒 Politique de sécurité

**Français** · [🇬🇧 English](#-security-policy-english)

## Versions maintenues

| Version | Correctifs de sécurité |
| :--- | :---: |
| Dernière bêta 1.0.0 (`1.0.0-beta.x`), puis 1.0.x | ✅ |
| Bêtas plus anciennes et versions 0.x | ❌ |

Les correctifs de sécurité sont publiés dans la version suivante : une nouvelle bêta tant que la 1.0.0 n'est pas sortie, puis une version 1.0.x. Mettez votre serveur à jour pour les recevoir (voir la section « Mise à jour » du [README](README.md)).

## Signaler une faille

> [!IMPORTANT]
> **Ne publiez jamais une faille dans une issue, une pull request ou une discussion publique.** Tant qu'elle n'est pas corrigée, elle mettrait en danger tous les serveurs Brindiwanko en service et les données de leurs joueurs.

Signalez-la **en privé** grâce à la fonction de signalement de GitHub :

1. Ouvrez l'onglet **Security** du dépôt.
2. Cliquez sur **Report a vulnerability** (ou allez directement sur <https://github.com/brindiwankorpg/Brindiwanko/security/advisories/new>).
3. Remplissez le formulaire : seuls vous et les mainteneurs du projet le verrez.

Pour que la faille puisse être reproduite et corrigée rapidement, indiquez si possible :

- la version de Brindiwanko concernée (ou le commit) ;
- la partie touchée (authentification, panneau d'administration, éditeur, socket du jeu, sauvegardes…) ;
- les étapes pour la reproduire, avec une preuve de concept si vous en avez une ;
- l'impact estimé (qui peut l'exploiter, et ce qu'il obtient).

## Ce qui se passe ensuite

1. Votre signalement est accusé et étudié en privé.
2. Un correctif est préparé, testé, puis publié dans une nouvelle version (bêta ou 1.0.x).
3. Un avis de sécurité GitHub est publié en même temps que le correctif, en vous créditant si vous le souhaitez.

Merci de laisser le temps de publier le correctif avant de rendre la faille publique. 🙏

---

<br />

# 🔒 Security Policy (English)

[🇫🇷 Lire en Français](#-politique-de-sécurité) · **English**

## Supported Versions

| Version | Security fixes |
| :--- | :---: |
| Latest 1.0.0 beta (`1.0.0-beta.x`), then 1.0.x | ✅ |
| Older betas and 0.x versions | ❌ |

Security fixes are released in the next version: a new beta until 1.0.0 is out, then a 1.0.x version. Update your server to get them (see the "Updating" section of the [README](README.md)).

## Reporting a Vulnerability

> [!IMPORTANT]
> **Never disclose a vulnerability in a public issue, pull request or discussion.** Until it is fixed, it would put every running Brindiwanko server and its players' data at risk.

Report it **privately** with GitHub's reporting feature:

1. Open the repository's **Security** tab.
2. Click **Report a vulnerability** (or go straight to <https://github.com/brindiwankorpg/Brindiwanko/security/advisories/new>).
3. Fill in the form: only you and the project maintainers will see it.

So that the vulnerability can be reproduced and fixed quickly, please include where possible:

- the affected Brindiwanko version (or commit);
- the affected area (authentication, administration panel, editor, game socket, backups…);
- the steps to reproduce it, with a proof of concept if you have one;
- the estimated impact (who can exploit it, and what they gain).

## What Happens Next

1. Your report is acknowledged and investigated privately.
2. A fix is prepared, tested, then released in a new version (beta or 1.0.x).
3. A GitHub security advisory is published together with the fix, crediting you if you wish.

Please allow time for the fix to be released before making the vulnerability public. 🙏
