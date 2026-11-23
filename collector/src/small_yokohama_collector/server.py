"""Lightweight shared-snapshot collector HTTP server (30s polling target)."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time
from typing import Any

from .gtfs_rt import ODPT_YOKOHAMA_BUS_VP_URL, fetch_odpt_vehicle_positions
from .gtfs_static import GtfsFeed, load_gtfs_zip
from .matcher import match_reports_to_feed
from .snapshot import build_public_snapshot


class CollectorState:
    def __init__(self, feed: GtfsFeed, endpoint_url: str) -> None:
        self.feed = feed
        self.endpoint_url = endpoint_url
        self._lock = threading.Lock()
        self._snapshot: dict[str, Any] = build_public_snapshot(
            matched=[],
            unmatched=[],
            feed=feed,
            fetched_at=datetime.now(timezone.utc),
            feed_error="Collector initializing",
        )

    def poll_once(self) -> None:
        now_utc = datetime.now(timezone.utc)
        try:
            reports = fetch_odpt_vehicle_positions(endpoint_url=self.endpoint_url)
            matched, unmatched = match_reports_to_feed(reports, self.feed, now_utc)
            snap = build_public_snapshot(matched, unmatched, self.feed, fetched_at=now_utc, now_utc=now_utc)
        except Exception as exc:
            snap = build_public_snapshot(
                matched=[],
                unmatched=[],
                feed=self.feed,
                fetched_at=now_utc,
                now_utc=now_utc,
                feed_error=str(exc),
            )
        with self._lock:
            self._snapshot = snap

    def get_snapshot_json(self) -> bytes:
        with self._lock:
            return json.dumps(self._snapshot).encode("utf-8")


def serve_collector(
    gtfs_zip: Path,
    host: str = "127.0.0.1",
    port: int = 8787,
    poll_interval_sec: float = 30.0,
    endpoint_url: str = ODPT_YOKOHAMA_BUS_VP_URL,
) -> None:  # pragma: no cover
    feed = load_gtfs_zip(gtfs_zip)
    state = CollectorState(feed, endpoint_url)
    stop_event = threading.Event()

    def _poller() -> None:
        while not stop_event.is_set():
            state.poll_once()
            stop_event.wait(poll_interval_sec)

    thread = threading.Thread(target=_poller, daemon=True)
    thread.start()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path.startswith("/snapshot.json"):
                body = state.get_snapshot_json()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "max-age=10, public")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if self.path.startswith("/health"):
                body = b'{"status":"ok"}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_response(404)
            self.end_headers()

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    finally:
        stop_event.set()
        server.server_close()


def main() -> None:  # pragma: no cover
    parser = argparse.ArgumentParser(description="Small Yokohama GTFS-RT Bus Collector")
    parser.add_argument("--gtfs-zip", required=True, type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8787, type=int)
    parser.add_argument("--poll-sec", default=30.0, type=float)
    args = parser.parse_args()
    serve_collector(args.gtfs_zip, host=args.host, port=args.port, poll_interval_sec=args.poll_sec)


if __name__ == "__main__":  # pragma: no cover
    main()
