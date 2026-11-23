# Small Yokohama Bus Collector (`collector/`)

Server-side Python GTFS-JP static schedule parser and ODPT GTFS-RT `VehiclePosition` collector.

## Security & Operational Rules

- Set `ODPT_ACCESS_TOKEN` exclusively in the collector environment. Never pass the token to the browser viewer or commit it.
- The collector polls every 30 seconds (`--poll-sec 30`), matches active trips in `Asia/Tokyo` (including after-midnight `>=24:00:00` times and `calendar_dates.txt` exceptions), snaps positions strictly within 45 metres of matched shapes, and anonymizes `entityId`.
- Observation timestamps are preserved verbatim across cache refreshes (`observedAt` is never overwritten by `fetchedAt`).

## Step 3 Acceptance Evaluation

Run `python -m small_yokohama_collector.evaluate --snapshots-dir ./captures` to measure sample count, match rate, unmatched reasons, p95 observation age, and both-direction freshness coverage for Bayside Blue.
