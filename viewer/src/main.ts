import "./style.css";
import {
  computeYokohamaSun,
  type PoiRecord,
  type SceneFeatureRecord,
} from "@small-yokohama/core";
import { loadCurrentRelease, type LoadedReleaseBundle } from "./data/releaseLoader.js";
import {
  fetchSnapshotForPreset,
  resolveVehiclesForFrame,
  type AnimatedPortCall,
  type ResolvedFeedState,
  type ResolvedVehicle,
} from "./data/vehicleFeed.js";
import { getDict } from "./i18n.js";
import {
  createInitialViewerState,
  serializeShareUrl,
  type DropTab,
  type FeedPreset,
  type MapVariant,
  type ViewerState,
} from "./state.js";
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
import { MapViewer } from "./viewer/MapViewer.js";
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
    { width: window.innerWidth, height: window.innerHeight },
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
    state.selected = {
      kind: "vehicle",
      vehicle: rv.record,
      ageSec: rv.freshness.ageSec,
      status: rv.freshness.status,
    };
    state.activeTab = null;
    mapViewer.updateState(state, resolvedFeed);
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
      selectVehicle,
      handlers.onSelectPortCall,
    );
  };

  const syncViewportOverlays = () => {
    if (!mapViewer) return;
    const bounds = mapViewer.getViewportInfo();
    labelLayer.render(labelLayerEl, bundle, state, bounds, handlers.onSelectPoi, resolvedFeed);
    transitLayer.render(
      transitLayerEl,
      bundle,
      state,
      bounds,
      resolvedFeed,
      selectVehicle,
      handlers.onSelectPortCall,
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
    renderDrop(dropEl, state, bundle, resolvedFeed, handlers);
    const drift = mapViewer ? mapViewer.measureMaxMarkerDriftCssPx() : 0;
    renderCard(cardEl, state, resolvedFeed, drift, handlers);
    renderStatus(statusEl, state, resolvedFeed);
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
    resolvedFeed = resolveVehiclesForFrame(currentSnapshot, preset, state.simTimeSec);
    mapViewer.updateState(state, resolvedFeed);
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
    onShare: async (anchorEl?: HTMLElement | null) => {
      const url = serializeShareUrl(state, window.location.href);
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
      mapViewer.updateState(state, resolvedFeed);
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
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onChangeFeed: (f: FeedPreset) => {
      void loadFeed(f);
    },
    onChangeSunHour: (hour: number | null) => {
      state.sunHourJst = hour;
      const sun = computeYokohamaSun(getSunDateForHourJst(hour));
      state.theme = isNightAltitude(sun.altitudeDeg) ? "dark" : "light";
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
      mapViewer.panToLonLat(lm.lon, lm.lat, lm.elevationM);
      refreshUi();
    },
    onSelectPoi: (poi: PoiRecord) => {
      stopTv(false);
      state.selected = { kind: "poi", poi };
      state.activeTab = null;
      mapViewer.panToLonLat(poi.lon, poi.lat, poi.elevationM);
      refreshUi();
    },
    onSelectPortCall: (pc: AnimatedPortCall) => {
      stopTv(false);
      const livePc = resolvedFeed.portCalls.find((x) => x.id === pc.id) ?? pc;
      state.selected = { kind: "portcall", portCall: livePc };
      state.activeTab = null;
      mapViewer.panToLonLat(livePc.lon, livePc.lat, 3.5);
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
    onSelectVehicle: selectVehicle,
    onSelectLandmark: (lm) => {
      stopTv(false);
      state.selected = { kind: "landmark", landmark: lm };
      state.activeTab = null;
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onSelectFeature: (feat: SceneFeatureRecord, lon: number, lat: number) => {
      stopTv(false);
      state.selected = { kind: "feature", feature: feat, lon, lat };
      state.activeTab = null;
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onSelectPortCall: (pc) => {
      stopTv(false);
      state.selected = { kind: "portcall", portCall: pc };
      state.activeTab = null;
      mapViewer.updateState(state, resolvedFeed);
      refreshUi();
    },
    onClearSelection: () => {
      const hadUi = Boolean(state.selected || state.activeTab);
      state.selected = null;
      state.activeTab = null;
      if (hadUi) {
        mapViewer.updateState(state, resolvedFeed);
        refreshUi();
      }
    },
    onViewChanged: (centerImgX, centerImgY, zoom) => {
      state.cameraView = { centerImgX, centerImgY, zoom };
      syncViewportOverlays();
    },
    onTogglePlay: handlers.onTogglePlay,
    onUserInteract: () => {
      stopTv(true);
      if (state.activeTab) {
        state.activeTab = null;
        refreshUi();
      }
    },
  });

  if (minimapEl) {
    minimap = new Minimap(minimapEl, bundle, (imgX, imgY, imm) => {
      stopTv(true);
      mapViewer.panToImagePx(imgX, imgY, imm);
    });
  }

  mapViewer.updateState(state, resolvedFeed);
  refreshUi();

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
          resolvedFeed = resolveVehiclesForFrame(currentSnapshot, "live", state.simTimeSec);
          mapViewer.updateState(state, resolvedFeed);
          refreshUi();
        },
      );
    }
  }, 30_000);

  window.setInterval(() => {
    if (document.hidden) return;
    renderStatus(statusEl, state, resolvedFeed);
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
      mapViewer.updateState(state, resolvedFeed, true);
      minimap?.render(state, mapViewer.getViewportInfo());
    }
  }, 15_000);

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
      syncTransitBadges();

      if (now - lastUiRefreshTs > 250) {
        lastUiRefreshTs = now;
        if (state.selected?.kind === "vehicle" || state.selected?.kind === "portcall") {
          const drift = mapViewer.measureMaxMarkerDriftCssPx();
          renderCard(cardEl, state, resolvedFeed, drift, handlers);
        }
        if (state.selected?.kind === "portcall") {
          const bounds = mapViewer.getViewportInfo();
          labelLayer.render(labelLayerEl, bundle, state, bounds, handlers.onSelectPoi, resolvedFeed);
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
