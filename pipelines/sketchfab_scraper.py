#!/usr/bin/env python3
"""
Sketchfab GLB Asset Scraper for Racing Game

Searches Sketchfab API for free/CC0 downloadable car models, downloads GLB files,
and stores metadata + attribution in SQLite.

Usage:
    SKETCHFAB_API_KEY=xxx python sketchfab_scraper.py --dry-run
    SKETCHFAB_API_KEY=xxx ASSET_DIR=./assets python sketchfab_scraper.py
    SKETCHFAB_API_KEY=xxx python sketchfab_scraper.py --query "jdm sports car" --limit 50

Environment:
    SKETCHFAB_API_KEY  - Optional. Required for downloads. Get from https://sketchfab.com/settings/oauth
                         Search/browse works without a key.
    ASSET_DIR          - Directory for GLB downloads (default: ./assets/glb)
    DB_PATH            - SQLite database path (default: ./data/game_assets.db)
"""

import argparse
import hashlib
import json
import logging
import os
import sqlite3
import sys
import time
from pathlib import Path

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

SKETCHFAB_API = "https://api.sketchfab.com/v3/"
DEFAULT_ASSET_DIR = Path("./assets/glb")
DEFAULT_DB_PATH = Path("./data/game_assets.db")

# Rate limiting
MIN_REQUEST_INTERVAL = 0.5  # seconds between API calls
MAX_RETRIES = 3
RETRY_BACKOFF = 2  # exponential backoff base


class SketchfabClient:
    """Thin wrapper around the Sketchfab REST API."""

    def __init__(self, api_key: str | None = None):
        self.session = requests.Session()
        self.api_key = api_key
        if api_key:
            self.session.headers["Authorization"] = f"Token {api_key}"
        self.last_request_time = 0.0

    def _rate_limit(self):
        elapsed = time.monotonic() - self.last_request_time
        if elapsed < MIN_REQUEST_INTERVAL:
            time.sleep(MIN_REQUEST_INTERVAL - elapsed)
        self.last_request_time = time.monotonic()

    def _request(self, method: str, path: str, **kwargs) -> dict:
        url = f"{SKETCHFAB_API.rstrip('/')}{path}"
        for attempt in range(MAX_RETRIES):
            self._rate_limit()
            try:
                resp = self.session.request(method, url, timeout=30, **kwargs)
                resp.raise_for_status()
                text = resp.text
                if not text.strip():
                    raise requests.exceptions.HTTPError("Empty response")
                return resp.json()
            except requests.exceptions.HTTPError as e:
                if resp.status_code == 429:
                    wait = RETRY_BACKOFF ** (attempt + 1)
                    log.warning("Rate limited, waiting %ds", wait)
                    time.sleep(wait)
                    continue
                if resp.status_code >= 500 and attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_BACKOFF ** attempt)
                    continue
                raise
            except requests.exceptions.ConnectionError:
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_BACKOFF ** attempt)
                    continue
                raise
        raise RuntimeError(f"Failed after {MAX_RETRIES} retries: {method} {path}")

    def search_models(
        self,
        query: str = "car",
        downloadable: bool = True,
        license_filter: str = "",
        sort_by: str = "-likeCount",
        count: int = 24,
        cursor: str | None = None,
        categories: str = "",
    ) -> dict:
        """Search for models. Returns paginated results."""
        params = {
            "type": "models",
            "q": query,
            "downloadable": str(downloadable).lower(),
            "sort_by": sort_by,
            "count": count,
        }
        if license_filter:
            params["license"] = license_filter
        if cursor:
            params["cursor"] = cursor
        if categories:
            params["categories"] = categories
        return self._request("GET", "/search", params=params)

    def get_model(self, uid: str) -> dict:
        """Get full model details including download options."""
        return self._request("GET", f"/models/{uid}")

    def get_download_link(self, uid: str) -> dict | None:
        """Get the download link for a model. Returns None if not downloadable.

        Requires SKETCHFAB_API_KEY. Returns None if no key configured.
        """
        if not self.api_key:
            log.warning("No SKETCHFAB_API_KEY set — cannot download model %s", uid)
            return None
        try:
            result = self._request(
                "POST", f"/models/{uid}/download"
            )
            return result
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 403:
                log.warning("Model %s: download not authorized", uid)
                return None
            raise


class AssetDB:
    """SQLite asset database manager."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self._init_schema()

    def _init_schema(self):
        schema_path = Path(__file__).parent / "schema.sql"
        with open(schema_path) as f:
            self.conn.executescript(f.read())
        self.conn.commit()

    def asset_exists(self, source_url: str) -> bool:
        row = self.conn.execute(
            "SELECT 1 FROM assets WHERE source_url = ?", (source_url,)
        ).fetchone()
        return row is not None

    def insert_asset(
        self,
        filepath: str,
        sha256_hash: str,
        source_url: str,
        source_type: str = "sketchfab",
        license_info: str | None = None,
        attribution: str | None = None,
        original_name: str = "",
        status: str = "pending",
        metadata_json: str | None = None,
    ) -> int:
        cursor = self.conn.execute(
            """INSERT OR IGNORE INTO assets
               (filepath, sha256_hash, source_url, source_type, license, attribution,
                original_name, status, metadata_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                filepath, sha256_hash, source_url, source_type,
                license_info, attribution, original_name, status, metadata_json,
            ),
        )
        self.conn.commit()
        return cursor.lastrowid

    def update_asset_status(self, asset_id: int, status: str, filepath: str | None = None):
        if filepath:
            self.conn.execute(
                "UPDATE assets SET status = ?, filepath = ? WHERE id = ?",
                (status, filepath, asset_id),
            )
        else:
            self.conn.execute(
                "UPDATE assets SET status = ? WHERE id = ?",
                (status, asset_id),
            )
        self.conn.commit()

    def close(self):
        self.conn.close()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def build_attribution(model_data: dict) -> str:
    """Build attribution string from model data."""
    author = model_data.get("user", {}).get("displayName", "Unknown")
    name = model_data.get("name", "Unnamed")
    license_info = model_data.get("license", {})
    license_label = license_info.get("label", "Unknown license")
    license_url = license_info.get("url", "")
    uid = model_data.get("uid", "")
    url = f"https://sketchfab.com/3d-models/{uid}" if uid else ""
    return f'"{name}" by {author}, licensed under {license_label}. {url} {license_url}'


def extract_glb_download_url(download_response: dict) -> str | None:
    """Extract GLB download URL from download API response."""
    # download_response typically has {"uri": "...", "gltf": [...], "files": [...]}
    # Look for GLB in files list
    files = download_response.get("files", [])
    for f in files:
        if isinstance(f, dict) and f.get("format", "").lower() in ("glb",):
            return f.get("url") or f.get("downloadUrl")
        if isinstance(f, dict) and f.get("filename", "").endswith(".glb"):
            return f.get("url") or f.get("downloadUrl")
    # Fallback: check for gltf list
    gltf_list = download_response.get("gltf", [])
    for g in gltf_list:
        if isinstance(g, dict) and g.get("format", "").lower() in ("glb",):
            return g.get("url") or g.get("downloadUrl")
    # Last resort: use the main URI if present
    uri = download_response.get("uri")
    if uri:
        return uri
    return None


def download_file(url: str, dest: Path, client: requests.Session) -> Path:
    """Download a file with streaming and progress."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    try:
        with client.get(url, stream=True, timeout=120) as r:
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0))
            downloaded = 0
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
                    downloaded += len(chunk)
            tmp.rename(dest)
            log.info("Downloaded %s (%.1f MB)", dest.name, downloaded / 1048576)
            return dest
    except Exception:
        if tmp.exists():
            tmp.unlink()
        raise


def search_and_collect(
    client: SketchfabClient,
    db: AssetDB,
    asset_dir: Path,
    query: str,
    max_results: int,
    dry_run: bool = False,
    license_filter: str = "",
    categories: str = "",
) -> list[dict]:
    """Search Sketchfab, collect results, optionally download."""
    collected = []
    cursor = None
    seen = 0

    while seen < max_results:
        count = min(24, max_results - seen)
        data = client.search_models(
            query=query, count=count, cursor=cursor,
            license_filter=license_filter,
            categories=categories,
        )

        results = data.get("results", [])
        if not results:
            break

        for model in results:
            if seen >= max_results:
                break
            seen += 1

            uid = model.get("uid", "")
            name = model.get("name", "unnamed")
            source_url = f"https://sketchfab.com/3d-models/{uid}"
            viewer_url = model.get("viewerUrl", source_url)

            if not model.get("isDownloadable"):
                log.debug("Skipping %s (not downloadable)", name)
                continue

            if db.asset_exists(viewer_url):
                log.debug("Skipping %s (already in DB)", name)
                collected.append({"uid": uid, "name": name, "status": "exists"})
                continue

            # Get full model details for license info
            log.info("[%d/%d] %s", seen, max_results, name)
            detail = client.get_model(uid)
            license_info = detail.get("license", {})
            license_label = license_info.get("label", "")
            license_slug = license_info.get("slug", "")

            # Sketchfab uses short slugs: by, by-sa, by-nd, by-nc, by-nc-sa, by-nc-nd, cc0
            ACCEPTED_SLUGS = (
                "cc0", "by", "by-sa", "by-nd", "by-nc", "by-nc-sa", "by-nc-nd",
            )
            if license_slug and license_slug not in ACCEPTED_SLUGS:
                log.info("  Skipping: license=%s (%s)", license_label, license_slug)
                continue

            attribution = build_attribution(detail)
            safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)
            filepath = str(asset_dir / f"{uid}_{safe_name}.glb")

            metadata = json.dumps({
                "uid": uid,
                "name": name,
                "author": detail.get("user", {}).get("displayName", ""),
                "author_url": detail.get("user", {}).get("profileUrl", ""),
                "view_count": model.get("viewCount", 0),
                "like_count": model.get("likeCount", 0),
                "face_count": detail.get("faceCount", 0),
                "vertex_count": detail.get("vertexCount", 0),
                "tags": [t.get("name", "") for t in model.get("tags", [])],
            }, ensure_ascii=False)

            if dry_run:
                log.info("  [DRY-RUN] Would download: %s", filepath)
                log.info("  License: %s", license_label)
                log.info("  Attribution: %s", attribution)
                db.insert_asset(
                    filepath=filepath,
                    sha256_hash="",
                    source_url=viewer_url,
                    license_info=license_label,
                    attribution=attribution,
                    original_name=name,
                    status="pending",
                    metadata_json=metadata,
                )
                collected.append({"uid": uid, "name": name, "status": "dry-run"})
                continue

            # Get download link
            dl = client.get_download_link(uid)
            if not dl:
                log.warning("  No download link available")
                db.insert_asset(
                    filepath=filepath,
                    sha256_hash="",
                    source_url=viewer_url,
                    license_info=license_label,
                    attribution=attribution,
                    original_name=name,
                    status="failed",
                    metadata_json=metadata,
                )
                collected.append({"uid": uid, "name": name, "status": "no-download"})
                continue

            glb_url = extract_glb_download_url(dl)
            if not glb_url:
                log.warning("  No GLB format in download options")
                db.insert_asset(
                    filepath=filepath,
                    sha256_hash="",
                    source_url=viewer_url,
                    license_info=license_label,
                    attribution=attribution,
                    original_name=name,
                    status="failed",
                    metadata_json=metadata,
                )
                collected.append({"uid": uid, "name": name, "status": "no-glb"})
                continue

            try:
                path = download_file(glb_url, Path(filepath), client.session)
                file_hash = sha256_file(path)
                db.insert_asset(
                    filepath=filepath,
                    sha256_hash=file_hash,
                    source_url=viewer_url,
                    license_info=license_label,
                    attribution=attribution,
                    original_name=name,
                    status="ready",
                    metadata_json=metadata,
                )
                collected.append({"uid": uid, "name": name, "status": "downloaded"})
            except Exception as e:
                log.error("  Download failed: %s", e)
                db.insert_asset(
                    filepath=filepath,
                    sha256_hash="",
                    source_url=viewer_url,
                    license_info=license_label,
                    attribution=attribution,
                    original_name=name,
                    status="failed",
                    metadata_json=metadata,
                )
                collected.append({"uid": uid, "name": name, "status": "error"})

        cursor = data.get("cursors", {}).get("next")
        if not cursor:
            break

    return collected


def main():
    parser = argparse.ArgumentParser(description="Sketchfab car model scraper")
    parser.add_argument("--query", default="car", help="Search query (default: car)")
    parser.add_argument("--limit", type=int, default=24, help="Max models to process (default: 24)")
    parser.add_argument("--dry-run", action="store_true", help="Search and log without downloading")
    parser.add_argument("--license", default="", help="License filter (default: any, e.g. cc0, by)")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="SQLite database path")
    parser.add_argument("--list", action="store_true", help="List assets already in DB")
    parser.add_argument("--categories", default="cars-vehicles", help="Sketchfab category filter (default: cars-vehicles)")
    args = parser.parse_args()

    api_key = os.environ.get("SKETCHFAB_API_KEY")
    if not api_key:
        log.warning("No SKETCHFAB_API_KEY set — search/browse only (no downloads)")

    asset_dir = Path(os.environ.get("ASSET_DIR", DEFAULT_ASSET_DIR))
    db_path = Path(args.db)

    client = SketchfabClient(api_key)
    db = AssetDB(db_path)

    try:
        if args.list:
            rows = db.conn.execute(
                "SELECT id, original_name, source_type, license, status, sha256_hash "
                "FROM assets ORDER BY id"
            ).fetchall()
            if not rows:
                log.info("No assets in database")
            else:
                log.info("%d assets in database:", len(rows))
                for r in rows:
                    h = r["sha256_hash"][:12] + "..." if r["sha256_hash"] else "(none)"
                    log.info(
                        "  #%d %-45s [%s] %s hash=%s",
                        r["id"], r["original_name"][:45], r["status"],
                        r["license"] or "?", h,
                    )
        else:
            results = search_and_collect(
                client=client,
                db=db,
                asset_dir=asset_dir,
                query=args.query,
                max_results=args.limit,
                dry_run=args.dry_run,
                license_filter=args.license,
                categories=args.categories,
            )

            # Summary
            statuses = {}
            for r in results:
                s = r["status"]
                statuses[s] = statuses.get(s, 0) + 1
            log.info("Done. %d models processed: %s", len(results), dict(statuses))
    finally:
        db.close()


if __name__ == "__main__":
    main()
