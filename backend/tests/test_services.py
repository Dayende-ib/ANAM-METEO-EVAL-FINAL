from backend.services.container import ServiceContainer
from backend.utils.config import Config
from backend.utils.database import DatabaseManager


def _make_services(tmp_path):
    db_path = tmp_path / "meteo.db"
    db_manager = DatabaseManager(db_path)
    db_manager.initialize_database()
    config = Config()
    return db_manager, ServiceContainer(db_manager, config)


def test_bulletin_services(tmp_path):
    db_manager, services = _make_services(tmp_path)
    db_manager.insert_bulletin("2025-01-01", "observation")
    db_manager.insert_bulletin("2025-01-01", "forecast")

    items = services.bulletins.list_summaries(limit=10, offset=0)
    total = services.bulletins.count_summaries()

    assert total == 2
    assert len(items) == 2


def test_jobs_services(tmp_path):
    _, services = _make_services(tmp_path)
    job_id = "job-1"
    services.jobs.create(job_id, "upload_bulletin", {"filename": "demo.pdf"})
    services.jobs.update(job_id, status="success", result={"ok": True})

    job = services.jobs.get(job_id)
    assert job is not None
    assert job["status"] == "success"
    assert job["result"]["ok"] is True


def test_pipeline_services(tmp_path):
    _, services = _make_services(tmp_path)
    steps = [{"key": "scraping", "label": "Scraping", "status": "pending"}]
    run_id = services.pipeline.create_run(steps)

    run = services.pipeline.get_run(run_id)
    assert run is not None
    assert run["status"] == "running"

    services.pipeline.update_run(run_id, status="success", finished=True)
    runs = services.pipeline.list_runs(limit=10)
    assert len(runs) == 1
    assert runs[0]["status"] == "success"


def test_metrics_services(tmp_path):
    db_manager, services = _make_services(tmp_path)
    metrics = {
        "mae_tmin": 1.0,
        "mae_tmax": 2.0,
        "rmse_tmin": 1.5,
        "rmse_tmax": 2.5,
        "bias_tmin": 0.1,
        "bias_tmax": -0.2,
        "accuracy_weather": 0.9,
        "precision_weather": 0.8,
        "recall_weather": 0.7,
        "f1_score_weather": 0.75,
        "confusion_matrix": {"sun": {"sun": 1}},
        "sample_size": 1,
    }
    db_manager.save_evaluation_metrics("2025-01-01", "2025-01-02", metrics)

    payload = services.metrics.get_evaluation_metrics("2025-01-01")
    assert payload is not None
    assert payload["forecast_reference_date"] == "2025-01-02"
    assert payload["confusion_matrix"]["sun"]["sun"] == 1


def test_validation_services(tmp_path):
    db_manager, services = _make_services(tmp_path)
    db_manager.insert_data_issue(
        bulletin_id=None,
        station_id=None,
        bulletin_date="2025-01-01",
        map_type="forecast",
        code="missing-temp",
        message="Temp missing",
        severity="high",
        details={"field": "tmin"},
    )

    items = services.validation.list_data_issues(limit=10, offset=0)
    assert len(items) == 1
    issue_id = items[0]["id"]
    services.validation.update_data_issue_status(issue_id, "ignored", "not relevant")
    updated = services.validation.list_data_issues(limit=10, offset=0)
    assert updated[0]["status"] == "ignored"


def test_app_state_services(tmp_path):
    _, services = _make_services(tmp_path)
    services.app_state.set("key1", "value1")
    assert services.app_state.get("key1") == "value1"
