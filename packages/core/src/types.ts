export type Vec3 = readonly [number, number, number];
export type Rgb = readonly [number, number, number];

export interface Epsg6677Coord {
  easting: number;
  northing: number;
}

export interface Wgs84Coord {
  lon: number;
  lat: number;
}

export type SurfaceKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface CameraBasis {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

export interface WorkingGridSpec {
  cols: number;
  rows: number;
  tileSizePx: number;
  overlapPx: number;
}

export interface DziSpec {
  tileSize: number;
  overlap: number;
  format: "png" | "webp" | "jpeg";
}

export interface DataTileGridSpec {
  tileSizePx: number;
  cols: number;
  rows: number;
}

export interface CameraManifest {
  schemaVersion: "1.0.0";
  epsg: "EPSG:6677";
  axisOrder: "easting-northing";
  originEpsg6677: Epsg6677Coord;
  centerLocalM: Vec3;
  azimuthDeg: number;
  depressionDeg: number;
  refDistanceM: number;
  cameraOriginLocalM: Vec3;
  basis: CameraBasis;
  metersPerPixel: number;
  nearM: number;
  farM: number;
  imageWidthPx: number;
  imageHeightPx: number;
  imageOriginPx: { x: number; y: number };
  workingGrid: WorkingGridSpec;
  dzi: DziSpec;
  dataTileGrid: DataTileGridSpec;
}

export interface ImagePoint {
  px: number;
  py: number;
  depthM: number;
}

export interface BilingualText {
  ja: string;
  en: string;
}

export interface CreditRecord {
  id: string;
  publisher: string;
  dataset: string;
  version: string;
  retrievedAt: string;
  license: string;
  redistribution: string;
  attributionText: string;
  modifications: string;
  url?: string;
}

export interface ReleasePointer {
  releaseId: string;
  manifestPath: string;
  updatedAt: string;
}

export interface ReleaseManifest {
  schemaVersion: "1.0.0";
  releaseId: string;
  createdAt: string;
  sceneSource: "documented-proxy" | "plateau-fy2024";
  sceneNotice: BilingualText;
  cameraPath: string;
  variants: {
    plain: { dziPath: string };
    illustrated: { dziPath: string };
  };
  layers: {
    depth: {
      tilePattern: string;
      encoding: "rgba8-rg16-depth-b-surfaceKind";
      nearM: number;
      farM: number;
    };
    surfaceId: {
      tilePattern: string;
      encoding: "rgba8-rgb24-featureId";
    };
    roadElevation: {
      decks: Record<
        string,
        {
          tilePattern: string;
          encoding: "rgba8-rg16-elevation";
          minM: number;
          maxM: number;
        }
      >;
    };
    waterMask: {
      encoding: string;
      surfaceKindValue: 1;
    };
  };
  featuresPath: string;
  landmarksPath: string;
  qaReportPath: string;
  credits: CreditRecord[];
}

export type VehicleMode = "observed" | "scheduled" | "synthetic" | "replay";
export type FeedHealth = "ok" | "no_service" | "no_match" | "outage";

export interface VehicleKeyframe {
  timeSec: number;
  lon: number;
  lat: number;
  bearingDeg: number;
  roadElevationM: number;
  deckId?: string;
  noteJa?: string;
  noteEn?: string;
}

export interface VehicleRecord {
  entityId: string;
  mode: VehicleMode;
  routeId: string;
  routeLabelJa: string;
  routeLabelEn: string;
  tripId: string | null;
  directionId: number | null;
  directionLabelJa: string;
  directionLabelEn: string;
  observedAt: string | null;
  fetchedAt: string;
  lon: number;
  lat: number;
  bearingDeg: number;
  speedMps: number;
  deckId: string;
  roadElevationM: number;
  lengthM: number;
  widthM: number;
  heightM: number;
  articulated: boolean;
  shapeProgress?: number | null;
  statusNote?: string | null;
}

export interface PortCallRecord {
  id: string;
  vesselNameJa: string;
  vesselNameEn: string;
  berthJa: string;
  berthEn: string;
  lon: number;
  lat: number;
  arrivalTime: string;
  departureTime: string;
  mode: "scheduled";
  source: string;
}

export interface VehicleSnapshot {
  schemaVersion: "1.0.0";
  generatedAt: string;
  fetchedAt: string;
  feedHealth: FeedHealth;
  feedMessage: BilingualText;
  source: {
    id: string;
    labelJa: string;
    labelEn: string;
    attribution: string;
  };
  vehicles: VehicleRecord[];
  replayDurationSec?: number;
  keyframes?: Record<string, VehicleKeyframe[]>;
  portCalls?: PortCallRecord[];
}

export type FreshnessStatus =
  | "fresh"
  | "stale"
  | "expired"
  | "missing_timestamp"
  | "non_observed";

export interface FreshnessEvaluation {
  status: FreshnessStatus;
  visible: boolean;
  frozen: boolean;
  ageSec: number | null;
  allowInterpolation: boolean;
}

export interface GroundControlPoint {
  id: string;
  featureId: number;
  labelJa: string;
  labelEn: string;
  lon: number;
  lat: number;
  elevationM: number;
  kind: string;
}

export interface Landmark {
  id: string;
  featureId: number;
  nameJa: string;
  nameEn: string;
  category: "landmark" | "bridge" | "pier" | "park" | "station";
  lon: number;
  lat: number;
  elevationM: number;
  descriptionJa: string;
  descriptionEn: string;
  sourceKind: "documented-proxy" | "plateau-fy2024" | "geojson-scope";
}

export interface SceneFeatureRecord {
  featureId: number;
  slug: string;
  nameJa: string;
  nameEn: string;
  surfaceKind: SurfaceKind;
  deckId?: string;
  heightM: number;
  source: string;
  notes: string;
}

export interface SceneTriangle {
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
  normal: Vec3;
  featureId: number;
  surfaceKind: SurfaceKind;
  plainRgb: Rgb;
  illustratedRgb: Rgb;
  deckId?: string;
  materialTag?: "water" | "brick" | "asphalt" | "deck" | "roof" | "park" | "concrete" | "quay";
}

export interface GcpCheckResult {
  id: string;
  labelJa: string;
  labelEn: string;
  expectedPx: number;
  expectedPy: number;
  observedPx: number;
  observedPy: number;
  displacementPx: number;
  featureId: number;
  matched: boolean;
  passed: boolean;
}

export interface SeamCheckResult {
  seamId: string;
  orientation: "vertical" | "horizontal";
  lengthPx: number;
  meanColorDiff: number;
  maxColorDiff: number;
  passed: boolean;
}

export interface QaReport {
  schemaVersion: "1.0.0";
  releaseId: string;
  generatedAt: string;
  gcpThresholdPx: number;
  maxGcpDisplacementPx: number;
  gcpChecks: GcpCheckResult[];
  seamChecks: SeamCheckResult[];
  waterIntegrity: {
    waterSamplePixels: number;
    inventedBuildingPixels: number;
    passed: boolean;
  };
  metrics: {
    renderMs: number;
    tileCount: number;
    totalOutputBytes: number;
    depthBytes: number;
    illustratedDziBytes: number;
    plainDziBytes: number;
  };
  passed: boolean;
}
