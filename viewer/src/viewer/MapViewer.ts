import OpenSeadragon from "openseadragon";
import {
  SURFACE_KIND,
  computeYokohamaSun,
  imagePxToNdc,
  imageToLocalOnPlane,
  localToImage,
  localToWgs84,
  wgs84ToLocal,
  type CameraManifest,
  type Landmark,
  type SceneFeatureRecord,
} from "@small-yokohama/core";
import { pickFeatureIdAtImagePx, type LoadedReleaseBundle } from "../data/releaseLoader.js";
import type {
  AnimatedPortCall,
  ResolvedFeedState,
  ResolvedVehicle,
} from "../data/vehicleFeed.js";
import type { MapVariant, ViewerState } from "../state.js";
import type { ViewportImageBounds } from "../ui/LabelLayer.js";
import { WebGLOverlay } from "./WebGLOverlay.js";
import {
  RED_BRICK_CENTER_IMG,
  computeDefaultFullMapZoom,
  computeFullMapMaxZoom,
  computeFullMapMinZoom,
  computeLandmarkZoom,
  computePinchZoom,
  computeWheelZoomFactor,
  isFullYokohamaCamera,
} from "./cameraMath.js";
import {
  computeSkyGrade,
  getSunDateForHourJst,
  type SkyGrade,
} from "./skyLighting.js";

export interface MapViewerCallbacks {
  onSelectVehicle: (rv: ResolvedVehicle) => void;
  onSelectLandmark: (lm: Landmark) => void;
  onSelectFeature: (feat: SceneFeatureRecord, lon: number, lat: number) => void;
  onSelectPortCall: (pc: AnimatedPortCall) => void;
  onClearSelection: () => void;
  onViewChanged: (centerImgX: number, centerImgY: number, zoom: number) => void;
  onTogglePlay: () => void;
  onUserInteract?: () => void;
}

const UI_CHROME_SELECTOR = "#bar, #drop, #card, #sq, #status, #minimap, #about-modal, #credit";
const PIN_SELECTOR = ".map-label, .search-pin, .bus-pill, .boat-pill";

export class MapViewer {
  private readonly osd: OpenSeadragon.Viewer;
  private readonly glOverlay: WebGLOverlay;
  private readonly camera: CameraManifest;
  private readonly isMobile: boolean;
  private readonly inputRoot: HTMLElement;
  private readonly skyTintEl: HTMLElement | null;
  private readonly veilEl: HTMLElement | null;
  private readonly skyFilterSvg: SVGSVGElement | null = null;
  private readonly skyColorMatrix: SVGFEColorMatrixElement | null = null;
  private currentVariant: MapVariant;
  private feedState: ResolvedFeedState | null = null;
  private resizeObserver: ResizeObserver;
  private cleanupInput: () => void = () => {};
  private zoomStepFn: ((factor: number, pixel: OpenSeadragon.Point) => void) | null = null;
  private currentRgb: [number, number, number] = [1, 1, 1];
  private targetRgb: [number, number, number] = [1, 1, 1];
  private skyAnimRaf = 0;
  private skyAnimLastTs = 0;
  private lastFilterStr = "";
  private isDestroyed = false;

  constructor(
    private readonly osdElement: HTMLElement,
    private readonly glCanvas: HTMLCanvasElement,
    private readonly bundle: LoadedReleaseBundle,
    private state: ViewerState,
    private readonly callbacks: MapViewerCallbacks,
  ) {
    this.camera = bundle.camera;
    this.currentVariant = state.variant;
    this.inputRoot = osdElement.parentElement ?? osdElement;
    this.skyTintEl = document.getElementById("sky-tint");
    this.veilEl = document.getElementById("veil");
    this.glOverlay = new WebGLOverlay(glCanvas, bundle.camera, bundle.depthTiles);

    const isFull = isFullYokohamaCamera(bundle.camera);
    this.isMobile =
      typeof window !== "undefined" &&
      ((window.matchMedia?.("(pointer: coarse)").matches ?? false) || window.innerWidth <= 700);

    // SVG feColorMatrix filter for WebGL desktop map tinting (Small SF technique; avoids Chromium blend bugs)
    if (!this.isMobile && typeof document !== "undefined") {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.setAttribute("aria-hidden", "true");
      svg.style.position = "absolute";
      svg.style.pointerEvents = "none";
      const filter = document.createElementNS(ns, "filter");
      filter.setAttribute("id", "sy-sky-tint");
      filter.setAttribute("color-interpolation-filters", "sRGB");
      const matrix = document.createElementNS(ns, "feColorMatrix");
      matrix.setAttribute("type", "matrix");
      matrix.setAttribute("values", "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0");
      filter.appendChild(matrix);
      svg.appendChild(filter);
      document.body.appendChild(svg);
      this.skyFilterSvg = svg;
      this.skyColorMatrix = matrix;
    }

    const dziUrl = `${bundle.baseReleaseUrl}/${bundle.release.variants[state.variant].dziPath}`;
    this.osd = OpenSeadragon({
      element: osdElement,
      tileSources: dziUrl,
      drawer: this.isMobile ? "canvas" : ["webgl", "canvas"],
      mouseNavEnabled: false,
      maxImageCacheCount: this.isMobile ? 60 : 250,
      imageLoaderLimit: this.isMobile ? 4 : 8,
      minPixelRatio: 1.0,
      smoothTileEdgesMinZoom: Infinity,
      showNavigationControl: false,
      showNavigator: false,
      animationTime: state.reducedMotion ? 0 : 0.6,
      springStiffness: state.reducedMotion ? 100 : 9,
      minZoomImageRatio: isFull ? 0.96 : 0.55,
      maxZoomPixelRatio: isFull ? (this.isMobile ? 1.15 : 1.5) : 6,
      visibilityRatio: isFull ? 0.92 : 0.65,
      constrainDuringPan: false,
      gestureSettingsMouse: {
        dragToPan: false,
        clickToZoom: false,
        dblClickToZoom: false,
        dblClickDragToZoom: false,
        scrollToZoom: false,
        flickEnabled: false,
      },
      gestureSettingsTouch: {
        dragToPan: false,
        clickToZoom: false,
        dblClickToZoom: false,
        dblClickDragToZoom: false,
        pinchToZoom: false,
        pinchRotate: false,
        flickEnabled: false,
      },
      gestureSettingsPen: {
        dragToPan: false,
        clickToZoom: false,
        dblClickToZoom: false,
        dblClickDragToZoom: false,
        pinchToZoom: false,
        flickEnabled: false,
      },
    });

    this.osd.addHandler("open", () => {
      this.updateViewportMinZoom(false);
      this.applyCameraView(this.state.cameraView, true);
      this.osd.viewport?.applyConstraints(true);
      this.renderOverlayFrame(true);
      this.dismissVeil();
    });

    const syncHandler = () => {
      this.syncCameraViewState();
      this.renderOverlayFrame(false);
    };
    this.osd.addHandler("update-viewport", syncHandler);
    this.osd.addHandler("animation", syncHandler);
    this.osd.addHandler("resize", () => {
      this.updateViewportMinZoom(true);
      syncHandler();
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.updateViewportMinZoom(true);
      this.renderOverlayFrame(false);
    });
    this.resizeObserver.observe(osdElement);

    this.cleanupInput = this.installDirectInputController();
    this.renderOverlayFrame(true);
  }

  private dismissVeil(): void {
    if (!this.veilEl || this.veilEl.hidden) return;
    this.veilEl.classList.add("gone");
    window.setTimeout(() => {
      if (this.veilEl?.classList.contains("gone")) {
        this.veilEl.hidden = true;
      }
    }, 520);
  }

  private computeCurrentSky(): { grade: SkyGrade } {
    const sunDate = getSunDateForHourJst(this.state.sunHourJst);
    const sun = computeYokohamaSun(sunDate);
    return { grade: computeSkyGrade(sun.altitudeDeg) };
  }

  private writeSkyFilterValues(rgb: readonly [number, number, number], grade: SkyGrade): void {
    const isDay = rgb[0] > 0.992 && rgb[1] > 0.992 && rgb[2] > 0.992;

    if (!this.isMobile && this.skyColorMatrix) {
      const r = rgb[0].toFixed(3);
      const g = rgb[1].toFixed(3);
      const b = rgb[2].toFixed(3);
      this.skyColorMatrix.setAttribute(
        "values",
        `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`,
      );
      const nextFilter = isDay ? "" : "url(#sy-sky-tint)";
      if (this.lastFilterStr !== nextFilter) {
        this.lastFilterStr = nextFilter;
        this.osdElement.style.filter = nextFilter;
      }
      if (this.skyTintEl) {
        this.skyTintEl.style.opacity = "0";
      }
      return;
    }

    // Mobile 2D Canvas fallback: reliable across iOS Safari & Android Chrome
    const strength = Math.max(
      0,
      Math.min(0.95, 1 - Math.min(rgb[0], rgb[1], rgb[2])),
    );
    const nightAmt = grade.nightLights;
    const nextFilter = isDay
      ? ""
      : `brightness(${(1 - nightAmt * 0.1).toFixed(3)}) contrast(${(1 + nightAmt * 0.08).toFixed(3)}) saturate(${(1 - nightAmt * 0.12).toFixed(3)})`;
    if (this.lastFilterStr !== nextFilter) {
      this.lastFilterStr = nextFilter;
      this.osdElement.style.filter = nextFilter;
    }
    if (this.skyTintEl) {
      if (isDay) {
        this.skyTintEl.style.opacity = "0";
      } else {
        const [mr, mg, mb] = grade.multiplyCssRgb;
        this.skyTintEl.style.background = `rgb(${mr}, ${mg}, ${mb})`;
        this.skyTintEl.style.opacity = Math.max(strength, grade.multiplyOpacity).toFixed(3);
      }
    }
  }

  private applySkyFilter(grade: SkyGrade, immediate: boolean): void {
    this.targetRgb = [...grade.matrixRgb];

    if (immediate || this.state.reducedMotion) {
      if (this.skyAnimRaf) {
        window.cancelAnimationFrame(this.skyAnimRaf);
        this.skyAnimRaf = 0;
      }
      this.currentRgb = [...this.targetRgb];
      this.writeSkyFilterValues(this.currentRgb, grade);
      return;
    }

    if (!this.skyAnimRaf) {
      this.skyAnimLastTs = 0;
      const step = (ts: number) => {
        this.skyAnimRaf = 0;
        if (this.isDestroyed) return;
        const dt = Math.min(0.05, (ts - (this.skyAnimLastTs || ts)) / 1000);
        this.skyAnimLastTs = ts;
        const alpha = 1 - Math.exp(-dt / 0.12);
        this.currentRgb = [
          this.currentRgb[0] + (this.targetRgb[0] - this.currentRgb[0]) * alpha,
          this.currentRgb[1] + (this.targetRgb[1] - this.currentRgb[1]) * alpha,
          this.currentRgb[2] + (this.targetRgb[2] - this.currentRgb[2]) * alpha,
        ];
        const { grade: liveGrade } = this.computeCurrentSky();
        this.writeSkyFilterValues(this.currentRgb, liveGrade);

        const diff =
          Math.abs(this.targetRgb[0] - this.currentRgb[0]) +
          Math.abs(this.targetRgb[1] - this.currentRgb[1]) +
          Math.abs(this.targetRgb[2] - this.currentRgb[2]);
        if (diff > 0.004) {
          this.skyAnimRaf = window.requestAnimationFrame(step);
        } else {
          this.currentRgb = [...this.targetRgb];
          this.writeSkyFilterValues(this.currentRgb, liveGrade);
        }
      };
      this.skyAnimRaf = window.requestAnimationFrame(step);
    }
  }

  private installDirectInputController(): () => void {
    const cam = {
      vx: 0,
      vy: 0,
      glide: false,
      zoomTo: null as number | null,
      zoomAt: null as OpenSeadragon.Point | null,
      samples: [] as Array<{ t: number; dx: number; dy: number }>,
      raf: 0,
      last: 0,
      wheelRaf: 0,
      wheelZFactor: 1,
      wheelDx: 0,
      wheelDy: 0,
      wheelAt: null as OpenSeadragon.Point | null,
      wheelSettleTimer: 0,
    };

    const panPx = (dx: number, dy: number) => {
      const vp = this.osd.viewport;
      if (!vp) return;
      vp.panBy(vp.deltaPointsFromPixels(new OpenSeadragon.Point(dx, dy)), true);
    };

    const clampZoom = (z: number): number => {
      const vp = this.osd.viewport;
      if (!vp) return z;
      return Math.min(vp.getMaxZoom(), Math.max(vp.getMinZoom(), z));
    };

    const outOfBounds = (): boolean => {
      const vp = this.osd.viewport;
      if (!vp) return false;
      const b = vp.getBounds(true);
      const c = vp.getConstrainedBounds(true);
      return Math.abs(b.x - c.x) + Math.abs(b.y - c.y) > b.width * 0.002;
    };

    const stopPhysics = () => {
      cam.glide = false;
      cam.vx = 0;
      cam.vy = 0;
      cam.zoomTo = null;
      cam.zoomAt = null;
    };

    const runLoop = () => {
      if (!cam.raf && !this.isDestroyed) {
        cam.raf = window.requestAnimationFrame(tick);
      }
    };

    const tick = (t: number) => {
      cam.raf = 0;
      if (this.isDestroyed) return;
      const vp = this.osd.viewport;
      if (!vp) {
        cam.last = 0;
        return;
      }
      const dt = Math.min(0.05, (t - (cam.last || t)) / 1000);
      cam.last = t;
      let busy = false;

      if (cam.glide) {
        panPx(-cam.vx * dt, -cam.vy * dt);
        const damp = Math.exp(-dt / (outOfBounds() ? 0.08 : 0.34));
        cam.vx *= damp;
        cam.vy *= damp;
        if (Math.hypot(cam.vx, cam.vy) < 12) {
          cam.glide = false;
          vp.applyConstraints(this.state.reducedMotion);
        } else {
          busy = true;
        }
      }

      if (cam.zoomTo !== null) {
        const z = vp.getZoom(true);
        const nz = z * Math.pow(cam.zoomTo / z, 1 - Math.exp(-dt / 0.085));
        vp.zoomTo(nz, cam.zoomAt ?? undefined, true);
        if (Math.abs(Math.log(cam.zoomTo / Math.max(1e-6, nz))) < 0.002) {
          vp.zoomTo(cam.zoomTo, cam.zoomAt ?? undefined, true);
          cam.zoomTo = null;
          cam.zoomAt = null;
          vp.applyConstraints(this.state.reducedMotion);
        } else {
          busy = true;
        }
      }

      if (busy) {
        runLoop();
      } else {
        cam.last = 0;
      }
    };

    const zoomStep = (factor: number, pixel: OpenSeadragon.Point) => {
      const vp = this.osd.viewport;
      if (!vp) return;
      cam.glide = false;
      const base = cam.zoomTo ?? vp.getZoom(true);
      const target = clampZoom(base * factor);
      const refPt = vp.pointFromPixel(pixel, true);
      if (this.state.reducedMotion) {
        cam.zoomTo = null;
        vp.zoomTo(target, refPt, true);
        vp.applyConstraints(true);
        return;
      }
      cam.zoomTo = target;
      cam.zoomAt = refPt;
      cam.last = 0;
      runLoop();
    };
    this.zoomStepFn = zoomStep;

    const pushSample = (dx: number, dy: number) => {
      const now = performance.now();
      cam.samples.push({ t: now, dx, dy });
      while (cam.samples.length > 0 && now - cam.samples[0]!.t > 90) {
        cam.samples.shift();
      }
    };

    const startGlideFromSamples = () => {
      const vp = this.osd.viewport;
      const now = performance.now();
      const recent = cam.samples.filter((s) => now - s.t < 90);
      cam.samples = [];
      if (!this.state.reducedMotion && recent.length >= 2) {
        const spanSec = Math.max(16, now - recent[0]!.t) / 1000;
        let vx = recent.reduce((acc, s) => acc + s.dx, 0) / spanSec;
        let vy = recent.reduce((acc, s) => acc + s.dy, 0) / spanSec;
        const speed = Math.hypot(vx, vy);
        if (speed > 4200) {
          vx *= 4200 / speed;
          vy *= 4200 / speed;
        }
        if (speed > 60) {
          cam.vx = vx;
          cam.vy = vy;
          cam.glide = true;
          cam.last = 0;
          runLoop();
          return;
        }
      }
      vp?.applyConstraints(this.state.reducedMotion);
    };

    const isUiChrome = (target: EventTarget | null): boolean =>
      target instanceof Element && Boolean(target.closest(UI_CHROME_SELECTOR));

    // Prevent iOS Safari native pinch-zoom from fighting the viewer
    const onGestureBlock = (ev: Event) => {
      if (isUiChrome(ev.target)) return;
      ev.preventDefault();
    };
    this.inputRoot.addEventListener("gesturestart", onGestureBlock, { passive: false });
    this.inputRoot.addEventListener("gesturechange", onGestureBlock, { passive: false });
    this.inputRoot.addEventListener("gestureend", onGestureBlock, { passive: false });

    // Direct touch pan + non-inverted pinch controller (also supports dragging from map labels)
    let touchMode: "none" | "pan" | "pinch" = "none";
    let wasPinching = false;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let startTouchX = 0;
    let startTouchY = 0;
    let touchTotalMove = 0;
    let lastPinchDist = 0;
    let lastPinchMidX = 0;
    let lastPinchMidY = 0;
    let lastTapAt = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let touchLabelTarget: HTMLButtonElement | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (isUiChrome(e.target)) return;
      if (e.cancelable) e.preventDefault();
      stopPhysics();
      cam.samples = [];
      this.callbacks.onUserInteract?.();

      const labelBtn =
        e.target instanceof Element
          ? e.target.closest<HTMLButtonElement>(PIN_SELECTOR)
          : null;

      if (e.touches.length === 1) {
        const t = e.touches[0]!;
        touchMode = "pan";
        wasPinching = false;
        touchLabelTarget = labelBtn;
        lastTouchX = startTouchX = t.clientX;
        lastTouchY = startTouchY = t.clientY;
        touchTotalMove = 0;
      } else if (e.touches.length >= 2) {
        const t0 = e.touches[0]!;
        const t1 = e.touches[1]!;
        touchMode = "pinch";
        wasPinching = true;
        touchLabelTarget = null;
        lastPinchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        lastPinchMidX = (t0.clientX + t1.clientX) * 0.5;
        lastPinchMidY = (t0.clientY + t1.clientY) * 0.5;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (touchMode === "none") return;
      if (e.cancelable) e.preventDefault();
      const vp = this.osd.viewport;
      if (!vp) return;

      if (e.touches.length >= 2) {
        const t0 = e.touches[0]!;
        const t1 = e.touches[1]!;
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const midX = (t0.clientX + t1.clientX) * 0.5;
        const midY = (t0.clientY + t1.clientY) * 0.5;

        if (touchMode !== "pinch") {
          touchMode = "pinch";
          wasPinching = true;
          lastPinchDist = dist;
          lastPinchMidX = midX;
          lastPinchMidY = midY;
          return;
        }

        const dx = midX - lastPinchMidX;
        const dy = midY - lastPinchMidY;
        if (dx !== 0 || dy !== 0) {
          panPx(-dx, -dy);
        }

        const rect = this.osdElement.getBoundingClientRect();
        const refPt = vp.pointFromPixel(
          new OpenSeadragon.Point(midX - rect.left, midY - rect.top),
          true,
        );
        const nextZoom = computePinchZoom(
          vp.getZoom(true),
          lastPinchDist,
          dist,
          vp.getMinZoom(),
          vp.getMaxZoom(),
        );
        vp.zoomTo(nextZoom, refPt, true);

        lastPinchDist = dist;
        lastPinchMidX = midX;
        lastPinchMidY = midY;
      } else if (e.touches.length === 1) {
        const t = e.touches[0]!;
        if (touchMode !== "pan") {
          touchMode = "pan";
          lastTouchX = t.clientX;
          lastTouchY = t.clientY;
          cam.samples = [];
          return;
        }
        const dx = t.clientX - lastTouchX;
        const dy = t.clientY - lastTouchY;
        touchTotalMove += Math.hypot(dx, dy);
        panPx(-dx, -dy);
        pushSample(dx, dy);
        lastTouchX = t.clientX;
        lastTouchY = t.clientY;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (touchMode === "none") return;
      if (e.touches.length === 1) {
        const t = e.touches[0]!;
        touchMode = "pan";
        lastTouchX = t.clientX;
        lastTouchY = t.clientY;
        cam.samples = [];
        return;
      }
      if (e.touches.length === 0) {
        const isTap = !wasPinching && touchTotalMove < 10 && touchMode === "pan";
        const tappedBtn = touchLabelTarget;
        touchMode = "none";
        touchLabelTarget = null;
        if (isTap) {
          if (e.cancelable) e.preventDefault();
          if (tappedBtn && tappedBtn.isConnected) {
            tappedBtn.click();
            return;
          }
          const rect = this.osdElement.getBoundingClientRect();
          const pt = new OpenSeadragon.Point(startTouchX - rect.left, startTouchY - rect.top);
          const now = performance.now();
          if (
            now - lastTapAt < 280 &&
            Math.hypot(startTouchX - lastTapX, startTouchY - lastTapY) < 32
          ) {
            lastTapAt = 0;
            zoomStep(2, pt);
            return;
          }
          lastTapAt = now;
          lastTapX = startTouchX;
          lastTapY = startTouchY;
          this.handleClick(pt);
          return;
        }

        if (!wasPinching) {
          startGlideFromSamples();
        } else {
          this.osd.viewport?.applyConstraints(this.state.reducedMotion);
        }
        wasPinching = false;
      }
    };

    const onTouchCancel = () => {
      touchMode = "none";
      touchLabelTarget = null;
      wasPinching = false;
      cam.samples = [];
      this.osd.viewport?.applyConstraints(this.state.reducedMotion);
    };

    this.inputRoot.addEventListener("touchstart", onTouchStart, { passive: false });
    this.inputRoot.addEventListener("touchmove", onTouchMove, { passive: false });
    this.inputRoot.addEventListener("touchend", onTouchEnd, { passive: false });
    this.inputRoot.addEventListener("touchcancel", onTouchCancel, { passive: false });

    // Pointer drag + click + double-click for desktop/pen (OSD mouseNavEnabled=false keeps pointerdown unobstructed)
    let activePointerId: number | null = null;
    let mouseMoved = 0;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let lastClickAt = 0;
    let lastClickX = 0;
    let lastClickY = 0;
    let suppressNextLabelClick = false;
    let mouseStartedOnLabel = false;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (e.button !== 0 || isUiChrome(e.target)) return;
      activePointerId = e.pointerId;
      mouseMoved = 0;
      mouseStartedOnLabel =
        e.target instanceof Element && Boolean(e.target.closest(PIN_SELECTOR));
      if (!mouseStartedOnLabel) {
        e.preventDefault();
      }
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      stopPhysics();
      cam.samples = [];
      this.callbacks.onUserInteract?.();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (activePointerId === null || e.pointerId !== activePointerId) return;
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      mouseMoved += Math.hypot(dx, dy);
      if (mouseMoved >= 3) {
        this.inputRoot.classList.add("is-dragging");
      }
      panPx(-dx, -dy);
      pushSample(dx, dy);
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (activePointerId === null || e.pointerId !== activePointerId) return;
      activePointerId = null;
      this.inputRoot.classList.remove("is-dragging");
      const onLabel = mouseStartedOnLabel;
      mouseStartedOnLabel = false;
      if (mouseMoved < 6) {
        if (onLabel) {
          // Let native button click handle label selection
          return;
        }
        const rect = this.osdElement.getBoundingClientRect();
        const pt = new OpenSeadragon.Point(e.clientX - rect.left, e.clientY - rect.top);
        const now = performance.now();
        if (
          now - lastClickAt < 280 &&
          Math.hypot(e.clientX - lastClickX, e.clientY - lastClickY) < 8
        ) {
          lastClickAt = 0;
          zoomStep(e.shiftKey ? 0.5 : 2, pt);
          return;
        }
        lastClickAt = now;
        lastClickX = e.clientX;
        lastClickY = e.clientY;
        this.handleClick(pt);
        return;
      }
      if (onLabel) {
        suppressNextLabelClick = true;
        window.setTimeout(() => {
          suppressNextLabelClick = false;
        }, 80);
      }
      startGlideFromSamples();
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (activePointerId === null || e.pointerId !== activePointerId) return;
      activePointerId = null;
      this.inputRoot.classList.remove("is-dragging");
      mouseStartedOnLabel = false;
      cam.samples = [];
      this.osd.viewport?.applyConstraints(this.state.reducedMotion);
    };

    const onLabelCaptureClick = (e: MouseEvent) => {
      if (suppressNextLabelClick) {
        suppressNextLabelClick = false;
        e.preventDefault();
        e.stopPropagation();
      }
    };

    this.inputRoot.addEventListener("pointerdown", onPointerDown);
    this.inputRoot.addEventListener("click", onLabelCaptureClick, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);

    // Smooth wheel / trackpad zoom & shift-pan (bypasses OSD 50ms throttle)
    const applyWheel = () => {
      cam.wheelRaf = 0;
      const vp = this.osd.viewport;
      if (!vp) return;
      if (cam.wheelDx !== 0 || cam.wheelDy !== 0) {
        panPx(cam.wheelDx, cam.wheelDy);
      }
      if (cam.wheelZFactor !== 1 && cam.wheelAt) {
        const nextZoom = clampZoom(vp.getZoom(true) * cam.wheelZFactor);
        vp.zoomTo(nextZoom, vp.pointFromPixel(cam.wheelAt, true), true);
      }
      cam.wheelDx = 0;
      cam.wheelDy = 0;
      cam.wheelZFactor = 1;
      window.clearTimeout(cam.wheelSettleTimer);
      cam.wheelSettleTimer = window.setTimeout(() => {
        this.osd.viewport?.applyConstraints(this.state.reducedMotion);
      }, 180);
    };

    const onWheel = (ev: WheelEvent) => {
      if (isUiChrome(ev.target)) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.callbacks.onUserInteract?.();

      const rect = this.osdElement.getBoundingClientRect();
      const at = new OpenSeadragon.Point(ev.clientX - rect.left, ev.clientY - rect.top);
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
      const isMouseWheel =
        ev.deltaMode !== 0 ||
        (ev.deltaX === 0 && Math.abs(ev.deltaY) >= 40 && Number.isInteger(ev.deltaY));

      if (ev.ctrlKey) {
        stopPhysics();
        cam.wheelZFactor *= computeWheelZoomFactor(ev.deltaY, ev.deltaMode, true);
        cam.wheelAt = at;
      } else if (isMouseWheel) {
        const stepPow = -Math.sign(ev.deltaY) * Math.min(3, Math.abs(ev.deltaY * unit) / 100 || 1);
        zoomStep(Math.pow(1.45, stepPow), at);
        return;
      } else if (ev.shiftKey) {
        cam.glide = false;
        cam.wheelDx += -ev.deltaX * unit;
        cam.wheelDy += -ev.deltaY * unit;
      } else {
        stopPhysics();
        cam.wheelZFactor *= computeWheelZoomFactor(ev.deltaY, ev.deltaMode, false);
        cam.wheelAt = at;
      }

      if (!cam.wheelRaf) {
        cam.wheelRaf = window.requestAnimationFrame(applyWheel);
      }
    };

    this.inputRoot.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      this.zoomStepFn = null;
      this.inputRoot.classList.remove("is-dragging");
      if (cam.raf) window.cancelAnimationFrame(cam.raf);
      if (cam.wheelRaf) window.cancelAnimationFrame(cam.wheelRaf);
      window.clearTimeout(cam.wheelSettleTimer);
      this.inputRoot.removeEventListener("gesturestart", onGestureBlock);
      this.inputRoot.removeEventListener("gesturechange", onGestureBlock);
      this.inputRoot.removeEventListener("gestureend", onGestureBlock);
      this.inputRoot.removeEventListener("touchstart", onTouchStart);
      this.inputRoot.removeEventListener("touchmove", onTouchMove);
      this.inputRoot.removeEventListener("touchend", onTouchEnd);
      this.inputRoot.removeEventListener("touchcancel", onTouchCancel);
      this.inputRoot.removeEventListener("pointerdown", onPointerDown);
      this.inputRoot.removeEventListener("click", onLabelCaptureClick, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      this.inputRoot.removeEventListener("wheel", onWheel);
    };
  }

  private updateViewportMinZoom(applyBounds = true): void {
    const vp = this.osd.viewport;
    if (!vp) return;
    const rect = this.osdElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const minZoom = computeFullMapMinZoom(this.camera, rect.width, rect.height);
    const maxZoom = computeFullMapMaxZoom(this.camera, rect.width, rect.height);
    (vp as unknown as { minZoomLevel: number }).minZoomLevel = minZoom;
    (vp as unknown as { maxZoomLevel: number }).maxZoomLevel = maxZoom;
    if (applyBounds) {
      const z = vp.getZoom(true);
      if (z < minZoom) {
        vp.zoomTo(minZoom, undefined, true);
      } else if (z > maxZoom) {
        vp.zoomTo(maxZoom, undefined, true);
      }
    }
  }

  updateState(
    nextState: ViewerState,
    feedState: ResolvedFeedState | null,
    forceSkyRefresh = false,
  ): void {
    const prevSun = this.state.sunHourJst;
    const prevTheme = this.state.theme;
    this.state = nextState;
    this.feedState = feedState;

    if (nextState.variant !== this.currentVariant) {
      this.currentVariant = nextState.variant;
      const savedView = { ...nextState.cameraView };
      const dziUrl = `${this.bundle.baseReleaseUrl}/${this.bundle.release.variants[nextState.variant].dziPath}`;
      this.osd.addOnceHandler("open", () => {
        this.updateViewportMinZoom(false);
        this.applyCameraView(savedView, true);
        this.osd.viewport?.applyConstraints(true);
        this.renderOverlayFrame(true);
      });
      this.osd.open({ tileSource: dziUrl });
    }

    const lightingChanged =
      forceSkyRefresh || prevSun !== nextState.sunHourJst || prevTheme !== nextState.theme;
    this.renderOverlayFrame(false, lightingChanged);
  }

  panToLonLat(lon: number, lat: number, elevM: number, zoom?: number): void {
    const rect = this.osdElement.getBoundingClientRect();
    const targetZoom =
      zoom ??
      computeLandmarkZoom(
        this.camera,
        rect.width > 0 ? rect.width : window.innerWidth,
        rect.height > 0 ? rect.height : window.innerHeight,
      );
    const img = localToImage(this.camera, wgs84ToLocal(this.camera, lon, lat, elevM));
    this.applyCameraView(
      { centerImgX: img.px, centerImgY: img.py, zoom: targetZoom },
      this.state.reducedMotion,
    );
  }

  panToImagePx(imgX: number, imgY: number, immediately = false): void {
    if (!this.osd.viewport) return;
    const vpPoint = this.osd.viewport.imageToViewportCoordinates(
      Math.max(0, Math.min(this.camera.imageWidthPx, imgX)),
      Math.max(0, Math.min(this.camera.imageHeightPx, imgY)),
    );
    this.osd.viewport.panTo(vpPoint, immediately || this.state.reducedMotion);
    if (immediately) {
      this.osd.viewport.applyConstraints(true);
    }
  }

  resetView(): void {
    const isFullMap = isFullYokohamaCamera(this.camera);
    const rect = this.osdElement.getBoundingClientRect();
    const vw = rect.width > 0 ? rect.width : window.innerWidth;
    const vh = rect.height > 0 ? rect.height : window.innerHeight;
    this.applyCameraView(
      {
        centerImgX: isFullMap ? RED_BRICK_CENTER_IMG.x : this.camera.imageWidthPx * 0.66,
        centerImgY: isFullMap ? RED_BRICK_CENTER_IMG.y : this.camera.imageHeightPx * 0.59,
        zoom: isFullMap ? computeDefaultFullMapZoom(this.camera, vw, vh) : 2.25,
      },
      this.state.reducedMotion,
    );
  }

  getViewportInfo(): ViewportImageBounds | null {
    if (!this.osd.viewport) return null;
    const bounds = this.getViewportImageBounds();
    if (!bounds) return null;
    return {
      topLeft: bounds.topLeft,
      bottomRight: bounds.bottomRight,
      widthCssPx: bounds.cssWidth,
      heightCssPx: bounds.cssHeight,
      zoom: this.osd.viewport.getZoom(true),
    };
  }

  zoomBy(factor: number): void {
    if (!this.osd.viewport) return;
    const rect = this.osdElement.getBoundingClientRect();
    if (this.zoomStepFn && rect.width > 0 && rect.height > 0) {
      this.zoomStepFn(
        factor,
        new OpenSeadragon.Point(rect.width * 0.5, rect.height * 0.5),
      );
      return;
    }
    this.osd.viewport.zoomBy(factor, undefined, this.state.reducedMotion);
    this.osd.viewport.applyConstraints(this.state.reducedMotion);
  }

  panByCssPx(dx: number, dy: number): void {
    if (!this.osd.viewport) return;
    const delta = this.osd.viewport.deltaPointsFromPixels(new OpenSeadragon.Point(dx, dy));
    this.osd.viewport.panBy(delta, this.state.reducedMotion);
    this.osd.viewport.applyConstraints(this.state.reducedMotion);
  }

  private applyCameraView(
    view: { centerImgX: number; centerImgY: number; zoom: number },
    immediately: boolean,
  ): void {
    if (!this.osd.viewport) return;
    const vpPoint = this.osd.viewport.imageToViewportCoordinates(view.centerImgX, view.centerImgY);
    this.osd.viewport.panTo(vpPoint, immediately);
    this.osd.viewport.zoomTo(view.zoom, undefined, immediately);
  }

  private syncCameraViewState(): void {
    if (!this.osd.viewport) return;
    const centerVp = this.osd.viewport.getCenter(true);
    const centerImg = this.osd.viewport.viewportToImageCoordinates(centerVp);
    const zoom = this.osd.viewport.getZoom(true);
    this.callbacks.onViewChanged(centerImg.x, centerImg.y, zoom);
  }

  private getViewportImageBounds(): {
    topLeft: { x: number; y: number };
    bottomRight: { x: number; y: number };
    cssWidth: number;
    cssHeight: number;
  } | null {
    if (!this.osd.viewport) return null;
    const rect = this.osdElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const tl = this.osd.viewport.viewerElementToImageCoordinates(new OpenSeadragon.Point(0, 0));
    const br = this.osd.viewport.viewerElementToImageCoordinates(
      new OpenSeadragon.Point(rect.width, rect.height),
    );
    return {
      topLeft: { x: tl.x, y: tl.y },
      bottomRight: { x: br.x, y: br.y },
      cssWidth: rect.width,
      cssHeight: rect.height,
    };
  }

  /**
   * Diagnostic measurement for Step 2 sync acceptance (<= 2 CSS px marker drift).
   */
  measureMaxMarkerDriftCssPx(): number {
    if (!this.osd.viewport) return 0;
    const bounds = this.getViewportImageBounds();
    if (!bounds) return 0;

    let maxDrift = 0;
    for (const gcp of this.bundle.gcps) {
      const img = localToImage(
        this.camera,
        wgs84ToLocal(this.camera, gcp.lon, gcp.lat, gcp.elevationM),
      );
      const osdPx = this.osd.viewport.imageToViewerElementCoordinates(
        new OpenSeadragon.Point(img.px, img.py),
      );
      const ndc = imagePxToNdc(img.px, img.py, bounds.topLeft, bounds.bottomRight);
      const glCssX = (ndc.x * 0.5 + 0.5) * bounds.cssWidth;
      const glCssY = (0.5 - ndc.y * 0.5) * bounds.cssHeight;
      const drift = Math.hypot(osdPx.x - glCssX, osdPx.y - glCssY);
      if (drift > maxDrift) maxDrift = drift;
    }
    return maxDrift;
  }

  renderOverlayFrame(immediateSky = false, updateSky = true): void {
    if (this.isDestroyed) return;
    const { grade } = this.computeCurrentSky();
    if (updateSky || immediateSky) {
      this.applySkyFilter(grade, immediateSky);
    }

    const bounds = this.getViewportImageBounds();
    if (!bounds) return;

    const selectedVehicleId =
      this.state.selected?.kind === "vehicle" ? this.state.selected.vehicle.entityId : null;
    const selectedPortCallId =
      this.state.selected?.kind === "portcall" ? this.state.selected.portCall.id : null;

    this.glOverlay.render({
      viewTopLeftImgPx: bounds.topLeft,
      viewBottomRightImgPx: bounds.bottomRight,
      viewportCssWidth: bounds.cssWidth,
      viewportCssHeight: bounds.cssHeight,
      glowTintRgba: grade.glowRgba,
      nightIntensity: grade.nightLights,
      vehicleBrightness: grade.vehicleBrightness,
      simTimeSec: this.state.simTimeSec,
      showDepthMap: this.state.showDepthMap,
      xrayOcclusion: this.state.xrayOcclusion,
      showTileGrid: this.state.showTileGrid,
      showGcps: this.state.showGcps,
      showDeckTestPoint: this.state.showDeckTestPoint,
      vehicles: this.state.showBuses ? (this.feedState?.vehicles ?? []) : [],
      selectedVehicleId,
      selectedPortCallId,
      gcps: this.bundle.gcps,
      deckTestPoint: this.bundle.deckTestPoint,
      portCalls: this.state.showBoats ? (this.feedState?.portCalls ?? []) : [],
    });
  }

  private handleClick(viewerPos: OpenSeadragon.Point): void {
    if (!this.osd.viewport) return;
    const imgPt = this.osd.viewport.viewerElementToImageCoordinates(viewerPos);

    // 1. Check vehicles first
    if (this.feedState && this.state.showBuses) {
      for (const rv of this.feedState.vehicles) {
        const vImg = localToImage(
          this.camera,
          wgs84ToLocal(this.camera, rv.record.lon, rv.record.lat, rv.record.roadElevationM + 1.5),
        );
        const vScreen = this.osd.viewport.imageToViewerElementCoordinates(
          new OpenSeadragon.Point(vImg.px, vImg.py),
        );
        if (Math.hypot(viewerPos.x - vScreen.x, viewerPos.y - vScreen.y) <= 28) {
          this.callbacks.onSelectVehicle(rv);
          return;
        }
      }
    }

    // 2. Check scheduled port calls & harbor vessels
    if (this.feedState && this.state.showBoats) {
      for (const pc of this.feedState.portCalls) {
        const pcImg = localToImage(
          this.camera,
          wgs84ToLocal(this.camera, pc.lon, pc.lat, (pc.heightM ?? 6) * 0.45),
        );
        const pcScreen = this.osd.viewport.imageToViewerElementCoordinates(
          new OpenSeadragon.Point(pcImg.px, pcImg.py),
        );
        const hitRadius = Math.max(24, Math.min(44, (pc.lengthM ?? 24) * 0.45));
        if (Math.hypot(viewerPos.x - pcScreen.x, viewerPos.y - pcScreen.y) <= hitRadius) {
          this.callbacks.onSelectPortCall(pc);
          return;
        }
      }
    }

    // 3. Pick static feature from lossless 24-bit surfaceId tile
    const fid = pickFeatureIdAtImagePx(this.bundle, imgPt.x, imgPt.y);
    if (fid !== null) {
      const lm = this.bundle.landmarks.find((l) => l.featureId === fid);
      if (lm) {
        this.callbacks.onSelectLandmark(lm);
        return;
      }
      const feat = this.bundle.featureById.get(fid);
      if (
        feat &&
        feat.featureId > 1 &&
        feat.surfaceKind !== SURFACE_KIND.WATER &&
        feat.surfaceKind !== SURFACE_KIND.GROUND
      ) {
        let lon = feat.lon;
        let lat = feat.lat;
        if (lon === undefined || lat === undefined) {
          const local = imageToLocalOnPlane(
            this.camera,
            imgPt.x,
            imgPt.y,
            Math.max(0, feat.heightM * 0.5),
          );
          const wgs = localToWgs84(this.camera, local);
          lon = wgs.lon;
          lat = wgs.lat;
        }
        this.callbacks.onSelectFeature(feat, lon, lat);
        return;
      }
    }

    this.callbacks.onClearSelection();
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.skyAnimRaf) window.cancelAnimationFrame(this.skyAnimRaf);
    this.cleanupInput();
    this.resizeObserver.disconnect();
    this.skyFilterSvg?.remove();
    this.osd.destroy();
  }
}
