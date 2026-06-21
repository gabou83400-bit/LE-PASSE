# Le Passe — v1.1
Application de gestion pour bar & restaurant indépendant. Tactile, claire, installable sur téléphone.

## 10 modules
Tableau de bord · Marges (cocktails) · Stocks · Commandes · Cuisine (plats) · Hygiène · Traçabilité · Équipe · Assistant IA · Réglages

## Ce que ça fait (sans clé API — gratuit)
- Marges cocktails ET plats : coût matière, marge %, prix conseillé
- Stocks : seuils, stock max, valeur de cave, inventaire & calcul du coulage
- Commandes : quantités auto (max − stock), groupées par fournisseur, bon à copier
- Hygiène : relevés de température, COURBE D'ÉVOLUTION par frigo, plan de nettoyage, parc machines, rapport de conformité DDPP
- Traçabilité : réceptions, lots, DLC avec alertes
- Cuisine : plats et marges, garde-manger
- Cases « fait / à faire » réinitialisées chaque jour, checklists ouverture/fermeture
- Sauvegarde locale + copie quotidienne + export/restauration

## Ce qui nécessite la clé API (optionnel, ~5€ de crédit)
- Scan photo/PDF : factures → stock, bons de livraison → traçabilité, carte → cuisine
- Assistant IA à missions (ouverture, commandes, marges, promos, résumé)

## Déploiement (GitHub + Vercel)
1. Dépose le CONTENU de ce dossier dans un dépôt GitHub.
2. vercel.com (connexion GitHub) → Add New Project → importe le dépôt → Deploy.
3. (IA) Settings → Environment Variables → ANTHROPIC_API_KEY = ta clé (console.anthropic.com) → Redeploy.

## Installer sur téléphone
- iPhone (Safari) : Partager → Sur l'écran d'accueil
- Android (Chrome) : menu ⋮ → Installer l'application

## Important — données par appareil
Chaque appareil garde ses propres données. Pour l'hygiène/traçabilité (preuves de contrôle), utilise UN SEUL appareil dédié qui reste à l'établissement, pour un historique complet. Le partage multi-postes nécessite une évolution (base de données) — c'est le chantier de la prochaine version.
