<!-- last_verified: 2026-08-03 -->
# Feature: Inspection Map

## Purpose
Show an inspection's results spatially: a Leaflet map of the GPS track with detection markers, plus an annotated-keyframe gallery and a class-count summary — all read from B2.

## Used By
- UI: `/inspections/[id]` (Map / Keyframes / Detections / Files tabs)
- API: `GET /inspections/{id}/track`, `GET /inspections/{id}/frames`, `GET /inspections/{id}/object?key=`, and the kept `GET /files?prefix=` for the Files tab

## Core Functions
- `components/inspections/inspection-map.tsx` (dynamic import, `ssr: false`) + `inspection-map-impl.tsx` (react-leaflet)
- `components/inspections/keyframe-gallery.tsx`, `detections-panel.tsx`, `inspection-files.tsx`
- `lib/queries.ts` hooks: `useInspectionTrack`, `useInspectionFrames`, `useInspectionKeyframeUrls`

## Canonical Files
- Pattern exemplar: `apps/web/src/components/inspections/inspection-detail.tsx`

## Inputs
- track: `TrackGeoJSON` (LineString + timestamped points)
- frames: `FrameDetections[]` (each with optional `lat`/`lon` and an `annotated_key`)

## Outputs
- Rendered map (Polyline track + `CircleMarker` detection points with popups)
- Annotated-keyframe gallery via presigned URLs
- Per-frame detections table + aggregate class-count badges
- side effect: presigned GET URLs for annotated frames and the inspection's objects

## Flow
- The detail view polls the manifest while the run is in flight, then loads the track + frames once `done`.
- Leaflet is dynamically imported with `ssr: false` (it touches `window`); tiles come from keyless OpenStreetMap raster tiles (no token).
- GeoJSON `[lon, lat]` is converted to Leaflet `[lat, lon]`; detection markers are placed on frames that carry coordinates; the view fits to the drawn bounds.
- Keyframe images are fetched as presigned URLs in one batch keyed by object key.

## Edge Cases
- No GPS track → the Map tab shows a "no GPS track" notice; Keyframes/Detections still render.
- No detections → the Detections tab suggests lowering the confidence threshold and re-running.
- Presign expiry → keyframe URLs are cached ~30 min and re-fetched when the frame set changes.

## UX States (if applicable)
- Empty: per-tab notices before a run completes.
- Loading: skeletons for the map, gallery, and tables.
- Error: inline `ErrorState` with retry.

## Verification
- Test files: `apps/web/src/lib/api-contract.test.ts`, `apps/web/src/lib/queries.test.ts`
- Required cases: track with points + empty track + presigned keyframe batch
- Focused verify command: `pnpm test:web`
- Default pre-PR verify command: `pnpm verify`
- Full local verify command: `pnpm verify:full` when E2E/live prerequisites apply
- Pass criteria: a done inspection with a track renders a map + markers; one without a track shows the graceful notice.

## Related Docs
- [README.md](../../README.md)
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [docs/app-workflows.md](../app-workflows.md)
- [Object Detection](object-detection.md)
