import { wgs84ToImage, type PoiRecord } from "@small-yokohama/core";
import type { ResolvedAirCabinGondola } from "../data/airCabinFeed.js";
import type { ResolvedPlane } from "../data/planeFeed.js";
import type { LoadedReleaseBundle } from "../data/releaseLoader.js";
import type { ResolvedRideAlongCar } from "../data/trafficFeed.js";
import type { ResolvedTrain } from "../data/trainFeed.js";
import type { ResolvedFeedState } from "../data/vehicleFeed.js";
import { formatBuildingType, formatSurfaceKind } from "../i18n.js";
import type { ViewerState } from "../state.js";

export interface UiRect {
  l: number;
  r: number;
  t: number;
  b: number;
}

export function rectIntersectsAny(box: UiRect, obstacles: readonly UiRect[]): boolean {
  for (const other of obstacles) {
    if (box.l < other.r && box.r > other.l && box.t < other.b && box.b > other.t) {
      return true;
    }
  }
  return false;
}

export interface ViewportImageBounds {
  topLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
  widthCssPx: number;
  heightCssPx: number;
  zoom: number;
}

interface ProjectedPoi {
  poi: PoiRecord;
  px: number;
  py: number;
  label: string;
}

const HIDDEN_PIN_CATEGORIES = new Set([
  "bicycle_rental",
  "parking",
  "parking_entrance",
  "vending_machine",
  "dry_cleaning",
  "animal_boarding",
  "copyshop",
  "mobile_phone",
  "dentist",
  "doctors",
  "chemist",
  "beauty",
  "car",
  "pet",
  "variety_store",
  "convenience",
  "supermarket",
  "post_office",
  "bank",
  "pub",
  "fast_food",
  "bar",
  "clothes",
  "furniture",
  "gift",
  "books",
  "pastry",
]);

function estimateLabelSize(
  label: string,
  tier: 1 | 2 | 3,
  isNarrow = false,
): { w: number; h: number } {
  let asciiCount = 0;
  for (let i = 0; i < label.length; i++) {
    if (label.charCodeAt(i) < 128) asciiCount++;
  }
  const wideCount = label.length - asciiCount;
  const charPx = isNarrow ? (tier === 1 ? 12.6 : 11.8) : tier === 1 ? 14.5 : 13.5;
  const asciiPx = isNarrow ? 6.9 : 7.8;
  const textPx = wideCount * charPx + asciiCount * asciiPx;
  return {
    w: Math.ceil(textPx + (isNarrow ? 18 : 22)),
    h: isNarrow ? (tier === 1 ? 25 : 24) : tier === 1 ? 30 : 28,
  };
}

export class LabelLayer {
  private projectedCache: ProjectedPoi[] | null = null;
  private cachedLang: ViewerState["lang"] | null = null;
  private cachedBundle: LoadedReleaseBundle | null = null;
  private lastRenderKey = "";

  private ensureProjected(bundle: LoadedReleaseBundle, lang: ViewerState["lang"]): ProjectedPoi[] {
    if (
      this.projectedCache &&
      this.cachedBundle === bundle &&
      this.cachedLang === lang
    ) {
      return this.projectedCache;
    }

    const sorted = [...bundle.pois].sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const aCur = a.id.startsWith("cur-") || a.id.startsWith("lm-") ? 0 : 1;
      const bCur = b.id.startsWith("cur-") || b.id.startsWith("lm-") ? 0 : 1;
      if (aCur !== bCur) return aCur - bCur;
      if (a.category === "station" && b.category !== "station") return -1;
      if (b.category === "station" && a.category !== "station") return 1;
      return (b.heightM ?? 0) - (a.heightM ?? 0);
    });

    const projected: ProjectedPoi[] = [];
    for (const poi of sorted) {
      if (HIDDEN_PIN_CATEGORIES.has(poi.category)) continue;
      const label = (lang === "en" ? poi.nameEn : poi.nameJa).trim();
      if (!label) continue;
      // Anchor slightly above building roof / deck so label floats cleanly above geometry
      const anchorZ = (poi.elevationM ?? 0) + Math.min(poi.heightM ?? 6, 22);
      const img = wgs84ToImage(bundle.camera, poi.lon, poi.lat, anchorZ);
      if (
        img.px < 0 ||
        img.py < 0 ||
        img.px > bundle.camera.imageWidthPx ||
        img.py > bundle.camera.imageHeightPx
      ) {
        continue;
      }
      projected.push({ poi, px: img.px, py: img.py, label });
    }

    this.projectedCache = projected;
    this.cachedBundle = bundle;
    this.cachedLang = lang;
    this.lastRenderKey = "";
    return projected;
  }

  private resolveSelectedAnchor(
    bundle: LoadedReleaseBundle,
    state: ViewerState,
    feed: ResolvedFeedState | null,
    trains: readonly ResolvedTrain[] = [],
    planes: readonly ResolvedPlane[] = [],
    airCabins: readonly ResolvedAirCabinGondola[] = [],
    rideCar: ResolvedRideAlongCar | null = null,
  ): { px: number; py: number; label: string; id: string } | null {
    const sel = state.selected;
    if (!sel) return null;
    if (sel.kind === "landmark") {
      const lm = sel.landmark;
      const img = wgs84ToImage(bundle.camera, lm.lon, lm.lat, lm.elevationM);
      return {
        px: img.px,
        py: img.py,
        label: state.lang === "en" ? lm.nameEn : lm.nameJa,
        id: `lm:${lm.id}`,
      };
    }
    if (sel.kind === "poi") {
      const p = sel.poi;
      const anchorZ = (p.elevationM ?? 0) + Math.min(p.heightM ?? 6, 22);
      const img = wgs84ToImage(bundle.camera, p.lon, p.lat, anchorZ);
      return {
        px: img.px,
        py: img.py,
        label: (state.lang === "en" ? p.nameEn : p.nameJa) || p.nameJa,
        id: `poi:${p.id}`,
      };
    }
    if (sel.kind === "portcall") {
      const pc = feed?.portCalls.find((x) => x.id === sel.portCall.id) ?? sel.portCall;
      const img = wgs84ToImage(bundle.camera, pc.lon, pc.lat, 5);
      return {
        px: img.px,
        py: img.py,
        label: state.lang === "en" ? pc.vesselNameEn : pc.vesselNameJa,
        id: `pc:${pc.id}`,
      };
    }
    if (sel.kind === "train") {
      const tr = trains.find((x) => x.id === sel.train.id) ?? sel.train;
      const img = wgs84ToImage(bundle.camera, tr.lon, tr.lat, tr.elevM + tr.carHeightM + 1.5);
      return {
        px: img.px,
        py: img.py,
        label: `${tr.code} ${state.lang === "en" ? tr.lineNameEn : tr.lineNameJa}`,
        id: `tr:${tr.id}`,
      };
    }
    if (sel.kind === "plane") {
      const p = planes.find((x) => x.id === sel.plane.id) ?? sel.plane;
      const img = wgs84ToImage(bundle.camera, p.lon, p.lat, p.displayElevM + 10);
      return {
        px: img.px,
        py: img.py,
        label: `${p.callsign} · ${p.altitudeM}m`,
        id: `pl:${p.id}`,
      };
    }
    if (sel.kind === "aircabin") {
      const c = airCabins.find((x) => x.id === sel.cabin.id) ?? sel.cabin;
      const img = wgs84ToImage(bundle.camera, c.lon, c.lat, c.cableElevM + 2);
      return {
        px: img.px,
        py: img.py,
        label: `AIR CABIN #${c.cabinNumber}`,
        id: `ac:${c.id}`,
      };
    }
    if (sel.kind === "ridealong") {
      const car = rideCar && rideCar.carId === sel.car.carId ? rideCar : sel.car;
      const img = wgs84ToImage(bundle.camera, car.lon, car.lat, car.elevM + 3.2);
      return {
        px: img.px,
        py: img.py,
        label: `${state.lang === "en" ? car.labelEn : car.labelJa} · ${car.speedKmh} km/h`,
        id: `ra:${car.carId}`,
      };
    }
    if (sel.kind === "feature") {
      const f = sel.feature;
      const label =
        (state.lang === "en" ? f.nameEn : f.nameJa) ||
        (f.buildingType
          ? formatBuildingType(f.buildingType, state.lang)
          : formatSurfaceKind(f.surfaceKind, state.lang));
      const img = wgs84ToImage(
        bundle.camera,
        sel.lon,
        sel.lat,
        Math.min(f.heightM, 40) + 2,
      );
      return {
        px: img.px,
        py: img.py,
        label,
        id: `feat:${f.featureId}`,
      };
    }
    return null;
  }

  render(
    container: HTMLElement,
    bundle: LoadedReleaseBundle,
    state: ViewerState,
    bounds: ViewportImageBounds | null,
    onSelectPoi: (poi: PoiRecord) => void,
    feed: ResolvedFeedState | null = null,
    trains: readonly ResolvedTrain[] = [],
    planes: readonly ResolvedPlane[] = [],
    airCabins: readonly ResolvedAirCabinGondola[] = [],
    rideCar: ResolvedRideAlongCar | null = null,
    uiObstacles: readonly UiRect[] = [],
  ): void {
    if (!bounds) {
      if (container.childElementCount > 0) {
        container.replaceChildren();
      }
      this.lastRenderKey = "none";
      return;
    }

    const spanX = bounds.bottomRight.x - bounds.topLeft.x;
    const spanY = bounds.bottomRight.y - bounds.topLeft.y;
    if (spanX <= 0 || spanY <= 0 || bounds.widthCssPx <= 0 || bounds.heightCssPx <= 0) {
      return;
    }

    const obsKey = uiObstacles
      .map((o) => `${Math.round(o.l)},${Math.round(o.t)},${Math.round(o.r)},${Math.round(o.b)}`)
      .join(";");
    const selAnchor = this.resolveSelectedAnchor(bundle, state, feed, trains, planes, airCabins, rideCar);
    const renderKey = [
      state.lang,
      state.showLabels ? "1" : "0",
      bounds.topLeft.x.toFixed(1),
      bounds.topLeft.y.toFixed(1),
      bounds.bottomRight.x.toFixed(1),
      bounds.bottomRight.y.toFixed(1),
      bounds.widthCssPx,
      bounds.heightCssPx,
      bounds.zoom.toFixed(2),
      selAnchor?.id ?? "",
      obsKey,
    ].join("|");

    if (renderKey === this.lastRenderKey) {
      return;
    }
    this.lastRenderKey = renderKey;

    const isNarrow = bounds.widthCssPx <= 700;
    const frag = document.createDocumentFragment();
    const placedBoxes: UiRect[] =
      uiObstacles.length > 0
        ? [...uiObstacles]
        : [
            // Avoid top-left #bar pill
            { l: 0, r: Math.min(bounds.widthCssPx - 64, 520), t: 0, b: isNarrow ? 90 : 68 },
            // Avoid top-right #sq stack
            {
              l: Math.max(0, bounds.widthCssPx - 72),
              r: bounds.widthCssPx,
              t: 0,
              b: 290,
            },
            // Avoid bottom-left #status bar
            {
              l: 0,
              r: isNarrow ? bounds.widthCssPx : Math.min(bounds.widthCssPx, 640),
              t: Math.max(0, bounds.heightCssPx - (isNarrow ? 92 : 68)),
              b: bounds.heightCssPx,
            },
            // Avoid bottom-right minimap on desktop
            ...(!isNarrow
              ? [
                  {
                    l: Math.max(0, bounds.widthCssPx - 236),
                    r: bounds.widthCssPx,
                    t: Math.max(0, bounds.heightCssPx - 120),
                    b: bounds.heightCssPx,
                  },
                ]
              : []),
          ];

    if (selAnchor) {
      const sx = ((selAnchor.px - bounds.topLeft.x) / spanX) * bounds.widthCssPx;
      const sy = ((selAnchor.py - bounds.topLeft.y) / spanY) * bounds.heightCssPx;
      if (
        sx >= 12 &&
        sx <= bounds.widthCssPx - 12 &&
        sy >= 24 &&
        sy <= bounds.heightCssPx - 12
      ) {
        const size = estimateLabelSize(selAnchor.label, 1, isNarrow);
        placedBoxes.push({
          l: sx - size.w * 0.5 - 16,
          r: sx + size.w * 0.5 + 16,
          t: sy - size.h - 20,
          b: sy + 10,
        });
        const pin = document.createElement("div");
        pin.className = "search-pin";
        pin.style.left = `${sx.toFixed(1)}px`;
        pin.style.top = `${sy.toFixed(1)}px`;
        pin.textContent = selAnchor.label;
        frag.appendChild(pin);
      }
    }

    if (state.showLabels) {
      const imgPxPerCssPx = spanX / bounds.widthCssPx;
      const maxTier = imgPxPerCssPx > 3.8 ? 1 : imgPxPerCssPx > 1.5 ? 2 : 3;
      const maxLabels =
        maxTier === 1
          ? isNarrow
            ? 8
            : 13
          : maxTier === 2
            ? isNarrow
              ? 15
              : 26
            : isNarrow
              ? 20
              : 32;
      const items = this.ensureProjected(bundle, state.lang);
      const selectedPoiId = state.selected?.kind === "poi" ? state.selected.poi.id : "";
      const selectedLmId = state.selected?.kind === "landmark" ? state.selected.landmark.id : "";

      let placedCount = 0;
      for (const item of items) {
        if (item.poi.id === selectedPoiId || item.poi.id === selectedLmId) {
          continue;
        }
        if (item.poi.tier > maxTier) {
          continue;
        }

        const cssX = ((item.px - bounds.topLeft.x) / spanX) * bounds.widthCssPx;
        const cssY = ((item.py - bounds.topLeft.y) / spanY) * bounds.heightCssPx;
        if (
          cssX < 28 ||
          cssX > bounds.widthCssPx - 28 ||
          cssY < 32 ||
          cssY > bounds.heightCssPx - 30
        ) {
          continue;
        }

        const size = estimateLabelSize(item.label, item.poi.tier, isNarrow);
        const pad = isNarrow ? 8 : 12;
        const box: UiRect = {
          l: cssX - size.w * 0.5 - pad,
          r: cssX + size.w * 0.5 + pad,
          t: cssY - size.h - 8 - pad,
          b: cssY + pad,
        };

        if (
          box.l < 6 ||
          box.r > bounds.widthCssPx - 6 ||
          box.t < 6 ||
          box.b > bounds.heightCssPx - 6 ||
          rectIntersectsAny(box, placedBoxes)
        ) {
          continue;
        }

        placedBoxes.push(box);
        const btn = document.createElement("button");
        btn.type = "button";
        const isPark = item.poi.category === "park";
        const isStation = item.poi.category === "station";
        const isCorp = item.poi.category === "corporate";
        const isWater = item.poi.category === "river";
        btn.className = `map-label tier-${item.poi.tier}${isPark ? " park" : ""}${isStation ? " station" : ""}${isCorp ? " corporate" : ""}${isWater ? " water" : ""}`;
        btn.style.left = `${cssX.toFixed(1)}px`;
        btn.style.top = `${cssY.toFixed(1)}px`;
        btn.textContent = item.label;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectPoi(item.poi);
        });
        frag.appendChild(btn);

        placedCount++;
        if (placedCount >= maxLabels) break;
      }
    }

    container.replaceChildren(frag);
  }
}
