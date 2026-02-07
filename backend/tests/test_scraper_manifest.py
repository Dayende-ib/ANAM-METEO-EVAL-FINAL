from pathlib import Path

from backend.modules.pdf_scrap import ManifestStore, MeteoBurkinaScraper, ScrapeConfig


def test_manifest_store_roundtrip(tmp_path: Path):
    manifest_path = tmp_path / "scrape_manifest.json"
    store = ManifestStore(manifest_path)
    store.add(
        "http://example.com/a.pdf",
        {
            "path": str(tmp_path / "a.pdf"),
            "sha256": "abc123",
            "size": 10,
        },
    )
    store.save()

    reloaded = ManifestStore(manifest_path)
    record = reloaded.get("http://example.com/a.pdf")
    assert record is not None
    assert record["sha256"] == "abc123"


def test_scraper_pdf_detection(tmp_path: Path):
    scraper = MeteoBurkinaScraper(output_dir=str(tmp_path), config=ScrapeConfig())
    assert scraper._looks_like_pdf({"Content-Type": "application/pdf"}, b"") is True
    assert scraper._looks_like_pdf({}, b"%PDF-1.7") is True
    assert scraper._looks_like_pdf({}, b"<!DOCTYPE html>") is False
