# Small Yokohama

**English** · [日本語](README.ja.md) · [Tile assignments and coordinates](docs/tile-grid-plan.md) · [Study area (GeoJSON)](scope/waterfront.geojson) · [System design](docs/design.md) · [Development stack](docs/technology.md) · [Research and sources](docs/research.md)

> **An interactive, zoomable miniature illustration of Yokohama's waterfront** — inspired by [Small SF](https://smallsf.com/).  
> **Live map: [small-yokohama.vercel.app](https://small-yokohama.vercel.app/)**  
> This open project recreates the waterfront from Yokohama Station through Minato Mirai, Shinko, the Red Brick Warehouse, and Yamashita Park to Motomachi and Chinatown. It combines a 45° orthographic miniature map with ligne claire linework and an overlay based on real transit, weather, and simulated traffic. **All 23 tiles (4 pilot, 12 Phase A, and 7 Phase B) are stitched into a single `15,488 × 5,888 px` panorama. The Deep Zoom Image (DZI) pyramids and full-map viewer are built as `full-yokohama-v1`.**

A blue articulated bus turns a warehouse corner and slips behind the building. Pan along the waterfront to reach Yamashita Park.

---

## Production status (all 23 tiles complete)

> The build stitches all 23 tiles with minimum-color-difference seams computed using dynamic programming (DP). All 21 vertical and 2 horizontal seam checks passed. It includes `illustrated.dzi` and `plain.dzi`, `7,744 × 2,944` depth and feature ID tiles, and the integrated full-map viewer.

- [x] **Shinko pilot** (`pilot`, 4/4 complete) — Yokohama Hammerhead, Osanbashi Pier, Red Brick Warehouse, World Porters, Kishamichi Promenade, Yokohama Stadium, and Nihon-odori
- [x] **Assignment 1** (`phase-a-1`, 4/4 complete, `moruku36`) — Yamashita Park, Hikawa Maru, Yokohama Marine Tower, Yokohama Chinatown, Yamashita Pier, Harbor View Park, and Motomachi
- [x] **Assignment 2** (`phase-a-2`, 4/4 complete, `moruku36`) — Yokohama Landmark Tower, Queen's Square, Pacifico Yokohama, Rinko Park, Shin-Takashima, Nissan headquarters, and the Central Wholesale Market
- [x] **Assignment 3** (`phase-a-3`, 4/4 complete, `moruku36`) — Yokohama Station east and west exits, Sogo, Sky Building, Yokohama Bay Quarter, Portside, Tsuruyacho, Tammachi Park, and the Nishi-Kanagawa uplands
- [x] **Assignment 4** (`phase-b-1`, 4/4 complete, `moruku36`) — southern Yamate, inland south of Motomachi, Ishikawacho Station, Nakamura River, Kannai Station, Odori Park, Noge, Hinodecho, and the Ooka River
- [x] **Assignment 5** (`phase-b-2`, 3/3 complete, `moruku36`) — Momijizaka, Kamonyama, Tobe Station, National Route 1, Ishizaki River, Hiranumabashi, the spherical gas holders, and Okano Park

---

## Live viewer features (`full-yokohama-v1`)

- **Deep street-level zoom & navigation** — `15,488 × 5,888 px` DZI (`0.34 m/px`) with smooth desktop drag-pan + wheel/trackpad zoom, non-inverted mobile pinch-to-zoom, street-block close-up zoom (~60–90 m wide framing matching Small SF), and zoomed-out fluffy cumulus clouds framing the map border and outer edges.
- **OSM-routed buses, harbor ships & 5 railway lines**:
  - **22 buses** (Bayside Blue articulated buses, Akai Kutsu, Pier Line, Municipal City Buses #26 / #8 / #58) routed strictly along real OpenStreetMap surface roads.
  - **14 Yokohama Harbor vessels** (Asuka II, Diamond Princess, Nippon Maru, Marine Rouge, Marine Shuttle, Royal Wing, Sea Bass water buses, and harbor tugs) with wake animation and harbor water-mask verification.
  - **5 real-track railway lines** (`JK` Keihin-Tohoku / Negishi, `JT` Tokaido, `JO` Yokosuka / Shonan-Shinjuku, `KK` Keikyu Main with Nogeyama Tunnel hiding, `SO` Sotetsu Main) powered by [`api/trains.js`](api/trains.js) (ODPT live feed + real-time timetable fallback) with clickable badges and detail cards.
- **Small SF-inspired simulated street traffic & sidewalk pedestrians**:
  - **832 intersection-split directed OSM road edges** with green/yellow/all-red signal cycles and all-way stops, car-following queues, corner slowdowns, Japanese left-hand multi-lane driving, morning/evening rush-hour & late-night density variation, up to 420 visible 3D vehicles (9 sedan colors, Yokohama taxis, white vans, box trucks, autonomous roof-pod sedans), close-zoom comic ink outlines, Gaussian headlights & brake-reactive taillights, and low-opacity building-occlusion ghosting for live buses and trains.
  - **2,650 illustrated miniature pedestrians** verified strictly onto sidewalks, plazas, and waterfront decks (`0` on roadways, railway tracks, buildings, or harbor water via 24-tile depth `surfaceKind` and citywide OSM road/rail clearance checks).
- **Live JST solar lighting, night streetlights & live weather**:
  - Real-time JST clock and solar altitude lighting (day, golden hour, dusk, deep night) with **1,600 city-wide OSM streetlights**.
  - Live Yokohama weather via [`api/weather.js`](api/weather.js) (Open-Meteo), real-time temperature/status readout, animated diagonal falling rain streaks, and manual Weather toggle (`Auto / Clear / Rain` or `?weather=rain`).
- **Bilingual (`JA` / `EN`) landmarks & POIs** — **49 landmarks & 431 POIs** including major stations (Yokohama, Sakuragicho, Kannai, Ishikawacho, Minatomirai, Shin-Takashima, etc.), Pacifico Yokohama, Yokohama Central & Kanagawa Prefectural Libraries, Kanagawa University Minato Mirai Campus, and 23 corporate headquarters.
- **Small SF-style opening, sound, hover, follow & share links**:
  - Opening the map drops you through a deck of cumulus onto the city (tinted for day, dusk or night); grabbing the map ends the fall early, and `?intro=0` or reduced motion skips it.
  - The speaker button plays a harbour soundscape synthesised in Web Audio (no audio files): lapping waves, a city hum, rain when it rains, ships' horns while ships are on the water, and gulls by day.
  - On desktop, hovering names whatever is under the cursor: a bus and its direction, a train and its next stop, a ship, a landmark, or a building.
  - Clicking a bus, train or moving ship follows it with the camera; dragging the map (or the card's Follow toggle) stops following.
  - Share copies a geographic link in Small SF's form, `?at=lat,lon,<metres across>m` (e.g. `?at=35.44400,139.65050,900m`), and leaves out settings still at their defaults. Older `?x=&y=&z=` links still open.

---

## Yokohama waterfront panorama (23 tiles, `15,488 × 5,888 px`)

All 23 tiles use a fixed 45° orthographic camera, with `z=18` aerial imagery from the Geospatial Information Authority of Japan (GSI) and 3D features from OpenStreetMap. Each tile was illustrated in ligne claire ink and warm gouache colors. The tiles were then stitched along minimum-color-difference seams across 128 px overlaps, with 14 px feathering.

![Combined preview of all 23 Yokohama waterfront tiles](docs/images/full-yokohama-23tiles-preview.png)

### Seam checks at 1:1 scale (four-tile intersections, `1200 × 900 px`)

| Yokohama Station, Bay Quarter, and the Takashima waterfront (`(3,0)-(4,1)`) | Minato Mirai, Landmark Tower, and Nogeyama (`(1,-1)-(2,0)`) |
| :---: | :---: |
| ![Yokohama Station seam check](docs/images/full-seam-yokohama-station.png) | ![Minato Mirai seam check](docs/images/full-seam-minatomirai.png) |
| **Kannai, Noge, the Ooka River, and Bashamichi (`(0,-1)-(1,0)`)** | **Yokohama Stadium, Chinatown, and Ishikawacho (`(-1,-1)-(0,0)`)** |
| ![Kannai and Noge seam check](docs/images/full-seam-kannai-noge.png) | ![Chinatown and Yokohama Stadium seam check](docs/images/full-seam-yamashita-chinatown.png) |

### Shinko pilot (4/4 stitched with 128 px overlaps, `3968 × 3968 px`)

![Stitched preview of the four Shinko pilot tiles](docs/images/pilot-shinko-4tiles-preview.png)

### Assignment 1 (`phase-a-1`, 4/4 complete) — Motomachi, Yamate, Chinatown, Yamashita Park, Hikawa Maru, and Yamashita Pier

| Top left `tile_-2_0` (Harbor View Park, Yamate, and Motomachi) | Top right `tile_-1_0` (Yamashita Park, Marine Tower, and Chinatown) |
| :---: | :---: |
| ![tile_-2_0](data/drawn-tiles/tile_-2_0.png) | ![tile_-1_0](data/drawn-tiles/tile_-1_0.png) |
| **Bottom left `tile_-2_1` (southern Yamashita Pier, Shin-Yamashita Canal, and the barge basin)** | **Bottom right `tile_-1_1` (Yamashita Park waterfront, Hikawa Maru, and northern Yamashita Pier)** |
| ![tile_-2_1](data/drawn-tiles/tile_-2_1.png) | ![tile_-1_1](data/drawn-tiles/tile_-1_1.png) |

### Assignment 2 (`phase-a-2`, 4/4 complete) — Minato Mirai, Landmark Tower, Pacifico Yokohama, Shin-Takashima, and the wholesale market

| Top left `tile_2_0` (Landmark Tower, Queen's Square, and Nippon Maru) | Top right `tile_3_0` (Shin-Takashima, Nissan headquarters, and Media Tower) |
| :---: | :---: |
| ![tile_2_0](data/drawn-tiles/tile_2_0.png) | ![tile_3_0](data/drawn-tiles/tile_3_0.png) |
| **Bottom left `tile_2_1` (Pacifico Yokohama, InterContinental, and Rinko Park)** | **Bottom right `tile_3_1` (Takashima waterfront, Minato Mirai Bridge, and Central Wholesale Market)** |
| ![tile_2_1](data/drawn-tiles/tile_2_1.png) | ![tile_3_1](data/drawn-tiles/tile_3_1.png) |

### Assignment 3 (`phase-a-3`, 4/4 complete) — Yokohama Station, Sogo, Bay Quarter, Portside, Tsuruyacho, Tammachi, and the Nishi-Kanagawa uplands

| Top left `tile_4_0` (Yokohama Station east and west exits, Sogo, Sky Building, and JR Yokohama Tower) | Top right `tile_5_0` (Tsuruyacho, Aratama River, the Shuto Expressway Mitsuzawa Route, and Tammachi Park) |
| :---: | :---: |
| ![tile_4_0](data/drawn-tiles/tile_4_0.png) | ![tile_5_0](data/drawn-tiles/tile_5_0.png) |
| **Bottom left `tile_4_1` (Yokohama Bay Quarter, Portside, and the Shuto Expressway Yokohane Route)** | **Bottom right `tile_5_1` (Nishi-Kanagawa, northern Tammachi, Kuritaya, and the Saitobuncho uplands)** |
| ![tile_4_1](data/drawn-tiles/tile_4_1.png) | ![tile_5_1](data/drawn-tiles/tile_5_1.png) |

### Assignment 4 (`phase-b-1`, 4/4 complete) — Yamate, Ishikawacho, Kannai, Odori Park, Noge, and the Ooka River

| Top left `tile_-2_-1` (Yamate, inland south of Motomachi, and Yamate Park) | Top right `tile_-1_-1` (Ishikawacho Station, Nakamura River, and Yamate Italian Garden) |
| :---: | :---: |
| ![tile_-2_-1](data/drawn-tiles/tile_-2_-1.png) | ![tile_-1_-1](data/drawn-tiles/tile_-1_-1.png) |
| **Bottom left `tile_0_-1` (Kannai Station, Odori Park, and Yokohama BUNTAI)** | **Bottom right `tile_1_-1` (Noge, Hinodecho, the Ooka River, and Miyakobashi Shopping Street)** |
| ![tile_0_-1](data/drawn-tiles/tile_0_-1.png) | ![tile_1_-1](data/drawn-tiles/tile_1_-1.png) |

### Assignment 5 (`phase-b-2`, 3/3 complete) — Momijizaka, Kamonyama, Tobe, Hiranumabashi, and Okano Park

| Left `tile_2_-1` (Momijizaka, Kamonyama, Nogeyama, and Kanagawa Prefectural Music Hall) | Center `tile_3_-1` (Tobe Station, National Route 1, Ishizaki River, and Chuo in Nishi Ward) | Right `tile_4_-1` (Hiranumabashi, the gas holders, Yokohama English Garden, and Okano Park) |
| :---: | :---: | :---: |
| ![tile_2_-1](data/drawn-tiles/tile_2_-1.png) | ![tile_3_-1](data/drawn-tiles/tile_3_-1.png) | ![tile_4_-1](data/drawn-tiles/tile_4_-1.png) |

### Detail views and seam checks

| Master style reference (#1, `tile_1_1`) | Seam between Circle Walk and World Porters |
| :---: | :---: |
| ![Master reference tile #1](docs/images/tile_1_1_master.png) | ![Circle Walk seam](docs/images/zoom-circlewalk-seam.png) |
| **Yokohama Stadium (detail from `tile_0_0`)** | **Kishamichi Promenade and canal (detail from `tile_1_0`)** |
| ![Yokohama Stadium detail](docs/images/zoom-stadium.png) | ![Kishamichi Promenade and canal detail](docs/images/zoom-kishamichi.png) |

- **Measured pilot QA results (`viewer/public/releases/pilot-shinko-v1/qa-report.json`)**
  - All four tiles had **`shift=(0,0) px`** and Sobel edge correlation of **`edgeCorr = 0.770 to 0.858`**.
  - The maximum error across eight ground control points (GCPs) was **`0.601 px`** (threshold `<= 8 px`).
  - The three seam color differences were `6.32`, `9.83`, and `23.07` (threshold `< 48`). **All seams passed** using the DP seam method with 14 px feathering.
  - The water checks returned `waterInventedBuildings = 0` and `voidPixels = 0`.

---

## Illustration and map quality standards

The [Small SF making-of](https://smallsf.com/about) inspired the miniature illustration style and the emphasis on geographic accuracy. These are the standards we use for each tile.

1. **45° orthographic projection and depth-based occlusion**  
   Every tile uses the same camera (`azimuth = 225°`, `depression = 45°`, `0.34 m/px`). We also generate depth and road elevation maps so that buses and boats can disappear partially behind Circle Walk, buildings, or bridges.
2. **Pixel-aligned geometry from GSI `z=18` aerial imagery and OSM 3D features**  
   Use the rendered `_base.png` as the fixed layout. Preserve the projected aerial imagery and 3D geometry at their original pixel positions, scale, and crop.
3. **One master style reference for every tile**  
   Referencing a chain of neighboring tiles gradually shifts colors and line weights. **Use only `data/drawn-tiles/tile_1_1.png` (#1) as the style reference for every tile.**
4. **Keep water, vessels, and land distinct**  
   Use the same **deep teal blue (`#226276`)** for the harbor, canals, and rivers, including the waters around Kishamichi Promenade and Shinko Bridge and the Ooka and Nakamura rivers. During compositing, a 3D water mask and a 22 px vessel protection halo keep boats off land and prevent invented buildings from appearing over water.
5. **128 px overlaps and automated QA**  
   Adjacent tiles overlap by 128 px and are joined along minimum-color-difference seams computed with dynamic programming. Before submitting a tile, run `render:tile` and confirm **`|shift| <= 8 px`** and **`edgeCorr >= 0.70`**.

---

## Tile grid and assignments

The [waterfront study area](scope/waterfront.geojson) spans Yokohama Station, Minato Mirai, Shinko, Yamashita Park, Motomachi, and Chinatown. The full map uses the same grid as the pilot, with `2048 × 2048 px` tiles, a stride of `1920 px = 652.8 m`, and `128 px` overlaps.

- The bounding grid has **3 rows × 8 columns = 24 cells** (`row = -1..1`, `col = -2..5`) and yields a `15,488 × 5,888 px` composite.
- **23 tiles** intersect the study area. The northwestern cell `(5, -1)` is outside the scope.
- **23/23 tiles are complete (100%)**: four pilot tiles (#1–#4), 12 Phase A tiles, four Phase B tiles in `phase-b-1`, and three in `phase-b-2`.
- **Zero tiles remain.** The full panorama has been built.
  - **Phase A** (waterfront and major station areas, `row = 0..1`) — 12/12 complete.
  - **Phase B** (inland edge, `row = -1`) — 7/7 complete.

```text
row \ col   -2    -1     0     1     2     3     4     5
   -1      [B1]  [B2]  [B3]  [B4]  [B5]  [B6]  [B7]    .
    0      [A1]  [A2]  [P4]  [P3]  [A5]  [A7]  [A9] [A11]
    1      [A3]  [A4]  [P2]  [P1]  [A6]  [A8] [A10] [A12]
```

| Phase | Assignment | Block (`--block`) | Tiles | Main areas |
| --- | --- | --- | --- | --- |
| Complete | Shinko pilot | `pilot` | `(1,1), (0,1), (1,0), (0,0)` (**4/4 complete**) | Yokohama Hammerhead, Osanbashi Pier, Red Brick Warehouse, World Porters, Kishamichi Promenade, Yokohama Stadium, and Nihon-odori |
| Complete (**A**) | **Assignment 1 (moruku36)** | `phase-a-1` | `(-2,0), (-1,0), (-2,1), (-1,1)` (**4/4 complete**) | Yamashita Park, Hikawa Maru, Marine Tower, Chinatown, Yamashita Pier, and Motomachi |
| Complete (**A**) | **Assignment 2 (moruku36)** | `phase-a-2` | `(2,0), (2,1), (3,0), (3,1)` (**4/4 complete**) | Landmark Tower, Queen's Square, Pacifico Yokohama, Rinko Park, Shin-Takashima, and K Arena Yokohama |
| Complete (**A**) | **Assignment 3 (moruku36)** | `phase-a-3` | `(4,0), (4,1), (5,0), (5,1)` (**4/4 complete**) | Yokohama Station east and west exits, Sogo, Bay Quarter, Tsuruyacho, Tammachi, and the Nishi-Kanagawa uplands |
| Complete (**B**) | **Assignment 4 (moruku36)** | `phase-b-1` | `(-2,-1), (-1,-1), (0,-1), (1,-1)` (**4/4 complete**) | southern Yamate, Ishikawacho Station, Kannai Station, Odori Park, Noge, Hinodecho, and the Ooka River |
| Complete (**B**) | **Assignment 5 (moruku36)** | `phase-b-2` | `(2,-1), (3,-1), (4,-1)` (**3/3 complete**) | Momijizaka, Kamonyama, Tobe Station, Hiranumabashi, the gas holders, and Okano Park |

See the [tile grid plan](docs/tile-grid-plan.md) for center coordinates and landmarks for all 23 tiles.

---

## Contributor guide to making a tile

### Step 1. Set up the workspace and create a branch for your block

```powershell
# Example for Assignment 5 (Momijizaka, Tobe Station, and Hiranumabashi)
git checkout -b tile/phase-b-2-tobe-hiranumabashi
npm.cmd install   # Use npm install on macOS/Linux
```

### Step 2. Generate the base image (`_base.png`)

The `render:tile` command works throughout the full grid (`col = -2..5, row = -1..1`). Pass an assignment block or a `<col>,<row>` coordinate to download GSI `z=18` aerial imagery and render a `2048 × 2048 px` orthographic base image.

```powershell
# Generate an entire assignment block in Windows PowerShell
npm.cmd run render:tile -- --block phase-b-2

# Generate one tile
npm.cmd run render:tile -- --tile 2,-1
```

Output path is `data/tile-renders/tile_{col}_{row}_base.png` (for example, `tile_2_-1_base.png`).

### Step 3. Choose the AI agent and model configuration

The pilot workflow below achieved consistent styling and alignment across all four tiles (`shift=(0,0) px` and `edgeCorr = 0.770 to 0.858`).

- **Choose a high-capability reasoning model to coordinate the work.**  
  For the pilot, a `gemini-pro-orchestrator-neon`-class model handled planning, base rendering, image-generation instructions, Sobel alignment checks, and visual review. An `image-generator` subagent drew the tiles. Smaller models tended to change the camera angle, retain the brown color of canals from the aerial imagery, or oversimplify buildings.
- **Provide both image references.**
  1. Use the 45° miniature architectural illustration approach in [Small SF](https://smallsf.com/) and its [making-of](https://smallsf.com/about) as inspiration.
  2. Provide these two images together:
     - **Image 1, the fixed geometry and layout** — `data/tile-renders/tile_{col}_{row}_base.png`
     - **Image 2, the master reference for style and color** — `data/drawn-tiles/tile_1_1.png` (always use tile #1)

### Step 4. Use the example prompts

#### Example A. Ask an AI coding agent such as Antigravity to produce an assigned tile

```text
You are creating a tile for Small Yokohama.
Use the miniature architectural illustration approach described at https://smallsf.com/ and https://smallsf.com/about.
Create `tile_{col}_{row}` (for example, `tile_2_-1` around Momijizaka, Kamonyama, and southern Tobe).

Steps:
1. If the base image is missing, run `npm.cmd run render:tile -- --tile {col},{row}`.
   Open `data/tile-renders/tile_{col}_{row}_base.png` and inspect it visually.
2. Give the `image-generator` subagent or image model these two references:
   - Image 1 (fixed layout and building positions): `data/tile-renders/tile_{col}_{row}_base.png`
   - Image 2 (style, line weight, palette, and water color only): `data/drawn-tiles/tile_1_1.png`
3. Save the result as `data/drawn-tiles/tile_{col}_{row}.png` (RGB PNG).
   Create `data/drawn-tiles/tile_{col}_{row}_meta.json` using `data/drawn-tiles/tile_1_0_meta.json` as an example.
4. Run `npm.cmd run render:tile -- --tile {col},{row}` again to check the Sobel correlation.
   Confirm `|shiftDx|, |shiftDy| <= 8 px` and `edgeCorr >= 0.70`, then inspect
   `data/drawn-tiles/tile_{col}_{row}_overlay_check.png` for misaligned edges, invented buildings in the water, and brown canals.
```

#### Example B. Prompt an image generation model directly

```text
Create a 1024x1024 illustrated architectural map tile for Small Yokohama in the exact Small SF (smallsf.com)
Ligne-Claire ink + warm sunlit gouache miniature style, STRICTLY pixel-locked to Reference Image 1 (`tile_{col}_{row}_base.png`)
and styled identically to Reference Image 2 (`tile_1_1.png`).

CRITICAL RULES:
1. Reference Image 1 is the 100% PIXEL-LOCKED GEOMETRY & LAYOUT BASE:
   - Keep EVERY building, tower, bridge, street, crosswalk, park, railway track, and shoreline in its EXACT pixel position.
   - ZERO camera rotation, ZERO zoom, ZERO cropping, ZERO tilt change, ZERO borders/margins/frames.
   - Edge-to-edge 1:1 square image. NO text, NO map labels, NO numbers, NO watermarks anywhere.
2. Reference Image 2 (`tile_1_1.png`) is the LOCKED MASTER STYLE REFERENCE ONLY (do NOT copy its layout):
   - Match Image 2's exact crisp dark charcoal-brown Ligne-Claire ink linework (`#2a2420`) on roof edges, facade grids, bridges & seawalls.
   - Match Image 2's warm late-afternoon gouache palette, fluffy sunlit green trees, and crisp soft slate-blue WNW shadows toward lower-left.
3. WATER & AERIAL DETAILS:
   - Paint ALL water surfaces (bay, canals, rivers, docks) cleanly in Image 2's `#226276` deep oceanic teal-blue with subtle fine wave ripples
     (never leave brownish-olive aerial canal water!).
   - Convert EVERY building footprint visible in Image 1's aerial photography cleanly into sharp miniature 3D Ligne-Claire buildings
     with detailed window mullions and rooftop HVAC units at matching 45-degree isometric scale.
```

### Step 5. Check your work and open a pull request

1. Save the tile as `data/drawn-tiles/tile_{col}_{row}.png` and its metadata as `data/drawn-tiles/tile_{col}_{row}_meta.json`. The `.gitignore` covers `_composited.png`, `_overlay_check.png`, `data/gsi-aerial/`, and `data/tile-renders/`.
2. Run the following checks:
   ```powershell
   npm.cmd run render:tile -- --tile <col>,<row>
   npm.cmd run typecheck
   npm.cmd run test
   npm.cmd run build
   ```
3. Use **one branch and one pull request per assignment block or tile** to reduce conflicts.

---

## Run the viewer locally and build the map

```powershell
# Build the 23-tile panorama (15488x5888 DZI, half-resolution data tiles, QA, and preview)
npm.cmd run build:full

# Regenerate OSM-routed buses, harbor ships, 5 rail lines, 832 traffic edges, 1600 streetlights & 2650 sidewalk pedestrians
node tools/generate-yokohama-fleet.mjs

# Enrich bilingual landmarks & POIs (49 landmarks / 431 POIs)
node tools/enrich-yokohama-landmarks.mjs

# Rebuild the four-tile Shinko pilot (pilot-shinko-v1)
npm.cmd run build:pilot

# Start the dev server (http://127.0.0.1:5173)
npm.cmd run dev

# Build the Vercel deployment bundle (deploy-vercel/)
npm.cmd run build:vercel
```

---

## Credits & License

- **Inspiration**: [Small SF](https://smallsf.com/) · [Author's making-of](https://smallsf.com/about) by Ari Dutilh
- **Geographic, aerial, weather & transit sources** — [OpenStreetMap (ODbL)](https://www.openstreetmap.org/copyright) · [Geospatial Information Authority of Japan (GSI seamless aerial imagery, z=18)](https://maps.gsi.go.jp/development/ichiran.html) · [Project PLATEAU Yokohama FY2024](https://www.geospatial.jp/ckan/dataset/plateau-14100-yokohama-shi-2024) · [Open-Meteo](https://open-meteo.com/) · [ODPT (Public Transportation Open Data Center)](https://www.odpt.org/)
- **Repository code and documentation** — [MIT License](LICENSE). External data and third-party material are subject to their providers' terms. [Sources and attribution requirements](docs/research.md)
