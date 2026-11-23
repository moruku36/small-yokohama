"""Headless Blender (`bpy`) script for orthographic 2x2 tile rendering.

Run inside Blender:
    blender --background --python blender_render.py -- \
        --camera camera.json --gltf-dir ./gltf --out-dir ./working_tiles
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
from typing import Any


def encode_depth_meters_to_rg16(depth_m: float, near_m: float, far_m: float) -> tuple[int, int]:
    span = far_m - near_m
    norm = 0.0 if span <= 0.0 else min(1.0, max(0.0, (depth_m - near_m) / span))
    q16 = round(norm * 65535.0)
    return ((q16 >> 8) & 0xFF, q16 & 0xFF)


def build_blender_camera_rig(bpy_mod: Any, camera_manifest: dict[str, Any]) -> Any:
    """Configure a Blender orthographic camera matching `schemas/camera.schema.json`."""
    from mathutils import Matrix, Vector  # type: ignore[import-not-found]

    scene = bpy_mod.context.scene
    cam_data = bpy_mod.data.cameras.new("SmallYokohamaOrtho")
    cam_data.type = "ORTHO"
    grid = camera_manifest["workingGrid"]
    cam_data.ortho_scale = float(grid["tileSizePx"]) * float(camera_manifest["metersPerPixel"])
    cam_data.clip_start = max(0.1, float(camera_manifest["nearM"]))
    cam_data.clip_end = float(camera_manifest["farM"])

    cam_obj = bpy_mod.data.objects.new("SmallYokohamaOrtho", cam_data)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    right = Vector(camera_manifest["basis"]["right"])
    up = Vector(camera_manifest["basis"]["up"])
    forward = Vector(camera_manifest["basis"]["forward"])
    # Blender camera local axes: +X right, +Y up, -Z forward
    rot = Matrix((
        (right.x, up.x, -forward.x, 0.0),
        (right.y, up.y, -forward.y, 0.0),
        (right.z, up.z, -forward.z, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    ))
    cam_obj.matrix_world = rot
    return cam_obj


def compute_working_tile_camera_location(
    camera_manifest: dict[str, Any],
    col: int,
    row: int,
) -> tuple[float, float, float]:
    """Compute world-local `(x, y, z)` center for working tile `(col, row)`."""
    grid = camera_manifest["workingGrid"]
    tile_px = int(grid["tileSizePx"])
    overlap_px = int(grid["overlapPx"])
    stride_px = tile_px - overlap_px

    tile_center_px_x = col * stride_px + tile_px * 0.5
    tile_center_px_y = row * stride_px + tile_px * 0.5

    mpp = float(camera_manifest["metersPerPixel"])
    cx = (tile_center_px_x - float(camera_manifest["imageOriginPx"]["x"])) * mpp
    cy = (float(camera_manifest["imageOriginPx"]["y"]) - tile_center_px_y) * mpp

    origin = camera_manifest["cameraOriginLocalM"]
    r = camera_manifest["basis"]["right"]
    u = camera_manifest["basis"]["up"]
    return (
        origin[0] + cx * r[0] + cy * u[0],
        origin[1] + cx * r[1] + cy * u[1],
        origin[2] + cx * r[2] + cy * u[2],
    )


def render_in_blender(camera_json: Path, gltf_dir: Path, out_dir: Path) -> None:  # pragma: no cover
    import bpy  # type: ignore[import-not-found]
    import json

    camera_manifest = json.loads(camera_json.read_text(encoding="utf-8"))
    bpy.ops.wm.read_factory_settings(use_empty=True)

    for gltf_file in sorted(gltf_dir.glob("*.gltf")) + sorted(gltf_dir.glob("*.glb")):
        bpy.ops.import_scene.gltf(filepath=str(gltf_file))

    cam_obj = build_blender_camera_rig(bpy, camera_manifest)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    grid = camera_manifest["workingGrid"]
    scene.render.resolution_x = int(grid["tileSizePx"])
    scene.render.resolution_y = int(grid["tileSizePx"])
    scene.render.resolution_percentage = 100

    # Enable Z depth & object index AOVs for lossless depth and feature ID export
    view_layer = scene.view_layers[0]
    view_layer.use_pass_z = True
    view_layer.use_pass_object_index = True

    out_dir.mkdir(parents=True, exist_ok=True)
    for row in range(int(grid["rows"])):
        for col in range(int(grid["cols"])):
            loc = compute_working_tile_camera_location(camera_manifest, col, row)
            cam_obj.location = loc
            scene.render.filepath = str(out_dir / f"plain_tile_{col}_{row}.png")
            bpy.ops.render.render(write_still=True)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Headless Blender 2x2 orthographic renderer")
    parser.add_argument("--camera", required=True, type=Path)
    parser.add_argument("--gltf-dir", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args(argv)
    render_in_blender(args.camera, args.gltf_dir, args.out_dir)


if __name__ == "__main__":  # pragma: no cover
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    main(argv)
