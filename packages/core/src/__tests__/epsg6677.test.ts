import { describe, expect, it } from "vitest";
import {
  epsg6677ToWgs84,
  geodesicDistanceM,
  wgs84ToEpsg6677,
} from "@small-yokohama/core";

describe("EPSG:6677 projection (JGD2011 / Japan Plane Rectangular CS IX)", () => {
  it("normalizes axis order to { easting, northing } with expected signs in Yokohama", () => {
    // Zone IX origin is 139°50'E (139.83333°E), 36°N. Yokohama is south-west of origin.
    const pt = wgs84ToEpsg6677(139.6394, 35.4531);
    expect(pt.easting).toBeLessThan(0);
    expect(pt.northing).toBeLessThan(0);
    expect(pt.easting).toBeCloseTo(-17590, -2); // ~ -17.6 km east
    expect(pt.northing).toBeCloseTo(-60660, -2); // ~ -60.7 km north

    // Moving east increases easting; moving north increases northing
    const eastPt = wgs84ToEpsg6677(139.6494, 35.4531);
    const northPt = wgs84ToEpsg6677(139.6394, 35.4631);
    expect(eastPt.easting).toBeGreaterThan(pt.easting);
    expect(northPt.northing).toBeGreaterThan(pt.northing);
  });

  it("round-trips WGS84 <-> EPSG:6677 within sub-millimeter precision across the waterfront", () => {
    const points = [
      { lon: 139.6221, lat: 35.4658 }, // Yokohama Station
      { lon: 139.6394, lat: 35.4531 }, // Circle Walk
      { lon: 139.6428, lat: 35.4526 }, // Red Brick Warehouse
      { lon: 139.6513, lat: 35.4421 }, // Motomachi-Chukagai
    ];

    for (const p of points) {
      const proj = wgs84ToEpsg6677(p.lon, p.lat);
      const back = epsg6677ToWgs84(proj.easting, proj.northing);
      const errM = geodesicDistanceM(p, back);
      expect(errM).toBeLessThan(1e-5);
    }
  });

  it("matches metric ground distances closely across Shinko pilot", () => {
    const a = { lon: 139.637, lat: 35.45 };
    const b = { lon: 139.646, lat: 35.456 };
    const pa = wgs84ToEpsg6677(a.lon, a.lat);
    const pb = wgs84ToEpsg6677(b.lon, b.lat);
    const planeDist = Math.hypot(pb.easting - pa.easting, pb.northing - pa.northing) / 0.9999;
    const geoDist = geodesicDistanceM(a, b);
    expect(Math.abs(planeDist - geoDist)).toBeLessThan(1.5);
  });
});
