#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Telecharge automatiquement les bulletins quotidiens depuis Meteo Burkina."""

from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
import logging
import os
import re
import time
import unicodedata
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import unquote, urljoin

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)


@dataclass
class ScrapeConfig:
    retries: int = 3
    backoff: float = 0.5
    connect_timeout: float = 10.0
    read_timeout: float = 30.0
    max_size_mb: int = 50
    user_agent: str = "ANAM-METEO-EVAL/1.0"
    verify_ssl: bool = True


class ManifestStore:
    def __init__(self, path: Path):
        self.path = path
        self.data: Dict[str, Dict] = {"version": 1, "items": {}}
        self._load()

    def _load(self):
        if not self.path.exists():
            return
        try:
            self.data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Échec du chargement du manifeste %s: %s", self.path, exc)
            self.data = {"version": 1, "items": {}}

    def save(self):
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")

    def get(self, url: str) -> Optional[Dict]:
        return self.data.get("items", {}).get(url)

    def add(self, url: str, record: Dict):
        self.data.setdefault("items", {})[url] = record

    def find_by_hash(self, sha256: str) -> Optional[Dict]:
        for record in self.data.get("items", {}).values():
            if record.get("sha256") == sha256:
                return record
        return None


class MeteoBurkinaScraper:
    """Scraper minimal pour recuperer et archiver les PDFs journaliers."""

    MONTHS_MAP = {
        "janvier": 1,
        "fevrier": 2,
        "mars": 3,
        "avril": 4,
        "mai": 5,
        "juin": 6,
        "juillet": 7,
        "aout": 8,
        "septembre": 9,
        "octobre": 10,
        "novembre": 11,
        "decembre": 12,
    }

    def __init__(self, output_dir="bulletins_meteo", config: Optional[ScrapeConfig] = None):
        self.base_url = "https://meteoburkina.bf"
        self.bulletins_url = f"{self.base_url}/produits/bulletin-quotidien/"
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.config = config or ScrapeConfig()
        self.session = self._build_retry_session()
        self.manifest = ManifestStore(self.output_dir / "scrape_manifest.json")
        self.timeout = (self.config.connect_timeout, self.config.read_timeout)

    def _build_retry_session(self):
        retry_kwargs = {
            "total": self.config.retries,
            "connect": self.config.retries,
            "read": self.config.retries,
            "status": self.config.retries,
            "backoff_factor": self.config.backoff,
            "status_forcelist": (429, 500, 502, 503, 504),
            "raise_on_status": False,
        }
        try:
            retry = Retry(allowed_methods=("GET", "HEAD"), **retry_kwargs)
        except TypeError:
            retry = Retry(method_whitelist=("GET", "HEAD"), **retry_kwargs)
        adapter = HTTPAdapter(max_retries=retry)
        session = requests.Session()
        session.headers.update({"User-Agent": self.config.user_agent})
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        return session

    def _request(self, method: str, url: str, **kwargs):
        kwargs.setdefault("timeout", self.timeout)
        kwargs.setdefault("verify", self.config.verify_ssl)
        return self.session.request(method, url, **kwargs)

    def _build_page_url(self, page_number):
        if page_number <= 1:
            return self.bulletins_url
        separator = "&" if "?" in self.bulletins_url else "?"
        return f"{self.bulletins_url}{separator}page={page_number}"

    def _fetch_page(self, page_number=1):
        url = self._build_page_url(page_number)
        try:
            response = self._request("GET", url)
            response.raise_for_status()
        except Exception as exc:
            print(f" - Erreur lors du chargement de la page {page_number} ({url}): {exc}")
            return None
        return BeautifulSoup(response.content, "html.parser")

    def _normalize_text(self, value):
        normalized = unicodedata.normalize("NFKD", value.lower())
        return "".join(ch for ch in normalized if ch.isalnum() or ch.isspace())

    def _extract_date_from_title(self, title):
        normalized = self._normalize_text(title)
        match = re.search(r"(\d{1,2})\s+([a-z\-]+)\s+(\d{4})", normalized)
        if not match:
            return None

        day = int(match.group(1))
        month_name = match.group(2).replace("-", "")
        month = self.MONTHS_MAP.get(month_name)
        year = int(match.group(3))

        if not month:
            return None

        try:
            return datetime(year, month, day)
        except ValueError:
            return None

    def _parse_bulletins_from_soup(self, soup):
        bulletins = []
        seen_urls = set()

        for item in soup.select("div.result-list-item"):
            link = item.find("a", href=re.compile(r"/produits/bulletin-quotidien/bulletin-"))
            if not link:
                continue
            href = link.get("href")
            if not href:
                continue
            full_url = urljoin(self.base_url, href)
            if full_url in seen_urls:
                continue

            title_tag = item.find("h5") or item.find("a", class_=re.compile("result-list-item-title"))
            title = title_tag.get_text(strip=True) if title_tag else link.get_text(strip=True) or "Sans titre"
            bulletin_date = self._extract_date_from_title(title)

            bulletins.append({"url": full_url, "title": title, "date": bulletin_date})
            seen_urls.add(full_url)

        return bulletins

    def _extract_total_pages(self, soup):
        page_numbers = []
        for link in soup.select(".pagination a"):
            text = link.get_text(strip=True)
            if text.isdigit():
                try:
                    page_numbers.append(int(text))
                except ValueError:
                    continue
        return max(page_numbers) if page_numbers else 1

    def get_bulletin_list(self, use_pagination=True, max_pages=None, year=None, month=None, day=None):
        """Retourne la liste des bulletins (avec pagination et filtres eventuels)."""
        print(f"Recuperation de la liste des bulletins depuis {self.bulletins_url}")

        bulletins = []
        page_number = 1
        total_pages = None

        while True:
            soup = self._fetch_page(page_number)
            if soup is None:
                break

            page_bulletins = self._parse_bulletins_from_soup(soup)
            if not page_bulletins and page_number == 1:
                print(" - Aucun bulletin trouve sur la page initiale.")
                break

            bulletins.extend(page_bulletins)

            if not use_pagination:
                break

            if total_pages is None:
                total_pages = self._extract_total_pages(soup)

            if (max_pages and page_number >= max_pages) or page_number >= total_pages:
                break

            page_number += 1

        bulletins = self._filter_bulletins_by_date(bulletins, year=year, month=month, day=day)

        print(f" -> {len(bulletins)} bulletins trouves apres filtrage")
        return bulletins

    def _filter_bulletins_by_date(self, bulletins, year=None, month=None, day=None):
        if not any([year, month, day]):
            return bulletins

        filtered = []
        for bulletin in bulletins:
            bulletin_date = bulletin.get("date")
            if bulletin_date is None:
                continue

            if year and bulletin_date.year != year:
                continue
            if month and bulletin_date.month != month:
                continue
            if day and bulletin_date.day != day:
                continue

            filtered.append(bulletin)

        return filtered

    def extract_pdf_link(self, bulletin_url):
        """Identifie le lien PDF sur la page d'un bulletin."""
        try:
            response = self._request("GET", bulletin_url)
            response.raise_for_status()
        except Exception as exc:
            print(f"  - Impossible d'ouvrir {bulletin_url}: {exc}")
            return None

        soup = BeautifulSoup(response.content, "html.parser")

        direct_pdf = soup.find("a", href=re.compile(r"\.pdf$", re.I))
        if direct_pdf:
            return urljoin(self.base_url, direct_pdf.get("href"))

        download_btn = soup.find("a", string=re.compile(r"t.l.charger", re.I))
        if download_btn and download_btn.get("href") and ".pdf" in download_btn["href"].lower():
            return urljoin(self.base_url, download_btn["href"])

        for link in soup.find_all("a"):
            href = link.get("href", "")
            if ".pdf" in href.lower():
                return urljoin(self.base_url, href)

        return None

    def _extract_filename_from_headers(self, headers):
        content_disposition = headers.get("Content-Disposition", "")
        match = re.search(r'filename="?(?P<name>[^";]+)"?', content_disposition, flags=re.I)
        if match:
            return match.group("name")
        return None

    def _safe_filename(self, filename):
        filename = filename or ""
        filename = unquote(filename)
        filename = re.sub(r"[^\w\s.-]", "_", filename)
        filename = filename.strip().replace(" ", "_")
        if not filename.lower().endswith(".pdf"):
            filename += ".pdf"
        if not filename or filename == ".pdf":
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            return f"bulletin_{timestamp}.pdf"
        return filename

    def _unique_path(self, path: Path) -> Path:
        if not path.exists():
            return path
        base, ext = os.path.splitext(path.name)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return path.with_name(f"{base}_{timestamp}{ext}")

    def _coerce_int(self, value):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _fetch_head_metadata(self, pdf_url):
        metadata = {"etag": None, "last_modified": None, "content_length": None, "content_type": None}
        try:
            response = self._request("HEAD", pdf_url, allow_redirects=True)
        except Exception as exc:
            logger.warning("HEAD failed for %s: %s", pdf_url, exc)
            return metadata
        if response.status_code >= 400:
            return metadata
        metadata["etag"] = response.headers.get("ETag")
        metadata["last_modified"] = response.headers.get("Last-Modified")
        metadata["content_type"] = response.headers.get("Content-Type")
        metadata["content_length"] = self._coerce_int(response.headers.get("Content-Length"))
        return metadata

    def _looks_like_pdf(self, headers, first_chunk: bytes) -> bool:
        content_type = (headers.get("Content-Type") or "").lower()
        if "pdf" in content_type:
            return True
        return first_chunk.lstrip().startswith(b"%PDF")

    def _manifest_file_exists(self, record: Dict) -> bool:
        path = record.get("path")
        if not path:
            return False
        return Path(path).exists()

    def _remote_matches(self, record: Dict, metadata: Dict) -> bool:
        if metadata.get("etag") and record.get("etag"):
            return metadata["etag"] == record["etag"]
        if metadata.get("last_modified") and record.get("last_modified"):
            return metadata["last_modified"] == record["last_modified"]
        if metadata.get("content_length") and record.get("size"):
            return int(metadata["content_length"]) == int(record["size"])
        return True

    def download_pdf(self, pdf_url, filename, title=None):
        """Telecharge un bulletin et retourne un resultat detaille."""
        metadata = self._fetch_head_metadata(pdf_url)
        existing = self.manifest.get(pdf_url)
        if existing and self._manifest_file_exists(existing) and self._remote_matches(existing, metadata):
            return {
                "status": "skipped",
                "path": existing.get("path"),
                "url": pdf_url,
                "message": "Already downloaded.",
                "sha256": existing.get("sha256"),
                "size": existing.get("size"),
            }

        max_bytes = int(self.config.max_size_mb * 1024 * 1024)
        if metadata.get("content_length") and metadata["content_length"] > max_bytes:
            return {
                "status": "failed",
                "url": pdf_url,
                "message": f"File too large ({metadata['content_length']} bytes).",
            }

        try:
            response = self._request("GET", pdf_url, stream=True, allow_redirects=True)
        except Exception as exc:
            return {"status": "failed", "url": pdf_url, "message": str(exc)}

        if response.status_code >= 400:
            return {"status": "failed", "url": pdf_url, "message": f"HTTP {response.status_code}"}

        header_name = self._extract_filename_from_headers(response.headers)
        target_name = self._safe_filename(header_name or filename)
        target_path = self._unique_path(self.output_dir / target_name)
        tmp_path = target_path.with_suffix(target_path.suffix + ".part")

        sha256 = hashlib.sha256()
        size = 0
        first_chunk = b""
        try:
            with open(tmp_path, "wb") as handle:
                for chunk in response.iter_content(chunk_size=8192):
                    if not chunk:
                        continue
                    if not first_chunk:
                        first_chunk = chunk
                        if not self._looks_like_pdf(response.headers, first_chunk):
                            raise ValueError("Downloaded content is not a PDF.")
                    size += len(chunk)
                    if size > max_bytes:
                        raise ValueError("Downloaded file exceeds max size.")
                    sha256.update(chunk)
                    handle.write(chunk)
        except Exception as exc:
            if tmp_path.exists():
                tmp_path.unlink()
            return {"status": "failed", "url": pdf_url, "message": str(exc)}

        if size == 0:
            if tmp_path.exists():
                tmp_path.unlink()
            return {"status": "failed", "url": pdf_url, "message": "Empty PDF response."}

        digest = sha256.hexdigest()
        duplicate = self.manifest.find_by_hash(digest)
        if duplicate and self._manifest_file_exists(duplicate):
            if tmp_path.exists():
                tmp_path.unlink()
            return {
                "status": "skipped",
                "path": duplicate.get("path"),
                "url": pdf_url,
                "message": "Duplicate content.",
                "sha256": digest,
                "size": size,
            }

        tmp_path.replace(target_path)
        record = {
            "url": pdf_url,
            "path": str(target_path),
            "filename": target_path.name,
            "sha256": digest,
            "size": size,
            "etag": metadata.get("etag"),
            "last_modified": metadata.get("last_modified"),
            "downloaded_at": datetime.utcnow().isoformat(),
            "title": title,
        }
        self.manifest.add(pdf_url, record)
        self.manifest.save()
        return {
            "status": "success",
            "path": str(target_path),
            "url": pdf_url,
            "message": "Downloaded.",
            "sha256": digest,
            "size": size,
        }

    def extract_filename_from_url(self, pdf_url):
        """Cree un nom de fichier stable a partir de l'URL du PDF."""
        try:
            filename = pdf_url.split("/")[-1]
            return self._safe_filename(filename)
        except Exception:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            return f"bulletin_{timestamp}.pdf"

    def scrape_all(
        self,
        use_pagination=True,
        year=None,
        month=None,
        day=None,
        max_pages=None,
        max_bulletins=None,
        delay=2,
    ):
        """Orchestre la recuperation des bulletins puis leur telechargement."""
        print("=" * 70)
        print("SCRAPER BULLETINS METEO - BURKINA FASO")
        print("=" * 70)

        bulletins = self.get_bulletin_list(
            use_pagination=use_pagination,
            max_pages=max_pages,
            year=year,
            month=month,
            day=day,
        )
        if not bulletins:
            print("Aucun bulletin trouve. Verifiez la connexion ou le site.")
            return {
                "total": 0,
                "success": 0,
                "skipped": 0,
                "failed": 0,
                "downloads": [],
                "errors": [],
                "output_dir": str(self.output_dir.resolve()),
            }

        if max_bulletins:
            bulletins = bulletins[:max_bulletins]

        print(f"\nTelechargement de {len(bulletins)} bulletins")
        print("-" * 70)

        success_count = 0
        failed_count = 0
        skipped_count = 0
        downloads = []
        errors = []

        for index, bulletin in enumerate(bulletins, 1):
            print(f"\n[{index}/{len(bulletins)}] {bulletin['title']}")
            print(f"  URL: {bulletin['url']}")

            pdf_url = self.extract_pdf_link(bulletin["url"])
            if not pdf_url:
                print("  - Lien PDF introuvable.")
                failed_count += 1
                continue

            filename = self.extract_filename_from_url(pdf_url)
            target_path = self.output_dir / filename
            if target_path.exists():
                base, ext = os.path.splitext(filename)
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"{base}_{timestamp}{ext}"
                target_path = self.output_dir / filename
                print(f"  !! Fichier deja present, renomme en {filename}")

            result = self.download_pdf(pdf_url, filename, title=bulletin.get("title"))
            status = result.get("status")
            path = result.get("path")
            message = result.get("message")
            if status == "success":
                success_count += 1
                print(f"  -> Telecharge: {path}")
            elif status == "skipped":
                skipped_count += 1
                print(f"  ~~ Ignore: {message}")
            else:
                failed_count += 1
                print(f"  - Echec: {message}")
                errors.append(
                    {
                        "title": bulletin.get("title"),
                        "url": pdf_url,
                        "message": message,
                    }
                )

            downloads.append(
                {
                    "title": bulletin.get("title"),
                    "url": pdf_url,
                    "path": path,
                    "status": status,
                    "message": message,
                    "sha256": result.get("sha256"),
                    "size": result.get("size"),
                }
            )

            if index < len(bulletins):
                time.sleep(delay)

        print("\n" + "=" * 70)
        print("BILAN")
        print("=" * 70)
        print(f"Total: {len(bulletins)} bulletins")
        print(f"Succes: {success_count}")
        print(f"Ignores: {skipped_count}")
        print(f"Echecs: {failed_count}")
        print(f"Dossier: {self.output_dir.resolve()}")
        print("=" * 70)
        return {
            "total": len(bulletins),
            "success": success_count,
            "skipped": skipped_count,
            "failed": failed_count,
            "downloads": downloads,
            "errors": errors,
            "output_dir": str(self.output_dir.resolve()),
        }


def main():
    scraper = MeteoBurkinaScraper(output_dir="bulletins_meteo")
    scraper.scrape_all(max_bulletins=10, delay=1)


if __name__ == "__main__":
    main()
