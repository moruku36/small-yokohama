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
  type PortCallRecord,
  type SceneFeatureRecord,
} from "@small-yokohama/core";
import { pickFeatureIdAtImagePx, type LoadedReleaseBundle } from "../data/releaseLoader.js";
import type { ResolvedFeedState, ResolvedVehicle } from "../data/vehicleFeed.js";
import type { MapVariant, ViewerState } from "../state.js";
import type { ViewportImageBounds } from "../ui/LabelLayer.js";
import { WebGLOverlay } from "./WebGLOverlay.js";
import {
  RED_BRICK_CENTER_IMG,
  computeDefaultFullMapZoom,
  computeFullMapMinZoom,
  computeLandmarkZoom,
  computePinchZoom,
  computeWheelZoomFactor,
  isFullYokohamaCamera,
} from "./cameraMath.js";

export interface MapViewerCallbacks {
  onSelectVehicle: (rv: ResolvedVehicle) => void;
  onSelectLandmark: (lm: Landmark) => void;
  onSelectFeature: (feat: SceneFeatureRecord, lon: number, lat: number) => void;
  onSelectPortCall: (pc: PortCallRecord) => void;
  onClearSelection: () => void;
  onViewChanged: (centerImgX: number, centerImgY: number, zoom: number) => void;
  onTogglePlay: () => void;
  onUserInteract?: () => void;
}

export class MapViewer {
  private readonly osd: OpenSeadragon.Viewer;
  private readonly glOverlay: WebGLOverlay;
  private readonly camera: CameraManifest;
  private currentVariant: MapVariant;
  private feedState: ResolvedFeedState | null = null;
  private resizeObserver: ResizeObserver;
  private cleanupInput: () => void = () => {};
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
    this.glOverlay = new WebGLOverlay(glCanvas, bundle.camera, bundle.depthTiles);

    const isFull = isFullYokohamaCamera(bundle.camera);
    const isMobile =
      typeof window !== "undefined" &&
      ((window.matchMedia?.("(pointer: coarse)").matches ?? false) || window.innerWidth <= 700);

    const dziUrl = `${bundle.baseReleaseUrl}/${bundle.release.variants[state.variant].dziPath}`;
    this.osd = OpenSeadragon({
      element: osdElement,
      tileSources: dziUrl,
      drawer: isMobile ? "canvas" : ["webgl", "canvas"],
      maxImageCacheCount: isMobile ? 60 : 200,
      imageLoaderLimit: isMobile ? 4 : 8,
      showNavigationControl: false,
      showNavigator: false,
      animationTime: state.reducedMotion ? 0 : 0.6,
      springStiffness: state.reducedMotion ? 100 : 9,
      minZoomImageRatio: isFull ? 0.96 : 0.55,
      maxZoomPixelRatio: isFull ? 2.5 : 6,
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
      this.renderOverlayFrame();
    });

    const syncHandler = () => {
      this.syncCameraViewState();
      this.renderOverlayFrame();
    };
    this.osd.addHandler("update-viewport", syncHandler);
    this.osd.addHandler("animation", syncHandler);
    this.osd.addHandler("resize", () => {
      this.updateViewportMinZoom(true);
      syncHandler();
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.updateViewportMinZoom(true);
      this.renderOverlayFrame();
    });
    this.resizeObserver.observe(osdElement);

    this.cleanupInput = this.installDirectInputController();
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

    // Prevent iOS Safari native pinch-zoom from fighting the viewer
    const onGestureBlock = (ev: Event) => {
      ev.preventDefault();
    };
    this.osdElement.addEventListener("gesturestart", onGestureBlock, { passive: false });
    this.osdElement.addEventListener("gesturechange", onGestureBlock, { passive: false });
    this.osdElement.addEventListener("gestureend", onGestureBlock, { passive: false });

    // Direct touch pan + non-inverted pinch controller
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

    const onTouchStart = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      stopPhysics();
      cam.samples = [];
      this.callbacks.onUserInteract?.();

      if (e.touches.length === 1) {
        const t = e.touches[0]!;
        touchMode = "pan";
        wasPinching = false;
        lastTouchX = startTouchX = t.clientX;
        lastTouchY = startTouchY = t.clientY;
        touchTotalMove = 0;
      } else if (e.touches.length >= 2) {
        const t0 = e.touches[0]!;
        const t1 = e.touches[1]!;
        touchMode = "pinch";
        wasPinching = true;
        lastPinchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        lastPinchMidX = (t0.clientX + t1.clientX) * 0.5;
        lastPinchMidY = (t0.clientY + t1.clientY) * 0.5;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
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
        touchMode = "none";
        if (isTap) {
          if (e.cancelable) e.preventDefault();
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
      wasPinching = false;
      cam.samples = [];
      this.osd.viewport?.applyConstraints(this.state.reducedMotion);
    };

    this.osdElement.addEventListener("touchstart", onTouchStart, { passive: false });
    this.osdElement.addEventListener("touchmove", onTouchMove, { passive: false });
    this.osdElement.addEventListener("touchend", onTouchEnd, { passive: false });
    this.osdElement.addEventListener("touchcancel", onTouchCancel, { passive: false });

    // Mouse drag + click + double-click
    let mouseDown = false;
    let mouseMoved = 0;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let lastClickAt = 0;
    let lastClickX = 0;
    let lastClickY = 0;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      mouseDown = true;
      mouseMoved = 0;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      stopPhysics();
      cam.samples = [];
      this.callbacks.onUserInteract?.();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!mouseDown) return;
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      mouseMoved += Math.hypot(dx, dy);
      panPx(-dx, -dy);
      pushSample(dx, dy);
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!mouseDown) return;
      mouseDown = false;
      if (mouseMoved < 6) {
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
      startGlideFromSamples();
    };

    this.osdElement.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

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

    this.osdElement.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      if (cam.raf) window.cancelAnimationFrame(cam.raf);
      if (cam.wheelRaf) window.cancelAnimationFrame(cam.wheelRaf);
      window.clearTimeout(cam.wheelSettleTimer);
      this.osdElement.removeEventListener("gesturestart", onGestureBlock);
      this.osdElement.removeEventListener("gesturechange", onGestureBlock);
      this.osdElement.removeEventListener("gestureend", onGestureBlock);
      this.osdElement.removeEventListener("touchstart", onTouchStart);
      this.osdElement.removeEventListener("touchmove", onTouchMove);
      this.osdElement.removeEventListener("touchend", onTouchEnd);
      this.osdElement.removeEventListener("touchcancel", onTouchCancel);
      this.osdElement.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      this.osdElement.removeEventListener("wheel", onWheel);
    };
  }

  private updateViewportMinZoom(applyBounds = true): void {
    const vp = this.osd.viewport;
    if (!vp) return;
    const rect = this.osdElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const minZoom = computeFullMapMinZoom(this.camera, rect.width, rect.height);
    (vp as unknown as { minZoomLevel: number }).minZoomLevel = minZoom;
    if (applyBounds && vp.getZoom(true) < minZoom) {
      vp.zoomTo(minZoom, undefined, true);
    }
  }

  updateState(nextState: ViewerState, feedState: ResolvedFeedState | null): void {
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
        this.renderOverlayFrame();
      });
      this.osd.open({ tileSource: dziUrl });
    }

    this.renderOverlayFrame();
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
    this.applyCameraView({ centerImgX: img.px, centerImgY: img.py, zoom: targetZoom }, this.state.reducedMotion);
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

  renderOverlayFrame(): void {
    if (this.isDestroyed) return;
    const bounds = this.getViewportImageBounds();
    if (!bounds) return;

    const nowDate =
      this.state.sunHourJst === null
        ? new Date()
        : (() => {
            const h = Math.floor(this.state.sunHourJst);
            const m = Math.round((this.state.sunHourJst - h) * 60);
            // Convert JST (UTC+9) to UTC
            return new Date(Date.UTC(2026, 10, 24, h - 9, m, 0));
          })();

    const sun = computeYokohamaSun(nowDate);
    const selectedVehicleId =
      this.state.selected?.kind === "vehicle" ? this.state.selected.vehicle.entityId : null;

    this.glOverlay.render({
      viewTopLeftImgPx: bounds.topLeft,
      viewBottomRightImgPx: bounds.bottomRight,
      viewportCssWidth: bounds.cssWidth,
      viewportCssHeight: bounds.cssHeight,
      sunTintRgba: sun.overlayRgba,
      showDepthMap: this.state.showDepthMap,
      xrayOcclusion: this.state.xrayOcclusion,
      showTileGrid: this.state.showTileGrid,
      showGcps: this.state.showGcps,
      showDeckTestPoint: this.state.showDeckTestPoint,
      vehicles: this.state.showBuses ? (this.feedState?.vehicles ?? []) : [],
      selectedVehicleId,
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

    // 2. Check scheduled port calls
    if (this.feedState && this.state.showBoats) {
      for (const pc of this.feedState.portCalls) {
        const pcImg = localToImage(
          this.camera,
          wgs84ToLocal(this.camera, pc.lon, pc.lat, 3.5),
        );
        const pcScreen = this.osd.viewport.imageToViewerElementCoordinates(
          new OpenSeadragon.Point(pcImg.px, pcImg.py),
        );
        if (Math.hypot(viewerPos.x - pcScreen.x, viewerPos.y - pcScreen.y) <= 20) {
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
    this.cleanupInput();
    this.resizeObserver.disconnect();
    this.osd.destroy();
  }
}
