import "./style.css";
import {
  computeYokohamaSun,
  type PoiRecord,
  type SceneFeatureRecord,
} from "@small-yokohama/core";
import { Soundscape } from "./audio/Soundscape.js";
import {
  resolveAirCabinForFrame,
  type ResolvedAirCabinGondola,
} from "./data/airCabinFeed.js";
import {
  fetchLivePlanesApi,
  resolvePlanesForFrame,
  type LivePlaneApiPayload,
  type ResolvedPlane,
} from "./data/planeFeed.js";
import {
  loadCurrentRelease,
  resolveFeatureById,
  type LoadedReleaseBundle,
} from "./data/releaseLoader.js";
import { isStationSelection } from "./data/stationDepartures.js";
import { loadAmbientFixtures } from "./data/trafficFeed.js";
import {
  fetchLiveTrainsApi,
  loadRailBundle,
  resolveTrainsForFrame,
  type LiveTrainApiPayload,
  type ResolvedTrain,
  type YokohamaRailBundle,
} from "./data/trainFeed.js";
import {
  fetchLiveBusesApi,
  fetchSnapshotForPreset,
  resolveVehiclesForFrame,
  type AnimatedPortCall,
  type LiveBusApiPayload,
  type ResolvedFeedState,
  type ResolvedVehicle,
} from "./data/vehicleFeed.js";
import {
  fetchYokohamaWeather,
  resolveWeatherState,
  type LiveWeatherPayload,
  type WeatherMode,
} from "./data/weatherFeed.js";
import { getDict } from "./i18n.js";
import {
  createInitialViewerState,
  serializeShareUrl,
  type DropTab,
  type FeedPreset,
  type MapVariant,
  type ViewerState,
} from "./state.js";
import { HoverTip, describePick } from "./ui/HoverTip.js";
import { LabelLayer } from "./ui/LabelLayer.js";
import { Minimap } from "./ui/Minimap.js";
import { TransitBadgeLayer } from "./ui/TransitBadgeLayer.js";
import {
  renderBar,
  renderCard,
  renderCreditAndAboutModal,
  renderDrop,
  renderSq,
  renderStatus,
  type BooleanOptionKey,
  type UiHandlers,
} from "./ui/renderUi.js";
import { CloudIntro } from "./viewer/CloudIntro.js";
import { MapViewer } from "./viewer/MapViewer.js";
import { zoomToMetersAcross } from "./viewer/geoView.js";
import {
  SKY_PRESETS,
  getSunDateForHourJst,
  isNightAltitude,
} from "./viewer/skyLighting.js";

const TV_STOP_IDS = [
  "lm-yokohama-station",
  "lm-bay-quarter",
  "lm-landmark-tower",
  "lm-pacifico",
  "lm-redbrick-2",
  "lm-circle-walk",
  "lm-hammerhead",
  "lm-osanbashi",
  "lm-yamashita-park",
  "lm-chinatown",
  "lm-kannai-stadium",
  "lm-noge",
  "lm-motomachi-yamate",
];

async function bootstrap(): Promise<void> {
  const barEl = document.getElementById("bar")!;
  const dropEl = document.getElementById("drop")!;
  const toastEl = document.getElementById("toast");
  const cardEl = document.getElementById("card")!;
  const statusEl = document.getElementById("status")!;
  const sqEl = document.getElementById("sq")!;
  const minimapEl = document.getElementById("minimap");
  const creditEl = document.getElementById("credit")!;
  const aboutModalEl = document.getElementById("about-modal")!;
  const transitLayerEl = document.getElementById("transit-layer");
  const labelLayerEl = document.getElementById("label-layer")!;
  const osdEl = document.getElementById("osd-container")!;
  const glCanvas = document.getElementById("webgl-overlay") as HTMLCanvasElement;

  // The opening: cloud covers the map while it loads, then the camera falls through it
  const bootParams = new URLSearchParams(window.location.search);
  const bootLang = bootParams.get("lang") === "en" ? "en" : "ja";
  statusEl.innerHTML = `<span class="g loading">${getDict(bootLang).loadingCity}</span>`;
  let cloudIntro: CloudIntro | null = null;
  const reducedAtBoot = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (bootParams.get("intro") !== "0" && !reducedAtBoot) {
    const sunRaw = Number(bootParams.get("sun"));
    const bootSunHour =
      bootParams.has("sun") && bootParams.get("sun") !== "live" && Number.isFinite(sunRaw)
        ? sunRaw
        : bootParams.get("theme") === "dark"
          ? SKY_PRESETS.night
          : null;
    cloudIntro = new CloudIntro(
      computeYokohamaSun(getSunDateForHourJst(bootSunHour)).altitudeDeg,
    );
    cloudIntro.mount();
    document.getElementById("veil")?.setAttribute("hidden", "");
  }

  let bundle: LoadedReleaseBundle;
  try {
    bundle = await loadCurrentRelease();
  } catch (err) {
    cloudIntro?.finish();
    const msg = err instanceof Error ? err.message : String(err);
    barEl.innerHTML = `<span class="title">Small Yokohama — Failed to load release: ${msg}</span>`;
    return;
  }

  const prefersReducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const state: ViewerState = createInitialViewerState(
    bundle.camera,
    window.location.search,
    prefersReducedMotion,
    { width: window.innerWidth, height: window.innerHeight },
  );

  const sessionStartDate = new Date();
  let [
    currentSnapshot,
    { railBundle, streetlights },
    liveTrainsApi,
    liveBusesApi,
    livePlanesApi,
    ambient,
    liveWeather,
  ] = await Promise.all([
    fetchSnapshotForPreset(bundle.baseReleaseUrl, state.feedPreset, state.liveEndpoint),
    loadRailBundle(bundle.baseReleaseUrl),
    fetchLiveTrainsApi(),
    fetchLiveBusesApi(state.liveEndpoint),
    fetchLivePlanesApi(),
    loadAmbientFixtures(bundle.baseReleaseUrl),
    fetchYokohamaWeather(),
  ]);

  let currentWeatherPayload: LiveWeatherPayload | null = liveWeather;
  const resolveCurrentWeather = () => {
    const d = getDict(state.lang);
    const sun = computeYokohamaSun(getSunDateForHourJst(state.sunHourJst));
    return resolveWeatherState(
      state.weatherMode,
      currentWeatherPayload,
      d.skyDescriptions[sun.phase],
      state.lang,
    );
  };

  let resolvedFeed: ResolvedFeedState = resolveVehiclesForFrame(
    currentSnapshot,
    state.feedPreset,
    state.simTimeSec,
    Date.now(),
    liveBusesApi,
  );
  let resolvedTrains: ResolvedTrain[] = resolveTrainsForFrame(
    railBundle,
    liveTrainsApi,
    state.simTimeSec,
    sessionStartDate,
  );
  let resolvedPlanes: ResolvedPlane[] = resolvePlanesForFrame(
    livePlanesApi,
    state.simTimeSec,
  );
  let resolvedAirCabins: ResolvedAirCabinGondola[] = resolveAirCabinForFrame(
    state.simTimeSec,
    sessionStartDate,
  );

  const soundscape = new Soundscape();
  const hoverTip = new HoverTip();
  const labelLayer = new LabelLayer();
  const transitLayer = new TransitBadgeLayer();
  let mapViewer: MapViewer;
  let minimap: Minimap | null = null;
  let tvIndex = 0;
  let tvTimerId = 0;

  const stopTv = (reRender = true) => {
    if (!state.tvMode) return;
    state.tvMode = false;
    if (tvTimerId) {
      window.clearInterval(tvTimerId);
      tvTimerId = 0;
    }
    if (reRender) refreshUi();
  };

  const selectVehicle = (rv: ResolvedVehicle) => {
    stopTv(false);
    state.following = true;
    state.selected = {
      kind: "vehicle",
      vehicle: rv.record,
      ageSec: rv.freshness.ageSec,
      status: rv.freshness.status,
    };
    state.activeTab = null;
    mapViewer.updateState(state, resolvedFeed, resolvedTrains, false, resolvedPlanes, resolvedAirCabins);
    refreshUi();
  };

  const selectTrain = (tr: ResolvedTrain) => {
    stopTv(false);
    const liveTr = resolvedTrains.find((x) => x.id === tr.id) ?? tr;
    state.following = true;
    state.selected = { kind: "train", train: liveTr };
    state.activeTab = null;
    mapViewer.updateState(state, resolvedFeed, resolvedTrains, false, resolvedPlanes, resolvedAirCabins);
    refreshUi();
  };

  const selectPlane = (p: ResolvedPlane) => {
    stopTv(false);
    const liveP = resolvedPlanes.find((x) => x.id === p.id) ?? p;
    state.following = true;
    state.selected = { kind: "plane", plane: liveP };
    state.activeTab = null;
    mapViewer.panToLonLat(liveP.lon, liveP.lat, liveP.displayElevM);
    mapViewer.updateState(state, resolvedFeed, resolvedTrains, false, resolvedPlanes, resolvedAirCabins);
    refreshUi();
  };

  const selectAirCabin = (cabin: ResolvedAirCabinGondola) => {
    stopTv(false);
    const liveC = resolvedAirCabins.find((x) => x.id === cabin.id) ?? cabin;
    state.following = true;
    state.selected = { kind: "aircabin", cabin: liveC };
    state.activeTab = null;
    mapViewer.panToLonLat(liveC.lon, liveC.lat, liveC.cableElevM - 2.2);
    mapViewer.updateState(state, resolvedFeed, resolvedTrains, false, resolvedPlanes, resolvedAirCabins);
    refreshUi();
  };

  const syncTransitBadges = () => {
    if (!mapViewer) return;
    const bounds = mapViewer.getViewportInfo();
    transitLayer.render(
      transitLayerEl,
      bundle,
      state,
      bounds,
      resolvedFeed,
      resolvedTrains,
      selectVehicle,
      handlers.onSelectPortCall,
      selectTrain,
      resolvedPlanes,
      resolvedAirCabins,
      selectPlane,
      selectAirCabin,
    );
  };

  const syncViewportOverlays = () => {
    if (!mapViewer) return;
    const bounds = mapViewer.getViewportInfo();
    labelLayer.render(
      labelLayerEl,
      bundle,
      state,
      bounds,
      handlers.onSelectPoi,
      resolvedFeed,
      resolvedTrains,
      resolvedPlanes,
      resolvedAirCabins,
    );
    transitLayer.render(
      transitLayerEl,
      bundle,
      state,
      bounds,
      resolvedFeed,
      resolvedTrains,
      selectVehicle,
      handlers.onSelectPortCall,
      selectTrain,
      resolvedPlanes,
      resolvedAirCabins,
      selectPlane,
      selectAirCabin,
    );
    minimap?.render(state, bounds);
  };

  const syncDocumentPrefs = () => {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.lang = state.lang;
    document.title = getDict(state.lang).pageTitle;
    document.body.classList.toggle("has-panel", Boolean(state.activeTab || state.selected));
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.content = state.theme === "dark" ? "#383838" : "#ebe6dc";
    }
  };

  const refreshUi = () => {
    syncDocumentPrefs();
    renderBar(barEl, state, handlers);
    renderDrop(dropEl, state, bundle, resolvedFeed, handlers, resolvedTrains, resolvedPlanes, resolvedAirCabins);
    const drift = mapViewer ? mapViewer.measureMaxMarkerDriftCssPx() : 0;
    renderCard(
      cardEl,
      state,
      resolvedFeed,
      drift,
      handlers,
      resolvedTrains,
      resolvedPlanes,
      resolvedAirCabins,
      railBundle,
    );
    const wState = resolveCurrentWeather();
    renderStatus(statusEl, state, resolvedFeed, resolvedTrains, wState.statusText, resolvedPlanes);
    mapViewer?.setWeatherVisual(wState.rainIntensity, wState.windSlope);
    renderSq(sqEl, state, handlers);
    renderCreditAndAboutModal(creditEl, aboutModalEl, state, bundle, handlers);
    syncViewportOverlays();
  };

  const advanceTvStop = () => {
    const preferred = TV_STOP_IDS
      .map((id) => bundle.landmarks.find((l) => l.id === id))
      .filter((l): l is NonNullable<typeof l> => Boolean(l));
    const tvLandmarks = preferred.length > 0 ? preferred : bundle.landmarks.slice(0, 12);

    if (tvLandmarks.length === 0) return;
    const lm = tvLandmarks[tvIndex % tvLandmarks.length]!;
    tvIndex++;
    state.selected = { kind: "landmark", landmark: lm };
    mapViewer.panToLonLat(lm.lon, lm.lat, lm.elevationM);
    refreshUi();
  };

  const loadFeed = async (preset: FeedPreset) => {
    state.feedPreset = preset;
    currentSnapshot = await fetchSnapshotForPreset(
      bundle.baseReleaseUrl,
      preset,
      state.liveEndpoint,
    );
    resolvedFeed = resolveVehiclesForFrame(
      currentSnapshot,
      preset,
      state.simTimeSec,
      Date.now(),
      liveBusesApi,
    );
    mapViewer.updateState(state, resolvedFeed, resolvedTrains, false, resolvedPlanes, resolvedAirCabins);
    refreshUi();
  };

  let toastTimer = 0;
  let toastHideTimer = 0;
  const showToast = (label: string, anchorEl?: HTMLElement | null) => {
    if (!toastEl) return;
    window.clearTimeout(toastTimer);
    window.clearTimeout(toastHideTimer);
    toastEl.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>${label}</span>`;
    toastEl.hidden = false;

    const b = anchorEl?.getBoundingClientRect();
    if (b && b.width > 0) {
      const w = toastEl.offsetWidth || 220;
      const cx = b.left + b.width * 0.5;
      const x = Math.max(12 + w * 0.5, Math.min(window.innerWidth - 12 - w * 0.5, cx));
      toastEl.style.left = `${Math.round(x)}px`;
      toastEl.style.top = `${Math.round(b.bottom + 14)}px`;
      toastEl.style.setProperty("--ox", `${Math.round(cx - (x - w * 0.5))}px`);
    } else {
      toastEl.style.left = "";
      toastEl.style.top = "";
      toastEl.style.removeProperty("--ox");
    }

    window.requestAnimationFrame(() => {
      toastEl.classList.remove("gone");
    });
    toastTimer = window.setTimeout(() => {
      toastEl.classList.add("gone");
      toastHideTimer = window.setTimeout(() => {
        if (toastEl.classList.contains("gone")) toastEl.hidden = true;
      }, 220);
    }, 2000);
  };

  /** Where the selected bus, train or ship is this frame (null when it is gone or stands still). */
  const followTarget = (): { lon: number; lat: number; elevM: number } | null => {
    const sel = state.selected;
    if (!sel) return null;
    if (sel.kind === "vehicle") {
      const rv = resolvedFeed.vehicles.find((x) => x.record.entityId === sel.vehicle.entityId);
      return rv ? { lon: rv.record.lon, lat: rv.record.lat, elevM: rv.record.roadElevationM + 1.5 } : null;
    }
    if (sel.kind === "train") {
      const tr = resolvedTrains.find((x) => x.id === sel.train.id);
      if (!tr) return null;
      const mid = tr.cars[Math.floor(tr.cars.length / 2)];
      return mid
        ? { lon: mid.lon, lat: mid.lat, elevM: mid.elevM + tr.carHeightM * 0.5 }
        : { lon: tr.lon, lat: tr.lat, elevM: 6 };
    }
    if (sel.kind === "portcall") {
      const pc = resolvedFeed.portCalls.find((x) => x.id === sel.portCall.id);
      return pc ? { lon: pc.lon, lat: pc.lat, elevM: 3.5 } : null;
    }
    if (sel.kind === "plane") {
      const p = resolvedPlanes.find((x) => x.id === sel.plane.id);
      return p ? { lon: p.lon, lat: p.lat, elevM: p.displayElevM } : null;
    }
    if (sel.kind === "aircabin") {
      const c = resolvedAirCabins.find((x) => x.id === sel.cabin.id);
      return c ? { lon: c.lon, lat: c.lat, elevM: c.cableElevM - 2.2 } : null;
    }
    return null;
  };

  const stopFollowing = () => {
    if (!state.following) return;
    state.following = false;
    if (state.selected) {
      renderCard(
        cardEl,
        state,
        resolvedFeed,
        0,
        handlers,
        resolvedTrains,
        resolvedPlanes,
        resolvedAirCabins,
        railBundle,
      );
    }
  };

  /** What the soundscape hears: the weather, the sun, the ships, and how close the camera is. */
  const syncSound = () => {
    if (!state.soundOn) return;
    const metersAcross = zoomToMetersAcross(bundle.camera, state.cameraView.zoom);
    const closeness = Math.max(
      0,
      Math.min(1, (Math.log(8000) - Math.log(metersAcross)) / (Math.log(8000) - Math.log(150))),
    );
    soundscape.update({
      rainIntensity: resolveCurrentWeather().rainIntensity,
      sunAltitudeDeg: computeYokohamaSun(getSunDateForHourJst(state.sunHourJst)).altitudeDeg,
      shipCount: state.showBoats ? resolvedFeed.portCalls.length : 0,
      closeness,
    });
  };

  const handlers: UiHandlers = {
    onSetTab: (tab: DropTab) => {
      stopTv(false);
      state.activeTab = tab;
      if (tab) {
        state.selected = null;
      }
      refreshUi();
    },
    onSearchQuery: (q: string) => {
      state.searchQuery = q;
      renderDrop(dropEl, state, bundle, resolvedFeed, handlers, resolvedTrains, resolvedPlanes, resolvedAirCabins);
    },
    onToggleTv: () => {
      if (state.tvMode) {
        stopTv(true);
        return;
      }
      state.tvMode = true;
      state.activeTab = null;
      state.aboutOpen = false;
      advanceTvStop();
      tvTimerId = window.setInterval(advanceTvStop, 7500);
    },
    onShare: async (anchorEl?: HTMLElement | null) => {
      const url = serializeShareUrl(state, window.location.href, bundle.camera);
      window.history.replaceState(null, "", url);
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          showToast(
            state.lang === "en" ? "Link ready in the address bar" : "URLをアドレスバーに反映しました",
            anchorEl,
          );
          return true;
        }
      }
      showToast(
        state.lang === "en" ? "Copied your current view to clipboard." : "この視点のURLをコピーしました",
        anchorEl,
      );
      return true;
    },
    onToggleAbout: (open: boolean) => {
      state.aboutOpen = open;
      if (open) {
        stopTv(false);
        state.activeTab = null;
      }
      refreshUi();
    },
    onToggleLang: () => {
      state.lang = state.lang === "ja" ? "en" : "ja";
      refreshUi();
    },
    onToggleTheme: () => {
      const goDark = state.theme !== "dark";
      const liveIsNight = isNightAltitude(computeYokohamaSun(getSunDateForHourJst(null)).altitudeDeg);
      state.theme = goDark ? "dark" : "light";
      state.sunHourJst = goDark
        ? liveIsNight
          ? null
          : SKY_PRESETS.night
        : liveIsNight
          ? SKY_PRESETS.day
          : null;
      mapViewer.updateState(state, resolvedFeed, resolvedTrains);
      refreshUi();
    },
    onZoomIn: () => {
      stopTv(true);
      mapViewer.zoomBy(1.6);
    },
    onZoomOut: () => {
      stopTv(true);
      mapViewer.zoomBy(1 / 1.6);
    },
    onToggleFullscreen: () => {
      const docAny = document as unknown as {
        webkitFullscreenElement?: Element;
        webkitExitFullscreen?: () => Promise<void>;
      };
      const elAny = document.documentElement as unknown as {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      if (document.fullscreenElement || docAny.webkitFullscreenElement) {
        void (document.exitFullscreen ?? docAny.webkitExitFullscreen)?.call(document);
      } else {
        void (document.documentElement.requestFullscreen ?? elAny.webkitRequestFullscreen)?.call(
          document.documentElement,
        );
      }
    },
    onResetView: () => {
      stopTv(true);
      mapViewer.resetView();
    },
    onChangeVariant: (v: MapVariant) => {
      state.variant = v;
      mapViewer.updateState(state, resolvedFeed, resolvedTrains);
      refreshUi();
    },
    onChangeFeed: (f: FeedPreset) => {
      void loadFeed(f);
    },
    onChangeSunHour: (hour: number | null) => {
      state.sunHourJst = hour;
      const sun = computeYokohamaSun(getSunDateForHourJst(hour));
      state.theme = isNightAltitude(sun.altitudeDeg) ? "dark" : "light";
      mapViewer.updateState(state, resolvedFeed, resolvedTrains);
      refreshUi();
    },
    onChangeWeatherMode: (mode: WeatherMode) => {
      state.weatherMode = mode;
      const wState = resolveCurrentWeather();
      mapViewer.setWeatherVisual(wState.rainIntensity, wState.windSlope);
      mapViewer.renderOverlayFrame(false, true);
      refreshUi();
    },
    onTogglePlay: () => {
      state.playing = !state.playing;
      refreshUi();
    },
    onToggleOption: (key: BooleanOptionKey) => {
      state[key] = !state[key];
      if (key === "reducedMotion" && state.reducedMotion) {
        state.playing = false;
      }
      mapViewer.updateState(state, resolvedFeed, resolvedTrains);
      refreshUi();
    },
    onToggleSound: () => {
      if (state.soundOn) {
        soundscape.disable();
        state.soundOn = false;
        renderSq(sqEl, state, handlers);
        return;
      }
      state.soundOn = true;
      syncSound();
      void soundscape.enable().then((ok) => {
        state.soundOn = ok;
        if (ok) syncSound();
        renderSq(sqEl, state, handlers);
      });
      renderSq(sqEl, state, handlers);
    },
    onToggleFollow: () => {
      state.following = !state.following;
      renderCard(
        cardEl,
        state,
        resolvedFeed,
        0,
        handlers,
        resolvedTrains,
        resolvedPlanes,
        resolvedAirCabins,
        railBundle,
      );
    },
    onSelectLandmarkId: (id: string) => {
      stopTv(false);
      state.following = false;
      const lm = bundle.landmarks.find((l) => l.id === id);
      if (!lm) return;
      state.selected = { kind: "landmark", landmark: lm };
      state.activeTab = null;
      mapViewer.panToLonLat(lm.lon, lm.lat, lm.elevationM);
      refreshUi();
    },
    onSelectFeatureId: (fid: number) => {
      stopTv(false);
      state.following = false;
      const feat = resolveFeatureById(bundle, fid);
      if (!feat || feat.lon === undefined || feat.lat === undefined) return;
      state.selected = { kind: "feature", feature: feat, lon: feat.lon, lat: feat.lat };
      state.activeTab = null;
      mapViewer.panToLonLat(feat.lon, feat.lat, Math.min(feat.heightM, 40));
      mapViewer.updateState(state, resolvedFeed, resolvedTrains);
      refreshUi();
    },
    onSelectPoi: (poi: PoiRecord) => {
      stopTv(false);
      state.following = false;
      state.selected = { kind: "poi", poi };
      state.activeTab = null;
      mapViewer.panToLonLat(poi.lon, poi.lat, poi.elevationM);
      refreshUi();
    },
    onSelectPortCall: (pc: AnimatedPortCall) => {
      stopTv(false);
      const livePc = resolvedFeed.portCalls.find((x) => x.id === pc.id) ?? pc;
      state.following = livePc.moving !== false;
      state.selected = { kind: "portcall", portCall: livePc };
      state.activeTab = null;
      mapViewer.panToLonLat(livePc.lon, livePc.lat, 3.5);
      refreshUi();
    },
    onSelectTrain: selectTrain,
    onSelectPlane: selectPlane,
    onSelectAirCabin: selectAirCabin,
    onClearSelection: () => {
      stopTv(false);
      state.following = false;
      state.selected = null;
      mapViewer.updateState(state, resolvedFeed, resolvedTrains);
      refreshUi();
    },
  };

  mapViewer = new MapViewer(osdEl, glCanvas, bundle, state, {
    onSelectVehicle: selectVehicle,
    onSelectTrain: selectTrain,
    onSelectPlane: selectPlane,
    onSelectAirCabin: selectAirCabin,
    onSelectLandmark: (lm) => {
      stopTv(false);
      state.following = false;
      state.selected = { kind: "landmark", landmark: lm };
      state.activeTab = null;
      mapViewer.updateState(state, resolvedFeed, resolvedTrains);
      refreshUi();
    },
    onSelectFeature: (feat: SceneFeatureRecord, lon: number, lat: number) => {
      stopTv(false);
      state.following = false;
      state.selected = { kind: "feature", feature: feat, lon, lat };
      state.activeTab = null;
      mapViewer.updateState(state, resolvedFeed, resolvedTrains);
      refreshUi();
    },
    onSelectPortCall: (pc) => {
      stopTv(false);
      state.following = pc.moving !== false;
      state.selected = { kind: "portcall", portCall: pc };
      state.activeTab = null;
      mapViewer.updateState(state, resolvedFeed, resolvedTrains);
      refreshUi();
    },
    onClearSelection: () => {
      const hadUi = Boolean(state.selected || state.activeTab);
      state.following = false;
      state.selected = null;
      state.activeTab = null;
      if (hadUi) {
        mapViewer.updateState(state, resolvedFeed, resolvedTrains);
        refreshUi();
      }
    },
    onViewChanged: (centerImgX, centerImgY, zoom) => {
      state.cameraView = { centerImgX, centerImgY, zoom };
      syncViewportOverlays();
    },
    onTogglePlay: handlers.onTogglePlay,
    onUserPan: stopFollowing,
    onHover: (pick, x, y) => {
      if (pick) hoverTip.show(describePick(pick, state.lang), x, y);
      else hoverTip.hide();
    },
    onUserInteract: () => {
      stopTv(true);
      if (state.activeTab) {
        state.activeTab = null;
        refreshUi();
      }
    },
  });

  if (streetlights) {
    mapViewer.setStreetlights(streetlights);
  }
  if (ambient.pedestrians) {
    mapViewer.setPedestrians(ambient.pedestrians);
  }
  if (ambient.traffic) {
    mapViewer.setAmbientTraffic(ambient.traffic);
  }
  const initWeather = resolveCurrentWeather();
  mapViewer.setWeatherVisual(initWeather.rainIntensity, initWeather.windSlope);

  if (minimapEl) {
    minimap = new Minimap(minimapEl, bundle, (imgX, imgY, imm) => {
      stopTv(true);
      mapViewer.panToImagePx(imgX, imgY, imm);
    });
  }

  mapViewer.updateState(
    state,
    resolvedFeed,
    resolvedTrains,
    true,
    resolvedPlanes,
    resolvedAirCabins,
  );
  refreshUi();

  if (cloudIntro) {
    const intro = cloudIntro;
    void mapViewer
      .whenOpen()
      .then(() => mapViewer.playIntro(2600, (t) => intro.setProgress(t)))
      .finally(() => intro.finish());
  }

  window.addEventListener("keydown", (e) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      if (e.key === "Escape") {
        (e.target as HTMLElement).blur();
        state.activeTab = null;
        refreshUi();
      }
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      stopTv(false);
      state.activeTab = "search";
      refreshUi();
      return;
    }
    if (e.key === "Escape") {
      if (state.aboutOpen) {
        state.aboutOpen = false;
        refreshUi();
      } else if (state.activeTab) {
        state.activeTab = null;
        refreshUi();
      } else if (state.tvMode) {
        stopTv(true);
      } else if (state.selected) {
        handlers.onClearSelection();
      }
      return;
    }

    const stepPx = 72;
    if (e.key.startsWith("Arrow")) stopFollowing();
    if (e.key === "ArrowLeft") mapViewer.panByCssPx(-stepPx, 0);
    else if (e.key === "ArrowRight") mapViewer.panByCssPx(stepPx, 0);
    else if (e.key === "ArrowUp") mapViewer.panByCssPx(0, -stepPx);
    else if (e.key === "ArrowDown") mapViewer.panByCssPx(0, stepPx);
    else if (e.key === "+" || e.key === "=") mapViewer.zoomBy(1.6);
    else if (e.key === "-") mapViewer.zoomBy(1 / 1.6);
    else if (e.key === "0") handlers.onResetView();
    else if (e.key === " ") {
      e.preventDefault();
      handlers.onTogglePlay();
    }
  });

  window.setInterval(() => {
    if (state.feedPreset === "live" && !document.hidden) {
      void fetchSnapshotForPreset(bundle.baseReleaseUrl, "live", state.liveEndpoint).then(
        (snap) => {
          currentSnapshot = snap;
          resolvedFeed = resolveVehiclesForFrame(
            currentSnapshot,
            "live",
            state.simTimeSec,
            Date.now(),
            liveBusesApi,
          );
          mapViewer.updateState(state, resolvedFeed, resolvedTrains, false, resolvedPlanes, resolvedAirCabins);
          refreshUi();
        },
      );
    }
  }, 30_000);

  window.setInterval(() => {
    if (document.hidden) return;
    void fetchLiveBusesApi(state.liveEndpoint).then((payload: LiveBusApiPayload | null) => {
      if (payload) {
        liveBusesApi = payload;
        resolvedFeed = resolveVehiclesForFrame(
          currentSnapshot,
          state.feedPreset,
          state.simTimeSec,
          Date.now(),
          liveBusesApi,
        );
        mapViewer.updateState(state, resolvedFeed, resolvedTrains, false, resolvedPlanes, resolvedAirCabins);
        syncTransitBadges();
      }
    });
  }, 25_000);

  window.setInterval(() => {
    if (document.hidden) return;
    void fetchLiveTrainsApi().then((payload) => {
      if (payload) {
        liveTrainsApi = payload;
        resolvedTrains = resolveTrainsForFrame(
          railBundle,
          liveTrainsApi,
          state.simTimeSec,
          sessionStartDate,
        );
        mapViewer.updateState(state, resolvedFeed, resolvedTrains, false, resolvedPlanes, resolvedAirCabins);
        syncTransitBadges();
      }
    });
  }, 20_000);

  window.setInterval(() => {
    if (document.hidden) return;
    void fetchLivePlanesApi().then((payload: LivePlaneApiPayload | null) => {
      if (payload) {
        livePlanesApi = payload;
        resolvedPlanes = resolvePlanesForFrame(livePlanesApi, state.simTimeSec);
        mapViewer.updateState(state, resolvedFeed, resolvedTrains, false, resolvedPlanes, resolvedAirCabins);
        syncTransitBadges();
        renderStatus(
          statusEl,
          state,
          resolvedFeed,
          resolvedTrains,
          resolveCurrentWeather().statusText,
          resolvedPlanes,
        );
      }
    });
  }, 15_000);

  window.setInterval(() => {
    if (document.hidden) return;
    void fetchYokohamaWeather().then((w) => {
      if (w) {
        currentWeatherPayload = w;
        const wState = resolveCurrentWeather();
        mapViewer.setWeatherVisual(wState.rainIntensity, wState.windSlope);
        renderStatus(statusEl, state, resolvedFeed, resolvedTrains, wState.statusText, resolvedPlanes);
      }
    });
  }, 600_000);

  window.setInterval(() => {
    if (document.hidden) return;
    renderStatus(
      statusEl,
      state,
      resolvedFeed,
      resolvedTrains,
      resolveCurrentWeather().statusText,
      resolvedPlanes,
    );
    if (state.sunHourJst === null) {
      const liveIsNight = isNightAltitude(
        computeYokohamaSun(getSunDateForHourJst(null)).altitudeDeg,
      );
      const nextTheme = liveIsNight ? "dark" : "light";
      if (state.theme !== nextTheme) {
        state.theme = nextTheme;
        syncDocumentPrefs();
        renderSq(sqEl, state, handlers);
      }
      mapViewer.updateState(state, resolvedFeed, resolvedTrains, true, resolvedPlanes, resolvedAirCabins);
      minimap?.render(state, mapViewer.getViewportInfo());
    }
  }, 15_000);

  window.setInterval(() => {
    if (state.soundOn && !document.hidden) syncSound();
  }, 1000);

  let lastTs = performance.now();
  let lastUiRefreshTs = lastTs;
  let lastStationBoardRefreshTs = lastTs;
  let rafId = 0;

  const tick = (now: number) => {
    if (document.hidden) {
      rafId = 0;
      return;
    }
    const dtSec = Math.min(0.2, Math.max(0, (now - lastTs) / 1000));
    lastTs = now;

    if (state.following) {
      const target = followTarget();
      if (target) {
        mapViewer.followLonLat(target.lon, target.lat, target.elevM, dtSec);
      } else {
        stopFollowing();
      }
    }

    const wState = resolveCurrentWeather();
    if ((state.playing || wState.rainIntensity > 0.05) && !state.reducedMotion) {
      state.simTimeSec += dtSec;
      if (state.playing) {
        resolvedFeed = resolveVehiclesForFrame(
          currentSnapshot,
          state.feedPreset,
          state.simTimeSec,
          Date.now(),
          liveBusesApi,
        );
        resolvedTrains = resolveTrainsForFrame(
          railBundle,
          liveTrainsApi,
          state.simTimeSec,
          sessionStartDate,
        );
        resolvedPlanes = resolvePlanesForFrame(livePlanesApi, state.simTimeSec);
        resolvedAirCabins = resolveAirCabinForFrame(state.simTimeSec, sessionStartDate);
      }
      mapViewer.updateState(
        state,
        resolvedFeed,
        resolvedTrains,
        false,
        resolvedPlanes,
        resolvedAirCabins,
      );
      if (state.playing) {
        syncTransitBadges();
      }

      if (now - lastUiRefreshTs > 250) {
        lastUiRefreshTs = now;
        const movingSel =
          state.selected?.kind === "vehicle" ||
          state.selected?.kind === "portcall" ||
          state.selected?.kind === "train" ||
          state.selected?.kind === "plane" ||
          state.selected?.kind === "aircabin";
        const stationRefreshDue =
          now - lastStationBoardRefreshTs >= 1000 && isStationSelection(state.selected);
        if (state.playing && (movingSel || stationRefreshDue)) {
          if (stationRefreshDue) lastStationBoardRefreshTs = now;
          const drift = mapViewer.measureMaxMarkerDriftCssPx();
          renderCard(
            cardEl,
            state,
            resolvedFeed,
            drift,
            handlers,
            resolvedTrains,
            resolvedPlanes,
            resolvedAirCabins,
            railBundle,
          );
        }
        if (
          state.playing &&
          (state.selected?.kind === "portcall" ||
            state.selected?.kind === "train" ||
            state.selected?.kind === "plane" ||
            state.selected?.kind === "aircabin")
        ) {
          const bounds = mapViewer.getViewportInfo();
          labelLayer.render(
            labelLayerEl,
            bundle,
            state,
            bounds,
            handlers.onSelectPoi,
            resolvedFeed,
            resolvedTrains,
            resolvedPlanes,
            resolvedAirCabins,
          );
        }
        renderStatus(statusEl, state, resolvedFeed, resolvedTrains, wState.statusText, resolvedPlanes);
      }
    }

    rafId = window.requestAnimationFrame(tick);
  };

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && rafId === 0) {
      lastTs = performance.now();
      rafId = window.requestAnimationFrame(tick);
    }
  });

  rafId = window.requestAnimationFrame(tick);
}

void bootstrap();
