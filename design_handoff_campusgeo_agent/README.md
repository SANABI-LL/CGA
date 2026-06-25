# CampusGeo — Developer Handoff
## Phase 1 · Query-to-Map Flow + Print Composer

**Prepared:** June 2026  
**Design status:** High-fidelity prototype  
**Target stack:** React 18 + Vite · MapLibre GL JS 4.x · AWS Lambda + S3 (self-hosted GeoJSON) · Anthropic Claude API (→ Bedrock in Phase 4)

---

## About This Package

The files in this folder are **high-fidelity design references** created in HTML/React — prototypes showing the intended look, interaction model, and copy. They are not production code to ship directly.

Your task is to **recreate these designs in the target codebase** (React + Vite, per `CLAUDE.md`) using the established patterns and libraries listed there. Match the visual output pixel-precisely; adapt the implementation to production conventions (proper component files, TypeScript, CSS modules, real API calls).

**Key reference files:**
| File | What it shows |
|---|---|
| `print-flow.html` | The complete hi-fi interactive prototype — all screens |
| `Intent Taxonomy.html` | The 7 query intents — schema, parameters, field mappings |
| `colors_and_type.css` | Full design token set (CSS custom properties) |
| `CLAUDE.md` | Architecture, roadmap, aesthetic rules |
| `campus-buildings.geojson` | Real building data (308 features, 40+ fields) |

---

## Design Tokens

All values come from `colors_and_type.css`. The prototype uses an inline object `T` — map these to the CSS custom properties in your codebase.

### Colors

```css
/* Backgrounds */
--paper:        #F5F0E8   /* primary page background */
--paper-dk:     #EDE6D8   /* sidebar, secondary surfaces */
--paper-dkr:    #E2D9C8   /* hover on secondary surfaces */
--cream:        #FAF7F2   /* cards, panels, inputs */

/* Text */
--ink:          #2A2218   /* primary text */
--ink-md:       #5A5046   /* secondary text */
--ink-lt:       #8C8070   /* tertiary / captions */
--ink-xlt:      #B5ADA0   /* placeholder / overline */

/* Brand */
--maroon:       #800000   /* UChicago Phoenix Maroon — CTAs, active states */
--maroon-dk:    #5A0000   /* hover, pressed */
--maroon-lt:    #A82020   /* hover alt */
--maroon-tint:  rgba(128,0,0,0.08)
--maroon-ring:  rgba(128,0,0,0.20)  /* focus ring */

/* Accent */
--amber:        #B07830
--amber-lt:     #D4A84E
--amber-tint:   rgba(176,120,48,0.12)

/* Functional */
--green:        #2E7D52
--green-bg:     rgba(46,125,82,0.12)
--green-bd:     rgba(46,125,82,0.30)

/* Rules */
--rule:         #D8CFC0
--rule-lt:      #E8E2D8
--rule-dk:      #C0B5A5
```

### Typography

Three families. Load from Google Fonts.

```
EB Garamond     — display / headers / editorial answers / italic emphasis
Plus Jakarta Sans — UI body, labels, buttons, captions
JetBrains Mono  — field names, coordinates, IDs, code, scale bar
```

Note: `colors_and_type.css` uses `Gotham` as a comment alias for Plus Jakarta Sans — Gotham is licensed and unavailable; Plus Jakarta Sans is the approved substitute throughout.

**Type scale (px, modular 1.25):** 11 / 13 / 15 / 17 / 20 / 24 / 30 / 38 / 48 / 60

**Semantic roles:**
```
Display  — EB Garamond 60px / weight 400 / leading 1.15 / tracking -0.02em
H1       — EB Garamond 48px / weight 400 / leading 1.15
H2       — Plus Jakarta Sans 38px / weight 600 / leading 1.3
H3       — Plus Jakarta Sans 24px / weight 600 / leading 1.3
Body     — Plus Jakarta Sans 15px / weight 400 / leading 1.7
Caption  — Plus Jakarta Sans 13px / weight 400 / leading 1.5
Label    — Plus Jakarta Sans 13px / weight 500 / leading 1.15 / tracking 0.04em
Overline — Plus Jakarta Sans 11px / weight 600 / uppercase / tracking 0.08em
Code     — JetBrains Mono 13px / weight 400
```

### Spacing, Radii, Shadows

```
Space scale: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64px

Radii:
  sm: 4px   md: 6px   lg: 8px   xl: 12px   pill: 20px

Shadows:
  sm:  0 1px  4px rgba(0,0,0,0.10)
  md:  0 2px  8px rgba(0,0,0,0.12)
  lg:  0 4px 24px rgba(0,0,0,0.18)
  xl:  0 8px 40px rgba(0,0,0,0.22)
  brand: 0 2px 12px rgba(128,0,0,0.30)
```

---

## Application Layout

Full-viewport single-page app. No scrolling outer container.

```
┌─────────────────────────────────────────────┐
│ Top Bar — fixed 54px, full width, z:70      │
├─────────────────────────────────────────────┤
│                                             │
│  Content area — position:absolute inset:0   │
│  (map fills this area when active)          │
│                                             │
└─────────────────────────────────────────────┘
```

### Top Bar
- **Height:** 54px  
- **Background:** transparent in idle; `rgba(245,240,232,0.9)` + `backdrop-filter:blur(6px)` when map is visible  
- **Border-bottom:** `1px solid var(--rule)` when map visible, transparent in idle  
- **Contents (L→R):**
  1. Logo button: UChicago shield (36px) + "CampusGeo" in EB Garamond 18px maroon + "University of Chicago" overline 8px
  2. `flex: 1` spacer
  3. Bell icon button (36×36px, border radius 8px): opens DigestPanel; maroon 8px dot badge when unseen
  4. "New search" button (appears when phase ≠ idle): cream bg, 12px weight 600

---

## Screens & Views

### Screen 1 — Idle (Hero)

**Phase:** `idle`  
**Layout:** vertically and horizontally centered column, max-width 680px

**Elements (top → bottom):**
1. UChicago shield — 52px, centered
2. "CampusGeo" — EB Garamond 42px, weight 500, color `--maroon`, letter-spacing -0.01em, margin-top 18px
3. Subtitle — Plus Jakarta Sans 16px, color `--ink-md`, `"University of Chicago · AI Geospatial Agent"`, margin-top 4px
4. Rule — `1px solid var(--rule)`, margin 28px 0
5. SearchBar — full width (see SearchBar spec below)
6. Suggestion chips — horizontal flex-wrap row, gap 8px, margin-top 18px

**Suggestion chips:**
- Background: `--cream` · Border: `1px solid var(--rule)` · Border-radius: 20px · Padding: 8px 16px
- Font: Plus Jakarta Sans 13px weight 500 color `--ink-md`
- Hover: background `--paper-dk`
- Click: fires submit with the chip's text

**Suggestion count:** controlled by Tweaks panel (`exampleCount`, default 3). One Chinese example when `showChinese: true`.

---

### Screen 2 — Thinking (Reasoning Trace)

**Phase:** `thinking`  
**Layout:** full-screen paper background, centered column max-width 560px, top-padding 80px

**Structure:**
1. **Query bubble** — EB Garamond 16px italic, white text on maroon `#800000` background, border-radius `14px 14px 4px 14px`, padding 11px 16px, max-width 85%, aligned right, box-shadow brand
2. **Agent header** — amber zap icon (26×26px rounded-7 amber-tint bg) + "CampusGeo Agent" overline amber text, margin-top 14px
3. **Step list** — 5 steps revealed sequentially (see timing below)

**Step anatomy:**
- Left column: 28px circle — pending (cream bg + rule border) / active (amber spin loader) / complete (green-bg + green check icon)
- Vertical connector line: 1.5px, rule when pending, green-bd when complete
- Right column: step label (13.5px weight 600) + detail text (12px `--ink-md`) + optional attribute table

**Step sequence + timing (ms after submit):**
```
Step 1 "Interpreting your request"    → 400ms
Step 2 "Searching campus GIS layers"  → 1100ms
Step 3 "Reading attribute table"      → 2250ms   (renders AttrTable)
Step 4 "Found field `fieldName`"      → 3500ms
Step 5 "Plotting locations…"          → 4600ms
Trace complete                        → 5700ms
Map/composer revealed                 → 6250ms
```
Animation per step: `fadeUp 0.35s ease-out` (translateY 10px → 0, opacity 0 → 1)

**AttrTable** (renders on step 3):
- Grid columns: per-scenario (e.g., `58px 1fr 78px 92px` for buildings)
- Header: 9px uppercase weight 700 `--ink-lt`, background `--paper-dk`; highlighted column uses `--amber-tint` bg + `--amber` text
- Rows: 11px JetBrains Mono, alternating hit row shown in green weight 700
- Footer row: "… N more rows" in `--ink-xlt` 9.5px mono

---

### Screen 3 — Composing (Print Composer)

**Phase:** `composing`  
**Layout:** full-screen MapLibre map + PrintComposer overlay

**MapLibre GL map:**
- Style: custom warm-grayscale vector tiles via `openfreemap.org`
- Background: `#ECE7DC`  
- Water: `#DAD7CC`
- Buildings (basemap): `#E3DDD0`
- Roads (minor): `#E5E0D4` · (major): `#E0DACB`
- Hit features: maroon fill `rgba(128,0,0,0.34)` + maroon stroke `#800000` 1.7px
- Context features: `#C9BCA6` fill 0.45 opacity + `#A89B86` stroke 0.6px
- Trees (2025): green fill `#2E7D52` + white stroke 1.8px + green halo circle
- Buffer ring: dashed maroon stroke (dash `[3,3]`) + `rgba(128,0,0,0.07)` fill
- `preserveDrawingBuffer: true` (required for canvas export)
- Min zoom: 13.5 · Max zoom: 19

**Page frame overlay:**
- Centered absolutely at 50%/50%
- Size: landscape Letter = 11×8.5in ratio; A4 = 11.69×8.27in; Tabloid = 17×11in
- Base height: `min(560, max(320, viewport_height - 300))px`, scalable by user (0.6× → 1.4×)
- Spotlight: `box-shadow: 0 0 0 9999px rgba(26,21,14,0.5)` on the page frame element
- Outline: `1px solid rgba(255,255,255,0.9)`
- Crop corners: 16×16px L-shaped 2px white lines at each corner, `drop-shadow(0 0 2px rgba(0,0,0,0.4))`
- Draggable by the title banner (pointer events)

**Title banner (top-left of page frame):**
- Background: `rgba(250,247,242,0.94)` + blur(3px) + border `1px solid --rule` + radius 8px
- Padding: 9px 12px · Drag handle (cursor: grab)
- Editable title input: EB Garamond 20px weight 600 color `--ink`, no border/bg
- Subtitle: "University of Chicago · Hyde Park Campus · Facilities GIS" — 10.5px `--ink-md`
- UChicago shield 34px at right

**Legend (bottom-left of page frame):**
- Same frosted card style (blur, cream bg, rule border, radius 8)
- "LEGEND" overline 9px weight 700 `--ink-lt` uppercase tracking 0.08em
- Each item: colored swatch (square 11px or circle 5px radius) + 11px label
- Sub-items: 9px swatch, `--ink-md` text

**Scale bar + north arrow (bottom-right of page frame):**
- 4-segment alternating black/white bar, computed from map's meters-per-pixel
- Nice round values: 50/100/200/500/1000/2000/2500/5000/10000 ft
- Scale readout: JetBrains Mono 9px; turns green + bold when engineering scale is matched (±3%)
- North arrow: custom SVG polygon, 30×38px

**Composer toolbar (bottom-center, fixed, outside page frame, z:60):**
- Background: `--cream` + rule border + radius 14px + shadow xl
- Controls: Paper size select · Landscape/Portrait toggle · Frame size stepper · Map zoom stepper · Cancel · "Print map" (maroon CTA)
- "Print map" triggers canvas capture → composite PNG download (see `onPrint` in prototype)

**Hint strip (top-center, z:65):**
- "Drag the title bar to reposition · pan & zoom the map to frame your print"
- Amber move icon + frosted pill

---

### Screen 4 — Editing (Attribute Edit Review)

**Phase:** `editing`  
**Layout:** full-screen map (same as composing) + EditReview card (top-right)

**EditReview card:**
- Position: `absolute top:74px right:22px`, width 374px, z:60
- Background: `--cream` + rule border + radius 14 + shadow xl

**Review state (before confirm):**
- Amber "Proposed edit" header with pen icon + BD_ID chip (mono 11px)
- Building name in EB Garamond 21px weight 600
- Field identifier: `Campus Buildings · field 'DISCRIPT1'` in `--ink-lt`
- Diff section: "Current" (line-through `--ink-lt`) → "Proposed" (weight 600 `--ink`)
- Disclaimer: 11px `--ink-lt` "Applies to the working copy … source geodatabase is not modified"
- Actions: "Discard" (ghost) · "Apply edit" (maroon CTA with check icon)

**Applied state (after confirm):**
- Green checkmark circle header (30px, green-bg/green-bd)
- "Attribute updated" 14px weight 700 + field/BD_ID in mono 10.5px
- New value in EB Garamond 21px weight 600
- Strikethrough old → new value diff (12px)
- "Saved to the edit log on this device…" disclaimer
- Actions: "Undo edit" (ghost) · "New search" (maroon)

**Persistence:** edits are saved to `localStorage` key `campusgeo-edit-log` as `[{ key, field, from, to, ts }]`. Reloading the app replays all saved edits against the GeoJSON before it's stored in state.

---

### Screen 5 — Provenance (Sync Report)

**Phase:** `provenance`  
**Triggered by:** any query matching the sync-intent regex (see `detectSyncIntent` in prototype)  
**Layout:** centered column max-width 664px, top-padding 80px

**Structure:**
1. Query bubble (same as Screen 2)
2. Agent header with refresh icon (amber)
3. **Editorial answer headline** — EB Garamond 30px weight 500: `"Campus data is current as of today, 02:00 CT."`
4. Body copy — 14px `--ink-lt` explaining the nightly sync
5. **Source card** (2-col grid):
   - Left: source name, type, webmap ID (truncated mono), "View source map" link (maroon)
   - Right: sync schedule, EventBridge cron, "Next run ≈ Nh" with clock icon
6. **Sync log** — last 5 of 30 runs; date/time mono + summary text + status badge:
   - `applied`: green pill · `skipped`: gray pill · `held`: amber pill
7. **Pipeline strip** — mono chips joined by `→` arrows: `ArcGIS REST → Diff → Validate → LLM QA → S3 + DynamoDB → CloudFront → Notify`
   - LLM QA chip: amber-tint bg + amber text + amber border (differentiated)
8. **Prose footnote** — 12px `--ink-lt` explaining the diff/QA/hold logic
9. **"Run sync now" card** — inline progress bar (maroon, 1.7s animation) + status copy + CTA button
10. SearchBar (persistent after the report)

---

### Screen 6 — Unrecognized Query

**Phase:** `unrecognized`  
**Layout:** centered column, same as Thinking

**Contents:**
- Query bubble
- Agent header (amber zap)
- Unrecognized message: Plus Jakarta Sans 15px `--ink-md` explaining scope limits
- Bilingual: English or Chinese depending on the input language
- SearchBar to retry

---

### DigestPanel (Bell dropdown)

Opened by the bell icon in the top bar. `position:absolute top:46px right:0`, width 344px, z:80.
- Header: "Daily digest" 13px weight 700 + date + "02:00 sync" label
- 3 digest items: icon (amber, 28px rounded-7 card) + headline + detail + sub (mono)
  - First item has "Open feature card →" button (maroon)
- Footer: "View full sync report →" (fires the sync-intent query)

**DigestToast** (auto-shown 1.4s after load, auto-dismissed 11s):
- `position:absolute top:64px right:18px`, width 334px, z:90
- Slide-in animation: `translateX(22px) → 0` in 0.4s `cubic-bezier(0.4,0,0.2,1)`
- Green dot badge + "Daily digest · new" overline
- Headline + detail + "Open feature card" (maroon) + "Dismiss" (ghost)

---

## SearchBar Component

Used in Idle (large) and after results (small).

```
Large: border-radius 14px, padding 4px 4px 4px 18px, font-size 17px
Small: border-radius 11px, padding 3px 3px 3px 15px, font-size 15px
```

- Default border: `1.5px solid var(--rule)`
- Focused border: `1.5px solid var(--maroon)` + box-shadow `0 0 0 4px var(--maroon-ring), 0 8px 28px rgba(0,0,0,0.08)`
- Left icon: maroon Zap (19px large / 16px small)
- Input: font-family Gotham stack (Plus Jakarta Sans substitute), font-style normal, letter-spacing 0.01em
- Placeholder: `"Ask CampusGeo to find, map, or print campus data…"` — color `--ink-xlt`
- Submit button: `background: --maroon` when value present, `--paper-dkr` when empty
  - Label: "Ask" + ↑ arrow icon
  - `box-shadow: 0 2px 10px rgba(128,0,0,0.3)` when active
  - Transition: `all 0.15s`
- Submit on Enter keydown

---

## Intent Routing (Client-Side Prototype Logic → Server-Side in Production)

The prototype detects intent client-side for demo purposes. **In production, all of this logic moves to the Lambda `src/agent/tools/` layer via Claude API tool use.** The client sends the raw query string; the server returns a structured scenario object.

**7 intents** (see `Intent Taxonomy.html` for the full schema):

| Intent | Tool name | Trigger (prototype) | Phase |
|---|---|---|---|
| Locate | `locate_feature` | Named building matched in GeoJSON | 1 |
| Filter | `filter_features` | Attribute predicates (RI, year, etc.) | 1 |
| Proximity | `features_within` | "within Xm/ft of Y" | 1 |
| Aggregate | `aggregate_features` | "how many", "total area" | 1 |
| Rank | `rank_features` | "tallest", "oldest", top-N | 1 |
| Assess condition | `assess_condition` | FCI, elevator, heritage | 2–3 |
| Suitability | `analyze_suitability` | "suggest sites for…" | 3 |
| Data freshness | *(sync intent)* | "when was data updated" | 1 |
| Attribute edit | `edit_attribute` | "change/rename X to Y" | 1 |

**Engineering scale parser:** `"1'' = 50'"` / `"1:600"` → locks print page to that scale via meters-per-pixel calculation. Pattern: `/1\s*(?:''|")\s*(?:=)?\s*(\d+)\s*(?:'|ft)/`

**Bilingual:** intent detection works on both English and Chinese. Same tool call, same response — compose the Editorial Answer in the input language.

---

## State Machine

```
idle ──[submit]──▶ thinking ──[trace complete + delay]──▶ composing (map+print)
                                                        ├──▶ editing  (map+edit review)
                                                        └──▶ provenance (sync report)
     ──[submit, no match]──▶ unrecognized

[New search / reset] → idle from any state
```

**Key state variables:**
```typescript
phase:       'idle' | 'thinking' | 'composing' | 'editing' | 'provenance' | 'unrecognized'
sc:          Scenario | null          // active scenario object
submitted:   string                   // the query that produced sc
shown:       number                   // reasoning steps revealed (0-5)
traceDone:   boolean
buildings:   FeatureCollection | null // loaded from GeoJSON, cached in state
title:       string                   // editable map title
mpp:         number                   // meters-per-pixel (from MapLibre moveend)
editState:   'review' | 'applied' | null
digestSeen:  boolean
toast:       boolean                  // DigestToast visible
```

---

## Assets

| File | Usage |
|---|---|
| `uchicago-shield.png` | Logo in top bar + print title banner (light bg) |
| `uchicago-shield-white.png` | Logo on dark/maroon backgrounds |
| `uchicago-shield.svg` | Vector version for high-res contexts |
| `uchicago-wordmark.svg` | "The University of Chicago" full wordmark |
| `phoenix.svg` | Phoenix mark (alternate brand asset) |
| `campus-buildings.geojson` | 308 building footprints, 40+ attribute fields |

**Key GeoJSON fields used in the prototype:**
```
OBJECT_ID, BD_ID, LOC_ID         — identifiers
DISCRIPT1, Facility_Name,
OtherNames, Building_Code        — name matching
ADDRESS                          — display
Year_Completed                   — filter / rank
BLDG_HGT                        — rank (tallest)
Gross_Area__s_f__                — aggregate
PROPERTY_S                       — owned / leased
FCI__                            — condition index (0=good, >0.3=poor)
RI_                              — resilience index (prototype uses this as RI value)
RICOST, RI_COST_Total            — deferred maintenance cost
CHRS                             — heritage classification
Elevator                         — ADA proxy
Heritage                         — historic designation flag
Lat, Lon                         — centroid (supplement to geometry)
geometry                         — Polygon footprint (WGS84)
```

---

## Motion & Animation

All keyframes are defined in the prototype's `<style>` block. Reproduce them as CSS:

```css
@keyframes ccFadeUp  { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
@keyframes ccFade    { from { opacity:0 } to { opacity:1 } }
@keyframes ccPop     { from { opacity:0; transform:scale(0.96) } to { opacity:1; transform:scale(1) } }
@keyframes ccSpin    { to { transform:rotate(360deg) } }
@keyframes ccPulse   { 0%,100%{opacity:1} 50%{opacity:0.35} }
@keyframes ccProgress{ from{width:0} to{width:100%} }
@keyframes ccSlideIn { from{opacity:0;transform:translateX(22px)} to{opacity:1;transform:translateX(0)} }
```

**Usage:**
- All overlays, cards, reasoning steps: `ccFadeUp 0.35–0.45s ease-out`
- Toast: `ccSlideIn 0.4s cubic-bezier(0.4,0,0.2,1)`
- Page frame: `ccFade 0.4s ease-out`
- Progress bar (sync card): `ccProgress 1.7s cubic-bezier(0.4,0,0.2,1) forwards`
- Active step loader: `ccSpin 0.7s linear infinite` (13px circle, border-top amber)
- Map reveal: `ccFade 0.6s ease-out`

**Hover states:** subtle background shifts only — no `transform:scale`. Transition `all 0.15–0.18s`.

---

## Copy Constants

All user-facing strings should flow through `src/copy.ts` (per `CLAUDE.md`). Key strings:

```typescript
export const copy = {
  searchPlaceholder: "Ask CampusGeo to find, map, or print campus data…",
  agentName:         "CampusGeo Agent",
  unrecognizedEn:    "I couldn't match your request to a campus GIS layer. Try a named place ("Keller Center"), a layer ("trees planted last year"), or an attribute filter ("RI above 0.52").",
  unrecognizedZh:    "抱歉，我无法识别您的请求。可以试试具体地点（如 "Keller Center"）、图层（如"去年种植的树木"）或属性筛选（如 "RI 大于 0.52"）。",
  editDisclaimer:    "Applies to the working copy of this layer on this device and is logged for review. The source geodatabase is not modified.",
  editApplied:       "Saved to the edit log on this device — future searches and map labels use the new value.",
  loading:           "Querying campus data",
  noFeatures:        "No features match this query.",
  syncHeadline:      "Campus data is current as of today, 02:00 CT.",
  printHint:         "Drag the title bar to reposition · pan & zoom the map to frame your print",
  composerSubtitle:  "University of Chicago · Hyde Park Campus · Facilities GIS",
  digestTitle:       "Daily digest",
  newSearch:         "New search",
  runSyncNow:        "Run sync now",
  viewSyncReport:    "View full sync report",
};
```

Voice rules (from `CLAUDE.md`): precise, never breezy, no exclamation marks, no emoji, no "Oops", no "Powered by AI". Buttons are verbs.

---

## What Is Not Yet Built (Phase 1 Remaining)

| Item | Owner | Notes |
|---|---|---|
| Upload campus GeoJSON to S3 | Backend | See ETL toolkit in root — `convert_gdb.py` already done |
| DynamoDB layer metadata table | Backend | Layer schemas, update timestamps |
| Lambda: S3 + Turf.js query engine | Backend | Replace prototype's client-side `buildScenario()` |
| Lambda: Claude API tool use (intent classification) | Backend | `src/agent/tools/` — use Intent Taxonomy as schema |
| Fix Lambda TypeScript errors | Backend | Blocking deployment |
| S3 + CloudFront deploy (frontend) | Infra | |
| API Gateway + Lambda deploy | Infra | |
| Notify step (SNS/Slack) | Backend | Notify copy template: see Phase 4 section in CLAUDE.md |
| Real ArcGIS → diff → validate pipeline | Backend | EventBridge cron, Phase 4 |

---

## Three-Question Ship Check

Before considering any view done (per `CLAUDE.md`):

1. Does this look like an editorial publication that happens to be interactive, or a generic SaaS dashboard?
2. Is the map clearly the most important element on screen when visible?
3. With color removed, does the typographic hierarchy still carry the design?

If any answer is no, redo it.
