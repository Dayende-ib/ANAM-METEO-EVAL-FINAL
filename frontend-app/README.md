# Frontend ANAM-METEO-EVAL (React/Vite)

Client React/Vite pour consulter les bulletins, metriques et analyses produits par l'API.

## Prerequis
- Node.js >= 20 et npm.

## Installation
```bash
cd frontend-app
npm install
```

## Configuration
Le front lit ses variables via `import.meta.env` (Vite). Exemple minimal :
```bash
VITE_API_BASE_URL=http://localhost:8000/api/v1
```
Modifiez `frontend-app/.env` selon votre environnement.

Variables utilisees (voir `src/config.ts`) :
- `VITE_API_BASE_URL`
- `VITE_API_CACHE_TTL_MS`
- `VITE_UPLOAD_BATCH_MAX_FILES`
- `VITE_DEBUG_MODE`
- `VITE_BACKEND_DEBUG`

## Lancer en dev
```bash
npm run dev
```

## Build et preview
```bash
npm run build
npm run preview
```

## Qualite
```bash
npm run lint
npm run format:check
npm run test
```

## Documentation
Pour la vue d'ensemble et l'API backend : `README.md` a la racine et `backend/README.md`.
