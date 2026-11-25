import {
  computeYokohamaSun,
  type Landmark,
  type PoiRecord,
} from "@small-yokohama/core";
import type { LoadedReleaseBundle } from "../data/releaseLoader.js";
import type { AnimatedPortCall, ResolvedFeedState } from "../data/vehicleFeed.js";
import {
  formatAddress,
  formatCategory,
  formatDeckId,
  formatSourceKind,
  formatSurfaceKind,
  formatTimeStatusText,
  getDict,
  type Lang,
} from "../i18n.js";
import type { DropTab, FeedPreset, MapVariant, ViewerState } from "../state.js";
import { getSkyPresetsForDate, getSunDateForHourJst } from "../viewer/skyLighting.js";

export type BooleanOptionKey =
  | "showBuses"
  | "showBoats"
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
  onTogglePlay: () => void;
  onToggleOption: (key: BooleanOptionKey) => void;
  onSelectLandmarkId: (id: string) => void;
  onSelectPoi: (poi: PoiRecord) => void;
  onSelectPortCall: (pc: AnimatedPortCall) => void;
  onClearSelection: () => void;
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
): string {
  const d = getDict(state.lang);
  const q = state.searchQuery.trim().toLowerCase();

  type SearchHit =
    | { kind: "landmark"; id: string; title: string; sub: string; score: number }
    | { kind: "poi"; poi: PoiRecord; title: string; sub: string; score: number }
    | { kind: "portcall"; pc: AnimatedPortCall; title: string; sub: string; score: number };

  const hits: SearchHit[] = [];
  const seenKeys = new Set<string>();

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
      return `<li><button type="button" data-portcall-id="${escapeHtml(h.pc.id)}"><span class="r-name">${escapeHtml(h.title)}</span><span class="r-sub">${escapeHtml(h.sub)}</span></button></li>`;
    })
    .join("");
}

function bindListSelections(
  container: HTMLElement,
  bundle: LoadedReleaseBundle,
  feed: ResolvedFeedState | null,
  handlers: UiHandlers,
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
  const piersAndBridges: Landmark[] = [];
  const parks: Landmark[] = [];

  for (const lm of bundle.landmarks) {
    if (lm.category === "park") parks.push(lm);
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
      existingList.innerHTML = buildSearchResultsHtml(state, bundle, feed);
      bindListSelections(existingList, bundle, feed, handlers);
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
        ${buildSearchResultsHtml(state, bundle, feed)}
      </ul>
    `;

    const input = el.querySelector<HTMLInputElement>("#inp-search");
    const resultsEl = el.querySelector<HTMLElement>("#search-results");
    if (resultsEl) {
      bindListSelections(resultsEl, bundle, feed, handlers);
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
    bindListSelections(el, bundle, feed, handlers);
    return;
  }

  // Layers tab (Small SF typographic toggles + compact Sky pills + Dev/QA accordion)
  const busCount = feed?.vehicles.length ?? 0;
  const boatCount = feed?.portCalls.length ?? 0;
  const busLabel = state.lang === "en" ? `${busCount} live` : `${busCount}台`;
  const boatLabel = state.lang === "en" ? `${boatCount} scheduled` : `${boatCount}隻`;
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
      <button type="button" class="layer-btn" data-toggle="showBuses" aria-pressed="${state.showBuses}">
        <span>${escapeHtml(d.layerBuses)}</span>
        <small>${escapeHtml(busLabel)}</small>
      </button>
      <button type="button" class="layer-btn" data-toggle="showBoats" aria-pressed="${state.showBoats}">
        <span>${escapeHtml(d.layerBoats)}</span>
        <small>${escapeHtml(boatLabel)}</small>
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

export function renderCard(
  el: HTMLElement,
  state: ViewerState,
  feed: ResolvedFeedState | null,
  driftCssPx: number,
  handlers: UiHandlers,
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
  } else if (sel.kind === "landmark") {
    const lm = sel.landmark;
    title = state.lang === "en" ? lm.nameEn : lm.nameJa;
    sub = state.lang === "en" ? "" : lm.nameEn;
    badgeHtml = `<span class="badge">${escapeHtml(formatCategory(lm.category, state.lang))}</span>`;
    bodyNote = `<p class="card-sub" style="margin-top:6px;">${escapeHtml(state.lang === "en" ? lm.descriptionEn : lm.descriptionJa)}</p>`;
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
    title = (state.lang === "en" ? f.nameEn : f.nameJa) || f.slug;
    sub = `${sel.lat.toFixed(5)}, ${sel.lon.toFixed(5)}`;
    badgeHtml = `<span class="badge">${escapeHtml(formatSurfaceKind(f.surfaceKind, state.lang))}</span>`;
    const addr = f.address ? formatAddress(f.address, state.lang) : "";
    rowsHtml = `
      <dt>${escapeHtml(d.fields.height)}</dt>
      <dd>${f.heightM.toFixed(1)} m</dd>
      ${f.levels ? `<dt>${escapeHtml(d.fields.levels)}</dt><dd>${f.levels}</dd>` : ""}
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
    <dl class="card-dl">${rowsHtml}</dl>
    <a class="gmaps-link" href="${escapeHtml(gmapsUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.openGoogleMaps)}</a>
  `;

  el.querySelector("#btn-card-close")?.addEventListener("click", handlers.onClearSelection);
}

export function renderStatus(
  el: HTMLElement,
  state: ViewerState,
  feed: ResolvedFeedState | null,
): void {
  const d = getDict(state.lang);
  const sunDate = getSunDateForHourJst(state.sunHourJst);
  const sun = computeYokohamaSun(sunDate);
  const timeText = formatTimeStatusText(sunDate, state.lang);
  const skyText = d.skyDescriptions[sun.phase];

  const dotCls =
    !feed || feed.feedHealth === "ok"
      ? ""
      : feed.feedHealth === "outage"
        ? "outage"
        : "warn";

  const busCount = state.showBuses ? (feed?.vehicles.length ?? 0) : 0;
  const boatCount = state.showBoats ? (feed?.portCalls.length ?? 0) : 0;
  const tvSuffix = state.tvMode ? `<span class="g">${escapeHtml(d.tvTourLabel)}</span>` : "";

  const countsHtml =
    state.lang === "en"
      ? `<span class="g"><span class="status-live-sq ${dotCls}" aria-hidden="true"></span><span class="live-n">${busCount}</span> buses</span><span class="g"><span class="live-n">${boatCount}</span> ships</span>`
      : `<span class="g"><span class="status-live-sq ${dotCls}" aria-hidden="true"></span>バス <span class="live-n">${busCount}</span></span><span class="g">客船 <span class="live-n">${boatCount}</span></span>`;

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
        voidPixels=${qa.waterIntegrity.voidPixels ?? 0} | features=${bundle.features.length} | POIs=${bundle.pois.length}
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
