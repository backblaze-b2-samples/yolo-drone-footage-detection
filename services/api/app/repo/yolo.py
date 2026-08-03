"""Local Ultralytics YOLO inference over sampled video frames.

This is the ONLY module that imports ``ultralytics`` / ``cv2`` / ``torch`` — the
heavy ML SDKs stay confined to the repo/ layer, mirroring the boto3 boundary.
Every import is lazy (inside functions) so importing the FastAPI app — for the
OpenAPI contract, the structural tests, and lint — never requires the ML stack
to be installed. Only an actual detection run pulls it in.

Device selection auto-detects at runtime (CUDA -> CPU) and defaults to CPU;
Apple MPS is opt-in only (Ultralytics MPS inference is intermittently unstable
on macOS arm64). A GPU is never hard-required.
"""

import logging
from collections.abc import Iterator
from functools import lru_cache

from app.types.inspections import Detection, DetectionParams

logger = logging.getLogger(__name__)


def resolve_device(requested: str) -> str:
    """Resolve a requested device to a concrete one that actually exists.

    ``auto`` -> CUDA if present, else CPU. ``mps`` is honored only when truly
    available, otherwise it falls back to CPU. Never raises on a missing GPU.
    """
    requested = (requested or "auto").lower()
    try:
        import torch
    except Exception:  # torch missing → CPU is the only safe answer
        return "cpu"

    def _cuda() -> bool:
        try:
            return bool(torch.cuda.is_available())
        except Exception:
            return False

    def _mps() -> bool:
        try:
            return bool(
                getattr(torch.backends, "mps", None)
                and torch.backends.mps.is_available()
            )
        except Exception:
            return False

    if requested == "cpu":
        return "cpu"
    if requested == "cuda":
        return "cuda" if _cuda() else "cpu"
    if requested == "mps":
        return "mps" if _mps() else "cpu"
    # auto: prefer CUDA, otherwise CPU. MPS is deliberately NOT auto-selected.
    return "cuda" if _cuda() else "cpu"


@lru_cache(maxsize=4)
def _load_model(model_name: str):
    """Load (and cache) a YOLO model. Weights auto-download once, no API key."""
    from ultralytics import YOLO

    logger.info("Loading YOLO model %s", model_name)
    return YOLO(model_name)


def estimate_frame_total(video_path: str, params: DetectionParams) -> int:
    """How many frames the sampler will visit — used for progress reporting."""
    import cv2

    cap = cv2.VideoCapture(video_path)
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    finally:
        cap.release()
    if total <= 0:
        return params.max_frames
    step = max(1, round(fps / params.sample_fps))
    sampled = (total + step - 1) // step
    return min(sampled, params.max_frames)


def _parse_result(result, names: dict, conf_threshold: float) -> list[Detection]:
    detections: list[Detection] = []
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        return detections
    for box in boxes:
        conf = float(box.conf[0])
        if conf < conf_threshold:
            continue
        cls_id = int(box.cls[0])
        xyxy = [float(v) for v in box.xyxy[0].tolist()]
        detections.append(
            Detection(
                class_name=names.get(cls_id, str(cls_id)),
                confidence=round(conf, 4),
                bbox=[round(v, 2) for v in xyxy],
            )
        )
    return detections


def annotate_frame(frame_bgr, detections: list[Detection]) -> bytes:
    """Draw detection boxes + labels onto a frame and encode it as JPEG bytes."""
    import cv2

    annotated = frame_bgr.copy()
    for det in detections:
        x1, y1, x2, y2 = (int(v) for v in det.bbox)
        cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 200, 0), 2)
        label = f"{det.class_name} {det.confidence:.2f}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(annotated, (x1, y1 - th - 6), (x1 + tw + 2, y1), (0, 200, 0), -1)
        cv2.putText(
            annotated,
            label,
            (x1 + 1, y1 - 4),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0, 0, 0),
            1,
            cv2.LINE_AA,
        )
    ok, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        raise RuntimeError("failed to JPEG-encode annotated frame")
    return buf.tobytes()


def detect_video(
    video_path: str, params: DetectionParams
) -> Iterator[tuple[int, float, list, bytes]]:
    """Sample frames from a video and run YOLO on each.

    Yields ``(frame_index, timestamp_s, detections, annotated_jpeg_bytes)`` for
    every sampled frame, bounded by ``sample_fps`` and ``max_frames`` so a long
    clip can't run unbounded on CPU. Raises RuntimeError if the video can't be
    opened.
    """
    import cv2

    device = resolve_device(params.device)
    model = _load_model(params.model)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        cap.release()
        raise RuntimeError(f"could not open video for decoding: {video_path}")

    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        step = max(1, round(fps / params.sample_fps))
        names = model.names if isinstance(model.names, dict) else dict(enumerate(model.names))

        frame_pos = 0
        emitted = 0
        while emitted < params.max_frames:
            ok, frame = cap.read()
            if not ok:
                break
            if frame_pos % step == 0:
                timestamp_s = round(frame_pos / fps, 3)
                result = model.predict(
                    frame,
                    conf=params.conf_threshold,
                    device=device,
                    verbose=False,
                )[0]
                detections = _parse_result(result, names, params.conf_threshold)
                annotated = annotate_frame(frame, detections)
                yield frame_pos, timestamp_s, detections, annotated
                emitted += 1
            frame_pos += 1
    finally:
        cap.release()
