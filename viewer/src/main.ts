import "./style.css";
import type { PortCallRecord } from "@small-yokohama/core";
import { loadCurrentRelease, type LoadedReleaseBundle } from "./data/releaseLoader.js";
import {
  fetchSnapshotForPreset,
  resolveVehiclesForFrame,
  type ResolvedFeedState,
  type ResolvedVehicle,
} from "./data/vehicleFeed.js";
import { getDict } from "./i18n.js";
import {
  createInitialViewerState,
  serializeShareUrl,
  type FeedPreset,
  type MapVariant,
  type ViewerState,
} from "./state.js";
import {
  renderCreditsBarAndModal,
  renderDetailCard,
  renderDrawer,
  renderFeedBanner,
  renderTopBar,
  type UiHandlers,
} from "./ui/renderUi.js";
import { MapViewer } from "./viewer/MapViewer.js";

async function bootstrap(): Promise<void> {
  const topBarEl = document.getElementById("top-bar")!;
  const feedBannerEl = document.getElementById("feed-banner")!;
  const drawerEl = document.getElementById("landmark-drawer")!;
  const osdEl = document.getElementById("osd-container")!;
  const glCanvas = document.getElementById("webgl-overlay") as HTMLCanvasElement;
  const detailEl = document.getElementById("detail-card")!;
  const hintEl = document.getElementById("map-controls-hint")!;
  const creditsBarEl = document.getElementById("credits-bar")!;
  const creditsModalEl = document.getElementById("credits-modal")!;

  let bundle: LoadedReleaseBundle;
  try {
    bundle = await loadCurrentRelease();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    topBarEl.innerHTML = `<span class="brand-title">Small Yokohama — Failed to load release: ${msg}</span>`;
    return;
  }

  const prefersReducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let state: ViewerState = createInitialViewerState(
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

  if (resolvedFeed.vehicles[0]) {
    const first = resolvedFeed.vehicles[0];
    state.selected = {
      kind: "vehicle",
      vehicle: first.record,
      ageSec: first.freshness.ageSec,
      status: first.freshness.status,
    };
  }

  let creditsModalOpen = false;
  let mapViewer: MapViewer;

  const refreshUi = () => {
    const d = getDict(state.lang);
    hintEl.textContent = d.keyboardHint;
    renderTopBar(topBarEl, state, handlers);
    renderFeedBanner(feedBannerEl, state, resolvedFeed);
    renderDrawer(drawerEl, state, bundle, resolvedFeed, handlers);
    const drift = mapViewer ? mapViewer.measureMaxMarkerDriftCssPx() : 0;
    renderDetailCard(detailEl, state, resolvedFeed, drift, handlers);
    renderCreditsBarAndModal(creditsBarEl, creditsModalEl, state, bundle, creditsModalOpen, handlers);
  };

  const loadFeed = async (preset: FeedPreset) => {
    state.feedPreset = preset;
    currentSnapshot = await fetchSnapshotForPreset(
      bundle.baseReleaseUrl,
      preset,
      state.liveEndpoint,
    );
    resolvedFeed = resolveVehiclesForFrame(currentSnapshot, preset, state.simTimeSec);
    if (resolvedFeed.vehicles[0]) {
      const rv = resolvedFeed.vehicles[0];
      state.selected = {
        kind: "vehicle",
        vehicle: rv.record,
        ageSec: rv.freshness.ageSec,
        status: rv.freshness.status,
      };
    } else {
      state.selected = null;
    }
    mapViewer.updateState(state, resolvedFeed);
    refreshUi();
  };

  const handlers: UiHandlers = {
    onToggleDrawer: () => {
      state.drawerOpen = !state.drawerOpen;
      refreshUi();
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
    onResetView: () => {
      mapViewer.resetView();
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
    onToggleLang: () => {
      state.lang = state.lang === "ja" ? "en" : "ja";
      refreshUi();
    },
    onOpenCredits: () => {
      creditsModalOpen = true;
      refreshUi();
    },
    onCloseCredits: () => {
      creditsModalOpen = false;
      refreshUi();
    },
    onToggleOption: (key) => {
      state[key] = !state[key];
      if (key === "reducedMotion" && state.reducedMotion) {
        state.playing = false;
      }
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onSelectLandmarkId: (id: string) => {
      const lm = bundle.landmarks.find((l) => l.id === id);
      if (!lm) return;
      state.selected = { kind: "landmark", landmark: lm };
      mapViewer.panToLonLat(lm.lon, lm.lat, lm.elevationM, 2.5);
      refreshUi();
    },
    onSelectPortCall: (pc: PortCallRecord) => {
      state.selected = { kind: "portcall", portCall: pc };
      mapViewer.panToLonLat(pc.lon, pc.lat, 3.5, 2.2);
      refreshUi();
    },
    onClearSelection: () => {
      state.selected = null;
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
  };

  mapViewer = new MapViewer(osdEl, glCanvas, bundle, state, {
    onSelectVehicle: (rv: ResolvedVehicle) => {
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
      state.selected = { kind: "landmark", landmark: lm };
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onSelectPortCall: (pc) => {
      state.selected = { kind: "portcall", portCall: pc };
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onClearSelection: () => {
      state.selected = null;
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onViewChanged: (centerImgX, centerImgY, zoom) => {
      state.cameraView = { centerImgX, centerImgY, zoom };
    },
    onTogglePlay: handlers.onTogglePlay,
  });

  mapViewer.updateState(state, resolvedFeed);
  refreshUi();

  // Keyboard navigation & play/pause
  window.addEventListener("keydown", (e) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    const stepPx = 72;
    if (e.key === "ArrowLeft") mapViewer.panByCssPx(-stepPx, 0);
    else if (e.key === "ArrowRight") mapViewer.panByCssPx(stepPx, 0);
    else if (e.key === "ArrowUp") mapViewer.panByCssPx(0, -stepPx);
    else if (e.key === "ArrowDown") mapViewer.panByCssPx(0, stepPx);
    else if (e.key === "+" || e.key === "=") mapViewer.zoomBy(1.25);
    else if (e.key === "-") mapViewer.zoomBy(0.8);
    else if (e.key === "0") mapViewer.resetView();
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

  // Animation loop — strictly paused when tab is hidden (design.md requirement)
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

      // Refresh selected vehicle card at ~4 Hz without thrashing DOM at 60 FPS
      if (state.selected?.kind === "vehicle" && now - lastUiRefreshTs > 250) {
        lastUiRefreshTs = now;
        const drift = mapViewer.measureMaxMarkerDriftCssPx();
        renderDetailCard(detailEl, state, resolvedFeed, drift, handlers);
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

  if (!document.hidden) {
    rafId = window.requestAnimationFrame(tick);
  }
}

void bootstrap();
