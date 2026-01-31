# 🎨 Meta Ads Generator

Générateur automatique de créatives Meta Ads avec Google AI.

## 📋 Prérequis

- Node.js 18+ installé
- Un compte Google
- Un compte Google Cloud (pour l'API Google Sheets)

## 🚀 Installation

### 1. Installer les dépendances

```bash
npm install
```

### 2. Configuration Google Sheets

#### Étape A : Créer un Google Sheet

1. Va sur https://sheets.google.com
2. Crée un nouveau Google Sheet
3. Nomme-le "Meta Ads Prompts" (ou autre)
4. Crée ces colonnes dans la première ligne :
   - Colonne A : **Prompt**
   - Colonne B : **Statut**
   - Colonne C : **URL Image**
   - Colonne D : **Date génération**

5. Ajoute tes prompts dans la colonne A (ligne 2, 3, 4, etc.)

Exemple :
```
| Prompt                                          | Statut | URL Image | Date génération |
|-------------------------------------------------|--------|-----------|-----------------|
| A beautiful sunset over the ocean               |        |           |                 |
| A modern tech office with happy employees       |        |           |                 |
| A delicious gourmet burger with fries           |        |           |                 |
```

6. Note l'ID de ton Sheet (dans l'URL) :
   `https://docs.google.com/spreadsheets/d/[TON_ID_ICI]/edit`

#### Étape B : Créer un Service Account Google Cloud

1. Va sur https://console.cloud.google.com
2. Crée un nouveau projet (ou sélectionne-en un)
3. Active l'API Google Sheets :
   - Menu → APIs & Services → Enable APIs and Services
   - Recherche "Google Sheets API"
   - Clique sur "Enable"

4. Crée un Service Account :
   - Menu → APIs & Services → Credentials
   - Clique sur "Create Credentials" → "Service Account"
   - Donne-lui un nom (ex: "meta-ads-bot")
   - Clique sur "Create and Continue"
   - Rôle : "Editor" (ou "Owner")
   - Clique sur "Done"

5. Crée une clé JSON :
   - Clique sur le service account que tu viens de créer
   - Onglet "Keys"
   - "Add Key" → "Create new key" → JSON
   - Télécharge le fichier JSON

6. Partage ton Google Sheet avec le service account :
   - Ouvre le fichier JSON téléchargé
   - Copie l'email qui ressemble à : `xxx@xxx.iam.gserviceaccount.com`
   - Retourne sur ton Google Sheet
   - Clique sur "Partager"
   - Colle l'email du service account
   - Donne les droits "Éditeur"
   - Envoie

#### Étape C : Récupérer l'API Key Google AI

1. Va sur https://aistudio.google.com/apikey
2. Clique sur "Create API Key"
3. Copie la clé (elle commence par `AIza...`)

### 3. Configuration du fichier .env.local

Ouvre le fichier `.env.local` et remplis les valeurs :

```bash
# API Key Google AI Studio
GOOGLE_API_KEY=AIza_ta_vraie_cle_ici

# ID de ton Google Sheet
GOOGLE_SHEET_ID=ton_sheet_id_ici

# Email du service account (depuis le JSON téléchargé)
GOOGLE_SERVICE_ACCOUNT_EMAIL=xxx@xxx.iam.gserviceaccount.com

# Private key (depuis le JSON, garde les guillemets et remplace les \n)
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQI...\n-----END PRIVATE KEY-----\n"
```

**Note pour GOOGLE_PRIVATE_KEY :**
- Ouvre le fichier JSON téléchargé
- Copie la valeur de `private_key`
- Garde les guillemets autour
- Les `\n` doivent rester tels quels dans le fichier .env.local

## 🎯 Utilisation

### Lancer en développement

```bash
npm run dev
```

Ouvre http://localhost:3000 dans ton navigateur.

### Fonctionnalités

- **🎯 Générer 1 image** : Génère une seule image pour le prochain prompt
- **🚀 Mode Auto** : Génère toutes les images automatiquement (une toutes les 3 secondes)
- **📊 Stats en temps réel** : Vois combien d'images ont été générées
- **📋 Logs** : Suis l'activité en temps réel

## ⚠️ Important

**Le code actuel utilise des images placeholder** car :
- Gemini 2.5 Flash ne génère pas encore d'images nativement
- Tu dois choisir un service de génération d'images :
  - **Imagen 3** (Google Vertex AI) - Payant mais officiel
  - **Fal.ai** - Simple et rapide
  - **Replicate** - Beaucoup de modèles
  - **Leonardo AI** - Interface sympa

### Pour utiliser un vrai service de génération :

Édite le fichier `app/api/generate/route.ts` et remplace la fonction `generateImage()` par l'API de ton choix.

## 🚀 Déploiement sur Vercel

```bash
# Installe Vercel CLI
npm i -g vercel

# Déploie
vercel

# Configure les variables d'environnement dans le dashboard Vercel
```

## 📝 Structure du projet

```
meta-ads-generator/
├── app/
│   ├── api/
│   │   ├── generate/
│   │   │   └── route.ts      # API de génération
│   │   └── stats/
│   │       └── route.ts      # API des statistiques
│   ├── globals.css           # Styles globaux
│   ├── layout.tsx            # Layout principal
│   └── page.tsx              # Page d'accueil (interface)
├── .env.local                # Variables d'environnement
├── package.json
└── README.md
```

## 🐛 Dépannage

### Erreur "GOOGLE_SHEET_ID non configurée"
→ Vérifie que tu as bien rempli le fichier `.env.local`

### Erreur "Erreur d'accès au Google Sheet"
→ Vérifie que tu as bien partagé le Google Sheet avec l'email du service account

### Erreur "private_key"
→ Assure-toi que la clé privée dans `.env.local` :
- Est entourée de guillemets doubles
- Contient bien `\n` (pas de vrais sauts de ligne)
- Commence par `-----BEGIN PRIVATE KEY-----\n`

### Les images ne se génèrent pas vraiment
→ Normal ! Le code utilise des placeholders. Tu dois configurer une vraie API de génération d'images.

## 📞 Support

Pour toute question, ouvre une issue sur GitHub ou contacte-moi.

## 📄 Licence

MIT
