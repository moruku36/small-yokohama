import {
  SURFACE_KIND,
  computeYokohamaSun,
  type PoiRecord,
  type PortCallRecord,
  type SurfaceKind,
} from "@small-yokohama/core";
import type { LoadedReleaseBundle } from "../data/releaseLoader.js";
import type { ResolvedFeedState } from "../data/vehicleFeed.js";
import { getDict } from "../i18n.js";
import type { DropTab, FeedPreset, MapVariant, ViewerState } from "../state.js";

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
  onShare: () => Promise<boolean>;
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
  onSelectPortCall: (pc: PortCallRecord) => void;
  onClearSelection: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const SURFACE_KIND_LABEL: Record<SurfaceKind, string> = {
  [SURFACE_KIND.VOID]: "void",
  [SURFACE_KIND.WATER]: "water",
  [SURFACE_KIND.GROUND]: "ground",
  [SURFACE_KIND.ROAD]: "road",
  [SURFACE_KIND.BUILDING]: "building",
  [SURFACE_KIND.BRIDGE_DECK]: "bridge",
  [SURFACE_KIND.BRIDGE_SUPPORT]: "support",
  [SURFACE_KIND.QUAY]: "quay",
  [SURFACE_KIND.VEGETATION]: "park",
};

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
  el.querySelector("#btn-share")?.addEventListener("click", async () => {
    const ok = await handlers.onShare();
    const btn = el.querySelector("#btn-share");
    if (ok && btn) {
      btn.textContent = d.navCopied;
      window.setTimeout(() => {
        btn.textContent = d.navShare;
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
    | { kind: "portcall"; pc: PortCallRecord; title: string; sub: string; score: number };

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
        sub: lm.category,
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
        sub: poi.category,
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
    return `<li style="padding:8px 9px;color:var(--text-muted);font-size:12px;">${escapeHtml(d.searchEmpty)}</li>`;
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
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.8-3.8" />
        </svg>
        <input id="inp-search" type="search" autocomplete="off" placeholder="${escapeHtml(d.searchPlaceholder)}" value="${escapeHtml(state.searchQuery)}" />
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
    const portCalls = feed?.portCalls ?? [];
    el.innerHTML = `
      <ul class="results">
        ${bundle.landmarks
          .map(
            (lm) => `
          <li>
            <button type="button" data-landmark-id="${escapeHtml(lm.id)}">
              <span class="r-name">${escapeHtml(state.lang === "en" ? lm.nameEn : lm.nameJa)}</span>
              <span class="r-sub">${escapeHtml(lm.category)} · ${lm.elevationM.toFixed(0)}m</span>
            </button>
          </li>`,
          )
          .join("")}
        ${portCalls
          .map(
            (pc) => `
          <li>
            <button type="button" data-portcall-id="${escapeHtml(pc.id)}">
              <span class="r-name">🚢 ${escapeHtml(state.lang === "en" ? pc.vesselNameEn : pc.vesselNameJa)}</span>
              <span class="r-sub">${escapeHtml(state.lang === "en" ? pc.berthEn : pc.berthJa)}</span>
            </button>
          </li>`,
          )
          .join("")}
      </ul>
    `;
    bindListSelections(el, bundle, feed, handlers);
    return;
  }

  // Layers tab
  const sunValue = state.sunHourJst === null ? "live" : String(state.sunHourJst);
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
        <small>${state.showBuses ? "ON" : "OFF"}</small>
      </button>
      <button type="button" class="layer-btn" data-toggle="showBoats" aria-pressed="${state.showBoats}">
        <span>${escapeHtml(d.layerBoats)}</span>
        <small>${state.showBoats ? "ON" : "OFF"}</small>
      </button>
      <button type="button" class="layer-btn" data-toggle="showLabels" aria-pressed="${state.showLabels}">
        <span>${escapeHtml(d.layerLabels)}</span>
        <small>${state.showLabels ? "ON" : "OFF"}</small>
      </button>

      <div class="layer-subrow">
        <label for="sel-variant">${escapeHtml(d.layerStyle)}</label>
        <select id="sel-variant">
          <option value="illustrated" ${state.variant === "illustrated" ? "selected" : ""}>${escapeHtml(d.styleIllustrated)}</option>
          <option value="plain" ${state.variant === "plain" ? "selected" : ""}>${escapeHtml(d.stylePlain)}</option>
        </select>
      </div>

      <div class="layer-subrow">
        <label for="sel-sun">${escapeHtml(d.layerSky)}</label>
        <select id="sel-sun">
          <option value="live" ${sunValue === "live" ? "selected" : ""}>${escapeHtml(d.skyRealtime)}</option>
          <option value="9.5" ${sunValue === "9.5" ? "selected" : ""}>09:30 JST</option>
          <option value="15.5" ${sunValue === "15.5" ? "selected" : ""}>15:30 JST</option>
          <option value="17.25" ${sunValue === "17.25" ? "selected" : ""}>17:15 JST</option>
          <option value="20" ${sunValue === "20" ? "selected" : ""}>20:00 JST</option>
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

      <button type="button" class="layer-btn" id="btn-play" aria-pressed="${state.playing}">
        <span>${escapeHtml(state.lang === "en" ? "Simulation" : "アニメーション")}</span>
        <small>${escapeHtml(state.playing ? d.pauseBtn : d.playBtn)}</small>
      </button>

      <details class="debug-details">
        <summary>${escapeHtml(d.qaGroupTitle)}</summary>
        <div class="debug-list">
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

  el.querySelector("#sel-variant")?.addEventListener("change", (e) => {
    handlers.onChangeVariant((e.target as HTMLSelectElement).value as MapVariant);
  });
  el.querySelector("#sel-sun")?.addEventListener("change", (e) => {
    const val = (e.target as HTMLSelectElement).value;
    handlers.onChangeSunHour(val === "live" ? null : Number(val));
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
      <dd>${escapeHtml(v.deckId)} (+${v.roadElevationM.toFixed(1)}m)</dd>
      <dt>${escapeHtml(d.fields.observedAt)}</dt>
      <dd>${escapeHtml(v.observedAt ?? "null")}</dd>
      <dt>${escapeHtml(d.fields.age)}</dt>
      <dd>${ageSec === null ? "n/a" : `${Math.round(ageSec)}s`}</dd>
      <dt>${escapeHtml(d.fields.drift)}</dt>
      <dd>${driftCssPx.toFixed(3)} px</dd>
    `;
    gmapsUrl = buildGoogleMapsUrl(v.lat, v.lon, title);
  } else if (sel.kind === "landmark") {
    const lm = sel.landmark;
    title = state.lang === "en" ? lm.nameEn : lm.nameJa;
    sub = state.lang === "en" ? lm.nameJa : lm.nameEn;
    badgeHtml = `<span class="badge">${escapeHtml(lm.category)}</span>`;
    bodyNote = `<p class="card-sub" style="margin-top:6px;">${escapeHtml(state.lang === "en" ? lm.descriptionEn : lm.descriptionJa)}</p>`;
    rowsHtml = `
      ${lm.heightM ? `<dt>${escapeHtml(d.fields.height)}</dt><dd>${lm.heightM.toFixed(1)} m</dd>` : ""}
      ${lm.levels ? `<dt>${escapeHtml(d.fields.levels)}</dt><dd>${lm.levels}</dd>` : ""}
      ${lm.address ? `<dt>${escapeHtml(d.fields.address)}</dt><dd>${escapeHtml(lm.address)}</dd>` : ""}
      <dt>${escapeHtml(d.fields.source)}</dt>
      <dd>${escapeHtml(lm.sourceKind)}</dd>
    `;
    gmapsUrl = lm.googleMapsUrl ?? buildGoogleMapsUrl(lm.lat, lm.lon, lm.nameJa);
  } else if (sel.kind === "poi") {
    const p = sel.poi;
    title = (state.lang === "en" ? p.nameEn : p.nameJa) || p.nameJa || p.nameEn;
    sub = state.lang === "en" ? p.nameJa : p.nameEn;
    badgeHtml = `<span class="badge">${escapeHtml(p.category)}</span>`;
    bodyNote = `<p class="card-sub" style="margin-top:6px;">${escapeHtml(state.lang === "en" ? p.descriptionEn : p.descriptionJa)}</p>`;
    rowsHtml = `
      ${p.heightM ? `<dt>${escapeHtml(d.fields.height)}</dt><dd>${p.heightM.toFixed(1)} m</dd>` : ""}
      ${p.levels ? `<dt>${escapeHtml(d.fields.levels)}</dt><dd>${p.levels}</dd>` : ""}
      ${p.address ? `<dt>${escapeHtml(d.fields.address)}</dt><dd>${escapeHtml(p.address)}</dd>` : ""}
      <dt>${escapeHtml(d.fields.source)}</dt>
      <dd>OpenStreetMap${p.osmId ? ` (#${p.osmId})` : ""}</dd>
    `;
    gmapsUrl = p.googleMapsUrl || buildGoogleMapsUrl(p.lat, p.lon, p.nameJa);
  } else if (sel.kind === "feature") {
    const f = sel.feature;
    title = (state.lang === "en" ? f.nameEn : f.nameJa) || f.slug;
    sub = `${sel.lat.toFixed(5)}, ${sel.lon.toFixed(5)}`;
    badgeHtml = `<span class="badge">${escapeHtml(SURFACE_KIND_LABEL[f.surfaceKind] ?? "feature")}</span>`;
    rowsHtml = `
      <dt>${escapeHtml(d.fields.height)}</dt>
      <dd>${f.heightM.toFixed(1)} m</dd>
      ${f.levels ? `<dt>${escapeHtml(d.fields.levels)}</dt><dd>${f.levels}</dd>` : ""}
      ${f.address ? `<dt>${escapeHtml(d.fields.address)}</dt><dd>${escapeHtml(f.address)}</dd>` : ""}
      <dt>${escapeHtml(d.fields.source)}</dt>
      <dd>${escapeHtml(f.source)}${f.osmId ? ` (#${f.osmId})` : ""}</dd>
    `;
    gmapsUrl = f.googleMapsUrl ?? buildGoogleMapsUrl(sel.lat, sel.lon, title);
  } else {
    const pc = sel.portCall;
    title = state.lang === "en" ? pc.vesselNameEn : pc.vesselNameJa;
    sub = state.lang === "en" ? pc.berthEn : pc.berthJa;
    badgeHtml = `<span class="badge">${escapeHtml(d.modeLabels.scheduled)}</span>`;
    rowsHtml = `
      <dt>${escapeHtml(d.fields.berth)}</dt>
      <dd>${escapeHtml(sub)}</dd>
      <dt>${escapeHtml(d.fields.schedule)}</dt>
      <dd>${escapeHtml(pc.arrivalTime)} → ${escapeHtml(pc.departureTime)}</dd>
      <dt>${escapeHtml(d.fields.source)}</dt>
      <dd>${escapeHtml(pc.source)}</dd>
    `;
    gmapsUrl = buildGoogleMapsUrl(pc.lat, pc.lon, title);
  }

  el.innerHTML = `
    <div class="card-head">
      <div>
        <h3 class="card-title">${escapeHtml(title)}</h3>
        ${sub && sub !== title ? `<p class="card-sub">${escapeHtml(sub)}</p>` : ""}
      </div>
      <button type="button" class="card-close" id="btn-card-close" aria-label="Close">✕</button>
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

  let jstText = "";
  let sunDate: Date;
  if (state.sunHourJst === null) {
    sunDate = new Date();
    jstText = new Intl.DateTimeFormat(state.lang === "en" ? "en-US" : "ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(sunDate);
  } else {
    const h = Math.floor(state.sunHourJst);
    const m = Math.round((state.sunHourJst - h) * 60);
    sunDate = new Date(Date.UTC(2026, 10, 24, h - 9, m, 0));
    jstText = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  const sun = computeYokohamaSun(sunDate);
  const phaseEmoji =
    sun.phase === "night" ? "🌙" : sun.phase === "twilight" ? "🌆" : sun.phase === "golden" ? "🌇" : "☀️";

  const dotCls =
    !feed || feed.feedHealth === "ok"
      ? ""
      : feed.feedHealth === "outage"
        ? "outage"
        : "warn";

  const busCount = state.showBuses ? (feed?.vehicles.length ?? 0) : 0;
  const boatCount = state.showBoats ? (feed?.portCalls.length ?? 0) : 0;
  const tvSuffix = state.tvMode ? ` · 📺 ${escapeHtml(d.tvTourLabel)}` : "";

  const text =
    state.lang === "en"
      ? `${phaseEmoji} ${jstText} JST · ${busCount} bus · ${boatCount} ship${tvSuffix}`
      : `${phaseEmoji} ${jstText} JST · バス ${busCount} · 客船 ${boatCount}${tvSuffix}`;

  el.innerHTML = `<span class="status-dot ${dotCls}" aria-hidden="true"></span><span>${text}</span>`;
}

export function renderSq(
  el: HTMLElement,
  state: ViewerState,
  handlers: UiHandlers,
): void {
  const d = getDict(state.lang);
  const isDark = state.theme === "dark";

  el.innerHTML = `
    <button type="button" id="btn-theme" title="${isDark ? "Light theme" : "Dark theme"}" aria-label="Toggle theme">
      ${
        isDark
          ? `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" /></svg>`
          : `<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>`
      }
    </button>
    <button type="button" id="btn-zoom-in" title="Zoom in (+)" aria-label="Zoom in">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
    </button>
    <button type="button" id="btn-zoom-out" title="Zoom out (-)" aria-label="Zoom out">
      <svg viewBox="0 0 24 24"><path d="M5 12h14" /></svg>
    </button>
    <button type="button" id="btn-fullscreen" title="Fullscreen" aria-label="Fullscreen">
      <svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
    </button>
    <button type="button" class="compass" id="btn-compass" title="${escapeHtml(d.compassTip)}" aria-label="${escapeHtml(d.compassTip)}">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <g transform="rotate(125.3 16 16)">
          <polygon class="n" points="16,3 20,16 12,16" />
          <polygon class="s" points="16,29 20,16 12,16" />
        </g>
        <text class="lbl" x="23" y="21">N</text>
      </svg>
    </button>
  `;

  el.querySelector("#btn-theme")?.addEventListener("click", handlers.onToggleTheme);
  el.querySelector("#btn-zoom-in")?.addEventListener("click", handlers.onZoomIn);
  el.querySelector("#btn-zoom-out")?.addEventListener("click", handlers.onZoomOut);
  el.querySelector("#btn-fullscreen")?.addEventListener("click", handlers.onToggleFullscreen);
  el.querySelector("#btn-compass")?.addEventListener("click", handlers.onResetView);
}

export function renderCreditAndAboutModal(
  creditEl: HTMLElement,
  modalEl: HTMLElement,
  state: ViewerState,
  bundle: LoadedReleaseBundle,
  handlers: UiHandlers,
): void {
  const d = getDict(state.lang);

  creditEl.innerHTML = `© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors · <button type="button" id="btn-credit-about" style="padding:0;text-decoration:underline;">${escapeHtml(d.navAbout)}</button>`;
  creditEl.querySelector("#btn-credit-about")?.addEventListener("click", () => {
    handlers.onToggleAbout(true);
  });

  modalEl.hidden = !state.aboutOpen;
  if (!state.aboutOpen) return;

  const qa = bundle.qaReport;
  const notice = state.lang === "en" ? bundle.release.sceneNotice.en : bundle.release.sceneNotice.ja;
  const apiNote =
    state.lang === "en"
      ? "OpenStreetMap API v0.6 / ODbL geometry and POIs work with zero API registration. Google Maps place links use standard Search deep-links (no key needed). Optional live Yokohama bus feeds use ODPT_ACCESS_TOKEN in collector/."
      : "OpenStreetMap API v0.6 (ODbL) の建物形状・道路・海岸線・349件のPOIは API キー登録なしで取得・反映しています。Google マップへのリンクは標準の検索ディープリンクを使用（キー不要）、横浜市営バスの実測連携のみ ODPT API トークン登録が任意で必要です。";

  const tileMethodNote =
    state.lang === "en"
      ? "Built tile-by-tile (Small SF method): a pixel-locked 45° orthographic 3D base in EPSG:6677 is redrawn block-by-block into Ligne-Claire illustration, composited with the strict 3D water mask, and stitched along 14px DP seams — starting with Hero Tile #1 (Shinko Waterfront) before expanding outward."
      : "Small SF 手法に倣ったタイル制作パイプライン：EPSG:6677 の45度正投影3D基準レンダーをブロック単位で Ligne-Claire 風イラストへ再描画し、3D 海面マスク合成（架空の島防止）と DP 14px 継ぎ目ブレンドで結合しています。まず新港中心タイル（Hero Tile #1）から仕上げて順次拡大中です。";

  modalEl.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(d.aboutTitle)}">
      <div class="card-head">
        <h2 style="margin:0;font-size:17px;">${escapeHtml(d.aboutTitle)}</h2>
        <button type="button" class="card-close" id="btn-close-about" aria-label="Close">✕</button>
      </div>
      <p style="margin:10px 0 8px;line-height:1.55;">${escapeHtml(d.aboutLead)}</p>
      <p class="card-sub" style="margin:0 0 8px;line-height:1.5;">${escapeHtml(tileMethodNote)}</p>
      <p class="card-sub" style="margin:0 0 12px;line-height:1.5;">${escapeHtml(apiNote)}</p>
      <h3 style="margin:12px 0 6px;font-size:13px;">${escapeHtml(d.qaSummary)} (${escapeHtml(qa.releaseId)})</h3>
      <p style="font-family:var(--font-mono);font-size:11.5px;margin:0 0 12px;color:var(--text-muted);">
        passed=${qa.passed} | GCPs=${qa.gcpChecks.length} | maxDisp=${qa.maxGcpDisplacementPx}px (&le;${qa.gcpThresholdPx}px) |
        voidPixels=${qa.waterIntegrity.voidPixels ?? 0} | features=${bundle.features.length} | POIs=${bundle.pois.length}
      </p>
      <p class="card-sub" style="margin:0 0 8px;">${escapeHtml(notice)}</p>
      ${bundle.release.credits
        .map(
          (c) => `
        <div class="credit-row">
          <strong>${escapeHtml(c.dataset)}</strong> — ${escapeHtml(c.publisher)} (${escapeHtml(c.license)})<br />
          <small style="color:var(--text-muted);">
            Version: ${escapeHtml(c.version)} · Retrieved: ${escapeHtml(c.retrievedAt)}<br />
            ${escapeHtml(c.modifications)}
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
