# guide-automatisation-instagram
# Automatiser un compte Instagram avec de l'IA (gratuit, sans carte bancaire)

Ce dépôt explique comment automatiser la publication de contenu et la gestion des commentaires sur un compte Instagram professionnel, en n'utilisant que des services avec un vrai plan gratuit (pas d'essai limité dans le temps, pas de carte bancaire requise).

## Ce que fait le système

1. **Planification** (`scripts/planifier.js`) — génère chaque semaine une liste de sujets de contenu via une IA, et les ajoute à un calendrier.
2. **Publication** (`scripts/publish.js`) — chaque jour, génère une légende + une image via IA pour le sujet du jour, publie sur Instagram, et poste un premier commentaire (hashtags + question d'engagement) pour maximiser la portée.
3. **Réponse aux commentaires** (`scripts/repondre-commentaires.js`) — toutes les heures, lit les nouveaux commentaires, les classe (normal / sensible), répond automatiquement aux commentaires normaux, et déclenche une alerte humaine pour les commentaires sensibles plutôt que de tout automatiser.
4. **Rafraîchissement de token** (`.github/workflows/refresh-token.yml`) — les tokens Instagram expirent au bout de 60 jours ; ce workflow les renouvelle automatiquement deux fois par mois.

Tout tourne sur **GitHub Actions** (gratuit pour les dépôts publics et dans la limite du plan gratuit pour les dépôts privés), sans serveur à louer.

## Stack utilisée

| Besoin | Service | Pourquoi |
|---|---|---|
| Génération de texte (légendes, sujets) | Cloudflare Workers AI (Llama 3.3) | Plan gratuit généreux, sans CB |
| Génération d'image | Cloudflare Workers AI (Stable Diffusion XL) | Même compte, même gratuité |
| Hébergement des images | imgbb | Gratuit, API simple, lien direct utilisable par l'API Instagram |
| Orchestration / planification | GitHub Actions | Gratuit, cron intégré, gère les secrets en toute sécurité |

Des alternatives comme Mistral AI (plan gratuit trop instable en usage automatisé) ou Cerebras (tier gratuit sans CB supprimé) ont été testées et écartées — vérifie l'état actuel de ces offres si tu veux les essayer.

## Prérequis

- Un compte Instagram **professionnel** (Creator ou Business), sans besoin de Page Facebook associée si tu passes par "API setup with Instagram login".
- Un compte [Meta for Developers](https://developers.facebook.com/).
- Un compte Cloudflare (avec Workers AI activé).
- Un compte imgbb (clé API gratuite).
- Un compte GitHub.

## Mise en place, étape par étape

1. **Créer l'app Meta** : sur developers.facebook.com, crée une app, choisis "API setup with Instagram login" pour éviter d'avoir besoin d'une Page Facebook. Ajoute ton compte Instagram comme testeur/rôle sur l'app, et génère un token d'accès longue durée.
2. **Créer le dépôt GitHub** : crée un dépôt (privé de préférence, pour ton usage réel), avec la structure de fichiers ci-dessous.
3. **Configurer les secrets** : dans Settings → Secrets and variables → Actions, ajoute `IG_ACCESS_TOKEN`, `IG_USER_ID`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `IMGBB_API_KEY`. Pour le rafraîchissement automatique du token, ajoute aussi un `GH_PAT` (Personal Access Token avec le droit de modifier les secrets du dépôt).
4. **Adapter le thème** : dans `scripts/planifier.js`, modifie la constante `THEME` en haut du fichier pour ton propre sujet.
5. **Personnaliser la modération** : si tu actives la réponse automatique aux commentaires, adapte les mots-clés de `repondre-commentaires.js` à ton propre contexte — **ne publie jamais ta liste exacte de mots-clés sensibles dans un dépôt public**, ça permettrait de contourner la détection.
6. **Activer les workflows** : une fois les fichiers en place dans `.github/workflows/`, ils se déclenchent automatiquement selon leur planning (`cron`), ou manuellement via l'onglet Actions → "Run workflow".

## ⚠️ Limitation importante : App Review Meta

Par défaut (accès Standard), l'API Instagram ne permet de lire/répondre qu'aux commentaires provenant de comptes ayant un rôle sur ton app (toi-même, tes testeurs). **Pour lire les commentaires de vrais visiteurs inconnus, Meta exige un App Review** (validation manuelle de la permission `instagram_business_manage_comments`), qui nécessite lui-même une **vérification d'entreprise** (Business Verification) — même pour un projet individuel sans société. Prévois ce délai avant de compter sur la modération automatique en conditions réelles.

## Avertissement

Ce projet publie du contenu de façon autonome sans validation humaine avant publication — c'est un choix assumé pour ce cas d'usage, mais réfléchis à ce qui est approprié pour ton propre contexte, en particulier si ton compte touche des sujets sensibles (santé, finance, sujets réglementés). La gestion des commentaires sensibles (détresse, harcèlement) mérite une vraie réflexion sur les ressources d'aide à afficher et sur l'escalade humaine — ne laisse jamais ce type de situation entièrement automatisée sans supervision.
