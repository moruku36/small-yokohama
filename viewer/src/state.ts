import {
  computeYokohamaSun,
  type CameraManifest,
  type Landmark,
  type PoiRecord,
  type SceneFeatureRecord,
  type VehicleRecord,
} from "@small-yokohama/core";
import type { ResolvedTrain } from "./data/trainFeed.js";
import type { AnimatedPortCall } from "./data/vehicleFeed.js";
import type { WeatherMode } from "./data/weatherFeed.js";
import type { Lang } from "./i18n.js";
import {
  RED_BRICK_CENTER_IMG,
  computeDefaultFullMapZoom,
  isFullYokohamaCamera,
} from "./viewer/cameraMath.js";
import {
  SKY_PRESETS,
  getSunDateForHourJst,
  isNightAltitude,
} from "./viewer/skyLighting.js";
import {
  cameraViewToGeoView,
  formatAtParam,
  geoViewToCameraView,
  parseAtParam,
} from "./viewer/geoView.js";

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
  | { kind: "train"; train: ResolvedTrain }
  | { kind: "landmark"; landmark: Landmark }
  | { kind: "poi"; poi: PoiRecord }
  | { kind: "feature"; feature: SceneFeatureRecord; lon: number; lat: number }
  | { kind: "portcall"; portCall: AnimatedPortCall }
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
  weatherMode: WeatherMode;
  showTrains: boolean;
  showBuses: boolean;
  showBoats: boolean;
  showTraffic: boolean;
  showPedestrians: boolean;
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
  /** Ambient harbour sound (off until the visitor turns it on: browsers block autoplay). */
  soundOn: boolean;
  /** Keep the camera on the selected bus, train or ship as it moves. */
  following: boolean;
  /** Play the drop-through-the-clouds opening (?intro=0 skips it). */
  introEnabled: boolean;
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
  viewport: { width: number; height: number } = { width: 1280, height: 800 },
  now = new Date(),
): ViewerState {
  const params = new URLSearchParams(search);
  const langParam = params.get("lang");
  const lang: Lang = langParam === "en" ? "en" : "ja";

  const themeParam = params.get("theme") as UiTheme | null;
  const explicitTheme: UiTheme | null =
    themeParam && VALID_THEMES.has(themeParam) ? themeParam : null;

  const varParam = params.get("v") as MapVariant | null;
  const variant: MapVariant = varParam && VALID_VARIANTS.has(varParam) ? varParam : "illustrated";

  const feedParam = params.get("m") as FeedPreset | null;
  const feedPreset: FeedPreset =
    feedParam && VALID_FEEDS.has(feedParam) ? feedParam : "synthetic";

  const rawX = Number(params.get("x"));
  const rawY = Number(params.get("y"));
  const rawZ = Number(params.get("z"));
  const rawHour = params.get("sun");

  const isFullMap = isFullYokohamaCamera(camera);
  const defaultCenterX = isFullMap ? RED_BRICK_CENTER_IMG.x : camera.imageWidthPx * 0.66;
  const defaultCenterY = isFullMap ? RED_BRICK_CENTER_IMG.y : camera.imageHeightPx * 0.59;
  const minZoom = isFullMap ? 0.35 : 0.6;
  const maxZoom = isFullMap ? 96 : 16;

  // ?at=lat,lon,650m (geographic, as Small SF shares views) wins over the older ?x=&y=&z= image coordinates
  const geo = parseAtParam(params.get("at"));
  const geoView = geo ? geoViewToCameraView(camera, geo) : null;

  const centerImgX = geoView
    ? geoView.centerImgX
    : params.has("x")
      ? clampNumber(rawX, 0, camera.imageWidthPx)
      : defaultCenterX;
  const centerImgY = geoView
    ? geoView.centerImgY
    : params.has("y")
      ? clampNumber(rawY, 0, camera.imageHeightPx)
      : defaultCenterY;
  const zoom = geoView
    ? clampNumber(geoView.zoom, minZoom, maxZoom)
    : params.has("z")
      ? clampNumber(rawZ, minZoom, maxZoom)
      : computeDefaultFullMapZoom(camera, viewport.width, viewport.height);

  let sunHourJst: number | null;
  if (rawHour === "live") {
    sunHourJst = null;
  } else if (rawHour !== null && rawHour.trim() !== "" && Number.isFinite(Number(rawHour))) {
    sunHourJst = clampNumber(Number(rawHour), 0, 23.75);
  } else if (explicitTheme === "dark") {
    sunHourJst = SKY_PRESETS.night;
  } else if (explicitTheme === "light") {
    sunHourJst = SKY_PRESETS.day;
  } else {
    sunHourJst = null;
  }

  const wParam = params.get("weather");
  const weatherMode: WeatherMode =
    wParam === "rain" || wParam === "clear" ? wParam : "live";

  const theme: UiTheme =
    explicitTheme ??
    (isNightAltitude(computeYokohamaSun(getSunDateForHourJst(sunHourJst, now)).altitudeDeg)
      ? "dark"
      : "light");

  return {
    lang,
    theme,
    variant,
    feedPreset,
    liveEndpoint: params.get("liveUrl") ?? "/api/snapshot.json",
    playing: !prefersReducedMotion,
    simTimeSec: 0,
    sunHourJst,
    weatherMode,
    showTrains: params.get("trains") !== "0",
    showBuses: params.get("buses") !== "0",
    showBoats: params.get("boats") !== "0",
    showTraffic: params.get("cars") !== "0",
    showPedestrians: params.get("people") !== "0",
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
    soundOn: false,
    following: false,
    introEnabled: params.get("intro") !== "0" && !prefersReducedMotion,
    selected: null,
    cameraView: {
      centerImgX,
      centerImgY,
      zoom,
    },
  };
}

/**
 * A link to the current view. Like Small SF it leads with `at=lat,lon,<metres across>m`
 * (when the camera is known) and leaves out what is still at its default, so a plain shared
 * view is a short, readable URL.
 */
export function serializeShareUrl(
  state: ViewerState,
  baseHref: string,
  camera?: CameraManifest,
): string {
  const url = new URL(baseHref);
  const p = new URLSearchParams();
  if (camera) {
    p.set("at", formatAtParam(cameraViewToGeoView(camera, state.cameraView)));
  } else {
    p.set("x", state.cameraView.centerImgX.toFixed(1));
    p.set("y", state.cameraView.centerImgY.toFixed(1));
    p.set("z", state.cameraView.zoom.toFixed(2));
  }
  if (state.lang !== "ja") p.set("lang", state.lang);
  if (state.variant !== "illustrated") p.set("v", state.variant);
  if (state.feedPreset !== "synthetic") p.set("m", state.feedPreset);
  if (state.sunHourJst !== null) p.set("sun", state.sunHourJst.toFixed(2));
  // the theme follows the sun unless the visitor picked the other one
  {
    const sunAlt = computeYokohamaSun(getSunDateForHourJst(state.sunHourJst)).altitudeDeg;
    const autoTheme: UiTheme = isNightAltitude(sunAlt) ? "dark" : "light";
    if (state.theme !== autoTheme || state.sunHourJst !== null) p.set("theme", state.theme);
  }
  if (state.weatherMode !== "live") p.set("weather", state.weatherMode);
  if (!state.showTrains) p.set("trains", "0");
  if (!state.showBuses) p.set("buses", "0");
  if (!state.showBoats) p.set("boats", "0");
  if (!state.showTraffic) p.set("cars", "0");
  if (!state.showPedestrians) p.set("people", "0");
  if (!state.showLabels) p.set("labels", "0");
  if (state.showDepthMap) p.set("depth", "1");
  if (state.xrayOcclusion) p.set("xray", "1");
  if (state.showTileGrid) p.set("grid", "1");
  if (state.showGcps) p.set("gcp", "1");
  if (state.showDeckTestPoint) p.set("deck", "1");
  // commas need no escaping in a query string: keep at=35.45,139.64,650m readable
  url.search = p.toString().replace(/%2C/gi, ",");
  return url.toString();
}
