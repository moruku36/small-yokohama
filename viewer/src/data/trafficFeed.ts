import { wgs84ToLocal, type CameraManifest } from "@small-yokohama/core";

export interface AmbientRoadEdge {
  oneway: boolean;
  lanes: number;
  hwRank: number;
  elevM: number;
  speedMps: number;
  totalDistM: number;
  minPx: number;
  maxPx: number;
  minPy: number;
  maxPy: number;
  entryBearing: number;
  exitBearing: number;
  cars: number;
  /** [cycleSec, phaseOffset, axis(0=NS|1=EW), kind(0=free|1=signal|2=stop)] */
  endSig: [number, number, number, number];
  /** Outgoing directed edge indices at toNode (sorted straightest first) */
  next: number[];
  /** Flattened triplets [lon, lat, distM, ...] */
  pts: number[];
}

export interface AmbientTrafficBundle {
  schemaVersion: string;
  edgeCount?: number;
  edges?: AmbientRoadEdge[];
  /** Legacy fallback if an older bundle is provided */
  segments?: Array<{
    oneway: boolean;
    elevM: number;
    speedMps: number;
    totalDistM: number;
    minPx: number;
    maxPx: number;
    minPy: number;
    maxPy: number;
    cars: number;
    pts: number[];
  }>;
}

export interface AmbientCarInstance {
  carId: number;
  lon: number;
  lat: number;
  elevM: number;
  bearingDeg: number;
  speedMps: number;
  signalState: "green" | "yellow" | "red";
  /** 0 = sedan, 1 = Yokohama taxi, 2 = white van, 3 = box truck, 4 = white autonomous sensor-pod car */
  kind: 0 | 1 | 2 | 3 | 4;
  colorIdx: number;
  braking: boolean;
}

export interface ResolvedRideAlongCar {
  carId: number;
  labelJa: string;
  labelEn: string;
  lon: number;
  lat: number;
  elevM: number;
  bearingDeg: number;
  speedKmh: number;
  braking: boolean;
  signalState: "green" | "yellow" | "red";
  districtJa: string;
  districtEn: string;
  statusJa: string;
  statusEn: string;
}

const D2R = Math.PI / 180;

export function resolveYokohamaDistrict(lon: number, lat: number): { ja: string; en: string } {
  if (lat >= 35.462 && lon <= 139.631) {
    return { ja: "横浜駅周辺", en: "Yokohama Station" };
  }
  if (lat >= 35.449 && lon > 139.638) {
    return { ja: "新港・赤レンガ倉庫", en: "Shinko & Red Brick" };
  }
  if (lat >= 35.451 && lon >= 139.626 && lon <= 139.638) {
    return { ja: "みなとみらい", en: "Minato Mirai" };
  }
  if (lat < 35.449 && lon >= 139.642) {
    return { ja: "山下公園・中華街", en: "Yamashita & Chinatown" };
  }
  if (lat < 35.451 && lon >= 139.632 && lon < 139.642) {
    return { ja: "関内・馬車道", en: "Kannai & Bashamichi" };
  }
  if (lat >= 35.446 && lon < 139.632) {
    return { ja: "野毛・桜木町", en: "Noge & Sakuragicho" };
  }
  return { ja: "横浜ベイエリア", en: "Yokohama Bay Area" };
}

export function computeTrafficDensityFactor(hourJst: number): number {
  const h = ((hourJst % 24) + 24) % 24;
  if (h >= 1 && h < 5) return 0.45;
  if (h >= 5 && h < 7.25) return 0.45 + ((h - 5) / 2.25) * 0.45;
  if (h >= 7.25 && h <= 9.25) return 1.0;
  if (h > 9.25 && h < 16.5) return 0.86;
  if (h >= 16.5 && h <= 19.75) return 1.0;
  if (h > 19.75 && h < 23) return 0.86 - ((h - 19.75) / 3.25) * 0.28;
  return h >= 23 ? 0.58 - ((h - 23) / 2) * 0.13 : 0.45;
}

function sampleEdgeAt(
  edge: AmbientRoadEdge,
  distM: number,
): { lon: number; lat: number; bearingDeg: number } {
  const pts = edge.pts;
  const n = Math.floor(pts.length / 3);
  if (n <= 0) return { lon: 139.638, lat: 35.452, bearingDeg: 0 };
  if (n === 1) return { lon: pts[0]!, lat: pts[1]!, bearingDeg: edge.entryBearing };

  const target = Math.max(0, Math.min(edge.totalDistM, distM));
  let idx = 0;
  for (let i = 0; i < n - 1; i++) {
    if (target <= pts[(i + 1) * 3 + 2]!) {
      idx = i;
      break;
    }
    idx = i;
  }

  const i0 = idx * 3;
  const i1 = Math.min(n - 1, idx + 1) * 3;
  const d0 = pts[i0 + 2]!;
  const d1 = pts[i1 + 2]!;
  const f = d1 - d0 > 1e-3 ? (target - d0) / (d1 - d0) : 0;

  const lon0 = pts[i0]!;
  const lat0 = pts[i0 + 1]!;
  const lon1 = pts[i1]!;
  const lat1 = pts[i1 + 1]!;

  const lon = lon0 + (lon1 - lon0) * f;
  const lat = lat0 + (lat1 - lat0) * f;

  const dLon = (lon1 - lon0) * Math.cos(lat * D2R);
  const dLat = lat1 - lat0;
  let bearing = (Math.atan2(dLon, dLat) * 180) / Math.PI;
  bearing = ((bearing % 360) + 360) % 360;

  return { lon, lat, bearingDeg: bearing };
}

function angleDiffDeg(a: number, b: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return Math.abs(d);
}

interface SimCar {
  id: number;
  edgeIdx: number;
  laneIdx: number;
  plannedNextIdx: number;
  distM: number;
  speedMps: number;
  speedScale: number;
  kind: 0 | 1 | 2 | 3 | 4;
  colorIdx: number;
  tier: number;
  braking: boolean;
  signalState: "green" | "yellow" | "red";
  waitSec: number;
}

function normalizeBundleEdges(bundle: AmbientTrafficBundle): AmbientRoadEdge[] {
  if (Array.isArray(bundle.edges) && bundle.edges.length > 0) {
    return bundle.edges;
  }
  const legacy = bundle.segments ?? [];
  const edges: AmbientRoadEdge[] = [];
  for (const s of legacy) {
    const n = Math.floor(s.pts.length / 3);
    if (n < 2) continue;
    const calcBearing = (i0: number, i1: number) => {
      const lon0 = s.pts[i0 * 3]!;
      const lat0 = s.pts[i0 * 3 + 1]!;
      const lon1 = s.pts[i1 * 3]!;
      const lat1 = s.pts[i1 * 3 + 1]!;
      return (
        ((Math.atan2((lon1 - lon0) * Math.cos(lat0 * D2R), lat1 - lat0) * 180) / Math.PI + 360) %
        360
      );
    };
    const makeOne = (rev: boolean) => {
      const pts: number[] = [];
      for (let i = 0; i < n; i++) {
        const src = rev ? n - 1 - i : i;
        const d = rev ? s.totalDistM - s.pts[src * 3 + 2]! : s.pts[src * 3 + 2]!;
        pts.push(s.pts[src * 3]!, s.pts[src * 3 + 1]!, d);
      }
      const eb = rev ? calcBearing(n - 1, n - 2) : calcBearing(0, 1);
      const xb = rev ? calcBearing(1, 0) : calcBearing(n - 2, n - 1);
      edges.push({
        oneway: s.oneway,
        lanes: 1,
        hwRank: 2,
        elevM: s.elevM,
        speedMps: s.speedMps,
        totalDistM: s.totalDistM,
        minPx: s.minPx,
        maxPx: s.maxPx,
        minPy: s.minPy,
        maxPy: s.maxPy,
        entryBearing: eb,
        exitBearing: xb,
        cars: s.cars,
        endSig: [0, 0, 0, 0],
        next: [],
        pts,
      });
    };
    makeOne(false);
    if (!s.oneway) makeOne(true);
  }
  return edges;
}

export class AmbientTrafficSimulator {
  readonly edges: AmbientRoadEdge[];
  private cars: SimCar[] = [];
  private carById = new Map<number, SimCar>();
  private laneBuckets: Map<number, SimCar[]> = new Map();
  private trackedCarId: number | null = null;
  private lastSimTimeSec = 0;

  constructor(bundle: AmbientTrafficBundle) {
    this.edges = normalizeBundleEdges(bundle);
    this.initFleet();
  }

  setTrackedCarId(carId: number | null): void {
    this.trackedCarId = carId;
  }

  private pickNextEdge(edgeIdx: number, seed: number): number {
    const e = this.edges[edgeIdx];
    if (!e || e.next.length === 0) return -1;
    if (e.next.length === 1) return e.next[0]!;
    // 72% straightest continuation, 28% turn onto alternate branch
    if (seed % 100 < 72) return e.next[0]!;
    return e.next[1 + (seed % (e.next.length - 1))]!;
  }

  private findClosestAdjacentEdge(fromEdgeIdx: number): number {
    const cur = this.edges[fromEdgeIdx];
    if (!cur || cur.pts.length < 3) return -1;
    const endLon = cur.pts[cur.pts.length - 3]!;
    const endLat = cur.pts[cur.pts.length - 2]!;
    let bestIdx = -1;
    let bestDist2 = Infinity;

    for (let i = 0; i < this.edges.length; i++) {
      if (i === fromEdgeIdx) continue;
      const cand = this.edges[i]!;
      if (cand.pts.length < 3 || cand.next.length === 0) continue;
      const dx = (cand.pts[0]! - endLon) * 90_600;
      const dy = (cand.pts[1]! - endLat) * 111_000;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  private pickKind(seed: number): 0 | 1 | 2 | 3 | 4 {
    const r = seed % 100;
    if (r < 7) return 4;  // ~7% white sensor-pod autonomous sedan
    if (r < 21) return 1; // ~14% Yokohama taxi
    if (r < 34) return 2; // ~13% white van
    if (r < 40) return 3; // ~6% compact box truck
    return 0;             // ~60% colorful sedans
  }

  private initFleet(): void {
    const spawned: SimCar[] = [];
    for (let ei = 0; ei < this.edges.length; ei++) {
      const e = this.edges[ei]!;
      const maxSlots = Math.max(1, Math.floor((e.totalDistM - 6) / 8.5));
      const perLane = Math.min(maxSlots, Math.max(1, e.cars));
      for (let lane = 0; lane < e.lanes; lane++) {
        for (let ci = 0; ci < perLane; ci++) {
          const seed = ((ei + 1) * 73856093 + lane * 19349663 + ci * 83492791) >>> 0;
          const slotFrac = (ci + 0.35 + ((seed % 31) / 31) * 0.45) / perLane;
          const distM = Math.max(2, Math.min(e.totalDistM - 3, slotFrac * e.totalDistM));
          spawned.push({
            id: spawned.length,
            edgeIdx: ei,
            laneIdx: lane,
            plannedNextIdx: this.pickNextEdge(ei, seed),
            distM,
            speedMps: e.speedMps * 0.85,
            speedScale: 0.88 + (seed % 19) * 0.014,
            kind: this.pickKind(seed >> 3),
            colorIdx: seed % 9,
            tier: ((ei * 37 + lane * 13 + ci * 59) % 100) / 100,
            braking: false,
            signalState: "green",
            waitSec: 0,
          });
        }
      }
    }

    // Put higher-rank arterial cars first so dense avenues stay prioritized if viewport hits maxCars
    spawned.sort((a, b) => {
      const ra = this.edges[a.edgeIdx]!.hwRank;
      const rb = this.edges[b.edgeIdx]!.hwRank;
      if (rb !== ra) return rb - ra;
      return a.id - b.id;
    });
    this.cars = spawned;
    this.carById = new Map(spawned.map((c) => [c.id, c]));
    this.lastSimTimeSec = 0;
  }

  private getSignalState(
    endSig: [number, number, number, number],
    simTimeSec: number,
  ): "green" | "yellow" | "red" {
    const [cycleSec, phaseOffset, axis, kind] = endSig;
    if (kind === 0 || cycleSec <= 0) return "green";
    const cyc = (((simTimeSec + phaseOffset) % cycleSec) + cycleSec) % cycleSec;
    const p = cyc / cycleSec;
    if (kind === 2) {
      // All-way stop alternating pulse
      const inWindow = axis === 0 ? p < 0.42 : p >= 0.5 && p < 0.92;
      return inWindow ? "green" : "red";
    }
    // Standard signal cycle: green -> yellow -> all-red clearance
    if (axis === 0) {
      if (p < 0.42) return "green";
      if (p < 0.48) return "yellow";
      return "red";
    }
    if (p >= 0.52 && p < 0.94) return "green";
    if (p >= 0.94 && p < 0.98) return "yellow";
    return "red";
  }

  private computeCarWorldPose(
    edge: AmbientRoadEdge,
    distM: number,
    laneIdx: number,
  ): { lon: number; lat: number; elevM: number; bearingDeg: number } {
    const sample = sampleEdgeAt(edge, distM);
    // Japan left-hand traffic lane offset (multi-lane boulevards & single-lane streets)
    let offsetRightM = 0;
    if (edge.oneway) {
      offsetRightM = edge.lanes > 1 ? (laneIdx === 0 ? -1.55 : 1.55) : 0;
    } else {
      offsetRightM = edge.lanes > 1 ? (laneIdx === 0 ? -1.75 : -4.65) : -1.85;
    }

    let lon = sample.lon;
    let lat = sample.lat;
    if (offsetRightM !== 0) {
      const rightRad = ((sample.bearingDeg + 90) * Math.PI) / 180;
      lon += (Math.sin(rightRad) * offsetRightM) / 90_600;
      lat += (Math.cos(rightRad) * offsetRightM) / 111_000;
    }

    return {
      lon,
      lat,
      elevM: edge.elevM,
      bearingDeg: sample.bearingDeg,
    };
  }

  private stepSingle(dtSec: number, simTimeSec: number, densityFactor: number): void {
    const dt = Math.min(0.25, Math.max(0.005, dtSec));

    for (const bucket of this.laneBuckets.values()) {
      bucket.length = 0;
    }

    const edgeMinDist = new Float32Array(this.edges.length * 2);
    edgeMinDist.fill(1e6);

    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i]!;
      if (car.tier > densityFactor && car.id !== this.trackedCarId) continue;
      const key = car.edgeIdx * 2 + car.laneIdx;
      let bucket = this.laneBuckets.get(key);
      if (!bucket) {
        bucket = [];
        this.laneBuckets.set(key, bucket);
      }
      bucket.push(car);
      if (car.distM < edgeMinDist[key]!) {
        edgeMinDist[key] = car.distM;
      }
    }

    for (const bucket of this.laneBuckets.values()) {
      if (bucket.length > 1) {
        bucket.sort((a, b) => b.distM - a.distM);
      }
      for (let i = 0; i < bucket.length; i++) {
        const car = bucket[i]!;
        const edge = this.edges[car.edgeIdx]!;
        const maxCruise = edge.speedMps * car.speedScale;
        let desiredSpeed = maxCruise;

        // 1. Lead-vehicle car-following headway
        if (i > 0) {
          const ahead = bucket[i - 1]!;
          const gap = ahead.distM - car.distM - 6.8;
          if (gap <= 0) {
            desiredSpeed = 0;
          } else if (gap < 22) {
            desiredSpeed = Math.min(desiredSpeed, Math.min(ahead.speedMps + 1.0, (gap / 22) * maxCruise));
          }
        }

        // 2. Intersection traffic light & all-way stop
        const sigState = this.getSignalState(edge.endSig, simTimeSec);
        car.signalState = sigState;
        const stopLine = Math.max(2, edge.totalDistM - 5.2);
        const distToStop = stopLine - car.distM;
        const mustStopAtSignal =
          sigState === "red" ||
          (sigState === "yellow" && distToStop > 5.0 && distToStop < 26);

        if (mustStopAtSignal && distToStop < 32 && car.distM < stopLine + 1.5) {
          if (distToStop <= 0.6) {
            desiredSpeed = 0;
          } else {
            desiredSpeed = Math.min(desiredSpeed, (distToStop / 24) * maxCruise);
          }
        } else if (car.plannedNextIdx >= 0 && edge.totalDistM - car.distM < 14) {
          // Slow gracefully into corners > 25 deg
          const nextE = this.edges[car.plannedNextIdx];
          if (nextE && angleDiffDeg(edge.exitBearing, nextE.entryBearing) > 25) {
            desiredSpeed = Math.min(desiredSpeed, 4.4);
          }
        }

        // Smooth acceleration / braking
        const accel = desiredSpeed > car.speedMps ? 3.2 : -6.0;
        const nextSpeed =
          desiredSpeed > car.speedMps
            ? Math.min(desiredSpeed, car.speedMps + accel * dt)
            : Math.max(desiredSpeed, car.speedMps + accel * dt);

        car.braking = nextSpeed < car.speedMps - 0.15 || nextSpeed < 0.7;
        car.speedMps = Math.max(0, nextSpeed);
        car.distM += car.speedMps * dt;

        // 3. Intersection transition or clean continuous street handoff
        if (car.distM >= edge.totalDistM) {
          const overflow = car.distM - edge.totalDistM;
          const nextIdx = car.plannedNextIdx;
          if (nextIdx >= 0) {
            const nextEdge = this.edges[nextIdx]!;
            const nextLane = Math.min(car.laneIdx, nextEdge.lanes - 1);
            const entryClear = edgeMinDist[nextIdx * 2 + nextLane]! > 7.5 || car.id === this.trackedCarId;
            if (entryClear) {
              car.edgeIdx = nextIdx;
              car.laneIdx = nextLane;
              car.distM = Math.min(nextEdge.totalDistM * 0.4, overflow);
              car.plannedNextIdx = this.pickNextEdge(nextIdx, car.id * 17 + Math.floor(simTimeSec));
              car.waitSec = 0;
              edgeMinDist[nextIdx * 2 + nextLane] = car.distM;
              continue;
            }
          }

          car.waitSec += dt;
          if (car.id === this.trackedCarId) {
            const nearbyIdx = this.findClosestAdjacentEdge(car.edgeIdx);
            if (nearbyIdx >= 0) {
              const nearEdge = this.edges[nearbyIdx]!;
              car.edgeIdx = nearbyIdx;
              car.laneIdx = Math.min(car.laneIdx, nearEdge.lanes - 1);
              car.distM = 1.5;
              car.plannedNextIdx = this.pickNextEdge(nearbyIdx, car.id * 29 + Math.floor(simTimeSec));
              car.waitSec = 0;
              continue;
            }
          } else if (nextIdx < 0 || car.waitSec > 8) {
            const altIdx = (car.edgeIdx + 29 + car.id * 7) % this.edges.length;
            const altEdge = this.edges[altIdx]!;
            const altLane = Math.min(car.laneIdx, altEdge.lanes - 1);
            if (edgeMinDist[altIdx * 2 + altLane]! > 9.0) {
              car.edgeIdx = altIdx;
              car.laneIdx = altLane;
              car.distM = 1.5;
              car.speedMps = altEdge.speedMps * 0.65;
              car.plannedNextIdx = this.pickNextEdge(altIdx, car.id + Math.floor(simTimeSec));
              car.waitSec = 0;
              edgeMinDist[altIdx * 2 + altLane] = 1.5;
              continue;
            }
          }
          car.distM = edge.totalDistM - 0.5;
          car.speedMps = 0;
          car.braking = true;
        }
      }
    }
  }

  advanceTo(simTimeSec: number, hourJst = 12): void {
    const density = computeTrafficDensityFactor(hourJst);
    if (simTimeSec < this.lastSimTimeSec - 0.01) {
      this.initFleet();
    }
    let delta = simTimeSec - this.lastSimTimeSec;
    if (delta <= 0) return;

    const maxStep = delta > 2.0 ? 0.25 : 0.1;
    let curT = this.lastSimTimeSec;
    while (delta > 1e-4) {
      const h = Math.min(maxStep, delta);
      curT += h;
      this.stepSingle(h, curT, density);
      delta -= h;
    }
    this.lastSimTimeSec = simTimeSec;
  }

  pickRideAlongCar(excludeCarId?: number | null): number | null {
    const candidates: SimCar[] = [];
    for (const car of this.cars) {
      if (car.kind !== 4 || car.id === excludeCarId) continue;
      const edge = this.edges[car.edgeIdx]!;
      if (edge.hwRank < 2 || edge.next.length === 0 || edge.pts.length < 3) continue;
      const lon = edge.pts[0]!;
      const lat = edge.pts[1]!;
      if (lon >= 139.62 && lon <= 139.654 && lat >= 35.44 && lat <= 35.468) {
        candidates.push(car);
      }
    }
    if (candidates.length === 0) {
      const fallback = this.cars.find((c) => c.kind === 4 && c.id !== excludeCarId) ?? this.cars[0];
      return fallback ? fallback.id : null;
    }
    const excludePos =
      excludeCarId !== null && excludeCarId !== undefined
        ? candidates.findIndex((c) => c.id > excludeCarId)
        : 0;
    const picked = candidates[excludePos >= 0 ? excludePos : 0]!;
    return picked.id;
  }

  getCarById(carId: number): ResolvedRideAlongCar | null {
    const car = this.carById.get(carId);
    if (!car) return null;
    const edge = this.edges[car.edgeIdx];
    if (!edge) return null;
    const pose = this.computeCarWorldPose(edge, car.distM, car.laneIdx);
    const speedKmh = Math.round(car.speedMps * 3.6);
    const district = resolveYokohamaDistrict(pose.lon, pose.lat);
    const shortTag = String((car.id % 899) + 100);

    let statusJa = `自動走行中 · ${speedKmh} km/h`;
    let statusEn = `Cruising autonomously · ${speedKmh} km/h`;
    if (car.speedMps < 0.6) {
      statusJa = car.signalState === "red" ? "赤信号で停車中" : "前方車待ちで停車中";
      statusEn = car.signalState === "red" ? "Stopped at red signal" : "Yielding in traffic";
    } else if (car.braking) {
      statusJa = `減速中 · ${speedKmh} km/h`;
      statusEn = `Slowing for intersection · ${speedKmh} km/h`;
    }

    return {
      carId: car.id,
      labelJa: `横浜自動運転カー #${shortTag}`,
      labelEn: `Autonomous Pod #${shortTag}`,
      lon: pose.lon,
      lat: pose.lat,
      elevM: pose.elevM,
      bearingDeg: pose.bearingDeg,
      speedKmh,
      braking: car.braking,
      signalState: car.signalState,
      districtJa: district.ja,
      districtEn: district.en,
      statusJa,
      statusEn,
    };
  }

  getVisibleCars(
    topLeftPx: { x: number; y: number },
    bottomRightPx: { x: number; y: number },
    hourJst = 12,
    maxCars = 420,
  ): AmbientCarInstance[] {
    if (this.edges.length === 0) return [];
    const density = computeTrafficDensityFactor(hourJst);
    const pad = 140;
    const minX = topLeftPx.x - pad;
    const maxX = bottomRightPx.x + pad;
    const minY = topLeftPx.y - pad;
    const maxY = bottomRightPx.y + pad;

    const out: AmbientCarInstance[] = [];
    let trackedAdded = false;

    if (this.trackedCarId !== null) {
      const tracked = this.carById.get(this.trackedCarId);
      if (tracked) {
        const edge = this.edges[tracked.edgeIdx]!;
        if (
          edge.maxPx >= minX &&
          edge.minPx <= maxX &&
          edge.maxPy >= minY &&
          edge.minPy <= maxY
        ) {
          const pose = this.computeCarWorldPose(edge, tracked.distM, tracked.laneIdx);
          out.push({
            carId: tracked.id,
            lon: pose.lon,
            lat: pose.lat,
            elevM: pose.elevM,
            bearingDeg: pose.bearingDeg,
            speedMps: tracked.speedMps,
            signalState: tracked.signalState,
            kind: tracked.kind,
            colorIdx: tracked.colorIdx,
            braking: tracked.braking,
          });
          trackedAdded = true;
        }
      }
    }

    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i]!;
      if (trackedAdded && car.id === this.trackedCarId) continue;
      if (car.tier > density) continue;
      const edge = this.edges[car.edgeIdx]!;
      if (
        edge.maxPx < minX ||
        edge.minPx > maxX ||
        edge.maxPy < minY ||
        edge.minPy > maxY
      ) {
        continue;
      }

      const pose = this.computeCarWorldPose(edge, car.distM, car.laneIdx);
      out.push({
        carId: car.id,
        lon: pose.lon,
        lat: pose.lat,
        elevM: pose.elevM,
        bearingDeg: pose.bearingDeg,
        speedMps: car.speedMps,
        signalState: car.signalState,
        kind: car.kind,
        colorIdx: car.colorIdx,
        braking: car.braking,
      });
      if (out.length >= maxCars) break;
    }

    return out;
  }
}

const simulatorCache = new WeakMap<AmbientTrafficBundle, AmbientTrafficSimulator>();

function getOrCreateSimulator(bundle: AmbientTrafficBundle): AmbientTrafficSimulator {
  let sim = simulatorCache.get(bundle);
  if (!sim) {
    sim = new AmbientTrafficSimulator(bundle);
    simulatorCache.set(bundle, sim);
  }
  return sim;
}

export async function loadAmbientFixtures(baseReleaseUrl: string): Promise<{
  traffic: AmbientTrafficBundle | null;
  pedestrians: Float32Array | null;
}> {
  const [trRes, pedRes] = await Promise.all([
    fetch(`${baseReleaseUrl}/fixtures/ambient-traffic.json`, { cache: "no-store" }).catch(() => null),
    fetch(`${baseReleaseUrl}/fixtures/pedestrians.json`, { cache: "no-store" }).catch(() => null),
  ]);

  let traffic: AmbientTrafficBundle | null = null;
  if (trRes?.ok) {
    try {
      traffic = (await trRes.json()) as AmbientTrafficBundle;
    } catch {
      traffic = null;
    }
  }

  let pedestrians: Float32Array | null = null;
  if (pedRes?.ok) {
    try {
      const json = (await pedRes.json()) as { points?: number[] };
      if (Array.isArray(json.points) && json.points.length >= 4) {
        pedestrians = new Float32Array(json.points);
      }
    } catch {
      pedestrians = null;
    }
  }

  return { traffic, pedestrians };
}

export function sampleVisibleAmbientCars(
  bundle: AmbientTrafficBundle | null,
  topLeftPx: { x: number; y: number },
  bottomRightPx: { x: number; y: number },
  simTimeSec: number,
  camera: CameraManifest,
  maxCars = 420,
  hourJst = 12,
  trackedCarId: number | null = null,
): AmbientCarInstance[] {
  void camera;
  void wgs84ToLocal;
  if (!bundle) return [];

  const sim = getOrCreateSimulator(bundle);
  sim.setTrackedCarId(trackedCarId);
  sim.advanceTo(simTimeSec, hourJst);
  return sim.getVisibleCars(topLeftPx, bottomRightPx, hourJst, maxCars);
}

export function pickRideAlongCarId(
  bundle: AmbientTrafficBundle | null,
  simTimeSec: number,
  hourJst = 12,
  excludeCarId?: number | null,
): number | null {
  if (!bundle) return null;
  const sim = getOrCreateSimulator(bundle);
  sim.advanceTo(simTimeSec, hourJst);
  return sim.pickRideAlongCar(excludeCarId);
}

export function resolveRideAlongCar(
  bundle: AmbientTrafficBundle | null,
  carId: number,
  simTimeSec: number,
  hourJst = 12,
): ResolvedRideAlongCar | null {
  if (!bundle) return null;
  const sim = getOrCreateSimulator(bundle);
  sim.setTrackedCarId(carId);
  sim.advanceTo(simTimeSec, hourJst);
  return sim.getCarById(carId);
}
