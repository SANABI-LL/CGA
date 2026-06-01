<!--
SYNC IMPACT REPORT
==================
Version change: (none) → 1.0.0 (initial ratification)
Modified principles: N/A — first version
Added sections:
  - I. Editorial Cartography First
  - II. Type & Color System
  - III. Component Architecture
  - IV. Data Grounding
  - V. Copy Voice & UI Patterns
  - VI. Security & Deployment
  - Technical Stack
  - Development Workflow
  - Governance
Removed sections: N/A
Templates reviewed:
  - .specify/templates/plan-template.md ✅ compatible (Constitution Check gate preserved)
  - .specify/templates/spec-template.md ✅ compatible (no changes needed)
  - .specify/templates/tasks-template.md ✅ compatible (no changes needed)
Deferred items: None
-->

# CampusGeo Constitution

## Core Principles

### I. Editorial Cartography First

The map is the protagonist on every screen. Every UI decision MUST reinforce "spatial intelligence as scholarship" — the interface MUST feel like a beautifully typeset field guide that happens to be interactive, never a SaaS dashboard or generic chatbot wrapper.

- The map canvas MUST occupy the dominant viewport area (60–70% width on desktop).
- Surrounding chrome MUST be quiet and confident — hairline rules, typographic hierarchy, whitespace. No cards with drop shadows, no gradient headers.
- All new views MUST pass the three-question ship check before considered done:
  1. Does this look like an editorial publication that happens to be interactive, or like a generic SaaS dashboard?
  2. Is the map clearly the most important element on screen?
  3. With color removed, does the typographic hierarchy still carry the design?
- The Editorial Answer pattern (one-line Fraunces answer → structured data → contextual prose) MUST be used consistently for all query results.

### II. Type & Color System

Typography and color are non-negotiable. Deviating from the defined system is a constitution violation requiring explicit justification.

**Typography — exactly three families, loaded from Google Fonts:**
- Display/headers: Fraunces (variable, optical sizing enabled). Weight 400 for section headers, 500–600 for hero.
- Body: IBM Plex Sans, weight 400 body / 500 emphasis. Letter-spacing 0 at body size.
- Mono/technical: IBM Plex Mono. For coordinates, attribute keys, query strings, feature IDs, data tables.
- Forbidden typefaces: Inter, Roboto, Open Sans, Lato, Poppins, Montserrat, Nunito, Space Grotesk, any system font stack as primary.

**Color — CSS custom properties throughout (`--paper`, `--ink`, `--maroon`, etc.):**
- Base palette is warm paper-and-ink (`--paper: #f4f1ea`, `--ink: #1a1a1a`). NEVER pure black on pure white.
- Maroon (`--maroon: #800000`) appears on at most 5% of screen at any time. It is punctuation, not decoration.
- Forbidden: purple gradients, blue-to-pink gradients, glassmorphism backdrop blurs, neon accents, Tailwind's default `gray-*` / `slate-*` for body text.
- All color tokens MUST be defined in CSS custom properties; no raw hex values in component styles.

**Motion:**
- Default easing `cubic-bezier(0.4, 0, 0.2, 1)`, duration 280–400ms.
- No spinning loaders — use maroon top-of-screen progress bar or `--paper-deep` skeleton blocks.
- No scroll-jacking, no parallax, no animated SVG mascots, no `hover:scale-105`.

### III. Component Architecture

Code structure enforces the separation of concerns between map state, React UI, and AI agent logic.

- Component files: PascalCase, one component per file, co-located styles in `.module.css`.
- Map interaction logic MUST live in `src/map/` separate from the React tree. ArcGIS view objects MUST NOT be placed into React state.
- Claude tool definitions MUST live in `backend/lambdas/ai-agent/tools/`. Each tool is a single file exporting `name`, `description`, `input_schema`, and `handler`.
- Shared TypeScript types MUST live in `packages/shared-types/`. No type duplication across packages.
- Tailwind CSS is permitted for layout primitives only (flex, grid, spacing). All color, typography, and aesthetic decisions MUST use the CSS variable system.
- Prefer vanilla CSS modules over Tailwind for aesthetic-heavy components.
- No feature-flag hacks, backwards-compatibility shims, or `_unused` variable prefixes — if unused, delete it.

### IV. Data Grounding

AI responses MUST be grounded in data returned by actual tool calls. No speculative or hallucinated spatial information.

- Every query answer in the UI MUST trace to at least one executed tool call result. "AI-generated insights" panels without data backing are prohibited.
- Spatial data MUST be self-hosted (S3 GeoJSON + Turf.js in Lambda). Dependence on ArcGIS Online Feature Services as the primary query backend is only acceptable during the Phase 1 development period; migration to S3-based data MUST occur before production launch.
- Claude tool use MUST run server-side (Lambda). The frontend MUST never call the Anthropic API directly.
- Query results displayed in the UI MUST cite the data source (layer name, last-updated timestamp) in contextual prose per the Editorial Answer pattern.
- Spatial analysis outputs for multi-step queries (site suitability, accessibility) MUST be presented as ranked candidate lists with scoring rationale, never as single "optimal" answers. The system supports decision-making; it does not make decisions.

### V. Copy Voice & UI Patterns

Interface text is part of the aesthetic. All user-facing strings flow through `src/utils/copy.ts`. No inline UI text in components.

**Tone rules (all MUST):**
- Field guide / scholarly. Precise. Never breezy, never apologetic.
- Present tense, confident, not boastful.
- Sentence case for labels and prompts. Title Case for section headers only. ALL CAPS never.
- Button copy: verbs (`Map results`, `Reset view`, `Open feature card`). Never `Submit`, `Click here`, `Get started`.
- No exclamation marks in production UI copy. No emoji in UI chrome.
- Empty states: `No features match this query.` — never `Oops! Nothing here yet.`
- Loading: `Querying campus data` — never `Just a moment!`
- Errors: name the actual problem in one sentence. No emojis.

**Banned component patterns (AI-slop defaults — generate none of these):**
- Card grids with `rounded-2xl shadow-lg hover:scale-105`
- Modal dialogs with gradient headers
- Tailwind `bg-gray-50` page backgrounds
- Sticky headers with `backdrop-blur`
- "Hero section with gradient text"
- Pill badges in Tailwind default colors
- Right-side fixed chat bubble with robot avatar
- Any visible string containing "Powered by AI" or "✨"
- "Add a chat history sidebar" (this is a query tool, not a conversation app)
- Default shadcn/ui theme without aggressive restyling

### VI. Security & Deployment

The Anthropic API key and AWS credentials MUST never be exposed to the browser or committed to the repository.

- The Claude API MUST be called exclusively through the server-side Lambda proxy. No client-side Anthropic SDK calls.
- Environment variables containing secrets MUST use `.env.local` (gitignored) locally and AWS Secrets Manager / Lambda environment variables in deployed environments.
- `.claude/` and `.specify/` directories SHOULD be reviewed before committing; credentials or session tokens in these directories MUST be gitignored.
- AWS IAM roles for Lambda MUST follow least-privilege. Lambda functions MUST only have permissions for the specific S3 buckets and DynamoDB tables they access.
- CNetID authentication (Phase 2) MUST validate the `@uchicago.edu` domain server-side before granting access. Client-side domain checks alone are insufficient.

## Technical Stack

The mandated stack for this project. Deviations require explicit justification in the relevant feature plan's Complexity Tracking section.

- **Frontend**: React 18 + Vite + TypeScript. `@campusgeo/web` package.
- **Mapping**: ArcGIS Maps SDK for JavaScript 4.x, loaded via ESM. Custom-styled — default ArcGIS basemap aesthetics are prohibited.
- **State**: Zustand for app state. ArcGIS `MapView` object MUST NOT enter Zustand.
- **Styling**: Tailwind CSS (layout primitives only) + CSS Modules + CSS custom properties.
- **Backend**: AWS Lambda (TypeScript, Node 20+). SSE streaming via Lambda Function URLs in `RESPONSE_STREAM` mode.
- **AI**: AWS Bedrock (Claude 3.5 Sonnet v2 or latest equivalent). Tool use for all query interpretation.
- **Spatial data**: AWS S3 (GeoJSON files) + Turf.js (Lambda, in-memory spatial operations). DynamoDB for layer metadata.
- **Infrastructure**: AWS CDK (TypeScript). Stacks: `ApiStack`, `AuthStack`, `DataStack`, `FrontendStack`.
- **Package manager**: pnpm 9.x with workspace configuration. No npm or yarn.
- **Monorepo packages**: `apps/web`, `backend/lambdas/*`, `backend/dev-server`, `packages/shared-types`, `infra/cdk`.

## Development Workflow

- **Spec-Driven**: All non-trivial features MUST go through `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement` before implementation begins.
- **Type safety**: TypeScript strict mode. `packages/shared-types` is the single source of truth for cross-package types. `zod` for runtime validation at system boundaries.
- **No partial implementations**: Features are either complete (passes the three-question ship check, queryable from the UI, data visible on map) or not started. No "skeleton" UI components merged to main without data.
- **Dev server validation**: Before reporting a frontend task complete, the dev server MUST be running and the feature tested in-browser. Type checking alone is insufficient.
- **Port hygiene**: Before starting the dev server, verify ports 5173 (Vite) and 8080 (dev Lambda) are free. Kill conflicting processes before starting new ones.
- **Commit granularity**: One logical change per commit. Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`).
- **CLAUDE.md authority**: CLAUDE.md is the binding aesthetic and engineering contract for all Claude Code sessions. The `<frontend_aesthetics>` block supersedes any default code generation behavior.

## Governance

This constitution supersedes all other ad hoc conventions, README fragments, or verbal agreements about how CampusGeo is built. Amendments require:

1. Update this file via `/speckit-constitution` with explicit version bump rationale.
2. MAJOR bump: removing or incompatibly redefining a principle (e.g., switching from self-hosted S3 to ArcGIS Online permanently, changing the type system).
3. MINOR bump: adding a new principle or materially expanding guidance.
4. PATCH bump: clarifications, wording, typo fixes, non-semantic refinements.

All feature specs and implementation plans MUST include a Constitution Check section verifying compliance with active principles before Phase 0 research begins. Non-compliance discovered during implementation MUST be documented in the Complexity Tracking section with explicit justification.

The CLAUDE.md file (`<frontend_aesthetics>` block) is the operational extension of Principles I and II and MUST remain consistent with this constitution. If they diverge, this constitution takes precedence and CLAUDE.md must be updated to match.

**Version**: 1.0.0 | **Ratified**: 2026-05-31 | **Last Amended**: 2026-05-31
