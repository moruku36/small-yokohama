import type { Epsg6677Coord, Wgs84Coord } from "./types.js";

/**
 * JGD2011 / Japan Plane Rectangular CS IX (EPSG:6677).
 *
 * Official EPSG:6677 defines axis 1 as Northing and axis 2 as Easting.
 * This module ALWAYS normalizes axis order to `{ easting, northing }`
 * (+X east, +Y north in metres) using Kawase (2011) / Karney-Kruger series
 * on the GRS80 ellipsoid.
 */

const GRS80_A = 6378137.0;
const GRS80_INV_F = 298.257222101;
const GRS80_F = 1.0 / GRS80_INV_F;
const M0 = 0.9999;

const DEG_TO_RAD = Math.PI / 180.0;
const RAD_TO_DEG = 180.0 / Math.PI;

const PHI0_RAD = 36.0 * DEG_TO_RAD;
const LAMBDA0_RAD = (139.0 + 50.0 / 60.0) * DEG_TO_RAD;

const N = GRS80_F / (2.0 - GRS80_F);
const N2 = N * N;
const N3 = N2 * N;
const N4 = N3 * N;
const N5 = N4 * N;
const N6 = N5 * N;

const A0 = 1.0 + N2 / 4.0 + N4 / 64.0;
const A1 = -1.5 * (N - N3 / 8.0 - N5 / 64.0);
const A2 = (15.0 / 16.0) * (N2 - N4 / 4.0);
const A3 = (-35.0 / 48.0) * (N3 - (5.0 / 16.0) * N5);
const A4 = (315.0 / 512.0) * N4;
const A5 = (-693.0 / 1280.0) * N5;

const A_BAR = ((M0 * GRS80_A) / (1.0 + N)) * A0;
const S_PHI0 =
  ((M0 * GRS80_A) / (1.0 + N)) *
  (A0 * PHI0_RAD +
    A1 * Math.sin(2.0 * PHI0_RAD) +
    A2 * Math.sin(4.0 * PHI0_RAD) +
    A3 * Math.sin(6.0 * PHI0_RAD) +
    A4 * Math.sin(8.0 * PHI0_RAD) +
    A5 * Math.sin(10.0 * PHI0_RAD));

const ALPHA = [
  0,
  0.5 * N - (2.0 / 3.0) * N2 + (5.0 / 16.0) * N3 + (41.0 / 180.0) * N4 - (127.0 / 288.0) * N5,
  (13.0 / 48.0) * N2 - (3.0 / 5.0) * N3 + (557.0 / 1440.0) * N4 + (281.0 / 630.0) * N5,
  (61.0 / 240.0) * N3 - (103.0 / 140.0) * N4 + (15061.0 / 26880.0) * N5,
  (49561.0 / 161280.0) * N4 - (179.0 / 168.0) * N5,
  (34729.0 / 80640.0) * N5,
] as const;

const BETA = [
  0,
  0.5 * N - (2.0 / 3.0) * N2 + (37.0 / 96.0) * N3 - (1.0 / 360.0) * N4 - (81.0 / 512.0) * N5,
  (1.0 / 48.0) * N2 + (1.0 / 15.0) * N3 - (437.0 / 1440.0) * N4 + (46.0 / 105.0) * N5,
  (17.0 / 480.0) * N3 - (37.0 / 840.0) * N4 - (209.0 / 4480.0) * N5,
  (4397.0 / 161280.0) * N4 - (11.0 / 504.0) * N5,
  (4583.0 / 161280.0) * N5,
] as const;

const DELTA = [
  0,
  2.0 * N - (2.0 / 3.0) * N2 - 2.0 * N3 + (116.0 / 45.0) * N4 + (26.0 / 45.0) * N5 - (2854.0 / 675.0) * N6,
  (7.0 / 3.0) * N2 - (8.0 / 5.0) * N3 - (227.0 / 45.0) * N4 + (2704.0 / 315.0) * N5 + (2323.0 / 945.0) * N6,
  (56.0 / 15.0) * N3 - (136.0 / 35.0) * N4 - (1262.0 / 105.0) * N5 + (73814.0 / 2835.0) * N6,
  (4279.0 / 630.0) * N4 - (332.0 / 35.0) * N5 - (399572.0 / 14175.0) * N6,
  (4174.0 / 315.0) * N5 - (144838.0 / 6237.0) * N6,
  (601676.0 / 22275.0) * N6,
] as const;

const TWO_SQRT_N_OVER_1_PLUS_N = (2.0 * Math.sqrt(N)) / (1.0 + N);

export function wgs84ToEpsg6677(lon: number, lat: number): Epsg6677Coord {
  const phi = lat * DEG_TO_RAD;
  const dLambda = lon * DEG_TO_RAD - LAMBDA0_RAD;
  const sinPhi = Math.sin(phi);

  const t = Math.sinh(
    Math.atanh(sinPhi) - TWO_SQRT_N_OVER_1_PLUS_N * Math.atanh(TWO_SQRT_N_OVER_1_PLUS_N * sinPhi),
  );
  const tBar = Math.sqrt(1.0 + t * t);

  const xiPrime = Math.atan2(t, Math.cos(dLambda));
  const etaPrime = Math.atanh(Math.sin(dLambda) / tBar);

  let xi = xiPrime;
  let eta = etaPrime;
  for (let j = 1; j <= 5; j++) {
    const a = ALPHA[j]!;
    const argXi = 2.0 * j * xiPrime;
    const argEta = 2.0 * j * etaPrime;
    xi += a * Math.sin(argXi) * Math.cosh(argEta);
    eta += a * Math.cos(argXi) * Math.sinh(argEta);
  }

  return {
    easting: A_BAR * eta,
    northing: A_BAR * xi - S_PHI0,
  };
}

export function epsg6677ToWgs84(easting: number, northing: number): Wgs84Coord {
  const xi = (northing + S_PHI0) / A_BAR;
  const eta = easting / A_BAR;

  let xiPrime = xi;
  let etaPrime = eta;
  for (let j = 1; j <= 5; j++) {
    const b = BETA[j]!;
    const argXi = 2.0 * j * xi;
    const argEta = 2.0 * j * eta;
    xiPrime -= b * Math.sin(argXi) * Math.cosh(argEta);
    etaPrime -= b * Math.cos(argXi) * Math.sinh(argEta);
  }

  const chi = Math.asin(Math.sin(xiPrime) / Math.cosh(etaPrime));
  let phi = chi;
  for (let j = 1; j <= 6; j++) {
    phi += DELTA[j]! * Math.sin(2.0 * j * chi);
  }

  const lambda = LAMBDA0_RAD + Math.atan2(Math.sinh(etaPrime), Math.cos(xiPrime));

  return {
    lon: lambda * RAD_TO_DEG,
    lat: phi * RAD_TO_DEG,
  };
}

export function geodesicDistanceM(a: Wgs84Coord, b: Wgs84Coord): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLat = lat2 - lat1;
  const dLon = (b.lon - a.lon) * DEG_TO_RAD;
  const sinDLat = Math.sin(dLat * 0.5);
  const sinDLon = Math.sin(dLon * 0.5);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2.0 * 6371008.8 * Math.asin(Math.min(1.0, Math.sqrt(h)));
}
