# CLAUDE.md — UChicago GIS Intelligence

This file defines the design language and engineering conventions for this project. Claude Code reads it on every session as part of the system context. When generating any UI code, treat the `<frontend_aesthetics>` block as binding, not aspirational.

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

## Technical Stack

- React 18 + Vite
- ArcGIS Maps SDK for JavaScript 4.x — load via ESM
- Tailwind CSS — utility layer ONLY for layout primitives (flex, grid, spacing). Use the CSS variables above for all color, typography, and aesthetic decisions. Do not reference Tailwind's default color ramp.
- Anthropic Claude API with tool use (function calling) for query interpretation. Server-side proxy via Next.js API routes — never expose the API key.
- Deployment: Vercel for MVP. AWS (S3 + CloudFront + Lambda + Bedrock) for the production / portfolio version.

## Engineering Conventions

- Component files: PascalCase, one component per file, co-located styles in `.module.css`.
- Prefer vanilla CSS modules over Tailwind for aesthetic-heavy components (typography, color, complex layouts). Reserve Tailwind for genuine utility cases.
- Map interaction logic lives in `src/map/` separate from React tree. Avoid putting ArcGIS view objects into React state.
- Claude tool definitions live in `src/agent/tools/`. Each tool is a single file exporting a `name`, `description`, `input_schema`, and `handler`.
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

### Phase 1: Foundation (Months 1–4) — 75% complete, ~40–60 hours remaining
**Goal:** Deployable prototype with self-hosted data.

**Completed:**
- Natural language query via Claude tool use
- ArcGIS Maps SDK frontend integration
- Editorial cartography UI (Fraunces + IBM Plex, warm paper aesthetic)

**Remaining:**
- [ ] Geodatabase → GeoJSON ETL script (Python + GDAL)
- [ ] Upload GeoJSON to S3, populate DynamoDB metadata
- [ ] Rewrite Lambda query tools: S3 + Turf.js instead of ArcGIS REST API
- [ ] Fix Lambda handler TypeScript errors
- [ ] Deploy to Vercel (frontend) + AWS Lambda (backend)

**Success metric:** Public demo URL responds to "Show me campus trees" with S3-hosted data visualization.

---

### Phase 2: User Infrastructure (Months 5–8)
**Goal:** Persistent user accounts and cross-session memory.

**Key features:**
- **Google Workspace OAuth** (UChicago CNetID validation)
  - Frontend: Google Sign-In button
  - Backend: verify `@uchicago.edu` domain, check DynamoDB whitelist
  - Admin panel: add/remove invited users
- **DynamoDB storage:**
  - `users` table: profile (CNetID, email, join date)
  - `query_history` table: user queries + GeoJSON results
  - `map_bookmarks` table: saved map states (zoom, center, layers)
- **QueryHistoryPanel UI:** load previous queries, replay on map

**Access control:** Internal-only. Invitation-required whitelist. Future migration to UChicago IT CNetID SSO (SAML/Shibboleth) when scaling.

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
- ETL automation: Lambda-triggered geodatabase updates (when new data uploaded to S3)
- User docs: query syntax guide, data attribution, privacy policy
- Beta testing: feedback forms, user interviews

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
