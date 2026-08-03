import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import ValidationError

from app.runtime import jobs
from app.service import inspections as svc
from app.types import (
    DetectionParams,
    FrameDetections,
    Inspection,
    InspectionStatusResponse,
    InspectionUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# SECURITY: like the Files routes, these are intentionally unauthenticated and
# operate on the single app-owned `inspections/` prefix (single-tenant demo —
# see docs/SECURITY.md). Deletes are always prefix-scoped in service.inspections.

# The inspection uploader accepts video only (+ an optional GPS sidecar). The
# generic /upload page keeps the starter's broader type set.
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/quicktime"}
_VIDEO_EXTENSIONS = (".mp4", ".mov")


def _status_response(inspection: Inspection) -> InspectionStatusResponse:
    progress = jobs.get_progress(inspection.id) or {}
    return InspectionStatusResponse(
        id=inspection.id,
        status=inspection.status,
        frames_done=progress.get("frames_done", inspection.frame_count),
        frames_total=progress.get("frames_total", inspection.frame_count),
        detection_count=inspection.detection_count,
        error=inspection.error,
    )


def _require(inspection_id: str) -> Inspection:
    try:
        return svc.get_inspection(inspection_id)
    except svc.InspectionNotFound as e:
        raise HTTPException(status_code=404, detail=e.detail) from None


@router.post("/inspections", response_model=Inspection, status_code=201)
async def create_inspection_endpoint(
    file: UploadFile,
    name: str = Form(""),
    model: str = Form("yolo11n.pt"),
    device: str = Form("auto"),
    conf_threshold: float = Form(0.25),
    sample_fps: float = Form(1.0),
    max_frames: int = Form(300),
    sidecar: UploadFile | None = File(None),
):
    content_type = file.content_type or "application/octet-stream"
    fname = (file.filename or "").lower()
    if content_type not in ALLOWED_VIDEO_TYPES and not fname.endswith(_VIDEO_EXTENSIONS):
        raise HTTPException(
            status_code=415,
            detail="Only .mp4 / .mov video is accepted for an inspection",
        )
    try:
        params = DetectionParams(
            model=model,
            device=device,
            conf_threshold=conf_threshold,
            sample_fps=sample_fps,
            max_frames=max_frames,
        )
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors()) from None

    sidecar_file = sidecar.file if sidecar and sidecar.filename else None
    sidecar_name = sidecar.filename if sidecar and sidecar.filename else None

    inspection = await run_in_threadpool(
        svc.create_inspection,
        name=name,
        params=params,
        source=file.file,
        source_filename=file.filename or "video.mp4",
        source_content_type=content_type,
        sidecar=sidecar_file,
        sidecar_filename=sidecar_name,
    )
    # Auto-run on create (re-runnable later from the detail view).
    jobs.enqueue(inspection.id)
    return inspection


@router.get("/inspections", response_model=list[Inspection])
def list_inspections_endpoint():
    return svc.list_inspections()


@router.get("/inspections/{inspection_id}", response_model=Inspection)
def get_inspection_endpoint(inspection_id: str):
    return _require(inspection_id)


@router.post("/inspections/{inspection_id}", response_model=Inspection)
def update_inspection_endpoint(inspection_id: str, update: InspectionUpdate):
    _require(inspection_id)
    return svc.update_inspection(inspection_id, update)


@router.delete("/inspections/{inspection_id}")
def delete_inspection_endpoint(inspection_id: str):
    _require(inspection_id)
    count = svc.delete_inspection(inspection_id)
    return {"deleted": True, "id": inspection_id, "objects_removed": count}


@router.post("/inspections/{inspection_id}/run", response_model=InspectionStatusResponse)
def run_inspection_endpoint(inspection_id: str):
    inspection = _require(inspection_id)
    if inspection.status == "processing":
        raise HTTPException(status_code=409, detail="Detection already running")
    svc.mark_status(inspection_id, "queued", error=None)
    jobs.enqueue(inspection_id)
    return _status_response(svc.get_inspection(inspection_id))


@router.get(
    "/inspections/{inspection_id}/status", response_model=InspectionStatusResponse
)
def inspection_status_endpoint(inspection_id: str):
    return _status_response(_require(inspection_id))


@router.get("/inspections/{inspection_id}/track")
def inspection_track_endpoint(inspection_id: str):
    _require(inspection_id)
    return svc.get_track(inspection_id)


@router.get("/inspections/{inspection_id}/summary")
def inspection_summary_endpoint(inspection_id: str):
    _require(inspection_id)
    return svc.get_summary(inspection_id) or {}


@router.get(
    "/inspections/{inspection_id}/frames", response_model=list[FrameDetections]
)
def inspection_frames_endpoint(inspection_id: str):
    _require(inspection_id)
    return svc.get_frames(inspection_id)


@router.get("/inspections/{inspection_id}/object")
def inspection_object_url_endpoint(inspection_id: str, key: str):
    _require(inspection_id)
    try:
        url = svc.presign_object(inspection_id, key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    return {"url": url}
