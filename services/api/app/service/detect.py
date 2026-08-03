"""Run one detection job end-to-end and write every artifact to B2.

Pipeline: download the source video from B2 → extract a GPS track (tiered,
graceful) → sample frames and run YOLO → for each frame write an annotated JPEG
and a per-frame detection JSON → write a track GeoJSON and an aggregate summary →
mark the inspection done (or failed). Nothing here touches boto3 directly — all
object I/O goes through the repo layer.
"""

import logging
import os
from collections import Counter
from collections.abc import Callable

from app.repo import (
    detect_video,
    download_to_tempfile,
    estimate_frame_total,
    get_object_bytes,
    put_bytes,
    put_json,
)
from app.service import geo, inspections
from app.types import DetectionSummary, FrameDetections

logger = logging.getLogger(__name__)

ProgressCb = Callable[[int, int], None] | None


def _extract_track(inspection) -> list[geo.TrackPoint]:
    """Tier 1 sidecar → tier 2 embedded → tier 3 empty. Never raises."""
    if inspection.sidecar_key:
        try:
            data = get_object_bytes(inspection.sidecar_key)
            points = geo.parse_sidecar(data, inspection.sidecar_key)
            if points:
                return points
        except Exception:
            logger.warning("Sidecar track extraction failed", exc_info=True)
    return []


def run_detection(inspection_id: str, progress_cb: ProgressCb = None) -> None:
    """Execute the detection job for one inspection. Updates the manifest as it
    goes; on any failure the inspection is marked ``failed`` with the message."""
    inspection = inspections.get_inspection_or_none(inspection_id)
    if inspection is None:
        logger.warning("run_detection: inspection %s vanished", inspection_id)
        return

    inspections.mark_status(inspection_id, "processing", error=None)
    params = inspection.params
    video_path = None
    try:
        suffix = os.path.splitext(inspection.source_filename)[1] or ".mp4"
        video_path = download_to_tempfile(inspection.source_key, suffix=suffix)

        # GPS track (may be embedded telemetry if no sidecar and exiftool exists).
        track = _extract_track(inspection)
        if not track:
            track = geo.extract_embedded_track(video_path)
        put_json(inspections.track_key(inspection_id), geo.build_geojson(track))

        frames_total = estimate_frame_total(video_path, params)
        class_counter: Counter[str] = Counter()
        detection_count = 0
        seq = 0
        all_frames: list[dict] = []

        for frame_index, timestamp_s, detections, annotated_jpeg in detect_video(
            video_path, params
        ):
            annotated_key = inspections.annotated_key(inspection_id, seq)
            put_bytes(annotated_key, annotated_jpeg, "image/jpeg")

            lat, lon = geo.correlate(track, timestamp_s)
            frame = FrameDetections(
                frame_index=frame_index,
                timestamp_s=timestamp_s,
                detections=detections,
                lat=lat,
                lon=lon,
                annotated_key=annotated_key,
            )
            frame_doc = frame.model_dump(mode="json")
            put_json(inspections.frame_json_key(inspection_id, seq), frame_doc)
            all_frames.append(frame_doc)

            for det in detections:
                class_counter[det.class_name] += 1
            detection_count += len(detections)
            seq += 1
            if progress_cb:
                progress_cb(seq, frames_total)

        put_json(inspections.frames_key(inspection_id), all_frames)

        summary = DetectionSummary(
            frame_count=seq,
            detection_count=detection_count,
            class_counts=dict(class_counter),
            params=params,
            has_track=bool(track),
            track_point_count=len(track),
        )
        put_json(inspections.summary_key(inspection_id), summary.model_dump(mode="json"))

        inspections.apply_results(
            inspection_id,
            frame_count=seq,
            detection_count=detection_count,
            class_counts=dict(class_counter),
            has_track=bool(track),
            track_point_count=len(track),
        )
        logger.info(
            "Detection done: id=%s frames=%d detections=%d track_points=%d",
            inspection_id,
            seq,
            detection_count,
            len(track),
        )
    except Exception as exc:
        # Any failure (bad video, OOM, model download error) is surfaced on the
        # manifest as `failed` rather than crashing the worker thread.
        logger.exception("Detection failed for %s", inspection_id)
        inspections.mark_status(inspection_id, "failed", error=str(exc))
    finally:
        if video_path and os.path.exists(video_path):
            try:
                os.remove(video_path)
            except OSError:
                logger.warning("Could not remove temp file %s", video_path)
