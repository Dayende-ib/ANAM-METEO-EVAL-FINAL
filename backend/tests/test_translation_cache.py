from backend.utils.database import DatabaseManager


def test_translation_cache_roundtrip(tmp_path):
    db_path = tmp_path / "meteo.db"
    manager = DatabaseManager(db_path)
    manager.initialize_database()

    manager.store_translation_cache("moore", "Bonjour", "Wend na", "local_nllb")
    cached = manager.get_translation_cache("moore", "Bonjour")
    assert cached == "Wend na"

    manager.close()
