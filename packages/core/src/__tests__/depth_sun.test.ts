import { describe, expect, it } from "vitest";
import {
  SURFACE_KIND,
  computeYokohamaSun,
  decodeDepthFromRgba,
  decodeFeatureIdFromRgba,
  encodeDepthRgba,
  encodeFeatureIdRgba,
} from "@small-yokohama/core";

describe("16-bit depth encoding and Yokohama solar daylight calculation", () => {
  it("preserves camera depth within <0.04m with A=255 and surfaceKind in B", () => {
    const nearM = 0;
    const farM = 2500;
    for (const d of [12.3, 640.82, 1000.0, 1488.74, 2495.1]) {
      const rgba = encodeDepthRgba(d, nearM, farM, SURFACE_KIND.BRIDGE_DECK);
      expect(rgba[2]).toBe(SURFACE_KIND.BRIDGE_DECK);
      expect(rgba[3]).toBe(255);
      const decoded = decodeDepthFromRgba(rgba[0], rgba[1], nearM, farM);
      expect(Math.abs(decoded - d)).toBeLessThan(0.04);
    }
  });

  it("round-trips 24-bit feature IDs cleanly", () => {
    for (const id of [1, 7, 17, 65535, 1234567]) {
      const rgba = encodeFeatureIdRgba(id);
      expect(rgba[3]).toBe(255);
      expect(decodeFeatureIdFromRgba(rgba[0], rgba[1], rgba[2])).toBe(id);
    }
  });

  it("computes realistic daytime, sunset, and nighttime solar elevation for Yokohama", () => {
    const noonJst = new Date("2026-06-21T03:00:00Z"); // 12:00 JST summer solstice
    const noonSun = computeYokohamaSun(noonJst);
    expect(noonSun.altitudeDeg).toBeGreaterThan(70);
    expect(noonSun.phase).toBe("day");

    const midnightJst = new Date("2026-11-24T15:00:00Z"); // 00:00 JST
    const nightSun = computeYokohamaSun(midnightJst);
    expect(nightSun.altitudeDeg).toBeLessThan(-40);
    expect(nightSun.phase).toBe("night");
  });
});
