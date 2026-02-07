import json

from backend.utils.database import DatabaseManager


def test_payload_and_snapshot_persistence(tmp_path):
    db_path = tmp_path / "meteo.db"
    manager = DatabaseManager(db_path)
    manager.initialize_database()

    payload = {
        "pdf_path": "sample.pdf",
        "stations": [{"name": "Ouaga"}],
    }
    manager.upsert_bulletin_payload("sample.pdf", payload)

    station = {
        "name": "Ouaga",
        "latitude": 12.3,
        "longitude": -1.5,
        "type": "observation",
        "tmin": 20.0,
        "tmax": 35.0,
        "tmin_raw": "20",
        "tmax_raw": "35",
        "weather_condition": "sunny",
        "confidence": 0.9,
        "interpretation_francais": "Test FR",
        "interpretation_moore": "Test Moore",
        "interpretation_dioula": "Test Dioula",
        "last_bbox": [1, 2, 3, 4],
        "validation_status": "ok",
        "validation_errors": [],
        "observation": {"tmin": 20.0, "tmax": 35.0, "bbox": [1, 2, 3, 4]},
        "prevision": {"tmin": 21.0, "tmax": 36.0},
    }
    manager.upsert_station_snapshot("sample.pdf", station)

    conn = manager.get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT payload_json FROM bulletin_payloads WHERE pdf_path = ?",
        ("sample.pdf",),
    )
    stored_payload = json.loads(cursor.fetchone()[0])
    assert stored_payload["pdf_path"] == "sample.pdf"

    cursor.execute(
        """
        SELECT station_name, observation_json, prevision_json
        FROM station_snapshots
        WHERE pdf_path = ?
        """,
        ("sample.pdf",),
    )
    row = cursor.fetchone()
    assert row[0] == "Ouaga"
    observation = json.loads(row[1])
    prevision = json.loads(row[2])
    assert observation["tmin"] == 20.0
    assert prevision["tmax"] == 36.0

    manager.close()
