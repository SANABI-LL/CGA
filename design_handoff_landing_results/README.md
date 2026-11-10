# Handoff: CampusGeo Landing + Query Results

## Overview

The public landing page and query results interface for CampusGeo. Users ask natural-language questions about campus geography; the interface streams the AI's reasoning and text answer while simultaneously rendering matching map features in the right panel. Results can be exported as a two-page PDF (map page + data table page).

This package corresponds to the `apps/web` frontend in repo `SANABI-LL/CGA`. The backend contract is unchanged; all details come from `docs/FRONTEND_INTEGRATION.md` and `backend/lambdas/ai-agent/`.

## About the Design Files

The HTML files in this package are **design references**, not production-ready code. They are high-fidelity single-file HTML prototypes that describe the intended look and behavior.

The task is to **rebuild these designs inside the existing React + Vite environment in `apps/web`**, following the codebase's established component structure, state management, and build system. Do not copy the HTML files verbatim.

## Fidelity

**High-fidelity.** Colors, fonts, spacing, animations, and interaction states are all finalized values and should be reproduced pixel-for-pixel. All values are listed in the Design Tokens section below.

---

## Screens / Views

### 1. Landing (hero section)

**Purpose**: Introduce the product and accept the user's first query.

**Layout**
- Root container: `min-height: 100vh`, background `var(--ns-bg-grad)`, `position: relative; overflow: hidden`.
- Content centered, `max-width: 1180px`, horizontal padding 32px.
- Four decorative background layers, all `pointer-events: none` with `z-index` below content:
  1. **Contour lines**: SVG `viewBox="0 0 1440 900"`, `preserveAspectRatio="xMidYMid slice"`, `position: absolute; inset: 0`. Six cubic curves, `stroke: var(--ns-contour)`, animated dashes (see Animations).
  2. **Survey annotations**: Same-size SVG; 5 crosshairs + campus place names (REGENSTEIN LIBRARY / BOTANY POND / MIDWAY PLAISANCE / ROCKEFELLER CHAPEL / MAIN QUADRANGLES), `font-size: 9px`, `letter-spacing: 1.5`, `fill: var(--ns-accent)`, default `opacity: 0.45`, hover `0.9` (`transition: opacity 0.25s ease`; requires `pointer-events: auto`). Dashed paths `stroke-dasharray="2 8"`, `animation: nsDash 4.5s linear infinite`.
  3. **Fine grid**: `background-image` bidirectional 1px lines, `var(--ns-grid)`, 48px spacing, with a radial `mask-image` fade-out.
  4. **Noise texture**: base64 SVG feTurbulence, `opacity: var(--ns-noise)` (dark 0.03 / light 0.02).

**Components**
- **Header**: 64px tall; left side: UChicago shield SVG + "CampusGeo" wordmark; right side: status dot (`var(--ns-status-dot)` + glow) and icon buttons.
- **Eyebrow**: Small all-caps label, `font-size: 10px; font-weight: 500; letter-spacing: 0.32em; color: var(--ns-fg-faint)`, followed by a 36px fade line `linear-gradient(90deg, var(--ns-accent-line), transparent)`.
- **H1**: `font-family: 'Gotham', 'Plus Jakarta Sans', sans-serif; font-size: 62px; font-weight: 500; line-height: 1.06; letter-spacing: -0.028em; color: var(--ns-fg); margin: 0 0 24px; text-wrap: balance`.
- **Subheading**: `font-size: 15px; font-weight: 400; line-height: 1.75; letter-spacing: 0.005em; color: var(--ns-fg-body); max-width: 500px`.
- **Search input**: Outer wrapper `padding: 1px; border-radius: 15px; background: var(--ns-frame)` (1px gradient border); inner `background: var(--ns-input-bg); border-radius: 14px; backdrop-filter: blur(12px); box-shadow: var(--ns-input-shadow)`; input element `height: 44px; font-size: 14.5px; background: transparent; border: none; outline: none; color: var(--ns-fg)`.
- **Ask button**: `height: 44px; padding: 0 22px; border-radius: 11px; font-size: 13.5px; font-weight: 500; letter-spacing: 0.02em; color: #fff`; `background: linear-gradient(180deg, #A31212, #6E0000)`; `box-shadow: 0 8px 28px rgba(150,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(0,0,0,0.25)`; hover `filter: brightness(1.15)`; active `transform: scale(0.97)`; `transition: filter 0.15s ease, transform 0.15s ease`.
- **Suggestion chips**: pill shape, `padding: 9px 16px; border-radius: 999px; font-size: 12px; background: var(--ns-chip-bg); border: 1px solid var(--ns-hair-soft); color: var(--ns-chip-fg)`; hover `border-color: var(--ns-accent-bd-h); color: var(--ns-chip-fg-h); background: var(--ns-tile-hover); transform: translateY(-1px)`; 12px lucide icon on left, `stroke: var(--ns-accent)`.
  - Copy: `Bike racks near Regenstein Library` / `Buildings constructed before 1930` / `Trees planted near the Quad`

### 2. How it works (four-phase explainer animation)

Four cards in a row, each `border-radius: 14px; background: var(--ns-tile); border: 1px solid var(--ns-hair-soft)`. A persistent sequence number `01`–`04` sits top-right of each card (`position: absolute; top: 16px; right: 16px; font-size: 10px; font-weight: 500; letter-spacing: 0.12em; color: var(--ns-num)`).

A single 8-second looping timeline lights up each card in sequence (`dgW1`–`dgW4` control the opacity of the highlight border layer). Each card contains its own illustrative animation:

| # | Title | Animation |
|---|---|---|
| 01 | Ask in plain language | Typewriter effect (`dgType` controls `max-width` 0→160px) + blinking cursor `dgCaret` |
| 02 | Reads the right layers | Three `skewX(-28deg)` layer slices, each lifting and lighting up in sequence (`dgLayer`) + scan line `dgScan` |
| 03 | Maps the answer | Three location pins pop in one by one (`dgDotA/B/C`) + ring outline draws `dgRing` |
| 04 | Summarizes the documents | Persistent PDF card + top-to-bottom scan beam `dgPdfScan` + summary badge pops in `dgCheck` |

A progress light strip `dgProg` at the bottom syncs with all four phases.

### 3. Query Results (results section)

**Layout**: `max-width: 1180px; margin: 30px auto 0`, CSS Grid.
- With map: `grid-template-columns: minmax(0, 1fr) minmax(0, 1.06fr)`
- Without map: `minmax(0, 1fr)` (single column)
- `gap: 16px; align-items: start`

⚠️ **This container must not have any `transform` or `animation` (including entrance animations with `fill-mode: both`)** — an ancestor with a transform becomes the positioning context for `position: fixed`, causing the fullscreen map to render outside the viewport. This is a real bug that was fixed.

**Left column — answer card**
- `background: var(--ns-tile); border: 1px solid var(--ns-hair-soft); border-radius: 16px; padding: 24px 28px 26px; box-shadow: var(--ns-card-inset); min-height: 300px`
- Card header: original query text + status badge on right, `padding-bottom: 14px; border-bottom: 1px solid var(--ns-hair-soft); margin-bottom: 18px`
- Status badge values: `INTERPRETING` → `ANSWERED` / `N FEATURES MAPPED` / `FAILED`
- Loading state: pulsing dot (`nsPulse 1s ease-in-out infinite`) + current tool name; copy format: `Reading query s3 layer…`
- Body is streaming markdown that must be rendered (paragraphs, bold, lists, tables)
- Error text color `#D96060`

**Table ↔ map cross-highlighting**: hovering a table row highlights the matching feature on the map; row background changes to `var(--ns-tile-hover)` (`transition: background 0.15s ease`).
- Matching logic: if row count equals feature count → one-to-one by order; otherwise match by in-row text against feature title; if no match, do not highlight (don't guess).

**Right column — map card**
- `position: sticky; top: 24px` (map stays in viewport when the answer is long)
- Card `display: flex; flex-direction: column; height: 480px; border-radius: 16px; overflow: hidden`
- Top toolbar: ~49px tall, `padding: 11px 12px 11px 16px; border-bottom: 1px solid var(--ns-hair-soft)`
  - Left: status dot + badge text (`N FEATURES` / `HYDE PARK CAMPUS`), `font-size: 9.5px; letter-spacing: 0.16em; color: var(--ns-fg-muted)`
  - Right: three 27×27px icon buttons — **Export PDF**, **Fullscreen**, **Collapse**; `border-radius: 7px; border: 1px solid var(--ns-hair-soft)`; hover `background: var(--ns-tile-hover); border-color: var(--ns-hair)`
- Collapse: map body `flex: 0 0 0px; height: 0`, card shrinks to a single toolbar strip; chevron rotates 180deg (`transition: transform 0.2s ease`).
- Fullscreen: card `position: fixed; inset: 24px; z-index: 90`; overlay `position: fixed; inset: 0; z-index: 85; background: rgba(20,10,12,0.55); backdrop-filter: blur(3px)`; exit with Esc or click overlay; `document.body.style.overflow = 'hidden'` while fullscreen.
- Year legend (buildings queries only, when year range > 0): bottom-left, `bottom: 14px; left: 16px`, 132×6px color strip `linear-gradient(90deg, #3E6478, #6E8C86, #C4903A, #A31212)`, min/max years labeled at each end.
- Loading overlay: full-cover `var(--ns-input-bg)`, a 90px-tall light band `nsSweep 2.6s linear infinite` sweeping top-to-bottom, centered text `READING CAMPUS LAYERS` (`font-size: 10px; letter-spacing: 0.24em`).

---

## Map Configuration

**Library**: MapLibre GL JS 4.7.1 (CDN or npm)

```js
new maplibregl.Map({
  container,
  style: {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/' + (dark ? 'dark_all' : 'light_all') + '/{z}/{x}/{y}@2x.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap, © CARTO',
      },
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  },
  center: [-87.5997, 41.7897],   // Hyde Park campus
  zoom: 14.6,
  attributionControl: false,
  preserveDrawingBuffer: true,   // required: PDF export reads the canvas
});
```

**Layer stack** (source `results`, GeoJSON)

| id | type | filter | paint |
|---|---|---|---|
| `results-fill` | fill | Polygon/MultiPolygon | `fill-color: #A31212` (replaced by year gradient when applicable, see below), `fill-opacity: 0.55` |
| `results-outline` | line | Polygon/MultiPolygon | `line-color: rgba(255,255,255,0.5)` (dark) / `rgba(42,34,24,0.45)` (light), `line-width: 0.8` |
| `results-line` | line | LineString/MultiLineString | `line-color: #C4903A`, `line-width: 2.4` |
| `results-point` | circle | Point/MultiPoint | `circle-radius: 6`, `circle-color: #C4903A`, `circle-stroke-width: 1.6`, `circle-stroke-color: #1E1013` (dark) / `#FAF7F2` (light) |
| `results-hl-fill` | fill | `['==', ['get','_idx'], -1]` | `fill-color: #C4903A`, `fill-opacity: 0.5` |
| `results-hl-line` | line | same | `line-color: #C4903A`, `line-width: 2.6` |
| `results-hl-point` | circle | same | `circle-radius: 12`, `circle-color: rgba(196,144,58,0.22)`, `circle-stroke-width: 2`, `circle-stroke-color: #C4903A` |

Highlighting is implemented by updating the `setFilter` to swap `_idx` for the target sequence number.

**Year color ramp** (buildings queries): After `pushFeatures`, compute year range and overwrite `results-fill` `fill-color`:

```js
['case',
  ['==', ['coalesce', ['get', '_year'], -1], -1], 'rgba(140,128,112,0.5)',   // missing year → neutral gray
  ['interpolate', ['linear'], ['get', '_year'],
    lo, '#3E6478', at(0.38), '#6E8C86', at(0.72), '#C4903A', hi, '#A31212'],
]
```
`at(t) = lo + (hi - lo) * t`. Fall back to solid `#A31212` and hide the legend when fewer than 2 year samples exist.

**Feature preprocessing**: Before writing to the source, inject `_idx` (sequence number, for highlighting) and `_year` (parsed year) into each feature. Year parsing order: `_yearResolved` → `Year_Completed` → `year` → first 4 characters of `Year_Opened` ISO string; only accept values 1700–2200.

**Popups**: When clicking a feature, generate fields based on layer type — do not hard-code building fields.

| Layer detection | Title | Fields |
|---|---|---|
| Has `CommonName` or `TreeID` | Species | Tree ID / Condition / Age class / Canopy radius / Diameter / Notes |
| Has `DISCRIPT1` / `Year_Completed` / `BD_ID` | Building name | Use / Year completed / Address / Architects / Height / Building code |
| Has `Spaces` / `Capacity` / `RackType` | Bike rack | Type / Spaces / Location / Covered |
| Other | `Name`/`Label`/`Description` | Auto-pick up to 5 descriptive fields |

Field filtering for unknown layers must **suppress internal columns**: `objectid`, `shape_*`, `globalid`, `fid`, `lat`/`lon`, `fci`, `ri`, `ricost`, `f20\d\d` (cost projection columns), `berp`, `csl`, `bim`, etc. Proximity queries additionally display `distanceMeters` (rounded to integer + " m").

---

## 3D Buildings (fill-extrusion)

A **3D** button appears in the map toolbar for building queries (to the left of the print button). It is shown only when results contain Polygon/MultiPolygon features with `BLDG_HGT > 0`.

**Button**: 27px tall, padding 0 9px, radius 7px, text "3D" (10px/500, letter-spacing 0.08em). Inactive: same style as other icon buttons. Active: `background: linear-gradient(180deg, #A31212, #6E0000); color: #fff; border-color: rgba(163,18,18,0.4)`.

**When enabled**:
```js
map.addLayer({
  id: 'results-3d', type: 'fill-extrusion', source: 'results',
  filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
  paint: {
    // match the current fill-color of results-fill (sync year gradient when applicable)
    'fill-extrusion-color': map.getPaintProperty('results-fill', 'fill-color'),
    // BLDG_HGT is in feet → convert to meters
    'fill-extrusion-height': ['*', ['coalesce', ['to-number', ['get', 'BLDG_HGT']], 0], 0.3048],
    'fill-extrusion-opacity': 0.88,
    'fill-extrusion-vertical-gradient': true,
  },
});
```
- Hide `results-fill` / `results-outline` / `results-hl-fill` (`setLayoutProperty visibility: none`).
- Camera: `easeTo({ pitch: 55, bearing: -18, duration: 800 })`.

**When disabled**: restore flat layer visibility, hide `results-3d`, `easeTo({ pitch: 0, bearing: 0 })`.

**Sync rules**:
- When the year color ramp updates (see Map Configuration), if `results-3d` exists, sync the same expression to `fill-extrusion-color`.
- Force flat mode when a new query begins (reset `map3d` state and call the disable logic).
- Known limitation: table row hover highlighting only applies to the flat layers, not the 3D extrusions.

---

## 3D Buildings（fill-extrusion）

建筑类查询的地图工具栏出现 **3D** 按钮（打印按钮左侧）。仅当结果含带 `BLDG_HGT > 0` 的 Polygon/MultiPolygon 要素时显示。

**按钮**：高 27px、padding 0 9px、radius 7px、文字 "3D"（10px/500，字距 0.08em）。未激活时同其他图标按钮；激活时 `background: linear-gradient(180deg, #A31212, #6E0000); color: #fff; border-color: rgba(163,18,18,0.4)`。

**开启时**：
```js
map.addLayer({
  id: 'results-3d', type: 'fill-extrusion', source: 'results',
  filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
  paint: {
    // 与 results-fill 当前的 fill-color 保持一致（年份渐变时同步着色）
    'fill-extrusion-color': map.getPaintProperty('results-fill', 'fill-color'),
    // BLDG_HGT 为英尺 → 米
    'fill-extrusion-height': ['*', ['coalesce', ['to-number', ['get', 'BLDG_HGT']], 0], 0.3048],
    'fill-extrusion-opacity': 0.88,
    'fill-extrusion-vertical-gradient': true,
  },
});
```
- 隐藏 `results-fill` / `results-outline` / `results-hl-fill`（`setLayoutProperty visibility: none`）
- 镜头：`easeTo({ pitch: 55, bearing: -18, duration: 800 })`

**关闭时**：恢复平面图层可见、隐藏 `results-3d`、`easeTo({ pitch: 0, bearing: 0 })`。

**联动规则**：
- 年份配色更新时（见 Map Configuration 的年份渐变），若 `results-3d` 存在，把同一表达式同步到 `fill-extrusion-color`
- 新查询开始时强制回到平面模式（重置 `map3d` state 并调用关闭逻辑）
- 已知限制：表格行 hover 高亮只作用于平面图层，不点亮 3D 体块

---

## PDF Export

Click the toolbar print button → write a standalone print document into a hidden iframe → call `print()`. The user selects "Save as PDF" in the system print dialog.

**Timing**: Must wait for both the map image `onload` and `document.fonts.ready` (Gotham is self-hosted woff2; not waiting causes fallback to a system font). Force-trigger after a 4-second timeout.

**Page 1 — Map**
- `@page { size: letter; margin: 0.55in; }`
- Header: `CampusGeo` (15pt/700) + `UNIVERSITY OF CHICAGO` (8.5pt, letter-spacing 0.2em), right side: coordinates and timestamp (9pt); 2px `#800000` rule below.
- Title: original query text, 19pt/500, `letter-spacing: -0.02em`.
- Count line: `N FEATURES MAPPED · <layer type>`, 9.5pt, `#9A6F28`.
- Map image: `canvas.toDataURL('image/png')`, `max-height: 6in`, framed with `1px solid #C9BFAF` + 6pt padding.
- Footer: data attribution + `SHEET 1 — MAP`; year color legend on right.

**Page 2+ — Data table**
- Table header repeats on each page (`thead { display: table-header-group }`); rows are not split across pages (`tr { page-break-inside: avoid }`).
- `table-layout: fixed`, body 10pt/1.5, header 8.5pt all-caps letter-spacing 0.1em.
- Column groups by layer:

| Layer | Columns (with widths) | Sort |
|---|---|---|
| Campus buildings | Building 26% / ID 8% / Use 18% / Year 8% / Architects 20% / Address 20% | `_year` ascending |
| Campus trees | Tree ID 13% / Species 26% / Condition 13% / Age class 15% / Canopy 12% / Notes 21% | — |
| Bike parking | Type 26% / Spaces 16% / Location 38% / Distance 20% | `distanceMeters` ascending |
| Other | Feature + auto fields | — |

A fixed sequence number column leads each row (5% width, `#B5ADA0`, 8.5pt). Empty values display as `—`.

---

## Interactions & Behavior

**Query flow**
1. User types in the search box or clicks a suggestion chip → immediately clear previous results and map features.
2. `POST {apiBase}/api/agent`, headers `Content-Type: application/json` + `X-Api-Key`, body `{ query, sessionId }`.
3. Read SSE line by line (`data: ` prefix, parse JSON):
   - `type: 'tool_call'` → status line shows `Reading <toolName underscores-to-spaces>…`
   - `type: 'text'` → append to answer text; set `loading` to false.
   - Event has `mapUpdate` → accumulate features (**handle both bare array and FeatureCollection formats**), redraw and `fitBounds`.
   - Only `mapUpdate.center` → `easeTo({ center, zoom: 16, duration: 700 })`.
   - `type: 'error'` → display error copy.
4. Stream ends → finalize status, display feature count.

**fitBounds**: `padding: 56, maxZoom: 17, duration: 700`; for a single point use `easeTo({ zoom: 16.5 })` instead.

**Keyboard**: Enter in search box submits; Esc exits map fullscreen.

**Theme**: Auto-switches based on `prefers-color-scheme`; `[data-theme-force="dark"|"light"]` overrides. Basemap tile URL and map stroke colors update with theme.

---

## State Management

```
query          string   search input contents
asked          string   currently submitted question
loading        bool     waiting for first text chunk
answer         string   accumulated markdown text
error          string   error copy
tool           string   current tool status line
featureCount   number   mapped feature count
yearMin/Max    number   year range (drives legend and color ramp)
mapCollapsed   bool
mapFullscreen  bool
hoverKey       string   identifier of currently hovered table row
```

Instance variables (not in state, to avoid unnecessary re-renders): `features[]` (accumulated GeoJSON features), `map`, `mapReady`, `sessionId`.

---

## Design Tokens

All values in CSS custom properties, with light and dark variants. Complete definitions are in `tokens.css` in this package (can be copied directly into the codebase). Core values:

**Dark (default)**
- Base: `#251215`, gradient `linear-gradient(180deg, #2B1417 0%, #221114 55%, #1E1013 100%)`
- Four text levels: `#F5F1EA` / `#BFAFA8` / `#97867F` / `#715F5A`
- Two border levels: `rgba(245,241,234,0.10)` / `rgba(245,241,234,0.065)`
- Two surface levels: `rgba(245,241,234,0.028)` / `rgba(245,241,234,0.05)`
- Amber: `#D2A055`

**Light**
- Base: `#F5F0E8`, gradient `linear-gradient(180deg, #F9F5ED 0%, #F4EEE3 100%)`
- Four text levels: `#2A2218` / `#6B5F52` / `#8C8070` / `#B5ADA0`
- Amber: `#9A6F28`

**Rules**: Only two accent colors are permitted across the entire page — maroon (UChicago maroon family) and amber. All other hierarchy uses opacity tiers of the foreground color. New elements must use variables; never hard-code a color.

**Typography**: Self-hosted Gotham 400/500/700 + 400 italic (`assets/fonts/`). Do not substitute Google Fonts. Display letter-spacing -0.028em; small all-caps labels 0.12–0.32em. Both headings and body text must declare `font-family` explicitly to prevent the design system's h1/p rules from overriding them.

**Border radius**: buttons 11px, cards 14–16px, small icon buttons 7px, chips 999px.

**Motion**: Entrance `nsUp` (`translateY(18px)` + fade, `cubic-bezier(0.16,1,0.3,1)`, 0.08s stagger). Hover transitions 0.15–0.25s. No bounce. Background contour lines use three keyframe sets with different easings (`nsSandA/B/C`, periods 24s–52s, alternating directions) so the flow never aligns to the same beat.

---

## Assets

- `assets/fonts/` — self-hosted Gotham woff2 (400/500/700 + 400 italic) and `gotham.css`
- `assets/ds-tokens.css` — design system token local copy (remote `@import` removed for offline use)
- UChicago shield — inline SVG, light/dark variants switched via `--ns-shield-white` / `--ns-shield-maroon` controlling `display`
- Icons — Lucide, inline SVG, `stroke-width: 1.5–1.9`
- Noise texture — inline base64 SVG feTurbulence, no external dependencies

---

## Files

| File | Description |
|---|---|
| `Landing B v2 Night Survey.dc.html` | Complete design prototype (all logic included), primary reference |
| `tokens.css` | Design tokens, ready to copy |
| `WORKFLOW.md` | Claude Code ↔ Claude Design four-step collaboration workflow |

---

## Security

The prototype reads `apiBase` and `apiKey` from `backend-config.local.js` injected at runtime. **That file is not in this package and must never enter git.** The production implementation should use environment variables and the existing deployment config; do not bundle the key into frontend build output.
