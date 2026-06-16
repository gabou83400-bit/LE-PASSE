# Le Passe — v1.0
Application de gestion pour bar & restaurant indépendant.

## Modules
Tableau de bord · Marges (cocktails) · Stocks · Commandes · Cuisine (plats) · Hygiène · Traçabilité · Équipe · Assistant IA · Réglages

## Fonctions clés
- Calcul de marges (cocktails ET plats) avec prix conseillé
- Stocks : seuils, stock max, valeur de cave, inventaire & coulage
- Commandes : quantités auto (max − stock), groupées par fournisseur
- Scan photo : factures fournisseurs → stock ; bons de livraison → traçabilité ; carte des plats → cuisine
- Hygiène : relevés de température, plan de nettoyage, parc machines, rapport de conformité DDPP
- Cases « fait / à faire » réinitialisées chaque jour
- Assistant IA à missions (ouverture, commandes, marges, promos, résumé semaine)
- Sauvegarde locale + copie de secours quotidienne + export/restauration

## Déploiement (GitHub + Vercel)
1. Crée un dépôt GitHub `le-passe`, dépose le CONTENU de ce dossier.
2. Sur vercel.com (connexion GitHub) → Add New Project → importe `le-passe` → Deploy.
3. (Assistant IA) Settings → Environment Variables → `ANTHROPIC_API_KEY` = ta clé (console.anthropic.com) → Redeploy.

## Installer sur téléphone
- iPhone (Safari) : Partager → Sur l'écran d'accueil
- Android (Chrome) : menu ⋮ → Installer l'application

## Données
Stockées sur l'appareil. Réglages → Exporter régulièrement une sauvegarde.
Limite connue : données par appareil (pas de partage multi-postes en v1).
