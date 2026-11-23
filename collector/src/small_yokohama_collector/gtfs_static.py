"""Static GTFS-JP parser with Asia/Tokyo service-day & after-midnight handling."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date, datetime, timedelta
import io
from pathlib import Path
from zoneinfo import ZoneInfo
import zipfile

JST = ZoneInfo("Asia/Tokyo")

_WEEKDAY_COLS = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)


def parse_gtfs_date(raw: str) -> date:
    return datetime.strptime(raw.strip(), "%Y%m%d").date()


def parse_gtfs_time_sec(raw: str) -> int:
    parts = raw.strip().split(":")
    if len(parts) != 3:
        raise ValueError(f"Invalid GTFS time '{raw}'")
    h, m, s = int(parts[0]), int(parts[1]), int(parts[2])
    return h * 3600 + m * 60 + s


@dataclass(frozen=True, slots=True)
class GtfsRoute:
    route_id: str
    short_name: str
    long_name: str


@dataclass(frozen=True, slots=True)
class GtfsTrip:
    trip_id: str
    route_id: str
    service_id: str
    direction_id: int | None
    shape_id: str | None
    headsign: str


@dataclass(frozen=True, slots=True)
class GtfsStopTime:
    trip_id: str
    stop_id: str
    stop_sequence: int
    arrival_sec: int
    departure_sec: int


@dataclass(frozen=True, slots=True)
class ShapePoint:
    lon: float
    lat: float
    sequence: int


@dataclass(slots=True)
class GtfsFeed:
    routes: dict[str, GtfsRoute]
    trips: dict[str, GtfsTrip]
    stop_times_by_trip: dict[str, list[GtfsStopTime]]
    shapes: dict[str, list[ShapePoint]]
    calendar_rows: list[dict[str, str]]
    calendar_dates: list[dict[str, str]]

    def active_service_ids(self, service_day: date) -> set[str]:
        weekday_col = _WEEKDAY_COLS[service_day.weekday()]
        active: set[str] = set()

        for row in self.calendar_rows:
            start = parse_gtfs_date(row["start_date"])
            end = parse_gtfs_date(row["end_date"])
            if start <= service_day <= end and row.get(weekday_col, "0").strip() == "1":
                active.add(row["service_id"].strip())

        for row in self.calendar_dates:
            if parse_gtfs_date(row["date"]) != service_day:
                continue
            sid = row["service_id"].strip()
            exc = row["exception_type"].strip()
            if exc == "1":
                active.add(sid)
            elif exc == "2":
                active.discard(sid)

        return active

    def active_trips_at(self, now_utc: datetime) -> dict[str, GtfsTrip]:
        """Return active trips in Asia/Tokyo including after-midnight (>=24:00:00) continuity."""
        now_jst = now_utc.astimezone(JST)
        today = now_jst.date()
        today_sec = now_jst.hour * 3600 + now_jst.minute * 60 + now_jst.second

        today_services = self.active_service_ids(today)
        result: dict[str, GtfsTrip] = {}

        for trip in self.trips.values():
            if trip.service_id in today_services:
                result[trip.trip_id] = trip

        # After-midnight trips (00:00..04:00 JST) may belong to yesterday's service_day with >= 24:00:00 times
        if now_jst.hour < 4:
            yesterday = today - timedelta(days=1)
            yest_services = self.active_service_ids(yesterday)
            after_midnight_sec = today_sec + 86400
            for trip in self.trips.values():
                if trip.service_id not in yest_services:
                    continue
                sts = self.stop_times_by_trip.get(trip.trip_id, [])
                if sts and sts[-1].arrival_sec >= after_midnight_sec - 1800:
                    result[trip.trip_id] = trip

        return result

    def find_bayside_blue_route_ids(self) -> set[str]:
        matched: set[str] = set()
        for r in self.routes.values():
            haystack = f"{r.route_id} {r.short_name} {r.long_name}".lower()
            if "bayside" in haystack or "ベイサイドブルー" in haystack:
                matched.add(r.route_id)
        return matched


def _read_csv_from_zip(zf: zipfile.ZipFile, filename: str) -> list[dict[str, str]]:
    if filename not in zf.namelist():
        return []
    with zf.open(filename, "r") as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
        return list(csv.DictReader(text))


def load_gtfs_zip(zip_path: Path) -> GtfsFeed:
    with zipfile.ZipFile(zip_path, "r") as zf:
        routes: dict[str, GtfsRoute] = {}
        for row in _read_csv_from_zip(zf, "routes.txt"):
            rid = row["route_id"].strip()
            routes[rid] = GtfsRoute(
                route_id=rid,
                short_name=row.get("route_short_name", "").strip(),
                long_name=row.get("route_long_name", "").strip(),
            )

        trips: dict[str, GtfsTrip] = {}
        for row in _read_csv_from_zip(zf, "trips.txt"):
            tid = row["trip_id"].strip()
            dir_raw = row.get("direction_id", "").strip()
            trips[tid] = GtfsTrip(
                trip_id=tid,
                route_id=row["route_id"].strip(),
                service_id=row["service_id"].strip(),
                direction_id=int(dir_raw) if dir_raw != "" else None,
                shape_id=row.get("shape_id", "").strip() or None,
                headsign=row.get("trip_headsign", "").strip(),
            )

        stop_times_by_trip: dict[str, list[GtfsStopTime]] = {}
        for row in _read_csv_from_zip(zf, "stop_times.txt"):
            tid = row["trip_id"].strip()
            st = GtfsStopTime(
                trip_id=tid,
                stop_id=row["stop_id"].strip(),
                stop_sequence=int(row["stop_sequence"]),
                arrival_sec=parse_gtfs_time_sec(row["arrival_time"]),
                departure_sec=parse_gtfs_time_sec(row["departure_time"]),
            )
            stop_times_by_trip.setdefault(tid, []).append(st)
        for st_list in stop_times_by_trip.values():
            st_list.sort(key=lambda s: s.stop_sequence)

        shapes: dict[str, list[ShapePoint]] = {}
        for row in _read_csv_from_zip(zf, "shapes.txt"):
            sid = row["shape_id"].strip()
            shapes.setdefault(sid, []).append(
                ShapePoint(
                    lon=float(row["shape_pt_lon"]),
                    lat=float(row["shape_pt_lat"]),
                    sequence=int(row["shape_pt_sequence"]),
                )
            )
        for pts in shapes.values():
            pts.sort(key=lambda p: p.sequence)

        calendar_rows = _read_csv_from_zip(zf, "calendar.txt")
        calendar_dates = _read_csv_from_zip(zf, "calendar_dates.txt")

    return GtfsFeed(
        routes=routes,
        trips=trips,
        stop_times_by_trip=stop_times_by_trip,
        shapes=shapes,
        calendar_rows=calendar_rows,
        calendar_dates=calendar_dates,
    )
