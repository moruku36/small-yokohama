"""Overlap DP seam cutting, lossless data tile splitting, and libvips DZI export."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shutil
import subprocess
import numpy as np
from PIL import Image


@dataclass(frozen=True, slots=True)
class SeamMetrics:
    seam_id: str
    orientation: str
    length_px: int
    mean_color_diff: float
    max_color_diff: float


def find_min_vertical_seam(left_rgba: np.ndarray, right_rgba: np.ndarray, overlap_px: int) -> tuple[np.ndarray, SeamMetrics]:
    """Dynamic-programming minimum L1 color disagreement seam across vertical overlap strip."""
    height, left_w, _ = left_rgba.shape
    a = left_rgba[:, left_w - overlap_px :, :3].astype(np.int32)
    b = right_rgba[:, :overlap_px, :3].astype(np.int32)
    diff = np.abs(a - b).sum(axis=2).astype(np.float64)

    dp = np.empty_like(diff)
    parent = np.zeros((height, overlap_px), dtype=np.int8)
    dp[0] = diff[0]

    for y in range(1, height):
        prev = dp[y - 1]
        for ox in range(overlap_px):
            best = prev[ox]
            step = 0
            if ox > 0 and prev[ox - 1] < best:
                best = prev[ox - 1]
                step = -1
            if ox + 1 < overlap_px and prev[ox + 1] < best:
                best = prev[ox + 1]
                step = 1
            dp[y, ox] = best + diff[y, ox]
            parent[y, ox] = step

    cuts = np.empty(height, dtype=np.int32)
    cur = int(np.argmin(dp[height - 1]))
    seam_diffs = np.empty(height, dtype=np.float64)
    for y in range(height - 1, -1, -1):
        cuts[y] = cur
        seam_diffs[y] = diff[y, cur]
        cur += int(parent[y, cur])

    return cuts, SeamMetrics(
        seam_id="vertical",
        orientation="vertical",
        length_px=height,
        mean_color_diff=float(seam_diffs.mean()),
        max_color_diff=float(seam_diffs.max()),
    )


def find_min_horizontal_seam(top_rgba: np.ndarray, bottom_rgba: np.ndarray, overlap_px: int) -> tuple[np.ndarray, SeamMetrics]:
    """Dynamic-programming minimum L1 color disagreement seam across horizontal overlap strip."""
    top_h, width, _ = top_rgba.shape
    a = top_rgba[top_h - overlap_px :, :, :3].astype(np.int32)
    b = bottom_rgba[:overlap_px, :, :3].astype(np.int32)
    diff = np.abs(a - b).sum(axis=2).astype(np.float64)  # shape (overlap_px, width)

    dp = np.empty((width, overlap_px), dtype=np.float64)
    parent = np.zeros((width, overlap_px), dtype=np.int8)
    dp[0] = diff[:, 0]

    for x in range(1, width):
        prev = dp[x - 1]
        for oy in range(overlap_px):
            best = prev[oy]
            step = 0
            if oy > 0 and prev[oy - 1] < best:
                best = prev[oy - 1]
                step = -1
            if oy + 1 < overlap_px and prev[oy + 1] < best:
                best = prev[oy + 1]
                step = 1
            dp[x, oy] = best + diff[oy, x]
            parent[x, oy] = step

    cuts = np.empty(width, dtype=np.int32)
    cur = int(np.argmin(dp[width - 1]))
    seam_diffs = np.empty(width, dtype=np.float64)
    for x in range(width - 1, -1, -1):
        cuts[x] = cur
        seam_diffs[x] = diff[cur, x]
        cur += int(parent[x, cur])

    return cuts, SeamMetrics(
        seam_id="horizontal",
        orientation="horizontal",
        length_px=width,
        mean_color_diff=float(seam_diffs.mean()),
        max_color_diff=float(seam_diffs.max()),
    )


def stitch_2x2_tiles(
    t00: np.ndarray,
    t10: np.ndarray,
    t01: np.ndarray,
    t11: np.ndarray,
    overlap_px: int,
) -> tuple[np.ndarray, list[SeamMetrics]]:
    """Stitch a 2x2 grid of overlapping RGBA arrays using DP minimum-disagreement seams."""
    h, w, _ = t00.shape
    full_w = w * 2 - overlap_px
    full_h = h * 2 - overlap_px
    left_overlap_start = w - overlap_px

    cuts_top, m_top = find_min_vertical_seam(t00, t10, overlap_px)
    cuts_bot, m_bot = find_min_vertical_seam(t01, t11, overlap_px)

    def stitch_row(left: np.ndarray, right: np.ndarray, cuts: np.ndarray) -> np.ndarray:
        row_out = np.empty((h, full_w, 4), dtype=np.uint8)
        for y in range(h):
            cut_x = left_overlap_start + int(cuts[y])
            row_out[y, :cut_x] = left[y, :cut_x]
            row_out[y, cut_x:] = right[y, cut_x - left_overlap_start :]
        return row_out

    top_band = stitch_row(t00, t10, cuts_top)
    bot_band = stitch_row(t01, t11, cuts_bot)

    cuts_h, m_h = find_min_horizontal_seam(top_band, bot_band, overlap_px)
    out = np.empty((full_h, full_w, 4), dtype=np.uint8)
    top_overlap_start = h - overlap_px
    out[:top_overlap_start] = top_band[:top_overlap_start]
    out[h:] = bot_band[overlap_px:]
    for x in range(full_w):
        cut_y = top_overlap_start + int(cuts_h[x])
        out[top_overlap_start:cut_y, x] = top_band[top_overlap_start:cut_y, x]
        out[cut_y:h, x] = bot_band[cut_y - top_overlap_start : overlap_px, x]

    return out, [
        SeamMetrics("vertical-top-row-0", "vertical", m_top.length_px, m_top.mean_color_diff, m_top.max_color_diff),
        SeamMetrics("vertical-bottom-row-1", "vertical", m_bot.length_px, m_bot.mean_color_diff, m_bot.max_color_diff),
        SeamMetrics("horizontal-across-cols", "horizontal", m_h.length_px, m_h.mean_color_diff, m_h.max_color_diff),
    ]


def export_dzi_with_libvips(
    stitched_png: Path,
    out_prefix: Path,
    tile_size: int = 256,
    overlap: int = 1,
    vips_bin: str = "vips",
    dry_run: bool = False,
) -> list[str]:
    """Generate OpenSeadragon-compatible DZI pyramid via `vips dzsave`."""
    if not dry_run and shutil.which(vips_bin) is None:
        raise FileNotFoundError("libvips CLI ('vips') not found.")
    out_prefix.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        vips_bin,
        "dzsave",
        str(stitched_png),
        str(out_prefix),
        "--tile-size",
        str(tile_size),
        "--overlap",
        str(overlap),
        "--suffix",
        ".png",
    ]
    if not dry_run:
        subprocess.run(cmd, check=True)
    return cmd


def write_lossless_data_tiles(
    array_rgba: np.ndarray,
    out_dir: Path,
    cols: int = 2,
    rows: int = 2,
    prefix: str = "",
) -> int:
    """Split lossless depth / surface-id / road-elevation RGBA array into non-interpolated tiles."""
    out_dir.mkdir(parents=True, exist_ok=True)
    h, w, _ = array_rgba.shape
    tile_w = w // cols
    tile_h = h // rows
    total_bytes = 0

    for row in range(rows):
        for col in range(cols):
            crop = array_rgba[row * tile_h : (row + 1) * tile_h, col * tile_w : (col + 1) * tile_w]
            name = f"{prefix}_tile_{col}_{row}.png" if prefix else f"tile_{col}_{row}.png"
            dest = out_dir / name
            Image.fromarray(crop, mode="RGBA").save(dest, format="PNG")
            total_bytes += dest.stat().st_size

    return total_bytes
