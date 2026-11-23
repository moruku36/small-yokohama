"""Orthographic 45-degree camera contract shared with TypeScript viewer & builder."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Any

from .crs import Epsg6677Coord, epsg6677_to_wgs84, wgs84_to_epsg6677

Vec3 = tuple[float, float, float]


def _dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _norm(v: Vec3) -> Vec3:
    length = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if length == 0.0:
        raise ValueError("Cannot normalize zero vector")
    return (v[0] / length, v[1] / length, v[2] / length)


@dataclass(frozen=True, slots=True)
class OrthographicCamera:
    origin_epsg6677: Epsg6677Coord
    center_local_m: Vec3
    azimuth_deg: float
    depression_deg: float
    ref_distance_m: float
    camera_origin_local_m: Vec3
    right: Vec3
    up: Vec3
    forward: Vec3
    meters_per_pixel: float
    near_m: float
    far_m: float
    image_width_px: int
    image_height_px: int
    image_origin_px: tuple[float, float]
    working_cols: int = 2
    working_rows: int = 2
    working_tile_size_px: int = 2048
    working_overlap_px: int = 128
    dzi_tile_size: int = 256
    dzi_overlap: int = 1
    dzi_format: str = "png"

    def wgs84_to_local(self, lon: float, lat: float, elevation_m: float) -> Vec3:
        projected = wgs84_to_epsg6677(lon, lat)
        return (
            projected.easting - self.origin_epsg6677.easting,
            projected.northing - self.origin_epsg6677.northing,
            elevation_m,
        )

    def local_to_wgs84(self, local: Vec3) -> tuple[float, float, float]:
        lon, lat = epsg6677_to_wgs84(
            local[0] + self.origin_epsg6677.easting,
            local[1] + self.origin_epsg6677.northing,
        )
        return (lon, lat, local[2])

    def local_to_image(self, local: Vec3) -> tuple[float, float, float]:
        d = _sub(local, self.camera_origin_local_m)
        cx = _dot(d, self.right)
        cy = _dot(d, self.up)
        depth_m = _dot(d, self.forward)
        px = self.image_origin_px[0] + cx / self.meters_per_pixel
        py = self.image_origin_px[1] - cy / self.meters_per_pixel
        return (px, py, depth_m)

    def wgs84_to_image(self, lon: float, lat: float, elevation_m: float) -> tuple[float, float, float]:
        return self.local_to_image(self.wgs84_to_local(lon, lat, elevation_m))

    def to_manifest_dict(self) -> dict[str, Any]:
        data_tile_px = self.image_width_px // self.working_cols
        return {
            "schemaVersion": "1.0.0",
            "epsg": "EPSG:6677",
            "axisOrder": "easting-northing",
            "originEpsg6677": {
                "easting": self.origin_epsg6677.easting,
                "northing": self.origin_epsg6677.northing,
            },
            "centerLocalM": list(self.center_local_m),
            "azimuthDeg": self.azimuth_deg,
            "depressionDeg": self.depression_deg,
            "refDistanceM": self.ref_distance_m,
            "cameraOriginLocalM": list(self.camera_origin_local_m),
            "basis": {
                "right": list(self.right),
                "up": list(self.up),
                "forward": list(self.forward),
            },
            "metersPerPixel": self.meters_per_pixel,
            "nearM": self.near_m,
            "farM": self.far_m,
            "imageWidthPx": self.image_width_px,
            "imageHeightPx": self.image_height_px,
            "imageOriginPx": {
                "x": self.image_origin_px[0],
                "y": self.image_origin_px[1],
            },
            "workingGrid": {
                "cols": self.working_cols,
                "rows": self.working_rows,
                "tileSizePx": self.working_tile_size_px,
                "overlapPx": self.working_overlap_px,
            },
            "dzi": {
                "tileSize": self.dzi_tile_size,
                "overlap": self.dzi_overlap,
                "format": self.dzi_format,
            },
            "dataTileGrid": {
                "tileSizePx": data_tile_px,
                "cols": self.working_cols,
                "rows": self.working_rows,
            },
        }

    def write_json(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_manifest_dict(), indent=2), encoding="utf-8")

    @classmethod
    def from_manifest_json(cls, path: Path) -> OrthographicCamera:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return cls(
            origin_epsg6677=Epsg6677Coord(
                easting=float(raw["originEpsg6677"]["easting"]),
                northing=float(raw["originEpsg6677"]["northing"]),
            ),
            center_local_m=tuple(raw["centerLocalM"]),  # type: ignore[arg-type]
            azimuth_deg=float(raw["azimuthDeg"]),
            depression_deg=float(raw["depressionDeg"]),
            ref_distance_m=float(raw["refDistanceM"]),
            camera_origin_local_m=tuple(raw["cameraOriginLocalM"]),  # type: ignore[arg-type]
            right=tuple(raw["basis"]["right"]),  # type: ignore[arg-type]
            up=tuple(raw["basis"]["up"]),  # type: ignore[arg-type]
            forward=tuple(raw["basis"]["forward"]),  # type: ignore[arg-type]
            meters_per_pixel=float(raw["metersPerPixel"]),
            near_m=float(raw["nearM"]),
            far_m=float(raw["farM"]),
            image_width_px=int(raw["imageWidthPx"]),
            image_height_px=int(raw["imageHeightPx"]),
            image_origin_px=(
                float(raw["imageOriginPx"]["x"]),
                float(raw["imageOriginPx"]["y"]),
            ),
            working_cols=int(raw["workingGrid"]["cols"]),
            working_rows=int(raw["workingGrid"]["rows"]),
            working_tile_size_px=int(raw["workingGrid"]["tileSizePx"]),
            working_overlap_px=int(raw["workingGrid"]["overlapPx"]),
            dzi_tile_size=int(raw["dzi"]["tileSize"]),
            dzi_overlap=int(raw["dzi"]["overlap"]),
            dzi_format=str(raw["dzi"]["format"]),
        )


def create_shinko_pilot_camera() -> OrthographicCamera:
    origin = wgs84_to_epsg6677(139.6417, 35.4527)
    origin_rounded = Epsg6677Coord(
        easting=float(round(origin.easting)),
        northing=float(round(origin.northing)),
    )
    azimuth_deg = 225.0
    depression_deg = 45.0
    ref_distance_m = 1000.0
    meters_per_pixel = 0.28

    az = math.radians(azimuth_deg)
    dep = math.radians(depression_deg)
    forward = _norm((math.cos(dep) * math.sin(az), math.cos(dep) * math.cos(az), -math.sin(dep)))
    right = _norm(_cross(forward, (0.0, 0.0, 1.0)))
    up = _norm(_cross(right, forward))
    cam_origin = (
        -ref_distance_m * forward[0],
        -ref_distance_m * forward[1],
        -ref_distance_m * forward[2],
    )

    cols, rows = 2, 2
    tile_px, overlap_px = 2048, 128
    width_px = cols * tile_px - (cols - 1) * overlap_px
    height_px = rows * tile_px - (rows - 1) * overlap_px

    return OrthographicCamera(
        origin_epsg6677=origin_rounded,
        center_local_m=(0.0, 0.0, 0.0),
        azimuth_deg=azimuth_deg,
        depression_deg=depression_deg,
        ref_distance_m=ref_distance_m,
        camera_origin_local_m=cam_origin,
        right=right,
        up=up,
        forward=forward,
        meters_per_pixel=meters_per_pixel,
        near_m=0.0,
        far_m=2500.0,
        image_width_px=width_px,
        image_height_px=height_px,
        image_origin_px=(width_px * 0.5, height_px * 0.5),
        working_cols=cols,
        working_rows=rows,
        working_tile_size_px=tile_px,
        working_overlap_px=overlap_px,
    )
