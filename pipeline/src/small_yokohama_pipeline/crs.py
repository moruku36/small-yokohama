"""JGD2011 / Japan Plane Rectangular CS IX (EPSG:6677) projection utilities.

Official EPSG:6677 specifies Northing first and Easting second. This module
normalizes all coordinates to explicit `(easting, northing)` (+X east, +Y north).
Uses `pyproj` with `always_xy=True` when installed, and includes an identical
Kawase (2011) GRS80 Gauss-Krueger fallback matching `packages/core/src/epsg6677.ts`.
"""

from __future__ import annotations

from dataclasses import dataclass
import math

try:
    from pyproj import Transformer  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional fallback for minimal environments
    Transformer = None

_GRS80_A = 6378137.0
_GRS80_F = 1.0 / 298.257222101
_M0 = 0.9999
_PHI0_RAD = math.radians(36.0)
_LAMBDA0_RAD = math.radians(139.0 + 50.0 / 60.0)

_N = _GRS80_F / (2.0 - _GRS80_F)
_N2 = _N * _N
_N3 = _N2 * _N
_N4 = _N3 * _N
_N5 = _N4 * _N
_N6 = _N5 * _N

_A0 = 1.0 + _N2 / 4.0 + _N4 / 64.0
_A1 = -1.5 * (_N - _N3 / 8.0 - _N5 / 64.0)
_A2 = (15.0 / 16.0) * (_N2 - _N4 / 4.0)
_A3 = (-35.0 / 48.0) * (_N3 - (5.0 / 16.0) * _N5)
_A4 = (315.0 / 512.0) * _N4
_A5 = (-693.0 / 1280.0) * _N5

_A_BAR = ((_M0 * _GRS80_A) / (1.0 + _N)) * _A0
_S_PHI0 = ((_M0 * _GRS80_A) / (1.0 + _N)) * (
    _A0 * _PHI0_RAD
    + _A1 * math.sin(2.0 * _PHI0_RAD)
    + _A2 * math.sin(4.0 * _PHI0_RAD)
    + _A3 * math.sin(6.0 * _PHI0_RAD)
    + _A4 * math.sin(8.0 * _PHI0_RAD)
    + _A5 * math.sin(10.0 * _PHI0_RAD)
)

_ALPHA = (
    0.0,
    0.5 * _N - (2.0 / 3.0) * _N2 + (5.0 / 16.0) * _N3 + (41.0 / 180.0) * _N4 - (127.0 / 288.0) * _N5,
    (13.0 / 48.0) * _N2 - (3.0 / 5.0) * _N3 + (557.0 / 1440.0) * _N4 + (281.0 / 630.0) * _N5,
    (61.0 / 240.0) * _N3 - (103.0 / 140.0) * _N4 + (15061.0 / 26880.0) * _N5,
    (49561.0 / 161280.0) * _N4 - (179.0 / 168.0) * _N5,
    (34729.0 / 80640.0) * _N5,
)

_BETA = (
    0.0,
    0.5 * _N - (2.0 / 3.0) * _N2 + (37.0 / 96.0) * _N3 - (1.0 / 360.0) * _N4 - (81.0 / 512.0) * _N5,
    (1.0 / 48.0) * _N2 + (1.0 / 15.0) * _N3 - (437.0 / 1440.0) * _N4 + (46.0 / 105.0) * _N5,
    (17.0 / 480.0) * _N3 - (37.0 / 840.0) * _N4 - (209.0 / 4480.0) * _N5,
    (4397.0 / 161280.0) * _N4 - (11.0 / 504.0) * _N5,
    (4583.0 / 161280.0) * _N5,
)

_DELTA = (
    0.0,
    2.0 * _N - (2.0 / 3.0) * _N2 - 2.0 * _N3 + (116.0 / 45.0) * _N4 + (26.0 / 45.0) * _N5 - (2854.0 / 675.0) * _N6,
    (7.0 / 3.0) * _N2 - (8.0 / 5.0) * _N3 - (227.0 / 45.0) * _N4 + (2704.0 / 315.0) * _N5 + (2323.0 / 945.0) * _N6,
    (56.0 / 15.0) * _N3 - (136.0 / 35.0) * _N4 - (1262.0 / 105.0) * _N5 + (73814.0 / 2835.0) * _N6,
    (4279.0 / 630.0) * _N4 - (332.0 / 35.0) * _N5 - (399572.0 / 14175.0) * _N6,
    (4174.0 / 315.0) * _N5 - (144838.0 / 6237.0) * _N6,
    (601676.0 / 22275.0) * _N6,
)

_TWO_SQRT_N = (2.0 * math.sqrt(_N)) / (1.0 + _N)

_FWD_TRANSFORMER = (
    Transformer.from_crs("EPSG:4326", "EPSG:6677", always_xy=True)
    if Transformer is not None
    else None
)
_INV_TRANSFORMER = (
    Transformer.from_crs("EPSG:6677", "EPSG:4326", always_xy=True)
    if Transformer is not None
    else None
)


@dataclass(frozen=True, slots=True)
class Epsg6677Coord:
    easting: float
    northing: float


def wgs84_to_epsg6677(lon: float, lat: float) -> Epsg6677Coord:
    """Project WGS84 (lon, lat) degrees to normalized EPSG:6677 (easting, northing) metres."""
    if _FWD_TRANSFORMER is not None:
        easting, northing = _FWD_TRANSFORMER.transform(lon, lat)
        return Epsg6677Coord(easting=float(easting), northing=float(northing))

    phi = math.radians(lat)
    d_lambda = math.radians(lon) - _LAMBDA0_RAD
    sin_phi = math.sin(phi)
    t = math.sinh(
        math.atanh(sin_phi) - _TWO_SQRT_N * math.atanh(_TWO_SQRT_N * sin_phi)
    )
    t_bar = math.hypot(1.0, t)
    xi_p = math.atan2(t, math.cos(d_lambda))
    eta_p = math.atanh(math.sin(d_lambda) / t_bar)

    xi = xi_p
    eta = eta_p
    for j in range(1, 6):
        a = _ALPHA[j]
        xi += a * math.sin(2.0 * j * xi_p) * math.cosh(2.0 * j * eta_p)
        eta += a * math.cos(2.0 * j * xi_p) * math.sinh(2.0 * j * eta_p)

    return Epsg6677Coord(easting=_A_BAR * eta, northing=_A_BAR * xi - _S_PHI0)


def epsg6677_to_wgs84(easting: float, northing: float) -> tuple[float, float]:
    """Inverse project normalized EPSG:6677 (easting, northing) metres to WGS84 (lon, lat)."""
    if _INV_TRANSFORMER is not None:
        lon, lat = _INV_TRANSFORMER.transform(easting, northing)
        return (float(lon), float(lat))

    xi = (northing + _S_PHI0) / _A_BAR
    eta = easting / _A_BAR
    xi_p = xi
    eta_p = eta
    for j in range(1, 6):
        b = _BETA[j]
        xi_p -= b * math.sin(2.0 * j * xi) * math.cosh(2.0 * j * eta)
        eta_p -= b * math.cos(2.0 * j * xi) * math.sinh(2.0 * j * eta)

    chi = math.asin(math.sin(xi_p) / math.cosh(eta_p))
    phi = chi
    for j in range(1, 7):
        phi += _DELTA[j] * math.sin(2.0 * j * chi)

    lon = math.degrees(_LAMBDA0_RAD + math.atan2(math.sinh(eta_p), math.cos(xi_p)))
    lat = math.degrees(phi)
    return (lon, lat)
