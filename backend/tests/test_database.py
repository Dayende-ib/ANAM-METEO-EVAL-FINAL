import threading

from backend.utils.database import DatabaseManager


def test_initialize_database_creates_tables(tmp_path):
    db_path = tmp_path / "meteo.db"
    manager = DatabaseManager(db_path)
    manager.initialize_database()

    conn = manager.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in cursor.fetchall()}

    expected = {
        "stations",
        "bulletins",
        "weather_data",
        "evaluation_metrics",
        "pipeline_runs",
        "translation_cache",
        "bulletin_payloads",
        "station_snapshots",
    }
    assert expected.issubset(tables)

    cursor.execute("PRAGMA table_info(evaluation_metrics)")
    columns = {row[1] for row in cursor.fetchall()}
    assert "forecast_reference_date" in columns
    assert "weather_confusion" in columns
    assert "sample_size" in columns

    manager.close()


def test_bulletin_summaries_pagination(tmp_path):
    db_path = tmp_path / "meteo.db"
    manager = DatabaseManager(db_path)
    manager.initialize_database()

    manager.insert_bulletin("2025-01-01", "observation")
    manager.insert_bulletin("2025-01-01", "observation")
    manager.insert_bulletin("2025-01-01", "forecast")
    manager.insert_bulletin("2025-01-02", "observation")

    total = manager.count_bulletin_summaries()
    assert total == 3

    page = manager.list_bulletin_summaries(limit=2, offset=0)
    assert len(page) == 2

    remaining = manager.list_bulletin_summaries(limit=2, offset=2)
    assert len(remaining) == 1

    manager.close()


def test_pipeline_runs_pagination(tmp_path):
    db_path = tmp_path / "meteo.db"
    manager = DatabaseManager(db_path)
    manager.initialize_database()

    steps = [{"key": "scraping", "label": "Scraping", "status": "pending"}]
    for _ in range(3):
        manager.create_pipeline_run(steps)

    total = manager.count_pipeline_runs()
    assert total == 3

    page = manager.list_pipeline_runs(limit=2, offset=1)
    assert len(page) == 2


def test_thread_local_connections(tmp_path):
    db_path = tmp_path / "test.db"
    manager = DatabaseManager(db_path)
    manager.initialize_database()

    connection_ids = []

    def worker():
        conn = manager.get_connection()
        conn.execute("SELECT 1")
        connection_ids.append(id(conn))

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(connection_ids) == 2
    assert connection_ids[0] != connection_ids[1]

    manager.close()
