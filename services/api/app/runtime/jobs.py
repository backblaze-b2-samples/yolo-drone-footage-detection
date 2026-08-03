"""In-process background job runner for detection.

Detection is CPU-heavy and can take minutes on a long clip, so it must never
run inside an HTTP request. Jobs are submitted to a small ``ThreadPoolExecutor``
(one worker, so CPU inference can't oversubscribe) and their live progress is
kept in an in-memory registry the status route reads. The durable state still
lives in the B2 manifest (``service.detect`` writes every transition there), so
a restart loses only the in-flight progress bar, not the record.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

from app.service.detect import run_detection

logger = logging.getLogger(__name__)

# One worker: YOLO on CPU already saturates cores; a second concurrent decode +
# inference would just thrash. Bump to 2 only on a GPU deployment.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="detect")
_lock = Lock()
_progress: dict[str, dict[str, int]] = {}


def _make_progress_cb(inspection_id: str):
    def cb(frames_done: int, frames_total: int) -> None:
        with _lock:
            _progress[inspection_id] = {
                "frames_done": frames_done,
                "frames_total": frames_total,
            }

    return cb


def _run(inspection_id: str) -> None:
    try:
        run_detection(inspection_id, _make_progress_cb(inspection_id))
    finally:
        with _lock:
            _progress.pop(inspection_id, None)


def enqueue(inspection_id: str) -> None:
    """Submit a detection job. Returns immediately; the HTTP request never waits
    on inference."""
    with _lock:
        _progress[inspection_id] = {"frames_done": 0, "frames_total": 0}
    _executor.submit(_run, inspection_id)
    logger.info("Detection job enqueued: id=%s", inspection_id)


def get_progress(inspection_id: str) -> dict[str, int] | None:
    """Live progress for a running job, or None if it isn't currently running."""
    with _lock:
        entry = _progress.get(inspection_id)
        return dict(entry) if entry is not None else None
