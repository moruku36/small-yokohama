import { localToImage, wgs84ToLocal } from "@small-yokohama/core";
import type { LoadedReleaseBundle } from "../data/releaseLoader.js";
import type { ResolvedTrain } from "../data/trainFeed.js";
import type {
  AnimatedPortCall,
  ResolvedFeedState,
  ResolvedVehicle,
} from "../data/vehicleFeed.js";
import type { ViewerState } from "../state.js";
import type { ViewportImageBounds } from "./LabelLayer.js";

const SHIP_ICON_SVG = `<svg viewBox="0 0 16 12" aria-hidden="true"><path d="M2 7h12l-1.5 3.5h-9zM4.5 7V4.2h7V7M6.5 4.2V2.2h3v2"/></svg>`;
const TRAIN_ICON_SVG = `<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="8" height="7.5" rx="1.6"/><path d="M3.2 4.2h5.6v2.1H3.2z" fill="rgba(16,28,44,0.45)"/><path d="M3.5 9.2 2.4 11M8.5 9.2l1.1 1.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

function getBusBadgeMeta(routeId: string): { code: string; cls: string } {
  if (routeId === "bayside-blue") return { code: "BB", cls: "rt-bb" };
  if (routeId === "akai-kutsu") return { code: "AK", cls: "rt-ak" };
  if (routeId === "pier-line") return { code: "PL", cls: "rt-pl" };
  if (routeId.startsWith("city-bus-")) {
    return { code: routeId.slice("city-bus-".length), cls: "rt-city" };
  }
  return { code: "BUS", cls: "rt-bb" };
}

function getShortBoatName(pc: AnimatedPortCall, lang: ViewerState["lang"]): string {
  const raw = lang === "en" ? pc.vesselNameEn : pc.vesselNameJa;
  return raw
    .replace(/（入港予定）/g, "")
    .replace(/\s*\(Scheduled Call\)/gi, "")
    .trim();
}

export class TransitBadgeLayer {
  private readonly busButtons = new Map<string, HTMLButtonElement>();
  private readonly boatButtons = new Map<string, HTMLButtonElement>();
  private readonly trainButtons = new Map<string, HTMLButtonElement>();
  private currentBusHandler: ((rv: ResolvedVehicle) => void) | null = null;
  private currentBoatHandler: ((pc: AnimatedPortCall) => void) | null = null;
  private currentTrainHandler: ((tr: ResolvedTrain) => void) | null = null;
  private latestVehicles = new Map<string, ResolvedVehicle>();
  private latestBoats = new Map<string, AnimatedPortCall>();
  private latestTrains = new Map<string, ResolvedTrain>();

  render(
    container: HTMLElement | null,
    bundle: LoadedReleaseBundle,
    state: ViewerState,
    bounds: ViewportImageBounds | null,
    feed: ResolvedFeedState | null,
    trains: readonly ResolvedTrain[],
    onSelectVehicle: (rv: ResolvedVehicle) => void,
    onSelectPortCall: (pc: AnimatedPortCall) => void,
    onSelectTrain: (tr: ResolvedTrain) => void,
  ): void {
    if (!container) return;
    if (!bounds) {
      for (const btn of this.busButtons.values()) btn.hidden = true;
      for (const btn of this.boatButtons.values()) btn.hidden = true;
      for (const btn of this.trainButtons.values()) btn.hidden = true;
      return;
    }

    this.currentBusHandler = onSelectVehicle;
    this.currentBoatHandler = onSelectPortCall;
    this.currentTrainHandler = onSelectTrain;

    const spanX = bounds.bottomRight.x - bounds.topLeft.x;
    const spanY = bounds.bottomRight.y - bounds.topLeft.y;
    if (spanX <= 0 || spanY <= 0 || bounds.widthCssPx <= 0 || bounds.heightCssPx <= 0) {
      return;
    }

    const imgPxPerCssPx = spanX / bounds.widthCssPx;
    const cam = bundle.camera;
    const selVehicleId =
      state.selected?.kind === "vehicle" ? state.selected.vehicle.entityId : null;
    const selBoatId =
      state.selected?.kind === "portcall" ? state.selected.portCall.id : null;
    const selTrainId =
      state.selected?.kind === "train" ? state.selected.train.id : null;

    // 1. Bus Pills (pooled DOM buttons -> transform-only at 60 FPS)
    const activeBusIds = new Set<string>();
    const placedBusCoords: Array<{ x: number; y: number }> = [];
    const showBusPills = Boolean(feed) && state.showBuses && imgPxPerCssPx <= 6.2;

    if (showBusPills && feed) {
      const sortedVehicles = [...feed.vehicles].sort((a, b) => {
        const aSel = a.record.entityId === selVehicleId ? 0 : 1;
        const bSel = b.record.entityId === selVehicleId ? 0 : 1;
        return aSel - bSel;
      });

      for (const rv of sortedVehicles) {
        const v = rv.record;
        this.latestVehicles.set(v.entityId, rv);
        const img = localToImage(
          cam,
          wgs84ToLocal(cam, v.lon, v.lat, v.roadElevationM + v.heightM + 0.8),
        );
        const cssX = ((img.px - bounds.topLeft.x) / spanX) * bounds.widthCssPx;
        const cssY = ((img.py - bounds.topLeft.y) / spanY) * bounds.heightCssPx;
        if (
          cssX < 18 ||
          cssX > bounds.widthCssPx - 18 ||
          cssY < 58 ||
          cssY > bounds.heightCssPx - 28
        ) {
          continue;
        }

        const isSel = v.entityId === selVehicleId;
        if (
          !isSel &&
          placedBusCoords.some((p) => Math.abs(p.x - cssX) < 30 && Math.abs(p.y - cssY) < 22)
        ) {
          continue;
        }
        placedBusCoords.push({ x: cssX, y: cssY });
        activeBusIds.add(v.entityId);

        let btn = this.busButtons.get(v.entityId);
        if (!btn) {
          btn = document.createElement("button");
          btn.type = "button";
          const meta = getBusBadgeMeta(v.routeId);
          btn.className = `bus-pill ${meta.cls}`;
          btn.textContent = meta.code;
          btn.dataset.vehicleId = v.entityId;
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const cur = this.latestVehicles.get(v.entityId);
            if (cur) this.currentBusHandler?.(cur);
          });
          this.busButtons.set(v.entityId, btn);
          container.appendChild(btn);
        }
        const routeTitle = state.lang === "en" ? v.routeLabelEn : v.routeLabelJa;
        if (btn.title !== routeTitle) {
          btn.title = routeTitle;
          btn.setAttribute("aria-label", routeTitle);
        }
        btn.classList.toggle("active", isSel);
        btn.hidden = false;
        btn.style.transform = `translate3d(${cssX.toFixed(1)}px, ${(cssY - 6).toFixed(1)}px, 0) translate(-50%, -100%)`;
      }
    }

    for (const [id, btn] of this.busButtons) {
      if (!activeBusIds.has(id)) {
        btn.hidden = true;
      }
    }

    // 2. Harbor Ship / Boat Pills
    const activeBoatIds = new Set<string>();
    const placedBoatCoords: Array<{ x: number; y: number }> = [];
    const showBoatPills = Boolean(feed) && state.showBoats && imgPxPerCssPx <= 9.0;

    if (showBoatPills && feed) {
      const sortedBoats = [...feed.portCalls].sort((a, b) => {
        const aSel = a.id === selBoatId ? 0 : 1;
        const bSel = b.id === selBoatId ? 0 : 1;
        if (aSel !== bSel) return aSel - bSel;
        return (b.lengthM ?? 20) - (a.lengthM ?? 20);
      });

      for (const pc of sortedBoats) {
        this.latestBoats.set(pc.id, pc);
        const h = pc.heightM ?? 8;
        const img = localToImage(cam, wgs84ToLocal(cam, pc.lon, pc.lat, h * 0.72 + 1.5));
        const cssX = ((img.px - bounds.topLeft.x) / spanX) * bounds.widthCssPx;
        const cssY = ((img.py - bounds.topLeft.y) / spanY) * bounds.heightCssPx;
        if (
          cssX < 28 ||
          cssX > bounds.widthCssPx - 28 ||
          cssY < 58 ||
          cssY > bounds.heightCssPx - 56
        ) {
          continue;
        }

        const isSel = pc.id === selBoatId;
        const kind = pc.vesselKind ?? "cruise";
        const minSpacingX = imgPxPerCssPx > 4.2 ? 92 : 68;
        if (
          !isSel &&
          placedBoatCoords.some((p) => Math.abs(p.x - cssX) < minSpacingX && Math.abs(p.y - cssY) < 26)
        ) {
          continue;
        }
        placedBoatCoords.push({ x: cssX, y: cssY });
        activeBoatIds.add(pc.id);

        const shortName = getShortBoatName(pc, state.lang);
        let btn = this.boatButtons.get(pc.id);
        if (!btn) {
          btn = document.createElement("button");
          btn.type = "button";
          btn.className = `boat-pill vk-${kind}`;
          btn.innerHTML = `${SHIP_ICON_SVG}<span class="bp-name"></span>`;
          btn.dataset.boatId = pc.id;
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const cur = this.latestBoats.get(pc.id);
            if (cur) this.currentBoatHandler?.(cur);
          });
          this.boatButtons.set(pc.id, btn);
          container.appendChild(btn);
        }

        const nameSpan = btn.querySelector("span.bp-name");
        if (nameSpan && nameSpan.textContent !== shortName) {
          nameSpan.textContent = shortName;
        }
        const berthTitle = `${shortName} — ${state.lang === "en" ? pc.berthEn : pc.berthJa}`;
        if (btn.title !== berthTitle) {
          btn.title = berthTitle;
          btn.setAttribute("aria-label", berthTitle);
        }
        btn.classList.toggle("active", isSel);
        btn.hidden = false;
        btn.style.transform = `translate3d(${cssX.toFixed(1)}px, ${(cssY - 8).toFixed(1)}px, 0) translate(-50%, -100%)`;
      }
    }

    for (const [id, btn] of this.boatButtons) {
      if (!activeBoatIds.has(id)) {
        btn.hidden = true;
      }
    }

    // 3. Railway Train Pills (JK, JT, JO, KK, SO)
    const activeTrainIds = new Set<string>();
    const placedTrainCoords: Array<{ x: number; y: number }> = [];
    const showTrainPills = state.showTrains && imgPxPerCssPx <= 8.5;

    if (showTrainPills && trains.length > 0) {
      const sortedTrains = [...trains].sort((a, b) => {
        const aSel = a.id === selTrainId ? 0 : 1;
        const bSel = b.id === selTrainId ? 0 : 1;
        return aSel - bSel;
      });

      for (const tr of sortedTrains) {
        this.latestTrains.set(tr.id, tr);
        const img = localToImage(
          cam,
          wgs84ToLocal(cam, tr.lon, tr.lat, tr.elevM + tr.carHeightM + 1.2),
        );
        const cssX = ((img.px - bounds.topLeft.x) / spanX) * bounds.widthCssPx;
        const cssY = ((img.py - bounds.topLeft.y) / spanY) * bounds.heightCssPx;
        if (
          cssX < 24 ||
          cssX > bounds.widthCssPx - 24 ||
          cssY < 58 ||
          cssY > bounds.heightCssPx - 56
        ) {
          continue;
        }

        const isSel = tr.id === selTrainId;
        if (
          !isSel &&
          placedTrainCoords.some((p) => Math.abs(p.x - cssX) < 38 && Math.abs(p.y - cssY) < 24)
        ) {
          continue;
        }
        placedTrainCoords.push({ x: cssX, y: cssY });
        activeTrainIds.add(tr.id);

        let btn = this.trainButtons.get(tr.id);
        if (!btn) {
          btn = document.createElement("button");
          btn.type = "button";
          btn.className = `train-pill rl-${tr.code.toLowerCase()}`;
          btn.innerHTML = `${TRAIN_ICON_SVG}<span>${tr.code}</span>`;
          btn.dataset.trainId = tr.id;
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const cur = this.latestTrains.get(tr.id);
            if (cur) this.currentTrainHandler?.(cur);
          });
          this.trainButtons.set(tr.id, btn);
          container.appendChild(btn);
        }

        const title = `${state.lang === "en" ? tr.lineNameEn : tr.lineNameJa} (${tr.trainNumber})`;
        if (btn.title !== title) {
          btn.title = title;
          btn.setAttribute("aria-label", title);
        }
        btn.classList.toggle("active", isSel);
        btn.hidden = false;
        btn.style.transform = `translate3d(${cssX.toFixed(1)}px, ${(cssY - 7).toFixed(1)}px, 0) translate(-50%, -100%)`;
      }
    }

    for (const [id, btn] of this.trainButtons) {
      if (!activeTrainIds.has(id)) {
        btn.hidden = true;
      }
    }
  }
}
