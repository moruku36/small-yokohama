from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from google.transit import gtfs_realtime_pb2  # type: ignore[import-not-found]

from small_yokohama_collector.gtfs_rt import decode_gtfs_rt_vehicle_positions, redact_token
from small_yokohama_collector.gtfs_static import GtfsFeed, GtfsRoute, GtfsTrip, ShapePoint
from small_yokohama_collector.matcher import match_reports_to_feed
from small_yokohama_collector.snapshot import build_public_snapshot


def _make_sample_feed() -> GtfsFeed:
    return GtfsFeed(
        routes={"bb": GtfsRoute("bb", "BB", "ベイサイドブルー")},
        trips={"t0": GtfsTrip("t0", "bb", "WK", 0, "s0", "山下ふ頭")},
        stop_times_by_trip={},
        shapes={
            "s0": [
                ShapePoint(lon=139.6390, lat=35.4535, sequence=1),
                ShapePoint(lon=139.6400, lat=35.4528, sequence=2),
            ]
        },
        calendar_rows=[
            {
                "service_id": "WK",
                "monday": "1",
                "tuesday": "1",
                "wednesday": "1",
                "thursday": "1",
                "friday": "1",
                "saturday": "0",
                "sunday": "0",
                "start_date": "20261101",
                "end_date": "20261231",
            }
        ],
        calendar_dates=[],
    )


def test_protobuf_decode_and_token_redaction() -> None:
    msg = gtfs_realtime_pb2.FeedMessage()
    msg.header.gtfs_realtime_version = "2.0"
    ent = msg.entity.add()
    ent.id = "bus-raw-101"
    ent.vehicle.trip.trip_id = "t0"
    ent.vehicle.trip.route_id = "bb"
    ent.vehicle.position.latitude = 35.4531
    ent.vehicle.position.longitude = 139.6394
    ent.vehicle.timestamp = 1795507200

    reports = decode_gtfs_rt_vehicle_positions(msg.SerializeToString())
    assert len(reports) == 1
    assert reports[0].trip_id == "t0"
    assert reports[0].observed_at is not None

    assert "secret-123" not in redact_token("https://api.odpt.org?acl:consumerKey=secret-123", "secret-123")


def test_shape_snap_tolerance_and_freshness_boundaries() -> None:
    feed = _make_sample_feed()
    now_utc = datetime(2026, 11, 24, 3, 0, tzinfo=timezone.utc)

    msg = gtfs_realtime_pb2.FeedMessage()
    msg.header.gtfs_realtime_version = "2.0"
    # Vehicle 1: fresh (45s old), within 45m of shape
    e1 = msg.entity.add()
    e1.id = "v-fresh"
    e1.vehicle.trip.trip_id = "t0"
    e1.vehicle.position.latitude = 35.45315
    e1.vehicle.position.longitude = 139.6395
    e1.vehicle.timestamp = int((now_utc - timedelta(seconds=45)).timestamp())

    # Vehicle 2: off-shape by >200m -> rejected as unmatched
    e2 = msg.entity.add()
    e2.id = "v-offshape"
    e2.vehicle.trip.trip_id = "t0"
    e2.vehicle.position.latitude = 35.4600
    e2.vehicle.position.longitude = 139.6450
    e2.vehicle.timestamp = int(now_utc.timestamp())

    reports = decode_gtfs_rt_vehicle_positions(msg.SerializeToString())
    matched, unmatched = match_reports_to_feed(reports, feed, now_utc)
    assert len(matched) == 1
    assert len(unmatched) == 1
    assert unmatched[0].reason == "off_shape_tolerance"

    snap = build_public_snapshot(matched, unmatched, feed, fetched_at=now_utc, now_utc=now_utc)
    assert snap["feedHealth"] == "ok"
    assert len(snap["vehicles"]) == 1
    # Raw vehicle ID must be anonymized
    assert snap["vehicles"][0]["entityId"] != "v-fresh"
