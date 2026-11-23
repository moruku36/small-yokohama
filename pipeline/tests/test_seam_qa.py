from __future__ import annotations

import numpy as np

from small_yokohama_pipeline.camera import create_shinko_pilot_camera
from small_yokohama_pipeline.qa import GroundControlPoint, verify_pilot_qa
from small_yokohama_pipeline.seam_and_dzi import stitch_2x2_tiles


def test_dp_seam_cutting_prefers_identical_overlap_regions() -> None:
    base = np.full((64, 64, 4), 120, dtype=np.uint8)
    base[:, :, 3] = 255
    t00 = base.copy()
    t10 = base.copy()
    t01 = base.copy()
    t11 = base.copy()

    stitched, metrics = stitch_2x2_tiles(t00, t10, t01, t11, overlap_px=8)
    assert stitched.shape == (120, 120, 4)
    assert all(m.mean_color_diff == 0.0 for m in metrics)


def test_qa_verification_checks_gcp_and_water() -> None:
    cam = create_shinko_pilot_camera()
    w, h = cam.image_width_px, cam.image_height_px
    surface_id = np.zeros((h, w, 4), dtype=np.uint8)
    depth = np.zeros((h, w, 4), dtype=np.uint8)
    depth[:, :, 2] = 1  # WATER

    gcps: list[GroundControlPoint] = []
    for i in range(6):
        lon = 139.639 + i * 0.0005
        lat = 35.452 + i * 0.0003
        px, py, _ = cam.wgs84_to_image(lon, lat, 10.0)
        ix, iy = round(px), round(py)
        fid = 10 + i
        surface_id[iy - 2 : iy + 3, ix - 2 : ix + 3, 2] = fid
        depth[iy - 2 : iy + 3, ix - 2 : ix + 3, 2] = 4  # BUILDING
        gcps.append(GroundControlPoint(f"gcp-{i}", fid, f"点{i}", f"Pt {i}", lon, lat, 10.0))

    _, seam_metrics = stitch_2x2_tiles(
        np.zeros((32, 32, 4), dtype=np.uint8),
        np.zeros((32, 32, 4), dtype=np.uint8),
        np.zeros((32, 32, 4), dtype=np.uint8),
        np.zeros((32, 32, 4), dtype=np.uint8),
        overlap_px=4,
    )

    report = verify_pilot_qa(
        release_id="test-release",
        camera=cam,
        gcps=gcps,
        surface_id_rgba=surface_id,
        depth_rgba=depth,
        seam_metrics=seam_metrics,
        water_sample_coords=[(50, 50), (80, 80)],
        metrics={"renderMs": 100.0, "tileCount": 4, "totalOutputBytes": 1000, "depthBytes": 200, "illustratedDziBytes": 500, "plainDziBytes": 300},
    )
    assert report["passed"] is True
