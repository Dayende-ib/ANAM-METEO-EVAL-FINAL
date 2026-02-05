# Backend ANAM-METEO-EVAL

Ce dossier contient le pipeline de traitement, l'API FastAPI et les scripts utilitaires.

## Prerequis
- Python 3.10+.
- Poppler (conversion PDF) et Tesseract OCR disponibles dans le PATH.
- Compte Hugging Face avec acces au modele Gemma (si generation locale activee).

## Installation
```bash
python -m venv .venv
.\.venv\Scripts\activate    # Windows PowerShell
pip install --upgrade pip
pip install -r backend/requirements.txt
```
Copiez `env.example` en `.env` a la racine du depot puis adaptez les valeurs.

## Lancer un pipeline complet
```bash
python backend/pipeline_cli.py
```
Les resultats sont ecrits dans `backend/data/output/` et la base SQLite `backend/data/meteo.db`.

## Lancer l'API
```bash
uvicorn backend.api:app --host 0.0.0.0 --port 8000 --reload
```
Endpoints principaux :
- `GET /` : ping/version.
- `GET /bulletins` : liste des bulletins disponibles.
- `GET /bulletins/{date}` : donnees d'une date.
- `GET /metrics/{date}` : metriques MAE/RMSE/biais/accuracy/F1.
- `POST /scrape` : lancement du scraping.
- `POST /upload-bulletin` : upload PDF puis extraction.
- `POST /pipeline/run` : pipeline complet en tache de fond.
- `GET /pipeline/runs` : historique des executions.
- `GET /pipeline/runs/{run_id}` : details d'un run.

## Mode batch / cron
```bash
python backend/batch_process.py --max-bulletins 3 --skip-scrape
python backend/batch_process.py --demo
```
`batch_process.py` ajoute du logging dans `backend/logs/batch_process.log`.

## Description des Modules (`backend/modules/`)

### ⚙️ Orchestration et Flux
- **`pipeline_runner.py`** : Coordonne l'exécution séquentielle de toutes les étapes (Scraping → OCR → Évaluation → Interprétation).
- **`workflow_temperature_extractor.py`** : Gère le flux spécifique de l'extraction visuelle des températures sur les cartes.

### 📥 Acquisition et Extraction
- **`pdf_scrap.py`** : Collecte automatisée des bulletins PDF sur le site web de l'ANAM.
- **`pdf_extractor.py`** : Conversion PDF vers Image et extraction du texte brut via OCR.
- **`temperature_extractor.py`** : Extraction numérique ciblée des températures Tmin/Tmax par détection de zones (ROI).

### 🧠 Analyse et Intelligence
- **`icon_classifier.py`** : Classification des icônes météo via Computer Vision (local).
- **`language_interpreter.py`** : Traduction multilingue (Mooré, Dioula) via le modèle NLLB-200.
- **`local_bulletin_generator.py`** : Génération de la narration textuelle à partir des données structurées.

### 📊 Données et Évaluation
- **`data_validator.py`** : Vérification de la cohérence des données et détection d'anomalies.
- **`data_integrator.py`** : Intégration et fusion des données extraites dans la base SQLite.
- **`forecast_evaluator.py`** : Calcul des métriques de performance (MAE, RMSE, F1-Score) au niveau global et par station.

---

## Scripts utiles
- `backend/scripts/download_models.py` : telecharge Gemma local (et NLLB local en option).
- `backend/scripts/sync_env.py` : aligne les chemins des modeles dans `.env`.
- `backend/scripts/ocr_benchmark.py` : compare des strategies OCR.
- `mapping_tool.py` : dessine les ROI et genere le JSON de configuration.

## Tests
Placez vos tests unitaires sous `backend/tests/` (pytest).

## Configuration
Consultez `env.example` pour la liste complete des variables d'environnement.

## Documentation
Pour la vue d'ensemble du projet : `README.md` a la racine.
