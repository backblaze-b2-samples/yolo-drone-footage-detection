"""GPS track extraction → GeoJSON, tiered and graceful.

The app is honest about "extracting GPS from a video": it tries, in order,
(1) an uploaded GPX/SRT sidecar, (2) embedded telemetry via ``exiftool`` when
available, and (3) gracefully degrades to "no track" — the detection pipeline
never fails just because a clip lacks GPS.

Track points carry a time OFFSET in seconds from the start of the track, which
lines up with the sampled-frame timestamps so detections can be correlated to
coordinates by time.
"""

import json
import logging
import re
import subprocess
from typing import NamedTuple

from app.config import settings

logger = logging.getLogger(__name__)


class TrackPoint(NamedTuple):
    t: float  # seconds from the start of the track
    lat: float
    lon: float


def _parse_gpx(data: bytes) -> list[TrackPoint]:
    import gpxpy

    gpx = gpxpy.parse(data.decode("utf-8", errors="replace"))
    raw: list[tuple[float | None, float, float]] = []
    start_time = None
    for track in gpx.tracks:
        for segment in track.segments:
            for pt in segment.points:
                ts = pt.time.timestamp() if pt.time else None
                if ts is not None and start_time is None:
                    start_time = ts
                raw.append((ts, pt.latitude, pt.longitude))
    # Route/waypoint fallback if there were no track segments.
    if not raw:
        for wp in gpx.waypoints:
            raw.append((None, wp.latitude, wp.longitude))

    points: list[TrackPoint] = []
    for i, (ts, lat, lon) in enumerate(raw):
        offset = ts - start_time if ts is not None and start_time is not None else float(i)
        points.append(TrackPoint(round(offset, 3), lat, lon))
    return points


_SRT_TIME = re.compile(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->")
# DJI/dashcam subtitle GPS appears in a few shapes; match lat/lon pairs loosely.
_SRT_LATLON = re.compile(
    r"latitude[:\s]*(-?\d+\.\d+).*?longitude[:\s]*(-?\d+\.\d+)",
    re.IGNORECASE | re.DOTALL,
)
_SRT_GPS_PAREN = re.compile(r"GPS\s*\(?\s*(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)", re.IGNORECASE)


def _parse_srt(data: bytes) -> list[TrackPoint]:
    text = data.decode("utf-8", errors="replace")
    blocks = re.split(r"\n\s*\n", text)
    points: list[TrackPoint] = []
    for block in blocks:
        tmatch = _SRT_TIME.search(block)
        if not tmatch:
            continue
        h, m, s, ms = (int(g) for g in tmatch.groups())
        offset = h * 3600 + m * 60 + s + ms / 1000.0
        latlon = _SRT_LATLON.search(block)
        if not latlon:
            # DJI often writes "GPS(lon,lat)" — try the paren form (lon first).
            paren = _SRT_GPS_PAREN.search(block)
            if not paren:
                continue
            lon, lat = float(paren.group(1)), float(paren.group(2))
        else:
            lat, lon = float(latlon.group(1)), float(latlon.group(2))
        points.append(TrackPoint(round(offset, 3), lat, lon))
    # Re-base offsets to the first cue so they align with the video start.
    if points:
        base = points[0].t
        points = [TrackPoint(round(p.t - base, 3), p.lat, p.lon) for p in points]
    return points


def parse_sidecar(data: bytes, filename: str) -> list[TrackPoint]:
    """Parse an uploaded GPX/SRT sidecar into track points. Never raises."""
    name = (filename or "").lower()
    try:
        if name.endswith(".gpx"):
            return _parse_gpx(data)
        if name.endswith(".srt"):
            return _parse_srt(data)
        # Unknown extension: sniff for an XML/GPX signature, else try SRT.
        head = data[:256].lstrip()
        if head.startswith(b"<?xml") or b"<gpx" in head.lower():
            return _parse_gpx(data)
        return _parse_srt(data)
    except Exception:
        logger.warning("Sidecar GPS parse failed for %s", filename, exc_info=True)
        return []


def extract_embedded_track(video_path: str) -> list[TrackPoint]:
    """Tier 2: pull embedded GPS (e.g. GoPro GPMF) via exiftool, if present."""
    exiftool = settings.exiftool_path or "exiftool"
    try:
        proc = subprocess.run(
            [exiftool, "-ee", "-json", "-GPSLatitude", "-GPSLongitude", video_path],
            capture_output=True,
            timeout=120,
            check=False,
        )
        if proc.returncode != 0 or not proc.stdout:
            return []
        records = json.loads(proc.stdout)
    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return []
    except Exception:
        logger.warning("exiftool GPS extraction failed", exc_info=True)
        return []

    points: list[TrackPoint] = []
    for i, rec in enumerate(records):
        lat, lon = rec.get("GPSLatitude"), rec.get("GPSLongitude")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            points.append(TrackPoint(float(i), float(lat), float(lon)))
    return points


def correlate(track: list[TrackPoint], timestamp_s: float) -> tuple[float | None, float | None]:
    """Nearest track point to a frame timestamp (by time offset). Clamps to ends."""
    if not track:
        return None, None
    best = min(track, key=lambda p: abs(p.t - timestamp_s))
    return best.lat, best.lon


def build_geojson(track: list[TrackPoint]) -> dict:
    """A FeatureCollection: one LineString for the path + timestamped points."""
    features: list[dict] = []
    if len(track) >= 2:
        features.append(
            {
                "type": "Feature",
                "properties": {"kind": "track"},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[p.lon, p.lat] for p in track],
                },
            }
        )
    for p in track:
        features.append(
            {
                "type": "Feature",
                "properties": {"kind": "point", "t": p.t},
                "geometry": {"type": "Point", "coordinates": [p.lon, p.lat]},
            }
        )
    return {"type": "FeatureCollection", "features": features}
