# BCBE / BEKB → Actual Budget Importer

Importe en masse des relevés bancaires **CAMT.053** exportés depuis la **Banque Cantonale Bernoise (BCBE / BEKB)** vers une instance self-hosted d’**Actual Budget**.

L’objectif est simple : la BCBE peut fournir de nombreux fichiers CAMT.053 (souvent un par jour), alors que l’interface d’Actual Budget importe normalement un fichier à la fois. Ce script lit tout un dossier, transforme les écritures comptabilisées en transactions Actual Budget et utilise les identifiants bancaires pour limiter les doublons.

## Fonctionnalités

- Lecture de tous les fichiers `.xml` d’un dossier `camt/`
- Support du format CAMT.053 produit par la BCBE / BEKB
- Import des écritures `BOOK` uniquement
- Extraction de la date de comptabilisation, du montant, du sens débit/crédit, du bénéficiaire/débiteur, des notes et de l’identifiant bancaire
- Déduplication grâce à `AcctSvcrTxId` / `AcctSvcrRef`
- Mode **dry-run par défaut**
- Import réel uniquement avec `--commit`
- Aucun mot de passe ni relevé bancaire stocké dans Git

## Prérequis

- Node.js 20+ recommandé
- Une instance Actual Budget accessible depuis la machine qui exécute le script
- Un budget Actual Budget existant
- Un compte Actual Budget correspondant au compte BCBE / BEKB
- Des fichiers CAMT.053 exportés depuis l’e-banking BCBE / BEKB

## Installation

```bash
git clone https://github.com/PaCoaltt/BCBE-BEKB_Actual-Budget_Importer.git
cd BCBE-BEKB_Actual-Budget_Importer
npm install
cp .env.example .env
```

Édite ensuite `.env` :

```env
ACTUAL_SERVER_URL=http://127.0.0.1:5006
ACTUAL_PASSWORD=change-me
ACTUAL_SYNC_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ACTUAL_ACCOUNT_NAME=BCBE
CAMT_DIR=./camt
CACHE_DIR=./cache
```

> Ne publie jamais ton fichier `.env`. Il est ignoré par Git.

## Où trouver le Sync ID Actual Budget ?

Dans Actual Budget, ouvre les paramètres du budget puis cherche **Sync ID** dans les paramètres avancés.

## Ajouter les relevés CAMT.053

Place simplement les fichiers `.xml` dans :

```text
camt/
```

Par exemple :

```text
camt/
├── camt.053_..._2026-07-31.xml
├── camt.053_..._2026-08-01.xml
└── camt.053_..._2026-08-02.xml
```

Les relevés bancaires sont explicitement ignorés par `.gitignore`.

## Dry-run

Le script ne modifie rien par défaut :

```bash
npm run dry-run
```

ou :

```bash
node import-bcbe.mjs
```

Vérifie le nombre de fichiers, le nombre de transactions détectées et l’aperçu avant de continuer.

## Import réel

Quand le dry-run est correct :

```bash
npm run import
```

ou :

```bash
node import-bcbe.mjs --commit
```

## Déduplication

Le script utilise en priorité l’identifiant bancaire de la transaction :

```xml
<AcctSvcrTxId>...</AcctSvcrTxId>
```

et l’envoie à Actual Budget sous la forme :

```text
BCBE-<identifiant>
```

Cela permet à Actual Budget de reconnaître les opérations déjà importées lors d’une exécution ultérieure.

## Sécurité

Le dépôt ne doit contenir **aucune donnée bancaire réelle**.

Sont ignorés par Git :

- `.env`
- `*.xml`
- le contenu de `camt/`
- `cache/`

Les fichiers CAMT.053 peuvent contenir notamment le nom du titulaire, l’IBAN, l’adresse et l’historique des transactions. Ne les publie jamais dans un dépôt public.

Le mot de passe Actual Budget reste local dans `.env` et n’est pas inclus dans le code.

## Limites

Ce script a été conçu et testé à partir de fichiers CAMT.053 produits par la BCBE / BEKB. D’autres banques suisses peuvent utiliser le même standard ISO 20022 mais structurer certains champs différemment.

Le script privilégie la **date de comptabilisation** (`BookgDt`) et importe uniquement les écritures comptabilisées (`BOOK`).

## Licence

MIT
