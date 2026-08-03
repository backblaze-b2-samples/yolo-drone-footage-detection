"use client";

import { useEffect, useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { LatLngExpression, LatLngBoundsExpression } from "leaflet";

import type {
  FrameDetections,
  TrackGeoJSON,
} from "@yolo-drone-footage-detection/shared";

// GeoJSON stores coordinates as [lon, lat]; Leaflet wants [lat, lon].
type LatLon = [number, number];

function trackPolylines(track: TrackGeoJSON): LatLon[][] {
  const lines: LatLon[][] = [];
  for (const feature of track.features ?? []) {
    if (feature.geometry?.type !== "LineString") continue;
    const coords = feature.geometry.coordinates as number[][];
    const line = coords
      .filter((c) => Array.isArray(c) && c.length >= 2)
      .map((c) => [c[1], c[0]] as LatLon);
    if (line.length >= 2) lines.push(line);
  }
  return lines;
}

function detectionPoints(
  frames: FrameDetections[],
): { pos: LatLon; frame: FrameDetections }[] {
  return frames
    .filter((f) => f.lat !== null && f.lon !== null && f.detections.length > 0)
    .map((f) => ({ pos: [f.lat as number, f.lon as number] as LatLon, frame: f }));
}

function frameClassSummary(frame: FrameDetections): string {
  const counts = new Map<string, number>();
  for (const d of frame.detections) {
    counts.set(d.class_name, (counts.get(d.class_name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, n]) => `${name} ×${n}`).join(", ");
}

/** Fit the viewport to everything we're drawing, once, after mount. */
function FitBounds({ positions }: { positions: LatLon[] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 1) {
      map.setView(positions[0], 16);
    } else if (positions.length > 1) {
      map.fitBounds(positions as LatLngBoundsExpression, { padding: [24, 24] });
    }
  }, [map, positions]);
  return null;
}

export default function InspectionMapImpl({
  track,
  frames,
}: {
  track: TrackGeoJSON;
  frames: FrameDetections[];
}) {
  const lines = useMemo(() => trackPolylines(track), [track]);
  const points = useMemo(() => detectionPoints(frames), [frames]);

  const allPositions = useMemo<LatLon[]>(
    () => [...lines.flat(), ...points.map((p) => p.pos)],
    [lines, points],
  );

  const center: LatLngExpression = allPositions[0] ?? [0, 0];

  return (
    <MapContainer
      center={center}
      zoom={allPositions.length ? 14 : 2}
      scrollWheelZoom
      className="h-[480px] w-full rounded-xl border border-border"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {lines.map((line, i) => (
        <Polyline key={i} positions={line} pathOptions={{ color: "#2563eb", weight: 3 }} />
      ))}
      {points.map(({ pos, frame }) => (
        <CircleMarker
          key={frame.frame_index}
          center={pos}
          radius={6}
          pathOptions={{ color: "#16a34a", fillColor: "#16a34a", fillOpacity: 0.8 }}
        >
          <Popup>
            <div className="space-y-0.5 text-xs">
              <p className="font-medium">t = {frame.timestamp_s.toFixed(1)}s</p>
              <p>{frameClassSummary(frame)}</p>
            </div>
          </Popup>
        </CircleMarker>
      ))}
      <FitBounds positions={allPositions} />
    </MapContainer>
  );
}
