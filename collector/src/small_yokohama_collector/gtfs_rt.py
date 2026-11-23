"""ODPT GTFS-RT VehiclePosition fetcher and Protocol Buffers decoder.

The ODPT access token is read strictly server-side from `ODPT_ACCESS_TOKEN`
and is redacted from all logs, exceptions, and public snapshot outputs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from google.transit import gtfs_realtime_pb2  # type: ignore[import-not-found]

ODPT_YOKOHAMA_BUS_VP_URL = (
    "https://api.odpt.org/api/v4/gtfs/realtime/yokohamamunicipal_vehicle_position"
)


@dataclass(frozen=True, slots=True)
class RawVehicleReport:
    raw_entity_id: str
    trip_id: str | None
    route_id: str | None
    direction_id: int | None
    lon: float | None
    lat: float | None
    bearing_deg: float | None
    speed_mps: float | None
    observed_at: datetime | None


def redact_token(text: str, token: str | None) -> str:
    if not token:
        return text
    return text.replace(token, "***REDACTED***")


def decode_gtfs_rt_vehicle_positions(payload: bytes) -> list[RawVehicleReport]:
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(payload)

    reports: list[RawVehicleReport] = []
    for entity in feed.entity:
        if not entity.HasField("vehicle"):
            continue
        vp = entity.vehicle
        trip = vp.trip if vp.HasField("trip") else None
        pos = vp.position if vp.HasField("position") else None

        obs_at: datetime | None = None
        if vp.HasField("timestamp") and vp.timestamp > 0:
            obs_at = datetime.fromtimestamp(int(vp.timestamp), tz=timezone.utc)

        reports.append(
            RawVehicleReport(
                raw_entity_id=entity.id or (vp.vehicle.id if vp.HasField("vehicle") else "unknown"),
                trip_id=(trip.trip_id or None) if trip else None,
                route_id=(trip.route_id or None) if trip else None,
                direction_id=(
                    int(trip.direction_id)
                    if trip and trip.HasField("direction_id")
                    else None
                ),
                lon=float(pos.longitude) if pos else None,
                lat=float(pos.latitude) if pos else None,
                bearing_deg=(
                    float(pos.bearing) if pos and pos.HasField("bearing") else None
                ),
                speed_mps=(
                    float(pos.speed) if pos and pos.HasField("speed") else None
                ),
                observed_at=obs_at,
            )
        )
    return reports


def fetch_odpt_vehicle_positions(
    endpoint_url: str = ODPT_YOKOHAMA_BUS_VP_URL,
    token: str | None = None,
    timeout_sec: float = 10.0,
) -> list[RawVehicleReport]:
    """Fetch and decode GTFS-RT VehiclePosition using `ODPT_ACCESS_TOKEN`."""
    resolved_token = token or os.environ.get("ODPT_ACCESS_TOKEN", "").strip()
    if not resolved_token:
        raise RuntimeError("ODPT_ACCESS_TOKEN is not configured")

    sep = "&" if "?" in endpoint_url else "?"
    full_url = f"{endpoint_url}{sep}{urlencode({'acl:consumerKey': resolved_token})}"
    req = Request(full_url, headers={"User-Agent": "small-yokohama-collector/0.1"})

    try:
        with urlopen(req, timeout=timeout_sec) as resp:
            if resp.status != 200:
                raise RuntimeError(f"ODPT returned HTTP {resp.status}")
            payload = resp.read()
    except Exception as exc:
        raise RuntimeError(redact_token(f"ODPT fetch failed: {exc}", resolved_token)) from None

    return decode_gtfs_rt_vehicle_positions(payload)
