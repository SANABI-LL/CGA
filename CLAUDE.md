# CLAUDE.md — UChicago GIS Intelligence

This file defines the design language and engineering conventions for this project. Claude Code reads it on every session as part of the system context. When generating any UI code, treat the `<frontend_aesthetics>` block as binding, not aspirational.

> **Design-system note (this project):** the interactive prototype lives at `ui_kits/campusgeo/print-flow.html` and already follows the aesthetic direction below (warm paper, serif display, maroon accents, editorial cartography). Use it as the visual reference for any new screens.

---

## Project Identity

Natural-language interface to the University of Chicago campus geospatial database. Users ask questions in English or Chinese; the app interprets intent via Claude tool use, queries ArcGIS Feature Services, and visualizes results with explanatory editorial context.

Reference points for the aesthetic direction:
- **aino.world** — interaction model and information density
- **The Pudding (pudding.cool)** — data journalism typographic standard
- **Stripe Press** — typographic discipline, generous spacing, restrained color
- **Atlas Obscura field guides** — editorial cartography, scholarly tone
- **Kontinentalist** — Asian data journalism, paper-like backgrounds

This is part of a portfolio targeting GIS, AI, and PropTech roles. Every interface decision should reinforce "spatial intelligence as scholarship" — never "another AI chatbot wrapper."

---

<frontend_aesthetics>

## Aesthetic Direction: Editorial Cartography

Commit fully to a reference-atlas / data-journalism aesthetic. The interface should feel like a beautifully typeset field guide that happens to be interactive. Not a dashboard. Not a SaaS tool. Not a generic AI chat app.

**The map is the protagonist.** Everything around it is quiet, confident chrome that frames the data and gets out of the way.

## Typography

Use exactly these three families. Load from Google Fonts.

- **Display / headers** — Fraunces, variable. Optical sizing enabled. Weight 400 for section headers, 500–600 for hero text. Lean into Fraunces' SOFT and opsz axes at display sizes.
- **Body** — IBM Plex Sans. Weight 400 body, 500 emphasis. Letter-spacing 0 at body size.
- **Mono / technical** — IBM Plex Mono. For coordinates, attribute keys, query strings, feature IDs, data tables.

Typographic discipline:
- Use a real modular scale, not Tailwind defaults. Suggested px: 12 / 14 / 16 / 18 / 24 / 32 / 48 / 72.
- Body line-height 1.6. Display line-height 1.05–1.15.
- NEVER apply letter-spacing to body text. Use tight tracking (-0.015em to -0.025em) only on display sizes 32px and above.
- Pair Fraunces (serif display) with IBM Plex Sans (body) for contrast. Do not introduce a second serif or a second sans.

**Forbidden:** Inter, Roboto, Open Sans, Lato, Poppins, Montserrat, Nunito, Space Grotesk (overused), any system font stack as a primary choice.

## Color System

Use CSS custom properties throughout. The base palette is warm and paper-like — explicitly NOT the default dark-mode or glassmorphism choices.

```css
:root {
  /* Base — warm paper and ink, not pure black/white */
  --paper:        #f4f1ea;  /* primary background */
  --paper-deep:   #e8e3d6;  /* secondary surfaces, panels */
  --ink:          #1a1a1a;  /* primary text */
  --ink-soft:     #4a4a48;  /* secondary text */
  --ink-faded:    #8a8a85;  /* tertiary, captions, labels */

  /* Accent — UChicago maroon, sparingly */
  --maroon:       #800000;  /* CTAs, active states, key data */
  --maroon-deep:  #5c0000;  /* hover, pressed */

  /* Data viz — sequential warm palette for map choropleths */
  --data-1: #f4e4c1;
  --data-2: #e9b674;
  --data-3: #c97d3e;
  --data-4: #8b4513;
  --data-5: #4a2818;

  /* Functional */
  --rule:         #d4cfc0;  /* hairline borders, dividers */
  --highlight:    #fff4d6;  /* search-match background, soft yellow */
}
```

Color rules:
- Maroon appears on **at most 5% of the screen at any time**. It is punctuation, not decoration.
- Do not use color to convey nominal UI state — use weight, size, and rule lines instead.
- The map basemap is muted, warm grayscale. Never the default ArcGIS gray-blue.

**Forbidden:** purple gradients, blue-to-pink gradients, glassmorphism backdrop blurs, neon accents, pure #000 on pure #fff, Tailwind's default `gray-*` and `slate-*` ramps for body text.

## Spatial Composition

Print-influenced layout. Think New York Review of Books, not Notion.

- Strong vertical rhythm. Body text 17–18px, line-height 1.6.
- Generous outer margins. On desktop ≥1440px, content columns should never feel claustrophobic; use max-widths in the 640–760px range for prose.
- Primary section dividers are hairline rules (1px `var(--rule)`) — NOT cards with shadows.
- Asymmetric layouts welcome: map left-dominant (60–70% width), editorial sidebar offset right. Avoid centered "hero + three feature cards" patterns entirely.
- Hierarchy comes from type size and weight, not nested containers. Most surfaces should have NO border, NO shadow — just typography and whitespace.

The Editorial Answer pattern for query results (use this in the sidebar):

1. **One-line plain-English answer** in Fraunces, 28–32px. Example: "Forty-two trees were planted on campus in 2023."
2. **Structured data** below in IBM Plex Sans / Plex Mono — counts, species breakdown, attribute table.
3. **Contextual prose** at the bottom in body type, footnote-style — explaining what was queried, where the data came from, any caveats.

This pattern is the core differentiator from generic chatbot output. Use it consistently.

## Motion

Restrained. Editorial. Think turning a page, not a video game.

- Default easing: `cubic-bezier(0.4, 0, 0.2, 1)`. Default duration 280–400ms.
- Page entrance: staggered reveal on hero elements (animation-delay 0 / 80 / 160 / 240ms). Fade up 8px, no further.
- Map markers appear with brief scale-from-92% + opacity-0-to-1. No bounce, no spring.
- NEVER use spinning circle loaders. Use either: (a) a 2px top-of-screen progress bar in maroon, or (b) skeleton blocks at `var(--paper-deep)`. Loading copy is Plex Mono, e.g. "Querying campus data…".
- Hover states are subtle color shifts, not transforms. No `hover:scale-105`.
- NO scroll-jacking. NO parallax. NO horizontal scroll tricks. NO animated SVG mascots.

## Map Styling

The map is custom-styled. The default ArcGIS look is the enemy.

- Basemap: warm muted grayscale. Buildings `#d4cfc0`, paths `#e8e3d6`, parks soft sage `#c8cfb5`, water `#c4cdd6`.
- Default labels in IBM Plex Sans 11px, `var(--ink-soft)`. Place names matching the active query are elevated to Fraunces 13px italic.
- Query-result features: stroke `var(--maroon)` 2px, fill at 18% opacity. No drop shadows on map features ever.
- Selected feature: stroke 3px maroon + slow 4-second radiating pulse animation. Never faster than 4 seconds.
- Buffer geometries (e.g. "within 100m of Crerar"): dashed maroon stroke (dash 4 4), very faint maroon fill at 8%.
- North arrow and scale bar are custom-drawn in IBM Plex Mono, not the SDK defaults.

## UI Copy & Voice

The interface text is part of the aesthetic. Edit ruthlessly.

- Field guide / scholarly tone. Precise, never breezy. Never apologetic.
- Search placeholder: `"Ask about the campus —"` (em dash, not "What can I help you with?")
- Empty state: `"No features match this query."` (not "Oops! Nothing here yet.")
- Loading: `"Querying campus data"` (not "Just a moment!")
- Error: name the actual problem in one sentence. No emojis. No "Oops."
- Buttons: verbs. `"Map results"` / `"Reset view"` / `"Open feature card"`. Never "Submit", never "Click here", never "Get started".
- No exclamation marks anywhere in production UI copy.
- No emoji in UI copy. Emoji are acceptable in code comments only.

## Components — What to Refuse

These are AI-slop defaults. Do not generate them, even if a prompt is ambiguous:

- Card grids with `rounded-2xl shadow-lg hover:scale-105`
- Modal dialogs with gradient headers
- Tailwind `bg-gray-50` page backgrounds
- Lucide icons used decoratively (icons must communicate, not ornament)
- Sticky headers with `backdrop-blur`
- "Hero section with gradient text"
- Pill badges in Tailwind default colors
- Any visible string containing "Powered by AI" or "✨"
- Default shadcn/ui theme (the primitives are fine; the default styling is not — restyle aggressively)
- Right-side fixed chat bubble with a robot avatar

## Three-Question Ship Check

Before considering any view done, answer these:

1. Does this look like an editorial publication that happens to be interactive, or does it look like a generic SaaS dashboard?
2. Is the map clearly the most important element on screen?
3. With color removed, does the typographic hierarchy still carry the design?

If any answer is no, redo it.

</frontend_aesthetics>

---

## Commands

pnpm monorepo (`pnpm@9`, Node ≥20). Workspaces: `apps/*`, `packages/*`, `backend/lambdas/*`, `backend/dev-server`.

```bash
pnpm install          # all workspaces
pnpm dev:print        # ★ 当前主力前端：Print-a-Map 原型 UI (http://localhost:5173，直连生产 API)
pnpm dev              # 旧 React 前端（已弃用视觉方向，仅存代码参考）
pnpm dev:server       # local agent API (SSE) at http://localhost:3001 — needs AWS credentials for Bedrock
pnpm build            # frontend only (tsc -b && vite build)
pnpm build:all        # every workspace
pnpm typecheck        # tsc --noEmit across workspaces
pnpm lint             # eslint (only apps/web defines lint)
pnpm --filter @campusgeo/web typecheck   # single workspace
```

- **主力前端是 `CampusGeo Print-a-Map.html` 原型**（`pnpm dev:print` 服务于 5173）：`CampusGeo-with-Backend.html` = 从设计稿通过 `node scripts/build-with-backend.mjs` 生成（19 个 patch 全量构建，含真实 S3 字段名注入、AI 后端接线等）。每次修改设计稿或 `inject-backend.js` 后须重新运行该脚本。`backend-config.local.js`（gitignored，端点+key，模板见 `backend-config.example.js`）必须在本地手动维护。
- 旧 React 全链路（如需）= two terminals: `pnpm dev:server` + `pnpm dev`, with `apps/web/.env.local` containing `VITE_API_URL=http://localhost:3001`.
- `dev:server` needs AWS credentials in the environment (`AWS_PROFILE` or access keys) plus `AWS_REGION`; optional `BEDROCK_MODEL_ID` overrides the default model set in `backend/lambdas/ai-agent/agent.ts`.
- **测试**：`pnpm --filter @campusgeo/ai-agent test`（vitest，24 条）。测试文件：`backend/lambdas/ai-agent/tests/handler.test.ts`、`tools.functional.test.ts`（含真实 S3 fixture，需 AWS 凭证）。单条测试：`pnpm --filter @campusgeo/ai-agent exec vitest run --testNamePattern "test name"`。

**安全约束（开发期，2026-07 IT 整改后）：**
- `backend-config.local.js` 已 gitignore，绝对不能 commit（含 API key）。
- `CampusGeo-with-Backend.html` 在 Phase 2 认证上线前，禁止上传 S3 / CloudFront 公开托管。
- CloudFront `E3J65QFHW23IJZ` 当前禁用，待与 IT 确认改造方案后恢复。

**Infrastructure** — `infra/cdk` uses **npm, not pnpm** (own `package-lock.json`):

```bash
cd infra/cdk
npm run synth | diff | deploy:dev | deploy:prod
```

Stacks in `infra/cdk/stacks/`: `DataStack` (S3 + DynamoDB), `ApiStack`, `AuthStack`, `FrontendStack`.

**Data ETL** (Python — geopandas/fiona, run inside the ArcGIS Pro conda env set up by `setup_arcgis_env.bat`):

```bash
python convert_gdb.py --list-only                    # inspect GDB layers
python convert_gdb.py --all                          # convert all layers → gis_output/
python convert_gdb.py --upload-core-only --bucket campusgeo-geodata-<account-id>
```

See `QUICKSTART.md` for the S3/DynamoDB deployment sequence, `README_ARCGIS.md` for the conversion environment.

## 工作日志（每日必写）

每个工作会话结束前，更新当天的 `docs/worklog/YYYY-MM-DD.md`（同日多次会话追加到同一文件）。内容三段：**今日完成**（做了什么、部署了什么）、**关键决定**（为什么这么做）、**遗留 / 下一步**（checkbox 列表，次日从这里接续）。写完随代码一起 commit。新会话开始时先读最近一篇日志了解上下文。

## Repository Architecture

- **`apps/web`** — React 18 + Vite + TS frontend. TanStack Router (`routes/LandingPage.tsx` → `routes/MapApp.tsx`), Zustand stores (`stores/mapStore.ts`, `stores/queryStore.ts`), ArcGIS Maps SDK (`@arcgis/core`).
- **`packages/shared-types`** — `@campusgeo/shared-types`: geo/API/agent types shared between frontend and backend.
- **`backend/lambdas/ai-agent`** — the agent core. `agent.ts` runs the Bedrock ConverseStream tool-use loop; `handler.ts` wraps it as a Lambda with Response Streaming (deploy with Function URL `InvokeMode = RESPONSE_STREAM`). **Adding a tool** = new file in `tools/campus/` (handler + Zod input schema) + register its `toolSpec` in `CAMPUS_TOOLS` and dispatch it in `agent.ts`.
- **`backend/dev-server`** — plain Node HTTP wrapper around `runCampusGeoAgent` that reproduces the production SSE contract exactly, so local development needs no Lambda deploy.
- **`backend/lambdas/{arcgis-proxy,auth-hook,bookmarks,data-ingestion,query-history,shuttle-proxy}`** — supporting Lambdas at varying maturity.
- **`design/`, `ui_kits/`, `preview/`, root `*.html`** — design system and static prototypes; not part of the build.
- **`convert_gdb.py` + `gis_output/`** — GDB → GeoJSON ETL and generated layer metadata (`core_layers.json`, `layers_metadata.json`, `dynamodb_batch_import.json`).

### Query data flow

`QueryBar` → `apps/web/src/api/agent.ts` `streamAgentQuery()` → `POST {VITE_API_URL}/api/agent` with `{ query }` → SSE stream of `data: {json}` events: `text` / `tool_call` / `tool_result` (may carry `mapUpdate` with GeoJSON features + center) / `done` / `error`. The frontend writes events into `queryStore`/`mapStore`; map components consume store data imperatively.

Tools currently hit live sources (ArcGIS Feature Services via `queryArcGIS`, UChicago shuttle feed, Divvy GBFS). Migration to self-hosted S3 GeoJSON + Turf.js is the in-progress Phase 1 work (see roadmap below).

## Technical Stack

- React 18 + Vite
- ArcGIS Maps SDK for JavaScript 4.x — load via ESM
- Tailwind CSS — utility layer ONLY for layout primitives (flex, grid, spacing). Use the CSS variables above for all color, typography, and aesthetic decisions. Do not reference Tailwind's default color ramp.
- **AWS Bedrock (ConverseStream) with tool use** for query interpretation — the planned Phase 4 migration from the direct Anthropic API already happened. The agent loop is server-side in `backend/lambdas/ai-agent/agent.ts`; model selected via `BEDROCK_MODEL_ID`. Never expose AWS credentials to the browser.
- Deployment: **unified on AWS** (S3 + CloudFront for frontend, Lambda for query API, Bedrock for LLM). A split Vercel/AWS deployment was considered and rejected — one platform avoids CORS friction, split secret management, and fragmented monitoring, and AWS experience aligns with target GIS/AI/PropTech roles. Vercel remains acceptable as a throwaway preview environment only.

## Engineering Conventions

- Component files: PascalCase, one component per file, co-located styles in `.module.css`.
- Prefer vanilla CSS modules over Tailwind for aesthetic-heavy components (typography, color, complex layouts). Reserve Tailwind for genuine utility cases.
- Map interaction logic stays imperative, outside the React tree (`apps/web/src/components/map/`, `apps/web/src/hooks/useArcGISLayer.ts`). Avoid putting ArcGIS view objects into React state — Zustand stores hold plain data (GeoJSON, ids, focus targets); map components react to it.
- Agent tool definitions live in `backend/lambdas/ai-agent/tools/campus/`. Each tool is a single file exporting a handler and a Zod input schema; the Bedrock `toolSpec` is registered in `CAMPUS_TOOLS` in `agent.ts`.
- All user-facing strings flow through a single `copy.ts` constants file. No inline UI text in components — this enforces voice consistency and makes copy audits trivial.

## Anti-Patterns to Refuse

- Do not add a "Powered by Claude" badge.
- Do not auto-suggest example queries with sparkle emoji.
- Do not add a chat history sidebar — this is a query tool, not a conversation app.
- Do not propose "AI-generated insights" panels that aren't actually grounded in queried data.

---

When in doubt about an aesthetic decision, look at how aino.world, The Pudding, or a printed atlas would solve it. Then do that.

---

## Development Roadmap

15–18 month part-time development plan (5–10 hrs/week). Current status: **Alpha** — core query-to-map flow working, production deployment and data migration pending.

### Data Architecture (Revised 2026-05-28)

**Shift from ArcGIS Feature Services to self-hosted GeoJSON:**
- Campus geodatabase → GeoJSON conversion (GDAL/ArcPy)
- Storage: AWS S3 (processed GeoJSON files)
- Metadata: DynamoDB (layer schemas, update timestamps)
- Query engine: Lambda + Turf.js (in-memory spatial filtering)

**Benefits:**
- Cost: ~$0.12/month vs. $10–50/month ArcGIS Online Credits
- Control: custom attributes (FAR, ADA compliance) without ArcGIS schema constraints
- Performance: S3 regional caching, no external API dependencies

**Trade-offs:**
- Must maintain ETL pipeline for data updates
- No built-in spatial indexes (implement R-tree for large datasets in Phase 3)

---

### Phase 1: Foundation (Months 1–4) — 90% complete, ~15–25 hours remaining
**Goal:** Deployable prototype with self-hosted data.

**Completed:**
- Natural language query via Claude tool use
- ArcGIS Maps SDK frontend integration
- Editorial cartography UI (Fraunces + IBM Plex, warm paper aesthetic)
- **[2026-06-04] Geodatabase → GeoJSON ETL toolkit (ArcGIS Pro compatible)**
  - `convert_gdb.py` — Core conversion script (geopandas + fiona)
  - `setup_arcgis_env.bat` — One-time environment setup
  - `convert_with_arcgis.bat` — Daily-use conversion launcher
  - `verify_conversion.bat` — Post-conversion validation
  - `README_ARCGIS.md` — Complete user documentation
  - Verified output: 308 buildings, 1.7MB GeoJSON, WGS84 projection

**Remaining:**
- [x] Upload GeoJSON to S3 ✅ (完成于 2026-07-01)
- [x] Rewrite Lambda query tools: S3 + Turf.js instead of ArcGIS REST API ✅ (完成于 2026-07-05)
  - ✅ `queryS3Layer.ts` — 统一的 S3 查询工具（WHERE 子句解析 + 字段选择）
  - ✅ `getBuildingInfo.ts` — 迁移到 S3
  - ✅ `findCampusNearby.ts` — 迁移到 S3（buildings, dining, accessible）
  - ✅ `queryTrees.ts` — 已使用 S3
  - ⏳ 未迁移：bike_racks, electrical, parking（暂时保留 queryArcGIS）
- [x] Fix Lambda handler TypeScript errors ✅
- [x] Deploy frontend to S3 + CloudFront, backend to AWS Lambda ✅
- [ ] Populate DynamoDB metadata (layers schema, update timestamps) — 可选，Phase 2 前完成

**Success metric:** Public demo URL responds to "Show me campus trees" with S3-hosted data visualization.

---

### Phase 2: User Infrastructure (Months 5–8)
**Goal:** Persistent user accounts and cross-session memory.

**Key features:**
- **Google Workspace OAuth** (UChicago CNetID validation)
  - Frontend: Google Sign-In button
  - Backend: verify `@uchicago.edu` domain, check DynamoDB whitelist
  - **Scope control:** ship with a hardcoded invitation-code gate first; defer the full admin panel (add/remove users UI) to Phase 4 unless time allows. The admin panel + whitelist edge cases (rejection UX, revocation) can absorb 30–40 hours better spent on Phase 3 differentiators.
- **DynamoDB storage:**
  - `users` table: profile (CNetID, email, join date)
  - `query_history` table: user queries + GeoJSON results
  - `map_bookmarks` table: saved map states (zoom, center, layers)
  - `user_profiles` table: Claude-generated memory summaries (see below)
- **QueryHistoryPanel UI:** load previous queries, replay on map
- **User memory (lightweight, ~10h):** a scheduled Lambda periodically summarizes each user's `query_history` via Claude into a compact profile ("frequently queries north-campus building condition; prefers tree layers in spring"). The profile seeds personalized query suggestions and change notifications. History is the record; the profile is the memory — they are distinct features.

**Access control:** Internal-only. Invitation-code gate first, whitelist later. Future migration to UChicago IT CNetID SSO (SAML/Shibboleth) when scaling.

**Success metric:** Returning UChicago users see query history and bookmarks. Non-UChicago accounts rejected at login.

---

### Phase 3: Advanced Queries (Months 9–14)
**Goal:** Multi-step spatial analysis (decision-support tool, not auto-optimizer).

**New tools:**
- `check_ada_compliance` — identify buildings missing accessible entrances
- `analyze_site_suitability` — score candidate locations (custom heuristics: distance to transit, foot traffic proxies, zoning)
- `calculate_pedestrian_accessibility` — walkability isochrones

**Example queries:**
- "Which buildings lack ADA entrances?" (direct retrieval)
- "Suggest 5 locations for a new Divvy station" (multi-step: high-traffic areas → sidewalk width filter → rank by transit proximity)
- "Evaluate parking feasibility in Block G" (score based on FAR, existing parking density, pedestrian flow)

**Important:** Outputs are **ranked candidate lists** with explanatory scoring, NOT single "optimal" answers. Users make final decisions.

**Long-term goal (Phase 4+):** Integrate real optimization models (e.g., Location-Allocation via ArcGIS Spatial Analyst Python API or custom MILP solver).

**Success metric:** 3 complex queries execute with editorial answer formatting and candidate scoring tables.

---

### Phase 4: Production (Months 15–18)
**Goal:** Beta-ready system for 5–10 invited users.

**Tasks:**
- Performance: MapCanvas rendering optimization, S3 query result caching (CloudFront)
- Monitoring: Sentry error tracking + CloudWatch Lambda metrics
- ~~Migrate LLM calls from Anthropic API to AWS Bedrock~~ — done early: `backend/lambdas/ai-agent/agent.ts` already calls Bedrock ConverseStream directly
- Admin panel for user whitelist (deferred from Phase 2)
- User docs: query syntax guide, data attribution, privacy policy
- Beta testing: feedback forms, user interviews

#### Daily Data-Update Pipeline (promoted from one-liner — portfolio-worthy on its own)

```
EventBridge (daily cron, e.g. 02:00 CT)
  → Lambda: fetch source geodatabase export / check S3 upload bucket
  → diff against current GeoJSON (feature count, attribute hashes, geometry checksums)
  → if changed:
      ├─ run validation (schema, CRS, coordinate sanity — reuse verify_conversion logic)
      ├─ optionally invoke Claude to summarize the change set & flag anomalies
      │   (coordinate drift, missing fields, suspicious deletions)
      ├─ write new GeoJSON to S3 + update DynamoDB layer timestamps
      ├─ invalidate CloudFront cache
      └─ SNS notification (email/Slack): "3 buildings updated, 12 trees added"
  → if anomalous: hold update, notify for manual review
```

This is a self-healing data pipeline with an LLM QA step — present it as a standalone portfolio story.

**Success metric:** Beta launch with <2s query response (p95), zero critical bugs over 2-week test period.

---

### Known Constraints

**Technical:**
- Spatial query performance: Large datasets (>10MB GeoJSON) need R-tree indexing (implement in Phase 3)
- ETL maintenance: Geodatabase updates require manual or semi-automated pipeline
- Bedrock Knowledge Base: Currently text-only, not optimized for GeoJSON (research in Phase 3)

**Data:**
- FAR (Floor Area Ratio) data may require manual attribute addition to geodatabase
- Real-time data (e.g., Divvy station availability) needs external API integration

**Scope:**
- LLM spatial reasoning has limits — "ideal location" queries produce scored candidates, not provably optimal solutions
- Advanced optimization (placer.ai-style foot traffic models) requires machine learning, beyond initial scope

---

**Milestones:**
| Phase | Target | Deliverable |
|-------|--------|------------|
| Foundation | Month 4 | Demo URL with S3 data |
| User Infrastructure | Month 8 | Login + history UI |
| Advanced Queries | Month 14 | Decision-support queries |
| Production | Month 18 | Beta with 5–10 users |

---

**Time commitment:** 280–380 hours over 15–18 months (~5–10 hrs/week sustained).

**Cost estimate (Beta phase):**
- AWS S3 + DynamoDB + Lambda: ~$0.12–0.50/month
- Bedrock Claude invocations: ~$5–15/month (10 users × 100 queries/month)
- **Total: <$20/month** (vs. $50–100/month with ArcGIS Online Credits)

**Support needed:**
- Beta tester recruitment: 5–10 UChicago campus users (GIS, urban planning, facilities)
- AWS Bedrock quota: request increase if default limits too low
- UChicago GIS team: coordinate geodatabase access and update schedule

<!-- SPECKIT START -->
Project constitution (governing principles, tech stack, workflow rules): `.specify/memory/constitution.md`
For feature specs and implementation plans, see `specs/` directory (created per feature via /speckit-specify).
<!-- SPECKIT END -->
