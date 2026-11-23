from __future__ import annotations

import json
import math
from pathlib import Path

from small_yokohama_pipeline.camera import OrthographicCamera, create_shinko_pilot_camera
from small_yokohama_pipeline.crs import epsg6677_to_wgs84, wgs84_to_epsg6677
from small_yokohama_pipeline.plateau import (
    expand_bbox,
    load_study_bounds,
    select_intersecting_mesh_codes,
)


def test_epsg6677_axis_order_and_roundtrip() -> None:
    lon, lat = 139.6394, 35.4531
    c = wgs84_to_epsg6677(lon, lat)
    assert c.easting < 0
    assert c.northing < 0
    lon2, lat2 = epsg6677_to_wgs84(c.easting, c.northing)
    assert abs(lon2 - lon) < 1e-8
    assert abs(lat2 - lat) < 1e-8


def test_camera_manifest_schema_matches_ts_core(tmp_path: Path) -> None:
    cam = create_shinko_pilot_camera()
    out = tmp_path / "camera.json"
    cam.write_json(out)
    reloaded = OrthographicCamera.from_manifest_json(out)
    assert reloaded.image_width_px == 3968
    assert reloaded.image_height_px == 3968
    assert math.isclose(reloaded.forward[2], -math.sqrt(0.5), rel_tol=1e-6)

    px_road, py_road, depth_road = reloaded.wgs84_to_image(139.6394, 35.4531, 2.2)
    px_deck, py_deck, depth_deck = reloaded.wgs84_to_image(139.6394, 35.4531, 6.9)
    assert depth_deck < depth_road
    assert py_deck < py_road


def test_study_bounds_from_geojson() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    bbox = load_study_bounds(repo_root / "scope" / "waterfront.geojson", "pilot")
    expanded = expand_bbox(bbox)
    assert expanded[0] < bbox[0]
    assert expanded[2] > bbox[2]
    codes = select_intersecting_mesh_codes(expanded)
    assert len(codes) >= 1
