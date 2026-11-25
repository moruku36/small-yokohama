import { computeYokohamaSun } from "@small-yokohama/core";
import type { LoadedReleaseBundle } from "../data/releaseLoader.js";
import type { MapVariant, ViewerState } from "../state.js";
import { computeSkyGrade, getSunDateForHourJst } from "../viewer/skyLighting.js";
import type { ViewportImageBounds } from "./LabelLayer.js";

const MINIMAP_WIDTH_PX = 208;

export function getMinimapTileUrl(
  bundle: LoadedReleaseBundle,
  variant: MapVariant,
): string {
  const { camera } = bundle;
  const maxDim = Math.max(camera.imageWidthPx, camera.imageHeightPx);
  const tileSize = Math.max(128, camera.dzi.tileSize || 512);
  const level = Math.max(
    0,
    Math.ceil(Math.log2(maxDim)) - Math.ceil(Math.log2(maxDim / tileSize)),
  );
  const ext = camera.dzi.format === "jpeg" ? "jpg" : camera.dzi.format;
  const dziPath = bundle.release.variants[variant].dziPath;
  const filesDir = dziPath.replace(/\.dzi$/i, "_files");
  return `${bundle.baseReleaseUrl}/${filesDir}/${level}/0_0.${ext}`;
}

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly cssW = MINIMAP_WIDTH_PX;
  private readonly cssH: number;
  private bgImg: HTMLImageElement | null = null;
  private loadedUrl = "";
  private dragging = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly bundle: LoadedReleaseBundle,
    private readonly onNavigateImgPx: (imgX: number, imgY: number, immediately: boolean) => void,
  ) {
    const cam = bundle.camera;
    this.cssH = Math.max(64, Math.round((this.cssW * cam.imageHeightPx) / cam.imageWidthPx));

    this.container.hidden = false;
    this.container.innerHTML = `<canvas width="${this.cssW * 2}" height="${this.cssH * 2}" style="width:${this.cssW}px;height:${this.cssH}px;display:block"></canvas>`;
    this.canvas = this.container.querySelector("canvas")!;
    this.ctx = this.canvas.getContext("2d");
    this.ctx?.scale(2, 2);

    const navigateFromEvent = (e: PointerEvent, immediately: boolean) => {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const v = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      this.onNavigateImgPx(u * cam.imageWidthPx, v * cam.imageHeightPx, immediately);
    };

    this.container.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.container.setPointerCapture?.(e.pointerId);
      navigateFromEvent(e, true);
    });
    this.container.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      navigateFromEvent(e, true);
    });
    const stopDrag = () => {
      this.dragging = false;
    };
    this.container.addEventListener("pointerup", stopDrag);
    this.container.addEventListener("pointercancel", stopDrag);
  }

  private ensureImage(url: string, onLoaded: () => void): void {
    if (this.loadedUrl === url) return;
    this.loadedUrl = url;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (this.loadedUrl === url) {
        this.bgImg = img;
        onLoaded();
      }
    };
    img.onerror = () => {
      if (this.loadedUrl === url) {
        this.bgImg = null;
      }
    };
    img.src = url;
  }

  render(state: ViewerState, bounds: ViewportImageBounds | null): void {
    if (!this.ctx) return;
    if (typeof window !== "undefined" && window.innerWidth <= 700) {
      return;
    }

    const url = getMinimapTileUrl(this.bundle, state.variant);
    this.ensureImage(url, () => this.render(state, bounds));

    const ctx = this.ctx;
    const w = this.cssW;
    const h = this.cssH;
    const cam = this.bundle.camera;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#1c5062";
    ctx.fillRect(0, 0, w, h);

    if (this.bgImg) {
      ctx.drawImage(this.bgImg, 0, 0, w, h);
    }

    // Match main map sky grading inside the overview minimap
    const sun = computeYokohamaSun(getSunDateForHourJst(state.sunHourJst));
    const grade = computeSkyGrade(sun.altitudeDeg);
    if (grade.multiplyOpacity > 0.01) {
      const [mr, mg, mb] = grade.multiplyCssRgb;
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = grade.multiplyOpacity;
      ctx.fillStyle = `rgb(${mr}, ${mg}, ${mb})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    if (!bounds) return;

    const x0 = Math.max(0, (bounds.topLeft.x / cam.imageWidthPx) * w);
    const y0 = Math.max(0, (bounds.topLeft.y / cam.imageHeightPx) * h);
    const x1 = Math.min(w, (bounds.bottomRight.x / cam.imageWidthPx) * w);
    const y1 = Math.min(h, (bounds.bottomRight.y / cam.imageHeightPx) * h);
    const rw = Math.max(5, x1 - x0);
    const rh = Math.max(4, y1 - y0);

    ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
    ctx.fillRect(x0, y0, rw, rh);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.8;
    ctx.strokeRect(x0, y0, rw, rh);
    ctx.strokeStyle = "rgba(20, 30, 36, 0.78)";
    ctx.lineWidth = 0.75;
    ctx.strokeRect(Math.max(0.5, x0 - 1), Math.max(0.5, y0 - 1), Math.min(w - 1, rw + 2), Math.min(h - 1, rh + 2));
  }
}
