# Build plan — `yolo-drone-footage-detection`

Source of truth for the starter tree: `.claude/scratch/vcsk-0eef9c79-37f6-49d7-9559-634a455ad86d/`
(cloned fresh in Phase 0). All keep/trim/add deltas are computed against that tree.

---

## 1. Purpose

`yolo-drone-footage-detection` is a B2 sample for **infrastructure-inspection teams, fleet
operators, and aerial-survey engineers** who bulk-upload large drone/dashcam video files and
need a searchable, spatially-indexed inspection record — stored entirely on Backblaze B2. A user
uploads a video (optionally with a GPS track sidecar), the app runs **Ultralytics YOLO** object
detection per sampled keyframe locally (no second API key), extracts a GPS track, and writes the
source archive, per-frame detection JSON, a detection summary, annotated keyframes, and a GeoJSON
track back to B2. It then serves a per-inspection view that correlates detections with GPS
coordinates on a map plus an annotated-keyframe gallery. The sample demonstrates **B2 as the
storage layer for a geospatial AI video-analytics pipeline** — heavy, bursty landing with sustained
write amplification (one source video fans out into hundreds of derived objects) — accessed via the
**S3-compatible API** with a custom user-agent and the standard `B2_*` env vars.

## 2. Architecture delta from vibe-coding-starter-kit

The starter kit is the ceiling. We **keep** its whole app shell, B2 S3 client, upload/list/delete
plumbing, dashboard, settings, design system, and test harness; we **trim** the generic
image/PDF metadata feature; we **add** the inspection entity, the local YOLO detection + GPS-track
pipeline, a background job runner, and a Leaflet map view.

### KEEP (as-is or lightly adapted)
| Item | Notes |
|---|---|
| `services/api/app/repo/b2_client.py` | S3 client, `put/get/list/head/delete/presign`. Adapt only for the Std-#3 env rename (§3) + streaming upload (below). Custom UA stays. |
| `services/api/app/repo/{list_cache,counter,b2_object}.py` | Full-bucket listing cache, counters — reused verbatim. |
| `services/api/app/runtime/{health,metrics,ratelimit,files}.py` | Health, timing/req-id middleware, rate limiting, file routes. Keep. |
| `services/api/main.py` | Keep structure (lifespan validation, JSON logging, CORS ordering). Adapt REQUIRED_B2_SETTINGS + title + new routers. |
| **`apps/web` file browser (`/files`, `file-browser.tsx` + `file-*`)** | **The full-bucket explorer — NON-NEGOTIABLE KEEP.** It stays as the "browse everything in the bucket" view. |
| Dashboard shell (`/`, `stats-cards`, `upload-chart`, `recent-uploads-table`) | Keep; re-label copy to inspection domain (§5). Stats still read whole-bucket. |
| Settings (`/settings`, `settings-form.tsx`, `danger-zone.tsx`) | Keep. `settings-form.tsx` is the **form-UX exemplar** (selector + default-hint) to copy for the inspection forms. |
| Design system (`/design`, all `components/ui/*`, `components/design/*`) | Keep verbatim — this is the shared primitive library (incl. `select`, `radio-group`, `form`, `dialog`, `alert-dialog`, `progress`, `tabs`, `sonner`). |
| Upload infra (`dropzone`, `upload-form`, `upload-progress`, `upload-queue-context`, `runtime/upload.py`, `service/upload.py`) | Keep as the ingest mechanism; extend to (a) accept large video + optional sidecar, (b) stream via multipart, (c) create an Inspection on completion (§4). |
| Test harness (`services/api/tests/*`, web `*.test.ts`, `e2e/`, contract export) | Keep and extend. `test_structure.py`, `test_openapi_contract.py`, `api-contract.test.ts` MUST stay green — regenerate `docs/api/openapi.json` + `packages/shared/src/types.ts` after adding routes. |
| Scripts (`scripts/*.mjs`, `dev.sh`), infra/railway, pre-commit, CI workflows | Keep; rename identifiers (§6). |

### TRIM (remove from starter)
| Item | Why |
|---|---|
| `services/api/app/service/metadata.py` image/PDF EXIF branch + `_extract_pdf_metadata` | The generic image/PDF metadata feature is not this app's story. Keep the file's md5/sha256/size core (still used by the file-detail panel) but drop the Pillow/PyPDF2 image/PDF EXIF extraction and its deps. |
| `Pillow`, `PyPDF2` from `requirements.txt` | Only used by the trimmed metadata branch. (Note: `opencv`/`ultralytics` pull their own image libs for detection — see §4.) |
| `docs/features/metadata-extraction.md` | Replaced by the detection/GPS/inspection feature docs (§5). |
| Upload `ALLOWED_TYPES` non-video entries **for the inspection ingest path** | The inspection uploader accepts `video/mp4` (+ `video/quicktime`) and the sidecar track types only. The generic `/upload` page + file browser keep accepting the starter's full type set. |

### ADD (new for this sample)
| Item | Notes |
|---|---|
| **Inspection entity** — `services/api/app/service/inspections.py`, `app/types/inspections.py` | The single primary entity. Manifest `inspection.json` on B2 holds id, name, source key, status (`queued\|processing\|done\|failed`), params, counts, timestamps, error. |
| **Detection service** — `services/api/app/service/detect.py`, `app/repo/yolo.py` | Local **Ultralytics YOLO** inference. `app/repo/yolo.py` is the ONLY module importing `ultralytics`/`cv2` (contained, mirrors the starter's repo/ boundary). CPU-default, device autodetect (§4). |
| **GPS extraction** — `services/api/app/service/geo.py` | Parse GPS track → GeoJSON. Tiered + graceful (§4). |
| **Background job runner** — `services/api/app/runtime/jobs.py` | In-process `ThreadPoolExecutor` (max 1–2 workers) running detect+extract; writes status transitions into the B2 manifest + an in-memory registry the status route reads. |
| **Inspection routes** — `services/api/app/runtime/inspections.py` | REST for the entity (§4 verbs). Registered in `main.py`. |
| **`/inspections` library view (scoped asset explorer — MANDATORY ADD)** | Lists this app's own inspections (reads `inspections/*/inspection.json`), scoped to the app prefix — distinct from the full-bucket `/files` explorer. |
| **`/inspections/[id]` detail view** | Tabs: **Map** (Leaflet track + detection markers), **Keyframes** (annotated gallery via presigned URLs), **Detections** (class-count summary + per-frame table), **Files** (the inspection's own B2 objects). Edit + Run + Delete actions live here. |
| **Create/Edit inspection forms** | `react-hook-form` + `zod`, using the design-system `Select`/`RadioGroup` per §4 Form-UX. |
| **Leaflet map** — `react-leaflet` + OSM raster tiles | Keyless, OSS, no token. New web deps: `leaflet`, `react-leaflet`, `@types/leaflet`. Dynamic-import the map (`ssr:false`) — Leaflet touches `window`. |
| **New feature docs** — `docs/features/{video-ingest,object-detection,gps-extraction,inspection-map}.md` | Seed from README bullets (§5). |
| **`docs/exec-plans/completed/initial-scaffold.md`** | This plan, moved here on PASS (Phase 5). |

## 3. B2 surface (S3-compatible only — no b2-native)

All operations go through the kept boto3 S3 client with `user_agent_extra` set. **No b2-native API.**

| S3 op | Used for |
|---|---|
| `put_object` | manifest `inspection.json`, `track.geojson`, per-frame `detections/*.json`, `detections/summary.json`, annotated `annotated/*.jpg` |
| `upload_fileobj` (multipart, streaming) | the **source video** ingest — streams from FastAPI's `SpooledTemporaryFile` so a multi-GB drone file is never fully buffered in RAM (directly serves the "large bulk" headline). |
| `list_objects_v2` | list inspections (`inspections/` prefix, delimiter on manifest), browse an inspection's objects, full-bucket explorer + stats |
| `get_object` | read manifest / summary / track / per-frame JSON; download source to a temp file for OpenCV decode |
| `head_object` | object metadata for the file-detail panel |
| `delete_object` | delete an inspection — **scoped to `inspections/<id>/` prefix only** (per CLAUDE.local safety rule); never a bucket-wide wipe |
| `generate_presigned_url` | serve annotated keyframes + source video inline/attachment to the browser |

**Bucket layout (all under the app's own prefix):**
```
inspections/<id>/inspection.json                 # manifest (name, status, params, counts, ts)
inspections/<id>/source/<filename>               # original video (+ optional sidecar .gpx/.srt)
inspections/<id>/track.geojson                   # extracted GPS track (LineString + timestamped points)
inspections/<id>/detections/summary.json         # aggregate class counts, frame count, params
inspections/<id>/detections/frame_000123.json    # per-frame detections (bbox, class, conf, ts, latlon)
inspections/<id>/annotated/frame_000123.jpg      # annotated keyframe
```

## 4. Key features

1. **Bulk video ingest to B2** — upload large drone/dashcam `.mp4`/`.mov` (+ optional GPS sidecar)
   streamed to B2 via multipart `upload_fileobj`; creates an Inspection in `queued` state.
2. **Per-frame YOLO object detection (local)** — samples keyframes and runs Ultralytics YOLO,
   writing per-frame detection JSON + a summary to B2.
3. **Annotated keyframes** — detection overlays (boxes + labels) rendered onto sampled frames and
   written back to B2 as JPEGs; browsable gallery via presigned URLs.
4. **GPS track extraction → GeoJSON** — a track is parsed and stored as GeoJSON on B2; detections
   are correlated to coordinates by timestamp.
5. **Geotagged inspection map + detection browser** — a Leaflet map of the track with detection
   markers, an annotated gallery, and a class-count summary, all reading from B2.
6. **Scoped Inspections library + full-bucket explorer** — a `/inspections` view of this app's own
   inspections, plus the kept full-bucket `/files` browser.

### External API provider
- **No external API provider.** The one heavy workload (YOLO inference) is **on-device**.
  Per `api-provider-selection.md` Step 2 rule 1 (the point is a *local* capability — Ultralytics
  YOLO is the named trending OSS): **`deployment: local` is the default, no remote path required.**
  - Feature: *Per-frame YOLO object detection* — provider **Ultralytics YOLO**, model **`yolo11n.pt`**
    (nano, ~5.4 MB, COCO-pretrained, auto-downloads once from Ultralytics on first run — no key),
    `deployment: local`, estimated cost per full demo run **$0** (B2 storage only).
  - Map tiles: **OpenStreetMap raster tiles via Leaflet** — keyless, `deployment: local` (browser
    fetches public tiles), $0.
- **CPU-default / GPU-autodetect (hard rule):** `app/repo/yolo.py` resolves device in order
  **CUDA → Apple MPS → CPU**, overridable via `YOLO_DEVICE`. **MPS caveat:** Ultralytics MPS
  inference is intermittently unstable on macOS arm64; autodetect prefers CUDA then CPU and treats
  MPS as opt-in (`YOLO_DEVICE=mps`) — noted here per the api-provider hard rule. Never hard-require a GPU.
- **Runtime bounding:** `FRAME_SAMPLE_FPS` (default `1.0`) + `MAX_FRAMES` (default `300`) cap how
  many frames are decoded/inferred so a long clip can't run unbounded on CPU. `YOLO_CONF_THRESHOLD`
  (default `0.25`) filters weak detections.
- **GPS extraction is tiered + graceful** (honest about "extract from video"):
  1. **Sidecar GPX/SRT** uploaded with the video (most reliable — recommended demo path), parsed
     with `gpxpy` (GPX) or a small SRT-GPS parser (DJI/dashcam subtitle GPS). 
  2. **Embedded telemetry** — if `exiftool` is on PATH (optional `EXIFTOOL_PATH`), extract GoPro
     GPMF / embedded GPS from the video.
  3. **Graceful "no track"** — if neither yields points, `track.geojson` is written empty and the
     detail view shows the Detections/Keyframes tabs with a "no GPS track for this video" notice on
     the Map tab. The app never fails because a clip lacks GPS.

### Provider orchestration via Genblaze
- **Not applicable.** The description's suggested/trending OSS is Ultralytics YOLO; it does **not**
  mention Genblaze / `genblaze-*` / `genblaze-s3`. No provider calls are routed through Genblaze.

### Primary-entity lifecycle (UI completeness — mandatory)
**Primary entity: `Inspection`** (one uploaded video + its derived detection/GPS record). All five
lifecycle verbs are user-accessible in the UI — none omitted:

| Verb | UI surface |
|---|---|
| **create** | The upload/new-inspection form (video + name + detection params + optional sidecar) → creates the Inspection (`queued`). |
| **read** | `/inspections` library list + `/inspections/[id]` detail (map / keyframes / detections / files). |
| **run** | An explicit **"Run detection"** button on the detail view (and auto-run on create) — enqueues the detect+extract job; re-runnable after editing params. Status polled while `processing`. |
| **edit** | An **Edit** form on the detail view — change the inspection name + detection params (model, confidence, sample fps, max frames). Re-running applies the new params. |
| **delete** | A **Delete** action (design-system `AlertDialog` confirm) — removes `inspections/<id>/` from B2 (prefix-scoped) and returns to the library. |

`omitted_ui_verbs`: **none** (all five built).

### Form UX conventions (create/edit forms)
Follow `apps/web/src/components/settings/settings-form.tsx` (react-hook-form + zod + design-system
controls). For BOTH the create and edit inspection forms:
- **(a) finite-value fields use a selector, never free text:**
  - `model` → `Select` (`yolo11n.pt`, `yolo11s.pt`, `yolo11m.pt`).
  - `device` → `Select`/`RadioGroup` (`auto`, `cpu`, `cuda`, `mps`).
  - `sample_fps` → `Select` of sane presets (`0.5`, `1`, `2`) — bounded, so a selector not a number spinner.
  - Free-text only for `name`; numeric `confidence`/`max_frames` use a slider/bounded input.
- **(b) create-form safe defaults surfaced as placeholder / `FormDescription` guidance** (guidance
  only — never an autofill button): model `yolo11n.pt` ("fastest, good for a first run"), device
  `auto`, confidence `0.25`, sample_fps `1`, max_frames `300`. The edit form opens **pre-filled**
  with the inspection's real params (no default hints).

## 5. Doc transforms
| Starter doc | Action |
|---|---|
| `docs/features/dashboard.md` | Rewrite copy to the inspection domain (storage-activity overview stays). |
| `docs/features/file-browser.md` | Rewrite to describe the kept full-bucket explorer in this app's context. |
| `docs/features/file-upload.md` | Rewrite → video ingest (large files, multipart streaming, sidecar). |
| `docs/features/settings.md` | Keep, adapt copy. |
| `docs/features/metadata-extraction.md` | **Delete** (feature trimmed). |
| `docs/features/_template.md` | Keep. |
| **NEW** `docs/features/video-ingest.md` | Bulk video ingest to B2. |
| **NEW** `docs/features/object-detection.md` | Local YOLO per-frame detection + annotated frames. |
| **NEW** `docs/features/gps-extraction.md` | Tiered GPS → GeoJSON. |
| **NEW** `docs/features/inspection-map.md` | Geotagged map + detection browser. |
| `README.md`, `ARCHITECTURE.md`, `PRODUCT.md`, `AGENTS.md`, `docs/app-workflows.md` | Rewrite to the inspection pipeline; keep the "why B2" framing; update run instructions + env. `docs/design-system.md`, `docs/dev-workflows.md`, `RELIABILITY.md`, `SECURITY.md` keep structure, rename identifiers. |

## 6. Rename table
| From | To |
|---|---|
| `vibe-coding-starter-kit` (kebab / root pkg name / dirs) | `yolo-drone-footage-detection` |
| `@vibe-coding-starter-kit/web` | `@yolo-drone-footage-detection/web` |
| `@vibe-coding-starter-kit/shared` | `@yolo-drone-footage-detection/shared` |
| `OSS Starter Kit` (APP_NAME, display) | `Drone Footage Detection` |
| `OSS Starter Kit API` (FastAPI title) | `Drone Footage Detection API` |
| `File management dashboard powered by Backblaze B2` (APP_DESCRIPTION) | `Drone & dashcam footage object detection with geotagged results on Backblaze B2` |
| `b2ai-oss-start` (user_agent_extra + UTM `utm_content`) | `b2ai-drone-detect` |
| pnpm filter `@vibe-coding-starter-kit/web` (root package.json scripts) | `@yolo-drone-footage-detection/web` |
| image tags / workflow slugs / railway service names referencing the old name | `yolo-drone-footage-detection` |

Apply across: `package.json` (root + `apps/web` + `packages/shared`), all `@vibe-coding-starter-kit/*`
imports in `apps/web/src/**`, `apps/web/next.config.ts`, `infra/railway/*.json`, `scripts/doctor.mjs`,
`services/api/main.py`, `services/api/app/repo/b2_client.py`, `app-config.ts`, `app-sidebar.tsx` (UTM),
README/docs, `docs/api/openapi.json` (regenerate), `packages/shared/src/types.ts` (regenerate).

## 7. B2 standards (parent CLAUDE.md — must pass /b2-doctor)
1. **S3 API default** — yes; boto3 S3 only, no b2-native (§3).
2. **Custom user agent** — `user_agent_extra="b2ai-drone-detect"` on the single `get_s3_client()`.
3. **Standardized `B2_*` env vars — rename the starter's deviating names:**
   | Starter | This sample (Std #3) |
   |---|---|
   | `B2_KEY_ID` | `B2_APPLICATION_KEY_ID` |
   | `B2_APPLICATION_KEY` | `B2_APPLICATION_KEY` (unchanged) |
   | `B2_BUCKET_NAME` | `B2_BUCKET_NAME` (unchanged) |
   | `B2_ENDPOINT` | derive from **`B2_REGION`** (`https://s3.<region>.backblazeb2.com`); keep an optional `B2_ENDPOINT` override |
   | `b2_public_url` | **`B2_PUBLIC_URL_BASE`** |
   Update `settings.py` (attrs + defaults: `b2_region` default `us-west-004`), `main.py`
   `REQUIRED_B2_SETTINGS` + `PLACEHOLDER_VALUES`, `.env.example`, `scripts/*` and all docs.
   `B2_PUBLIC_URL_BASE` is **optional** (code-defaulted/None) — do NOT list it in required-key
   startup validation (avoids a seed-env false-BLOCK).

### New env vars (`.env.example`, all with safe defaults / placeholders)
```
# Detection (local YOLO — no API key)
YOLO_MODEL=yolo11n.pt          # yolo11n|s|m; nano is the fast default
YOLO_DEVICE=auto               # auto -> CUDA, else CPU (mps opt-in; see docs)
YOLO_CONF_THRESHOLD=0.25
FRAME_SAMPLE_FPS=1.0           # frames sampled per second of video
MAX_FRAMES=300                 # hard cap on frames processed per video
# EXIFTOOL_PATH=/opt/homebrew/bin/exiftool   # optional: embedded-GPS extraction fallback
```

## 8. Python dependencies (PIN concretely — clean-install safety)
Per the recurring "unpinned ML requirements = false green" lesson, pin ML deps to concrete
compatible versions and **regenerate `requirements.lock`**; a fresh clone must import cleanly.
- **Add:** `ultralytics` (pin a concrete recent `8.3.x`), `torch` + `torchvision` (concrete versions
  the ultralytics pin supports; CPU/MPS wheel on macOS arm64, CPU/CUDA elsewhere), `numpy>=1.26,<2`
  (avoid the numpy-2 ABI breakage seen across ML samples), `gpxpy` (GPX parsing). OpenCV comes via
  Ultralytics' `opencv-python` dependency — use `cv2` only for decode/draw/encode (no GUI/`imshow`).
- **Remove:** `Pillow`, `PyPDF2` (trimmed metadata branch). *(Ultralytics pulls its own Pillow — fine.)*
- Keep the lower-bound (`>=`) convention for non-ML deps; use exact pins for `ultralytics`/`torch`/
  `torchvision`/`numpy`. Update `tests/test_dependency_lock.py` expectations if it enforces the set.

## 9. Notable risks / notes for the builder
- **Weights download at runtime:** `yolo11n.pt` auto-downloads once (~5 MB, no key). Fine for the
  demo; document it. Do NOT commit the weights (gitignore `*.pt`).
- **Large uploads:** stream via `upload_fileobj`; raise `max_file_size` to ~2 GB; the detect job
  streams the source from B2 to a `tempfile` for OpenCV, then deletes the temp file.
- **Detection is async:** never block the HTTP request on inference — enqueue to the job runner and
  poll status. The web detail view uses a `refetchInterval` while `status === "processing"`.
- **Contract tests:** after adding routes, run `pnpm contract:export` to regenerate
  `docs/api/openapi.json` and keep `test_openapi_contract.py` / `api-contract.test.ts` green.
- **Commit per increment** (backend green → frontend wired → docs themed) so a timeout/death never
  strands a half-built tree — verify `pnpm lint` + `pnpm build` + `pnpm test:api` before finalizing.
- **Do NOT** create binary assets (no sample video, no screenshots) — that's the verify/screenshot
  step. Do NOT push to a remote or touch sibling samples.
