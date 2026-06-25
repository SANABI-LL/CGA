# Handoff: CampusGeo — UChicago AI Geospatial Agent

> **Read this first.** This bundle is a **design reference**, not production code. The files here are an HTML/React prototype that defines the intended *look, copy, motion, and agent behavior* of CampusGeo. Your job in Claude Code is to **recreate these designs in the real codebase** (React 18 + Vite + ArcGIS Maps SDK, per `CLAUDE.md`), wiring them to a *real* Claude agent + AWS backend — **not** to ship this HTML. The prototype's "agent" is a front-end simulation (regex intent-matching + scripted reasoning traces); the real implementation replaces that simulation with genuine Claude tool-use.

---

## Overview

CampusGeo is a natural-language interface to the University of Chicago campus geospatial database. A user asks a question in English or Chinese; the system interprets intent, queries campus GIS data (GeoJSON on S3), and returns an **editorial answer** plus a styled map — or a print-ready map sheet. The aesthetic is "spatial intelligence as scholarship": a typeset field guide that happens to be interactive, **not** a SaaS dashboard or chatbot.

This handoff covers the **primary prototype** — `print-flow.html` — which is the approved visual/interaction reference for the whole product. It demonstrates five resolved flows:

1. **Attribute query** → editorial answer + map (e.g. "buildings with RI > 0.52")
2. **Engineering-scale print** → fixed-scale map composer (e.g. "1″ = 50′ near Keller Center")
3. **Attribute edit** → propose-then-confirm review card (e.g. rename a building)
4. **Data freshness / sync** → editorial provenance report of the nightly ArcGIS→S3 pipeline
5. **Daily digest** → notification of changes pulled from the source web map (bell + toast)

## Fidelity

**High-fidelity (hifi).** Final colors, typography, spacing, copy, motion, and interaction states are all specified and should be recreated faithfully. Exact tokens are listed below; the authoritative values are the inline `T` token object in `print-flow.html` (mirrored in the **Design Tokens** section here). Recreate the UI pixel-faithfully using the target codebase's libraries, then connect to real services.

> **Token note:** there are two token sources in the project. The shipped prototype (`print-flow.html`) uses a **warm-paper light theme** (the `T` object — `paper #F5F0E8`, `ink #2A2218`). The separate `colors_and_type.css` describes a broader DS palette including a **dark "greystone" map-canvas theme**. For the screens in this handoff, **the prototype's light `T` palette is the source of truth.** Treat `colors_and_type.css` as the wider design-system reference (semantic token names, type scale, spacing/radii/shadows) to formalize in code.

---

## Screens / Views

All views render inside one full-viewport app shell on a `--paper` background. A thin top bar holds the shield logo (left) and, right-aligned, a **daily-digest bell** and a **New search** button (the latter only once a query is active). State drives which view shows.

### 1. Idle hero (landing)
- **Purpose:** entry point; user types or clicks an example chip.
- **Layout:** vertically centered single column, `max-width: 560px`, centered horizontally. Shield logo, then a Garamond display headline, then the search bar, then example-query chips, then a freshness status line.
- **Components:**
  - **Shield logo** — `uchicago-shield.png`, rendered ~40–46px tall, natural aspect.
  - **Headline** — EB Garamond, ~48px, weight 400, `--ink`, `line-height 1.1`. Copy: *"Ask the campus."* (or equivalent scholarly prompt — match prototype).
  - **Search bar** — pill input, `--cream` fill, `1px --rule` border, radius 11px. Placeholder: `"Ask about the campus —"` (em dash). Right-aligned **Ask** button: `--maroon` fill when input non-empty (`--paperDkr`/`--inkLt` disabled when empty), white text, weight 700, radius 11px, shadow `0 2px 10px rgba(128,0,0,0.3)`, with an up-arrow icon.
  - **Example chips** — horizontal wrap, `gap`-spaced. Each chip: `--cream` fill, `1px --rule`, radius pill, `--inkMd` text ~13px. Clicking submits that query. **Count and language are tweakable** (see Tweaks): default **3 chips, English only**.
  - **Freshness line** — small `--inkXlt` button-row with a green live-dot (`--green`, ring `--greenBg`): *"47 layers · synced from the campus ArcGIS web map · updated today 02:00 CT"*. Clicking runs the sync report.

### 2. Reasoning trace (thinking)
- **Purpose:** show the agent interpreting the request before an answer.
- **Layout:** centered column, `max-width 560px`. The user's query shown as a maroon right-aligned bubble (Garamond italic), then a vertical stepper.
- **Components:** 4–5 **steps**, each a 28px circular node (border `--rule` idle → `--amber` active → `--greenBg`/`--greenBd` complete) with an icon, a bold label, and a mono/`--inkMd` detail line. Steps reveal sequentially (`ccFadeUp`, staggered). Step sets differ per intent — e.g. the **sync** flow is: Interpret → Check pipeline → Query source ArcGIS web map → Diff against published GeoJSON → Read sync log.

### 3. Editorial answer + map (query result)
- **Purpose:** answer a data question.
- **Layout:** **map-dominant** — map fills the left/main ~62–70%; an editorial sidebar is offset right. Follows the **Editorial Answer pattern**: (a) one-line plain-English answer in Garamond 28–32px; (b) structured data / attribute table in Plex/JetBrains Mono; (c) footnote-style provenance prose at the bottom.
- **Components:** map with warm-grayscale basemap; result features stroked `--maroon` 2px, fill ~18% opacity; legend chips; attribute table with monospaced keys; a layer chip (e.g. "Campus Buildings"). North arrow + scale bar are **custom-drawn in mono**, not SDK defaults.

### 4. Print composer (engineering scale)
- **Purpose:** produce a fixed-scale, print-ready map sheet (e.g. 1″ = 50′).
- **Layout:** a page-like map sheet with a title block (shield + title + scale readout). The requested engineering scale **overrides auto-fit**; a green scale readout confirms the locked scale. Movable/zoomable composer.
- **Components:** title block with `uchicago-shield.png`; mono scale bar; north arrow; query features in maroon.

### 5. Attribute-edit review card (propose → confirm)
- **Purpose:** edit a feature attribute (e.g. rename a building) **with review before apply** — decision-support, never silent writes.
- **Layout:** map zooms to the target parcel; a **right-docked card** (`width 374px`, `top 74px`, `right 22px`, `--cream`, radius 14px, shadow `0 14px 44px rgba(0,0,0,0.22)`).
- **Components / states:**
  - **review** state: amber "Proposed edit" pill; current value struck through; proposed value bold; parcel/BD_ID chip; note that the source geodatabase is untouched; **Discard** (ghost) + **Apply edit** (maroon, check icon) buttons.
  - **applied** state: green check; "Attribute updated"; from→to summary; **Undo edit** + **New search** buttons.
- **Persistence:** applied edits are written to a `localStorage` log (`campusgeo-edit-log`) and re-applied on load so later searches resolve the new name. (In production this becomes a server-side change-history record — see below.)

### 6. Data provenance / sync report
- **Purpose:** answer "when was the data last updated / what changed / where does it come from".
- **Layout:** centered editorial column, `max-width 664px`. Query bubble → agent label → Garamond "current as of" headline → source/schedule strip → recent-syncs log → pipeline chain → footnote prose → an off-schedule "Run sync now" card with a 2px maroon top progress bar → a follow-up search bar.
- **Components:**
  - **Source / schedule** two-column strip: "Source of truth" (UChicago Campus GIS · ArcGIS Online web map · 47 layers · webmap id · **View source map** link) and "Sync schedule" (Daily · 02:00 CT · America/Chicago · EventBridge cron · next run countdown).
  - **Recent syncs** table: date/relative, summary, status pill — statuses `applied` (green), `no changes` (neutral), `held for review` (amber, the LLM-QA anomaly gate).
  - **Pipeline chain:** `ArcGIS REST → Diff → Validate → LLM QA → S3 + DynamoDB → CloudFront → Notify` (LLM QA highlighted amber).

### 7. Daily digest (notification)
- **Purpose:** tell the user what the nightly sync changed.
- **Components:**
  - **Bell** in top bar with an unread maroon dot until opened.
  - **Toast** (one per load, slides in top-right after ~1.4s, auto-dismiss ~11s): headline change, e.g. *"Building renamed: 5460 S University Ave → Lorraine and Yuji Suzuki Center"*, with **Open feature card** + **Dismiss**.
  - **Panel** (bell click): list of digest items (rename, "12 trees added", "2 more names updated"), each sourced to its layer; rename row has **Open feature card** (jumps to that building's site plan); footer **View full sync report**.

### 8. Unrecognized
- Plain editorial message, no emoji/apology. EN: *"I couldn't match your request to a campus GIS layer. Try a named place, an attribute, or 'what changed this week'."* ZH equivalent shown for Chinese input. (When an edit parses but no building matches, a specific message names the parsed field + value.)

---

## Interactions & Behavior

- **Intent routing (prototype):** `detectSyncIntent` → `parseEditIntent` → map/print/query scenario builder, in that precedence. **Replace this with real Claude tool-use** (see State/Backend).
- **Submit:** Enter or Ask button → reasoning trace → resolved view.
- **Engineering scale** (e.g. `1″ = 50′`, `1:600`) is parsed and **locks** the map scale, overriding auto-fit; a green readout confirms.
- **Edit flow:** propose → user confirms → apply to working copy + map source + log; Undo reverts.
- **Digest:** toast appears once per load (prototype uses session, not persisted, for reliable demos); opening the bell clears the unread dot.
- **Run sync now:** simulated 1.7s pull with a maroon top progress bar, then "already up to date".

### Motion (binding — from `CLAUDE.md`)
- Default easing `cubic-bezier(0.4, 0, 0.2, 1)`, duration 280–400ms.
- Entrance: staggered fade-up 8px (`ccFadeUp`), delays 0/80/160/240ms.
- Map markers: scale-from-92% + opacity 0→1. No bounce/spring.
- Selected feature: 3px maroon stroke + **4-second** radiating pulse (never faster).
- **No spinning circle loaders** for primary loading — use a 2px maroon top progress bar or `--paperDeep` skeletons. Loading copy in mono, e.g. "Querying campus data…". (A tiny inline spinner exists only on the secondary follow-up control.)
- Hover = subtle color shift, never transform/scale.

### Voice (binding)
Field-guide, scholarly, precise. No exclamation marks, no emoji, no "Oops", no "Powered by AI". Buttons are verbs ("Map results", "Reset view", "Open feature card"). All user-facing strings should flow through a single `copy.ts` in the real codebase.

---

## State Management

Prototype `App` state (recreate with the codebase's patterns; keep ArcGIS view objects **out** of React state):
- `phase`: `idle · thinking · composing · editing · provenance · unrecognized`
- `query` / `submitted`, `shown` (trace step index), `traceDone`
- `sc` (resolved scenario), `printing`, `title`, scale/fit commands
- `editState`: `null · review · applied`; `unrecMsg`
- `digestOpen`, `digestSeen`, `toast`
- `buildings` (GeoJSON, with nightly `SOURCE_UPDATES` + local edit-log applied on load)
- Tweaks: `exampleCount` (2–6, default 3), `showChinese` (default false)

### What "real" requires (the prototype simulates these)
- **Real agent:** `src/agent/llm.ts` provider-agnostic interface → Claude tool-use loop. Tools in `src/agent/tools/` (`query_features`, `update_feature_attribute`, `check_ada_compliance`, …), each `{name, description, input_schema, handler}`. Server-side proxy; never expose the key.
- **Data:** GeoJSON on **S3**, metadata in **DynamoDB**, spatial filtering via **Turf.js** in Lambda (parse + cache in module scope / `/tmp`; warm p95 < 2s).
- **Nightly sync:** EventBridge (02:00 CT) → Lambda pull from ArcGIS REST → diff → validate → optional **LLM QA** anomaly check → write S3 + DynamoDB → invalidate CloudFront → SNS notify. Write a human-readable **digest record** the frontend reads on load (this is exactly what screens 6–7 visualize).
- **Edits:** `update_feature_attribute` writes with the same **propose→confirm** contract + a server-side change-history log.

---

## Design Tokens

**Authoritative prototype palette (light/paper — `T` object in `print-flow.html`):**

| Token | Hex | Use |
|---|---|---|
| maroon | `#800000` | primary brand, CTAs, result features (≤5% of screen) |
| maroonDk | `#5A0000` | pressed |
| maroonLt | `#A82020` | hover |
| maroonTint | `rgba(128,0,0,0.08)` | soft fills |
| maroonRing | `rgba(128,0,0,0.2)` | focus rings |
| amber | `#B07830` | secondary accent, agent label, LLM-QA highlight |
| amberLt | `#D4A84E` | — |
| amberTint | `rgba(176,120,48,0.12)` | amber chip fills |
| paper | `#F5F0E8` | primary background |
| paperDk | `#EDE6D8` | secondary surface |
| paperDkr | `#E2D9C8` | disabled fill |
| cream | `#FAF7F2` | cards, inputs |
| ink | `#2A2218` | primary text |
| inkMd | `#5A5046` | secondary text |
| inkLt | `#8C8070` | tertiary |
| inkXlt | `#B5ADA0` | captions/labels |
| rule | `#D8CFC0` | hairline borders |
| ruleLt | `#E8E2D8` | lighter dividers |
| ruleDk | `#C0B5A5` | stronger rule |
| green | `#2E7D52` | success/live status |
| greenBg | `rgba(46,125,82,0.12)` | success fill |
| greenBd | `rgba(46,125,82,0.3)` | success border |
| blue | `#2060A0` | info |
| white | `#FFFFFF` | text on maroon |

**Map basemap (custom, warm grayscale — from `CLAUDE.md`):** buildings `#d4cfc0`, paths `#e8e3d6`, parks `#c8cfb5`, water `#c4cdd6`. Buffer geometries: dashed maroon stroke (dash 4 4), maroon fill ~8%.

**Typography** (prototype): display/headline **EB Garamond** (substitutes Adobe Garamond; `CLAUDE.md` calls for **Fraunces** — confirm which to standardize on), UI/body **Plus Jakarta Sans** (substitutes Gotham; `CLAUDE.md` body is **IBM Plex Sans**), mono **JetBrains Mono** (`CLAUDE.md` mono is **IBM Plex Mono**). **Reconcile fonts at kickoff** — `CLAUDE.md` is binding for the real build (Fraunces + IBM Plex Sans + IBM Plex Mono); the prototype used near-substitutes. Type scale, weights, line-heights, spacing (`--space-1..16`), radii (`--radius-sm..full`), and shadows are fully specified in `colors_and_type.css` — port these as the formal token set.

- Body line-height 1.6; display 1.05–1.15. Tight tracking (−0.015 to −0.025em) only at ≥32px. **Never** letter-space body text.

---

## Assets

In this bundle (copied from the project), all official UChicago marks:
- `uchicago-shield.png` — official shield, maroon (top bar, hero, print title block).
- `uchicago-shield-white.png` — reversed/knockout for dark or maroon backgrounds.
- `phoenix.svg`, `uchicago-shield.svg`, `uchicago-wordmark.svg` — vector marks (embed the official shield).
- `campus-buildings.geojson` — sample campus buildings layer (308 buildings, WGS84). Building **L31** is the rename demo target (`DISCRIPT1`: "5460 S University Ave" → "Lorraine and Yuji Suzuki Center").

Icons in the prototype are inline 24×24 stroke SVGs (`Ic` component, stroke-width 1.6). Use the codebase's icon library (icons must communicate, not decorate — no decorative Lucide).

> If UChicago Brand provides an official **all-white** shield, drop it in over `uchicago-shield-white.png` (the bundled white version is a generated silhouette).

---

## Files

In this handoff folder:
- `print-flow.html` — **the primary reference prototype** (all screens above).
- `tweaks-panel.jsx` — the in-prototype Tweaks panel helper (example-count + language controls).
- `colors_and_type.css` — full design-system token set (colors, type, spacing, radii, shadows).
- `campus-buildings.geojson` — sample data layer.
- Logo assets (PNG + SVG) listed above.
- `CLAUDE.md` — **binding** project conventions, tech stack, voice, anti-patterns, and the 15–18-month roadmap. Read this before writing code.

Reference (in the main project, not copied): other prototype iterations live in `ui_kits/campusgeo/` (`index.html`, `improved-map*.html`) — earlier explorations; `print-flow.html` supersedes them.

---

## Suggested first steps in Claude Code
1. Read `CLAUDE.md` end-to-end; reconcile fonts (Fraunces + IBM Plex per the doc) and confirm light-paper vs. greystone theme scope.
2. Scaffold React 18 + Vite; port `colors_and_type.css` tokens; recreate the **idle hero** and **reasoning trace** as components.
3. Stand up `src/agent/llm.ts` + a real `query_features` tool against a local GeoJSON, replacing the regex router with a Claude tool-use loop.
4. Build the Lambda + S3 data path, then the EventBridge nightly sync that emits the digest record screens 6–7 consume.
5. Add an agent evaluation harness (a fixture set of questions → expected tool/layer/answer) — the missing piece called out in review.
