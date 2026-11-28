import { localToImage, wgs84ToLocal } from "@small-yokohama/core";
import type { ResolvedAirCabinGondola } from "../data/airCabinFeed.js";
import type { ResolvedPlane } from "../data/planeFeed.js";
import type { LoadedReleaseBundle } from "../data/releaseLoader.js";
import type { ResolvedTrain } from "../data/trainFeed.js";
import type {
  AnimatedPortCall,
  ResolvedFeedState,
  ResolvedVehicle,
} from "../data/vehicleFeed.js";
import type { ViewerState } from "../state.js";
import {
  rectIntersectsAny,
  type UiRect,
  type ViewportImageBounds,
} from "./LabelLayer.js";

const SHIP_ICON_SVG = `<svg viewBox="0 0 16 12" aria-hidden="true"><path d="M2 7h12l-1.5 3.5h-9zM4.5 7V4.2h7V7M6.5 4.2V2.2h3v2"/></svg>`;
const TRAIN_ICON_SVG = `<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="8" height="7.5" rx="1.6"/><path d="M3.2 4.2h5.6v2.1H3.2z" fill="rgba(16,28,44,0.45)"/><path d="M3.5 9.2 2.4 11M8.5 9.2l1.1 1.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
const PLANE_ICON_SVG = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.3 4.8 5.2 2.4v1.5L9.3 8.9V12l1.8 1.4v1.1L8 13.7l-3.1.8v-1.1L6.7 12V8.9L1.5 10.2V8.7l5.2-2.4z"/></svg>`;
const HELI_ICON_SVG = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.2h12v1.2H8.8v1.8h2.2a2.5 2.5 0 0 1 2.4 2.5v1.4H5.2A2.2 2.2 0 0 1 3 8.9V7.5L1.5 6.8V5.6l1.8.6h4V5.4H2z"/></svg>`;
const CABIN_ICON_SVG = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.4l13-1.6v1.1L8.6 3.6v1.2h2.6a1.4 1.4 0 0 1 1.4 1.4v4.4a1.4 1.4 0 0 1-1.4 1.4H4.8a1.4 1.4 0 0 1-1.4-1.4V6.2a1.4 1.4 0 0 1 1.4-1.4h2.6V3.7l-5.9.7zm3.2 3v2.8h6.6V6.4z"/></svg>`;

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
  private readonly planeButtons = new Map<string, HTMLButtonElement>();
  private cabinButton: HTMLButtonElement | null = null;
  private currentBusHandler: ((rv: ResolvedVehicle) => void) | null = null;
  private currentBoatHandler: ((pc: AnimatedPortCall) => void) | null = null;
  private currentTrainHandler: ((tr: ResolvedTrain) => void) | null = null;
  private currentPlaneHandler: ((p: ResolvedPlane) => void) | null = null;
  private currentAirCabinHandler: ((c: ResolvedAirCabinGondola) => void) | null = null;
  private latestVehicles = new Map<string, ResolvedVehicle>();
  private latestBoats = new Map<string, AnimatedPortCall>();
  private latestTrains = new Map<string, ResolvedTrain>();
  private latestPlanes = new Map<string, ResolvedPlane>();
  private latestCabin: ResolvedAirCabinGondola | null = null;

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
    planes: readonly ResolvedPlane[] = [],
    airCabins: readonly ResolvedAirCabinGondola[] = [],
    onSelectPlane?: (p: ResolvedPlane) => void,
    onSelectAirCabin?: (c: ResolvedAirCabinGondola) => void,
    uiObstacles: readonly UiRect[] = [],
  ): void {
    if (!container) return;
    if (!bounds) {
      for (const btn of this.busButtons.values()) btn.hidden = true;
      for (const btn of this.boatButtons.values()) btn.hidden = true;
      for (const btn of this.trainButtons.values()) btn.hidden = true;
      for (const btn of this.planeButtons.values()) btn.hidden = true;
      if (this.cabinButton) this.cabinButton.hidden = true;
      return;
    }

    this.currentBusHandler = onSelectVehicle;
    this.currentBoatHandler = onSelectPortCall;
    this.currentTrainHandler = onSelectTrain;
    this.currentPlaneHandler = onSelectPlane ?? null;
    this.currentAirCabinHandler = onSelectAirCabin ?? null;

    const spanX = bounds.bottomRight.x - bounds.topLeft.x;
    const spanY = bounds.bottomRight.y - bounds.topLeft.y;
    if (spanX <= 0 || spanY <= 0 || bounds.widthCssPx <= 0 || bounds.heightCssPx <= 0) {
      return;
    }

    const imgPxPerCssPx = spanX / bounds.widthCssPx;
    const isNarrow = bounds.widthCssPx <= 700;
    const effectiveObstacles: readonly UiRect[] =
      uiObstacles.length > 0
        ? uiObstacles
        : [
            { l: 0, r: Math.min(bounds.widthCssPx - 64, 520), t: 0, b: isNarrow ? 90 : 68 },
            { l: Math.max(0, bounds.widthCssPx - 68), r: bounds.widthCssPx, t: 0, b: 290 },
            {
              l: 0,
              r: isNarrow ? bounds.widthCssPx : 640,
              t: Math.max(0, bounds.heightCssPx - (isNarrow ? 92 : 68)),
              b: bounds.heightCssPx,
            },
          ];
    const fitsClearOfChrome = (
      cssX: number,
      cssY: number,
      w: number,
      h: number,
      anchorYOffset: number,
      isSelected: boolean,
    ): boolean => {
      if (isSelected) {
        return (
          cssX >= 10 &&
          cssX <= bounds.widthCssPx - 10 &&
          cssY >= 12 &&
          cssY <= bounds.heightCssPx - 10
        );
      }
      const box: UiRect = {
        l: cssX - w * 0.5,
        r: cssX + w * 0.5,
        t: cssY - anchorYOffset - h,
        b: cssY - anchorYOffset,
      };
      return (
        box.l >= 6 &&
        box.r <= bounds.widthCssPx - 6 &&
        box.t >= 6 &&
        box.b <= bounds.heightCssPx - 6 &&
        !rectIntersectsAny(box, effectiveObstacles)
      );
    };
    const cam = bundle.camera;
    const selVehicleId =
      state.selected?.kind === "vehicle" ? state.selected.vehicle.entityId : null;
    const selBoatId =
      state.selected?.kind === "portcall" ? state.selected.portCall.id : null;
    const selTrainId =
      state.selected?.kind === "train" ? state.selected.train.id : null;
    const selPlaneId =
      state.selected?.kind === "plane" ? state.selected.plane.id : null;
    const selCabinId =
      state.selected?.kind === "aircabin" ? state.selected.cabin.id : null;

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
        const meta = getBusBadgeMeta(v.routeId);
        const isSel = v.entityId === selVehicleId;
        if (!fitsClearOfChrome(cssX, cssY, Math.max(30, meta.code.length * 7 + 16), 20, 6, isSel)) {
          continue;
        }
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
        const shortName = getShortBoatName(pc, state.lang);
        const boatW = Math.min(
          148,
          shortName.length * (/[\u3040-\u9fff]/.test(shortName) ? 10.5 : 6.4) + 26,
        );
        const isSel = pc.id === selBoatId;
        if (!fitsClearOfChrome(cssX, cssY, boatW, 20, 8, isSel)) {
          continue;
        }
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
        const isSel = tr.id === selTrainId;
        if (!fitsClearOfChrome(cssX, cssY, Math.max(36, tr.code.length * 7 + 18), 20, 7, isSel)) {
          continue;
        }
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

    // 4. YOKOHAMA AIR CABIN Floating Ropeway Pill
    let showCabinPill = false;
    if (state.showAirCabin && airCabins.length > 0 && imgPxPerCssPx <= 7.5) {
      const targetCabin =
        (selCabinId ? airCabins.find((c) => c.id === selCabinId) : null) ??
        airCabins.reduce((best, cur) =>
          Math.abs(cur.progress01 - 0.5) < Math.abs(best.progress01 - 0.5) ? cur : best,
        );
      if (targetCabin) {
        this.latestCabin = targetCabin;
        const img = localToImage(
          cam,
          wgs84ToLocal(cam, targetCabin.lon, targetCabin.lat, targetCabin.cableElevM + 1.5),
        );
        const cssX = ((img.px - bounds.topLeft.x) / spanX) * bounds.widthCssPx;
        const cssY = ((img.py - bounds.topLeft.y) / spanY) * bounds.heightCssPx;
        if (fitsClearOfChrome(cssX, cssY, 88, 20, 8, selCabinId !== null)) {
          showCabinPill = true;
          if (!this.cabinButton) {
            const cBtn = document.createElement("button");
            cBtn.type = "button";
            cBtn.className = "cabin-pill";
            cBtn.innerHTML = `${CABIN_ICON_SVG}<span class="cp-lbl">AIR CABIN</span>`;
            cBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (this.latestCabin) this.currentAirCabinHandler?.(this.latestCabin);
            });
            this.cabinButton = cBtn;
            container.appendChild(cBtn);
          }
          const lblSpan = this.cabinButton.querySelector("span.cp-lbl");
          const lblText = selCabinId ? `AIR CABIN #${targetCabin.cabinNumber}` : "AIR CABIN";
          if (lblSpan && lblSpan.textContent !== lblText) {
            lblSpan.textContent = lblText;
          }
          const cTitle = `YOKOHAMA AIR CABIN #${targetCabin.cabinNumber} — ${
            state.lang === "en" ? targetCabin.directionEn : targetCabin.directionJa
          }`;
          if (this.cabinButton.title !== cTitle) {
            this.cabinButton.title = cTitle;
            this.cabinButton.setAttribute("aria-label", cTitle);
          }
          this.cabinButton.classList.toggle("active", selCabinId !== null);
          this.cabinButton.hidden = false;
          this.cabinButton.style.transform = `translate3d(${cssX.toFixed(1)}px, ${(cssY - 8).toFixed(1)}px, 0) translate(-50%, -100%)`;
        }
      }
    }
    if (!showCabinPill && this.cabinButton) {
      this.cabinButton.hidden = true;
    }

    // 5. Airborne Aircraft Pills (Live ADS-B & Haneda/Bay flights)
    const activePlaneIds = new Set<string>();
    const placedPlaneCoords: Array<{ x: number; y: number }> = [];
    const showPlanePills = state.showPlanes && planes.length > 0 && imgPxPerCssPx <= 18.0;

    if (showPlanePills) {
      const sortedPlanes = [...planes].sort((a, b) => {
        const aSel = a.id === selPlaneId ? 0 : 1;
        const bSel = b.id === selPlaneId ? 0 : 1;
        if (aSel !== bSel) return aSel - bSel;
        return a.altitudeFt - b.altitudeFt;
      });

      for (const p of sortedPlanes) {
        this.latestPlanes.set(p.id, p);
        const img = localToImage(
          cam,
          wgs84ToLocal(cam, p.lon, p.lat, p.displayElevM + 8),
        );
        const cssX = ((img.px - bounds.topLeft.x) / spanX) * bounds.widthCssPx;
        const cssY = ((img.py - bounds.topLeft.y) / spanY) * bounds.heightCssPx;
        const isSel = p.id === selPlaneId;
        if (!fitsClearOfChrome(cssX, cssY, Math.max(66, p.callsign.length * 6.5 + 36), 20, 8, isSel)) {
          continue;
        }
        if (
          !isSel &&
          placedPlaneCoords.some((q) => Math.abs(q.x - cssX) < 68 && Math.abs(q.y - cssY) < 26)
        ) {
          continue;
        }
        placedPlaneCoords.push({ x: cssX, y: cssY });
        activePlaneIds.add(p.id);

        let btn = this.planeButtons.get(p.id);
        if (!btn) {
          btn = document.createElement("button");
          btn.type = "button";
          btn.className = `plane-pill pm-${p.meshKind}${p.mode === "observed" ? " is-live" : ""}`;
          btn.innerHTML = `${p.meshKind === "heli" ? HELI_ICON_SVG : PLANE_ICON_SVG}<span class="pp-cs"></span><span class="pp-alt"></span>`;
          btn.dataset.planeId = p.id;
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const cur = this.latestPlanes.get(p.id);
            if (cur) this.currentPlaneHandler?.(cur);
          });
          this.planeButtons.set(p.id, btn);
          container.appendChild(btn);
        }

        const csEl = btn.querySelector("span.pp-cs");
        if (csEl && csEl.textContent !== p.callsign) {
          csEl.textContent = p.callsign;
        }
        const altLabel = `${p.altitudeM}m`;
        const altEl = btn.querySelector("span.pp-alt");
        if (altEl && altEl.textContent !== altLabel) {
          altEl.textContent = altLabel;
        }
        const pTitle = `${p.callsign} (${state.lang === "en" ? p.airlineEn : p.airlineJa}) · ${p.altitudeM}m · ${p.groundSpeedKmh}km/h`;
        if (btn.title !== pTitle) {
          btn.title = pTitle;
          btn.setAttribute("aria-label", pTitle);
        }
        btn.classList.toggle("active", isSel);
        btn.hidden = false;
        btn.style.transform = `translate3d(${cssX.toFixed(1)}px, ${(cssY - 8).toFixed(1)}px, 0) translate(-50%, -100%)`;
      }
    }

    for (const [id, btn] of this.planeButtons) {
      if (!activePlaneIds.has(id)) {
        btn.hidden = true;
      }
    }
  }
}
