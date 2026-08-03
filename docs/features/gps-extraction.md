<!-- last_verified: 2026-08-03 -->
# Feature: GPS Extraction

## Purpose
Turn whatever GPS a clip carries into a GeoJSON track on B2 — honestly and gracefully — so detections can be placed on a map. The app never fails just because a clip lacks GPS.

## Used By
- UI: `/inspections/[id]` Map tab
- API: `GET /inspections/{id}/track` (GeoJSON FeatureCollection)
- Job: called at the start of a detection run (`app/service/detect.py`)

## Core Functions
- `app.service.geo.parse_sidecar` (`_parse_gpx` via gpxpy, `_parse_srt` for DJI/dashcam subtitle GPS)
- `app.service.geo.extract_embedded_track` (optional `exiftool` telemetry)
- `app.service.geo.build_geojson`

## Canonical Files
- Pattern exemplar: `services/api/app/service/geo.py`

## Inputs
- An uploaded `.gpx`/`.srt` sidecar (most reliable — the recommended demo path)
- Or the source video, when `EXIFTOOL_PATH`/`exiftool` is available for embedded telemetry

## Outputs
- `inspections/<id>/track.geojson` — a LineString of the track plus timestamped Point features
- `has_track` + `track_point_count` on the manifest
- Track points carry a time OFFSET (seconds from track start) that lines up with sampled-frame timestamps, so detections correlate to coordinates by time.

## Flow
- **Tier 1 — sidecar:** parse an uploaded GPX (gpxpy) or SRT (regex parser handling `latitude/longitude` and DJI `GPS(lon,lat)` shapes).
- **Tier 2 — embedded:** if neither yields points and `exiftool` is on PATH, extract embedded GPS (e.g. GoPro GPMF) from the video.
- **Tier 3 — graceful:** if nothing is found, an empty FeatureCollection is written; the Map tab shows a "no GPS track" notice while Detections/Keyframes still work.

## Edge Cases
- Malformed sidecar → parse never raises; it returns no points and the pipeline continues.
- SRT cue times are re-based to the first cue so offsets align with the video start.
- GPX with no track segments → falls back to route/waypoints (index-based offsets).

## UX States (if applicable)
- Empty: "No GPS track for this video" notice on the Map tab.
- Loading: map skeleton while the track + frames load.
- Error: track read failures surface via the standard `ErrorState`.

## Verification
- Test files: `services/api/tests/test_structure.py`, `services/api/tests/test_openapi_contract.py`
- Required cases: GPX sidecar happy path + malformed sidecar + no-track graceful path
- Focused verify command: `pnpm test:api`
- Default pre-PR verify command: `pnpm verify`
- Full local verify command: `pnpm verify:full` when E2E/live prerequisites apply
- Pass criteria: a GPX/SRT sidecar produces a non-empty `track.geojson`; a clip with no GPS still completes with an empty track.

## Related Docs
- [README.md](../../README.md)
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [docs/app-workflows.md](../app-workflows.md)
- [Inspection Map](inspection-map.md)
