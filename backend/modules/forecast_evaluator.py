#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Evaluation des previsions meteo pour le systeme ANAM-METEO-EVAL."""

import logging
from datetime import datetime, timedelta
from typing import Dict

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    recall_score,
)

logger = logging.getLogger(__name__)


class ForecastEvaluator:
    """Calcule les metriques servant a juger la qualite des bulletins."""

    def __init__(self, db_manager):
        self.db_manager = db_manager

    def calculate_temperature_metrics(self, tmin_obs, tmax_obs, tmin_fore, tmax_fore):
        """Retourne MAE/RMSE/biais pour les temperatures mini/maxi."""
        tmin_pairs = [(o, f) for o, f in zip(tmin_obs, tmin_fore) if o is not None and f is not None]
        tmax_pairs = [(o, f) for o, f in zip(tmax_obs, tmax_fore) if o is not None and f is not None]
        if not tmin_pairs and not tmax_pairs:
            return {}

        metrics = {}

        if tmin_pairs:
            tmin_obs_arr = np.array([p[0] for p in tmin_pairs], dtype=float)
            tmin_fore_arr = np.array([p[1] for p in tmin_pairs], dtype=float)
            metrics["mae_tmin"] = mean_absolute_error(tmin_obs_arr, tmin_fore_arr)
            metrics["rmse_tmin"] = float(np.sqrt(mean_squared_error(tmin_obs_arr, tmin_fore_arr)))
            metrics["bias_tmin"] = float(np.mean(tmin_fore_arr - tmin_obs_arr))
            metrics["tmin_sample_size"] = len(tmin_pairs)

        if tmax_pairs:
            tmax_obs_arr = np.array([p[0] for p in tmax_pairs], dtype=float)
            tmax_fore_arr = np.array([p[1] for p in tmax_pairs], dtype=float)
            metrics["mae_tmax"] = mean_absolute_error(tmax_obs_arr, tmax_fore_arr)
            metrics["rmse_tmax"] = float(np.sqrt(mean_squared_error(tmax_obs_arr, tmax_fore_arr)))
            metrics["bias_tmax"] = float(np.mean(tmax_fore_arr - tmax_obs_arr))
            metrics["tmax_sample_size"] = len(tmax_pairs)

        sample_size = metrics.get("tmin_sample_size") or metrics.get("tmax_sample_size")
        if metrics.get("tmin_sample_size") and metrics.get("tmax_sample_size"):
            sample_size = min(metrics["tmin_sample_size"], metrics["tmax_sample_size"])
        metrics["temperature_sample_size"] = sample_size

        return metrics

    def calculate_weather_metrics(self, weather_obs, weather_fore):
        """Calcule accuracy, precision, rappel, F1 et matrice de confusion."""
        if not weather_obs or not weather_fore:
            return {}

        pairs = [
            (observed, forecasted)
            for observed, forecasted in zip(weather_obs, weather_fore)
            if observed is not None and forecasted is not None
        ]
        if not pairs:
            return {}

        y_true = [item[0] for item in pairs]
        y_pred = [item[1] for item in pairs]

        labels = sorted(set(y_true) | set(y_pred))
        matrix = confusion_matrix(y_true, y_pred, labels=labels)

        accuracy = accuracy_score(y_true, y_pred)
        precision = precision_score(y_true, y_pred, average="weighted", zero_division=0)
        recall = recall_score(y_true, y_pred, average="weighted", zero_division=0)
        f1 = f1_score(y_true, y_pred, average="weighted", zero_division=0)

        return {
            "accuracy_weather": accuracy,
            "precision_weather": precision,
            "recall_weather": recall,
            "f1_score_weather": f1,
            "confusion_matrix": {
                "labels": labels,
                "matrix": matrix.tolist(),
            },
            "sample_size": len(y_true),
        }

    def evaluate_forecasts(self, force_recalculate: bool = False):
        """Calcule les metriques pour tous les bulletins exploitables."""
        # Nettoyage des anciennes metriques invalides (meme jour)
        self.db_manager.cleanup_invalid_metrics()
        
        observation_dates = self.db_manager.list_bulletin_dates("observation")
        forecast_dates = set(self.db_manager.list_bulletin_dates("forecast"))
        if not observation_dates:
            logger.warning("Aucune observation disponible pour evaluation.")
            return {}

        evaluations = []
        for observation_date in observation_dates:
            try:
                obs_dt = datetime.strptime(observation_date, "%Y-%m-%d")
            except ValueError:
                logger.error("Format de date invalide pour %s", observation_date)
                continue

            forecast_reference_date = (obs_dt - timedelta(days=1)).strftime("%Y-%m-%d")
            candidates = []
            if forecast_reference_date in forecast_dates:
                candidates.append(forecast_reference_date)

            if not candidates:
                logger.info(
                    "Pas de prevision disponible pour l'observation %s.",
                    observation_date,
                )
                continue

            for forecast_date in candidates:
                if not force_recalculate and self.db_manager.has_evaluation(
                    observation_date, forecast_date
                ):
                    continue

                pairs = self.db_manager.get_observation_forecast_pairs(
                    observation_date, forecast_date
                )
                if not pairs:
                    logger.warning(
                        "Aucune donnee observation/prevision pour %s (ref %s).",
                        observation_date,
                        forecast_date,
                    )
                    continue

                tmin_obs, tmax_obs, tmin_fore, tmax_fore = [], [], [], []
                weather_obs, weather_fore = [], []

                for _, tmin_o, tmax_o, w_o, tmin_f, tmax_f, w_f in pairs:
                    tmin_obs.append(tmin_o)
                    tmax_obs.append(tmax_o)
                    weather_obs.append(w_o)
                    tmin_fore.append(tmin_f)
                    tmax_fore.append(tmax_f)
                    weather_fore.append(w_f)

                temp_metrics = self.calculate_temperature_metrics(
                    tmin_obs, tmax_obs, tmin_fore, tmax_fore
                )
                weather_metrics = self.calculate_weather_metrics(weather_obs, weather_fore)

                all_metrics = {**temp_metrics, **weather_metrics}
                all_metrics["observation_date"] = observation_date
                all_metrics["forecast_reference_date"] = forecast_date

                try:
                    self.db_manager.save_evaluation_metrics(
                        observation_date,
                        forecast_date,
                        all_metrics,
                    )
                except Exception as exc:  # pragma: no cover - defensive logging
                    logger.error("Echec de la sauvegarde des metriques: %s", exc)
                    continue

                logger.info(
                    "Evaluation realisee pour %s (prev ref %s) avec %d stations.",
                    observation_date,
                    forecast_date,
                    len(pairs),
                )
                evaluations.append(all_metrics)

        if not evaluations:
            logger.warning("Aucune evaluation calculee.")
            return {}

        return {
            "evaluated": len(evaluations),
            "last": evaluations[-1],
            "details": evaluations,
        }

    def calculate_monthly_metrics_direct(self) -> Dict:
        """Calcule directement les métriques mensuelles à partir des données brutes."""
        conn = self.db_manager.get_connection()
        cursor = conn.cursor()
        
        # Récupérer tous les mois ayant des observations
        cursor.execute(
            """
            SELECT DISTINCT strftime('%Y', date) as year,
                            strftime('%m', date) as month
            FROM bulletins
            WHERE type = 'observation'
            ORDER BY year DESC, month DESC
            """
        )
        months = cursor.fetchall()
        
        calculated_count = 0
        
        for year_str, month_str in months:
            year = int(year_str)
            month = int(month_str)
            
            # Récupérer toutes les paires observation/prévision pour ce mois
            cursor.execute(
                """
                SELECT 
                    o.tmin as obs_tmin,
                    o.tmax as obs_tmax,
                    o.weather_condition as obs_weather,
                    f.tmin as fore_tmin,
                    f.tmax as fore_tmax,
                    f.weather_condition as fore_weather
                FROM weather_data o
                JOIN bulletins ob ON o.bulletin_id = ob.id
                JOIN weather_data f ON o.station_id = f.station_id
                JOIN bulletins fb ON f.bulletin_id = fb.id
                WHERE ob.type = 'observation'
                  AND fb.type = 'forecast'
                  AND strftime('%Y-%m', ob.date) = ?
                  AND fb.date = date(ob.date, '-1 day')  -- Prévision J-1
                """,
                (f"{year_str}-{month_str}",)
            )
            
            rows = cursor.fetchall()
            
            if not rows:
                logger.info(f"Aucune donnée pour {year}-{month:02d}")
                continue
            
            # Extraire les valeurs
            tmin_obs = []
            tmax_obs = []
            tmin_fore = []
            tmax_fore = []
            weather_obs = []
            weather_fore = []
            
            for row in rows:
                if row[0] is not None and row[3] is not None:  # tmin
                    tmin_obs.append(float(row[0]))
                    tmin_fore.append(float(row[3]))
                
                if row[1] is not None and row[4] is not None:  # tmax
                    tmax_obs.append(float(row[1]))
                    tmax_fore.append(float(row[4]))
                
                if row[2] is not None and row[5] is not None:  # weather
                    weather_obs.append(row[2])
                    weather_fore.append(row[5])
            
            # Calculer les métriques
            temp_metrics = self.calculate_temperature_metrics(
                tmin_obs, tmax_obs, tmin_fore, tmax_fore
            )
            weather_metrics = self.calculate_weather_metrics(weather_obs, weather_fore)
            
            # Combiner les métriques
            all_metrics = {**temp_metrics, **weather_metrics}
            all_metrics["sample_size"] = len(rows)
            all_metrics["days_evaluated"] = len(set(row[0] for row in cursor.execute(
                """
                SELECT DISTINCT ob.date
                FROM weather_data o
                JOIN bulletins ob ON o.bulletin_id = ob.id
                JOIN weather_data f ON o.station_id = f.station_id
                JOIN bulletins fb ON f.bulletin_id = fb.id
                WHERE ob.type = 'observation'
                  AND fb.type = 'forecast'
                  AND strftime('%Y-%m', ob.date) = ?
                  AND fb.date = date(ob.date, '-1 day')
                """,
                (f"{year_str}-{month_str}",)
            )))
            
            # Sauvegarder
            self.db_manager.save_monthly_metrics(year, month, all_metrics)
            calculated_count += 1
            logger.info(f"Métriques mensuelles calculées pour {year}-{month:02d} : {all_metrics['days_evaluated']} jours, {all_metrics['sample_size']} échantillons")
        
        return {
            "status": "done",
            "months_calculated": calculated_count,
        }

    def aggregate_monthly_metrics(self) -> Dict:
        """Agrège les métriques d'évaluation par mois (méthode legacy)."""
        conn = self.db_manager.get_connection()
        cursor = conn.cursor()
        
        # Récupérer tous les mois distincts avec des métriques
        cursor.execute(
            """
            SELECT DISTINCT strftime('%Y', bulletin_date) as year,
                            strftime('%m', bulletin_date) as month
            FROM evaluation_metrics
            ORDER BY year DESC, month DESC
            """
        )
        months = cursor.fetchall()
        
        aggregated_count = 0
        for year_str, month_str in months:
            year = int(year_str)
            month = int(month_str)
            
            # Agréger les métriques pour ce mois
            cursor.execute(
                """
                SELECT 
                    AVG(mae_tmin) as avg_mae_tmin,
                    AVG(mae_tmax) as avg_mae_tmax,
                    AVG(rmse_tmin) as avg_rmse_tmin,
                    AVG(rmse_tmax) as avg_rmse_tmax,
                    AVG(bias_tmin) as avg_bias_tmin,
                    AVG(bias_tmax) as avg_bias_tmax,
                    AVG(accuracy_weather) as avg_accuracy_weather,
                    AVG(precision_weather) as avg_precision_weather,
                    AVG(recall_weather) as avg_recall_weather,
                    AVG(f1_score_weather) as avg_f1_score_weather,
                    SUM(sample_size) as total_sample_size,
                    COUNT(*) as days_count
                FROM evaluation_metrics
                WHERE strftime('%Y', bulletin_date) = ? 
                  AND strftime('%m', bulletin_date) = ?
                """,
                (year_str, month_str),
            )
            row = cursor.fetchone()
            
            if row and row[0] is not None:  # Au moins une métrique valide
                monthly_metrics = {
                    "mae_tmin": row[0],
                    "mae_tmax": row[1],
                    "rmse_tmin": row[2],
                    "rmse_tmax": row[3],
                    "bias_tmin": row[4],
                    "bias_tmax": row[5],
                    "accuracy_weather": row[6],
                    "precision_weather": row[7],
                    "recall_weather": row[8],
                    "f1_score_weather": row[9],
                    "sample_size": row[10] or 0,
                    "days_evaluated": row[11] or 0,
                }
                
                self.db_manager.save_monthly_metrics(year, month, monthly_metrics)
                aggregated_count += 1
                logger.info(f"Métriques mensuelles agrégées pour {year}-{month:02d} : {row[11]} jours")
        
        return {
            "status": "done",
            "months_aggregated": aggregated_count,
        }

    def calculate_station_monthly_metrics(self) -> Dict:
        """Calcule les métriques mensuelles pour chaque station individuellement."""
        conn = self.db_manager.get_connection()
        cursor = conn.cursor()
        
        # Récupérer toutes les stations
        cursor.execute("SELECT id, name FROM stations ORDER BY name")
        stations = cursor.fetchall()
        
        calculated_count = 0
        
        for station_id, station_name in stations:
            # Récupérer tous les mois ayant des observations pour cette station
            cursor.execute(
                """
                SELECT DISTINCT strftime('%Y', ob.date) as year,
                                strftime('%m', ob.date) as month
                FROM weather_data wd
                JOIN bulletins ob ON wd.bulletin_id = ob.id
                WHERE ob.type = 'observation'
                  AND wd.station_id = ?
                ORDER BY year DESC, month DESC
                """,
                (station_id,)
            )
            months = cursor.fetchall()
            
            station_calculated = 0
            
            for year_str, month_str in months:
                year = int(year_str)
                month = int(month_str)
                
                # Récupérer toutes les paires observation/prévision pour cette station et ce mois
                cursor.execute(
                    """
                    SELECT 
                        o.tmin as obs_tmin,
                        o.tmax as obs_tmax,
                        o.weather_condition as obs_weather,
                        f.tmin as fore_tmin,
                        f.tmax as fore_tmax,
                        f.weather_condition as fore_weather
                    FROM weather_data o
                    JOIN bulletins ob ON o.bulletin_id = ob.id
                    JOIN weather_data f ON o.station_id = f.station_id
                    JOIN bulletins fb ON f.bulletin_id = fb.id
                    WHERE ob.type = 'observation'
                      AND fb.type = 'forecast'
                      AND o.station_id = ?
                      AND strftime('%Y-%m', ob.date) = ?
                      AND fb.date = date(ob.date, '-1 day')  -- Prévision J-1
                    """,
                    (station_id, f"{year_str}-{month_str}"),
                )
                
                rows = cursor.fetchall()
                
                if not rows:
                    continue
                
                # Extraire les valeurs
                tmin_obs = []
                tmax_obs = []
                tmin_fore = []
                tmax_fore = []
                weather_obs = []
                weather_fore = []
                
                for row in rows:
                    if row[0] is not None and row[3] is not None:  # tmin
                        tmin_obs.append(float(row[0]))
                        tmin_fore.append(float(row[3]))
                    
                    if row[1] is not None and row[4] is not None:  # tmax
                        tmax_obs.append(float(row[1]))
                        tmax_fore.append(float(row[4]))
                    
                    if row[2] is not None and row[5] is not None:  # weather
                        weather_obs.append(row[2])
                        weather_fore.append(row[5])
                
                # Calculer les métriques
                temp_metrics = self.calculate_temperature_metrics(
                    tmin_obs, tmax_obs, tmin_fore, tmax_fore
                )
                weather_metrics = self.calculate_weather_metrics(weather_obs, weather_fore)
                
                # Combiner les métriques
                all_metrics = {**temp_metrics, **weather_metrics}
                all_metrics["sample_size"] = len(rows)
                all_metrics["days_evaluated"] = len(set(row[0] for row in cursor.execute(
                    """
                    SELECT DISTINCT ob.date
                    FROM weather_data o
                    JOIN bulletins ob ON o.bulletin_id = ob.id
                    JOIN weather_data f ON o.station_id = f.station_id
                    JOIN bulletins fb ON f.bulletin_id = fb.id
                    WHERE ob.type = 'observation'
                      AND fb.type = 'forecast'
                      AND o.station_id = ?
                      AND strftime('%Y-%m', ob.date) = ?
                      AND fb.date = date(ob.date, '-1 day')
                    """,
                    (station_id, f"{year_str}-{month_str}"),
                )))
                
                # Sauvegarder
                self.db_manager.save_station_monthly_metrics(station_id, year, month, all_metrics)
                station_calculated += 1
                logger.info(f"Métriques mensuelles calculées pour {station_name} - {year}-{month:02d} : {all_metrics['days_evaluated']} jours, {all_metrics['sample_size']} échantillons")
            
            if station_calculated > 0:
                calculated_count += 1
                logger.info(f"Station {station_name}: {station_calculated} mois calculés")
        
        return {
            "status": "done",
            "stations_processed": calculated_count,
        }
