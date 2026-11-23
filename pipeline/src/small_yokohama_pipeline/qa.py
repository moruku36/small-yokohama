"""Step 1 acceptance QA verification and pilot cost experiment tracking."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
import math
from pathlib import Path
from typing import Sequence
import numpy as np

from .camera import OrthographicCamera
from .seam_and_dzi import SeamMetrics


@dataclass(frozen=True, slots=True)
class GroundControlPoint:
    id: str
    feature_id: int
    label_ja: str
    label_en: str
    lon: float
    lat: float
    elevation_m: float


def decode_feature_id_rgb(r: int, g: int, b: int) -> int:
    return ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF)


def verify_pilot_qa(
    release_id: str,
    camera: OrthographicCamera,
    gcps: Sequence[GroundControlPoint],
    surface_id_rgba: np.ndarray,
    depth_rgba: np.ndarray,
    seam_metrics: Sequence[SeamMetrics],
    water_sample_coords: Sequence[tuple[int, int]],
    metrics: dict[str, int | float],
    gcp_threshold_px: float = 8.0,
) -> dict[str, object]:
    """Run Step 1 QA: >=6 GCPs within threshold, seam checks, and zero buildings in water."""
    height, width, _ = surface_id_rgba.shape
    gcp_checks: list[dict[str, object]] = []
    max_disp = 0.0

    for gcp in gcps:
        exp_px, exp_py, _ = camera.wgs84_to_image(gcp.lon, gcp.lat, gcp.elevation_m)
        cx, cy = round(exp_px), round(exp_py)
        best_dist = float("inf")
        obs_px, obs_py = float(cx), float(cy)
        matched = False

        for dy in range(-16, 17):
            py = cy + dy
            if py < 0 or py >= height:
                continue
            for dx in range(-16, 17):
                px = cx + dx
                if px < 0 or px >= width:
                    continue
                r, g, b, _ = surface_id_rgba[py, px]
                if decode_feature_id_rgb(int(r), int(g), int(b)) == gcp.feature_id:
                    dist = math.hypot(px + 0.5 - exp_px, py + 0.5 - exp_py)
                    if dist < best_dist:
                        best_dist = dist
                        obs_px, obs_py = px + 0.5, py + 0.5
                        matched = True

        disp = round(best_dist, 3) if matched else 999.0
        max_disp = max(max_disp, disp)
        gcp_checks.append({
            "id": gcp.id,
            "labelJa": gcp.label_ja,
            "labelEn": gcp.label_en,
            "expectedPx": round(exp_px, 2),
            "expectedPy": round(exp_py, 2),
            "observedPx": round(obs_px, 2),
            "observedPy": round(obs_py, 2),
            "displacementPx": disp,
            "featureId": gcp.feature_id,
            "matched": matched,
            "passed": bool(matched and disp <= gcp_threshold_px),
        })

    invented_buildings = 0
    for wx, wy in water_sample_coords:
        if 0 <= wx < width and 0 <= wy < height:
            surface_kind = int(depth_rgba[wy, wx, 2])
            if surface_kind == 4:  # SURFACE_KIND.BUILDING
                invented_buildings += 1

    water_ok = len(water_sample_coords) > 0 and invented_buildings == 0
    seams_out = [
        {
            "seamId": s.seam_id,
            "orientation": s.orientation,
            "lengthPx": s.length_px,
            "meanColorDiff": round(s.mean_color_diff, 4),
            "maxColorDiff": round(s.max_color_diff, 4),
            "passed": s.mean_color_diff <= 8.0,
        }
        for s in seam_metrics
    ]

    passed = (
        len(gcp_checks) >= 6
        and all(bool(c["passed"]) for c in gcp_checks)
        and all(bool(s["passed"]) for s in seams_out)
        and water_ok
    )

    return {
        "schemaVersion": "1.0.0",
        "releaseId": release_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "gcpThresholdPx": gcp_threshold_px,
        "maxGcpDisplacementPx": max_disp,
        "gcpChecks": gcp_checks,
        "seamChecks": seams_out,
        "waterIntegrity": {
            "waterSamplePixels": len(water_sample_coords),
            "inventedBuildingPixels": invented_buildings,
            "passed": water_ok,
        },
        "metrics": metrics,
        "passed": passed,
    }


def write_cost_experiment_log(
    out_path: Path,
    render_minutes: float,
    tile_attempts: dict[str, int],
    price_per_attempt_usd: float,
    land_mixed_corridor_tiles: int,
    metrics: dict[str, int | float],
) -> dict[str, object]:
    """Record pilot cost experiment numbers before commissioning full waterfront corridor."""
    accepted = max(1, len(tile_attempts))
    mean_attempts = sum(tile_attempts.values()) / accepted
    estimated_corridor_gen_usd = round(land_mixed_corridor_tiles * mean_attempts * price_per_attempt_usd, 2)
    payload = {
        "renderMinutes": render_minutes,
        "tileAttempts": tile_attempts,
        "meanAttemptsPerAcceptedTile": round(mean_attempts, 2),
        "pricePerAttemptUsd": price_per_attempt_usd,
        "landMixedCorridorTiles": land_mixed_corridor_tiles,
        "estimatedCorridorGenerationUsd": estimated_corridor_gen_usd,
        "bytesMetrics": metrics,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload
