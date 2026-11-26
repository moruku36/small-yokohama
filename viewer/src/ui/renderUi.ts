import {
  computeYokohamaSun,
  type Landmark,
  type PoiRecord,
} from "@small-yokohama/core";
import type { ResolvedAirCabinGondola } from "../data/airCabinFeed.js";
import type { ResolvedPlane } from "../data/planeFeed.js";
import type { LoadedReleaseBundle } from "../data/releaseLoader.js";
import { resolveStationDepartures } from "../data/stationDepartures.js";
import type { ResolvedTrain, YokohamaRailBundle } from "../data/trainFeed.js";
import type { AnimatedPortCall, ResolvedFeedState } from "../data/vehicleFeed.js";
import type { WeatherMode } from "../data/weatherFeed.js";
import {
  formatAddress,
  formatBuildingType,
  formatCategory,
  formatDeckId,
  formatSourceKind,
  formatSurfaceKind,
  formatTimeStatusText,
  getDict,
  type Lang,
} from "../i18n.js";
import type { DropTab, FeedPreset, MapVariant, ViewerState } from "../state.js";
import { SKY_PRESETS, getSkyPresetsForDate, getSunDateForHourJst } from "../viewer/skyLighting.js";

export type BooleanOptionKey =
  | "showTrains"
  | "showBuses"
  | "showBoats"
  | "showPlanes"
  | "showAirCabin"
  | "showTraffic"
  | "showPedestrians"
  | "showLabels"
  | "showDepthMap"
  | "xrayOcclusion"
  | "showTileGrid"
  | "showGcps"
  | "showDeckTestPoint"
  | "reducedMotion";

export interface UiHandlers {
  onSetTab: (tab: DropTab) => void;
  onSearchQuery: (q: string) => void;
  onToggleTv: () => void;
  onShare: (anchorEl?: HTMLElement | null) => Promise<boolean>;
  onToggleAbout: (open: boolean) => void;
  onToggleLang: () => void;
  onToggleTheme: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleFullscreen: () => void;
  onResetView: () => void;
  onChangeVariant: (v: MapVariant) => void;
  onChangeFeed: (f: FeedPreset) => void;
  onChangeSunHour: (hour: number | null) => void;
  onChangeWeatherMode: (mode: WeatherMode) => void;
  onTogglePlay: () => void;
  onToggleOption: (key: BooleanOptionKey) => void;
  onSelectLandmarkId: (id: string) => void;
  onSelectFeatureId: (fid: number) => void;
  onSelectPoi: (poi: PoiRecord) => void;
  onSelectPortCall: (pc: AnimatedPortCall) => void;
  onSelectTrain: (tr: ResolvedTrain) => void;
  onSelectPlane?: (p: ResolvedPlane) => void;
  onSelectAirCabin?: (c: ResolvedAirCabinGondola) => void;
  onClearSelection: () => void;
  onToggleSound: () => void;
  onToggleFollow: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildGoogleMapsUrl(lat: number, lon: number, label?: string): string {
  const q = label
    ? `${label} ${lat.toFixed(6)},${lon.toFixed(6)}`
    : `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function renderBar(
  el: HTMLElement,
  state: ViewerState,
  handlers: UiHandlers,
): void {
  const d = getDict(state.lang);

  el.innerHTML = `
    <span class="title">${escapeHtml(d.brand)}</span>
    <nav class="tools" aria-label="Map tools">
      <button type="button" id="btn-tab-search" aria-expanded="${state.activeTab === "search"}">${escapeHtml(d.navSearch)}</button>
      <button type="button" id="btn-tab-places" aria-expanded="${state.activeTab === "places"}">${escapeHtml(d.navPlaces)}</button>
      <button type="button" id="btn-tab-layers" aria-expanded="${state.activeTab === "layers"}">${escapeHtml(d.navLayers)}</button>
      <button type="button" id="btn-tv" class="${state.tvMode ? "active" : ""}" aria-pressed="${state.tvMode}">${escapeHtml(d.navTv)}</button>
      <button type="button" id="btn-share">${escapeHtml(d.navShare)}</button>
      <button type="button" id="btn-about" aria-expanded="${state.aboutOpen}">${escapeHtml(d.navAbout)}</button>
      <button type="button" id="btn-lang">${escapeHtml(d.navLang)}</button>
    </nav>
  `;

  el.querySelector("#btn-tab-search")?.addEventListener("click", () => {
    handlers.onSetTab(state.activeTab === "search" ? null : "search");
  });
  el.querySelector("#btn-tab-places")?.addEventListener("click", () => {
    handlers.onSetTab(state.activeTab === "places" ? null : "places");
  });
  el.querySelector("#btn-tab-layers")?.addEventListener("click", () => {
    handlers.onSetTab(state.activeTab === "layers" ? null : "layers");
  });
  el.querySelector("#btn-tv")?.addEventListener("click", handlers.onToggleTv);
  el.querySelector("#btn-share")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const ok = await handlers.onShare(btn);
    if (ok && btn.isConnected) {
      btn.textContent = d.navCopied;
      window.setTimeout(() => {
        if (btn.isConnected) btn.textContent = d.navShare;
      }, 1500);
    }
  });
  el.querySelector("#btn-about")?.addEventListener("click", () => {
    handlers.onToggleAbout(!state.aboutOpen);
  });
  el.querySelector("#btn-lang")?.addEventListener("click", handlers.onToggleLang);
}

function buildSearchResultsHtml(
  state: ViewerState,
  bundle: LoadedReleaseBundle,
  feed: ResolvedFeedState | null,
  planes: readonly ResolvedPlane[] = [],
  airCabins: readonly ResolvedAirCabinGondola[] = [],
): string {
  const d = getDict(state.lang);
  const q = state.searchQuery.trim().toLowerCase();

  type SearchHit =
    | { kind: "landmark"; id: string; title: string; sub: string; score: number }
    | { kind: "poi"; poi: PoiRecord; title: string; sub: string; score: number }
    | { kind: "building"; featureId: number; title: string; sub: string; score: number }
    | { kind: "aircabin"; cabin: ResolvedAirCabinGondola; title: string; sub: string; score: number }
    | { kind: "plane"; plane: ResolvedPlane; title: string; sub: string; score: number }
    | { kind: "portcall"; pc: AnimatedPortCall; title: string; sub: string; score: number };

  const hits: SearchHit[] = [];
  const seenKeys = new Set<string>();

  if (airCabins.length > 0) {
    const cabinHay = "yokohama air cabin エアキャビン ロープウェイ ゴンドラ 桜木町 sakuragicho unga park 運河パーク";
    if (!q || cabinHay.includes(q)) {
      const sampleCabin =
        airCabins.find((c) => Math.abs(c.progress01 - 0.5) < 0.2) ?? airCabins[0]!;
      hits.push({
        kind: "aircabin",
        cabin: sampleCabin,
        title: d.airCabinName,
        sub: state.lang === "en" ? "Sakuragicho <-> Unga Park Ropeway" : "桜木町駅前 ↔ 運河パーク駅 ロープウェイ",
        score: 0.4,
      });
    }
  }

  for (const p of planes) {
    const title = `${p.callsign} (${state.lang === "en" ? p.airlineEn : p.airlineJa})`;
    const hay = `${p.callsign} ${p.airlineJa} ${p.airlineEn} ${p.aircraftType} ${p.registration} 飛行機 plane flight`.toLowerCase();
    if (q && hay.includes(q)) {
      hits.push({
        kind: "plane",
        plane: p,
        title,
        sub: `${d.planeKinds[p.meshKind]} · ${p.altitudeM} m`,
        score: 0.8,
      });
    }
  }

  for (const lm of bundle.landmarks) {
    const title = state.lang === "en" ? lm.nameEn : lm.nameJa;
    const hay = `${lm.nameJa} ${lm.nameEn} ${lm.category} ${lm.address ?? ""}`.toLowerCase();
    if (!q || hay.includes(q)) {
      hits.push({
        kind: "landmark",
        id: lm.id,
        title,
        sub: formatCategory(lm.category, state.lang),
        score: lm.tier === 1 ? 0 : 1,
      });
      seenKeys.add(`${lm.nameJa.toLowerCase()}|${lm.nameEn.toLowerCase()}`);
    }
  }

  for (const poi of bundle.pois) {
    const dedupeKey = `${poi.nameJa.toLowerCase()}|${poi.nameEn.toLowerCase()}`;
    if (seenKeys.has(dedupeKey)) continue;
    const title = (state.lang === "en" ? poi.nameEn : poi.nameJa) || poi.nameJa || poi.nameEn;
    const hay = `${poi.nameJa} ${poi.nameEn} ${poi.category} ${poi.address ?? ""}`.toLowerCase();
    if (!q || hay.includes(q)) {
      hits.push({
        kind: "poi",
        poi,
        title,
        sub: formatCategory(poi.category, state.lang),
        score: poi.tier + (title.toLowerCase().startsWith(q) && q ? -1 : 1),
      });
      seenKeys.add(dedupeKey);
    }
  }

  if (q.length >= 2) {
    let bldAdded = 0;
    for (const b of bundle.namedBuildings ?? []) {
      const title = state.lang === "en" ? b.nameEn : b.nameJa;
      if (!title) continue;
      const dedupeKey = `${b.nameJa.toLowerCase()}|${b.nameEn.toLowerCase()}`;
      if (seenKeys.has(dedupeKey)) continue;
      const hay = `${b.nameJa} ${b.nameEn} ${b.buildingType} ${b.address}`.toLowerCase();
      if (hay.includes(q)) {
        const bTypeLabel = formatBuildingType(b.buildingType, state.lang);
        const hLabel = b.heightM > 0 ? ` · ${b.heightM.toFixed(0)} m` : "";
        hits.push({
          kind: "building",
          featureId: b.featureId,
          title,
          sub: `${bTypeLabel}${hLabel}`,
          score: (title.toLowerCase().startsWith(q) ? 2 : 3) + (b.heightM > 35 ? -0.3 : 0),
        });
        seenKeys.add(dedupeKey);
        bldAdded++;
        if (bldAdded >= 40) break;
      }
    }
  }

  for (const pc of feed?.portCalls ?? []) {
    const title = state.lang === "en" ? pc.vesselNameEn : pc.vesselNameJa;
    const berth = state.lang === "en" ? pc.berthEn : pc.berthJa;
    const hay = `${pc.vesselNameJa} ${pc.vesselNameEn} ${berth}`.toLowerCase();
    if (!q || hay.includes(q)) {
      hits.push({
        kind: "portcall",
        pc,
        title,
        sub: berth,
        score: 2,
      });
    }
  }

  hits.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));
  const top = hits.slice(0, 28);

  if (top.length === 0) {
    return `<li class="search-empty">${escapeHtml(d.searchEmpty)}</li>`;
  }

  return top
    .map((h) => {
      if (h.kind === "landmark") {
        return `<li><button type="button" data-landmark-id="${escapeHtml(h.id)}"><span class="r-name">${escapeHtml(h.title)}</span><span class="r-sub">${escapeHtml(h.sub)}</span></button></li>`;
      }
      if (h.kind === "poi") {
        return `<li><button type="button" data-poi-id="${escapeHtml(h.poi.id)}"><span class="r-name">${escapeHtml(h.title)}</span><span class="r-sub">${escapeHtml(h.sub)}</span></button></li>`;
      }
      if (h.kind === "building") {
        return `<li><button type="button" data-feature-id="${h.featureId}"><span class="r-name">${escapeHtml(h.title)}</span><span class="r-sub">${escapeHtml(h.sub)}</span></button></li>`;
      }
      if (h.kind === "aircabin") {
        return `<li><button type="button" data-aircabin-id="${escapeHtml(h.cabin.id)}"><span class="r-name">${escapeHtml(h.title)}</span><span class="r-sub">${escapeHtml(h.sub)}</span></button></li>`;
      }
      if (h.kind === "plane") {
        return `<li><button type="button" data-plane-id="${escapeHtml(h.plane.id)}"><span class="r-name">${escapeHtml(h.title)}</span><span class="r-sub">${escapeHtml(h.sub)}</span></button></li>`;
      }
      return `<li><button type="button" data-portcall-id="${escapeHtml(h.pc.id)}"><span class="r-name">${escapeHtml(h.title)}</span><span class="r-sub">${escapeHtml(h.sub)}</span></button></li>`;
    })
    .join("");
}

function bindListSelections(
  container: HTMLElement,
  bundle: LoadedReleaseBundle,
  feed: ResolvedFeedState | null,
  handlers: UiHandlers,
  planes: readonly ResolvedPlane[] = [],
  airCabins: readonly ResolvedAirCabinGondola[] = [],
): void {
  container.querySelectorAll<HTMLButtonElement>("button[data-landmark-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.landmarkId;
      if (id) handlers.onSelectLandmarkId(id);
    });
  });

  container.querySelectorAll<HTMLButtonElement>("button[data-poi-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const poi = bundle.pois.find((p) => p.id === btn.dataset.poiId);
      if (poi) handlers.onSelectPoi(poi);
    });
  });

  container.querySelectorAll<HTMLButtonElement>("button[data-feature-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fid = Number(btn.dataset.featureId);
      if (Number.isFinite(fid)) handlers.onSelectFeatureId(fid);
    });
  });

  container.querySelectorAll<HTMLButtonElement>("button[data-aircabin-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cabin = airCabins.find((c) => c.id === btn.dataset.aircabinId) ?? airCabins[0];
      if (cabin) handlers.onSelectAirCabin?.(cabin);
    });
  });

  container.querySelectorAll<HTMLButtonElement>("button[data-plane-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = planes.find((x) => x.id === btn.dataset.planeId);
      if (p) handlers.onSelectPlane?.(p);
    });
  });

  container.querySelectorAll<HTMLButtonElement>("button[data-portcall-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pc = feed?.portCalls.find((p) => p.id === btn.dataset.portcallId);
      if (pc) handlers.onSelectPortCall(pc);
    });
  });
}

function renderPlacesGroupsHtml(
  state: ViewerState,
  bundle: LoadedReleaseBundle,
  feed: ResolvedFeedState | null,
): string {
  const d = getDict(state.lang);
  const landmarks: Landmark[] = [];
  const stations: Landmark[] = [];
  const corporate: Landmark[] = [];
  const piersAndBridges: Landmark[] = [];
  const parks: Landmark[] = [];

  for (const lm of bundle.landmarks) {
    if (lm.category === "station") stations.push(lm);
    else if (lm.id.startsWith("cur-")) corporate.push(lm);
    else if (lm.category === "park") parks.push(lm);
    else if (lm.category === "pier" || lm.category === "bridge") piersAndBridges.push(lm);
    else landmarks.push(lm);
  }

  const renderGroup = (heading: string, list: readonly Landmark[]) => {
    if (list.length === 0) return "";
    return `
      <section class="places-group">
        <h3>${escapeHtml(heading)}</h3>
        <ul>
          ${list
            .map(
              (lm) => `
            <li>
              <button type="button" data-landmark-id="${escapeHtml(lm.id)}">
                ${escapeHtml(state.lang === "en" ? lm.nameEn : lm.nameJa)}
              </button>
            </li>`,
            )
            .join("")}
        </ul>
      </section>
    `;
  };

  const portCalls = feed?.portCalls ?? [];
  const shipsHtml =
    portCalls.length === 0
      ? ""
      : `
      <section class="places-group">
        <h3>${escapeHtml(d.placesGroups.ships)}</h3>
        <ul>
          ${portCalls
            .map(
              (pc) => `
            <li>
              <button type="button" data-portcall-id="${escapeHtml(pc.id)}">
                ${escapeHtml(state.lang === "en" ? pc.vesselNameEn : pc.vesselNameJa)}
              </button>
            </li>`,
            )
            .join("")}
        </ul>
      </section>
    `;

  return (
    renderGroup(d.placesGroups.landmarks, landmarks) +
    renderGroup(d.placesGroups.stations, stations) +
    renderGroup(d.placesGroups.corporate, corporate) +
    renderGroup(d.placesGroups.piers, piersAndBridges) +
    renderGroup(d.placesGroups.parks, parks) +
    shipsHtml
  );
}

function isSkyPresetActive(currentHour: number | null, presetHour: number | null): boolean {
  if (presetHour === null) return currentHour === null;
  if (currentHour === null) return false;
  return Math.abs(currentHour - presetHour) < 0.08;
}

export function renderDrop(
  el: HTMLElement,
  state: ViewerState,
  bundle: LoadedReleaseBundle,
  feed: ResolvedFeedState | null,
  handlers: UiHandlers,
  trains: readonly ResolvedTrain[] = [],
  planes: readonly ResolvedPlane[] = [],
  airCabins: readonly ResolvedAirCabinGondola[] = [],
): void {
  if (!state.activeTab) {
    el.hidden = true;
    delete el.dataset.renderKey;
    return;
  }
  el.hidden = false;
  const d = getDict(state.lang);

  if (state.activeTab === "search") {
    const modeKey = `search|${state.lang}`;
    const existingInput = el.querySelector<HTMLInputElement>("#inp-search");
    const existingList = el.querySelector<HTMLElement>("#search-results");

    if (el.dataset.renderKey === modeKey && existingInput && existingList) {
      if (existingInput.value !== state.searchQuery) {
        existingInput.value = state.searchQuery;
      }
      existingList.innerHTML = buildSearchResultsHtml(state, bundle, feed, planes, airCabins);
      bindListSelections(existingList, bundle, feed, handlers, planes, airCabins);
      return;
    }

    el.dataset.renderKey = modeKey;
    el.innerHTML = `
      <div class="find">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 21 21" />
        </svg>
        <input id="inp-search" type="search" autocomplete="off" enterkeyhint="search" placeholder="${escapeHtml(d.searchPlaceholder)}" value="${escapeHtml(state.searchQuery)}" />
      </div>
      <ul id="search-results" class="results">
        ${buildSearchResultsHtml(state, bundle, feed, planes, airCabins)}
      </ul>
    `;

    const input = el.querySelector<HTMLInputElement>("#inp-search");
    const resultsEl = el.querySelector<HTMLElement>("#search-results");
    if (resultsEl) {
      bindListSelections(resultsEl, bundle, feed, handlers, planes, airCabins);
    }
    input?.addEventListener("input", () => {
      handlers.onSearchQuery(input.value);
    });
    input?.focus();
    const len = input?.value.length ?? 0;
    input?.setSelectionRange(len, len);
    return;
  }

  delete el.dataset.renderKey;

  if (state.activeTab === "places") {
    el.innerHTML = `<div class="page">${renderPlacesGroupsHtml(state, bundle, feed)}</div>`;
    bindListSelections(el, bundle, feed, handlers, planes, airCabins);
    return;
  }

  // Layers tab (Small SF typographic toggles + compact Sky pills + Dev/QA accordion)
  const trainCount = trains.length;
  const busCount = feed?.vehicles.length ?? 0;
  const boatCount = feed?.portCalls.length ?? 0;
  const planeCount = planes.length;
  const nearbyPlanes = planes[0]?.nearbyCount ?? 0;
  const hasObservedBus = feed?.vehicles.some((rv) => rv.displayMode === "observed") ?? false;
  const trainLabel = state.lang === "en" ? `${trainCount} live` : `${trainCount}編成`;
  const busLabel =
    state.lang === "en"
      ? `${busCount}${hasObservedBus ? " live" : " fleet"}`
      : `${busCount}台${hasObservedBus ? " (実測)" : ""}`;
  const boatLabel = state.lang === "en" ? `${boatCount} scheduled` : `${boatCount}隻`;
  const planeLabel =
    nearbyPlanes > 0
      ? state.lang === "en"
        ? `${planeCount} · ${nearbyPlanes} ${d.nearbyHaneda}`
        : `${planeCount}機 · ${d.nearbyHaneda} ${nearbyPlanes}`
      : state.lang === "en"
        ? `${planeCount} flights`
        : `${planeCount}機`;
  const cabinLabel =
    state.lang === "en" ? `${airCabins.length || 16} cabins` : `${airCabins.length || 16}基`;
  const presets = getSkyPresetsForDate(new Date());
  const skyItems: Array<{ label: string; value: number | null }> = [
    { label: d.skyPresets.day, value: presets.day },
    { label: d.skyPresets.golden, value: presets.golden },
    { label: d.skyPresets.dusk, value: presets.dusk },
    { label: d.skyPresets.night, value: presets.night },
    { label: d.skyPresets.live, value: presets.live },
  ];

  const debugToggle = (key: BooleanOptionKey, label: string, checked: boolean) => `
    <label class="debug-row">
      <span>${escapeHtml(label)}</span>
      <input type="checkbox" data-opt="${key}" ${checked ? "checked" : ""} />
    </label>
  `;

  el.innerHTML = `
    <div class="layers">
      <button type="button" class="layer-btn" data-toggle="showTrains" aria-pressed="${state.showTrains}">
        <span>${escapeHtml(d.layerTrains)}</span>
        <small>${escapeHtml(trainLabel)}</small>
      </button>
      <button type="button" class="layer-btn" data-toggle="showBuses" aria-pressed="${state.showBuses}">
        <span>${escapeHtml(d.layerBuses)}</span>
        <small>${escapeHtml(busLabel)}</small>
      </button>
      <button type="button" class="layer-btn" data-toggle="showBoats" aria-pressed="${state.showBoats}">
        <span>${escapeHtml(d.layerBoats)}</span>
        <small>${escapeHtml(boatLabel)}</small>
      </button>
      <button type="button" class="layer-btn" data-toggle="showAirCabin" aria-pressed="${state.showAirCabin}">
        <span>${escapeHtml(d.layerAirCabin)}</span>
        <small>${escapeHtml(cabinLabel)}</small>
      </button>
      <button type="button" class="layer-btn" data-toggle="showPlanes" aria-pressed="${state.showPlanes}">
        <span>${escapeHtml(d.layerPlanes)}</span>
        <small>${escapeHtml(planeLabel)}</small>
      </button>
      <button type="button" class="layer-btn" data-toggle="showTraffic" aria-pressed="${state.showTraffic}">
        <span>${escapeHtml(d.layerTraffic)}</span>
        <small>OSM</small>
      </button>
      <button type="button" class="layer-btn" data-toggle="showPedestrians" aria-pressed="${state.showPedestrians}">
        <span>${escapeHtml(d.layerPedestrians)}</span>
        <small>${state.lang === "en" ? "Sidewalks" : "街並み"}</small>
      </button>
      <button type="button" class="layer-btn" data-toggle="showLabels" aria-pressed="${state.showLabels}">
        <span>${escapeHtml(d.layerLabels)}</span>
        <small>${bundle.pois.length}</small>
      </button>
      <button type="button" class="layer-btn" id="btn-play" aria-pressed="${state.playing}">
        <span>${escapeHtml(d.layerMotion)}</span>
        <small>${escapeHtml(state.playing ? d.playBtn : d.pauseBtn)}</small>
      </button>

      <div class="sky-row">
        <span class="sky-row-label">${escapeHtml(d.layerSky)}</span>
        <div class="sky-pills" role="group" aria-label="${escapeHtml(d.layerSky)}">
          ${skyItems
            .map((item) => {
              const active = isSkyPresetActive(state.sunHourJst, item.value);
              const valStr = item.value === null ? "live" : String(item.value);
              return `<button type="button" class="sky-pill${active ? " active" : ""}" data-sun="${valStr}" aria-pressed="${active}">${escapeHtml(item.label)}</button>`;
            })
            .join("")}
        </div>
      </div>

      <div class="sky-row">
        <span class="sky-row-label">${escapeHtml(d.layerWeather)}</span>
        <div class="sky-pills" role="group" aria-label="${escapeHtml(d.layerWeather)}">
          ${(["live", "clear", "rain"] as const)
            .map((m) => {
              const active = state.weatherMode === m;
              return `<button type="button" class="sky-pill${active ? " active" : ""}" data-weather="${m}" aria-pressed="${active}">${escapeHtml(d.weatherPresets[m])}</button>`;
            })
            .join("")}
        </div>
      </div>

      <details class="debug-details">
        <summary>${escapeHtml(d.devQaTitle)}</summary>
        <div class="debug-list">
          <div class="layer-subrow">
            <label for="sel-variant">${escapeHtml(d.layerStyle)}</label>
            <select id="sel-variant">
              <option value="illustrated" ${state.variant === "illustrated" ? "selected" : ""}>${escapeHtml(d.styleIllustrated)}</option>
              <option value="plain" ${state.variant === "plain" ? "selected" : ""}>${escapeHtml(d.stylePlain)}</option>
            </select>
          </div>
          <div class="layer-subrow">
            <label for="sel-feed">${escapeHtml(d.feedLabel)}</label>
            <select id="sel-feed">
              ${(Object.keys(d.feedOptions) as FeedPreset[])
                .map(
                  (k) =>
                    `<option value="${k}" ${state.feedPreset === k ? "selected" : ""}>${escapeHtml(d.feedOptions[k])}</option>`,
                )
                .join("")}
            </select>
          </div>
          ${debugToggle("showDepthMap", d.toggleDepth, state.showDepthMap)}
          ${debugToggle("xrayOcclusion", d.toggleXray, state.xrayOcclusion)}
          ${debugToggle("showTileGrid", d.toggleTileGrid, state.showTileGrid)}
          ${debugToggle("showGcps", d.toggleGcps, state.showGcps)}
          ${debugToggle("showDeckTestPoint", d.toggleDeckPoint, state.showDeckTestPoint)}
          ${debugToggle("reducedMotion", d.toggleReducedMotion, state.reducedMotion)}
        </div>
      </details>
    </div>
  `;

  el.querySelectorAll<HTMLButtonElement>("button[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const opt = btn.dataset.toggle as BooleanOptionKey;
      handlers.onToggleOption(opt);
    });
  });

  el.querySelectorAll<HTMLButtonElement>("button[data-sun]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.sun;
      handlers.onChangeSunHour(!v || v === "live" ? null : Number(v));
    });
  });

  el.querySelectorAll<HTMLButtonElement>("button[data-weather]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const w = btn.dataset.weather as WeatherMode | undefined;
      if (w) handlers.onChangeWeatherMode(w);
    });
  });

  el.querySelector("#sel-variant")?.addEventListener("change", (e) => {
    handlers.onChangeVariant((e.target as HTMLSelectElement).value as MapVariant);
  });
  el.querySelector("#sel-feed")?.addEventListener("change", (e) => {
    handlers.onChangeFeed((e.target as HTMLSelectElement).value as FeedPreset);
  });
  el.querySelector("#btn-play")?.addEventListener("click", handlers.onTogglePlay);
  el.querySelectorAll<HTMLInputElement>("input[data-opt]").forEach((inp) => {
    inp.addEventListener("change", () => {
      handlers.onToggleOption(inp.dataset.opt as BooleanOptionKey);
    });
  });
}

function buildStationBoardHtml(
  stationId: string | undefined,
  nameJa: string,
  nameEn: string,
  category: string | undefined,
  state: ViewerState,
  railBundle: YokohamaRailBundle | null,
  trains: readonly ResolvedTrain[],
): string {
  const board = resolveStationDepartures(
    stationId,
    nameJa,
    nameEn,
    category,
    railBundle,
    trains,
    state.simTimeSec,
  );
  if (!board) return "";
  const d = getDict(state.lang);
  const en = state.lang === "en";
  const statusTag = board.hasLiveTelemetry ? d.departureLiveBadge : d.departureSchedBadge;
  const rowsHtml =
    board.isOvernightPause || board.departures.length === 0
      ? `<p class="dep-empty">${escapeHtml(d.departureOvernight)}</p>`
      : `<ul class="dep-list">${board.departures
          .map((row) => {
            const dest = en ? row.destinationEn : row.destinationJa;
            const svc = en ? row.trainTypeEn : row.trainTypeJa;
            const etaText =
              row.secondsUntil <= 40
                ? d.departureDue
                : en
                  ? `${row.minutesUntil} ${d.departureMin}`
                  : `${row.minutesUntil}${d.departureMin}`;
            const delayBadge =
              row.delayMin > 0
                ? `<span class="dep-delay">+${row.delayMin}m</span>`
                : "";
            return `
              <li class="dep-row">
                <span class="dep-line" style="background:${escapeHtml(row.lineColorHex)}">${escapeHtml(row.lineCode)}</span>
                <span class="dep-mid">
                  <span class="dep-dest">${escapeHtml(dest)}</span>
                  <span class="dep-type">${escapeHtml(svc)}</span>
                </span>
                <span class="dep-right">
                  ${delayBadge}
                  <span class="dep-eta${row.secondsUntil <= 40 ? " due" : ""}">${escapeHtml(etaText)}</span>
                </span>
              </li>`;
          })
          .join("")}</ul>`;

  return `
    <div class="dep-board">
      <div class="dep-head">
        <span>${escapeHtml(d.departureBoardTitle)}</span>
        <span class="dep-mode ${board.hasLiveTelemetry ? "live" : ""}">${escapeHtml(statusTag)}</span>
      </div>
      ${rowsHtml}
    </div>
  `;
}

export function renderCard(
  el: HTMLElement,
  state: ViewerState,
  feed: ResolvedFeedState | null,
  driftCssPx: number,
  handlers: UiHandlers,
  trains: readonly ResolvedTrain[] = [],
  planes: readonly ResolvedPlane[] = [],
  airCabins: readonly ResolvedAirCabinGondola[] = [],
  railBundle: YokohamaRailBundle | null = null,
): void {
  const sel = state.selected;
  if (!sel) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const d = getDict(state.lang);

  let title = "";
  let sub = "";
  let badgeHtml = "";
  let bodyNote = "";
  let extraBlockHtml = "";
  let rowsHtml = "";
  let gmapsUrl = "";

  if (sel.kind === "vehicle") {
    const liveMatch = feed?.vehicles.find((rv) => rv.record.entityId === sel.vehicle.entityId);
    const v = liveMatch?.record ?? sel.vehicle;
    const displayMode = liveMatch?.displayMode ?? sel.vehicle.mode;
    const ageSec = liveMatch?.freshness.ageSec ?? sel.ageSec;
    const badgeCls =
      displayMode === "observed" ? "observed" : displayMode === "stale" ? "stale" : "";
    const note = state.lang === "en" ? liveMatch?.noteEn : liveMatch?.noteJa;

    title = state.lang === "en" ? v.routeLabelEn : v.routeLabelJa;
    sub = `${v.lat.toFixed(5)}, ${v.lon.toFixed(5)}`;
    badgeHtml = `<span class="badge ${badgeCls}">${escapeHtml(d.modeLabels[displayMode])}</span>`;
    bodyNote = note ? `<p class="card-sub" style="margin-top:6px;">${escapeHtml(note)}</p>` : "";
    rowsHtml = `
      <dt>${escapeHtml(d.fields.direction)}</dt>
      <dd>${escapeHtml(state.lang === "en" ? v.directionLabelEn : v.directionLabelJa)}</dd>
      <dt>${escapeHtml(d.fields.deck)}</dt>
      <dd>${escapeHtml(formatDeckId(v.deckId, state.lang))} (+${v.roadElevationM.toFixed(1)}m)</dd>
      <dt>${escapeHtml(d.fields.observedAt)}</dt>
      <dd>${escapeHtml(v.observedAt ?? (state.lang === "en" ? "N/A" : "なし"))}</dd>
      <dt>${escapeHtml(d.fields.age)}</dt>
      <dd>${ageSec === null ? "n/a" : `${Math.round(ageSec)}s`}</dd>
      <dt>${escapeHtml(d.fields.drift)}</dt>
      <dd>${driftCssPx.toFixed(3)} px</dd>
    `;
    gmapsUrl = buildGoogleMapsUrl(v.lat, v.lon, title);
  } else if (sel.kind === "train") {
    const tr = trains.find((x) => x.id === sel.train.id) ?? sel.train;
    const modeLabel = d.modeLabels[tr.mode];
    const badgeCls = tr.mode === "observed" ? "observed" : "";
    title = `${tr.code} ${state.lang === "en" ? tr.lineNameEn : tr.lineNameJa}`;
    sub = `${state.lang === "en" ? tr.operatorEn : tr.operatorJa} · #${tr.trainNumber}`;
    badgeHtml = `<span class="badge ${badgeCls}">${escapeHtml(modeLabel)}</span>`;
    const carsText = state.lang === "en" ? `${tr.carCount} cars` : `${tr.carCount}両編成`;
    rowsHtml = `
      <dt>${escapeHtml(d.fields.status)}</dt>
      <dd>${escapeHtml(state.lang === "en" ? tr.statusEn : tr.statusJa)}</dd>
      <dt>${escapeHtml(d.fields.direction)}</dt>
      <dd>${escapeHtml(state.lang === "en" ? tr.directionEn : tr.directionJa)}</dd>
      <dt>${escapeHtml(d.fields.nextStop)}</dt>
      <dd>${escapeHtml(state.lang === "en" ? tr.nextStopEn : tr.nextStopJa)}</dd>
      <dt>${escapeHtml(d.fields.trainType)}</dt>
      <dd>${escapeHtml(state.lang === "en" ? tr.trainTypeEn : tr.trainTypeJa)} (${escapeHtml(carsText)})</dd>
      <dt>${escapeHtml(d.fields.source)}</dt>
      <dd>${escapeHtml(state.lang === "en" ? tr.sourceEn : tr.sourceJa)}</dd>
    `;
    gmapsUrl = buildGoogleMapsUrl(tr.lat, tr.lon, state.lang === "en" ? tr.lineNameEn : tr.lineNameJa);
  } else if (sel.kind === "plane") {
    const p = planes.find((x) => x.id === sel.plane.id) ?? sel.plane;
    const modeLabel = d.modeLabels[p.mode];
    const badgeCls = p.mode === "observed" ? "observed" : "";
    title = p.callsign;
    sub = state.lang === "en" ? p.airlineEn : p.airlineJa;
    badgeHtml = `<span class="badge ${badgeCls}">${escapeHtml(modeLabel)}</span>`;
    const vRateStr =
      Math.abs(p.verticalRateFpm) >= 64
        ? `${p.verticalRateFpm > 0 ? "+" : ""}${p.verticalRateFpm} fpm`
        : "0 fpm";
    const nearbyRow =
      p.nearbyCount > 0
        ? `<dt>${escapeHtml(d.nearbyHaneda)}</dt><dd>${p.nearbyCount}</dd>`
        : "";
    rowsHtml = `
      <dt>${escapeHtml(d.fields.aircraft)}</dt>
      <dd>${escapeHtml(p.aircraftType)} · ${escapeHtml(d.planeKinds[p.meshKind])}</dd>
      ${p.registration ? `<dt>${escapeHtml(d.fields.registration)}</dt><dd>${escapeHtml(p.registration)}</dd>` : ""}
      <dt>${escapeHtml(d.fields.altitude)}</dt>
      <dd>${p.altitudeM.toLocaleString()} m (${p.altitudeFt.toLocaleString()} ft)</dd>
      <dt>${escapeHtml(d.fields.speed)}</dt>
      <dd>${p.groundSpeedKmh} km/h (${p.groundSpeedKt} kt)</dd>
      <dt>${escapeHtml(d.fields.heading)}</dt>
      <dd>${Math.round(p.trackDeg)}°</dd>
      <dt>${escapeHtml(d.fields.verticalRate)}</dt>
      <dd>${escapeHtml(vRateStr)}</dd>
      ${nearbyRow}
      <dt>${escapeHtml(d.fields.source)}</dt>
      <dd>${escapeHtml(state.lang === "en" ? p.sourceEn : p.sourceJa)}</dd>
    `;
    gmapsUrl = buildGoogleMapsUrl(p.lat, p.lon, p.callsign);
  } else if (sel.kind === "aircabin") {
    const c = airCabins.find((x) => x.id === sel.cabin.id) ?? sel.cabin;
    title = `${d.airCabinName} #${c.cabinNumber}`;
    sub = state.lang === "en" ? c.directionEn : c.directionJa;
    badgeHtml = `<span class="badge">${escapeHtml(d.modeLabels.scheduled)}</span>`;
    rowsHtml = `
      <dt>${escapeHtml(d.fields.ropewaySection)}</dt>
      <dd>${escapeHtml(state.lang === "en" ? c.sectionEn : c.sectionJa)}</dd>
      <dt>${escapeHtml(d.fields.height)}</dt>
      <dd>${c.cableElevM.toFixed(1)} m</dd>
      <dt>${escapeHtml(d.fields.speed)}</dt>
      <dd>${c.speedKmh.toFixed(1)} km/h</dd>
      <dt>${escapeHtml(d.fields.eta)}</dt>
      <dd>~${Math.ceil(c.etaSec / 60)} ${escapeHtml(state.lang === "en" ? "min" : "分")} (${c.etaSec}s)</dd>
      <dt>${escapeHtml(d.fields.source)}</dt>
      <dd>OpenStreetMap / SENYO</dd>
    `;
    gmapsUrl = buildGoogleMapsUrl(c.lat, c.lon, d.airCabinName);
  } else if (sel.kind === "landmark") {
    const lm = sel.landmark;
    title = state.lang === "en" ? lm.nameEn : lm.nameJa;
    sub = state.lang === "en" ? "" : lm.nameEn;
    badgeHtml = `<span class="badge">${escapeHtml(formatCategory(lm.category, state.lang))}</span>`;
    bodyNote = `<p class="card-sub" style="margin-top:6px;">${escapeHtml(state.lang === "en" ? lm.descriptionEn : lm.descriptionJa)}</p>`;
    extraBlockHtml = buildStationBoardHtml(
      lm.id,
      lm.nameJa,
      lm.nameEn,
      lm.category,
      state,
      railBundle,
      trains,
    );
    const addr = lm.address ? formatAddress(lm.address, state.lang) : "";
    rowsHtml = `
      ${lm.heightM ? `<dt>${escapeHtml(d.fields.height)}</dt><dd>${lm.heightM.toFixed(1)} m</dd>` : ""}
      ${lm.levels ? `<dt>${escapeHtml(d.fields.levels)}</dt><dd>${lm.levels}</dd>` : ""}
      ${addr ? `<dt>${escapeHtml(d.fields.address)}</dt><dd>${escapeHtml(addr)}</dd>` : ""}
      <dt>${escapeHtml(d.fields.source)}</dt>
      <dd>${escapeHtml(formatSourceKind(lm.sourceKind, state.lang))}</dd>
    `;
    gmapsUrl = lm.googleMapsUrl ?? buildGoogleMapsUrl(lm.lat, lm.lon, title);
  } else if (sel.kind === "poi") {
    const p = sel.poi;
    title = (state.lang === "en" ? p.nameEn : p.nameJa) || p.nameJa || p.nameEn;
    sub = state.lang === "en" ? "" : p.nameEn;
    badgeHtml = `<span class="badge">${escapeHtml(formatCategory(p.category, state.lang))}</span>`;
    bodyNote = `<p class="card-sub" style="margin-top:6px;">${escapeHtml(state.lang === "en" ? p.descriptionEn : p.descriptionJa)}</p>`;
    extraBlockHtml = buildStationBoardHtml(
      p.id,
      p.nameJa,
      p.nameEn,
      p.category,
      state,
      railBundle,
      trains,
    );
    const addr = p.address ? formatAddress(p.address, state.lang) : "";
    rowsHtml = `
      ${p.heightM ? `<dt>${escapeHtml(d.fields.height)}</dt><dd>${p.heightM.toFixed(1)} m</dd>` : ""}
      ${p.levels ? `<dt>${escapeHtml(d.fields.levels)}</dt><dd>${p.levels}</dd>` : ""}
      ${addr ? `<dt>${escapeHtml(d.fields.address)}</dt><dd>${escapeHtml(addr)}</dd>` : ""}
      <dt>${escapeHtml(d.fields.source)}</dt>
      <dd>OpenStreetMap${p.osmId ? ` (#${p.osmId})` : ""}</dd>
    `;
    gmapsUrl = p.googleMapsUrl || buildGoogleMapsUrl(p.lat, p.lon, title);
  } else if (sel.kind === "feature") {
    const f = sel.feature;
    const kindLabel = f.buildingType
      ? formatBuildingType(f.buildingType, state.lang)
      : formatSurfaceKind(f.surfaceKind, state.lang);
    title = (state.lang === "en" ? f.nameEn : f.nameJa) || kindLabel;
    sub =
      state.lang === "ja" && f.nameEn && f.nameEn !== title
        ? f.nameEn
        : `${sel.lat.toFixed(5)}, ${sel.lon.toFixed(5)}`;
    badgeHtml = `<span class="badge">${escapeHtml(kindLabel)}</span>`;
    const desc = state.lang === "en" ? f.descriptionEn : f.descriptionJa;
    bodyNote = desc
      ? `<p class="card-sub" style="margin-top:6px;">${escapeHtml(desc)}</p>`
      : "";
    extraBlockHtml = buildStationBoardHtml(
      f.poiId ?? f.landmarkId,
      f.nameJa,
      f.nameEn,
      f.category,
      state,
      railBundle,
      trains,
    );
    const addr = f.address ? formatAddress(f.address, state.lang) : "";
    rowsHtml = `
      ${f.buildingType && f.buildingType !== "yes" && title !== kindLabel ? `<dt>${escapeHtml(d.fields.buildingType)}</dt><dd>${escapeHtml(kindLabel)}</dd>` : ""}
      <dt>${escapeHtml(d.fields.height)}</dt>
      <dd>${f.heightM.toFixed(1)} m</dd>
      ${f.levels ? `<dt>${escapeHtml(d.fields.levels)}</dt><dd>${f.levels}</dd>` : ""}
      ${f.areaM2 && f.areaM2 >= 10 ? `<dt>${escapeHtml(d.fields.footprint)}</dt><dd>~${f.areaM2.toLocaleString()} m²</dd>` : ""}
      ${f.yearBuilt ? `<dt>${escapeHtml(d.fields.yearBuilt)}</dt><dd>${escapeHtml(f.yearBuilt)}</dd>` : ""}
      ${addr ? `<dt>${escapeHtml(d.fields.address)}</dt><dd>${escapeHtml(addr)}</dd>` : ""}
      <dt>${escapeHtml(d.fields.source)}</dt>
      <dd>${escapeHtml(formatSourceKind(f.source, state.lang))}${f.osmId ? ` (#${f.osmId})` : ""}</dd>
    `;
    gmapsUrl = f.googleMapsUrl ?? buildGoogleMapsUrl(sel.lat, sel.lon, title);
  } else {
    const pcLive =
      feed?.portCalls.find((x) => x.id === sel.portCall.id) ?? sel.portCall;
    const kind = pcLive.vesselKind ?? "cruise";
    const kindLabel = d.vesselKinds[kind];
    const isMoving = pcLive.moving !== false;
    const statusText = isMoving
      ? pcLive.speedKnots
        ? `${d.underwayLabel} · ${pcLive.speedKnots.toFixed(1)} kt`
        : d.underwayLabel
      : d.berthedLabel;
    title = state.lang === "en" ? pcLive.vesselNameEn : pcLive.vesselNameJa;
    const berth = state.lang === "en" ? pcLive.berthEn : pcLive.berthJa;
    sub = `${pcLive.lat.toFixed(5)}, ${pcLive.lon.toFixed(5)}`;
    badgeHtml = `<span class="badge ${isMoving ? "observed" : ""}">${escapeHtml(kindLabel)}</span>`;
    rowsHtml = `
      <dt>${escapeHtml(d.fields.status)}</dt>
      <dd>${escapeHtml(statusText)}</dd>
      <dt>${escapeHtml(d.fields.berth)}</dt>
      <dd>${escapeHtml(berth)}</dd>
      ${
        pcLive.lengthM && pcLive.widthM
          ? `<dt>${escapeHtml(d.fields.size)}</dt><dd>${pcLive.lengthM.toFixed(0)}m × ${pcLive.widthM.toFixed(1)}m</dd>`
          : ""
      }
      <dt>${escapeHtml(d.fields.schedule)}</dt>
      <dd>${escapeHtml(pcLive.arrivalTime)} → ${escapeHtml(pcLive.departureTime)}</dd>
      <dt>${escapeHtml(d.fields.source)}</dt>
      <dd>${escapeHtml(pcLive.source)}</dd>
    `;
    gmapsUrl = buildGoogleMapsUrl(pcLive.lat, pcLive.lon, title);
  }

  el.innerHTML = `
    <div class="card-eyebrow">${escapeHtml(d.selectedEyebrow)}</div>
    <div class="card-head">
      <div>
        <h2 class="card-title">${escapeHtml(title)}</h2>
        ${sub && sub !== title ? `<p class="card-sub">${escapeHtml(sub)}</p>` : ""}
      </div>
      <button type="button" class="card-close" id="btn-card-close" aria-label="${escapeHtml(d.closeLabel)}">×</button>
    </div>
    ${badgeHtml}
    ${bodyNote}
    ${
      sel.kind === "vehicle" ||
      sel.kind === "train" ||
      sel.kind === "plane" ||
      sel.kind === "aircabin" ||
      (sel.kind === "portcall" && sel.portCall.moving !== false)
        ? `<button type="button" class="follow-btn" id="btn-follow" aria-pressed="${state.following}">${
            state.following
              ? `<span class="follow-dot" aria-hidden="true"></span>${escapeHtml(d.followingLabel)}`
              : escapeHtml(d.followLabel)
          }</button>`
        : ""
    }
    ${extraBlockHtml}
    <dl class="card-dl">${rowsHtml}</dl>
    <a class="gmaps-link" href="${escapeHtml(gmapsUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.openGoogleMaps)}</a>
  `;

  el.querySelector("#btn-card-close")?.addEventListener("click", handlers.onClearSelection);
  el.querySelector("#btn-follow")?.addEventListener("click", handlers.onToggleFollow);
}

export function renderStatus(
  el: HTMLElement,
  state: ViewerState,
  feed: ResolvedFeedState | null,
  trains: readonly ResolvedTrain[] = [],
  weatherStatusText?: string,
  planes: readonly ResolvedPlane[] = [],
): void {
  const d = getDict(state.lang);
  const sunDate = getSunDateForHourJst(state.sunHourJst);
  const sun = computeYokohamaSun(sunDate);
  const timeText = formatTimeStatusText(sunDate, state.lang);
  const skyText = weatherStatusText || d.skyDescriptions[sun.phase];

  const dotCls =
    !feed || feed.feedHealth === "ok"
      ? ""
      : feed.feedHealth === "outage"
        ? "outage"
        : "warn";

  const trainCount = state.showTrains ? trains.length : 0;
  const busCount = state.showBuses ? (feed?.vehicles.length ?? 0) : 0;
  const boatCount = state.showBoats ? (feed?.portCalls.length ?? 0) : 0;
  const planeCount = state.showPlanes ? planes.length : 0;
  const planeChip =
    planeCount > 0
      ? state.lang === "en"
        ? `<span class="g"><span class="live-n">${planeCount}</span> ${planeCount === 1 ? "flight" : "flights"}</span>`
        : `<span class="g">飛行機 <span class="live-n">${planeCount}</span></span>`
      : "";
  const tvSuffix = state.tvMode ? `<span class="g">${escapeHtml(d.tvTourLabel)}</span>` : "";

  const countsHtml =
    state.lang === "en"
      ? `<span class="g"><span class="status-live-sq ${dotCls}" aria-hidden="true"></span><span class="live-n">${trainCount}</span> trains</span><span class="g"><span class="live-n">${busCount}</span> buses</span><span class="g"><span class="live-n">${boatCount}</span> ships</span>${planeChip}`
      : `<span class="g"><span class="status-live-sq ${dotCls}" aria-hidden="true"></span>電車 <span class="live-n">${trainCount}</span></span><span class="g">バス <span class="live-n">${busCount}</span></span><span class="g">客船 <span class="live-n">${boatCount}</span></span>${planeChip}`;

  const nextHtml = `<span class="status-when">${escapeHtml(timeText)}</span><span class="status-now"><span class="g">${escapeHtml(skyText)}</span>${countsHtml}${tvSuffix}</span>`;
  if (el.innerHTML !== nextHtml) {
    el.innerHTML = nextHtml;
  }
}

export function renderSq(
  el: HTMLElement,
  state: ViewerState,
  handlers: UiHandlers,
): void {
  const d = getDict(state.lang);
  const isDark = state.theme === "dark";
  const themeTip = isDark ? d.switchToLight : d.switchToDark;
  const docAny = document as unknown as { webkitFullscreenEnabled?: boolean };
  const canFullscreen = Boolean(document.fullscreenEnabled || docAny.webkitFullscreenEnabled);
  const soundSupported =
    typeof window !== "undefined" && ("AudioContext" in window || "webkitAudioContext" in window);
  const soundTip = state.soundOn ? d.soundOffTip : d.soundOnTip;

  el.innerHTML = `
    <button type="button" id="btn-theme" title="${escapeHtml(themeTip)}" aria-label="${escapeHtml(themeTip)}">
      ${
        isDark
          ? `<svg viewBox="0 0 24 24" class="i-sun"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/></svg>`
          : `<svg viewBox="0 0 24 24" class="i-moon"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`
      }
    </button>
    <button type="button" id="btn-zoom-in" title="${escapeHtml(d.zoomInTip)}" aria-label="${escapeHtml(d.zoomInTip)}">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
    </button>
    <button type="button" id="btn-zoom-out" title="${escapeHtml(d.zoomOutTip)}" aria-label="${escapeHtml(d.zoomOutTip)}">
      <svg viewBox="0 0 24 24"><path d="M5 12h14" /></svg>
    </button>
    <button type="button" id="btn-fullscreen" ${canFullscreen ? "" : "hidden"} title="${escapeHtml(d.fullscreenTip)}" aria-label="${escapeHtml(d.fullscreenTip)}">
      <svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>
    </button>
    <button type="button" id="btn-sound" ${soundSupported ? "" : "hidden"} aria-pressed="${state.soundOn}" title="${escapeHtml(soundTip)}" aria-label="${escapeHtml(soundTip)}">
      ${
        state.soundOn
          ? `<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.3a8 8 0 0 1 0 11.4"/></svg>`
          : `<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>`
      }
    </button>
    <button type="button" class="compass" id="btn-compass" title="${escapeHtml(d.compassTip)}" aria-label="${escapeHtml(d.compassTip)}">
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <g transform="rotate(45 22 22)">
          <path class="n" d="M22 10l4 12h-8z" />
          <path class="s" d="M22 34l-4-12h8z" />
        </g>
        <text class="lbl" x="31.5" y="12.5">N</text>
      </svg>
    </button>
  `;

  el.querySelector("#btn-theme")?.addEventListener("click", handlers.onToggleTheme);
  el.querySelector("#btn-zoom-in")?.addEventListener("click", handlers.onZoomIn);
  el.querySelector("#btn-zoom-out")?.addEventListener("click", handlers.onZoomOut);
  el.querySelector("#btn-fullscreen")?.addEventListener("click", handlers.onToggleFullscreen);
  el.querySelector("#btn-sound")?.addEventListener("click", handlers.onToggleSound);
  el.querySelector("#btn-compass")?.addEventListener("click", handlers.onResetView);
}

function sanitizeCreditField(text: string, lang: Lang): string {
  if (lang !== "en") return text;
  const map: Record<string, string> = {
    "Geospatial Information Authority of Japan (国土地理院)":
      "Geospatial Information Authority of Japan (GSI)",
    "GSI Seamless Photo (地理院タイル シームレス写真 z=18)":
      "GSI Seamless Photo (Orthorectified Aerial Tiles z=18)",
    "GSI Terms of Use (出典明記で自由利用可)":
      "GSI Terms of Use (Free with attribution)",
    "Yokohama Municipal Bus / ODPT":
      "Yokohama Municipal Bus / ODPT",
  };
  if (map[text]) return map[text];
  return text.replace(/（[^）]*[\u3040-\u30ff\u3400-\u9fff][^）]*）/g, "").replace(/\s+/g, " ").trim();
}

export function renderCreditAndAboutModal(
  creditEl: HTMLElement,
  modalEl: HTMLElement,
  state: ViewerState,
  bundle: LoadedReleaseBundle,
  handlers: UiHandlers,
): void {
  const d = getDict(state.lang);

  creditEl.innerHTML = `© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors · <button type="button" id="btn-credit-about" style="padding:0;text-decoration:underline;">${escapeHtml(d.creditAbout)}</button>`;
  creditEl.querySelector("#btn-credit-about")?.addEventListener("click", () => {
    handlers.onToggleAbout(true);
  });

  modalEl.hidden = !state.aboutOpen;
  if (!state.aboutOpen) return;

  const qa = bundle.qaReport;
  const notice = state.lang === "en" ? bundle.release.sceneNotice.en : bundle.release.sceneNotice.ja;
  const apiNote =
    state.lang === "en"
      ? "OpenStreetMap API v0.6 / ODbL geometry and POIs require no API registration. Google Maps links open standard Search deep-links (key-free). Optional live Yokohama bus feeds use ODPT_ACCESS_TOKEN in collector/."
      : "OpenStreetMap API v0.6 (ODbL) の建物形状・道路・海岸線・POIは API キー登録なしで取得・反映しています。Google マップへのリンクは標準の検索ディープリンクを使用（キー不要）、横浜市営バスの実測連携のみ ODPT API トークン登録が任意で必要です。";

  const tileMethodNote =
    state.lang === "en"
      ? "Built tile-by-tile (Small SF method): a pixel-locked 45° orthographic base in EPSG:6677 is redrawn block-by-block into Ligne-Claire illustration, composited with the strict 3D water mask, and stitched along 14px DP seams across 23 Yokohama tiles."
      : "Small SF 手法に倣ったタイル制作パイプライン：EPSG:6677 の45度正投影基準レンダーを全23ブロック単位で Ligne-Claire 風イラストへ再描画し、3D 海面マスク合成と DP 14px 継ぎ目ブレンドで 15,488×5,888 px の1枚絵に統合しています。";

  const versionLabel = state.lang === "en" ? "Version" : "バージョン";
  const retrievedLabel = state.lang === "en" ? "Retrieved" : "取得日";

  modalEl.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(d.aboutTitle)}">
      <div class="card-head" style="position:relative;">
        <h2 style="margin:0;font-size:22px;">${escapeHtml(d.aboutTitle)}</h2>
        <button type="button" class="card-close" id="btn-close-about" aria-label="${escapeHtml(d.closeLabel)}">×</button>
      </div>
      <p style="margin:10px 0 8px;line-height:1.55;">${escapeHtml(d.aboutLead)}</p>
      <p class="card-sub" style="margin:0 0 8px;line-height:1.5;">${escapeHtml(tileMethodNote)}</p>
      <p class="card-sub" style="margin:0 0 12px;line-height:1.5;">${escapeHtml(apiNote)}</p>
      <h3 style="margin:12px 0 6px;font-family:var(--u-sans);font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:var(--u-coral);">${escapeHtml(d.qaSummary)} (${escapeHtml(qa.releaseId)})</h3>
      <p style="font-family:var(--font-mono);font-size:11.5px;margin:0 0 12px;color:var(--u-mute);">
        passed=${qa.passed} | GCPs=${qa.gcpChecks.length} | maxDisp=${qa.maxGcpDisplacementPx}px (&le;${qa.gcpThresholdPx}px) |
        voidPixels=${qa.waterIntegrity.voidPixels ?? 0} | buildings=${bundle.buildings?.count ?? 0} | POIs=${bundle.pois.length}
      </p>
      <p class="card-sub" style="margin:0 0 8px;">${escapeHtml(notice)}</p>
      ${bundle.release.credits
        .map(
          (c) => `
        <div class="credit-row">
          <strong>${escapeHtml(sanitizeCreditField(c.dataset, state.lang))}</strong> — ${escapeHtml(sanitizeCreditField(c.publisher, state.lang))} (${escapeHtml(sanitizeCreditField(c.license, state.lang))})<br />
          <small style="color:var(--u-mute);">
            ${escapeHtml(versionLabel)}: ${escapeHtml(c.version)} · ${escapeHtml(retrievedLabel)}: ${escapeHtml(c.retrievedAt)}<br />
            ${escapeHtml(sanitizeCreditField(c.modifications, state.lang))}
          </small>
        </div>`,
        )
        .join("")}
    </div>
  `;

  modalEl.querySelector("#btn-close-about")?.addEventListener("click", () => {
    handlers.onToggleAbout(false);
  });
  modalEl.onclick = (e) => {
    if (e.target === modalEl) handlers.onToggleAbout(false);
  };
}
