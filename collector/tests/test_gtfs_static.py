from __future__ import annotations

from datetime import datetime, timezone
import io
from pathlib import Path
import zipfile

from small_yokohama_collector.gtfs_static import JST, load_gtfs_zip


def _build_test_gtfs_zip(dest: Path) -> Path:
    files = {
        "routes.txt": "route_id,route_short_name,route_long_name\nbb,BB,ベイサイドブルー\n",
        "calendar.txt": (
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
            "WK,1,1,1,1,1,0,0,20261101,20261231\n"
            "HOL,0,0,0,0,0,1,1,20261101,20261231\n"
        ),
        "calendar_dates.txt": "service_id,date,exception_type\nWK,20261124,2\nHOL,20261124,1\n",
        "trips.txt": (
            "route_id,service_id,trip_id,direction_id,trip_headsign,shape_id\n"
            "bb,HOL,trip-late,0,山下ふ頭,shape-0\n"
        ),
        "stop_times.txt": (
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
            "trip-late,24:30:00,24:30:00,stop-1,1\n"
            "trip-late,25:10:00,25:10:00,stop-2,2\n"
        ),
        "shapes.txt": (
            "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n"
            "shape-0,35.4535,139.6390,1\n"
            "shape-0,35.4525,139.6425,2\n"
        ),
    }
    with zipfile.ZipFile(dest, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return dest


def test_calendar_exceptions_and_after_midnight_jst(tmp_path: Path) -> None:
    zip_path = _build_test_gtfs_zip(tmp_path / "gtfs.zip")
    feed = load_gtfs_zip(zip_path)
    assert feed.find_bayside_blue_route_ids() == {"bb"}

    # Tuesday 2026-11-24 has WK removed (exception 2) and HOL added (exception 1)
    day_utc = datetime(2026, 11, 24, 12, 0, tzinfo=JST).astimezone(timezone.utc)
    active = feed.active_trips_at(day_utc)
    assert "trip-late" in active

    # After-midnight 2026-11-25 00:45 JST belongs to 2026-11-24 HOL service (24:45:00)
    after_mid_utc = datetime(2026, 11, 25, 0, 45, tzinfo=JST).astimezone(timezone.utc)
    active_night = feed.active_trips_at(after_mid_utc)
    assert "trip-late" in active_night
