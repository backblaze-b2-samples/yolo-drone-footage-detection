<!-- last_verified: 2026-08-03 -->
# Feature: Video Ingest

## Purpose
Get a large drone/dashcam video (optionally with a GPS sidecar) onto Backblaze B2 without ever buffering the whole file in memory, and create an Inspection for it.

## Used By
- UI: `/inspections/new` (`components/inspections/inspection-create-form.tsx`)
- API: `POST /inspections`
- Job: enqueues a detection run on creation (`app/runtime/jobs.py`)

## Core Functions
- `app.service.inspections.create_inspection`
- `app.repo.inspection_store.upload_stream` (multipart `upload_fileobj`)
- `app.service.upload.sanitize_filename`

## Canonical Files
- Pattern exemplar: `services/api/app/service/inspections.py`

## Inputs
- file: `UploadFile` — a `.mp4`/`.mov` video (source form field `file`)
- name: string (optional; defaults to the video filename)
- params: `DetectionParams` (model, device, conf_threshold, sample_fps, max_frames)
- sidecar: `UploadFile | None` — optional `.gpx`/`.srt` GPS track

## Outputs
- `inspections/<id>/source/<filename>` on B2 (the original video)
- `inspections/<id>/source/<sidecar>` on B2 (when a sidecar is provided)
- `inspections/<id>/inspection.json` manifest (status `queued`)
- side effect: a detection job is enqueued immediately (auto-run on create)

## Flow
- The browser streams the video with an XHR upload-progress bar (`createInspection` in `lib/api-client.ts`).
- FastAPI hands the `SpooledTemporaryFile` to `upload_stream`, which multipart-uploads it to B2 — a multi-GB file is never fully read into RAM.
- An optional sidecar is uploaded the same way.
- The manifest is written and a detection job is enqueued.

## Edge Cases
- Non-video content type and non-`.mp4`/`.mov` extension → `415 Unsupported Media Type`.
- Invalid detection params → `422` with field errors.
- Empty name → the sanitized source filename is used.

## UX States (if applicable)
- Empty: the create form with safe-default guidance (never autofilled).
- Loading: determinate upload progress bar, then redirect to the detail view.
- Error: toast with the API message; the form stays editable.

## Verification
- Test files: `services/api/tests/test_openapi_contract.py`, `services/api/tests/test_structure.py`
- Required cases: happy path + rejected content type + invalid params
- Focused verify command: `pnpm test:api`
- Default pre-PR verify command: `pnpm verify`
- Full local verify command: `pnpm verify:full` when E2E/live prerequisites apply
- Pass criteria: an upload creates a `queued` inspection whose source object exists under `inspections/<id>/source/`.

## Related Docs
- [README.md](../../README.md)
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [docs/app-workflows.md](../app-workflows.md)
- [Object Detection](object-detection.md)
