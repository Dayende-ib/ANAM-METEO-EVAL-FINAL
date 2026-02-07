#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Database manager for ANAM-METEO-EVAL system
"""

import hashlib
import json
import sqlite3
import threading
from pathlib import Path
from typing import Dict, List, Optional

class DatabaseManager:
    """Manages database operations for meteorological data"""
    
    def __init__(self, db_path):
        self.db_path = db_path
        self._local = threading.local()
        self._connections: List[sqlite3.Connection] = []
    
    def get_connection(self):
        """Get database connection, create if not exists"""
        conn = getattr(self._local, "connection", None)
        if conn is None:
            conn = sqlite3.connect(self.db_path)
            self._local.connection = conn
            self._connections.append(conn)
        return conn
    
    def initialize_database(self):
        """Initialize the database with required tables"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # Create stations table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS stations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                latitude REAL,
                longitude REAL
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS bulletins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('observation', 'forecast')),
                file_path TEXT,
                title TEXT,
                interpretation_francais TEXT,
                interpretation_moore TEXT,
                interpretation_dioula TEXT,
                processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create weather_data table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS weather_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bulletin_id INTEGER,
                station_id INTEGER,
                tmin REAL,
                tmax REAL,
                tmin_raw TEXT,
                tmax_raw TEXT,
                weather_condition TEXT,
                interpretation_francais TEXT,
                interpretation_moore TEXT,
                interpretation_dioula TEXT,
                FOREIGN KEY(bulletin_id) REFERENCES bulletins(id),
                FOREIGN KEY(station_id) REFERENCES stations(id)
            )
        ''')
        
        # Create evaluation_metrics table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS evaluation_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bulletin_date TEXT NOT NULL,
                forecast_reference_date TEXT,
                mae_tmin REAL,
                mae_tmax REAL,
                rmse_tmin REAL,
                rmse_tmax REAL,
                bias_tmin REAL,
                bias_tmax REAL,
                accuracy_weather REAL,
                precision_weather REAL,
                recall_weather REAL,
                f1_score_weather REAL,
                weather_confusion TEXT,
                sample_size INTEGER,
                calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create monthly aggregated metrics table (global aggregation)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS monthly_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                mae_tmin REAL,
                mae_tmax REAL,
                rmse_tmin REAL,
                rmse_tmax REAL,
                bias_tmin REAL,
                bias_tmax REAL,
                accuracy_weather REAL,
                precision_weather REAL,
                recall_weather REAL,
                f1_score_weather REAL,
                sample_size INTEGER,
                days_evaluated INTEGER,
                calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(year, month)
            )
        ''')
        
        # Create station monthly metrics table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS station_monthly_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                station_id INTEGER NOT NULL,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                mae_tmin REAL,
                mae_tmax REAL,
                rmse_tmin REAL,
                rmse_tmax REAL,
                bias_tmin REAL,
                bias_tmax REAL,
                accuracy_weather REAL,
                precision_weather REAL,
                recall_weather REAL,
                f1_score_weather REAL,
                sample_size INTEGER,
                days_evaluated INTEGER,
                calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(station_id, year, month),
                FOREIGN KEY(station_id) REFERENCES stations(id)
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS pipeline_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                finished_at TIMESTAMP,
                status TEXT NOT NULL DEFAULT 'running',
                steps_json TEXT,
                error_message TEXT,
                metadata TEXT,
                last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute(
            '''
            CREATE TABLE IF NOT EXISTS translation_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                language TEXT NOT NULL,
                source_hash TEXT NOT NULL,
                source_text TEXT,
                translated_text TEXT NOT NULL,
                provider TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(language, source_hash)
            )
            '''
        )

        cursor.execute(
            '''
            CREATE TABLE IF NOT EXISTS data_issues (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bulletin_id INTEGER,
                station_id INTEGER,
                bulletin_date TEXT,
                map_type TEXT,
                code TEXT,
                message TEXT,
                severity TEXT,
                status TEXT DEFAULT 'open',
                resolved_at TIMESTAMP,
                resolution_note TEXT,
                details TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(bulletin_id) REFERENCES bulletins(id),
                FOREIGN KEY(station_id) REFERENCES stations(id)
            )
            '''
        )

        cursor.execute(
            '''
            CREATE TABLE IF NOT EXISTS bulletin_payloads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pdf_path TEXT NOT NULL UNIQUE,
                payload_json TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            '''
        )

        cursor.execute(
            '''
            CREATE TABLE IF NOT EXISTS station_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pdf_path TEXT NOT NULL,
                station_name TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                type TEXT,
                tmin REAL,
                tmax REAL,
                tmin_raw TEXT,
                tmax_raw TEXT,
                weather_condition TEXT,
                confidence REAL,
                quality_score REAL,
                interpretation_francais TEXT,
                interpretation_moore TEXT,
                interpretation_dioula TEXT,
                last_bbox TEXT,
                validation_status TEXT,
                validation_errors TEXT,
                observation_json TEXT,
                prevision_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(pdf_path, station_name)
            )
            '''
        )
        cursor.execute(
            '''
            CREATE TABLE IF NOT EXISTS interpretation_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_hash TEXT NOT NULL UNIQUE,
                source_text TEXT,
                interpretation_text TEXT NOT NULL,
                provider TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            '''
        )
        cursor.execute(
            '''
            CREATE TABLE IF NOT EXISTS processing_jobs (
                id TEXT PRIMARY KEY,
                job_type TEXT NOT NULL,
                status TEXT NOT NULL,
                payload_json TEXT,
                result_json TEXT,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            '''
        )
        cursor.execute(
            '''
            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            '''
        )

        self._ensure_column(cursor, 'bulletins', 'title', 'TEXT')
        self._ensure_column(cursor, 'bulletins', 'interpretation_francais', 'TEXT')
        self._ensure_column(cursor, 'bulletins', 'interpretation_moore', 'TEXT')
        self._ensure_column(cursor, 'bulletins', 'interpretation_dioula', 'TEXT')
        self._ensure_column(cursor, 'weather_data', 'tmin_raw', 'TEXT')
        self._ensure_column(cursor, 'weather_data', 'tmax_raw', 'TEXT')
        self._ensure_column(cursor, 'evaluation_metrics', 'forecast_reference_date', 'TEXT')
        self._ensure_column(cursor, 'evaluation_metrics', 'bias_tmin', 'REAL')
        self._ensure_column(cursor, 'evaluation_metrics', 'bias_tmax', 'REAL')
        self._ensure_column(cursor, 'evaluation_metrics', 'precision_weather', 'REAL')
        self._ensure_column(cursor, 'evaluation_metrics', 'recall_weather', 'REAL')
        self._ensure_column(cursor, 'evaluation_metrics', 'weather_confusion', 'TEXT')
        self._ensure_column(cursor, 'evaluation_metrics', 'sample_size', 'INTEGER')
        self._ensure_column(cursor, 'weather_data', 'interpretation_francais', 'TEXT')
        self._ensure_column(cursor, 'weather_data', 'interpretation_moore', 'TEXT')
        self._ensure_column(cursor, 'weather_data', 'interpretation_dioula', 'TEXT')
        self._ensure_column(cursor, 'pipeline_runs', 'last_update', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
        self._ensure_column(cursor, 'pipeline_runs', 'metadata', 'TEXT')
        self._ensure_column(cursor, 'bulletin_payloads', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
        self._ensure_column(cursor, 'data_issues', 'status', "TEXT DEFAULT 'open'")
        self._ensure_column(cursor, 'data_issues', 'resolved_at', 'TIMESTAMP')
        self._ensure_column(cursor, 'data_issues', 'resolution_note', 'TEXT')
        self._ensure_column(cursor, 'station_snapshots', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
        self._ensure_column(cursor, 'station_snapshots', 'quality_score', 'REAL')
        self._ensure_column(cursor, 'interpretation_cache', 'provider', 'TEXT')
        self._ensure_column(cursor, 'processing_jobs', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
        self._ensure_column(cursor, 'app_state', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP')
        
        # Création des index pour la performance
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_bulletins_date ON bulletins(date)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_bulletins_type ON bulletins(type)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_weather_bulletin ON weather_data(bulletin_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_weather_station ON weather_data(station_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_pdf ON station_snapshots(pdf_path)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_station ON station_snapshots(station_name)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_issues_status ON data_issues(status)")
        
        conn.commit()
    
    def _ensure_column(self, cursor, table, column, definition):
        cursor.execute(f"PRAGMA table_info({table})")
        columns = [row[1] for row in cursor.fetchall()]
        if column not in columns:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def insert_station(self, name, latitude, longitude):
        """Insert a new station or get existing station ID"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR IGNORE INTO stations (name, latitude, longitude)
            VALUES (?, ?, ?)
        ''', (name, latitude, longitude))
        
        cursor.execute('SELECT id FROM stations WHERE name = ?', (name,))
        result = cursor.fetchone()
        conn.commit()
        
        return result[0] if result else None
    
    def insert_bulletin(self, date, bulletin_type, file_path=None, title=None, interpretations=None):
        """Insert a new bulletin record"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        interp_fr = interpretations.get("fr") if interpretations else None
        interp_moore = interpretations.get("moore") if interpretations else None
        interp_dioula = interpretations.get("dioula") if interpretations else None
        
        cursor.execute('''
            INSERT INTO bulletins (date, type, file_path, title, interpretation_francais, interpretation_moore, interpretation_dioula)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (date, bulletin_type, file_path, title, interp_fr, interp_moore, interp_dioula))
        
        bulletin_id = cursor.lastrowid
        conn.commit()
        
        return bulletin_id
    
    def insert_weather_data(self, bulletin_id, station_id, tmin, tmax, weather_condition, tmin_raw=None, tmax_raw=None):
        """Insert weather data for a station"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO weather_data (bulletin_id, station_id, tmin, tmax, tmin_raw, tmax_raw, weather_condition)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (bulletin_id, station_id, tmin, tmax, tmin_raw, tmax_raw, weather_condition))
        
        conn.commit()

    def create_pipeline_run(self, steps_template, metadata=None):
        """Create a pipeline run entry and return its ID."""
        conn = self.get_connection()
        cursor = conn.cursor()
        steps_json = json.dumps(steps_template, ensure_ascii=False)
        metadata_json = json.dumps(metadata or {}, ensure_ascii=False)
        cursor.execute(
            '''
            INSERT INTO pipeline_runs (status, steps_json, metadata)
            VALUES (?, ?, ?)
            ''',
            ("running", steps_json, metadata_json),
        )
        conn.commit()
        return cursor.lastrowid

    def update_pipeline_run(self, run_id, status=None, steps=None, error_message=None, metadata=None, finished=False):
        """Update pipeline run fields."""
        conn = self.get_connection()
        cursor = conn.cursor()
        fields = []
        params = []
        if status is not None:
            fields.append("status = ?")
            params.append(status)
        if steps is not None:
            fields.append("steps_json = ?")
            params.append(json.dumps(steps, ensure_ascii=False))
        if error_message is not None:
            fields.append("error_message = ?")
            params.append(error_message)
        if metadata is not None:
            fields.append("metadata = ?")
            params.append(json.dumps(metadata, ensure_ascii=False))
        if finished:
            fields.append("finished_at = CURRENT_TIMESTAMP")
        fields.append("last_update = CURRENT_TIMESTAMP")
        params.append(run_id)
        cursor.execute(
            f"UPDATE pipeline_runs SET {', '.join(fields)} WHERE id = ?",
            params,
        )
        conn.commit()

    def list_pipeline_runs(self, limit=20, offset=0):
        """Return recent pipeline runs."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            SELECT id, started_at, finished_at, status, steps_json, error_message, metadata, last_update
            FROM pipeline_runs
            ORDER BY started_at DESC
            LIMIT ? OFFSET ?
            ''',
            (limit, offset),
        )
        rows = cursor.fetchall()
        return [self._deserialize_pipeline_row(row) for row in rows]

    def count_pipeline_runs(self) -> int:
        """Return total pipeline run count."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(1) FROM pipeline_runs")
        row = cursor.fetchone()
        return int(row[0]) if row else 0

    def list_bulletin_summaries(self, limit=50, offset=0) -> List[Dict]:
        """Return aggregated bulletins with pagination."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            SELECT date, type, COUNT(*) AS pages, 
                   MAX(interpretation_francais) as interpretation_francais,
                   MAX(interpretation_moore) as interpretation_moore,
                   MAX(interpretation_dioula) as interpretation_dioula
            FROM bulletins
            GROUP BY date, type
            ORDER BY date DESC
            LIMIT ? OFFSET ?
            ''',
            (limit, offset),
        )
        rows = cursor.fetchall()
        return [
            {
                "date": row[0], 
                "type": row[1], 
                "pages": row[2],
                "interpretation_francais": row[3],
                "interpretation_moore": row[4],
                "interpretation_dioula": row[5]
            }
            for row in rows
        ]

    def count_bulletin_summaries(self) -> int:
        """Return the total number of bulletin summaries."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            SELECT COUNT(1) FROM (
                SELECT date, type
                FROM bulletins
                GROUP BY date, type
            )
            '''
        )
        row = cursor.fetchone()
        return int(row[0]) if row else 0

    def get_pipeline_run(self, run_id):
        """Fetch a single pipeline run."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            SELECT id, started_at, finished_at, status, steps_json, error_message, metadata, last_update
            FROM pipeline_runs
            WHERE id = ?
            ''',
            (run_id,),
        )
        row = cursor.fetchone()
        return self._deserialize_pipeline_row(row) if row else None

    def has_active_pipeline_run(self):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(1) FROM pipeline_runs WHERE status = 'running'")
        (count,) = cursor.fetchone()
        return count > 0

    def cleanup_invalid_metrics(self) -> int:
        """Remove metrics where forecast date is the same as observation date."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM evaluation_metrics WHERE bulletin_date = forecast_reference_date"
        )
        count = cursor.rowcount
        conn.commit()
        return count

    def _deserialize_pipeline_row(self, row):
        if not row:
            return None
        (run_id, started_at, finished_at, status, steps_json, error_message, metadata_json, last_update) = row
        steps = []
        metadata = {}
        if steps_json:
            try:
                steps = json.loads(steps_json)
            except Exception:
                steps = []
        if metadata_json:
            try:
                metadata = json.loads(metadata_json)
            except Exception:
                metadata = {}
        return {
            "id": run_id,
            "started_at": started_at,
            "finished_at": finished_at,
            "status": status,
            "steps": steps,
            "error_message": error_message,
            "metadata": metadata,
            "last_update": last_update,
        }

    def update_bulletin_interpretations(self, date, bulletin_type, interpretations):
        """Update global interpretations for a bulletin without overwriting existing ones with None."""
        if not interpretations:
            return 0
            
        conn = self.get_connection()
        cursor = conn.cursor()
        
        fields = []
        params = []
        
        if "fr" in interpretations:
            fields.append("interpretation_francais = ?")
            params.append(interpretations["fr"])
        if "moore" in interpretations:
            fields.append("interpretation_moore = ?")
            params.append(interpretations["moore"])
        if "dioula" in interpretations:
            fields.append("interpretation_dioula = ?")
            params.append(interpretations["dioula"])
            
        if not fields:
            return 0
            
        params.extend([date, bulletin_type])
        
        query = f"UPDATE bulletins SET {', '.join(fields)} WHERE date = ? AND type = ?"
        cursor.execute(query, params)
        conn.commit()
        return cursor.rowcount

    def update_station_interpretations(self, pdf_path, station_name, bulletin_type, interpretations):
        """Persist interpretations for a given station/bulletin."""
        if not station_name or not pdf_path:
            return 0
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM stations WHERE name = ?", (station_name,))
        station_row = cursor.fetchone()
        if not station_row:
            return 0
        station_id = station_row[0]
        params = [
            interpretations.get("fr"),
            interpretations.get("moore"),
            interpretations.get("dioula"),
            station_id,
            str(pdf_path),
        ]
        type_clause = ""
        if bulletin_type in {"observation", "forecast"}:
            type_clause = " AND type = ?"
            params.append(bulletin_type)
        cursor.execute(
            f"""
            UPDATE weather_data
            SET interpretation_francais = ?,
                interpretation_moore = ?,
                interpretation_dioula = ?
            WHERE station_id = ?
              AND bulletin_id IN (
                  SELECT id FROM bulletins
                  WHERE file_path = ?{type_clause}
              )
            """,
            params,
        )
        conn.commit()
        return cursor.rowcount
    
    def get_latest_observation_date(self):
        """Return the most recent observation bulletin date."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT date FROM bulletins WHERE type = 'observation' ORDER BY date DESC LIMIT 1"
        )
        row = cursor.fetchone()
        return row[0] if row else None
    
    def get_observation_forecast_pairs(self, observation_date, forecast_date):
        """Get observation and forecast pairs for evaluation."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT 
                s.name,
                obs.tmin as tmin_obs,
                obs.tmax as tmax_obs,
                obs.weather_condition as weather_obs,
                fore.tmin as tmin_fore,
                fore.tmax as tmax_fore,
                fore.weather_condition as weather_fore
            FROM stations s
            JOIN weather_data obs ON obs.station_id = s.id
            JOIN bulletins b_obs ON b_obs.id = obs.bulletin_id
            JOIN weather_data fore ON fore.station_id = s.id
            JOIN bulletins b_fore ON b_fore.id = fore.bulletin_id
            WHERE b_obs.date = ? AND b_obs.type = 'observation'
            AND b_fore.date = ? AND b_fore.type = 'forecast'
            AND obs.station_id = fore.station_id
        ''', (observation_date, forecast_date))
        
        return cursor.fetchall()
    
    def save_evaluation_metrics(self, observation_date, forecast_date, metrics):
        """Save evaluation metrics to database."""
        conn = self.get_connection()
        cursor = conn.cursor()
        confusion_json = None
        if metrics.get('confusion_matrix'):
            confusion_json = json.dumps(metrics['confusion_matrix'], ensure_ascii=False)
        cursor.execute('''
            INSERT INTO evaluation_metrics 
            (bulletin_date, forecast_reference_date, mae_tmin, mae_tmax, rmse_tmin, rmse_tmax,
             bias_tmin, bias_tmax, accuracy_weather, precision_weather, recall_weather, f1_score_weather,
             weather_confusion, sample_size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            observation_date,
            forecast_date,
            metrics.get('mae_tmin'),
            metrics.get('mae_tmax'),
            metrics.get('rmse_tmin'),
            metrics.get('rmse_tmax'),
            metrics.get('bias_tmin'),
            metrics.get('bias_tmax'),
            metrics.get('accuracy_weather'),
            metrics.get('precision_weather'),
            metrics.get('recall_weather'),
            metrics.get('f1_score_weather'),
            confusion_json,
            metrics.get('sample_size')
        ))
        
        conn.commit()
    
    def close(self):
        """Close database connection"""
        for conn in list(self._connections):
            try:
                conn.close()
            except sqlite3.Error:
                pass
        self._connections.clear()

    def create_job(self, job_id: str, job_type: str, payload: Dict) -> None:
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            INSERT INTO processing_jobs (id, job_type, status, payload_json)
            VALUES (?, ?, ?, ?)
            ''',
            (job_id, job_type, "pending", json.dumps(payload, ensure_ascii=False)),
        )
        conn.commit()

    def update_job(
        self,
        job_id: str,
        status: Optional[str] = None,
        result: Optional[Dict] = None,
        error_message: Optional[str] = None,
    ) -> None:
        conn = self.get_connection()
        cursor = conn.cursor()
        fields = []
        params = []
        if status is not None:
            fields.append("status = ?")
            params.append(status)
        if result is not None:
            fields.append("result_json = ?")
            params.append(json.dumps(result, ensure_ascii=False))
        if error_message is not None:
            fields.append("error_message = ?")
            params.append(error_message)
        fields.append("updated_at = CURRENT_TIMESTAMP")
        params.append(job_id)
        cursor.execute(
            f"UPDATE processing_jobs SET {', '.join(fields)} WHERE id = ?",
            params,
        )
        conn.commit()

    def get_job(self, job_id: str) -> Optional[Dict]:
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            SELECT id, job_type, status, payload_json, result_json, error_message, created_at, updated_at
            FROM processing_jobs
            WHERE id = ?
            ''',
            (job_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        payload = json.loads(row[3]) if row[3] else None
        result = json.loads(row[4]) if row[4] else None
        return {
            "id": row[0],
            "job_type": row[1],
            "status": row[2],
            "payload": payload,
            "result": result,
            "error_message": row[5],
            "created_at": row[6],
            "updated_at": row[7],
        }

    def get_jobs(self, job_ids: List[str]) -> List[Dict]:
        if not job_ids:
            return []
        conn = self.get_connection()
        cursor = conn.cursor()
        placeholders = ",".join("?" for _ in job_ids)
        cursor.execute(
            f'''
            SELECT id, job_type, status, payload_json, result_json, error_message, created_at, updated_at
            FROM processing_jobs
            WHERE id IN ({placeholders})
            ''',
            job_ids,
        )
        rows = cursor.fetchall()
        jobs = []
        for row in rows:
            payload = json.loads(row[3]) if row[3] else None
            result = json.loads(row[4]) if row[4] else None
            jobs.append(
                {
                    "id": row[0],
                    "job_type": row[1],
                    "status": row[2],
                    "payload": payload,
                    "result": result,
                    "error_message": row[5],
                    "created_at": row[6],
                    "updated_at": row[7],
                }
            )
        return jobs
    def get_app_state(self, key: str) -> Optional[str]:
        """Return a stored app state value."""
        if not key:
            return None
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM app_state WHERE key = ?", (key,))
        row = cursor.fetchone()
        return row[0] if row else None

    def set_app_state(self, key: str, value: str) -> None:
        """Store a key/value app state pair."""
        if not key:
            return
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            INSERT INTO app_state (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
            ''',
            (key, value),
        )
        conn.commit()

    @staticmethod
    def _normalize_path(path_value: str) -> str:
        if not path_value:
            return ""
        try:
            resolved = Path(path_value).resolve()
        except Exception:
            resolved = Path(path_value)
        return str(resolved).lower()

    def list_processed_pdf_paths(self) -> List[str]:
        """Return distinct file paths already stored with weather data."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT DISTINCT b.file_path
            FROM bulletins b
            JOIN weather_data w ON w.bulletin_id = b.id
            WHERE b.file_path IS NOT NULL AND b.file_path != ''
            """
        )
        return [row[0] for row in cursor.fetchall()]

    def has_bulletin_for_pdf(self, file_path: str) -> bool:
        """Return True if a bulletin already exists for the given PDF."""
        if not file_path:
            return False
        normalized = self._normalize_path(str(file_path))
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT 1 FROM bulletins WHERE lower(file_path) = ? LIMIT 1",
            (normalized,),
        )
        return cursor.fetchone() is not None

    def upsert_bulletin_payload(self, pdf_path: str, payload: Dict) -> None:
        """Store the full JSON payload for a bulletin."""
        if not pdf_path:
            return
        conn = self.get_connection()
        cursor = conn.cursor()
        payload_json = json.dumps(payload, ensure_ascii=False)
        cursor.execute(
            '''
            INSERT INTO bulletin_payloads (pdf_path, payload_json)
            VALUES (?, ?)
            ON CONFLICT(pdf_path)
            DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP
            ''',
            (pdf_path, payload_json),
        )
        conn.commit()

    def upsert_station_snapshot(self, pdf_path: str, station: Dict) -> None:
        """Store a flattened snapshot for a station."""
        if not pdf_path:
            return
        station_name = station.get("name")
        if not station_name:
            return
        conn = self.get_connection()
        cursor = conn.cursor()

        observation = station.get("observation") or {}
        prevision = station.get("prevision") or {}
        validation_errors = station.get("validation_errors") or []
        last_bbox = station.get("last_bbox")

        cursor.execute(
            '''
            INSERT INTO station_snapshots (
                pdf_path,
                station_name,
                latitude,
                longitude,
                type,
                tmin,
                tmax,
                tmin_raw,
                tmax_raw,
                weather_condition,
                confidence,
                quality_score,
                interpretation_francais,
                interpretation_moore,
                interpretation_dioula,
                last_bbox,
                validation_status,
                validation_errors,
                observation_json,
                prevision_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(pdf_path, station_name)
            DO UPDATE SET
                latitude = excluded.latitude,
                longitude = excluded.longitude,
                type = excluded.type,
                tmin = excluded.tmin,
                tmax = excluded.tmax,
                tmin_raw = excluded.tmin_raw,
                tmax_raw = excluded.tmax_raw,
                weather_condition = excluded.weather_condition,
                confidence = excluded.confidence,
                quality_score = excluded.quality_score,
                interpretation_francais = excluded.interpretation_francais,
                interpretation_moore = excluded.interpretation_moore,
                interpretation_dioula = excluded.interpretation_dioula,
                last_bbox = excluded.last_bbox,
                validation_status = excluded.validation_status,
                validation_errors = excluded.validation_errors,
                observation_json = excluded.observation_json,
                prevision_json = excluded.prevision_json,
                updated_at = CURRENT_TIMESTAMP
            ''',
            (
                pdf_path,
                station_name,
                station.get("latitude"),
                station.get("longitude"),
                station.get("type"),
                station.get("tmin"),
                station.get("tmax"),
                station.get("tmin_raw"),
                station.get("tmax_raw"),
                station.get("weather_condition"),
                station.get("confidence"),
                station.get("quality_score"),
                station.get("interpretation_francais"),
                station.get("interpretation_moore"),
                station.get("interpretation_dioula"),
                json.dumps(last_bbox, ensure_ascii=False) if last_bbox is not None else None,
                station.get("validation_status"),
                json.dumps(validation_errors, ensure_ascii=False) if validation_errors else None,
                json.dumps(observation, ensure_ascii=False) if observation else None,
                json.dumps(prevision, ensure_ascii=False) if prevision else None,
            ),
        )
        conn.commit()

    def get_average_quality_score(self, date: Optional[str] = None) -> Optional[float]:
        conn = self.get_connection()
        cursor = conn.cursor()
        if date:
            cursor.execute(
                '''
                SELECT AVG(ss.quality_score)
                FROM station_snapshots ss
                JOIN (
                    SELECT DISTINCT file_path
                    FROM bulletins
                    WHERE date = ?
                ) b ON lower(b.file_path) = lower(ss.pdf_path)
                WHERE ss.quality_score IS NOT NULL
                ''',
                (date,),
            )
            row = cursor.fetchone()
            return float(row[0]) if row and row[0] is not None else None
        cursor.execute(
            '''
            SELECT AVG(quality_score)
            FROM station_snapshots
            WHERE quality_score IS NOT NULL
            '''
        )
        row = cursor.fetchone()
        return float(row[0]) if row and row[0] is not None else None
        cursor.execute(
            """
            SELECT AVG(CAST(json_extract(bp.payload_json, '$.stations') AS FLOAT))
            FROM bulletin_payloads bp
            """
        )
        row = cursor.fetchone()
        return float(row[0]) if row and row[0] is not None else None

    def count_quality_scores(self, date: Optional[str] = None) -> int:
        conn = self.get_connection()
        cursor = conn.cursor()
        if date:
            cursor.execute(
                '''
                SELECT COUNT(1)
                FROM station_snapshots ss
                JOIN (
                    SELECT DISTINCT file_path
                    FROM bulletins
                    WHERE date = ?
                ) b ON lower(b.file_path) = lower(ss.pdf_path)
                WHERE ss.quality_score IS NOT NULL
                ''',
                (date,),
            )
            row = cursor.fetchone()
            return int(row[0]) if row else 0
        cursor.execute(
            '''
            SELECT COUNT(1)
            FROM station_snapshots
            WHERE quality_score IS NOT NULL
            '''
        )
        row = cursor.fetchone()
        return int(row[0]) if row else 0

    def insert_data_issue(
        self,
        bulletin_id: Optional[int],
        station_id: Optional[int],
        bulletin_date: Optional[str],
        map_type: Optional[str],
        code: Optional[str],
        message: Optional[str],
        severity: Optional[str],
        details: Optional[Dict],
    ) -> None:
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            INSERT INTO data_issues (
                bulletin_id,
                station_id,
                bulletin_date,
                map_type,
                code,
                message,
                severity,
                details
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                bulletin_id,
                station_id,
                bulletin_date,
                map_type,
                code,
                message,
                severity,
                json.dumps(details, ensure_ascii=False) if details is not None else None,
            ),
        )
        conn.commit()

    def list_data_issues(
        self,
        date: Optional[str] = None,
        station_name: Optional[str] = None,
        severity: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict]:
        conn = self.get_connection()
        cursor = conn.cursor()
        conditions = []
        params: List = []
        if date:
            conditions.append("bulletin_date = ?")
            params.append(date)
        if station_name:
            conditions.append("station_name = ?")
            params.append(station_name)
        if severity:
            conditions.append("severity = ?")
            params.append(severity)
        if status:
            conditions.append("status = ?")
            params.append(status)
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        query = f'''
            SELECT di.id, di.bulletin_date, di.map_type, di.code, di.message, di.severity,
                   di.status, di.resolved_at, di.resolution_note, di.details, di.created_at,
                   s.name as station_name
            FROM data_issues di
            LEFT JOIN stations s ON s.id = di.station_id
            {where_clause}
            ORDER BY di.created_at DESC
            LIMIT ? OFFSET ?
        '''
        params.extend([limit, offset])
        cursor.execute(query, params)
        rows = cursor.fetchall()
        results = []
        for row in rows:
            details = None
            try:
                details = json.loads(row[9]) if row[9] else None
            except Exception:
                details = None
            results.append(
                {
                    "id": row[0],
                    "bulletin_date": row[1],
                    "map_type": row[2],
                    "code": row[3],
                    "message": row[4],
                    "severity": row[5],
                    "status": row[6],
                    "resolved_at": row[7],
                    "resolution_note": row[8],
                    "details": details,
                    "created_at": row[10],
                    "station_name": row[11],
                }
            )
        return results
    def update_data_issue_status(self, issue_id: int, status: str, note: Optional[str] = None) -> None:
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            UPDATE data_issues
            SET status = ?, resolved_at = CURRENT_TIMESTAMP, resolution_note = ?
            WHERE id = ?
            ''',
            (status, note, issue_id),
        )
        conn.commit()

    def update_temperatures_for_station(
        self,
        bulletin_date: str,
        station_name: str,
        map_type: str,
        tmin: Optional[float],
        tmax: Optional[float],
    ) -> int:
        updated = 0
        updated += self._update_weather_data_temperatures(bulletin_date, station_name, map_type, tmin, tmax)
        updated += self._update_station_snapshot_temperatures(bulletin_date, station_name, map_type, tmin, tmax)
        updated += self._update_bulletin_payload_temperatures(bulletin_date, station_name, map_type, tmin, tmax)
        return updated

    def _update_weather_data_temperatures(
        self,
        bulletin_date: str,
        station_name: str,
        map_type: str,
        tmin: Optional[float],
        tmax: Optional[float],
    ) -> int:
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM stations WHERE name = ?', (station_name,))
        row = cursor.fetchone()
        if not row:
            return 0
        station_id = row[0]
        cursor.execute(
            '''
            SELECT id FROM bulletins
            WHERE date = ? AND type = ?
            ''',
            (bulletin_date, map_type),
        )
        bulletin_ids = [r[0] for r in cursor.fetchall()]
        if not bulletin_ids:
            return 0
        for bulletin_id in bulletin_ids:
            cursor.execute(
                '''
                UPDATE weather_data
                SET tmin = ?, tmax = ?
                WHERE bulletin_id = ? AND station_id = ?
                ''',
                (tmin, tmax, bulletin_id, station_id),
            )
        conn.commit()
        return len(bulletin_ids)

    def _update_station_snapshot_temperatures(
        self,
        bulletin_date: str,
        station_name: str,
        map_type: str,
        tmin: Optional[float],
        tmax: Optional[float],
    ) -> int:
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            SELECT file_path FROM bulletins
            WHERE date = ? AND type = ?
            ''',
            (bulletin_date, map_type),
        )
        paths = [row[0] for row in cursor.fetchall() if row[0]]
        if not paths:
            return 0
        count = 0
        for pdf_path in paths:
            cursor.execute(
                '''
                UPDATE station_snapshots
                SET tmin = ?, tmax = ?, quality_score = 1.0, updated_at = CURRENT_TIMESTAMP
                WHERE lower(pdf_path) = lower(?) AND station_name = ?
                ''',
                (tmin, tmax, pdf_path, station_name),
            )
            count += cursor.rowcount
        conn.commit()
        return count

    def _update_bulletin_payload_temperatures(
        self,
        bulletin_date: str,
        station_name: str,
        map_type: str,
        tmin: Optional[float],
        tmax: Optional[float],
    ) -> int:
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            SELECT bp.pdf_path, bp.payload_json
            FROM bulletin_payloads bp
            JOIN bulletins b ON lower(b.file_path) = lower(bp.pdf_path)
            WHERE b.date = ? AND b.type = ?
            ''',
            (bulletin_date, map_type),
        )
        rows = cursor.fetchall()
        updated = 0
        for pdf_path, payload_json in rows:
            if not payload_json:
                continue
            try:
                payload = json.loads(payload_json)
            except Exception:
                continue
            if not isinstance(payload, dict):
                continue
            stations = payload.get('stations', [])
            changed = False
            for station in stations:
                if station.get('name') != station_name:
                    continue
                target_key = 'prevision' if map_type == 'forecast' else 'observation'
                target = station.get(target_key) or {}
                target['tmin'] = tmin
                target['tmax'] = tmax
                station[target_key] = target
                if station.get('type') in {'prevision', 'forecast'} and map_type == 'forecast':
                    station['tmin'] = tmin
                    station['tmax'] = tmax
                if station.get('type') == 'observation' and map_type == 'observation':
                    station['tmin'] = tmin
                    station['tmax'] = tmax
                station['quality_score'] = 1.0
                changed = True
            if changed:
                payload_json = json.dumps(payload, ensure_ascii=False)
                cursor.execute(
                    '''
                    UPDATE bulletin_payloads
                    SET payload_json = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE pdf_path = ?
                    ''',
                    (payload_json, pdf_path),
                )
                updated += 1
        conn.commit()
        return updated


    def count_data_issues(
        self,
        date: Optional[str] = None,
        station_name: Optional[str] = None,
        severity: Optional[str] = None,
        status: Optional[str] = None,
    ) -> int:
        conn = self.get_connection()
        cursor = conn.cursor()
        conditions = []
        params: List = []
        if date:
            conditions.append("bulletin_date = ?")
            params.append(date)
        if station_name:
            conditions.append("station_name = ?")
            params.append(station_name)
        if severity:
            conditions.append("severity = ?")
            params.append(severity)
        if status:
            conditions.append("status = ?")
            params.append(status)
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        query = f'''
            SELECT COUNT(1)
            FROM data_issues di
            LEFT JOIN stations s ON s.id = di.station_id
            {where_clause}
        '''
        cursor.execute(query, params)
        row = cursor.fetchone()
        return int(row[0]) if row else 0

    def list_bulletin_payloads_by_date(self, bulletin_date: str) -> List[Dict]:
        """Return bulletin payloads matched by date from stored PDFs."""
        if not bulletin_date:
            return []
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT bp.payload_json
            FROM bulletin_payloads bp
            JOIN bulletins b ON lower(b.file_path) = lower(bp.pdf_path)
            WHERE b.date = ?
            ORDER BY b.processed_at DESC
            """,
            (bulletin_date,),
        )
        rows = cursor.fetchall()
        payloads: List[Dict] = []
        for (payload_json,) in rows:
            if not payload_json:
                continue
            try:
                payload = json.loads(payload_json)
            except Exception:
                continue
            if isinstance(payload, dict):
                payloads.append(payload)
        return payloads

    @staticmethod
    def _hash_text(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def get_translation_cache(self, language: str, source_text: str) -> Optional[str]:
        if not source_text:
            return None
        conn = self.get_connection()
        cursor = conn.cursor()
        source_hash = self._hash_text(source_text)
        cursor.execute(
            '''
            SELECT translated_text
            FROM translation_cache
            WHERE language = ? AND source_hash = ?
            ''',
            (language, source_hash),
        )
        row = cursor.fetchone()
        return row[0] if row else None

    def get_interpretation_cache(self, source_text: str) -> Optional[str]:
        if not source_text:
            return None
        conn = self.get_connection()
        cursor = conn.cursor()
        source_hash = self._hash_text(source_text)
        cursor.execute(
            '''
            SELECT interpretation_text
            FROM interpretation_cache
            WHERE source_hash = ?
            ''',
            (source_hash,),
        )
        row = cursor.fetchone()
        return row[0] if row else None

    def list_bulletin_dates(self, bulletin_type: str) -> List[str]:
        """Return distinct bulletin dates for a given type."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT DISTINCT date
            FROM bulletins
            WHERE type = ?
            ORDER BY date ASC
            """,
            (bulletin_type,),
        )
        return [row[0] for row in cursor.fetchall()]

    def has_evaluation(self, bulletin_date: str, forecast_reference_date: str) -> bool:
        """Return True if an evaluation already exists for the given pair."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT 1
            FROM evaluation_metrics
            WHERE bulletin_date = ? AND forecast_reference_date = ?
            LIMIT 1
            """,
            (bulletin_date, forecast_reference_date),
        )
        return cursor.fetchone() is not None

    def get_monthly_metrics(self, year: int, month: int) -> Optional[Dict]:
        """Récupère les métriques mensuelles agrégées."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT year, month, mae_tmin, mae_tmax, rmse_tmin, rmse_tmax,
                   bias_tmin, bias_tmax, accuracy_weather, precision_weather,
                   recall_weather, f1_score_weather, sample_size, days_evaluated,
                   calculated_at
            FROM monthly_metrics
            WHERE year = ? AND month = ?
            """,
            (year, month),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "year": row[0],
            "month": row[1],
            "mae_tmin": row[2],
            "mae_tmax": row[3],
            "rmse_tmin": row[4],
            "rmse_tmax": row[5],
            "bias_tmin": row[6],
            "bias_tmax": row[7],
            "accuracy_weather": row[8],
            "precision_weather": row[9],
            "recall_weather": row[10],
            "f1_score_weather": row[11],
            "sample_size": row[12],
            "days_evaluated": row[13],
            "calculated_at": row[14],
        }

    def save_monthly_metrics(self, year: int, month: int, metrics: Dict) -> None:
        """Sauvegarde les métriques mensuelles agrégées."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO monthly_metrics 
            (year, month, mae_tmin, mae_tmax, rmse_tmin, rmse_tmax,
             bias_tmin, bias_tmax, accuracy_weather, precision_weather, recall_weather,
             f1_score_weather, sample_size, days_evaluated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(year, month) DO UPDATE SET
                mae_tmin = excluded.mae_tmin,
                mae_tmax = excluded.mae_tmax,
                rmse_tmin = excluded.rmse_tmin,
                rmse_tmax = excluded.rmse_tmax,
                bias_tmin = excluded.bias_tmin,
                bias_tmax = excluded.bias_tmax,
                accuracy_weather = excluded.accuracy_weather,
                precision_weather = excluded.precision_weather,
                recall_weather = excluded.recall_weather,
                f1_score_weather = excluded.f1_score_weather,
                sample_size = excluded.sample_size,
                days_evaluated = excluded.days_evaluated,
                calculated_at = CURRENT_TIMESTAMP
            """,
            (
                year,
                month,
                metrics.get("mae_tmin"),
                metrics.get("mae_tmax"),
                metrics.get("rmse_tmin"),
                metrics.get("rmse_tmax"),
                metrics.get("bias_tmin"),
                metrics.get("bias_tmax"),
                metrics.get("accuracy_weather"),
                metrics.get("precision_weather"),
                metrics.get("recall_weather"),
                metrics.get("f1_score_weather"),
                metrics.get("sample_size"),
                metrics.get("days_evaluated"),
            ),
        )
        conn.commit()

    def list_monthly_metrics(self, limit: int = 12) -> List[Dict]:
        """Liste les métriques mensuelles récentes."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT year, month, mae_tmin, mae_tmax, rmse_tmin, rmse_tmax,
                   bias_tmin, bias_tmax, accuracy_weather, precision_weather,
                   recall_weather, f1_score_weather, sample_size, days_evaluated,
                   calculated_at
            FROM monthly_metrics
            ORDER BY year DESC, month DESC
            LIMIT ?
            """,
            (limit,),
        )
        results = []
        for row in cursor.fetchall():
            results.append(
                {
                    "year": row[0],
                    "month": row[1],
                    "mae_tmin": row[2],
                    "mae_tmax": row[3],
                    "rmse_tmin": row[4],
                    "rmse_tmax": row[5],
                    "bias_tmin": row[6],
                    "bias_tmax": row[7],
                    "accuracy_weather": row[8],
                    "precision_weather": row[9],
                    "recall_weather": row[10],
                    "f1_score_weather": row[11],
                    "sample_size": row[12],
                    "days_evaluated": row[13],
                    "calculated_at": row[14],
                }
            )
        return results

    def store_translation_cache(
        self,
        language: str,
        source_text: str,
        translated_text: str,
        provider: Optional[str] = None,
    ) -> None:
        if not source_text or not translated_text:
            return
        conn = self.get_connection()
        cursor = conn.cursor()
        source_hash = self._hash_text(source_text)
        cursor.execute(
            '''
            INSERT INTO translation_cache (language, source_hash, source_text, translated_text, provider)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(language, source_hash)
            DO UPDATE SET translated_text = excluded.translated_text, provider = excluded.provider
            ''',
            (language, source_hash, source_text, translated_text, provider),
        )
        conn.commit()

    def store_interpretation_cache(
        self,
        source_text: str,
        interpretation_text: str,
        provider: Optional[str] = None,
    ) -> None:
        if not source_text or not interpretation_text:
            return
        conn = self.get_connection()
        cursor = conn.cursor()
        source_hash = self._hash_text(source_text)
        cursor.execute(
            '''
            INSERT INTO interpretation_cache (source_hash, source_text, interpretation_text, provider)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(source_hash)
            DO UPDATE SET interpretation_text = excluded.interpretation_text, provider = excluded.provider
            ''',
            (source_hash, source_text, interpretation_text, provider),
        )
        conn.commit()

    # Station Monthly Metrics Methods
    
    def save_station_monthly_metrics(self, station_id: int, year: int, month: int, metrics: Dict) -> None:
        """Sauvegarde les métriques mensuelles pour une station."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO station_monthly_metrics 
            (station_id, year, month, mae_tmin, mae_tmax, rmse_tmin, rmse_tmax,
             bias_tmin, bias_tmax, accuracy_weather, precision_weather, recall_weather,
             f1_score_weather, sample_size, days_evaluated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(station_id, year, month) DO UPDATE SET
                mae_tmin = excluded.mae_tmin,
                mae_tmax = excluded.mae_tmax,
                rmse_tmin = excluded.rmse_tmin,
                rmse_tmax = excluded.rmse_tmax,
                bias_tmin = excluded.bias_tmin,
                bias_tmax = excluded.bias_tmax,
                accuracy_weather = excluded.accuracy_weather,
                precision_weather = excluded.precision_weather,
                recall_weather = excluded.recall_weather,
                f1_score_weather = excluded.f1_score_weather,
                sample_size = excluded.sample_size,
                days_evaluated = excluded.days_evaluated,
                calculated_at = CURRENT_TIMESTAMP
            """,
            (
                station_id,
                year,
                month,
                metrics.get("mae_tmin"),
                metrics.get("mae_tmax"),
                metrics.get("rmse_tmin"),
                metrics.get("rmse_tmax"),
                metrics.get("bias_tmin"),
                metrics.get("bias_tmax"),
                metrics.get("accuracy_weather"),
                metrics.get("precision_weather"),
                metrics.get("recall_weather"),
                metrics.get("f1_score_weather"),
                metrics.get("sample_size"),
                metrics.get("days_evaluated"),
            ),
        )
        conn.commit()
    
    def get_station_monthly_metrics(self, station_id: int, year: int, month: int) -> Optional[Dict]:
        """Récupère les métriques mensuelles pour une station."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT s.name, sm.year, sm.month, sm.mae_tmin, sm.mae_tmax, sm.rmse_tmin, sm.rmse_tmax,
                   sm.bias_tmin, sm.bias_tmax, sm.accuracy_weather, sm.precision_weather,
                   sm.recall_weather, sm.f1_score_weather, sm.sample_size, sm.days_evaluated,
                   sm.calculated_at
            FROM station_monthly_metrics sm
            JOIN stations s ON sm.station_id = s.id
            WHERE sm.station_id = ? AND sm.year = ? AND sm.month = ?
            """,
            (station_id, year, month),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "station_name": row[0],
            "year": row[1],
            "month": row[2],
            "mae_tmin": row[3],
            "mae_tmax": row[4],
            "rmse_tmin": row[5],
            "rmse_tmax": row[6],
            "bias_tmin": row[7],
            "bias_tmax": row[8],
            "accuracy_weather": row[9],
            "precision_weather": row[10],
            "recall_weather": row[11],
            "f1_score_weather": row[12],
            "sample_size": row[13],
            "days_evaluated": row[14],
            "calculated_at": row[15],
        }
    
    def list_station_monthly_metrics(self, station_id: int, limit: int = 12) -> List[Dict]:
        """Liste les métriques mensuelles récentes pour une station."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT s.name, sm.year, sm.month, sm.mae_tmin, sm.mae_tmax, sm.rmse_tmin, sm.rmse_tmax,
                   sm.bias_tmin, sm.bias_tmax, sm.accuracy_weather, sm.precision_weather,
                   sm.recall_weather, sm.f1_score_weather, sm.sample_size, sm.days_evaluated,
                   sm.calculated_at
            FROM station_monthly_metrics sm
            JOIN stations s ON sm.station_id = s.id
            WHERE sm.station_id = ?
            ORDER BY sm.year DESC, sm.month DESC
            LIMIT ?
            """,
            (station_id, limit),
        )
        results = []
        for row in cursor.fetchall():
            results.append({
                "station_name": row[0],
                "year": row[1],
                "month": row[2],
                "mae_tmin": row[3],
                "mae_tmax": row[4],
                "rmse_tmin": row[5],
                "rmse_tmax": row[6],
                "bias_tmin": row[7],
                "bias_tmax": row[8],
                "accuracy_weather": row[9],
                "precision_weather": row[10],
                "recall_weather": row[11],
                "f1_score_weather": row[12],
                "sample_size": row[13],
                "days_evaluated": row[14],
                "calculated_at": row[15],
            })
        return results
    
    def list_all_stations_with_metrics(self) -> List[Dict]:
        """Liste toutes les stations avec leurs dernières métriques."""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT DISTINCT s.id, s.name,
                   (SELECT COUNT(*) FROM station_monthly_metrics sm WHERE sm.station_id = s.id) as metrics_count,
                   (SELECT MAX(sm.calculated_at) FROM station_monthly_metrics sm WHERE sm.station_id = s.id) as last_calculated
            FROM stations s
            WHERE EXISTS (SELECT 1 FROM station_monthly_metrics sm WHERE sm.station_id = s.id)
            ORDER BY s.name
            """
        )
        results = []
        for row in cursor.fetchall():
            results.append({
                "id": row[0],
                "name": row[1],
                "metrics_count": row[2],
                "last_calculated": row[3],
            })
        return results
