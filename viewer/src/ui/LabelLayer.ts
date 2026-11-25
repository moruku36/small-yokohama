import { wgs84ToImage, type PoiRecord } from "@small-yokohama/core";
import type { LoadedReleaseBundle } from "../data/releaseLoader.js";
import type { ViewerState } from "../state.js";

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

function estimateLabelSize(label: string, tier: 1 | 2 | 3): { w: number; h: number } {
  let asciiCount = 0;
  for (let i = 0; i < label.length; i++) {
    if (label.charCodeAt(i) < 128) asciiCount++;
  }
  const wideCount = label.length - asciiCount;
  const charPx = tier === 1 ? 14.5 : 13.5;
  const textPx = wideCount * charPx + asciiCount * 7.8;
  return {
    w: Math.ceil(textPx + 20),
    h: tier === 1 ? 30 : 28,
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
      return (b.heightM ?? 0) - (a.heightM ?? 0);
    });

    const projected: ProjectedPoi[] = [];
    for (const poi of sorted) {
      const label = (lang === "en" ? poi.nameEn : poi.nameJa).trim();
      if (!label) continue;
      // Anchor slightly above building roof / deck so label floats above geometry
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

  render(
    container: HTMLElement,
    bundle: LoadedReleaseBundle,
    state: ViewerState,
    bounds: ViewportImageBounds | null,
    onSelectPoi: (poi: PoiRecord) => void,
  ): void {
    if (!state.showLabels || !bounds) {
      if (container.childElementCount > 0) {
        container.replaceChildren();
      }
      this.lastRenderKey = "hidden";
      return;
    }

    const spanX = bounds.bottomRight.x - bounds.topLeft.x;
    const spanY = bounds.bottomRight.y - bounds.topLeft.y;
    if (spanX <= 0 || spanY <= 0 || bounds.widthCssPx <= 0 || bounds.heightCssPx <= 0) {
      return;
    }

    const selectedPoiId = state.selected?.kind === "poi" ? state.selected.poi.id : "";
    const renderKey = [
      state.lang,
      bounds.topLeft.x.toFixed(1),
      bounds.topLeft.y.toFixed(1),
      bounds.bottomRight.x.toFixed(1),
      bounds.bottomRight.y.toFixed(1),
      bounds.widthCssPx,
      bounds.heightCssPx,
      bounds.zoom.toFixed(2),
      selectedPoiId,
    ].join("|");

    if (renderKey === this.lastRenderKey) {
      return;
    }
    this.lastRenderKey = renderKey;

    const imgPxPerCssPx = spanX / bounds.widthCssPx;
    const isNarrow = bounds.widthCssPx <= 700;
    const maxTier = imgPxPerCssPx > 4.5 ? 1 : imgPxPerCssPx > 1.8 ? 2 : 3;
    const maxLabels =
      maxTier === 1
        ? isNarrow
          ? 10
          : 14
        : maxTier === 2
          ? isNarrow
            ? 14
            : 22
          : isNarrow
            ? 18
            : 28;
    const items = this.ensureProjected(bundle, state.lang);

    const placedBoxes: Array<{ l: number; r: number; t: number; b: number }> = [
      // Avoid top-left #bar pill
      { l: 0, r: Math.min(bounds.widthCssPx - 64, 500), t: 0, b: 68 },
      // Avoid top-right #sq stack
      {
        l: Math.max(0, bounds.widthCssPx - 72),
        r: bounds.widthCssPx,
        t: 0,
        b: 290,
      },
      // Avoid bottom #status bar
      {
        l: 0,
        r: isNarrow ? bounds.widthCssPx : Math.min(bounds.widthCssPx, 620),
        t: Math.max(0, bounds.heightCssPx - 68),
        b: bounds.heightCssPx,
      },
    ];

    const frag = document.createDocumentFragment();
    let placedCount = 0;

    for (const item of items) {
      const isSelected = item.poi.id === selectedPoiId;
      if (!isSelected && item.poi.tier > maxTier) {
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

      const size = estimateLabelSize(item.label, item.poi.tier);
      const pad = 6;
      const box = {
        l: cssX - size.w * 0.5 - pad,
        r: cssX + size.w * 0.5 + pad,
        t: cssY - size.h - 8 - pad,
        b: cssY + pad,
      };

      let collides = false;
      for (const other of placedBoxes) {
        if (box.l < other.r && box.r > other.l && box.t < other.b && box.b > other.t) {
          collides = true;
          break;
        }
      }
      if (collides) continue;

      placedBoxes.push(box);
      const btn = document.createElement("button");
      btn.type = "button";
      const isPark = item.poi.category === "park";
      btn.className = `map-label tier-${item.poi.tier}${isPark ? " park" : ""}${isSelected ? " active" : ""}`;
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

    container.replaceChildren(frag);
  }
}
