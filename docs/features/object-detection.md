<!-- last_verified: 2026-08-03 -->
# Feature: Object Detection

## Purpose
Run local Ultralytics YOLO object detection over sampled keyframes of an inspection's video, and write annotated frames + per-frame detections + a summary back to B2.

## Used By
- UI: `/inspections/[id]` Detections + Keyframes tabs; the "Run detection" button
- API: `POST /inspections/{id}/run`, `GET /inspections/{id}/status`, `GET /inspections/{id}/frames`, `GET /inspections/{id}/summary`
- Job: `app/runtime/jobs.py` (in-process `ThreadPoolExecutor`, one worker)

## Core Functions
- `app.repo.yolo.detect_video` / `resolve_device` / `annotate_frame` (the ONLY module importing `ultralytics`/`cv2`/`torch`)
- `app.service.detect.run_detection`
- `app.runtime.jobs.enqueue` / `get_progress`

## Canonical Files
- Pattern exemplar: `services/api/app/repo/yolo.py`

## Inputs
- The inspection's source video (downloaded from B2 to a temp file for OpenCV decode)
- `DetectionParams`: model (`yolo11n|s|m.pt`), device, conf_threshold, sample_fps, max_frames

## Outputs
- `inspections/<id>/annotated/frame_XXXXXX.jpg` — annotated keyframes (boxes + labels)
- `inspections/<id>/detections/frames.json` — per-frame detections (class, confidence, bbox, timestamp, lat/lon)
- `inspections/<id>/detections/summary.json` — aggregate class counts + params
- manifest transitions `queued → processing → done|failed` with counts

## Flow
- The job runner downloads the source video from B2 to a `tempfile`.
- GPS extraction runs first (see [GPS Extraction](gps-extraction.md)).
- `detect_video` samples frames bounded by `sample_fps` and `max_frames`, runs YOLO on each, and yields detections + an annotated JPEG.
- Each frame's artifacts are written to B2; progress is reported to the in-memory registry the status route reads.
- Counts are aggregated into the summary and the manifest is marked `done`.

## Edge Cases
- Missing GPU → device auto-detects **CUDA → CPU** and defaults to CPU; `mps` is opt-in (`YOLO_DEVICE=mps`) and falls back to CPU when unavailable. A GPU is never hard-required.
- Weights not present → `yolo11n.pt` auto-downloads once from Ultralytics (no key); `*.pt` is gitignored.
- Undecodable video → the run is marked `failed` with the error on the manifest.
- Long clip → `max_frames` caps the work so CPU inference can't run unbounded.

## UX States (if applicable)
- Empty: "Detections appear when the run completes".
- Loading: a determinate progress bar (`frames_done / frames_total`) polled while `processing`.
- Error: a failed banner with the manifest error; the run is re-runnable after editing params.

## Verification
- Test files: `services/api/tests/test_structure.py` (repo/ SDK containment), `services/api/tests/test_openapi_contract.py`
- Required cases: happy path + missing-GPU CPU fallback + failed decode
- Focused verify command: `pnpm test:api`
- Default pre-PR verify command: `pnpm verify`
- Full local verify command: `pnpm verify:full` when E2E/live prerequisites apply
- Pass criteria: a run reaches `done`, `detections/summary.json` exists, and annotated frames are browsable.

## Related Docs
- [README.md](../../README.md)
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [docs/app-workflows.md](../app-workflows.md)
- [GPS Extraction](gps-extraction.md)
