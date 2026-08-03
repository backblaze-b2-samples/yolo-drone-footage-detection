"""Inspection lifecycle: create / read / list / update / delete.

An Inspection is the app's single primary entity — one uploaded video plus its
derived detection + GPS record. The manifest ``inspections/<id>/inspection.json``
on B2 is the source of truth for status and counts; this module owns reading and
writing it. Detection itself lives in ``service.detect``.
"""

import logging
from datetime import UTC, datetime
from typing import BinaryIO
from uuid import uuid4

from app.repo import (
    INSPECTIONS_PREFIX,
    delete_prefix,
    get_json,
    get_presigned_get,
    list_inspection_ids,
    put_json,
    upload_stream,
)
from app.service.upload import sanitize_filename
from app.types import DetectionParams, Inspection, InspectionUpdate

logger = logging.getLogger(__name__)


class InspectionNotFound(Exception):
    def __init__(self, inspection_id: str):
        self.detail = f"Inspection '{inspection_id}' not found"
        super().__init__(self.detail)


def prefix_for(inspection_id: str) -> str:
    return f"{INSPECTIONS_PREFIX}{inspection_id}/"


def manifest_key(inspection_id: str) -> str:
    return f"{prefix_for(inspection_id)}inspection.json"


# Canonical artifact keys — shared by the write path (service.detect) and the
# read helpers below, so the layout lives in exactly one place.
def track_key(inspection_id: str) -> str:
    return f"{prefix_for(inspection_id)}track.geojson"


def summary_key(inspection_id: str) -> str:
    return f"{prefix_for(inspection_id)}detections/summary.json"


def frames_key(inspection_id: str) -> str:
    return f"{prefix_for(inspection_id)}detections/frames.json"


def frame_json_key(inspection_id: str, seq: int) -> str:
    return f"{prefix_for(inspection_id)}detections/frame_{seq:06d}.json"


def annotated_key(inspection_id: str, seq: int) -> str:
    return f"{prefix_for(inspection_id)}annotated/frame_{seq:06d}.jpg"


def write_manifest(inspection: Inspection) -> None:
    put_json(manifest_key(inspection.id), inspection.model_dump(mode="json"))


def create_inspection(
    *,
    name: str,
    params: DetectionParams,
    source: BinaryIO,
    source_filename: str,
    source_content_type: str,
    sidecar: BinaryIO | None = None,
    sidecar_filename: str | None = None,
) -> Inspection:
    """Stream the source video to B2 and create a `queued` inspection.

    The video is streamed via multipart ``upload_fileobj`` so a multi-GB file is
    never fully buffered in RAM.
    """
    inspection_id = uuid4().hex[:12]
    safe_source = sanitize_filename(source_filename) or "video.mp4"
    source_key = f"{prefix_for(inspection_id)}source/{safe_source}"
    upload_stream(source, source_key, source_content_type)

    sidecar_key = None
    if sidecar is not None and sidecar_filename:
        safe_sidecar = sanitize_filename(sidecar_filename) or "track.gpx"
        sidecar_key = f"{prefix_for(inspection_id)}source/{safe_sidecar}"
        upload_stream(sidecar, sidecar_key, "application/octet-stream")

    now = datetime.now(UTC)
    inspection = Inspection(
        id=inspection_id,
        name=name.strip() or safe_source,
        status="queued",
        params=params,
        source_key=source_key,
        source_filename=safe_source,
        sidecar_key=sidecar_key,
        created_at=now,
        updated_at=now,
    )
    write_manifest(inspection)
    logger.info("Inspection created: id=%s source=%s", inspection_id, source_key)
    return inspection


def get_inspection(inspection_id: str) -> Inspection:
    data = get_json(manifest_key(inspection_id))
    if data is None:
        raise InspectionNotFound(inspection_id)
    return Inspection.model_validate(data)


def get_inspection_or_none(inspection_id: str) -> Inspection | None:
    data = get_json(manifest_key(inspection_id))
    return Inspection.model_validate(data) if data is not None else None


def list_inspections() -> list[Inspection]:
    inspections: list[Inspection] = []
    for inspection_id in list_inspection_ids():
        data = get_json(manifest_key(inspection_id))
        if data is not None:
            inspections.append(Inspection.model_validate(data))
    inspections.sort(key=lambda i: i.created_at, reverse=True)
    return inspections


def update_inspection(inspection_id: str, update: InspectionUpdate) -> Inspection:
    inspection = get_inspection(inspection_id)
    if update.name is not None:
        inspection.name = update.name.strip() or inspection.name
    if update.params is not None:
        inspection.params = update.params
    inspection.updated_at = datetime.now(UTC)
    write_manifest(inspection)
    return inspection


def delete_inspection(inspection_id: str) -> int:
    """Delete everything under ``inspections/<id>/`` (prefix-scoped) from B2."""
    # Confirm it exists first so a bad id 404s instead of silently no-op deleting.
    get_inspection(inspection_id)
    count = delete_prefix(prefix_for(inspection_id))
    logger.info("Inspection deleted: id=%s objects=%d", inspection_id, count)
    return count


def mark_status(
    inspection_id: str,
    status: str,
    *,
    error: str | None = None,
) -> Inspection:
    inspection = get_inspection(inspection_id)
    inspection.status = status  # type: ignore[assignment]
    inspection.error = error
    inspection.updated_at = datetime.now(UTC)
    write_manifest(inspection)
    return inspection


def apply_results(
    inspection_id: str,
    *,
    frame_count: int,
    detection_count: int,
    class_counts: dict[str, int],
    has_track: bool,
    track_point_count: int,
) -> Inspection:
    inspection = get_inspection(inspection_id)
    inspection.status = "done"
    inspection.error = None
    inspection.frame_count = frame_count
    inspection.detection_count = detection_count
    inspection.class_counts = class_counts
    inspection.has_track = has_track
    inspection.track_point_count = track_point_count
    inspection.updated_at = datetime.now(UTC)
    write_manifest(inspection)
    return inspection


# --- Detail-view reads (all scoped to the inspection's own prefix) ---


def get_track(inspection_id: str) -> dict:
    """The GeoJSON track, or an empty FeatureCollection when none was found."""
    get_inspection(inspection_id)  # 404 for a bad id
    data = get_json(track_key(inspection_id))
    return data or {"type": "FeatureCollection", "features": []}


def get_summary(inspection_id: str) -> dict | None:
    get_inspection(inspection_id)
    return get_json(summary_key(inspection_id))


def get_frames(inspection_id: str) -> list[dict]:
    get_inspection(inspection_id)
    data = get_json(frames_key(inspection_id))
    return data if isinstance(data, list) else []


def presign_object(inspection_id: str, key: str, expires_in: int = 3600) -> str:
    """Presign an object for the browser, refusing any key outside this
    inspection's own prefix (defense-in-depth against key traversal)."""
    prefix = prefix_for(inspection_id)
    if not key.startswith(prefix) or ".." in key:
        raise ValueError("object key is outside this inspection")
    return get_presigned_get(key, expires_in)
