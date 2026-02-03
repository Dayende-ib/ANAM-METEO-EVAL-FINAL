from backend.utils.database import DatabaseManager


def test_interpretation_cache_roundtrip(tmp_path):
    db_path = tmp_path / "test.db"
    manager = DatabaseManager(db_path)
    manager.initialize_database()

    prompt = "Redige un bulletin pour Ouagadougou."
    manager.store_interpretation_cache(prompt, "Bulletin test", "local_llm")

    cached = manager.get_interpretation_cache(prompt)
    assert cached == "Bulletin test"
