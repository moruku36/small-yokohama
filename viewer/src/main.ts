import "./style.css";
import type { PoiRecord, PortCallRecord, SceneFeatureRecord } from "@small-yokohama/core";
import { loadCurrentRelease, type LoadedReleaseBundle } from "./data/releaseLoader.js";
import {
  fetchSnapshotForPreset,
  resolveVehiclesForFrame,
  type ResolvedFeedState,
  type ResolvedVehicle,
} from "./data/vehicleFeed.js";
import {
  createInitialViewerState,
  serializeShareUrl,
  type DropTab,
  type FeedPreset,
  type MapVariant,
  type ViewerState,
} from "./state.js";
import { LabelLayer } from "./ui/LabelLayer.js";
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
import { MapViewer } from "./viewer/MapViewer.js";

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
  const cardEl = document.getElementById("card")!;
  const statusEl = document.getElementById("status")!;
  const sqEl = document.getElementById("sq")!;
  const creditEl = document.getElementById("credit")!;
  const aboutModalEl = document.getElementById("about-modal")!;
  const labelLayerEl = document.getElementById("label-layer")!;
  const osdEl = document.getElementById("osd-container")!;
  const glCanvas = document.getElementById("webgl-overlay") as HTMLCanvasElement;

  let bundle: LoadedReleaseBundle;
  try {
    bundle = await loadCurrentRelease();
  } catch (err) {
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
  );

  let currentSnapshot = await fetchSnapshotForPreset(
    bundle.baseReleaseUrl,
    state.feedPreset,
    state.liveEndpoint,
  );
  let resolvedFeed: ResolvedFeedState = resolveVehiclesForFrame(
    currentSnapshot,
    state.feedPreset,
    state.simTimeSec,
  );

  const labelLayer = new LabelLayer();
  let mapViewer: MapViewer;
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

  const syncLabels = () => {
    if (!mapViewer) return;
    const bounds = mapViewer.getViewportInfo();
    labelLayer.render(labelLayerEl, bundle, state, bounds, handlers.onSelectPoi);
  };

  const syncDocumentPrefs = () => {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.lang = state.lang;
  };

  const refreshUi = () => {
    syncDocumentPrefs();
    renderBar(barEl, state, handlers);
    renderDrop(dropEl, state, bundle, resolvedFeed, handlers);
    const drift = mapViewer ? mapViewer.measureMaxMarkerDriftCssPx() : 0;
    renderCard(cardEl, state, resolvedFeed, drift, handlers);
    renderStatus(statusEl, state, resolvedFeed);
    renderSq(sqEl, state, handlers);
    renderCreditAndAboutModal(creditEl, aboutModalEl, state, bundle, handlers);
    syncLabels();
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
    mapViewer.panToLonLat(lm.lon, lm.lat, lm.elevationM, 2.75);
    refreshUi();
  };

  const loadFeed = async (preset: FeedPreset) => {
    state.feedPreset = preset;
    currentSnapshot = await fetchSnapshotForPreset(
      bundle.baseReleaseUrl,
      preset,
      state.liveEndpoint,
    );
    resolvedFeed = resolveVehiclesForFrame(currentSnapshot, preset, state.simTimeSec);
    mapViewer.updateState(state, resolvedFeed);
    refreshUi();
  };

  const handlers: UiHandlers = {
    onSetTab: (tab: DropTab) => {
      stopTv(false);
      state.activeTab = tab;
      refreshUi();
    },
    onSearchQuery: (q: string) => {
      state.searchQuery = q;
      renderDrop(dropEl, state, bundle, resolvedFeed, handlers);
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
    onShare: async () => {
      const url = serializeShareUrl(state, window.location.href);
      window.history.replaceState(null, "", url);
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
          return true;
        } catch {
          return false;
        }
      }
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
      state.theme = state.theme === "light" ? "dark" : "light";
      refreshUi();
    },
    onZoomIn: () => {
      stopTv(true);
      mapViewer.zoomBy(1.3);
    },
    onZoomOut: () => {
      stopTv(true);
      mapViewer.zoomBy(1 / 1.3);
    },
    onToggleFullscreen: () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen?.();
      } else {
        void document.documentElement.requestFullscreen?.();
      }
    },
    onResetView: () => {
      stopTv(true);
      mapViewer.resetView();
    },
    onChangeVariant: (v: MapVariant) => {
      state.variant = v;
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onChangeFeed: (f: FeedPreset) => {
      void loadFeed(f);
    },
    onChangeSunHour: (hour: number | null) => {
      state.sunHourJst = hour;
      mapViewer.updateState(state, resolvedFeed);
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
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onSelectLandmarkId: (id: string) => {
      stopTv(false);
      const lm = bundle.landmarks.find((l) => l.id === id);
      if (!lm) return;
      state.selected = { kind: "landmark", landmark: lm };
      state.activeTab = null;
      mapViewer.panToLonLat(lm.lon, lm.lat, lm.elevationM, 2.8);
      refreshUi();
    },
    onSelectPoi: (poi: PoiRecord) => {
      stopTv(false);
      state.selected = { kind: "poi", poi };
      state.activeTab = null;
      mapViewer.panToLonLat(poi.lon, poi.lat, poi.elevationM, 3.0);
      refreshUi();
    },
    onSelectPortCall: (pc: PortCallRecord) => {
      stopTv(false);
      state.selected = { kind: "portcall", portCall: pc };
      state.activeTab = null;
      mapViewer.panToLonLat(pc.lon, pc.lat, 3.5, 2.5);
      refreshUi();
    },
    onClearSelection: () => {
      stopTv(false);
      state.selected = null;
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
  };

  mapViewer = new MapViewer(osdEl, glCanvas, bundle, state, {
    onSelectVehicle: (rv: ResolvedVehicle) => {
      stopTv(false);
      state.selected = {
        kind: "vehicle",
        vehicle: rv.record,
        ageSec: rv.freshness.ageSec,
        status: rv.freshness.status,
      };
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onSelectLandmark: (lm) => {
      stopTv(false);
      state.selected = { kind: "landmark", landmark: lm };
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onSelectFeature: (feat: SceneFeatureRecord, lon: number, lat: number) => {
      stopTv(false);
      state.selected = { kind: "feature", feature: feat, lon, lat };
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onSelectPortCall: (pc) => {
      stopTv(false);
      state.selected = { kind: "portcall", portCall: pc };
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onClearSelection: () => {
      state.selected = null;
      if (state.activeTab) {
        state.activeTab = null;
      }
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onViewChanged: (centerImgX, centerImgY, zoom) => {
      state.cameraView = { centerImgX, centerImgY, zoom };
      syncLabels();
    },
    onTogglePlay: handlers.onTogglePlay,
    onUserInteract: () => {
      stopTv(true);
    },
  });

  mapViewer.updateState(state, resolvedFeed);
  refreshUi();

  // Keyboard shortcuts matching Small SF + map navigation
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
    if (e.key === "ArrowLeft") mapViewer.panByCssPx(-stepPx, 0);
    else if (e.key === "ArrowRight") mapViewer.panByCssPx(stepPx, 0);
    else if (e.key === "ArrowUp") mapViewer.panByCssPx(0, -stepPx);
    else if (e.key === "ArrowDown") mapViewer.panByCssPx(0, stepPx);
    else if (e.key === "+" || e.key === "=") mapViewer.zoomBy(1.25);
    else if (e.key === "-") mapViewer.zoomBy(0.8);
    else if (e.key === "0") handlers.onResetView();
    else if (e.key === " ") {
      e.preventDefault();
      handlers.onTogglePlay();
    }
  });

  // Live 30-second polling when live preset is selected
  window.setInterval(() => {
    if (state.feedPreset === "live" && !document.hidden) {
      void fetchSnapshotForPreset(bundle.baseReleaseUrl, "live", state.liveEndpoint).then(
        (snap) => {
          currentSnapshot = snap;
          resolvedFeed = resolveVehiclesForFrame(currentSnapshot, "live", state.simTimeSec);
          mapViewer.updateState(state, resolvedFeed);
          refreshUi();
        },
      );
    }
  }, 30_000);

  // Animation loop — strictly paused when tab is hidden
  let lastTs = performance.now();
  let lastUiRefreshTs = lastTs;
  let rafId = 0;

  const tick = (now: number) => {
    if (document.hidden) {
      rafId = 0;
      return;
    }
    const dtSec = Math.min(0.2, Math.max(0, (now - lastTs) / 1000));
    lastTs = now;

    if (state.playing && !state.reducedMotion) {
      state.simTimeSec += dtSec;
      resolvedFeed = resolveVehiclesForFrame(
        currentSnapshot,
        state.feedPreset,
        state.simTimeSec,
      );
      mapViewer.updateState(state, resolvedFeed);

      // Refresh selected card and status pill at ~4 Hz without DOM churn at 60 FPS
      if (now - lastUiRefreshTs > 250) {
        lastUiRefreshTs = now;
        if (state.selected?.kind === "vehicle") {
          const drift = mapViewer.measureMaxMarkerDriftCssPx();
          renderCard(cardEl, state, resolvedFeed, drift, handlers);
        }
        renderStatus(statusEl, state, resolvedFeed);
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
