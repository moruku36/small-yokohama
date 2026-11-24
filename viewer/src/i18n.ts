export type Lang = "ja" | "en";

export interface I18nDict {
  brand: string;
  navSearch: string;
  navPlaces: string;
  navLayers: string;
  navTv: string;
  navShare: string;
  navCopied: string;
  navAbout: string;
  navLang: string;
  searchPlaceholder: string;
  searchEmpty: string;
  layerBuses: string;
  layerBoats: string;
  layerLabels: string;
  layerStyle: string;
  styleIllustrated: string;
  stylePlain: string;
  layerSky: string;
  skyRealtime: string;
  feedLabel: string;
  feedOptions: {
    synthetic: string;
    scheduled: string;
    stale: string;
    "missing-time": string;
    outage: string;
    live: string;
  };
  playBtn: string;
  pauseBtn: string;
  qaGroupTitle: string;
  toggleDepth: string;
  toggleXray: string;
  toggleTileGrid: string;
  toggleGcps: string;
  toggleDeckPoint: string;
  toggleReducedMotion: string;
  modeLabels: Record<"observed" | "stale" | "scheduled" | "synthetic" | "replay", string>;
  fields: {
    direction: string;
    deck: string;
    observedAt: string;
    age: string;
    fetchedAt: string;
    drift: string;
    height: string;
    levels: string;
    address: string;
    source: string;
    berth: string;
    schedule: string;
  };
  openGoogleMaps: string;
  aboutTitle: string;
  aboutLead: string;
  qaSummary: string;
  tvTourLabel: string;
  compassTip: string;
}

const JA: I18nDict = {
  brand: "Small Yokohama",
  navSearch: "検索",
  navPlaces: "名所",
  navLayers: "レイヤー",
  navTv: "TV",
  navShare: "共有",
  navCopied: "コピー済",
  navAbout: "概要",
  navLang: "EN",
  searchPlaceholder: "建物・名所・通り・バス停を検索 (/)",
  searchEmpty: "該当する施設が見つかりませんでした",
  layerBuses: "バス (ベイサイドブルー)",
  layerBoats: "港の客船・入港予定",
  layerLabels: "地名ラベル",
  layerStyle: "描画スタイル",
  styleIllustrated: "イラスト調",
  stylePlain: "基準レンダー",
  layerSky: "横浜の空・太陽",
  skyRealtime: "現在時刻",
  feedLabel: "交通フィード",
  feedOptions: {
    synthetic: "合成テスト (サークルウォーク検証)",
    scheduled: "時刻表推定 (GTFS-JP)",
    stale: "鮮度テスト (135s凍結 / >5m消去)",
    "missing-time": "時刻欠損テスト",
    outage: "配信障害テスト",
    live: "ライブ接続 (/api/snapshot.json)",
  },
  playBtn: "再生",
  pauseBtn: "停止",
  qaGroupTitle: "検証オーバーレイ (開発・検収用)",
  toggleDepth: "奥行きマップ可視化",
  toggleXray: "遮蔽透視 (X-Ray)",
  toggleTileGrid: "2×2タイル境界 (128px重なり)",
  toggleGcps: "地上基準点 (GCP 8点)",
  toggleDeckPoint: "歩道橋デッキ上検証点 (+6.9m)",
  toggleReducedMotion: "動きを抑える",
  modeLabels: {
    observed: "実測 (Fresh)",
    stale: "古い実測 (停止)",
    scheduled: "時刻表推定",
    synthetic: "合成テスト",
    replay: "記録再生",
  },
  fields: {
    direction: "行先・方向",
    deck: "走行階層",
    observedAt: "観測時刻",
    age: "経過時間",
    fetchedAt: "取得時刻",
    drift: "同期ずれ",
    height: "高さ",
    levels: "階数",
    address: "住所",
    source: "データ出典",
    berth: "着岸岸壁",
    schedule: "予定時刻",
  },
  openGoogleMaps: "Google マップで開く ↗",
  aboutTitle: "Small Yokohama · スモール横浜について",
  aboutLead:
    "横浜・新港〜みなとみらい〜大さん橋の街並みを正投影45度カメラで描き、同じ視点の16-bit奥行きマップと重ねることで、青い連節バス（ベイサイドブルー）が歩道橋や赤レンガ倉庫の裏へ自然に隠れる立体ミニチュア地図です。",
  qaSummary: "自動 QA 検収結果",
  tvTourLabel: "TVツアー巡回中",
  compassTip: "北の方向（クリックで初期視点へ）",
};

const EN: I18nDict = {
  brand: "Small Yokohama",
  navSearch: "Search",
  navPlaces: "Places",
  navLayers: "Layers",
  navTv: "TV",
  navShare: "Share",
  navCopied: "Copied",
  navAbout: "About",
  navLang: "JA",
  searchPlaceholder: "Find a building, landmark or street (/)",
  searchEmpty: "No matching places found",
  layerBuses: "Buses (Bayside Blue)",
  layerBoats: "Harbor ships & calls",
  layerLabels: "Map labels",
  layerStyle: "Map style",
  styleIllustrated: "Illustrated",
  stylePlain: "Plain base",
  layerSky: "Yokohama sky",
  skyRealtime: "Realtime",
  feedLabel: "Transit feed",
  feedOptions: {
    synthetic: "Synthetic (Circle Walk check)",
    scheduled: "Scheduled (GTFS-JP)",
    stale: "Stale check (135s / >5m)",
    "missing-time": "Missing timestamp check",
    outage: "Feed outage simulation",
    live: "Live collector (/api/snapshot.json)",
  },
  playBtn: "Play",
  pauseBtn: "Pause",
  qaGroupTitle: "Verification overlays",
  toggleDepth: "Depth map overlay",
  toggleXray: "X-Ray occluded hull",
  toggleTileGrid: "2x2 tile seams (128px)",
  toggleGcps: "Ground control points (8)",
  toggleDeckPoint: "Deck test point (+6.9m)",
  toggleReducedMotion: "Reduced motion",
  modeLabels: {
    observed: "Observed (Fresh)",
    stale: "Stale (Frozen)",
    scheduled: "Scheduled",
    synthetic: "Synthetic",
    replay: "Replay",
  },
  fields: {
    direction: "Direction",
    deck: "Surface deck",
    observedAt: "Observed at",
    age: "Age",
    fetchedAt: "Fetched at",
    drift: "Sync drift",
    height: "Height",
    levels: "Levels",
    address: "Address",
    source: "Source",
    berth: "Berth",
    schedule: "Schedule",
  },
  openGoogleMaps: "Open in Google Maps ↗",
  aboutTitle: "About Small Yokohama",
  aboutLead:
    "An illustrated 45-degree orthographic miniature of Yokohama's Shinko, Minato Mirai, and Osanbashi waterfront. A shared 16-bit depth pyramid lets articulated Bayside Blue buses glide behind Red Brick Warehouses and underneath Circle Walk.",
  qaSummary: "Automated Pilot QA",
  tvTourLabel: "TV tour active",
  compassTip: "North (click to reset view)",
};

export function getDict(lang: Lang): I18nDict {
  return lang === "en" ? EN : JA;
}
