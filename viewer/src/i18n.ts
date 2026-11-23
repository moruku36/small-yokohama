export type Lang = "ja" | "en";

export interface I18nDict {
  appTitle: string;
  proxyTag: string;
  drawerToggle: string;
  variantLabel: string;
  variantIllustrated: string;
  variantPlain: string;
  feedLabel: string;
  feedOptions: {
    synthetic: string;
    scheduled: string;
    stale: string;
    "missing-time": string;
    outage: string;
    live: string;
  };
  sunLabel: string;
  sunRealtime: string;
  playBtn: string;
  pauseBtn: string;
  resetViewBtn: string;
  shareBtn: string;
  shareCopied: string;
  langBtn: string;
  creditsBtn: string;
  landmarksHeading: string;
  portCallsHeading: string;
  layersHeading: string;
  toggleDepth: string;
  toggleXray: string;
  toggleTileGrid: string;
  toggleGcps: string;
  toggleDeckPoint: string;
  toggleReducedMotion: string;
  closeBtn: string;
  focusOnMap: string;
  keyboardHint: string;
  modeLabels: Record<"observed" | "stale" | "scheduled" | "synthetic" | "replay", string>;
  fields: {
    route: string;
    direction: string;
    deck: string;
    observedAt: string;
    age: string;
    fetchedAt: string;
    source: string;
    coordinates: string;
    drift: string;
    berth: string;
    schedule: string;
  };
  creditsTitle: string;
  qaSummary: string;
}

const JA: I18nDict = {
  appTitle: "スモール横浜 · Small Yokohama",
  proxyTag: "新港パイロット (プロキシ検証)",
  drawerToggle: "一覧",
  variantLabel: "絵柄",
  variantIllustrated: "イラスト調",
  variantPlain: "基準レンダー",
  feedLabel: "交通データ",
  feedOptions: {
    synthetic: "合成テスト (サークルウォーク検証)",
    scheduled: "時刻表推定 (GTFS-JP フィクスチャ)",
    stale: "鮮度テスト (135秒凍結 / 5分超過消去)",
    "missing-time": "時刻欠損テスト (新鮮扱い禁止)",
    outage: "配信障害テスト",
    live: "ライブ接続 (/api/snapshot.json)",
  },
  sunLabel: "横浜の太陽",
  sunRealtime: "現在時刻",
  playBtn: "再生",
  pauseBtn: "停止",
  resetViewBtn: "初期視点",
  shareBtn: "URL共有",
  shareCopied: "コピー済み",
  langBtn: "English",
  creditsBtn: "出典・QA",
  landmarksHeading: "新港の名所・基準地点",
  portCallsHeading: "入港予定（時刻表ベース）",
  layersHeading: "検証レイヤー",
  toggleDepth: "奥行きマップ可視化",
  toggleXray: "遮蔽透視 (隠れ確認)",
  toggleTileGrid: "2×2作業タイル境界",
  toggleGcps: "地上基準点 (GCP 8点)",
  toggleDeckPoint: "歩道橋デッキ上検証点 (+6.9m)",
  toggleReducedMotion: "動きを抑える",
  closeBtn: "閉じる",
  focusOnMap: "地図で表示",
  keyboardHint: "矢印: 移動 / +/-: 拡大縮小 / 0: 初期視点 / Space: 再生・停止",
  modeLabels: {
    observed: "実測 (Fresh)",
    stale: "古い実測 (停止表示)",
    scheduled: "時刻表推定",
    synthetic: "合成テスト",
    replay: "記録再生",
  },
  fields: {
    route: "路線",
    direction: "行先・方向",
    deck: "走行階層",
    observedAt: "観測時刻",
    age: "経過時間",
    fetchedAt: "取得時刻",
    source: "出典",
    coordinates: "WGS84 座標",
    drift: "同期ずれ",
    berth: "着岸場所",
    schedule: "予定時刻",
  },
  creditsTitle: "出典・ライセンス・パイロットQA記録",
  qaSummary: "パイロット自動検収サマリー",
};

const EN: I18nDict = {
  appTitle: "Small Yokohama · スモール横浜",
  proxyTag: "Shinko Pilot (Documented Proxy)",
  drawerToggle: "Places",
  variantLabel: "Style",
  variantIllustrated: "Illustrated",
  variantPlain: "Plain Base",
  feedLabel: "Transit Feed",
  feedOptions: {
    synthetic: "Synthetic Track (Circle Walk Check)",
    scheduled: "Scheduled Timetable (GTFS-JP Fixture)",
    stale: "Stale Check (135s Frozen / >5m Removed)",
    "missing-time": "Missing Timestamp (Withheld)",
    outage: "Feed Outage Simulation",
    live: "Live Collector (/api/snapshot.json)",
  },
  sunLabel: "Yokohama Sun",
  sunRealtime: "Realtime",
  playBtn: "Play",
  pauseBtn: "Pause",
  resetViewBtn: "Reset View",
  shareBtn: "Share URL",
  shareCopied: "Copied",
  langBtn: "日本語",
  creditsBtn: "Credits & QA",
  landmarksHeading: "Shinko Landmarks",
  portCallsHeading: "Scheduled Port Calls",
  layersHeading: "Verification Layers",
  toggleDepth: "Depth Map Overlay",
  toggleXray: "X-Ray Occluded Hull",
  toggleTileGrid: "2x2 Working Tile Seams",
  toggleGcps: "Ground Control Points (8)",
  toggleDeckPoint: "Deck Test Point (+6.9m)",
  toggleReducedMotion: "Reduced Motion",
  closeBtn: "Close",
  focusOnMap: "Center on Map",
  keyboardHint: "Arrows: Pan / +/-: Zoom / 0: Reset / Space: Play/Pause",
  modeLabels: {
    observed: "Observed (Fresh)",
    stale: "Stale Observed (Frozen)",
    scheduled: "Scheduled Estimate",
    synthetic: "Synthetic Test",
    replay: "Recorded Replay",
  },
  fields: {
    route: "Route",
    direction: "Direction",
    deck: "Surface Deck",
    observedAt: "Observed At",
    age: "Observation Age",
    fetchedAt: "Fetched At",
    source: "Source",
    coordinates: "WGS84",
    drift: "Overlay Drift",
    berth: "Berth",
    schedule: "Schedule",
  },
  creditsTitle: "Sources, Licenses & Pilot QA Report",
  qaSummary: "Automated Pilot QA Summary",
};

export function getDict(lang: Lang): I18nDict {
  return lang === "en" ? EN : JA;
}
