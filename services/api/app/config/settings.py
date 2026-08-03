from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Backblaze B2 (S3-compatible). The endpoint is derived from the region so a
    # clone only needs the standard B2_* names; set b2_endpoint to override.
    b2_application_key_id: str = ""
    b2_application_key: str = ""
    b2_bucket_name: str = ""
    b2_region: str = "us-west-004"
    b2_endpoint: str = ""
    # Optional public base URL for a public bucket (builds browser-facing object
    # URLs). Empty/None → the app falls back to presigned URLs. Optional on
    # purpose: never list it in required-key startup validation.
    b2_public_url_base: str = ""

    api_port: int = 8000
    # Interactive API docs (/docs, /redoc, /openapi.json). On by default for
    # local dev and starter-kit exploration; set false to hide the full API
    # surface in production.
    enable_docs: bool = True
    # Explicit allowlist by default — covers Next on :3000 and the
    # fallback :3001 it picks if 3000 is busy. Production deploys should
    # override with the exact frontend origin.
    api_cors_origins: str = "http://localhost:3000,http://localhost:3001"
    # Optional dev-only escape hatch: a regex that matches additional
    # allowed origins. Empty by default — set this to e.g.
    # `^http://localhost:\d+$` to accept any localhost port without
    # listing each one. NEVER ship this to production.
    api_cors_origin_regex: str = ""

    # Upload limits. Drone/dashcam clips are large, so the ceiling is generous;
    # the source video is streamed to B2 (never fully buffered) at ingest.
    max_file_size: int = 2 * 1024 * 1024 * 1024  # 2GB

    # --- Local YOLO detection (Ultralytics; no API key) ---
    # Weights auto-download once from Ultralytics on first run (~5MB for nano).
    yolo_model: str = "yolo11n.pt"
    # Device resolution order is CUDA -> CPU with mps opt-in — see repo/yolo.py.
    yolo_device: str = "auto"
    yolo_conf_threshold: float = 0.25
    # Runtime bounding so a long clip can't run unbounded on CPU.
    frame_sample_fps: float = 1.0
    max_frames: int = 300
    # Optional exiftool path for embedded-telemetry GPS extraction (tier 2).
    exiftool_path: str = ""

    # Optional confinement for key-addressed reads/deletes. Empty by default so
    # the by-key routes accept any key shape (they deliberately support nested
    # folders and reserved-word segments). Point a fork at a bucket shared with
    # other data? Set to e.g. "uploads/" to restrict all key ops to app uploads.
    allowed_key_prefix: str = ""

    # Full-bucket listing cache (repo/list_cache.py). Both /files and
    # /files/stats need every object, and paginating a 16k-object bucket takes
    # ~8-20s, so one scan is shared. Entries older than the TTL are still
    # served *immediately* while a background thread refreshes them
    # (stale-while-revalidate), so only the very first scan can make a user
    # wait. Uploads and deletes invalidate the cache outright, so the app's own
    # writes are never served stale — only bucket changes made elsewhere can lag
    # by up to this TTL.
    list_cache_ttl_seconds: float = 300.0
    # Scan the bucket once at startup so the first page view doesn't pay for the
    # cold scan. Set false for offline dev or when startup must not touch B2.
    warm_list_cache_on_startup: bool = True

    # Rate limiting (per client IP, per 60s window). In-process per replica —
    # documented in docs/RELIABILITY.md; horizontal scaling needs a shared
    # store (e.g. Redis). Writes/downloads get the tighter cap.
    rate_limit_per_minute: int = 120
    # Covers uploads, deletes, downloads and previews — kept generous enough
    # that a normal browsing/upload session doesn't trip it.
    rate_limit_write_per_minute: int = 60

    # Small durable counters (downloads, etc). Relative paths resolve against
    # the repo root (see repo/counter.py). Point at a persistent volume in
    # production if you care about surviving restarts.
    #
    # It must stay OUTSIDE services/api/: that is the directory `uvicorn
    # --reload` watches in dev, so a counter file there means every download
    # writes into the reloader's watch tree. Today uvicorn only restarts for
    # `*.py`, so the writes surface as misleading "N changes detected" log noise
    # on every download — but a single added `--reload-include` would turn a
    # normal user action into an API restart that drops in-flight requests.
    download_count_file: str = ".data/download_count.json"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def endpoint_url(self) -> str:
        """The S3 endpoint to use.

        Prefer an explicit ``B2_ENDPOINT`` override; otherwise derive it from
        ``B2_REGION`` so a clone only needs the standard B2_* names. No region
        string is hardcoded in the S3 client — it always flows through here.
        """
        if self.b2_endpoint:
            return self.b2_endpoint
        return f"https://s3.{self.b2_region}.backblazeb2.com"

    @property
    def cors_origins(self) -> list[str]:
        # Drop empties so a trailing comma or API_CORS_ORIGINS="" doesn't yield
        # a stray "" origin.
        return [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]


settings = Settings()
