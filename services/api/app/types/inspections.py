from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# Finite option sets — the create/edit forms render these as selectors, and the
# API validates against them so a bad value can't reach the detection worker.
YoloModel = Literal["yolo11n.pt", "yolo11s.pt", "yolo11m.pt"]
YoloDevice = Literal["auto", "cpu", "cuda", "mps"]
InspectionStatus = Literal["queued", "processing", "done", "failed"]


class DetectionParams(BaseModel):
    """The tunable knobs for one detection run. Bounded so a clone can't ask the
    CPU path to decode an unbounded number of frames."""

    model: YoloModel = "yolo11n.pt"
    device: YoloDevice = "auto"
    conf_threshold: float = Field(0.25, ge=0.0, le=1.0)
    sample_fps: float = Field(1.0, gt=0.0, le=8.0)
    max_frames: int = Field(300, ge=1, le=5000)


class Inspection(BaseModel):
    """The single primary entity: one uploaded video + its derived record.

    Persisted verbatim as ``inspections/<id>/inspection.json`` on B2 — the
    manifest is the source of truth for status and counts.
    """

    id: str
    name: str
    status: InspectionStatus = "queued"
    params: DetectionParams = DetectionParams()
    source_key: str
    source_filename: str
    sidecar_key: str | None = None
    created_at: datetime
    updated_at: datetime
    # Populated as the detection job runs.
    frame_count: int = 0
    detection_count: int = 0
    class_counts: dict[str, int] = Field(default_factory=dict)
    has_track: bool = False
    track_point_count: int = 0
    error: str | None = None


class InspectionUpdate(BaseModel):
    """Editable fields on the detail view. Re-running applies the new params."""

    name: str | None = Field(None, min_length=1, max_length=200)
    params: DetectionParams | None = None


class Detection(BaseModel):
    """One object detected in one frame."""

    class_name: str
    confidence: float
    # Pixel bbox in the sampled frame: [x1, y1, x2, y2].
    bbox: list[float]


class FrameDetections(BaseModel):
    """Per-frame detections, correlated to a GPS coordinate when a track exists."""

    frame_index: int
    timestamp_s: float
    detections: list[Detection]
    lat: float | None = None
    lon: float | None = None
    annotated_key: str | None = None


class DetectionSummary(BaseModel):
    """Aggregate counts written to ``inspections/<id>/detections/summary.json``."""

    frame_count: int
    detection_count: int
    class_counts: dict[str, int]
    params: DetectionParams
    has_track: bool
    track_point_count: int


class DetectionProgress(BaseModel):
    """Live progress for a running job, merged into the status response."""

    frames_total: int
    frames_done: int


class InspectionStatusResponse(BaseModel):
    """Lightweight status payload the detail view polls while processing."""

    id: str
    status: InspectionStatus
    frames_done: int = 0
    frames_total: int = 0
    detection_count: int = 0
    error: str | None = None
