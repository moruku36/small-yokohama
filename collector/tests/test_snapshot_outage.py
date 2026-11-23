from __future__ import annotations

from datetime import datetime, timedelta, timezone

from small_yokohama_collector.evaluate import evaluate_captured_snapshots
from small_yokohama_collector.gtfs_rt import RawVehicleReport
from small_yokohama_collector.gtfs_static import GtfsFeed, GtfsRoute, GtfsTrip
from small_yokohama_collector.matcher import MatchedReport
from small_yokohama_collector.snapshot import build_public_snapshot


def test_stale_expired_missing_timestamp_and_outage() -> None:
    feed = GtfsFeed(
        routes={"bb": GtfsRoute("bb", "BB", "ベイサイドブルー")},
        trips={"t0": GtfsTrip("t0", "bb", "WK", 0, None, "山下ふ頭")},
        stop_times_by_trip={},
        shapes={},
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
    now = datetime(2026, 11, 24, 3, 0, tzinfo=timezone.utc)
    trip = feed.trips["t0"]

    matched = [
        MatchedReport(
            RawVehicleReport("stale", "t0", "bb", 0, 139.6394, 35.4531, 135.0, 8.0, now - timedelta(seconds=135)),
            trip,
            139.6394,
            35.4531,
            135.0,
            None,
            "trip_id",
        ),
        MatchedReport(
            RawVehicleReport("expired", "t0", "bb", 0, 139.6394, 35.4531, 135.0, 8.0, now - timedelta(seconds=360)),
            trip,
            139.6394,
            35.4531,
            135.0,
            None,
            "trip_id",
        ),
        MatchedReport(
            RawVehicleReport("missing-ts", "t0", "bb", 0, 139.6394, 35.4531, 135.0, 8.0, None),
            trip,
            139.6394,
            35.4531,
            135.0,
            None,
            "trip_id",
        ),
    ]

    snap = build_public_snapshot(matched, [], feed, fetched_at=now, now_utc=now)
    # Only the 135s stale vehicle remains visible (frozen speed 0); expired & missing-ts are excluded
    assert len(snap["vehicles"]) == 1
    assert snap["vehicles"][0]["speedMps"] == 0.0
    assert "Frozen" in snap["vehicles"][0]["statusNote"]

    outage_snap = build_public_snapshot([], [], feed, fetched_at=now, now_utc=now, feed_error="timeout")
    assert outage_snap["feedHealth"] == "outage"
    assert outage_snap["vehicles"] == []


def test_step3_evaluator_requires_fresh_observations_in_both_directions() -> None:
    now = datetime(2026, 11, 24, 3, 0, tzinfo=timezone.utc)
    snaps = [
        {
            "generatedAt": now.isoformat(),
            "vehicles": [
                {"mode": "observed", "directionId": 0, "observedAt": (now - timedelta(seconds=20)).isoformat()},
                {"mode": "observed", "directionId": 1, "observedAt": (now - timedelta(seconds=35)).isoformat()},
            ],
        }
    ]
    report = evaluate_captured_snapshots(snaps)
    assert report.promote_observed_layer is True
    assert report.p95_observation_age_sec == 35.0
