import { SURFACE_KIND, type SurfaceKind } from "@small-yokohama/core";

export type Lang = "ja" | "en";

export interface I18nDict {
  pageTitle: string;
  brand: string;
  navSearch: string;
  navPlaces: string;
  navLayers: string;
  navTv: string;
  navRide: string;
  navShare: string;
  navCopied: string;
  navAbout: string;
  navLang: string;
  searchPlaceholder: string;
  searchEmpty: string;
  layerTrains: string;
  layerBuses: string;
  layerBoats: string;
  layerPlanes: string;
  layerAirCabin: string;
  layerCosmoClock: string;
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
    fog: string;
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
    buildingType: string;
    yearBuilt: string;
    footprint: string;
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
    callsign: string;
    aircraft: string;
    registration: string;
    altitude: string;
    speed: string;
    heading: string;
    verticalRate: string;
    ropewaySection: string;
    cabinNumber: string;
    eta: string;
    district: string;
    signal: string;
    cosmoShow: string;
  };
  vesselKinds: Record<"cruise" | "cruiser" | "waterbus" | "tug", string>;
  planeKinds: Record<"heavyJet" | "narrowJet" | "heli", string>;
  airCabinName: string;
  rideAlongTitle: string;
  rideAlongSwitch: string;
  rideAlongBadge: string;
  rideSignals: Record<"green" | "yellow" | "red", string>;
  departureBoardTitle: string;
  departureDue: string;
  departureMin: string;
  departureDelayed: string;
  departureOvernight: string;
  departureLiveBadge: string;
  departureSchedBadge: string;
  nearbyHaneda: string;
  underwayLabel: string;
  berthedLabel: string;
  openGoogleMaps: string;
  openGoogleMapsShort: string;
  openStreetView: string;
  openStreetViewInline: string;
  streetViewModalTitle: string;
  streetViewExternal: string;
  directionsLabel: string;
  directionsModes: Record<"walking" | "transit" | "driving", string>;
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
  mapLoadError: string;
  retryMap: string;
  overlayUnavailable: string;
  feedOutageBoot: string;
  feedOutageTrains: string;
  feedOutageBuses: string;
  feedOutagePlanes: string;
  feedOutageWeather: string;
}

const JA: I18nDict = {
  pageTitle: "Small Yokohama · スモール横浜",
  brand: "Small Yokohama",
  navSearch: "検索",
  navPlaces: "名所",
  navLayers: "レイヤー",
  navTv: "TV",
  navRide: "乗車",
  navShare: "共有",
  navCopied: "コピー済",
  navAbout: "概要",
  navLang: "EN",
  searchPlaceholder: "建物・名所・通り・駅を検索 (/)",
  searchEmpty: "該当する施設が見つかりませんでした",
  layerTrains: "電車（JR・京急・相鉄）",
  layerBuses: "ベイサイドブルー（バス）",
  layerBoats: "港の客船・入港予定",
  layerPlanes: "飛行機（羽田発着・ADS-B）",
  layerAirCabin: "YOKOHAMA AIR CABIN",
  layerCosmoClock: "コスモクロック21（夜景演出）",
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
  layerWeather: "天気・雨・霧エフェクト",
  weatherPresets: {
    live: "自動",
    clear: "晴れ",
    rain: "雨",
    fog: "霧",
  },
  feedLabel: "交通フィード",
  feedOptions: {
    synthetic: "合成テスト (サークルウォーク検証)",
    scheduled: "時刻表推定 (GTFS-JP)",
    stale: "鮮度テスト (135s凍結 / >5m消去)",
    "missing-time": "時刻欠損テスト",
    outage: "配信障害テスト",
    live: "ライブ接続 (/api/buses)",
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
    buildingType: "建物種別",
    yearBuilt: "竣工年",
    footprint: "建築面積",
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
    callsign: "便名・コールサイン",
    aircraft: "機種",
    registration: "機体記号",
    altitude: "高度",
    speed: "対地速度",
    heading: "方位",
    verticalRate: "昇降率",
    ropewaySection: "運行区間",
    cabinNumber: "ゴンドラ番号",
    eta: "到着目安",
    district: "走行エリア",
    signal: "前方信号",
    cosmoShow: "イルミネーション",
  },
  vesselKinds: {
    cruise: "大型客船",
    cruiser: "観光船",
    waterbus: "水上バス",
    tug: "港湾船・タグ",
  },
  planeKinds: {
    heavyJet: "大型旅客機",
    narrowJet: "旅客機",
    heli: "ヘリコプター",
  },
  airCabinName: "YOKOHAMA AIR CABIN",
  rideAlongTitle: "自動運転モビリティ",
  rideAlongSwitch: "別の車に乗換",
  rideAlongBadge: "自律走行デモ",
  rideSignals: {
    green: "青信号",
    yellow: "黄信号",
    red: "赤信号",
  },
  departureBoardTitle: "発車案内",
  departureDue: "まもなく",
  departureMin: "分",
  departureDelayed: "遅れ",
  departureOvernight: "夜間運休時間帯（始発待ち）",
  departureLiveBadge: "実測連動",
  departureSchedBadge: "時刻表",
  nearbyHaneda: "羽田周辺",
  underwayLabel: "航行中",
  berthedLabel: "着岸中",
  openGoogleMaps: "Google マップで開く ↗",
  openGoogleMapsShort: "Google マップ ↗",
  openStreetView: "ストリートビュー ↗",
  openStreetViewInline: "ストリートビュー",
  streetViewModalTitle: "ストリートビュー",
  streetViewExternal: "Google マップで開く ↗",
  directionsLabel: "ここへの経路案内",
  directionsModes: {
    walking: "徒歩",
    transit: "電車・バス",
    driving: "車",
  },
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
  mapLoadError: "地図を読み込めませんでした。",
  retryMap: "地図を再試行",
  overlayUnavailable: "WebGL2 を利用できないため、一部の地図レイヤーと演出は表示されません。",
  feedOutageBoot: "ライブ情報の取得に失敗しました。時刻に応じた想定データで表示しています。",
  feedOutageTrains: "列車のライブ情報が取得できません。想定データで表示しています。",
  feedOutageBuses: "バスのライブ情報が取得できません。想定データで表示しています。",
  feedOutagePlanes: "航空機のライブ情報が取得できません。想定データで表示しています。",
  feedOutageWeather: "天気のライブ情報が取得できません。現在の表示を維持しています。",
};

const EN: I18nDict = {
  pageTitle: "Small Yokohama: an illustrated miniature map of Yokohama",
  brand: "Small Yokohama",
  navSearch: "Search",
  navPlaces: "Places",
  navLayers: "Layers",
  navTv: "TV",
  navRide: "Ride",
  navShare: "Share",
  navCopied: "Copied",
  navAbout: "About",
  navLang: "JA",
  searchPlaceholder: "Find a building, landmark or street (/)",
  searchEmpty: "No matching places found",
  layerTrains: "Trains (JR / Keikyu / Sotetsu)",
  layerBuses: "Buses (Bayside Blue)",
  layerBoats: "Harbor ships & calls",
  layerPlanes: "Flights (Haneda / ADS-B)",
  layerAirCabin: "YOKOHAMA AIR CABIN",
  layerCosmoClock: "Cosmo Clock 21 (Light Show)",
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
  layerWeather: "Weather, rain & fog",
  weatherPresets: {
    live: "Live",
    clear: "Clear",
    rain: "Rain",
    fog: "Fog",
  },
  feedLabel: "Transit feed",
  feedOptions: {
    synthetic: "Synthetic (Circle Walk check)",
    scheduled: "Scheduled (GTFS-JP)",
    stale: "Stale check (135s / >5m)",
    "missing-time": "Missing timestamp check",
    outage: "Feed outage simulation",
    live: "Live ODPT bus feed (/api/buses)",
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
    buildingType: "Building type",
    yearBuilt: "Year built",
    footprint: "Footprint",
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
    callsign: "Callsign",
    aircraft: "Aircraft",
    registration: "Registration",
    altitude: "Altitude",
    speed: "Ground speed",
    heading: "Heading",
    verticalRate: "Vertical rate",
    ropewaySection: "Route",
    cabinNumber: "Cabin",
    eta: "Est. arrival",
    district: "District",
    signal: "Next signal",
    cosmoShow: "Light show",
  },
  vesselKinds: {
    cruise: "Cruise Liner",
    cruiser: "Harbor Cruiser",
    waterbus: "Water Bus",
    tug: "Harbor Boat",
  },
  planeKinds: {
    heavyJet: "Widebody Jet",
    narrowJet: "Airliner",
    heli: "Helicopter",
  },
  airCabinName: "YOKOHAMA AIR CABIN",
  rideAlongTitle: "Autonomous Ride",
  rideAlongSwitch: "Switch car",
  rideAlongBadge: "Autonomous",
  rideSignals: {
    green: "Green",
    yellow: "Yellow",
    red: "Red",
  },
  departureBoardTitle: "Next Departures",
  departureDue: "Due",
  departureMin: "min",
  departureDelayed: "Delayed",
  departureOvernight: "Overnight service pause",
  departureLiveBadge: "Live",
  departureSchedBadge: "Schedule",
  nearbyHaneda: "near Haneda",
  underwayLabel: "Underway",
  berthedLabel: "Berthed",
  openGoogleMaps: "Open in Google Maps ↗",
  openGoogleMapsShort: "Google Maps ↗",
  openStreetView: "Street View ↗",
  openStreetViewInline: "Street View",
  streetViewModalTitle: "Street View",
  streetViewExternal: "Open in Google Maps ↗",
  directionsLabel: "Directions here",
  directionsModes: {
    walking: "Walk",
    transit: "Transit",
    driving: "Drive",
  },
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
  mapLoadError: "The map could not be loaded.",
  retryMap: "Retry map",
  overlayUnavailable: "WebGL2 is unavailable. Some map layers and effects are not shown.",
  feedOutageBoot: "Live data could not be loaded. Showing estimated data for this time.",
  feedOutageTrains: "Live train data is unavailable. Showing estimated data.",
  feedOutageBuses: "Live bus data is unavailable. Showing estimated data.",
  feedOutagePlanes: "Live aircraft data is unavailable. Showing estimated data.",
  feedOutageWeather: "Live weather data is unavailable. Keeping the current view.",
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
  river: { en: "River", ja: "河川" },
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

const BUILDING_TYPE_MAP: Record<string, { en: string; ja: string }> = {
  yes: { en: "Building", ja: "建物" },
  apartments: { en: "Apartments", ja: "集合住宅・マンション" },
  residential: { en: "Residential", ja: "住宅" },
  house: { en: "House", ja: "戸建住宅" },
  detached: { en: "Detached House", ja: "戸建住宅" },
  terrace: { en: "Townhouse", ja: "長屋・テラスハウス" },
  dormitory: { en: "Dormitory", ja: "寮" },
  commercial: { en: "Commercial Building", ja: "商業ビル" },
  office: { en: "Office Building", ja: "オフィスビル" },
  retail: { en: "Retail Building", ja: "店舗・商業施設" },
  mall: { en: "Shopping Mall", ja: "大型商業施設" },
  hotel: { en: "Hotel", ja: "ホテル" },
  school: { en: "School", ja: "学校" },
  university: { en: "University", ja: "大学施設" },
  college: { en: "College", ja: "専門学校・大学" },
  kindergarten: { en: "Kindergarten", ja: "幼稚園・保育園" },
  hospital: { en: "Hospital / Medical", ja: "病院・医療施設" },
  public: { en: "Public Building", ja: "公共施設" },
  civic: { en: "Civic Building", ja: "公共・官庁施設" },
  government: { en: "Government Building", ja: "官公庁" },
  train_station: { en: "Station Building", ja: "駅舎" },
  station: { en: "Station Building", ja: "駅舎" },
  transportation: { en: "Transit Facility", ja: "交通施設" },
  warehouse: { en: "Warehouse", ja: "倉庫" },
  industrial: { en: "Industrial", ja: "工場・産業施設" },
  parking: { en: "Parking Garage", ja: "立体駐車場" },
  roof: { en: "Canopy / Roof", ja: "大屋根・キャノピー" },
  shrine: { en: "Shrine", ja: "神社" },
  temple: { en: "Temple", ja: "寺院" },
  church: { en: "Church", ja: "教会" },
  cathedral: { en: "Cathedral", ja: "大聖堂・教会" },
  place_of_worship: { en: "Place of Worship", ja: "宗教施設" },
  stadium: { en: "Stadium", ja: "スタジアム" },
  sports_hall: { en: "Sports Hall", ja: "体育館・スポーツ施設" },
  museum: { en: "Museum", ja: "博物館・美術館" },
  library: { en: "Library", ja: "図書館" },
  tower: { en: "Tower", ja: "タワー・塔" },
  historic: { en: "Historic Building", ja: "歴史的建造物" },
  ship: { en: "Museum Ship", ja: "記念艦・船" },
  carport: { en: "Carport", ja: "カーポート" },
  toilets: { en: "Restroom", ja: "公衆トイレ" },
  ruins: { en: "Historic Ruins", ja: "遺構・跡" },
  retret: { en: "Commercial Building", ja: "商業施設" },
  garage: { en: "Garage", ja: "車庫" },
  garages: { en: "Garages", ja: "車庫" },
  shed: { en: "Shed", ja: "小建築" },
  construction: { en: "Under Construction", ja: "建設中の建物" },
  service: { en: "Utility Building", ja: "設備棟" },
  kiosk: { en: "Kiosk", ja: "キオスク・売店" },
  bridge: { en: "Covered Walkway", ja: "連絡通路・渡り廊下" },
};

export function formatBuildingType(buildingType: string | undefined, lang: Lang): string {
  const key = (buildingType ?? "yes").trim().toLowerCase();
  const hit = BUILDING_TYPE_MAP[key];
  if (hit) return lang === "en" ? hit.en : hit.ja;
  if (lang === "ja") return "建物";
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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
    [/神奈川県横浜市神奈川区/g, "Kanagawa-ku, Yokohama, Kanagawa "],
    [/神奈川県横浜市保土ケ谷区/g, "Hodogaya-ku, Yokohama, Kanagawa "],
    [/神奈川横浜市中区/g, "Naka-ku, Yokohama, Kanagawa "],
    [/神奈川県横浜市/g, "Yokohama, Kanagawa "],
    [/横浜市西区/g, "Nishi-ku, Yokohama "],
    [/横浜市中区/g, "Naka-ku, Yokohama "],
    [/横浜市神奈川区/g, "Kanagawa-ku, Yokohama "],
    [/横浜市保土ケ谷区/g, "Hodogaya-ku, Yokohama "],
    [/西区/g, "Nishi-ku "],
    [/中区/g, "Naka-ku "],
    [/神奈川区/g, "Kanagawa-ku "],
    [/神奈川県/g, "Kanagawa, Japan"],
    [/みなとみらい/g, "Minato Mirai "],
    [/北仲通/g, "Kitanaka-dori "],
    [/海岸通/g, "Kaigan-dori "],
    [/山下町/g, "Yamashita-cho "],
    [/元町/g, "Motomachi "],
    [/山手町/g, "Yamate-cho "],
    [/野毛町/g, "Noge-cho "],
    [/花咲町/g, "Hanasaki-cho "],
    [/桜木町/g, "Sakuragicho "],
    [/高島/g, "Takashima "],
    [/金港町/g, "Kinko-cho "],
    [/鶴屋町/g, "Tsuruya-cho "],
    [/南幸/g, "Minamisaiwai "],
    [/北幸/g, "Kitasaiwai "],
    [/栄町/g, "Sakae-cho "],
    [/戸部本町/g, "Tobe-honcho "],
    [/戸部町/g, "Tobe-cho "],
    [/石川町/g, "Ishikawacho "],
    [/羽衣町/g, "Hagoromo-cho "],
    [/尾上町/g, "Onoe-cho "],
    [/真砂町/g, "Masago-cho "],
    [/弁天通/g, "Benten-dori "],
    [/相生町/g, "Aioi-cho "],
    [/住吉町/g, "Sumiyoshi-cho "],
    [/太田町/g, "Ota-machi "],
    [/常盤町/g, "Tokiwa-cho "],
    [/港町/g, "Minato-cho "],
    [/日本大通/g, "Nihon-odori "],
    [/伊勢佐木町/g, "Isezaki-cho "],
    [/日ノ出町/g, "Hinodecho "],
    [/宮川町/g, "Miyagawa-cho "],
    [/平沼/g, "Hiranuma "],
    [/岡野/g, "Okano "],
    [/西神奈川/g, "Nishi-Kanagawa "],
    [/反町/g, "Tammachi "],
    [/新港/g, "Shinko "],
    [/本町/g, "Honcho "],
    [/馬車道/g, "Bashamichi "],
    [/一丁目/g, "1-chome "],
    [/二丁目/g, "2-chome "],
    [/三丁目/g, "3-chome "],
    [/四丁目/g, "4-chome "],
    [/五丁目/g, "5-chome "],
    [/六丁目/g, "6-chome "],
    [/七丁目/g, "7-chome "],
    [/八丁目/g, "8-chome "],
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
