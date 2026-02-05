import logging
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Query

from backend.api_v1.models import (
    BulletinData, 
    BulletinsPage, 
    TranslationRegenerateRequest,
    TextExtractionResult,
    TranslationResult,
    BulletinTranslationResponse
)
import backend.api_v1.core as core
from backend.api_v1.core import _ensure_services_ready, ErrorCode
from backend.api_v1.utils import _cache_get, _cache_set, _cache_clear, _load_result_file
from backend.utils.background_tasks import get_task_manager, TaskStatus

logger = logging.getLogger("anam.api")
router = APIRouter(tags=["bulletins"])

@router.get("/bulletins", response_model=BulletinsPage)
async def list_bulletins(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Return paginated bulletin summaries."""
    _ensure_services_ready()
    assert core.services is not None
    items = core.services.bulletins.list_summaries(limit=limit, offset=offset)
    total = core.services.bulletins.count_summaries()
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/bulletins/{date}", response_model=BulletinData)
async def get_bulletin_by_date(
    date: str, 
    bulletin_type: Optional[str] = Query(None, alias="type", enum=["observation", "forecast"])
):
    """Retourner toutes les stations pour une date de bulletin spécifique."""
    cache_key = f"bulletins:detail:{date}:{bulletin_type or 'all'}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    
    def _station_to_payload(station):
        observation = station.get("observation", {}) or {}
        prevision = station.get("prevision", {}) or {}
        return {
            "name": station.get("name"),
            "latitude": station.get("latitude"),
            "longitude": station.get("longitude"),
            "tmin_obs": observation.get("tmin"),
            "tmax_obs": observation.get("tmax"),
            "weather_obs": observation.get("weather_condition"),
            "tmin_prev": prevision.get("tmin"),
            "tmax_prev": prevision.get("tmax"),
            "weather_prev": prevision.get("weather_condition"),
            "interpretation_francais": station.get("interpretation_francais"),
            "interpretation_moore": station.get("interpretation_moore"),
            "interpretation_dioula": station.get("interpretation_dioula"),
            "quality_score": station.get("quality_score"),
        }

    def _merge_station(existing, incoming):
        if existing is None:
            return incoming
        for key, value in incoming.items():
            if existing.get(key) is None and value is not None:
                existing[key] = value
        return existing

    stations_payload = []
    bulletin_interpretations = {"fr": None, "moore": None, "dioula": None}
    
    if core.services is not None:
        payloads = core.services.bulletins.list_payloads_by_date(date)
        
        try:
            dt_obj = datetime.strptime(date, "%Y-%m-%d")
            prev_date = (dt_obj - timedelta(days=1)).strftime("%Y-%m-%d")
            prev_payloads = core.services.bulletins.list_payloads_by_date(prev_date)
            prev_forecasts = [p for p in prev_payloads if p.get("type") == "forecast" or "forecast" in str(p.get("pdf_path")).lower() or "prevision" in str(p.get("pdf_path")).lower()]
            payloads = prev_forecasts + payloads
        except Exception as e:
            logger.warning(f"Erreur lors de la récupération du bulletin J-1 pour {date}: {e}")

        if bulletin_type:
            payloads = [p for p in payloads if p.get("type") == bulletin_type or bulletin_type in str(p.get("pdf_path")).lower()]
    else:
        payloads = []
        
    if payloads:
        station_map = {}
        for entry in payloads:
            if not bulletin_interpretations["fr"]:
                bulletin_interpretations["fr"] = entry.get("interpretation_francais")
                bulletin_interpretations["moore"] = entry.get("interpretation_moore")
                bulletin_interpretations["dioula"] = entry.get("interpretation_dioula")
            
            for station in entry.get("stations", []):
                payload = _station_to_payload(station)
                key = payload.get("name") or f"station_{len(station_map) + 1}"
                station_map[key] = _merge_station(station_map.get(key), payload)
        stations_payload = list(station_map.values())
    else:
        bulletins = _load_result_file()
        for entry in bulletins:
            if entry.get("date") != date:
                continue
            if bulletin_type and entry.get("type") != bulletin_type:
                continue
            
            if not bulletin_interpretations["fr"]:
                bulletin_interpretations["fr"] = entry.get("interpretation_francais")
                bulletin_interpretations["moore"] = entry.get("interpretation_moore")
                bulletin_interpretations["dioula"] = entry.get("interpretation_dioula")
                
            for station in entry.get("stations", []):
                stations_payload.append(_station_to_payload(station))

    if not stations_payload:
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.BULLETIN_NOT_FOUND.value,
                "message": f"No bulletin for {date} ({bulletin_type or 'all'}).",
            },
        )

    payload = {
        "date_bulletin": date, 
        "type": bulletin_type or (payloads[0].get("type") if payloads else "observation"),
        "stations": stations_payload,
        "interpretation_francais": bulletin_interpretations["fr"],
        "interpretation_moore": bulletin_interpretations["moore"],
        "interpretation_dioula": bulletin_interpretations["dioula"],
    }
    _cache_set(cache_key, payload)
    return payload


@router.post("/bulletins/regenerate-translation")
async def regenerate_translation(payload: TranslationRegenerateRequest):
    """Régénérer une interprétation ou une traduction spécifique."""
    _ensure_services_ready()
    assert core.services is not None
    
    station_payloads = core.services.bulletins.list_payloads_by_date(payload.date)
    if not station_payloads:
        raise HTTPException(status_code=404, detail="Bulletin non trouvé pour cette date.")
        
    target_station = None
    target_pdf_path = None
    is_generic = payload.station_name.lower() in ["bulletin national", "national", "all", "tout", "toutes"]
    
    for entry in station_payloads:
        if is_generic and entry.get("stations"):
            target_station = entry["stations"][0]
            target_pdf_path = entry.get("pdf_path")
            break
        for station in entry.get("stations", []):
            if station.get("name") == payload.station_name:
                target_station = station
                target_pdf_path = entry.get("pdf_path")
                break
        if target_station:
            target_station["pdf_path"] = target_pdf_path
            target_station["date"] = payload.date
            break
            
    if not target_station:
        if is_generic and station_payloads:
             for entry in station_payloads:
                 if entry.get("stations"):
                     target_station = entry["stations"][0].copy()
                     target_pdf_path = entry.get("pdf_path")
                     target_station["pdf_path"] = target_pdf_path
                     target_station["date"] = payload.date
                     break
        
        if not target_station:
            raise HTTPException(status_code=404, detail="Station ou bulletin non trouvé pour cette date.")
        
    from backend.modules.language_interpreter import LanguageInterpreter
    interpreter = LanguageInterpreter.get_shared(core.services.db_manager)
    
    if payload.language in [None, "all", "interpretation_francais", "fr", "francais"]:
        french_text = interpreter._generate_french_bulletin(target_station)
        if french_text:
            target_station["interpretation_francais"] = french_text
            
    french_text = target_station.get("interpretation_francais")
    if not french_text:
        for entry in station_payloads:
            if entry.get("interpretation_francais"):
                french_text = entry.get("interpretation_francais")
                target_station["interpretation_francais"] = french_text
                break
    
    if not french_text:
        logger.info(f"Extraction automatique du texte FR pour le bulletin du {payload.date}")
        french_text = interpreter._generate_french_bulletin(target_station)
        if french_text:
            target_station["interpretation_francais"] = french_text

    if not french_text:
        raise HTTPException(status_code=400, detail="Impossible d'extraire le texte français du PDF. Vérifiez que le fichier existe.")
        
    langs_to_regen = []
    if payload.language in [None, "all"]:
        langs_to_regen = ["moore", "dioula"]
    elif payload.language in ["moore", "interpretation_moore"]:
        langs_to_regen = ["moore"]
    elif payload.language in ["dioula", "interpretation_dioula"]:
        langs_to_regen = ["dioula"]
        
    new_translations = {"fr": french_text}
    for lang in langs_to_regen:
        translated = interpreter.translate(french_text, lang, force=True)
        if translated:
            target_station[f"interpretation_{lang}"] = translated
            new_translations[lang] = translated
            
    raw_type = target_station.get("type") or ("forecast" if "forecast" in str(target_pdf_path).lower() or "prevision" in str(target_pdf_path).lower() else "observation")
    type_map = {
        "prevision": "forecast",
        "prévision": "forecast",
        "forecast": "forecast",
        "observation": "observation",
        "obs": "observation"
    }
    bulletin_type_detected = type_map.get(str(raw_type).lower(), "observation")
    
    logger.info(f"Mise à jour DB pour le bulletin {payload.date} (Type détecté: {raw_type} -> DB: {bulletin_type_detected})")
    rows_updated = core.services.bulletins.update_bulletin_interpretations(
        payload.date,
        bulletin_type_detected,
        new_translations,
    )
    logger.info(f"Nombre de lignes mises à jour dans 'bulletins' : {rows_updated}")
    
    station_snapshot = target_station.copy()
    station_snapshot["interpretation_francais"] = None
    station_snapshot["interpretation_moore"] = None
    station_snapshot["interpretation_dioula"] = None
    
    core.services.bulletins.upsert_station_snapshot(target_pdf_path, station_snapshot)
    
    for entry in station_payloads:
        if entry.get("pdf_path") == target_pdf_path:
            for lang_key in ["fr", "moore", "dioula"]:
                if lang_key in new_translations:
                    field_name = "interpretation_francais" if lang_key == "fr" else f"interpretation_{lang_key}"
                    entry[field_name] = new_translations[lang_key]
            
            for i, st in enumerate(entry.get("stations", [])):
                if st.get("name") == target_station.get("name"):
                    entry["stations"][i] = station_snapshot
                    break
            
            core.services.bulletins.upsert_bulletin_payload(target_pdf_path, entry)
            logger.info(f"Payload JSON mis à jour pour {target_pdf_path}")
            break
            
    _cache_clear("bulletins:")
    
    return {
        "status": "success",
        "station": payload.station_name,
        "date": payload.date,
        "translations": {
            "fr": new_translations.get("fr"),
            "moore": new_translations.get("moore"),
            "dioula": new_translations.get("dioula"),
        }
    }


@router.post("/bulletins/regenerate-translation-async")
async def regenerate_translation_async(payload: TranslationRegenerateRequest):
    """
    Lance une régénération de traduction en arrière-plan (non-bloquant).
    
    ⚡ Optimisation : Vérifie d'abord si la traduction existe déjà dans la BD.
    Si elle existe, retourne immédiatement sans lancer de tâche.
    
    Retourne immédiatement un ID de tâche que le client peut utiliser
    pour suivre la progression via /bulletins/translation-task/{task_id}.
    
    Avantages :
    - L'API reste réactive pendant la traduction
    - Permet plusieurs traductions simultanées (jusqu'à max_workers)
    - Le client peut interroger le statut et récupérer le résultat
    - Évite les traductions inutiles si déjà présentes
    """
    _ensure_services_ready()
    assert core.services is not None
    
    # Vérification rapide que le bulletin existe
    station_payloads = core.services.bulletins.list_payloads_by_date(payload.date)
    if not station_payloads:
        raise HTTPException(status_code=404, detail="Bulletin non trouvé pour cette date.")
    
    # ✨ NOUVELLE FONCTIONNALITÉ : Vérifier si les traductions existent déjà dans la BD
    existing_bulletins = core.services.bulletins.list_summaries(limit=500)
    target_bulletin = None
    for bulletin in existing_bulletins:
        if bulletin.get("date") == payload.date:
            target_bulletin = bulletin
            break
    
    if target_bulletin:
        # Déterminer les langues à vérifier
        langs_to_check = []
        if payload.language in [None, "all"]:
            langs_to_check = ["moore", "dioula"]
        elif payload.language in ["moore", "interpretation_moore"]:
            langs_to_check = ["moore"]
        elif payload.language in ["dioula", "interpretation_dioula"]:
            langs_to_check = ["dioula"]
        
        # Vérifier si toutes les traductions demandées existent déjà
        all_exist = True
        existing_translations = {}
        for lang in langs_to_check:
            field_name = f"interpretation_{lang}"
            translation = target_bulletin.get(field_name)
            if translation and len(translation.strip()) > 10:  # Au moins 10 caractères
                existing_translations[lang] = translation
            else:
                all_exist = False
                break
        
        # Si toutes les traductions existent, retourner immédiatement sans tâche
        if all_exist:
            logger.info(f"✅ Traductions déjà présentes pour {payload.date} ({', '.join(langs_to_check)}), aucune régénération nécessaire")
            return {
                "task_id": f"cached_{payload.date}_{payload.language}_{int(datetime.now().timestamp())}",
                "status": "completed",
                "message": "Les traductions existent déjà dans la base de données, aucune régénération nécessaire.",
                "translations": existing_translations,
                "cached": True,
            }
    
    # Créer la tâche
    task_manager = get_task_manager()
    task_id = task_manager.create_task(
        task_type="translation",
        metadata={
            "date": payload.date,
            "station_name": payload.station_name,
            "language": payload.language,
        }
    )
    
    # Fonction de traduction à exécuter dans le thread pool
    def _execute_translation():
        """Exécute la traduction de manière synchrone dans un thread séparé."""
        from backend.modules.language_interpreter import LanguageInterpreter
        
        # Récupérer les données de la station
        station_payloads = core.services.bulletins.list_payloads_by_date(payload.date)
        target_station = None
        target_pdf_path = None
        is_generic = payload.station_name.lower() in ["bulletin national", "national", "all", "tout", "toutes"]
        
        for entry in station_payloads:
            if is_generic and entry.get("stations"):
                target_station = entry["stations"][0].copy()
                target_pdf_path = entry.get("pdf_path")
                break
            for station in entry.get("stations", []):
                if station.get("name") == payload.station_name:
                    target_station = station.copy()
                    target_pdf_path = entry.get("pdf_path")
                    break
            if target_station:
                target_station["pdf_path"] = target_pdf_path
                target_station["date"] = payload.date
                break
        
        if not target_station:
            if is_generic and station_payloads:
                for entry in station_payloads:
                    if entry.get("stations"):
                        target_station = entry["stations"][0].copy()
                        target_pdf_path = entry.get("pdf_path")
                        target_station["pdf_path"] = target_pdf_path
                        target_station["date"] = payload.date
                        break
            
            if not target_station:
                raise ValueError("Station ou bulletin non trouvé pour cette date.")
        
        # Interpréteur partagé
        interpreter = LanguageInterpreter.get_shared(core.services.db_manager)
        
        # Générer le texte français si nécessaire
        if payload.language in [None, "all", "interpretation_francais", "fr", "francais"]:
            french_text = interpreter._generate_french_bulletin(target_station)
            if french_text:
                target_station["interpretation_francais"] = french_text
        
        french_text = target_station.get("interpretation_francais")
        if not french_text:
            for entry in station_payloads:
                if entry.get("interpretation_francais"):
                    french_text = entry.get("interpretation_francais")
                    target_station["interpretation_francais"] = french_text
                    break
        
        if not french_text:
            french_text = interpreter._generate_french_bulletin(target_station)
            if french_text:
                target_station["interpretation_francais"] = french_text
        
        if not french_text:
            raise ValueError("Impossible d'extraire le texte français du PDF.")
        
        # Déterminer les langues à régénérer
        langs_to_regen = []
        if payload.language in [None, "all"]:
            langs_to_regen = ["moore", "dioula"]
        elif payload.language in ["moore", "interpretation_moore"]:
            langs_to_regen = ["moore"]
        elif payload.language in ["dioula", "interpretation_dioula"]:
            langs_to_regen = ["dioula"]
        
        # Générer les traductions
        new_translations = {"fr": french_text}
        for lang in langs_to_regen:
            translated = interpreter.translate(french_text, lang, force=True)
            if translated:
                target_station[f"interpretation_{lang}"] = translated
                new_translations[lang] = translated
        
        # Détecter le type de bulletin
        raw_type = target_station.get("type") or (
            "forecast" if "forecast" in str(target_pdf_path).lower() or "prevision" in str(target_pdf_path).lower() else "observation"
        )
        type_map = {
            "prevision": "forecast",
            "prévision": "forecast",
            "forecast": "forecast",
            "observation": "observation",
            "obs": "observation"
        }
        bulletin_type_detected = type_map.get(str(raw_type).lower(), "observation")
        
        # Mise à jour de la base de données
        rows_updated = core.services.bulletins.update_bulletin_interpretations(
            payload.date,
            bulletin_type_detected,
            new_translations
        )
        logger.info(f"✅ Tâche {task_id}: {rows_updated} ligne(s) mise(s) à jour dans la BD")
        
        # Mise à jour du snapshot
        station_snapshot = target_station.copy()
        station_snapshot["interpretation_francais"] = None
        station_snapshot["interpretation_moore"] = None
        station_snapshot["interpretation_dioula"] = None
        core.services.bulletins.upsert_station_snapshot(target_pdf_path, station_snapshot)
        
        # Mise à jour du payload
        for entry in station_payloads:
            if entry.get("pdf_path") == target_pdf_path:
                for lang_key in ["fr", "moore", "dioula"]:
                    if lang_key in new_translations:
                        field_name = "interpretation_francais" if lang_key == "fr" else f"interpretation_{lang_key}"
                        entry[field_name] = new_translations[lang_key]
                
                for i, st in enumerate(entry.get("stations", [])):
                    if st.get("name") == target_station.get("name"):
                        entry["stations"][i] = station_snapshot
                        break
                
                core.services.bulletins.upsert_bulletin_payload(target_pdf_path, entry)
                break
        
        # Nettoyer le cache
        _cache_clear("bulletins:")
        
        return {
            "status": "success",
            "station": payload.station_name,
            "date": payload.date,
            "translations": new_translations,
            "rows_updated": rows_updated,
        }
    
    # Soumettre la tâche au pool de threads
    await task_manager.submit_translation_task(task_id, _execute_translation)
    
    # Retourner immédiatement l'ID de tâche
    return {
        "task_id": task_id,
        "status": "accepted",
        "message": "La tâche de traduction a été lancée en arrière-plan.",
        "poll_url": f"/bulletins/translation-task/{task_id}",
    }


@router.get("/bulletins/translation-task/{task_id}")
async def get_translation_task_status(task_id: str):
    """
    Récupère le statut d'une tâche de traduction.
    
    Statuts possibles :
    - pending: En attente de traitement
    - running: En cours d'exécution
    - completed: Terminée avec succès
    - failed: Échouée
    - cancelled: Annulée
    """
    task_manager = get_task_manager()
    task = task_manager.get_task(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")
    
    response = {
        "task_id": task.task_id,
        "status": task.status.value,
        "task_type": task.task_type,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "finished_at": task.finished_at.isoformat() if task.finished_at else None,
        "progress": task.progress,
        "metadata": task.metadata,
    }
    
    if task.status == TaskStatus.COMPLETED and task.result:
        response["result"] = task.result
    
    if task.status == TaskStatus.FAILED and task.error:
        response["error"] = task.error
    
    return response


@router.get("/bulletins/translation-tasks")
async def list_translation_tasks(
    status: Optional[str] = Query(None, enum=["pending", "running", "completed", "failed", "cancelled"])
):
    """
    Liste toutes les tâches de traduction.
    
    Optionnellement, filtre par statut.
    """
    task_manager = get_task_manager()
    all_tasks = task_manager.get_all_tasks()
    
    # Filtrer par statut si spécifié
    if status:
        filtered = {
            tid: task for tid, task in all_tasks.items()
            if task.status.value == status
        }
    else:
        filtered = all_tasks
    
    return {
        "tasks": [
            {
                "task_id": task.task_id,
                "status": task.status.value,
                "task_type": task.task_type,
                "created_at": task.created_at.isoformat() if task.created_at else None,
                "started_at": task.started_at.isoformat() if task.started_at else None,
                "finished_at": task.finished_at.isoformat() if task.finished_at else None,
                "metadata": task.metadata,
            }
            for task in filtered.values()
        ],
        "total": len(filtered),
        "running_count": task_manager.get_running_tasks_count(),
    }


@router.get("/bulletins/{date}/translations", response_model=BulletinTranslationResponse)
async def get_bulletin_translations(date: str):
    """
    Récupère les textes extraits et les traductions pour un bulletin spécifique.
    """
    _ensure_services_ready()
    assert core.services is not None
    
    # Vérifier d'abord le cache
    cache_key = f"bulletins:translations:{date}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    
    # Récupérer les données du bulletin
    station_payloads = core.services.bulletins.list_payloads_by_date(date)
    if not station_payloads:
        raise HTTPException(
            status_code=404,
            detail={
                "code": ErrorCode.BULLETIN_NOT_FOUND.value,
                "message": f"No bulletin found for date {date}",
            },
        )
    
    # Extraire les textes français
    french_texts = []
    for entry in station_payloads:
        if entry.get("interpretation_francais"):
            french_texts.append(entry["interpretation_francais"])
    
    # Si aucun texte français trouvé, essayer d'en extraire un
    if not french_texts:
        from backend.modules.language_interpreter import LanguageInterpreter
        interpreter = LanguageInterpreter.get_shared(core.services.db_manager)
        
        # Prendre la première station disponible
        for entry in station_payloads:
            if entry.get("stations"):
                station = entry["stations"][0].copy()
                station["pdf_path"] = entry.get("pdf_path")
                station["date"] = date
                french_text = interpreter._generate_french_bulletin(station)
                if french_text:
                    french_texts.append(french_text)
                    break
    
    french_text = "\n\n".join(french_texts) if french_texts else None
    
    # Récupérer les traductions existantes
    existing_bulletins = core.services.bulletins.list_summaries(limit=500)
    moore_translation = None
    dioula_translation = None
    
    for bulletin in existing_bulletins:
        if bulletin.get("date") == date:
            moore_translation = bulletin.get("interpretation_moore")
            dioula_translation = bulletin.get("interpretation_dioula")
            break
    
    # Construire la réponse
    response = {
        "date": date,
        "french_text": french_text,
        "moore_translation": moore_translation,
        "dioula_translation": dioula_translation,
        "extracted_at": datetime.now().isoformat(),
        "translations": []
    }
    
    # Ajouter les traductions individuelles si disponibles
    if french_text:
        if moore_translation:
            response["translations"].append({
                "language": "moore",
                "text": moore_translation,
                "source_text": french_text,
                "translated_at": datetime.now().isoformat()
            })
        if dioula_translation:
            response["translations"].append({
                "language": "dioula",
                "text": dioula_translation,
                "source_text": french_text,
                "translated_at": datetime.now().isoformat()
            })
    
    _cache_set(cache_key, response)  # Cache using default TTL from config
    return response


@router.post("/bulletins/{date}/extract-text")
async def extract_bulletin_text(date: str):
    """
    Force l'extraction du texte français d'un bulletin.
    """
    _ensure_services_ready()
    assert core.services is not None
    
    station_payloads = core.services.bulletins.list_payloads_by_date(date)
    if not station_payloads:
        raise HTTPException(status_code=404, detail="Bulletin non trouvé pour cette date.")
    
    from backend.modules.language_interpreter import LanguageInterpreter
    interpreter = LanguageInterpreter.get_shared(core.services.db_manager)
    
    extracted_texts = []
    for entry in station_payloads:
        if entry.get("stations"):
            station = entry["stations"][0].copy()
            station["pdf_path"] = entry.get("pdf_path")
            station["date"] = date
            french_text = interpreter._generate_french_bulletin(station)
            if french_text:
                extracted_texts.append(french_text)
                # Mettre à jour dans la base
                entry["interpretation_francais"] = french_text
                core.services.bulletins.upsert_bulletin_payload(entry.get("pdf_path"), entry)
    
    combined_text = "\n\n".join(extracted_texts) if extracted_texts else None
    
    if not combined_text:
        raise HTTPException(status_code=400, detail="Impossible d'extraire le texte du bulletin.")
    
    # Nettoyer le cache
    _cache_clear(f"bulletins:translations:{date}")
    _cache_clear(f"bulletins:detail:{date}:")
    
    return {
        "status": "success",
        "date": date,
        "extracted_text": combined_text,
        "extracted_at": datetime.now().isoformat()
    }


@router.post("/bulletins/{date}/translate")
async def translate_bulletin(date: str, languages: Optional[List[str]] = Query(["moore", "dioula"])):
    """
    Traduit un bulletin dans les langues spécifiées.
    """
    _ensure_services_ready()
    assert core.services is not None
    
    # Vérifier que le texte français existe
    response = await get_bulletin_translations(date)
    french_text = response.french_text
    
    if not french_text:
        # Essayer d'extraire le texte
        extract_response = await extract_bulletin_text(date)
        french_text = extract_response["extracted_text"]
    
    if not french_text:
        raise HTTPException(status_code=400, detail="Impossible d'obtenir le texte français à traduire.")
    
    # Effectuer les traductions
    from backend.modules.language_interpreter import LanguageInterpreter
    interpreter = LanguageInterpreter.get_shared(core.services.db_manager)
    
    translations = {}
    for lang in languages:
        if lang in ["moore", "dioula"]:
            translated = interpreter.translate(french_text, lang, force=True)
            if translated:
                translations[lang] = translated
    
    if not translations:
        raise HTTPException(status_code=400, detail="Échec de toutes les traductions.")
    
    # Mettre à jour la base de données
    bulletin_type = "observation"  # Par défaut
    station_payloads = core.services.bulletins.list_payloads_by_date(date)
    if station_payloads:
        pdf_path = station_payloads[0].get("pdf_path")
        if pdf_path and ("forecast" in pdf_path.lower() or "prevision" in pdf_path.lower()):
            bulletin_type = "forecast"
    
    rows_updated = core.services.bulletins.update_bulletin_interpretations(
        date,
        bulletin_type,
        {"fr": french_text, **translations}
    )
    
    # Nettoyer le cache
    _cache_clear(f"bulletins:translations:{date}")
    _cache_clear(f"bulletins:detail:{date}:")
    
    return {
        "status": "success",
        "date": date,
        "translations": translations,
        "rows_updated": rows_updated
    }
