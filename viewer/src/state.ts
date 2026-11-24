import type {
  CameraManifest,
  Landmark,
  PoiRecord,
  PortCallRecord,
  SceneFeatureRecord,
  VehicleRecord,
} from "@small-yokohama/core";
import type { Lang } from "./i18n.js";

export type MapVariant = "illustrated" | "plain";
export type UiTheme = "light" | "dark";
export type DropTab = "search" | "places" | "layers" | null;
export type FeedPreset =
  | "synthetic"
  | "scheduled"
  | "stale"
  | "missing-time"
  | "outage"
  | "live";

export type SelectedEntity =
  | { kind: "vehicle"; vehicle: VehicleRecord; ageSec: number | null; status: string }
  | { kind: "landmark"; landmark: Landmark }
  | { kind: "poi"; poi: PoiRecord }
  | { kind: "feature"; feature: SceneFeatureRecord; lon: number; lat: number }
  | { kind: "portcall"; portCall: PortCallRecord }
  | null;

export interface ViewerState {
  lang: Lang;
  theme: UiTheme;
  variant: MapVariant;
  feedPreset: FeedPreset;
  liveEndpoint: string;
  playing: boolean;
  simTimeSec: number;
  sunHourJst: number | null;
  showBuses: boolean;
  showBoats: boolean;
  showLabels: boolean;
  showDepthMap: boolean;
  xrayOcclusion: boolean;
  showTileGrid: boolean;
  showGcps: boolean;
  showDeckTestPoint: boolean;
  reducedMotion: boolean;
  activeTab: DropTab;
  searchQuery: string;
  tvMode: boolean;
  aboutOpen: boolean;
  selected: SelectedEntity;
  cameraView: {
    centerImgX: number;
    centerImgY: number;
    zoom: number;
  };
}

const VALID_VARIANTS = new Set<MapVariant>(["illustrated", "plain"]);
const VALID_THEMES = new Set<UiTheme>(["light", "dark"]);
const VALID_FEEDS = new Set<FeedPreset>([
  "synthetic",
  "scheduled",
  "stale",
  "missing-time",
  "outage",
  "live",
]);

export function clampNumber(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function createInitialViewerState(
  camera: CameraManifest,
  search: string,
  prefersReducedMotion = false,
): ViewerState {
  const params = new URLSearchParams(search);
  const langParam = params.get("lang");
  const lang: Lang = langParam === "en" ? "en" : "ja";

  const themeParam = params.get("theme") as UiTheme | null;
  const theme: UiTheme = themeParam && VALID_THEMES.has(themeParam) ? themeParam : "light";

  const varParam = params.get("v") as MapVariant | null;
  const variant: MapVariant = varParam && VALID_VARIANTS.has(varParam) ? varParam : "illustrated";

  const feedParam = params.get("m") as FeedPreset | null;
  const feedPreset: FeedPreset =
    feedParam && VALID_FEEDS.has(feedParam) ? feedParam : "synthetic";

  const rawX = Number(params.get("x"));
  const rawY = Number(params.get("y"));
  const rawZ = Number(params.get("z"));
  const rawHour = params.get("sun");

  const centerImgX = params.has("x")
    ? clampNumber(rawX, 0, camera.imageWidthPx)
    : camera.imageWidthPx * 0.66;
  const centerImgY = params.has("y")
    ? clampNumber(rawY, 0, camera.imageHeightPx)
    : camera.imageHeightPx * 0.59;
  const zoom = params.has("z") ? clampNumber(rawZ, 0.6, 16) : 2.25;

  let sunHourJst: number | null = 15.5;
  if (rawHour === "live") {
    sunHourJst = null;
  } else if (rawHour !== null) {
    const parsedHour = Number(rawHour);
    if (Number.isFinite(parsedHour)) {
      sunHourJst = clampNumber(parsedHour, 0, 23.75);
    }
  }

  return {
    lang,
    theme,
    variant,
    feedPreset,
    liveEndpoint: params.get("liveUrl") ?? "/api/snapshot.json",
    playing: !prefersReducedMotion,
    simTimeSec: 0,
    sunHourJst,
    showBuses: params.get("buses") !== "0",
    showBoats: params.get("boats") !== "0",
    showLabels: params.get("labels") !== "0",
    showDepthMap: params.get("depth") === "1",
    xrayOcclusion: params.get("xray") === "1",
    showTileGrid: params.get("grid") === "1",
    showGcps: params.get("gcp") === "1",
    showDeckTestPoint: params.get("deck") === "1",
    reducedMotion: prefersReducedMotion,
    activeTab: null,
    searchQuery: "",
    tvMode: false,
    aboutOpen: false,
    selected: null,
    cameraView: {
      centerImgX,
      centerImgY,
      zoom,
    },
  };
}

export function serializeShareUrl(state: ViewerState, baseHref: string): string {
  const url = new URL(baseHref);
  const p = new URLSearchParams();
  p.set("lang", state.lang);
  p.set("theme", state.theme);
  p.set("v", state.variant);
  p.set("m", state.feedPreset);
  p.set("x", state.cameraView.centerImgX.toFixed(1));
  p.set("y", state.cameraView.centerImgY.toFixed(1));
  p.set("z", state.cameraView.zoom.toFixed(2));
  p.set("sun", state.sunHourJst === null ? "live" : state.sunHourJst.toFixed(2));
  if (!state.showBuses) p.set("buses", "0");
  if (!state.showBoats) p.set("boats", "0");
  if (!state.showLabels) p.set("labels", "0");
  if (state.showDepthMap) p.set("depth", "1");
  if (state.xrayOcclusion) p.set("xray", "1");
  if (state.showTileGrid) p.set("grid", "1");
  if (state.showGcps) p.set("gcp", "1");
  if (state.showDeckTestPoint) p.set("deck", "1");
  url.search = p.toString();
  return url.toString();
}
