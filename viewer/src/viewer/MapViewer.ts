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

    const dziUrl = `${bundle.baseReleaseUrl}/${bundle.release.variants[state.variant].dziPath}`;
    this.osd = OpenSeadragon({
      element: osdElement,
      tileSources: dziUrl,
      showNavigationControl: false,
      showNavigator: false,
      animationTime: state.reducedMotion ? 0 : 0.75,
      springStiffness: state.reducedMotion ? 100 : 8.5,
      minZoomImageRatio: 0.55,
      maxZoomPixelRatio: 6,
      visibilityRatio: 0.65,
      constrainDuringPan: true,
      gestureSettingsMouse: {
        clickToZoom: false,
        dblClickToZoom: true,
      },
      gestureSettingsTouch: {
        pinchToZoom: true,
        dblClickToZoom: true,
      },
    });

    this.osd.addHandler("open", () => {
      this.applyCameraView(this.state.cameraView, true);
      this.renderOverlayFrame();
    });

    const syncHandler = () => {
      this.syncCameraViewState();
      this.renderOverlayFrame();
    };
    this.osd.addHandler("update-viewport", syncHandler);
    this.osd.addHandler("animation", syncHandler);
    this.osd.addHandler("resize", syncHandler);

    this.osd.addHandler("canvas-click", (evt) => {
      if (!evt.quick || !evt.position) return;
      this.callbacks.onUserInteract?.();
      this.handleClick(evt.position);
    });
    this.osd.addHandler("canvas-drag", () => {
      this.callbacks.onUserInteract?.();
    });
    this.osd.addHandler("canvas-scroll", () => {
      this.callbacks.onUserInteract?.();
    });
    this.osd.addHandler("canvas-pinch", () => {
      this.callbacks.onUserInteract?.();
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.renderOverlayFrame();
    });
    this.resizeObserver.observe(osdElement);
  }

  updateState(nextState: ViewerState, feedState: ResolvedFeedState | null): void {
    this.state = nextState;
    this.feedState = feedState;

    if (nextState.variant !== this.currentVariant) {
      this.currentVariant = nextState.variant;
      const savedView = { ...nextState.cameraView };
      const dziUrl = `${this.bundle.baseReleaseUrl}/${this.bundle.release.variants[nextState.variant].dziPath}`;
      this.osd.addOnceHandler("open", () => {
        this.applyCameraView(savedView, true);
        this.renderOverlayFrame();
      });
      this.osd.open({ tileSource: dziUrl });
    }

    this.renderOverlayFrame();
  }

  panToLonLat(lon: number, lat: number, elevM: number, zoom = 2.4): void {
    const img = localToImage(this.camera, wgs84ToLocal(this.camera, lon, lat, elevM));
    this.applyCameraView({ centerImgX: img.px, centerImgY: img.py, zoom }, this.state.reducedMotion);
  }

  resetView(): void {
    this.applyCameraView(
      {
        centerImgX: this.camera.imageWidthPx * 0.66,
        centerImgY: this.camera.imageHeightPx * 0.59,
        zoom: 2.25,
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
    this.resizeObserver.disconnect();
    this.osd.destroy();
  }
}
