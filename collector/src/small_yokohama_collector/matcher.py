"""GTFS-RT report matching to GTFS-JP active trips, direction, and shape tolerance."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import math
from typing import Sequence

from .gtfs_static import GtfsFeed, GtfsTrip, ShapePoint
from .gtfs_rt import RawVehicleReport

DEFAULT_WATERFRONT_BBOX = (139.615, 35.436, 139.660, 35.474)


def _haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371008.8
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp * 0.5) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl * 0.5) ** 2
    return 2.0 * r * math.asin(min(1.0, math.sqrt(a)))


def snap_to_shape(
    lon: float,
    lat: float,
    shape: Sequence[ShapePoint],
) -> tuple[float, float, float, float, float]:
    """Project (lon, lat) onto shape polyline. Returns (dist_m, snapped_lon, snapped_lat, progress_0_1, bearing_deg)."""
    if len(shape) < 2:
        p = shape[0]
        return (_haversine_m(lon, lat, p.lon, p.lat), p.lon, p.lat, 0.0, 0.0)

    cos_lat = math.cos(math.radians(lat))
    m_per_deg_lat = 110950.0
    m_per_deg_lon = 111320.0 * cos_lat

    total_len = 0.0
    seg_lengths: list[float] = []
    for i in range(len(shape) - 1):
        a, b = shape[i], shape[i + 1]
        dx = (b.lon - a.lon) * m_per_deg_lon
        dy = (b.lat - a.lat) * m_per_deg_lat
        seg_len = math.hypot(dx, dy)
        seg_lengths.append(seg_len)
        total_len += seg_len

    best_dist = float("inf")
    best_lon = lon
    best_lat = lat
    best_prog = 0.0
    best_bearing = 0.0
    cum_len = 0.0

    for i in range(len(shape) - 1):
        a, b = shape[i], shape[i + 1]
        seg_len = seg_lengths[i]
        ax, ay = (a.lon - lon) * m_per_deg_lon, (a.lat - lat) * m_per_deg_lat
        bx, by = (b.lon - lon) * m_per_deg_lon, (b.lat - lat) * m_per_deg_lat
        vx, vy = bx - ax, by - ay
        denom = vx * vx + vy * vy
        t = 0.0 if denom < 1e-9 else max(0.0, min(1.0, -(ax * vx + ay * vy) / denom))
        px = ax + t * vx
        py = ay + t * vy
        dist = math.hypot(px, py)
        if dist < best_dist:
            best_dist = dist
            best_lon = a.lon + (b.lon - a.lon) * t
            best_lat = a.lat + (b.lat - a.lat) * t
            best_prog = (cum_len + t * seg_len) / total_len if total_len > 0 else 0.0
            best_bearing = (math.degrees(math.atan2(vx, vy)) + 360.0) % 360.0
        cum_len += seg_len

    return (best_dist, best_lon, best_lat, best_prog, best_bearing)


@dataclass(frozen=True, slots=True)
class MatchedReport:
    raw: RawVehicleReport
    trip: GtfsTrip
    lon: float
    lat: float
    bearing_deg: float
    shape_progress: float | None
    match_method: str


@dataclass(frozen=True, slots=True)
class UnmatchedReport:
    raw: RawVehicleReport
    reason: str


def match_reports_to_feed(
    reports: Sequence[RawVehicleReport],
    feed: GtfsFeed,
    now_utc: datetime,
    target_route_ids: set[str] | None = None,
    max_snap_distance_m: float = 45.0,
    bbox: tuple[float, float, float, float] = DEFAULT_WATERFRONT_BBOX,
) -> tuple[list[MatchedReport], list[UnmatchedReport]]:
    active_trips = feed.active_trips_at(now_utc)
    allowed_routes = target_route_ids if target_route_ids is not None else feed.find_bayside_blue_route_ids()

    matched: list[MatchedReport] = []
    unmatched: list[UnmatchedReport] = []

    for r in reports:
        if r.lon is None or r.lat is None:
            unmatched.append(UnmatchedReport(r, "missing_coordinates"))
            continue

        trip: GtfsTrip | None = None
        method = "none"

        # 1. Exact trip_id match against active service-day trips
        if r.trip_id and r.trip_id in active_trips:
            candidate = active_trips[r.trip_id]
            if not allowed_routes or candidate.route_id in allowed_routes:
                trip = candidate
                method = "trip_id"

        # 2. Fallback route_id + direction_id match if trip_id wasn't in feed
        if trip is None and r.route_id and (not allowed_routes or r.route_id in allowed_routes):
            for candidate in active_trips.values():
                if candidate.route_id == r.route_id and (
                    r.direction_id is None or candidate.direction_id == r.direction_id
                ):
                    trip = candidate
                    method = "route_direction"
                    break

        if trip is None:
            unmatched.append(UnmatchedReport(r, "unknown_route_or_trip"))
            continue

        if not (bbox[0] <= r.lon <= bbox[2] and bbox[1] <= r.lat <= bbox[3]):
            unmatched.append(UnmatchedReport(r, "outside_study_area"))
            continue

        out_lon, out_lat = r.lon, r.lat
        out_bearing = r.bearing_deg if r.bearing_deg is not None else 0.0
        progress: float | None = None

        # 3. Shape snapping strictly within tested tolerance
        if trip.shape_id and trip.shape_id in feed.shapes:
            dist_m, s_lon, s_lat, prog, s_bearing = snap_to_shape(
                r.lon, r.lat, feed.shapes[trip.shape_id]
            )
            if dist_m > max_snap_distance_m:
                unmatched.append(UnmatchedReport(r, "off_shape_tolerance"))
                continue
            out_lon, out_lat = s_lon, s_lat
            progress = round(prog, 4)
            if r.bearing_deg is None:
                out_bearing = s_bearing

        matched.append(
            MatchedReport(
                raw=r,
                trip=trip,
                lon=out_lon,
                lat=out_lat,
                bearing_deg=out_bearing,
                shape_progress=progress,
                match_method=method,
            )
        )

    return matched, unmatched
