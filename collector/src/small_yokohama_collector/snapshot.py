"""Public snapshot builder matching `schemas/vehicle-snapshot.schema.json`."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from typing import Any, Sequence

from .gtfs_static import GtfsFeed
from .matcher import MatchedReport, UnmatchedReport

FRESH_MAX_AGE_SEC = 90.0
STALE_MAX_AGE_SEC = 300.0


def anonymize_entity_id(raw_id: str, salt: str = "small-yokohama-v1") -> str:
    digest = hashlib.sha256(f"{salt}:{raw_id}".encode("utf-8")).hexdigest()[:12]
    return f"veh-{digest}"


def build_public_snapshot(
    matched: Sequence[MatchedReport],
    unmatched: Sequence[UnmatchedReport],
    feed: GtfsFeed,
    fetched_at: datetime,
    now_utc: datetime | None = None,
    feed_error: str | None = None,
) -> dict[str, Any]:
    ref_now = now_utc or fetched_at

    if feed_error is not None:
        return {
            "schemaVersion": "1.0.0",
            "generatedAt": ref_now.astimezone(timezone.utc).isoformat(),
            "fetchedAt": fetched_at.astimezone(timezone.utc).isoformat(),
            "feedHealth": "outage",
            "feedMessage": {
                "ja": "GTFS-RT 配信障害のため実測車両を非表示にしています。",
                "en": "GTFS-RT feed outage; observed markers withheld.",
            },
            "source": {
                "id": "odpt-yokohama-municipal-bus",
                "labelJa": "横浜市営バス GTFS-RT (ODPT)",
                "labelEn": "Yokohama Municipal Bus GTFS-RT (ODPT)",
                "attribution": "Transportation Bureau, City of Yokohama / ODPT",
            },
            "vehicles": [],
        }

    vehicles_out: list[dict[str, Any]] = []
    for m in matched:
        obs_at = m.raw.observed_at
        if obs_at is None:
            # Missing observation time cannot qualify as fresh or animated
            continue

        age_sec = max(0.0, (ref_now - obs_at).total_seconds())
        if age_sec > STALE_MAX_AGE_SEC:
            # Expired (> 5 minutes) -> remove measured marker
            continue

        is_stale = age_sec > FRESH_MAX_AGE_SEC
        route = feed.routes.get(m.trip.route_id)
        route_label = (
            route.long_name or route.short_name or m.trip.route_id
            if route
            else m.trip.route_id
        )

        vehicles_out.append({
            "entityId": anonymize_entity_id(m.raw.raw_entity_id),
            "mode": "observed",
            "routeId": m.trip.route_id,
            "routeLabelJa": route_label,
            "routeLabelEn": route_label,
            "tripId": m.trip.trip_id,
            "directionId": m.trip.direction_id,
            "directionLabelJa": m.trip.headsign or "運行中",
            "directionLabelEn": m.trip.headsign or "In Service",
            "observedAt": obs_at.astimezone(timezone.utc).isoformat(),
            "fetchedAt": fetched_at.astimezone(timezone.utc).isoformat(),
            "lon": round(m.lon, 6),
            "lat": round(m.lat, 6),
            "bearingDeg": round(m.bearing_deg, 1),
            "speedMps": 0.0 if is_stale else round(m.raw.speed_mps or 0.0, 2),
            "deckId": "ground-road",
            "roadElevationM": 2.2,
            "lengthM": 18.0,
            "widthM": 2.5,
            "heightM": 3.3,
            "articulated": True,
            "shapeProgress": m.shape_progress,
            "statusNote": (
                f"Frozen (stale {int(age_sec)}s > 90s)"
                if is_stale
                else f"Fresh observed ({m.match_method})"
            ),
        })

    active_trips = feed.active_trips_at(ref_now)
    if not active_trips:
        health = "no_service"
        msg_ja = "本日の該当便の運行時間帯外です。"
        msg_en = "Outside scheduled service window for today."
    elif len(vehicles_out) == 0 and len(unmatched) > 0:
        health = "no_match"
        msg_ja = "受信位置を当日の便に照合できませんでした（未照合として除外）。"
        msg_en = "Received reports could not match active trips and were withheld."
    else:
        health = "ok"
        msg_ja = f"横浜市営バス実測：照合 {len(vehicles_out)} 台 / 未照合 {len(unmatched)} 件"
        msg_en = f"Yokohama Municipal Bus observed: {len(vehicles_out)} matched / {len(unmatched)} unmatched"

    return {
        "schemaVersion": "1.0.0",
        "generatedAt": ref_now.astimezone(timezone.utc).isoformat(),
        "fetchedAt": fetched_at.astimezone(timezone.utc).isoformat(),
        "feedHealth": health,
        "feedMessage": {"ja": msg_ja, "en": msg_en},
        "source": {
            "id": "odpt-yokohama-municipal-bus",
            "labelJa": "横浜市営バス GTFS-RT (ODPT)",
            "labelEn": "Yokohama Municipal Bus GTFS-RT (ODPT)",
            "attribution": "Transportation Bureau, City of Yokohama / ODPT",
        },
        "vehicles": vehicles_out,
    }
