"""Step 3 acceptance evaluator for Bayside Blue live observation coverage and freshness."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
import json
from pathlib import Path
from typing import Any, Sequence


@dataclass(frozen=True, slots=True)
class Step3EvaluationReport:
    sample_count: int
    matched_count: int
    unmatched_count: int
    match_rate: float
    unmatched_reasons: dict[str, int]
    p95_observation_age_sec: float | None
    has_fresh_direction_0: bool
    has_fresh_direction_1: bool
    promote_observed_layer: bool


def evaluate_captured_snapshots(
    snapshots: Sequence[dict[str, Any]],
    unmatched_logs: Sequence[dict[str, str]] = (),
    fresh_threshold_sec: float = 90.0,
) -> Step3EvaluationReport:
    matched_ages: list[float] = []
    has_dir_0 = False
    has_dir_1 = False
    matched_count = 0

    for snap in snapshots:
        gen_dt = datetime.fromisoformat(snap["generatedAt"])
        for v in snap.get("vehicles", []):
            if v.get("mode") != "observed" or not v.get("observedAt"):
                continue
            matched_count += 1
            obs_dt = datetime.fromisoformat(v["observedAt"])
            age = max(0.0, (gen_dt - obs_dt).total_seconds())
            matched_ages.append(age)
            if age <= fresh_threshold_sec:
                if v.get("directionId") == 0:
                    has_dir_0 = True
                elif v.get("directionId") == 1:
                    has_dir_1 = True

    reasons: dict[str, int] = {}
    for entry in unmatched_logs:
        r = entry.get("reason", "unknown")
        reasons[r] = reasons.get(r, 0) + 1

    unmatched_count = len(unmatched_logs)
    total = matched_count + unmatched_count
    match_rate = (matched_count / total) if total > 0 else 0.0

    p95: float | None = None
    if matched_ages:
        sorted_ages = sorted(matched_ages)
        idx = min(len(sorted_ages) - 1, int(round(0.95 * (len(sorted_ages) - 1))))
        p95 = round(sorted_ages[idx], 2)

    promote = bool(has_dir_0 and has_dir_1 and p95 is not None and p95 <= fresh_threshold_sec)

    return Step3EvaluationReport(
        sample_count=len(snapshots),
        matched_count=matched_count,
        unmatched_count=unmatched_count,
        match_rate=round(match_rate, 4),
        unmatched_reasons=reasons,
        p95_observation_age_sec=p95,
        has_fresh_direction_0=has_dir_0,
        has_fresh_direction_1=has_dir_1,
        promote_observed_layer=promote,
    )


def main() -> None:  # pragma: no cover
    parser = argparse.ArgumentParser(description="Evaluate Step 3 Bayside Blue capture metrics")
    parser.add_argument("--snapshots-dir", required=True, type=Path)
    args = parser.parse_args()
    snaps = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(args.snapshots_dir.glob("*.json"))]
    rep = evaluate_captured_snapshots(snaps)
    print(json.dumps(rep.__dict__, indent=2))


if __name__ == "__main__":  # pragma: no cover
    main()
