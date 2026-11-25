import { SURFACE_KIND, type SurfaceKind } from "@small-yokohama/core";

export type Lang = "ja" | "en";

export interface I18nDict {
  pageTitle: string;
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
  layerTrains: string;
  layerBuses: string;
  layerBoats: string;
  layerTraffic: string;
  layerPedestrians: string;
  layerLabels: string;
  layerMotion: string;
  layerStyle: string;
  styleIllustrated: string;
  stylePlain: string;
  layerSky: string;
  skyPresets: {
    day: string;
    golden: string;
    dusk: string;
    night: string;
    live: string;
  };
  layerWeather: string;
  weatherPresets: {
    live: string;
    clear: string;
    rain: string;
  };
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
  devQaTitle: string;
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
    status: string;
    size: string;
    trainLine: string;
    trainType: string;
    nextStop: string;
    cars: string;
  };
  vesselKinds: Record<"cruise" | "cruiser" | "waterbus" | "tug", string>;
  underwayLabel: string;
  berthedLabel: string;
  openGoogleMaps: string;
  selectedEyebrow: string;
  placesGroups: {
    landmarks: string;
    stations: string;
    corporate: string;
    piers: string;
    parks: string;
    ships: string;
  };
  skyDescriptions: Record<"day" | "golden" | "twilight" | "night", string>;
  aboutTitle: string;
  aboutLead: string;
  qaSummary: string;
  tvTourLabel: string;
  compassTip: string;
  switchToDark: string;
  switchToLight: string;
  zoomInTip: string;
  zoomOutTip: string;
  fullscreenTip: string;
  closeLabel: string;
  creditAbout: string;
  soundOnTip: string;
  soundOffTip: string;
  followLabel: string;
  followingLabel: string;
  loadingCity: string;
}

const JA: I18nDict = {
  pageTitle: "Small Yokohama · スモール横浜",
  brand: "Small Yokohama",
  navSearch: "検索",
  navPlaces: "名所",
  navLayers: "レイヤー",
  navTv: "TV",
  navShare: "共有",
  navCopied: "コピー済",
  navAbout: "概要",
  navLang: "EN",
  searchPlaceholder: "建物・名所・通り・駅を検索 (/)",
  searchEmpty: "該当する施設が見つかりませんでした",
  layerTrains: "電車（JR・京急・相鉄）",
  layerBuses: "ベイサイドブルー（バス）",
  layerBoats: "港の客船・入港予定",
  layerTraffic: "街の車（ズーム時）",
  layerPedestrians: "街の人々",
  layerLabels: "地名ラベル",
  layerMotion: "ライブ動作",
  layerStyle: "描画スタイル",
  styleIllustrated: "イラスト調",
  stylePlain: "基準レンダー",
  layerSky: "時間帯・空の色",
  skyPresets: {
    day: "昼",
    golden: "夕方",
    dusk: "黄昏",
    night: "夜",
    live: "現在",
  },
  layerWeather: "天気・雨エフェクト",
  weatherPresets: {
    live: "自動",
    clear: "晴れ",
    rain: "雨",
  },
  feedLabel: "交通フィード",
  feedOptions: {
    synthetic: "合成テスト (サークルウォーク検証)",
    scheduled: "時刻表推定 (GTFS-JP)",
    stale: "鮮度テスト (135s凍結 / >5m消去)",
    "missing-time": "時刻欠損テスト",
    outage: "配信障害テスト",
    live: "ライブ接続 (/api/snapshot.json)",
  },
  playBtn: "再生中",
  pauseBtn: "停止中",
  devQaTitle: "詳細・開発用オーバーレイ",
  toggleDepth: "奥行きマップ可視化",
  toggleXray: "遮蔽透視 (X-Ray)",
  toggleTileGrid: "タイル境界 (128px重なり)",
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
    status: "運航状況",
    size: "船体寸法",
    trainLine: "路線",
    trainType: "列車種別",
    nextStop: "走行区間・次駅",
    cars: "編成",
  },
  vesselKinds: {
    cruise: "大型客船",
    cruiser: "観光船",
    waterbus: "水上バス",
    tug: "港湾船・タグ",
  },
  underwayLabel: "航行中",
  berthedLabel: "着岸中",
  openGoogleMaps: "Google マップで開く ↗",
  selectedEyebrow: "選択中",
  placesGroups: {
    landmarks: "名所・ランドマーク",
    stations: "主要駅",
    corporate: "企業本社・文化・図書館",
    piers: "埠頭・海辺・デッキ",
    parks: "公園・庭園",
    ships: "客船・入港予定",
  },
  skyDescriptions: {
    day: "晴天の横浜港",
    golden: "港を染める夕暮れ",
    twilight: "みなとみらいの黄昏",
    night: "横浜の夜景・灯り",
  },
  aboutTitle: "Small Yokohama · スモール横浜について",
  aboutLead:
    "横浜・横浜駅〜みなとみらい〜新港〜大さん橋〜中華街・山手の街並みを正投影45度カメラで描き、同じ視点の16-bit奥行きマップと重ねることで、青い連節バス（ベイサイドブルー）が歩道橋や赤レンガ倉庫の裏へ自然に隠れる立体ミニチュア地図です。",
  qaSummary: "自動 QA 検収結果",
  tvTourLabel: "TVツアー巡回中",
  compassTip: "北の方向（右上 · クリックで初期視点へ）",
  switchToDark: "夜モードへ切り替え",
  switchToLight: "昼モードへ切り替え",
  zoomInTip: "拡大 (+)",
  zoomOutTip: "縮小 (-)",
  fullscreenTip: "全画面表示",
  closeLabel: "閉じる",
  creditAbout: "概要",
  soundOnTip: "港の音をオンにする",
  soundOffTip: "港の音をオフにする",
  followLabel: "追いかける",
  followingLabel: "追跡中 · 地図を動かすと解除",
  loadingCity: "街を読み込んでいます…",
};

const EN: I18nDict = {
  pageTitle: "Small Yokohama: an illustrated miniature map of Yokohama",
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
  layerTrains: "Trains (JR / Keikyu / Sotetsu)",
  layerBuses: "Buses (Bayside Blue)",
  layerBoats: "Harbor ships & calls",
  layerTraffic: "Street traffic (zoom in)",
  layerPedestrians: "Pedestrians",
  layerLabels: "Labels",
  layerMotion: "Live motion",
  layerStyle: "Map style",
  styleIllustrated: "Illustrated",
  stylePlain: "Plain 3D base",
  layerSky: "Sky & time of day",
  skyPresets: {
    day: "Day",
    golden: "Golden",
    dusk: "Dusk",
    night: "Night",
    live: "Live",
  },
  layerWeather: "Weather & rain",
  weatherPresets: {
    live: "Live",
    clear: "Clear",
    rain: "Rain",
  },
  feedLabel: "Transit feed",
  feedOptions: {
    synthetic: "Synthetic (Circle Walk check)",
    scheduled: "Scheduled (GTFS-JP)",
    stale: "Stale check (135s / >5m)",
    "missing-time": "Missing timestamp check",
    outage: "Feed outage simulation",
    live: "Live collector (/api/snapshot.json)",
  },
  playBtn: "Playing",
  pauseBtn: "Paused",
  devQaTitle: "Map style, transit feed & QA",
  toggleDepth: "Depth map overlay",
  toggleXray: "X-Ray occluded hull",
  toggleTileGrid: "Tile seams (128px)",
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
    status: "Status",
    size: "Dimensions",
    trainLine: "Line",
    trainType: "Service",
    nextStop: "Segment / Next stop",
    cars: "Consist",
  },
  vesselKinds: {
    cruise: "Cruise Liner",
    cruiser: "Harbor Cruiser",
    waterbus: "Water Bus",
    tug: "Harbor Boat",
  },
  underwayLabel: "Underway",
  berthedLabel: "Berthed",
  openGoogleMaps: "Open in Google Maps ↗",
  selectedEyebrow: "Selected",
  placesGroups: {
    landmarks: "Landmarks",
    stations: "Stations",
    corporate: "Corporate HQs & Culture",
    piers: "Piers & promenades",
    parks: "Parks and gardens",
    ships: "Harbor ships",
  },
  skyDescriptions: {
    day: "clear over Yokohama Bay",
    golden: "golden hour over the harbor",
    twilight: "blue-hour dusk along the waterfront",
    night: "harbor lights after dark",
  },
  aboutTitle: "About Small Yokohama",
  aboutLead:
    "An illustrated 45-degree orthographic miniature of Yokohama from Yokohama Station and Minato Mirai to Shinko, Osanbashi, Chinatown, and Yamate. A paired 16-bit depth pyramid lets articulated Bayside Blue buses glide behind Red Brick Warehouses and beneath Circle Walk.",
  qaSummary: "Automated QA Check",
  tvTourLabel: "TV tour",
  compassTip: "Compass: north points upper-right · click to reset view",
  switchToDark: "Switch to night view",
  switchToLight: "Switch to day view",
  zoomInTip: "Zoom in (+)",
  zoomOutTip: "Zoom out (-)",
  fullscreenTip: "Full screen",
  closeLabel: "Close",
  creditAbout: "About",
  soundOnTip: "Sound on",
  soundOffTip: "Sound off",
  followLabel: "Follow",
  followingLabel: "Following · drag the map to stop",
  loadingCity: "Loading the city…",
};

export function getDict(lang: Lang): I18nDict {
  return lang === "en" ? EN : JA;
}

const CATEGORY_MAP: Record<string, { en: string; ja: string }> = {
  animal_boarding: { en: "Pet Care", ja: "ペットホテル" },
  aquarium: { en: "Aquarium", ja: "水族館" },
  arts_centre: { en: "Arts Center", ja: "アート施設" },
  artwork: { en: "Public Art", ja: "パブリックアート" },
  attraction: { en: "Attraction", ja: "観光スポット" },
  bank: { en: "Bank", ja: "銀行" },
  bar: { en: "Bar", ja: "バー" },
  beauty: { en: "Salon", ja: "ビューティー" },
  bicycle: { en: "Bike Shop", ja: "自転車店" },
  bicycle_rental: { en: "Bike Share", ja: "シェアサイクル" },
  books: { en: "Bookstore", ja: "書店" },
  bridge: { en: "Bridge / Deck", ja: "橋梁・歩道橋" },
  building: { en: "Building", ja: "建物" },
  cafe: { en: "Cafe", ja: "カフェ" },
  car: { en: "Auto Services", ja: "自動車関連" },
  chemist: { en: "Pharmacy", ja: "薬局" },
  cinema: { en: "Cinema", ja: "映画館" },
  civic: { en: "Civic & Heritage", ja: "官庁・歴史建築" },
  clothes: { en: "Apparel", ja: "ファッション" },
  convenience: { en: "Convenience Store", ja: "コンビニ" },
  copyshop: { en: "Print & Copy", ja: "プリント・コピー" },
  corporate: { en: "Corporate HQ", ja: "企業本社・オフィス" },
  dentist: { en: "Dental Clinic", ja: "歯科" },
  doctors: { en: "Clinic", ja: "クリニック" },
  dry_cleaning: { en: "Dry Cleaning", ja: "クリーニング" },
  events_centre: { en: "Event Hall", ja: "イベントホール" },
  events_venue: { en: "Event Venue", ja: "イベント会場" },
  fast_food: { en: "Casual Dining", ja: "軽食" },
  furniture: { en: "Home & Design", ja: "インテリア" },
  general: { en: "General Store", ja: "雑貨・ショップ" },
  gift: { en: "Gift Shop", ja: "ギフトショップ" },
  hospital: { en: "Medical Center", ja: "病院・診療所" },
  hotel: { en: "Hotel", ja: "ホテル" },
  information: { en: "Visitor Info", ja: "案内・記念碑" },
  landmark: { en: "Landmark", ja: "ランドマーク" },
  library: { en: "Library", ja: "図書館" },
  mall: { en: "Shopping Mall", ja: "商業施設" },
  mobile_phone: { en: "Mobile Carrier", ja: "携帯ショップ" },
  museum: { en: "Museum", ja: "ミュージアム" },
  park: { en: "Park", ja: "公園" },
  parking: { en: "Parking", ja: "駐車場" },
  parking_entrance: { en: "Parking Entrance", ja: "駐車場入口" },
  pastry: { en: "Bakery & Sweets", ja: "洋菓子・ベーカリー" },
  pet: { en: "Animal Experience", ja: "アニマル施設" },
  pier: { en: "Pier / Terminal", ja: "埠頭・客船ターミナル" },
  police: { en: "Police / Coast Guard", ja: "警察・海上保安" },
  post_office: { en: "Post Office", ja: "郵便局" },
  pub: { en: "Izakaya & Pub", ja: "居酒屋・ダイニング" },
  public_bath: { en: "Bath & Spa", ja: "スパ・温浴施設" },
  public_building: { en: "Public Building", ja: "公共・官庁施設" },
  restaurant: { en: "Restaurant", ja: "レストラン" },
  school: { en: "School", ja: "学校" },
  station: { en: "Station", ja: "鉄道駅" },
  street: { en: "Street / Crossing", ja: "通り・交差点" },
  supermarket: { en: "Supermarket", ja: "スーパー" },
  townhall: { en: "Government Hall", ja: "官公庁" },
  transit: { en: "Transit Stop", ja: "駅・バス停" },
  university: { en: "University", ja: "大学" },
  variety_store: { en: "Variety Store", ja: "バラエティショップ" },
  vending_machine: { en: "Vending Point", ja: "自販機" },
  viewpoint: { en: "Scenic Viewpoint", ja: "展望スポット" },
  zoo: { en: "Animal Park", ja: "アニマルパーク" },
};

export function formatCategory(category: string, lang: Lang): string {
  const hit = CATEGORY_MAP[category];
  if (hit) return lang === "en" ? hit.en : hit.ja;
  return category
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const SURFACE_LABELS: Record<SurfaceKind, { en: string; ja: string }> = {
  [SURFACE_KIND.VOID]: { en: "Boundary", ja: "境界" },
  [SURFACE_KIND.WATER]: { en: "Harbor Water", ja: "海面・運河" },
  [SURFACE_KIND.GROUND]: { en: "Ground", ja: "地面" },
  [SURFACE_KIND.ROAD]: { en: "Roadway", ja: "道路" },
  [SURFACE_KIND.BUILDING]: { en: "Building", ja: "建物" },
  [SURFACE_KIND.BRIDGE_DECK]: { en: "Elevated Deck / Bridge", ja: "歩道橋・橋梁" },
  [SURFACE_KIND.BRIDGE_SUPPORT]: { en: "Bridge Pier", ja: "橋脚" },
  [SURFACE_KIND.QUAY]: { en: "Quay Wall", ja: "護岸・岸壁" },
  [SURFACE_KIND.VEGETATION]: { en: "Park / Greenery", ja: "公園・緑地" },
};

export function formatSurfaceKind(kind: SurfaceKind, lang: Lang): string {
  const hit = SURFACE_LABELS[kind];
  if (hit) return lang === "en" ? hit.en : hit.ja;
  return lang === "en" ? "Feature" : "地物";
}

export function formatDeckId(deckId: string, lang: Lang): string {
  if (deckId === "ground-road") {
    return lang === "en" ? "Street level" : "地上道路";
  }
  if (deckId === "circle-walk-deck") {
    return lang === "en" ? "Circle Walk deck" : "サークルウォーク上層";
  }
  return deckId;
}

export function formatSourceKind(sourceKind: string, lang: Lang): string {
  if (sourceKind === "osm-odbl") {
    return lang === "en" ? "OpenStreetMap (ODbL)" : "OpenStreetMap (ODbL 実測)";
  }
  return sourceKind;
}

const FULLWIDTH_TO_ASCII = (s: string): string =>
  s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

export function formatAddress(address: string, lang: Lang): string {
  if (lang !== "en") return address;
  let out = FULLWIDTH_TO_ASCII(address).trim();
  const replacements: Array<[RegExp, string]> = [
    [/（横浜第二港湾合同庁舎）/g, " (Yokohama Port Joint Gov. Bldg No. 2)"],
    [/（横浜海上防災基地）/g, " (Yokohama Maritime Disaster Response Base)"],
    [/神奈川県横浜市西区/g, "Nishi-ku, Yokohama, Kanagawa "],
    [/神奈川県横浜市中区/g, "Naka-ku, Yokohama, Kanagawa "],
    [/神奈川横浜市中区/g, "Naka-ku, Yokohama, Kanagawa "],
    [/神奈川県横浜市/g, "Yokohama, Kanagawa "],
    [/横浜市中区/g, "Naka-ku, Yokohama "],
    [/神奈川県/g, "Kanagawa, Japan"],
    [/みなとみらい/g, "Minato Mirai "],
    [/北仲通/g, "Kitanaka-dori "],
    [/海岸通/g, "Kaigan-dori "],
    [/新港/g, "Shinko "],
    [/本町/g, "Honcho "],
    [/馬車道/g, "Bashamichi "],
    [/一丁目/g, "1-chome "],
    [/二丁目/g, "2-chome "],
    [/三丁目/g, "3-chome "],
    [/四丁目/g, "4-chome "],
    [/五丁目/g, "5-chome "],
    [/六丁目/g, "6-chome "],
    [/1丁目/g, "1-chome "],
    [/2丁目/g, "2-chome "],
    [/3丁目/g, "3-chome "],
    [/4丁目/g, "4-chome "],
    [/5丁目/g, "5-chome "],
    [/6丁目/g, "6-chome "],
    [/([0-9]+)丁目/g, "$1-chome "],
    [/Marine & Walk YokohamaSeaside2F/g, "Marine & Walk Yokohama Seaside 2F"],
  ];
  for (const [re, rep] of replacements) {
    out = out.replace(re, rep);
  }
  out = out.replace(/([0-9]+)番地?([0-9]*)/g, (_: string, a: string, b: string) =>
    b ? `${a}-${b}` : a,
  );
  // Remove any residual CJK parentheses/punctuation spacing issues
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

export function formatTimeStatusText(date: Date, lang: Lang): string {
  if (lang === "ja") {
    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${map.weekday ?? ""}曜 ${map.hour ?? "00"}:${map.minute ?? "00"}`;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const parts24 = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const h24 = Number(parts24.find((p) => p.type === "hour")?.value ?? 12) % 24;
  const partOfDay =
    h24 >= 5 && h24 < 12
      ? "morning"
      : h24 >= 12 && h24 < 17
        ? "afternoon"
        : h24 >= 17 && h24 < 21
          ? "evening"
          : "night";
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Day";
  const hour = parts.find((p) => p.type === "hour")?.value ?? "12";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${weekday} ${partOfDay}, ${hour}:${minute}`;
}
